#!/usr/bin/env python3
"""Fits the pops' worked-out politics to the real 2024 vote, in three steps: the region, each county, each neighbourhood.

The region step moves every pop in the listed counties by one amount so the region's total matches. The county step
does the same inside each county; it is kept for our own reading and not meant for the player. The neighbourhood step
keeps half of what is still unexplained as that neighbourhood's local lean. Turnout is fitted the same way first.
Usage: calibrate.py REGION_NAME POPS_JSON [POPS_JSON ...]   (files are rewritten in place)
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

REGION, FILES = sys.argv[1], [Path(f) for f in sys.argv[2:]]
SIZE, KEEP, FLAG, FEW = 100, 0.5, 10, 100


def logit(x):
    x = min(max(x, 0.001), 0.999)
    return math.log(x / (1 - x))


def inv(v):
    return 1 / (1 + math.exp(-v))


def shift(values, weights, target):
    """The single log-odds move that makes the weighted sum of the values hit the target."""
    lo, hi = -6.0, 6.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if sum(w * inv(logit(v) + mid) for v, w in zip(values, weights)) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def fit(pops, hoods, start, weight, target, out):
    """Three nested moves. start: name of the pop's own value. weight(pop): what it is a share of. target(place): the real count."""
    region = shift([p[start] for p in pops], [weight(p) for p in pops], sum(target(h) for h in hoods))
    moves = {"region": region, "county": {}, "local": {}}
    by_county, by_hood = defaultdict(list), defaultdict(list)
    for p in pops:
        by_county[p["_county"]].append(p)
        by_hood[p["hood"]].append(p)
    for c, group in by_county.items():
        here = [h for h in hoods if h["_county"] == c]
        county = shift([inv(logit(p[start]) + region) for p in group], [weight(p) for p in group], sum(target(h) for h in here))
        moves["county"][c] = county
        for h in here:
            mine = by_hood[h["hood"]]
            local = 0.0
            if mine and h["votes2024"] >= FEW:
                local = KEEP * shift([inv(logit(p[start]) + region + county) for p in mine], [weight(p) for p in mine], target(h))
            moves["local"][h["hood"]] = local
            for p in mine:
                p[out] = round(inv(logit(p[start]) + region + county + local), 3)
    return moves


data = {f: json.loads(f.read_text()) for f in FILES}
pops, hoods = [], []
for f, d in data.items():
    for p in d["pops"]:
        p["_county"] = d["summary"]["fips"]
        pops.append(p)
    for h in d["neighbourhoods"]:
        h["_county"] = d["summary"]["fips"]
        hoods.append(h)

turn = fit(pops, hoods, "inherent_turnout", lambda p: SIZE, lambda h: h["votes2024"], "turnout")
lean = fit(pops, hoods, "inherent", lambda p: SIZE * p["turnout"], lambda h: h["votes2024"] and h["rep2024"] / max(1, h["rep2024"] + h["dem2024"]) * sum(SIZE * p["turnout"] for p in pops if p["hood"] == h["hood"]), "rep")


def points(base, move):
    return round((inv(logit(base) + move) - base) * 100, 1)


for f, d in data.items():
    c = d["summary"]["fips"]
    mine = [p for p in pops if p.get("_county") == c]
    voters = sum(SIZE * p["turnout"] for p in mine)
    own = sum(SIZE * p["inherent_turnout"] * p["inherent"] for p in mine) / sum(SIZE * p["inherent_turnout"] for p in mine)
    real_r, real_d, real_all = (sum(h[k] for h in d["neighbourhoods"]) for k in ("rep2024", "dem2024", "votes2024"))
    for p in mine:
        ind = p["independent"]
        p["pie"] = {"R": round((1 - ind) * p["rep"], 3), "I": ind, "D": round((1 - ind) * (1 - p["rep"]), 3)}
    for h in d["neighbourhoods"]:
        here = [p for p in mine if p["hood"] == h["hood"]]
        v = sum(SIZE * p["turnout"] for p in here)
        h["votes"] = round(v)
        h["rep"] = round(sum(SIZE * p["turnout"] * p["rep"] for p in here) / v, 3) if v else None
        own_h = sum(SIZE * p["inherent_turnout"] * p["inherent"] for p in here) / max(1, sum(SIZE * p["inherent_turnout"] for p in here))
        h["inherent"] = round(own_h, 3) if here else None
        h["real"] = round(h["rep2024"] / (h["rep2024"] + h["dem2024"]), 3) if h["rep2024"] + h["dem2024"] else None
        h["local"] = points(h["rep"], lean["local"][h["hood"]]) - 0 if h["rep"] is not None and lean["local"][h["hood"]] else 0.0
        if h["rep"] is not None and lean["local"][h["hood"]]:
            before = inv(logit(h["rep"]) - lean["local"][h["hood"]])
            h["local"] = round((h["rep"] - before) * 100, 1)
        del h["_county"]
    county_points = points(inv(logit(own) + lean["region"]), lean["county"][c])
    d["summary"]["calibration"] = {
        "region": REGION, "worked_out": round(own, 3), "fitted": round(sum(SIZE * p["turnout"] * p["rep"] for p in mine) / voters, 3),
        "real": round(real_r / (real_r + real_d), 3), "region_points": points(own, lean["region"]), "county_points": county_points,
        "flag": abs(county_points) > FLAG, "votes": round(voters), "real_votes": real_all,
        "turnout_worked_out": round(sum(p["inherent_turnout"] for p in mine) / len(mine), 3), "turnout_real": round(real_all / (len(mine) * SIZE), 3)}
    for p in mine:
        del p["_county"]
    f.write_text(json.dumps(d, separators=(",", ":")))
    print(d["summary"]["name"], d["summary"]["calibration"])
