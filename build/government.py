#!/usr/bin/env python3
"""Pulls every government in one county from the Census of Governments employment file.

Writes the county's governments with their full-time and part-time staff by function code.
Usage: government.py COG_DIR STATE_CODE COUNTY_NAME STATE_NAME OUT_JSON
COG_DIR holds 22empid.txt and 22empst.txt from the 2022 individual unit files.
"""
import json
import sys
from pathlib import Path

cog, state_code, county, state_name, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], Path(sys.argv[5])
KINDS = {"0": "state", "1": "county", "2": "city", "3": "township", "4": "district", "5": "school"}
units = {}
for line in open(cog / "22empid.txt", encoding="latin-1"):
    uid = line[:14]
    if uid[:2] != state_code:
        continue
    if line[79:109].strip() == county or uid[2:] == "0" * 12:
        people = line[125:134].strip()
        units[uid] = {"name": line[14:78].strip(), "kind": KINDS[uid[2]],
                      "people": int(people) if people and uid[2] in "0123" else None, "staff": {}}
for line in open(cog / "22empst.txt", encoding="latin-1"):
    uid = line[:14]
    if uid in units:
        parts = line[20:].split()
        full, part = int(parts[0]), int(parts[4])
        if full or part:
            units[uid]["staff"][line[17:20]] = [full, part]
order = list(KINDS.values())
rows = sorted(units.values(), key=lambda u: (order.index(u["kind"]), -(u["people"] or 0), u["name"]))
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"county": county, "state": state_name, "year": 2022, "units": rows}, separators=(",", ":")) + "\n")
print(len(rows), "governments")
