#!/usr/bin/env python3
"""Builds the pops for one county: groups of 100 adults who share race, age and education and live in one precinct piece.

Inputs: 2020 Census blocks (adults by race, group quarters), American Community Survey tract tables (age, education,
income, industry, tenure, children, citizenship), 2024 precincts. The outputs here come from demographics alone:
nothing is fitted to the 2024 result, which is kept only for comparison.
Leader names are stand-ins drawn from short lists; the party is drawn from the pop's own split.
Usage: pops.py RAW_DIR WORK_DIR STATE_ABBR STATE_FIPS COUNTY_FIPS OUT_JSON [PRECINCT_PREFIX]
"""
import io
import json
import math
import sys
import zipfile
import zlib
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAW, WORK, ST, SF, CF, OUT = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5], Path(sys.argv[6])
PREFIX = sys.argv[7] if len(sys.argv) > 7 else SF + CF
TOWNSHIP_STATES = set("CT IL IN KS ME MA MI MN MO NE NH NJ NY ND OH PA RI SD VT WI".split())
SIZE = 100
RACES = ["White", "Black", "Hispanic", "Asian", "Other"]
AGES = ["18 to 29", "30 to 44", "45 to 64", "65 and over"]
EDUS = ["No college", "Some college", "Bachelor's or more"]
INCOMES = ["Under $35,000", "$35,000 to $75,000", "$75,000 to $150,000", "Over $150,000"]
WORK_LINES = ["Farm and ranch", "Oil, gas and mining", "Factory and plant", "Building and transport", "Shops and service",
              "Office and professional", "Schools and health", "Government and military"]
INDUSTRY_CELLS = {0: [4], 1: [5], 2: [7], 3: [6, 8, 10], 4: [9, 24, 27], 5: [13, 14, 17], 6: [21], 7: [28]}

# Placeholders from national 2024 exit polls and turnout surveys, written in from memory. Replace before calibration.
LEAN = {"White": [0.67, 0.60, 0.46], "Black": [0.14, 0.14, 0.13], "Hispanic": [0.49, 0.47, 0.42], "Asian": [0.42, 0.40, 0.38], "Other": [0.55, 0.52, 0.45]}
AGE_TILT = [-0.25, -0.05, 0.12, 0.02]
AREA_TILT = {"urban": -0.45, "suburban": 0.0, "small town": 0.35, "rural": 0.55}
INDEPENDENT = [0.42, 0.38, 0.32, 0.26]
TURNOUT = [[0.38, 0.52, 0.68], [0.48, 0.62, 0.76], [0.58, 0.70, 0.82], [0.64, 0.76, 0.85]]

FIRST = {"White": "James Mary Robert Linda William Susan David Karen Thomas Nancy Charles Betty Daniel Carol Mark Sandra Paul Donna Steven Ruth Gary Sharon Larry Brenda Dale Peggy Wayne Glenda Travis Kayla".split(),
         "Black": "Willie Gloria Reginald Denise Curtis Yolanda Darnell Latoya Marcus Tamika Alvin Bernice Terrence Keisha Leroy Ernestine Cedric Shanice Otis Vernell".split(),
         "Hispanic": "Jose Maria Luis Carmen Carlos Rosa Miguel Ana Jorge Lucia Rafael Elena Hector Marisol Raul Yolanda Julio Beatriz".split(),
         "Asian": "Wei Mei Hung Linh Raj Priya Jin Soo Minh Anh Kenji Yuki Arun Lakshmi".split()}
LAST = {"White": "Walker Bishop Thompson Reams Hightower Boland Clark Sauls Barfield Cooksey Morris Lacy Watkins Hale Stokes Kinsey Braswell Fulford Cone Merritt Hagan Tuten Shiver Boyd Joyner".split(),
        "Black": "Washington Jefferson Robinson Jackson Footman Gallon Brinson Seabrooks Mitchell Hall Bellamy Crumity Norton Ghent Proctor Barrington Rivers Francis".split(),
        "Hispanic": "Garcia Rodriguez Martinez Hernandez Lopez Gonzalez Perez Sanchez Ramirez Torres Flores Rivera Morales Ortiz".split(),
        "Asian": "Nguyen Chen Patel Kim Tran Li Singh Park Pham Wang".split()}


def acs(table, geo):
    d = pd.read_csv(RAW / f"acs/{ST.lower()}/{table}.dat", sep="|", dtype=str).set_index("GEO_ID")
    row = d.loc[geo]
    return lambda n: float(row[f"{table.upper()}_E{n:03d}"] or 0)


def both(get, cells, step):
    return sum(get(c) + get(c + step) for c in cells)


# ---- blocks: adults by race, prisoners out, students counted
with zipfile.ZipFile(RAW / f"pl/{ST.lower()}.zip") as z:
    geo = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}geo2020.pl")), sep="|", header=None, dtype=str, usecols=[2, 7, 9, 92, 93], encoding="latin-1", keep_default_na=False)
    geo.columns = ["sumlev", "rec", "block", "lat", "lon"]
    geo = geo[(geo.sumlev == "750") & geo.block.str.startswith(SF + CF)]
    s2 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000022020.pl")), sep="|", header=None, dtype=str, usecols=[4, 76, 77, 80, 81, 83])
    s2.columns = ["rec", "adults", "Hispanic", "White", "Black", "Asian"]
    s3 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000032020.pl")), sep="|", header=None, dtype=str, usecols=[4, 7, 12])
    s3.columns = ["rec", "prison", "college"]
b = geo.merge(s2, on="rec").merge(s3, on="rec")
for c in ["adults", "Hispanic", "White", "Black", "Asian", "prison", "college"]:
    b[c] = b[c].astype(float)
b["Other"] = b.adults - b[["Hispanic", "White", "Black", "Asian"]].sum(axis=1)
keep = ((b.adults - b.prison).clip(lower=0) / b.adults.where(b.adults > 0, 1)).fillna(0)
for r in RACES:
    b[r] *= keep
b["tract"] = b.block.str[:11]
pts = gpd.GeoDataFrame(b, geometry=gpd.points_from_xy(b.lon.astype(float), b.lat.astype(float)), crs=4269)

# ---- where each block is: precinct and city
prec = gpd.read_file(WORK / f"pgeo/{ST}.geojson", engine="pyogrio").to_crs(4269)
prec = prec[prec.p.str.startswith(PREFIX)]
j = gpd.sjoin(pts, prec[["p", "geometry"]], how="left", predicate="within").drop(columns="index_right")
miss = j.p.isna()
if miss.any():
    near = gpd.sjoin_nearest(pts[miss.values].to_crs(5070), prec[["p", "geometry"]].to_crs(5070), how="left")
    j.loc[miss, "p"] = near.groupby(level=0).p.first()
places = gpd.read_file(f"zip://{RAW}/tiger/{SF}_place.zip", engine="pyogrio")
places = places[~places.CLASSFP.str[0].isin(["U", "M"])][["NAME", "geometry"]].rename(columns={"NAME": "city"})
j = gpd.sjoin(j, places, how="left", predicate="within").drop(columns="index_right")
subs = gpd.read_file(f"zip://{RAW}/tiger/{SF}_cousub.zip", engine="pyogrio")[["NAME", "geometry"]].rename(columns={"NAME": "township"})
j = gpd.sjoin(j, subs, how="left", predicate="within").drop(columns="index_right")
if ST not in TOWNSHIP_STATES:
    j["township"] = None
j = j[~j.index.duplicated()]
j["city"] = j.city.fillna("")
j["piece"] = j.p + "|" + j.city
city_people = j.groupby("city").adults.sum()

# ---- non-citizens out, by tract, taken from the groups other than White and Black
tracts = sorted(j.tract.unique())
for t in tracts:
    g = acs("b05003", "1400000US" + t)
    adults, non = g(8) + g(19), g(12) + g(23)
    m = j.tract == t
    pool = j.loc[m, ["Hispanic", "Asian", "Other"]].sum().sum()
    cut = min(non / adults * j.loc[m, RACES].sum().sum(), 0.6 * pool) / pool if adults and pool else 0
    for r in ["Hispanic", "Asian", "Other"]:
        j.loc[m, r] *= 1 - cut

# ---- age and education inside each tract, for each race
AGE_CELLS = {"all": [[7, 8, 9, 10, 11], [12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24, 25]],
             "race": [[7, 8, 9], [10, 11], [12, 13], [14, 15, 16]]}
county = "0500000US" + SF + CF
tilt = {}
for r, table in (("White", "c15002h"), ("Hispanic", "c15002i")):
    g = acs(table, county)
    total, ba = g(2) + g(7), g(6) + g(11)
    tilt[r] = ba / total if total else None
ga = acs("b15001", county)
overall = both(ga, [9, 10, 17, 18, 25, 26, 33, 34, 41, 42], 41) / (ga(2) + ga(43))
share = {}  # tract -> race -> age -> edu
for t in tracts:
    geo_id = "1400000US" + t
    age = {}
    for r in RACES:
        table, cells, step = ("b01001h", AGE_CELLS["race"], 15) if r == "White" else ("b01001i", AGE_CELLS["race"], 15) if r == "Hispanic" else ("b01001", AGE_CELLS["all"], 24)
        g = acs(table, geo_id)
        v = np.array([both(g, c, step) for c in cells])
        if v.sum() < 30:
            g = acs("b01001", geo_id)
            v = np.array([both(g, c, 24) for c in AGE_CELLS["all"]])
        age[r] = v / v.sum() if v.sum() else np.full(4, 0.25)
    g = acs("b15001", geo_id)
    raw = []  # survey age bands: 18-24, 25-34, 35-44, 45-64, 65+
    for start in (3, 11, 19, 27, 35):
        raw.append(np.array([both(g, [start + 1, start + 2, start + 3], 41), both(g, [start + 4, start + 5], 41), both(g, [start + 6, start + 7], 41)]))
    edu = [raw[0] + raw[1] / 2, raw[1] / 2 + raw[2], raw[3], raw[4]]
    edu = [e / e.sum() if e.sum() else np.array([0.5, 0.3, 0.2]) for e in edu]
    share[t] = {}
    for r in RACES:
        share[t][r] = []
        for a in range(4):
            e = edu[a].copy()
            if tilt.get(r) and overall:
                odds = (tilt[r] / (1 - tilt[r])) / (overall / (1 - overall))
                e[2] *= odds
                e /= e.sum()
            share[t][r].append(age[r][a] * e)

# ---- expected adults of each kind in each piece, then whole pops by controlled rounding
expected = defaultdict(lambda: np.zeros(60))
meta = {}
for piece, g in j.groupby("piece"):
    for t, gt in g.groupby("tract"):
        for ri, r in enumerate(RACES):
            n = gt[r].sum()
            for a in range(4):
                expected[piece][ri * 12 + a * 3: ri * 12 + a * 3 + 3] += n * share[t][r][a]
    top = g.groupby("tract").adults.sum().idxmax()
    meta[piece] = {"precinct": g.p.iloc[0], "city": g.city.iloc[0], "township": g.groupby("township").adults.sum().idxmax() if g.township.notna().any() else "",
                   "tract": top, "college": float(g.college.sum()), "adults": float(sum(expected[piece]))}
pieces = sorted(expected)
M = np.array([expected[p] for p in pieces])
total = int(round(M.sum() / SIZE))


def quota(v, n):
    base = np.floor(v / SIZE).astype(int)
    for i in np.argsort(-(v / SIZE - base))[: n - base.sum()]:
        base[i] += 1
    return base


rows, cols = quota(M.sum(axis=1), total), quota(M.sum(axis=0), total)
left, pops = M.copy(), []
for _ in range(total):
    ok = left * (rows[:, None] > 0) * (cols[None, :] > 0)
    i, k = np.unravel_index(np.argmax(ok), ok.shape)
    if ok[i, k] <= 0:
        i = int(np.argmax(rows))
        k = int(np.argmax(cols * (M[i] + 1e-9)))
    rows[i] -= 1
    cols[k] -= 1
    left[i, k] = max(left[i, k] - SIZE, 0)
    pops.append({"piece": pieces[i], "race": RACES[k // 12], "age": AGES[k % 12 // 3], "education": EDUS[k % 3], "_a": k % 12 // 3, "_e": k % 3})


# ---- carried attributes
def area(city):
    return "small town" if city and city_people.get(city, 0) >= 750 else "rural"


by_tract = defaultdict(list)
for p in pops:
    m = meta[p["piece"]]
    p.update(precinct=m["precinct"], city=m["city"], township=m["township"], area=area(m["city"]))
    by_tract[m["tract"]].append(p)
students_left = {piece: round(m["college"] / SIZE) for piece, m in meta.items()}
for t, group in by_tract.items():
    geo_id = "1400000US" + t
    g = acs("b19001", geo_id)
    bands = np.array([sum(g(c) for c in cs) for cs in ([2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12], [13, 14, 15], [16, 17])])
    cut = np.cumsum(bands / bands.sum())
    order = sorted(group, key=lambda p: (p["_e"] * 2 + [0, 1.5, 2, 0.5][p["_a"]], p["piece"]))
    for n, p in enumerate(order):
        p["income"] = INCOMES[int(np.searchsorted(cut, (n + 0.5) / len(order)))]
    g = acs("b25003", geo_id)
    own = g(2) / g(1)
    g = acs("b11005", geo_id)
    kids = g(2) / g(1)
    for p in group:
        p["owners"] = round(min(0.97, own * [0.5, 0.9, 1.1, 1.15][p["_a"]]), 2)
        p["children"] = round(min(0.9, kids * [1.0, 2.2, 0.7, 0.1][p["_a"]]), 2)
    g = acs("b23025", geo_id)
    working = round(len(group) * (g(4) + g(6)) / g(1))
    idle = len(group) - working
    for p in sorted(group, key=lambda p: -p["_a"]):
        if p["_a"] == 0 and p["_e"] == 1 and students_left.get(p["piece"], 0) > 0:
            students_left[p["piece"]] -= 1
            p["work"] = "Student"
            idle -= 1
    for p in sorted(group, key=lambda p: (-p["_a"], p["_e"])):
        if "work" not in p and idle > 0:
            p["work"] = "Retired" if p["_a"] == 3 else "Not working"
            idle -= 1
    g = acs("c24030", geo_id)
    jobs = np.array([both(g, cells, 27) for cells in INDUSTRY_CELLS.values()])
    jobs[7] += acs("b23025", geo_id)(6)
    todo = [p for p in group if "work" not in p]
    want = jobs / jobs.sum() * len(todo)
    for p in sorted(todo, key=lambda p: (-p["_e"], p["piece"])):
        lean = np.array([[1.3, 1.3, 1.5, 1.5, 1.3, 0.5, 0.6, 0.8], [1, 1, 1, 1, 1, 1, 1, 1], [0.6, 0.7, 0.5, 0.5, 0.6, 2.5, 2.5, 1.6]][p["_e"]])
        if p["area"] == "rural":
            lean[0] *= 2
        k = int(np.argmax(np.maximum(want, 0.01) * lean))
        want[k] -= 1
        p["work"] = WORK_LINES[k]


# ---- outputs from the inputs alone
def logit(x):
    return math.log(x / (1 - x))


for n, p in enumerate(pops):
    lean = 1 / (1 + math.exp(-(logit(LEAN[p["race"]][p["_e"]]) + AGE_TILT[p["_a"]] + AREA_TILT[p["area"]])))
    ind = INDEPENDENT[p["_a"]]
    p["lean"] = round(lean, 3)
    p["pie"] = [round((1 - ind) * lean, 3), round(ind, 3), round((1 - ind) * (1 - lean), 3)]
    p["turnout"] = TURNOUT[p["_a"]][p["_e"]]
    money = INCOMES.index(p["income"]) / 3 * 60 + p["_a"] * 6 + p["_e"] * 8
    p["wealth"] = round(max(0, money - 35) / 63 * 100)
    draw = zlib.crc32(f"{p['piece']}|{n}".encode())
    first = FIRST[p["race"] if p["race"] in FIRST else "White"]
    last = LAST[p["race"] if p["race"] in LAST else "White"]
    spot, mark = (draw % 1000) / 1000, 0
    for party, share in zip(["rep", "ind", "dem"], p["pie"]):
        mark += share
        if spot < mark:
            break
    p["leader"] = {"name": f"{first[draw // 7 % len(first)]} {last[draw // 131 % len(last)]}", "party": party}
    del p["_a"], p["_e"]
seen = defaultdict(int)
for p in sorted(pops, key=lambda p: (p["piece"], RACES.index(p["race"]), p["age"], p["education"])):
    seen[p["piece"]] += 1
    p["id"] = f"{ST.lower()}.{SF}{CF}.{p['precinct'].split('-')[-1].lower()}.{(p['city'] or 'rural').lower().replace(' ', '_')}.{seen[p['piece']]}"

# ---- comparison with 2024, not used above
votes = json.load(open(RAW / f"nyt/results/{ST}.json"))
check = []
for pr in sorted({p["precinct"] for p in pops} | {k for k in votes if k.startswith(PREFIX)}):
    mine = [p for p in pops if p["precinct"] == pr]
    cast = sum(SIZE * p["turnout"] for p in mine)
    rep = sum(SIZE * p["turnout"] * p["lean"] for p in mine)
    d, r, t = votes.get(pr, [0, 0, 0])
    check.append({"precinct": pr, "pops": len(mine), "places": sorted({p["city"] or "outside any city" for p in mine}), "predicted_votes": round(cast),
                  "predicted_rep": round(rep / cast, 3) if cast else None, "actual_votes": t, "actual_rep": round(r / (d + r), 3) if d + r else None})
cast = sum(c["predicted_votes"] for c in check)
rep = sum(SIZE * p["turnout"] * p["lean"] for p in pops)
actual = [sum(votes[k][i] for k in votes if k.startswith(PREFIX)) for i in range(3)]
summary = {"name": f"{gpd.read_file(f'zip://{RAW}/geo/cb_county.zip', engine='pyogrio', read_geometry=False).query('STATEFP == @SF and COUNTYFP == @CF').NAMELSAD.iloc[0]}, {gpd.read_file(f'zip://{RAW}/geo/cb_state.zip', engine='pyogrio', read_geometry=False).query('STATEFP == @SF').NAME.iloc[0]}", "adults": round(float(M.sum())), "pops": len(pops), "pieces": int((np.array([seen[p] for p in pieces]) > 0).sum()), "pieces_without_a_pop": int(sum(1 for p in pieces if not seen[p])),
           "predicted": {"votes": cast, "rep": round(rep / cast, 3)}, "actual": {"votes": actual[2], "rep": round(actual[1] / (actual[0] + actual[1]), 3)}}
OUT.parent.mkdir(parents=True, exist_ok=True)
pops.sort(key=lambda p: p["id"])
OUT.write_text(json.dumps({"summary": summary, "pops": pops, "precincts": check}, separators=(",", ":")))
print(json.dumps(summary, indent=1))
kinds = defaultdict(int)
for p in pops:
    kinds[(p["race"], p["age"], p["education"])] += 1
for k, n in sorted(kinds.items(), key=lambda x: -x[1]):
    print(n, *k)
