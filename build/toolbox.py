#!/usr/bin/env python3
"""Packs what the election toolbox (docs/toolbox.html) needs about every pop into two files.

docs/data/toolbox.json holds the lists: issues (with each party's pull and usual stop), camps (with the stop each holds on every issue and the camp it folds
into), neighbourhoods and the places they sit in, counties, and the labels for what a pop is. docs/data/toolbox.bin holds one value per pop for each
column named in the json's 'columns', then each pop's number on every issue with its party pulls taken out. A party's people inside a pop stand at that
number plus the party's pull, as in camps.py. Run after camps.py. Usage: toolbox.py DATA_DIR
"""
import json
import sys
from array import array
from pathlib import Path

import yaml

import wide

DATA = Path(sys.argv[1])
content = DATA.parent / "content"
book = yaml.safe_load((content / "issues" / "issues.yaml").read_text())
ISSUES, SPREAD = book["issues"], book.get("spread", 1)
CAMPS = yaml.safe_load((content / "camps" / "camps.yaml").read_text())["camps"]
built = json.loads((DATA / "issues.json").read_text())
base = [i["base"] for i in built["issues"]]
WORK = {"Government and military": "government work", "Schools and health": "schools and health", "Shops and service": "service work", "Building and transport": "blue-collar",
        "Factory and plant": "blue-collar", "Farm and ranch": "farm", "Oil, gas and mining": "oil and mining"}
LISTS = {"race": ["White", "Black", "Hispanic", "Asian", "Other"], "age": ["18 to 29", "30 to 44", "45 to 64", "65 and over"], "education": ["No college", "Some college", "Bachelor's or more"],
         "income": ["Under $35,000", "$35,000 to $75,000", "$75,000 to $150,000", "Over $150,000"], "area": ["urban", "suburban", "exurban", "small town", "rural"],
         "work": ["Office and professional", "Schools and health", "Shops and service", "Building and transport", "Factory and plant", "Government and military", "Farm and ranch", "Oil, gas and mining", "Student", "Retired"]}

index = json.loads((DATA / "game" / "fl-index.json").read_text())["counties"]
county_at = {c["fips"]: n for n, c in enumerate(index)}
hoods, hood_at, munis = [], {}, {}
for c in index:
    places = json.loads((DATA / "game" / f"fl-{c['fips']}.json").read_text())["places"]
    for q in places.values():
        if q["kind"] == "muni":
            munis[q["id"]] = [q["name"], county_at[c["fips"]], q["members"]]
    for q in places.values():
        if q["kind"] == "hood":
            hood_at[q["id"]] = len(hoods)
            hoods.append([q["id"], county_at[c["fips"]], q.get("district") or 0, q.get("house") or 0, q.get("senate") or 0, q.get("congress") or 0, -1])
muni_list = []
for mid, (name, county, members) in sorted(munis.items(), key=lambda m: (m[1][1], m[1][0])):
    for h in members:
        if h in hood_at:
            hoods[hood_at[h]][6] = len(muni_list)
    muni_list.append([mid, name, county])

cols = {k: array("H") for k in ("hood", "dem", "rep", "vote", "turnout")}
small = {k: array("B") for k in ("camp_dem", "camp_rep", *LISTS)}
rest = array("b")
for c in index:
    pops = json.loads((DATA / "pops" / f"fl-{c['fips']}.json").read_text())["pops"]
    orgs = json.loads((DATA / "orgs" / f"fl-{c['fips']}.json").read_text())
    camps = json.loads((DATA / "camps" / f"fl-{c['fips']}.json").read_text())["pops"]
    kinds = [o[2] for o in orgs["organizations"]]
    for n, p in enumerate(pops):
        pie = orgs["pies"][n] if n < len(orgs["pies"]) else []
        t = {p["race"]: 1, p["area"]: 1, "church": 0, "union": 0, "business": 0}
        for j in range(0, len(pie), 2):
            if kinds[pie[j]] in t:
                t[kinds[pie[j]]] += pie[j + 1] / 100
        t[{"Under $35,000": "under $35k", "Over $150,000": "over $150k"}.get(p["income"], "")] = 1
        t[{"18 to 29": "under 30", "65 and over": "65 and over"}.get(p["age"], "")] = 1
        t[{"Bachelor's or more": "college", "No college": "no college"}.get(p["education"], "")] = 1
        t[WORK.get(p["work"], "")] = 1
        for k, i in enumerate(ISSUES):
            rest.append(max(-127, min(127, round(base[k] + SPREAD * sum(v * t.get(g, 0) for g, v in i["pulls"].items() if g not in ("Democrat", "Republican"))))))
        cols["hood"].append(hood_at[p["hood"]])
        cols["dem"].append(round(1000 * p["pie"]["D"]))
        cols["rep"].append(round(1000 * p["pie"]["R"]))
        cols["vote"].append(round(1000 * p["rep"]))
        cols["turnout"].append(round(1000 * p["turnout"]))
        small["camp_dem"].append(camps[n][0])
        small["camp_rep"].append(camps[n][2])
        for key, names in LISTS.items():
            small[key].append(names.index(p[key]))
n = len(cols["hood"])
with open(DATA / "toolbox.bin", "wb") as f:
    for a in (*cols.values(), *small.values(), rest):
        f.write(a.tobytes())
stop_at = [{s[1]: j for j, s in enumerate(i["stops"])} for i in ISSUES]
out = {"pops": n, "columns": {"wide": list(cols), "small": list(small)}, "lists": LISTS,
       "issues": [{"id": i["id"], "name": i["name"], "category": i["category"], "weights": i["weights"], "stops": i["stops"], "dem": i["pulls"].get("Democrat", 0), "rep": i["pulls"].get("Republican", 0)} for i in ISSUES],
       "usual": built["usual"],
       "camps": [{"id": c["id"], "name": c["name"], "party": c["party"], "colour": c["colour"], "folds": c.get("folds"), "stops": [stop_at[k][c["positions"][i["id"]]] for k, i in enumerate(ISSUES)]} for c in CAMPS],
       "counties": [[c["id"], c["name"], c["code"], c["bounds"]] for c in index], "hoods": hoods, "munis": muni_list}
(DATA / "toolbox.json").write_text(json.dumps(out, separators=(",", ":")))
print(n, "pops,", len(hoods), "neighbourhoods,", len(muni_list), "cities;", round((DATA / "toolbox.bin").stat().st_size / 1e6, 1), "MB")
