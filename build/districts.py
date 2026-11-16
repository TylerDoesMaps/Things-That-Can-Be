#!/usr/bin/env python3
"""Draws districts from neighbourhoods: contiguous, compact, roughly equal in pops, and as competitive as it can manage.

Works on any set of neighbourhoods. Each trial grows districts outward from random seeds, then moves border
neighbourhoods between districts while that lowers the cost. The best of all trials is kept.
Cost = EQUAL x gap from the ideal size + COMPACT x length of the borders between districts + CLOSE x average distance from 50-50.
The border length is the districts' collective perimeter less the county's own outline, set against what a tidy grid would need. The 2024 vote by neighbourhood comes from the pops file.
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
TRIALS = int(sys.argv[6]) if len(sys.argv) > 6 else 0
EQUAL, COMPACT, CLOSE, TOUCH = 3.0, 3.0, 1.0, 200  # TOUCH: metres of shared border before two neighbourhoods count as touching

shapes = gpd.GeoDataFrame.from_features(json.load(open(SRC))["shapes"], crs=4269).set_index("code")
shapes["geometry"] = shapes.geometry.buffer(0)
flat = shapes.to_crs(5070).geometry.buffer(0)
pops_file = json.load(open(POPS))
size = defaultdict(int)
for p in pops_file["pops"]:
    size[p["hood"]] += 1
vote = {c["hood"]: (c["rep2024"], c["dem2024"]) for c in pops_file["neighbourhoods"]}
units = list(shapes.index)
measures = json.load(open(SRC))["measures"]  # true sizes and shared borders, from before the shapes were simplified
area, edge = {u: measures[u]["sq_m"] for u in units}, {u: measures[u]["edge_m"] for u in units}
shared = defaultdict(dict)
for u in units:
    for v, length in measures[u]["borders"].items():
        if length > TOUCH:
            shared[u][v] = length
# islands and anything else cut off: tie each stray group to its nearest neighbourhood, so every district can be reached
centre = {u: (flat[u].centroid.x, flat[u].centroid.y) for u in units}
while True:
    seen, todo = set(), [units[0]]
    while todo:
        u = todo.pop()
        if u not in seen:
            seen.add(u)
            todo += [v for v in shared[u] if v not in seen]
    if len(seen) == len(units):
        break
    rest = [u for u in units if u not in seen]
    _, a, b = min((math.dist(centre[u], centre[v]), u, v) for u in rest for v in seen)
    shared[a][b] = shared[b][a] = 1.0
outline = sum(edge.values()) - sum(v for u in units for v in measures[u]["borders"].values())
tidy = 2 * math.sqrt(sum(area.values())) * (math.sqrt(N) - 1)  # border length if the county were a square cut into a grid
ideal = sum(size[u] for u in units) / N
sizes = sorted(size[u] for u in units)
slack = max(0.05, 1.5 * sizes[len(sizes) // 2] / ideal)  # how uneven districts may be: 5 percent, or more where neighbourhoods are big next to a district
TRIALS = TRIALS or max(12, min(3000, 40000 // len(units)))  # fewer tries for counties with many neighbourhoods


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
                     "roundness": 4 * math.pi * sum(area[u] for u in members) / perimeter ** 2, "perimeter": perimeter, "rep": rep / (rep + dem) if rep + dem else 0.5})
    return rows


def tally(plan):
    """Running totals for each district, so a single move can be scored without measuring everything again."""
    t = [{"pops": 0, "edge": 0.0, "inner": 0.0, "rep": 0.0, "dem": 0.0, "n": 0} for _ in range(N)]
    for u, d in plan.items():
        shift(t, plan, u, d, 1, placed=False)
    for u, d in plan.items():
        t[d]["inner"] += sum(length for v, length in shared[u].items() if plan.get(v) == d) / 2
    return t


def shift(t, plan, u, d, sign, placed=True):
    x = t[d]
    x["pops"] += sign * size[u]
    x["edge"] += sign * edge[u]
    x["rep"] += sign * vote[u][0]
    x["dem"] += sign * vote[u][1]
    x["n"] += sign
    if placed:
        x["inner"] += sign * sum(length for v, length in shared[u].items() if v != u and plan.get(v) == d)


def score(t):
    if any(x["n"] == 0 for x in t):
        return 99
    gaps = [abs(x["pops"] - ideal) / ideal for x in t]
    gap = (max(gaps) + math.sqrt(sum(g * g for g in gaps) / N)) / 2  # the worst district and the typical one, so every evening-out move counts
    gap += 10 * max(0, max(gaps) - slack)  # past the slack, evening out comes before everything else
    between = (sum(x["edge"] - 2 * x["inner"] for x in t) - outline) / 2
    close = sum(abs(x["rep"] / (x["rep"] + x["dem"]) - 0.5) if x["rep"] + x["dem"] else 0 for x in t) / N
    return EQUAL * gap + COMPACT * between / tidy + CLOSE * close


def cost(plan):
    return score(tally(plan))


def grow(rng):
    plan = {u: d for d, u in enumerate(rng.sample(units, N))}
    totals = [size[u] for u in plan]
    front = [set(v for v in shared[u] if v not in plan) for u in plan]
    while len(plan) < len(units):
        for d in sorted(range(N), key=lambda d: totals[d]):
            front[d] -= plan.keys()
            if front[d]:
                u = rng.choice(sorted(front[d]))
                plan[u] = d
                totals[d] += size[u]
                front[d] |= {v for v in shared[u] if v not in plan}
                break
        else:
            return None
    return plan


def improve(plan, rng):
    t = tally(plan)
    best = score(t)
    changed = True
    while changed:
        changed = False
        border = [u for u in units if any(plan[v] != plan[u] for v in shared[u])]
        for u in rng.sample(border, len(border)):
            here = plan[u]
            options = sorted({plan[v] for v in shared[u]} - {here})
            if not options or t[here]["n"] < 2:
                continue
            mine = [v for v in shared[u] if plan[v] == here]
            if len(mine) > 1 and not connected([v for v in units if plan[v] == here and v != u]):
                continue
            for there in options:
                plan[u] = None
                shift(t, plan, u, here, -1)
                shift(t, plan, u, there, 1)
                plan[u] = there
                now = score(t)
                if now < best - 1e-9:
                    best, changed = now, True
                    break
                plan[u] = None
                shift(t, plan, u, there, -1)
                shift(t, plan, u, here, 1)
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
    r.update(perimeter=round(r["perimeter"] / 1609.34, 1), roundness=round(r["roundness"], 2), rep=round(r["rep"], 3), people=r["pops"] * 100)
    features.append({"type": "Feature", "properties": {"code": f"District {r['district']}", "pops": r["pops"], "rep": r["rep"], "precinct": ", ".join(r["neighbourhoods"])},
                     "geometry": json.loads(gpd.GeoSeries([drawn.geometry[r["district"]]]).to_json())["features"][0]["geometry"]})
out = {"name": NAME, "districts": rows, "ideal": round(ideal, 1), "weights": {"equal": EQUAL, "compact": COMPACT, "close": CLOSE}, "trials": TRIALS,
       "assignment": {u: d + 1 for u, d in best_plan.items()}, "shapes": {"type": "FeatureCollection", "features": features}}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, separators=(",", ":")))
print("ideal", round(ideal, 1), "cost", round(best_cost, 3))
for r in rows:
    print(r)
