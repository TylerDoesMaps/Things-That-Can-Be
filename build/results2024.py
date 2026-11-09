#!/usr/bin/env python3
"""Builds 2024 presidential results for states, counties and precincts.

votes.json holds [state, geoid, dem, rep, total] rows pulled from the NYT precinct file.
Usage: results2024.py VOTES_JSON FL_PRECINCT_CSV_GZ WORK_DIR DATA_DIR
"""
import gzip
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd

VOTES, FL, WORK, DATA = sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
OUT = DATA / "results"
OUT.mkdir(parents=True, exist_ok=True)

rows = json.loads(Path(VOTES).read_text())
counties = gpd.read_file(WORK / "county.geojson", engine="pyogrio")
known = set(counties.GEOID)

# Connecticut's file uses planning regions, so towns are placed in 2020 counties by location.
ct = gpd.read_file(WORK / "precinct_geo" / "CT.json", engine="pyogrio")
points = gpd.GeoDataFrame({"p": ct.p}, geometry=ct.geometry.representative_point(), crs=ct.crs)
placed = gpd.sjoin(points, counties[["GEOID", "geometry"]].to_crs(ct.crs), how="left", predicate="within")
ct_county = dict(zip(placed.p, placed.GEOID))

add = lambda bucket, d, r, t: [bucket[0] + d, bucket[1] + r, bucket[2] + t]
state_totals = defaultdict(lambda: [0, 0, 0])
county_totals = defaultdict(lambda: [0, 0, 0])
precincts = defaultdict(dict)
skipped = 0
for state, geoid, dem, rep, total in rows:
    dem, rep, total = dem or 0, rep or 0, total or 0
    fips = geoid[:5] if geoid[:5] in known else ct_county.get(geoid)
    if fips is None:
        skipped += 1
        continue
    state_totals[state] = add(state_totals[state], dem, rep, total)
    county_totals[fips] = add(county_totals[fips], dem, rep, total)
    precincts[state][geoid] = [dem, rep, total]

with gzip.open(FL, "rt", newline="") as f:
    precincts["FL"] = {row["p"]: [int(row["d"]), int(row["r"]), int(row["t"])] for row in csv.DictReader(f)}

national = [sum(v[i] for v in state_totals.values()) for i in range(3)]
(OUT / "national.json").write_text(json.dumps(
    {"us": national, "state": state_totals, "county": county_totals}, separators=(",", ":")))
for state, values in precincts.items():
    (OUT / f"{state}.json").write_text(json.dumps(values, separators=(",", ":")))
print("skipped", skipped, "states", len(state_totals), "counties", len(county_totals), "of", len(known))
print("us", national)
print("missing counties sample", sorted(known - set(county_totals))[:50])
