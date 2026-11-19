#!/usr/bin/env python3
"""Everything the map can shade a place by, for every place that has an outline.

Counts each pop's race, age, education, income, work, area type, home owning, turnout and party for its neighbourhood, then adds
neighbourhoods up into commission districts, cities, counties, and State House, State Senate and Congress districts.
Writes docs/data/shades.json: the fields, each place's row (pops, then every field in thousandths) and the districts' neighbourhoods.
Usage: shades.py DATA_DIR
"""
import json
import sys
from pathlib import Path

import wide

DATA = Path(sys.argv[1])
GROUPS = [("race", "Race", ["White", "Black", "Hispanic", "Asian", "Other"]), ("age", "Age", ["18 to 29", "30 to 44", "45 to 64", "65 and over"]),
          ("education", "Education", ["No college", "Some college", "Bachelor's or more"]), ("income", "Household income", ["Under $35,000", "$35,000 to $75,000", "$75,000 to $150,000", "Over $150,000"]),
          ("work", "Work", ["Office and professional", "Schools and health", "Shops and service", "Building and transport", "Factory and plant", "Government and military", "Farm and ranch", "Oil, gas and mining", "Student", "Retired"]),
          ("area", "Area type", ["urban", "suburban", "exurban", "small town", "rural"])]
FIELDS = [("party", "Party", k, k) for k in ("R", "I", "D")] + [(g, label, v, v) for g, label, values in GROUPS for v in values] + [("home", "Homes", "owners", "Homeowners"), ("vote", "Voting", "turnout", "Expected turnout")]
tally = {}
for f in sorted((DATA / "pops").glob("fl-*.json")):
    for p in json.loads(f.read_text())["pops"]:
        row = tally.setdefault(p["hood"], [0.0] * (len(FIELDS) + 1))
        row[0] += 1
        for i, (group, _, key, _) in enumerate(FIELDS, 1):
            row[i] += p["pie"][key] if group == "party" else p[key] if group in ("home", "vote") else p[group] == key
records = wide.hoods(DATA)
members = {}
for f in sorted((DATA / "game").glob("fl-12*.json")):
    for q in json.loads(f.read_text())["places"].values():
        members[q["id"]] = q["members"]
far = wide.districts(DATA)
members.update(far)
places = {}
for pid, hoods in members.items():
    got = [tally[h] for h in hoods if h in tally]
    pops = sum(r[0] for r in got)
    if not pops:
        continue
    voted = [records[h] for h in hoods if h in records and records[h].get("rep2024") is not None and records[h].get("votes2024")]
    votes = sum(r["votes2024"] for r in voted)
    real = sum(r["rep2024"] * r["votes2024"] for r in voted) / votes if votes else None
    local = sum(records[h].get("local", 0) * tally[h][0] for h in hoods if h in tally and h in records) / pops
    places[pid] = [round(pops)] + [round(1000 * sum(r[i] for r in got) / pops) for i in range(1, len(FIELDS) + 1)] + [None if real is None else round(1000 * real), round(local * 10)]
tops = []
for i in range(1, len(FIELDS) + 1):   # the darkest shade: what one neighbourhood in twenty reaches
    col = sorted(places[h][i] for h in tally if h in places)
    tops.append(max(100, col[int(len(col) * 0.95)]))
names = {pid: f"{dict(wide.KINDS)[pid.split('-')[0]]} District {pid.split('-')[1]}" for pid in far}
out = {"fields": [{"group": g, "heading": label, "key": key, "label": name, "top": tops[i]} for i, (g, label, key, name) in enumerate(FIELDS)], "places": places, "districts": far, "names": names}
(DATA / "shades.json").write_text(json.dumps(out, separators=(",", ":")))
print(len(FIELDS), "fields,", len(places), "places,", len(far), "districts")
