#!/usr/bin/env python3
"""Joins results to every map layer and writes the national presets.

Usage: layers.py RAW_DIR WORK_DIR REPO_DIR
"""
import csv
import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAW, WORK, REPO = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
GEO = WORK / "geo"
GEO.mkdir(parents=True, exist_ok=True)
PRE = REPO / "docs/presets"
(PRE / "results").mkdir(parents=True, exist_ok=True)
(PRE / "maps").mkdir(parents=True, exist_ok=True)
DATA = REPO / "docs/data"
DATA.mkdir(parents=True, exist_ok=True)
YEARS = ["2016", "2020", "2024"]


def cb(name, vintage=""):
    return gpd.read_file(f"zip://{RAW}/geo/cb{vintage}_{name}.zip", engine="pyogrio").to_crs(4326)


states = cb("state")
states = states[states.STATEFP.astype(int) <= 56]
ABBR = dict(zip(states.STATEFP, states.STUSPS))
alloc = {p.stem: json.loads(p.read_text()) for p in sorted((WORK / "alloc").glob("*.json"))}

# ---- county results, 2016 to 2024 (MIT Election Lab) ----
county_votes = json.loads((RAW / "nyt/results/county_years.json").read_text())
state_votes = json.loads((RAW / "nyt/results/state_years.json").read_text())
# The source lists Kansas City apart from Jackson County, Missouri. It belongs inside it.
kc = {"2016": [97735, 24654, 128601], "2020": [107660, 26393, 136645], "2024": [95660, 26225, 124288]}
for y in YEARS:
    county_votes["29095"][y] = [a + b for a, b in zip(county_votes["29095"][y], kc[y])]
# Alaska reports by election district, not borough, so it is one unit.
county_votes["02"] = state_votes["AK"]

state_totals = {}
for fips, v in county_votes.items():
    s = state_totals.setdefault(ABBR[fips[:2]], {y: [0, 0, 0] for y in YEARS})
    for y in YEARS:
        if y in v:
            s[y] = [a + b for a, b in zip(s[y], v[y])]


def year_props(v):
    out = {}
    for y in YEARS:
        if v and y in v:
            out[f"d{y[2:]}"], out[f"r{y[2:]}"], out[f"t{y[2:]}"] = v[y]
    return out


def write(gdf, name):
    gdf.to_file(GEO / f"{name}.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=5)
    print(name, len(gdf), flush=True)


# ---- states ----
rows = [dict(id=r.STUSPS, name=r.NAME, st=r.STUSPS, **year_props(state_totals.get(r.STUSPS))) for r in states.itertuples()]
write(gpd.GeoDataFrame(rows, geometry=states.geometry.values, crs=4326), "state")

# ---- counties: 2024 lines, Connecticut's eight counties, Alaska whole ----
c = cb("county")
c = c[(c.STATEFP.astype(int) <= 56) & ~c.STATEFP.isin(["02", "09"])]
ct = cb("county", "2020")
ct = ct[ct.STATEFP == "09"]
ak = states[states.STUSPS == "AK"]
frames = [
    pd.DataFrame({"id": c.GEOID, "name": c.NAMELSAD, "st": c.STUSPS, "geometry": c.geometry}),
    pd.DataFrame({"id": ct.GEOID, "name": ct.NAMELSAD, "st": "CT", "geometry": ct.geometry}),
    pd.DataFrame({"id": "02", "name": "Alaska", "st": "AK", "geometry": ak.geometry}),
]
counties = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=4326)
COUNTY_NAME = dict(zip(counties.id, counties.name))
props = pd.DataFrame([year_props(county_votes.get(i)) for i in counties.id]).astype("Int64")
write(pd.concat([counties, props], axis=1), "county")
print("counties without results", sorted(set(counties.id) - set(county_votes)), "results without county", sorted(set(county_votes) - set(counties.id)))

for y in YEARS:
    with open(PRE / f"results/us-president-{y}-county.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["fips", "county", "state", "dem", "rep", "total"])
        for r in counties.sort_values("id").itertuples():
            v = county_votes.get(r.id, {}).get(y)
            if v:
                w.writerow([r.id, r.name, r.st, *v])

# ---- layers filled from 2024 precincts ----
def allocated(layer):
    out = {}
    for a in alloc.values():
        for gid, v in a["layers"].get(layer, {}).items():
            d, r, t = v["vap"]
            out[gid] = dict(d24=round(d), r24=round(r), t24=round(t), cov=round(100 * v["in"]))
    return out


def tiger_ids(name, keep):
    ids = set()
    for fips in ABBR:
        path = RAW / f"tiger/{fips}_{name}.zip"
        if path.exists():
            d = gpd.read_file(f"zip://{path}", engine="pyogrio", read_geometry=False)
            ids |= set(d[keep(d)].GEOID)
    return ids


def district_layer(source, name, label, ids=None, extra=None):
    g = cb(source)
    g = g[g.STATEFP.isin(ABBR)]
    if ids is not None:
        g = g[g.GEOID.isin(ids)]
    g = g[~g.GEOID.str.endswith("ZZ")]
    votes = allocated(name)
    votes.update(extra or {})
    base = pd.DataFrame({"id": g.GEOID.values, "name": [label(r) for r in g.itertuples()],
                         "st": g.STATEFP.map(ABBR).values})
    p = pd.DataFrame([votes.get(i, {}) for i in base.id], columns=["d24", "r24", "t24", "cov"]).astype("Int64")
    out = gpd.GeoDataFrame(pd.concat([base, p], axis=1), geometry=g.geometry.values, crs=4326)
    write(out, name)
    out.drop(columns="geometry").rename(columns={"d24": "dem", "r24": "rep", "t24": "total", "cov": "pct_covered"}).to_csv(
        DATA / f"president-2024-{name}.csv", index=False)
    return out


# Alaska has no precinct file. Its 40 house districts are reported directly; senate districts are pairs of them.
ak_house, ak_senate = {}, {}
t = pd.read_csv(RAW / "res/2024.csv", dtype={"county_fips": str})
for r in t[t.state_name == "Alaska"].itertuples():
    n = int(r.county_fips[2:])
    v = [int(r.votes_dem), int(r.votes_gop), int(r.total_votes)]
    ak_house[f"02{n:03d}"] = dict(d24=v[0], r24=v[1], t24=v[2], cov=100)
    s = ak_senate.setdefault("0200" + "ABCDEFGHIJKLMNOPQRST"[(n - 1) // 2], dict(d24=0, r24=0, t24=0, cov=100))
    for k, x in zip(["d24", "r24", "t24"], v):
        s[k] += x
ak_cd = {"0200": dict(zip(["d24", "r24", "t24"], state_votes["AK"]["2024"]), cov=100)}

cities = tiger_ids("place", lambda d: ~d.CLASSFP.str[0].isin(["U", "M"]))
towns = tiger_ids("cousub", lambda d: d.CLASSFP.str.startswith("T") & (d.FUNCSTAT == "A") & d.STATEFP.map(ABBR).isin(
    "CT IL IN KS ME MA MI MN MO NE NH NJ NY ND OH PA RI SD VT WI".split()))
district_layer("place", "city", lambda r: r.NAME, cities)
district_layer("cousub", "township", lambda r: f"{r.NAMELSAD}, {r.NAMELSADCO}", towns)
district_layer("cd119", "cd", lambda r: f"{ABBR[r.STATEFP]}-{'AL' if r.CD119FP in ('00', '98') else int(r.CD119FP)}", extra=ak_cd)
district_layer("sldu", "sldu", lambda r: r.NAMELSAD, extra=ak_senate)
district_layer("sldl", "sldl", lambda r: r.NAMELSAD, extra=ak_house)

# ---- precincts ----
(GEO / "precinct").mkdir(exist_ok=True)
n = 0
for st in alloc:
    g = gpd.read_file(WORK / f"pgeo/{st}.geojson", engine="pyogrio")[["p", "geometry"]]
    votes = json.loads((RAW / f"nyt/results/{st}.json").read_text())
    if st == "FL":
        g["name"] = g.p.str.split("-:-").str[1]
        g["c"] = g.p.str.split("-:-").str[0] + " County"
    else:
        g["name"] = g.p.str.split("-", n=1).str[1]
        g["c"] = g.p.str[:5].map(COUNTY_NAME).fillna("")
    g["st"] = st
    v = pd.DataFrame([[x or 0 for x in votes.get(p, [None] * 3)] if p in votes else [None] * 3 for p in g.p],
                     columns=["d24", "r24", "t24"]).astype("Int64")
    g = pd.concat([g.rename(columns={"p": "id"}), v], axis=1)
    g.to_file(GEO / f"precinct/{st}.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=5)
    n += len(g)
print("precinct", n)

(DATA / "states.json").write_text(json.dumps(state_totals, separators=(",", ":")))
