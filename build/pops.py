#!/usr/bin/env python3
"""Builds the pops for one county: groups of 100 citizens of voting age who share race, age and education and live in one neighbourhood.

Needs WORK_DIR/neighbourhoods/<county>.csv from neighbourhoods.py. Prisoners and non-citizens are taken out before
pops are formed and appear nowhere in the output. Every working-age pop gets a main line of work; pops of 65 and over
are Retired; pops in college housing are Students. Partisanship here is worked out from what each pop is, with no
election result used. calibrate.py then fits it to the real vote.
Usage: pops.py RAW_DIR WORK_DIR STATE_ABBR STATE_FIPS COUNTY_FIPS PRECINCT_PREFIX OUT_JSON
"""
import io
import json
import math
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAW, WORK, ST, SF, CF, PREFIX, OUT = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], Path(sys.argv[7])
SIZE = 100
RACES = ["White", "Black", "Hispanic", "Asian", "Other"]
AGES = ["18 to 29", "30 to 44", "45 to 64", "65 and over"]
EDUS = ["No college", "Some college", "Bachelor's or more"]
INCOMES = ["Under $35,000", "$35,000 to $75,000", "$75,000 to $150,000", "Over $150,000"]
WORK_LINES = ["Farm and ranch", "Oil, gas and mining", "Factory and plant", "Building and transport", "Shops and service",
              "Office and professional", "Schools and health", "Government and military"]
INDUSTRY_CELLS = {0: [4], 1: [5], 2: [7], 3: [6, 8, 10], 4: [9, 24, 27], 5: [13, 14, 17], 6: [21], 7: [28]}
CVAP_LINES = {"White": "White Alone", "Black": "Black or African American Alone", "Asian": "Asian Alone", "Hispanic": "Hispanic or Latino", "Other": "Total"}

# ---- how a pop's politics follow from what it is ----
# Republican share of the two-party vote by race and education. Anchored on Pew's validated voters for 2024
# (White 55, Black 15, Hispanic 48, Asian 40; college graduates 41, no degree 56). The split inside each race is derived.
LEAN = {"White": [0.64, 0.60, 0.45], "Black": [0.15, 0.15, 0.14], "Hispanic": [0.51, 0.48, 0.42], "Asian": [0.44, 0.40, 0.37], "Other": [0.55, 0.50, 0.43]}
# Nudges on top of that, in log-odds. Age follows Pew (under 50 about 46, 50 and over 54). Area follows Pew (urban 33,
# suburban 47, rural 69) at half strength, since race and education already explain part of it. Income, work and
# housing have no source yet and are small on purpose.
AGE_NUDGE = [-0.20, -0.10, 0.12, 0.10]
AREA_NUDGE = {"urban": -0.30, "suburban": 0.0, "small town": 0.25, "rural": 0.45}
INCOME_NUDGE = [-0.05, 0.0, 0.05, 0.0]
WORK_NUDGE = {"Farm and ranch": 0.25, "Oil, gas and mining": 0.25, "Factory and plant": 0.10, "Building and transport": 0.15, "Shops and service": 0.0,
              "Office and professional": -0.05, "Schools and health": -0.20, "Government and military": -0.05, "Retired": 0.0, "Student": -0.25}
OWNER_NUDGE = 0.3  # times (share of owners - 0.65)
# Share calling themselves independent, by age, less 0.03 for a degree. No source yet.
INDEPENDENT = [0.40, 0.36, 0.30, 0.24]
# Chance of voting in a presidential election by age and education. No source yet; calibrate.py fits the level.
TURNOUT = [[0.38, 0.52, 0.68], [0.48, 0.62, 0.76], [0.58, 0.70, 0.82], [0.64, 0.76, 0.85]]


def acs(table, geo):
    d = pd.read_csv(RAW / f"acs/{ST.lower()}/{table}.dat", sep="|", dtype=str).set_index("GEO_ID")
    row = d.loc[geo]
    return lambda n: float(row[f"{table.upper()}_E{n:03d}"] or 0)


def both(get, cells, step):
    return sum(get(c) + get(c + step) for c in cells)


# ---- blocks: adults by race, prisoners out, college housing counted
with zipfile.ZipFile(RAW / f"pl/{ST.lower()}.zip") as z:
    geo = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}geo2020.pl")), sep="|", header=None, dtype=str, usecols=[2, 7, 9], encoding="latin-1", keep_default_na=False)
    geo.columns = ["sumlev", "rec", "block"]
    geo = geo[(geo.sumlev == "750") & geo.block.str.startswith(SF + CF)]
    s2 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000022020.pl")), sep="|", header=None, dtype=str, usecols=[4, 76, 77, 80, 81, 83])
    s2.columns = ["rec", "adults", "Hispanic", "White", "Black", "Asian"]
    s3 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000032020.pl")), sep="|", header=None, dtype=str, usecols=[4, 7, 12])
    s3.columns = ["rec", "prison", "college"]
j = geo.merge(s2, on="rec").merge(s3, on="rec")
for c in ["adults", "Hispanic", "White", "Black", "Asian", "prison", "college"]:
    j[c] = j[c].astype(float)
j["Other"] = j.adults - j[["Hispanic", "White", "Black", "Asian"]].sum(axis=1)
keep = ((j.adults - j.prison).clip(lower=0) / j.adults.where(j.adults > 0, 1)).fillna(0)
for r in RACES:
    j[r] *= keep
j["tract"], j["bg"] = j.block.str[:11], j.block.str[:12]
hood = pd.read_csv(WORK / f"neighbourhoods/{SF}{CF}.csv", dtype=str).set_index("block")
j["hood"], j["area"] = j.block.map(hood.code), j.block.map(hood["area"])

# ---- non-citizens out. How many: the tract's adults who are not citizens (ACS). Which race they come from:
# wherever the Census's count of citizens of voting age by race falls short of the adults counted there.
# (The citizen file has no count of adults to set against, and is too thin by block group to use alone.)
cvap = pd.read_csv(RAW / f"cvap/{ST.lower()}-tract.csv", dtype=str, encoding="latin-1")
cvap = cvap[cvap.geoid.str[9:14] == SF + CF].assign(tract=lambda d: d.geoid.str[9:], n=lambda d: d.cvap_est.astype(float))
cit = pd.DataFrame({r: cvap[cvap.lntitle == line].set_index("tract").n for r, line in CVAP_LINES.items()})
cit["Other"] = (cit.Other - cit[RACES[:4]].sum(axis=1)).clip(lower=0)
for t, g in j.groupby("tract"):
    get = acs("b05003", "1400000US" + t)
    adults, out = get(8) + get(19), get(12) + get(23)
    if not adults or not out:
        continue
    have = g[RACES].sum()
    gap = (have - cit.loc[t]).clip(lower=0) if t in cit.index else have * 0
    gap["White"], gap["Black"] = gap["White"] * 0.25, gap["Black"] * 0.25
    if gap.sum() <= 0:
        gap = have * pd.Series({"White": 0.05, "Black": 0.05, "Hispanic": 1, "Asian": 1, "Other": 0.5})
    remove = (gap / gap.sum() * out / adults * have.sum()).clip(upper=have * 0.9)
    for r in RACES:
        if have[r]:
            j.loc[g.index, r] *= 1 - remove[r] / have[r]
j["citizens"] = j[RACES].sum(axis=1)

# ---- precincts, only to bring the real 2024 vote down to neighbourhoods later
with zipfile.ZipFile(RAW / f"pl/{ST.lower()}.zip") as z:
    where = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}geo2020.pl")), sep="|", header=None, dtype=str, usecols=[2, 9, 92, 93], encoding="latin-1", keep_default_na=False)
where = where[where[2] == "750"].set_index(9)
pts = gpd.GeoDataFrame(j[["block"]], geometry=gpd.points_from_xy(j.block.map(where[93]).astype(float), j.block.map(where[92]).astype(float)), crs=4269)
prec = gpd.read_file(WORK / f"pgeo/{ST}.geojson", engine="pyogrio").to_crs(4269)
prec = prec[prec.p.str.startswith(PREFIX)]
got = gpd.sjoin(pts, prec[["p", "geometry"]], how="left", predicate="within")
got = got[~got.index.duplicated()]
if got.p.isna().any():
    miss = got.p.isna()
    near = gpd.sjoin_nearest(pts[miss.values].to_crs(5070), prec[["p", "geometry"]].to_crs(5070), how="left")
    got.loc[miss, "p"] = near[~near.index.duplicated()].p
j["p"] = got.p.values

# ---- age and education inside each tract, for each race
AGE_CELLS = {"all": [[7, 8, 9, 10, 11], [12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24, 25]], "race": [[7, 8, 9], [10, 11], [12, 13], [14, 15, 16]]}
county = "0500000US" + SF + CF
tilt = {}
for r, table in (("White", "c15002h"), ("Hispanic", "c15002i")):
    g = acs(table, county)
    total, ba = g(2) + g(7), g(6) + g(11)
    tilt[r] = ba / total if total else None
ga = acs("b15001", county)
overall = both(ga, [9, 10, 17, 18, 25, 26, 33, 34, 41, 42], 41) / (ga(2) + ga(43))
tracts = sorted(j.tract.unique())
share = {}
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
    raw = [np.array([both(g, [s + 1, s + 2, s + 3], 41), both(g, [s + 4, s + 5], 41), both(g, [s + 6, s + 7], 41)]) for s in (3, 11, 19, 27, 35)]
    edu = [raw[0] + raw[1] / 2, raw[1] / 2 + raw[2], raw[3], raw[4]]
    edu = [e / e.sum() if e.sum() else np.array([0.5, 0.3, 0.2]) for e in edu]
    share[t] = {}
    for r in RACES:
        share[t][r] = []
        for a in range(4):
            e = edu[a].copy()
            if tilt.get(r) and 0 < overall < 1 and 0 < tilt[r] < 1:
                e[2] *= (tilt[r] / (1 - tilt[r])) / (overall / (1 - overall))
                e /= e.sum()
            share[t][r].append(age[r][a] * e)

# ---- expected citizens of each kind in each neighbourhood, then whole pops
expected, meta = defaultdict(lambda: np.zeros(60)), {}
for code, g in j.groupby("hood"):
    for t, gt in g.groupby("tract"):
        for ri, r in enumerate(RACES):
            n = gt[r].sum()
            for a in range(4):
                expected[code][ri * 12 + a * 3: ri * 12 + a * 3 + 3] += n * share[t][r][a]
    meta[code] = {"tract": g.groupby("tract").citizens.sum().idxmax(), "college": float(g.college.sum()), "area": g.area.iloc[0]}
hoods = sorted(expected)
M = np.array([expected[h] for h in hoods])
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
    pops.append({"hood": hoods[i], "race": RACES[k // 12], "age": AGES[k % 12 // 3], "education": EDUS[k % 3], "area": meta[hoods[i]]["area"], "_a": k % 12 // 3, "_e": k % 3})

# ---- carried attributes: income, owners, work
by_tract = defaultdict(list)
for p in pops:
    by_tract[meta[p["hood"]]["tract"]].append(p)
students_left = {h: round(m["college"] / SIZE) for h, m in meta.items()}
for t, group in by_tract.items():
    geo_id = "1400000US" + t
    g = acs("b19001", geo_id)
    bands = np.array([sum(g(c) for c in cs) for cs in ([2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12], [13, 14, 15], [16, 17])])
    cut = np.cumsum(bands / bands.sum()) if bands.sum() else np.array([0.3, 0.65, 0.9, 1.0])
    order = sorted(group, key=lambda p: (p["_e"] * 2 + [0, 1.5, 2, 0.5][p["_a"]], p["hood"]))
    for n, p in enumerate(order):
        p["income"] = INCOMES[min(3, int(np.searchsorted(cut, (n + 0.5) / len(order))))]
    g = acs("b25003", geo_id)
    own = g(2) / g(1) if g(1) else 0.65
    for p in group:
        p["owners"] = round(min(0.97, own * [0.5, 0.9, 1.1, 1.15][p["_a"]]), 2)
        if p["_a"] == 3:
            p["work"] = "Retired"
    for p in sorted(group, key=lambda p: (p["_e"] != 1, p["hood"])):
        if p["_a"] == 0 and students_left.get(p["hood"], 0) > 0:
            students_left[p["hood"]] -= 1
            p["work"] = "Student"
    g = acs("c24030", geo_id)
    jobs = np.array([both(g, cells, 27) for cells in INDUSTRY_CELLS.values()])
    jobs[7] += acs("b23025", geo_id)(6)
    todo = [p for p in group if "work" not in p]
    want = jobs / jobs.sum() * len(todo) if jobs.sum() else np.full(8, len(todo) / 8)
    for p in sorted(todo, key=lambda p: (-p["_e"], p["hood"])):
        lean = np.array([[1.3, 1.3, 1.5, 1.5, 1.3, 0.5, 0.6, 0.8], [1, 1, 1, 1, 1, 1, 1, 1], [0.6, 0.7, 0.5, 0.5, 0.6, 2.5, 2.5, 1.6]][p["_e"]])
        if p["area"] == "rural":
            lean[0] *= 2
        k = int(np.argmax(np.maximum(want, 0.01) * lean))
        want[k] -= 1
        p["work"] = WORK_LINES[k]

# ---- a few words for what sets each pop apart from the county
common = {key: Counter(p[key] for p in pops).most_common(1)[0][0] for key in ("race", "age", "education", "income", "work", "area")}
WORDS = {"18 to 29": "young", "30 to 44": "", "45 to 64": "middle-aged", "65 and over": "older", "No college": "", "Some college": "", "Bachelor's or more": "college-educated",
         "Under $35,000": "lower-income", "Over $150,000": "well-off", "urban": "in the city", "suburban": "suburban", "small town": "in town", "rural": "rural"}
for p in pops:
    words = [WORDS.get(p["age"], "") if p["age"] != common["age"] or p["age"] in ("18 to 29", "65 and over") else "", p["race"] if p["race"] != common["race"] else "",
             WORDS.get(p["education"], ""), WORDS.get(p["income"], ""), "renters" if p["owners"] < 0.5 else "", p["work"].lower() if p["work"] != common["work"] else "",
             WORDS.get(p["area"], "") if p["area"] != common["area"] else ""]
    p["words"] = [w for w in words if w][:6]


# ---- politics from what the pop is
def logit(x):
    return math.log(x / (1 - x))


for p in pops:
    odds = (logit(LEAN[p["race"]][p["_e"]]) + AGE_NUDGE[p["_a"]] + AREA_NUDGE[p["area"]] + INCOME_NUDGE[INCOMES.index(p["income"])]
            + WORK_NUDGE[p["work"]] + OWNER_NUDGE * (p["owners"] - 0.65))
    p["inherent"] = round(1 / (1 + math.exp(-odds)), 3)
    p["independent"] = round(INDEPENDENT[p["_a"]] - (0.03 if p["_e"] == 2 else 0), 3)
    p["inherent_turnout"] = TURNOUT[p["_a"]][p["_e"]]
    money = INCOMES.index(p["income"]) / 3 * 60 + p["_a"] * 6 + p["_e"] * 8
    p["wealth"] = round(max(0, money - 35) / 63 * 100)
    del p["_a"], p["_e"]
seen = defaultdict(int)
for p in sorted(pops, key=lambda p: (p["hood"], RACES.index(p["race"]), p["age"], p["education"])):
    seen[p["hood"]] += 1
    p["id"] = f"{p['hood'].lower()}.{seen[p['hood']]}"
pops.sort(key=lambda p: (p["hood"], int(p["id"].split(".")[-1])))

# ---- the real 2024 vote, brought down from precincts to neighbourhoods by citizens
votes = json.load(open(RAW / f"nyt/results/{ST}.json"))
weight = (j.citizens / j.groupby("p").citizens.transform("sum")).fillna(0)
real = {name: (weight * j.p.map(lambda k: votes.get(k, [0, 0, 0])[i])).groupby(j.hood).sum() for i, name in enumerate(["dem", "rep", "all"])}
places = [{"hood": h, "pops": seen[h], "area": meta[h]["area"], "dem2024": round(real["dem"][h]), "rep2024": round(real["rep"][h]), "votes2024": round(real["all"][h])} for h in hoods]
name = gpd.read_file(f"zip://{RAW}/geo/cb_county.zip", engine="pyogrio", read_geometry=False).query("STATEFP == @SF and COUNTYFP == @CF").NAMELSAD.iloc[0]
state = gpd.read_file(f"zip://{RAW}/geo/cb_state.zip", engine="pyogrio", read_geometry=False).query("STATEFP == @SF").NAME.iloc[0]
summary = {"name": f"{name}, {state}", "fips": SF + CF, "pops": len(pops), "people": len(pops) * SIZE, "neighbourhoods": len(hoods)}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"summary": summary, "pops": pops, "neighbourhoods": places}, separators=(",", ":")))
print(summary, dict(Counter(p["work"] for p in pops).most_common()))
