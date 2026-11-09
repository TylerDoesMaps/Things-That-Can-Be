#!/usr/bin/env python3
"""Writes docs/data/manifest.json. Usage: manifest.py WORK_DIR DATA_DIR"""
import json
import sys
from pathlib import Path

import pandas as pd

WORK, DATA = Path(sys.argv[1]), Path(sys.argv[2])
bounds = json.loads((WORK / "bounds.json").read_text())
bounds["states"]["AK"] = [-179.3, 51.0, -129.9, 71.6]
for fips, box in bounds["counties"].items():
    if box[2] - box[0] > 180:
        bounds["counties"][fips] = [-179.3, box[1], -160.0, box[3]]

containment = json.loads((DATA / "containment.json").read_text())
fips = {s["state"]: s["fips"] for s in containment["states"]}
keys = ["counties", "cities", "townships", "block_groups", "precincts", "blocks", "neighborhoods"]
counts = {s["state"]: {k: s[k] for k in keys} for s in containment["states"]}

county_names = {}
counties = json.loads((DATA / "county.json").read_text())
for geometry in next(iter(counties["objects"].values()))["geometries"]:
    props = geometry["properties"]
    if props["ST"] == "FL":
        county_names[props["NAME"]] = props["GEOID"][2:]
county_names["Miami-Dade"] = county_names.get("Miami-Dade", "086")

manifest = {
    "states": bounds["states"],
    "counties": bounds["counties"],
    "fips": fips,
    "stateCounts": counts,
    "blockCounties": sorted(p.stem for p in (DATA / "blocks").glob("*.json")),
    "precinctStates": sorted(p.stem for p in (DATA / "precinct").glob("*.json")),
    "flCountyByName": county_names,
}
(DATA / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
print(len(manifest["blockCounties"]), manifest["precinctStates"])
