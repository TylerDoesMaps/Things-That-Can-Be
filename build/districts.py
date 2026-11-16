#!/usr/bin/env python3
"""Draws districts from neighbourhoods: contiguous, compact, roughly equal in pops, and as competitive as it can manage.

Works on any set of neighbourhoods. Each trial grows districts outward from random seeds, then moves border
neighbourhoods between districts while that lowers the cost. The best of all trials is kept.
Cost = EQUAL x worst gap from the ideal size + COMPACT x (1 - average roundness) + CLOSE x average distance from 50-50.
Roundness is 4 pi area / perimeter squared. The 2024 vote by neighbourhood comes from the pops file.
Usage: districts.py NEIGHBOURHOODS_JSON POPS_JSON HOW_MANY NAME OUT_JSON [TRIALS]
"""
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd

SRC, POPS, N, NAME, OUT = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), sys.argv[4], Path(sys.argv[5])
TRIALS = int(sys.argv[6]) if len(sys.argv) > 6 else 4000
EQUAL, COMPACT, CLOSE = 3.0, 1.0, 2.0

shapes = gpd.GeoDataFrame.from_features(json.load(open(SRC))["options"]["C"]["shapes"], crs=4269).set_index("code")
flat = shapes.to_crs(5070).geometry
pops_file = json.load(open(POPS))
size = defaultdict(int)
for p in pops_file["pops"]:
    size[p["precinct"]] += 1
vote = {c["precinct"]: (c["actual_votes"] * (c["actual_rep"] or 0.5), c["actual_votes"] * (1 - (c["actual_rep"] or 0.5))) for c in pops_file["precincts"]}
units = list(shapes.index)
area, edge = flat.area.to_dict(), flat.length.to_dict()
shared = defaultdict(dict)
for i, a in enumerate(units):
    for b in units[i + 1:]:
        if flat[a].intersects(flat[b]):
            length = flat[a].boundary.intersection(flat[b].boundary).length
            if length > 50:
                shared[a][b] = shared[b][a] = length
ideal = sum(size[u] for u in units) / N


def connected(members):
    members = set(members)
    if not members:
        return False
    seen, todo = set(), [next(iter(members))]
    while todo:
        u = todo.pop()
        if u in seen:
            continue
        seen.add(u)
        todo += [v for v in shared[u] if v in members and v not in seen]
    return seen == members


def measure(plan):
    groups = defaultdict(list)
    for u, d in plan.items():
        groups[d].append(u)
    rows = []
    for d, members in sorted(groups.items()):
        inner = sum(shared[a].get(b, 0) for a in members for b in members if a < b)
        perimeter = sum(edge[u] for u in members) - 2 * inner
        rep, dem = sum(vote[u][0] for u in members), sum(vote[u][1] for u in members)
        rows.append({"district": d + 1, "neighbourhoods": sorted(members), "pops": sum(size[u] for u in members),
                     "roundness": 4 * math.pi * sum(area[u] for u in members) / perimeter ** 2, "rep": rep / (rep + dem) if rep + dem else 0.5})
    return rows


def cost(plan):
    rows = measure(plan)
    if len(rows) < N:
        return 99
    gap = max(abs(r["pops"] - ideal) / ideal for r in rows)
    return EQUAL * gap + COMPACT * (1 - sum(r["roundness"] for r in rows) / N) + CLOSE * sum(abs(r["rep"] - 0.5) for r in rows) / N


def grow(rng):
    plan = {u: d for d, u in enumerate(rng.sample(units, N))}
    while len(plan) < len(units):
        totals = defaultdict(int)
        for u, d in plan.items():
            totals[d] += size[u]
        for d in sorted(range(N), key=lambda d: totals[d]):
            edge_units = {v for u, x in plan.items() if x == d for v in shared[u] if v not in plan}
            if edge_units:
                plan[rng.choice(sorted(edge_units))] = d
                break
        else:
            return None
    return plan


def improve(plan, rng):
    best = cost(plan)
    changed = True
    while changed:
        changed = False
        for u in rng.sample(units, len(units)):
            here = plan[u]
            rest = [v for v in units if plan[v] == here and v != u]
            if not rest or not connected(rest):
                continue
            for there in sorted({plan[v] for v in shared[u]} - {here}):
                plan[u] = there
                now = cost(plan)
                if now < best - 1e-9:
                    best, changed = now, True
                    break
                plan[u] = here
    return best


rng = random.Random(len(units) * 1000 + N)
best_plan, best_cost = None, 99
for _ in range(TRIALS):
    plan = grow(rng)
    if plan is None:
        continue
    c = improve(plan, rng)
    if c < best_cost:
        best_plan, best_cost = dict(plan), c
rows = measure(best_plan)
order = sorted(rows, key=lambda r: (-flat[r["neighbourhoods"]].union_all().centroid.y, flat[r["neighbourhoods"]].union_all().centroid.x))
renumber = {r["district"] - 1: i for i, r in enumerate(order)}
best_plan = {u: renumber[d] for u, d in best_plan.items()}
rows = measure(best_plan)
drawn = shapes.assign(district=[best_plan[u] + 1 for u in shapes.index]).dissolve("district")
features = []
for r in rows:
    r.update(roundness=round(r["roundness"], 2), rep=round(r["rep"], 3), people=r["pops"] * 100)
    features.append({"type": "Feature", "properties": {"code": f"District {r['district']}", "pops": r["pops"], "rep": r["rep"], "precinct": ", ".join(r["neighbourhoods"])},
                     "geometry": json.loads(gpd.GeoSeries([drawn.geometry[r["district"]]]).to_json())["features"][0]["geometry"]})
out = {"name": NAME, "districts": rows, "ideal": round(ideal, 1), "weights": {"equal": EQUAL, "compact": COMPACT, "close": CLOSE}, "trials": TRIALS,
       "assignment": {u: d + 1 for u, d in best_plan.items()}, "shapes": {"type": "FeatureCollection", "features": features}}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, separators=(",", ":")))
print("ideal", round(ideal, 1), "cost", round(best_cost, 3))
for r in rows:
    print(r)
