#!/usr/bin/env python3
"""Summarises how often precincts are split by each layer and how far the three methods disagree.

Usage: compare_methods.py WORK_DIR OUT_JSON
"""
import json
import sys
from pathlib import Path

import numpy as np

WORK, OUT = Path(sys.argv[1]), Path(sys.argv[2])
alloc = [json.loads(p.read_text()) for p in sorted((WORK / "alloc").glob("*.json"))]
margin = lambda v: 100 * (v[1] - v[0]) / v[2] if v[2] else np.nan
summary = {}
for layer in ["county", "city", "township", "cd", "sldu", "sldl"]:
    s = dict(precincts=0, split=0, votes=0, votes_in_split=0, votes_minority_side=0)
    gaps = {"area": [], "whole": []}
    worst = {"area": (0, ""), "whole": (0, "")}
    for a in alloc:
        if layer not in a["stats"]:
            continue
        for k in s:
            s[k] += a["stats"][layer][k]
        for gid, v in a["layers"][layer].items():
            if v["vap"][2] < 500 or v["in"] < 0.98:
                continue
            for m in gaps:
                g = abs(margin(v["vap"]) - margin(v.get(m, [0, 0, 0])))
                if not np.isnan(g):
                    gaps[m].append(g)
                    worst[m] = max(worst[m], (round(g, 1), gid))
    row = dict(s, split_pct=round(100 * s["split"] / s["precincts"], 1),
               votes_in_split_pct=round(100 * s["votes_in_split"] / s["votes"], 1),
               votes_minority_side_pct=round(100 * s["votes_minority_side"] / s["votes"], 2), units=len(gaps["area"]))
    for m, g in gaps.items():
        g = np.array(g)
        row[m] = dict(median=round(float(np.median(g)), 2), p95=round(float(np.percentile(g, 95)), 2),
                      over_1pt=int((g > 1).sum()), over_5pt=int((g > 5).sum()), worst=worst[m])
    summary[layer] = row
OUT.write_text(json.dumps(summary, indent=1))
for k, v in summary.items():
    print(k, json.dumps(v))
