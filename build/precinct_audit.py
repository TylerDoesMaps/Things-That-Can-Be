#!/usr/bin/env python3
"""Measures how 2024 precincts sit against counties, cities and townships.

Pieces under 3% of a precinct's area are treated as boundary noise.
Usage: precinct_audit.py WORK_DIR DATA_DIR
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

WORK, DATA = Path(sys.argv[1]), Path(sys.argv[2])
THRESHOLD = 0.03
CRS = 5070

county_ids = {f["properties"]["GEOID"] for f in json.loads((WORK / "county.geojson").read_text())["features"]}
cities = gpd.read_file(WORK / "city.geojson", engine="pyogrio").to_crs(CRS)
towns = gpd.read_file(WORK / "township.geojson", engine="pyogrio").to_crs(CRS)


def shares(pre, polys):
    """Returns precinct index -> list of (poly id, area share) at or above the threshold."""
    if polys.empty:
        return {}
    hits = gpd.sjoin(pre[["p", "geometry"]], polys[["GEOID", "geometry"]], how="inner", predicate="intersects")
    pairs = hits[["p", "GEOID"]].copy()
    geoms = polys.set_index("GEOID").geometry
    own = pre.set_index("p").geometry
    left = gpd.GeoSeries(own.reindex(pairs.p).values, crs=CRS)
    right = gpd.GeoSeries(geoms.reindex(pairs.GEOID).values, crs=CRS)
    pairs["share"] = left.intersection(right, align=False).area.values / left.area.values
    pairs = pairs[pairs.share >= THRESHOLD]
    return {k: g[["GEOID", "share"]].values.tolist() for k, g in pairs.groupby("p")}


def audit_state(path, st):
    pre = gpd.read_file(path, engine="pyogrio")
    pre = pre[pre.geometry.notna() & ~pre.geometry.is_empty].to_crs(CRS)
    pre["geometry"] = pre.geometry.buffer(0)
    pre = pre[pre.area > 0].drop_duplicates("p")
    city_share = shares(pre, cities[cities.ST == st])
    town_share = shares(pre, towns[towns.ST == st])

    cross_muni = 0
    in_one_city = 0
    pieces = 0
    unknown_county = 0
    for pid in pre.p:
        if pid[:5] not in county_ids:
            unknown_county += 1
        c = city_share.get(pid, [])
        t = town_share.get(pid, [])
        city_cover = sum(s for _, s in c)
        units = len(c) + (1 if city_cover < 1 - THRESHOLD else 0)
        if len(t) > 1:
            units = max(units, len(t))
        pieces += units
        if units > 1:
            cross_muni += 1
        if len(c) == 1 and units == 1:
            in_one_city += 1
    return {
        "state": st,
        "precincts": len(pre),
        "official": int(pre.off.astype(int).sum()),
        "unknown_county": unknown_county,
        "cross_muni": cross_muni,
        "in_one_city": in_one_city,
        "pieces": pieces,
    }


rows = []
for path in sorted((WORK / "precinct_geo").glob("*.json")):
    st = path.stem.split("-")[-1]
    row = audit_state(path, st)
    rows.append(row)
    print(row, flush=True)

totals = {k: sum(r[k] for r in rows) for k in rows[0] if k != "state"}
(DATA / "precincts2024.json").write_text(json.dumps({"national": totals, "states": rows}, indent=0))
print(json.dumps(totals, indent=1))
