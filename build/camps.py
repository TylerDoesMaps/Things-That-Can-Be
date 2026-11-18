#!/usr/bin/env python3
"""Sorts each pop's Democrats, Republicans and independents into the camp of their party whose positions are nearest.

A party's people inside a pop stand where the pop stands with its party pulls taken out and that party's own pull put in.
Nearness compares how the camp differs from its party with how those people differ from their party. Prints how each party divides. Usage: camps.py DATA_DIR
"""
import json
import sys
from pathlib import Path

import yaml

sys.argv = [sys.argv[0], sys.argv[1]]
DATA = Path(sys.argv[1])
content = DATA.parent / "content"
book = yaml.safe_load((content / "issues" / "issues.yaml").read_text())
ISSUES, SPREAD = book["issues"], book.get("spread", 1)
CAMPS = yaml.safe_load((content / "camps" / "camps.yaml").read_text())["camps"]
value = [{s[1]: s[0] for s in i["stops"]} for i in ISSUES]
for c in CAMPS:
    c["at"] = [value[k][c["positions"][i["id"]]] for k, i in enumerate(ISSUES)]
base = {i["id"]: i["base"] for i in json.loads((DATA / "issues.json").read_text())["issues"]}
WORK = {"Government and military": "government work", "Schools and health": "schools and health", "Shops and service": "service work", "Building and transport": "blue-collar",
        "Factory and plant": "blue-collar", "Farm and ranch": "farm", "Oil, gas and mining": "oil and mining"}
PARTY = {"dem": ("D", "Democrat"), "rep": ("R", "Republican"), "ind": ("I", "")}
size = {c["id"]: 0 for c in CAMPS}
whole = {p: 0 for p in PARTY}
who = {c["id"]: {} for c in CAMPS}
slices = {p: [] for p in PARTY}
for f in sorted((DATA / "pops").glob("fl-*.json")):
    pops = json.loads(f.read_text())["pops"]
    orgs = json.loads((DATA / "orgs" / f.name).read_text())
    kinds = [o[2] for o in orgs["organizations"]]
    for n, p in enumerate(pops):
        pie = orgs["pies"][n] if n < len(orgs["pies"]) else []
        t = {p["race"]: 1, p["area"]: 1, "church": 0, "union": 0, "business": 0}
        for j in range(0, len(pie), 2):
            if kinds[pie[j]] in t:
                t[kinds[pie[j]]] += pie[j + 1] / 100
        t[{"Under $35,000": "under $35k", "Over $150,000": "over $150k"}.get(p["income"], "")] = 1
        t[{"18 to 29": "under 30", "65 and over": "65 and over"}.get(p["age"], "")] = 1
        t["college" if p["education"] == "Bachelor's or more" else ""] = 1
        t[WORK.get(p["work"], "")] = 1
        rest = [base[i["id"]] + SPREAD * sum(v * t.get(g, 0) for g, v in i["pulls"].items() if g not in ("Democrat", "Republican")) for i in ISSUES]
        for party, (letter, group) in PARTY.items():
            slices[party].append((p, p["pie"][letter], [max(-100, min(100, rest[k] + i["pulls"].get(group, 0))) for k, i in enumerate(ISSUES)]))
# A camp is judged by how it differs from its party, and a pop's party members by how they differ from that party's people:
# each side is measured from its own average, in units of its own spread, so every camp draws the people who lean its way.
for party in PARTY:
    mine, rows, n = [c for c in CAMPS if c["party"] == party], slices[party], len(ISSUES)
    total = sum(w for _, w, _ in rows)
    mean = [sum(w * s[k] for _, w, s in rows) / total for k in range(n)]
    sd = [max(1.0, (sum(w * (s[k] - mean[k]) ** 2 for _, w, s in rows) / total) ** 0.5) for k in range(n)]
    cmean = [sum(c["at"][k] for c in mine) / len(mine) for k in range(n)]
    csd = [max(1.0, (sum((c["at"][k] - cmean[k]) ** 2 for c in mine) / len(mine)) ** 0.5) for k in range(n)]
    for c in mine:
        c["z"] = [(c["at"][k] - cmean[k]) / csd[k] for k in range(n)]
    for p, w, s in rows:
        z = [(s[k] - mean[k]) / sd[k] for k in range(n)]
        best = min(mine, key=lambda c: sum((a - b) ** 2 for a, b in zip(z, c["z"])))
        size[best["id"]] += w
        whole[party] += w
        for key in (p["race"], p["age"], p["area"]):
            who[best["id"]][key] = who[best["id"]].get(key, 0) + w
for c in CAMPS:
    top = sorted(who[c["id"]].items(), key=lambda x: -x[1])
    share = lambda keys: ", ".join(f"{k} {v / max(size[c['id']], 1e-9):.0%}" for k, v in top if k in keys)
    print(f"{c['party']} {c['name']:32} {size[c['id']] / whole[c['party']]:6.1%}  | {share(('White', 'Black', 'Hispanic'))} | {share(('18 to 29', '65 and over'))} | {share(('urban', 'rural'))}")
