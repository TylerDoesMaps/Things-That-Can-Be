#!/usr/bin/env python3
"""Turns real district lines, given as a list of census blocks and the district each is in, into districts made of neighbourhoods.

Each neighbourhood goes to the district most of its people are in. Writes the same file the drawing tool writes, and
says how many people ended up on the wrong side because their neighbourhood straddles a real line.
Usage: districts_from_blocks.py NEIGHBOURHOODS_JSON POPS_JSON BLOCKS_TO_NEIGHBOURHOODS_CSV BLOCKS_TO_DISTRICTS_CSV NAME SOURCE OUT_JSON
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd

SRC, POPS, HOODS, REAL, NAME, SOURCE, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5], sys.argv[6], Path(sys.argv[7])
src = json.load(open(SRC))
shapes = gpd.GeoDataFrame.from_features(src["shapes"], crs=4269).set_index("code")
measures = src["measures"]
pops_file = json.load(open(POPS))
size = defaultdict(int)
for p in pops_file["pops"]:
    size[p["hood"]] += 1
vote = {c["hood"]: (c["rep2024"], c["dem2024"]) for c in pops_file["neighbourhoods"]}
t = pd.read_csv(HOODS, dtype=str).merge(pd.read_csv(REAL, dtype=str), on="block")
t["people"] = t.adults.astype(float)
by = t.groupby(["code", "district"]).people.sum().unstack(fill_value=0)
plan = by.idxmax(axis=1).astype(int).to_dict()
wrong = 1 - by.max(axis=1).sum() / by.values.sum()
rows = []
for d in sorted(set(plan.values())):
    members = sorted(u for u in plan if plan[u] == d)
    inner = sum(measures[a]["borders"].get(b, 0) for a in members for b in members if a < b)
    perimeter = sum(measures[u]["edge_m"] for u in members) - 2 * inner
    rep, dem = sum(vote[u][0] for u in members), sum(vote[u][1] for u in members)
    rows.append({"district": d, "neighbourhoods": members, "pops": sum(size[u] for u in members), "perimeter": round(perimeter / 1609.34, 1),
                 "roundness": round(4 * math.pi * sum(measures[u]["sq_m"] for u in members) / perimeter ** 2, 2), "rep": round(rep / (rep + dem), 3), "people": sum(size[u] for u in members) * 100})
drawn = shapes.assign(district=[plan[u] for u in shapes.index]).dissolve("district")
features = [{"type": "Feature", "properties": {"code": f"District {r['district']}", "pops": r["pops"], "rep": r["rep"], "precinct": ", ".join(r["neighbourhoods"])},
             "geometry": json.loads(gpd.GeoSeries([drawn.geometry[r["district"]]]).to_json())["features"][0]["geometry"]} for r in rows]
OUT.write_text(json.dumps({"name": NAME, "source": SOURCE, "wrong_side": round(wrong, 3), "districts": rows, "ideal": round(sum(size.values()) / len(rows), 1),
                           "assignment": plan, "shapes": {"type": "FeatureCollection", "features": features}}, separators=(",", ":")))
print(NAME, "people on the wrong side of a real line:", f"{wrong:.1%}")
for r in rows:
    print(r["district"], len(r["neighbourhoods"]), r["pops"], r["rep"], r["roundness"])
