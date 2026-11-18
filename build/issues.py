#!/usr/bin/env python3
"""Gives every pop a number on every issue, and every place the average of its pops.

Reads docs/content/issues/issues.yaml, the pops (docs/data/pops/) and their organization pies (docs/data/orgs/). A pop's number is the
state's base plus the pulls of what the pop is, kept between -100 and 100. The base is set so the state's average lands on nation + florida.
Writes docs/data/issues.json: the list with each issue's base and pulls, each party's usual stop, and every place's averages. The game works a single
pop's numbers out from the base and pulls with the same sum (popIssues in docs/game.js), so the two must be kept alike.
Usage: issues.py DATA_DIR
"""
import json
import sys
from pathlib import Path

import yaml

import wide

DATA = Path(sys.argv[1])
book = yaml.safe_load((DATA.parent / "content" / "issues" / "issues.yaml").read_text())
ISSUES, SPREAD = book["issues"], book.get("spread", 1)
WORK = {"Government and military": "government work", "Schools and health": "schools and health", "Shops and service": "service work", "Building and transport": "blue-collar",
        "Factory and plant": "blue-collar", "Farm and ranch": "farm", "Oil, gas and mining": "oil and mining"}


def traits(pop, pie, kinds):
    """How much of each pulling group a pop is, from 0 to 1."""
    share = {"church": 0, "union": 0, "business": 0}
    for i in range(0, len(pie), 2):
        if kinds[pie[i]] in share:
            share[kinds[pie[i]]] += pie[i + 1] / 100
    t = {"Democrat": pop["pie"]["D"], "Republican": pop["pie"]["R"], pop["race"]: 1, pop["area"]: 1, **share}
    t[{"Under $35,000": "under $35k", "Over $150,000": "over $150k"}.get(pop["income"], "")] = 1
    t[{"18 to 29": "under 30", "65 and over": "65 and over"}.get(pop["age"], "")] = 1
    t[{"Bachelor's or more": "college", "No college": "no college"}.get(pop["education"], "")] = 1
    t[WORK.get(pop["work"], "")] = 1
    return t


counties, rows = {}, []
for f in sorted((DATA / "pops").glob("fl-*.json")):
    fips = f.stem[3:]
    pops = json.loads(f.read_text())["pops"]
    orgs = json.loads((DATA / "orgs" / f.name).read_text())
    kinds = [o[2] for o in orgs["organizations"]]
    mine = [traits(p, orgs["pies"][i] if i < len(orgs["pies"]) else [], kinds) for i, p in enumerate(pops)]
    counties[fips] = (pops, mine)
    rows += mine
raw = [[SPREAD * sum(v * t.get(g, 0) for g, v in issue["pulls"].items()) for issue in ISSUES] for t in rows]
base = [issue["nation"] + issue["florida"] - sum(r[k] for r in raw) / len(raw) for k, issue in enumerate(ISSUES)]
clip = lambda x: max(-100, min(100, round(x)))
hood, at, side = {}, 0, {p: [[0, 0] for _ in ISSUES] for p in "DIR"}
PARTY = {"D": "Democrat", "R": "Republican", "I": ""}
for fips, (pops, mine) in counties.items():
    for p in pops:
        nums = [clip(base[k] + raw[at][k]) for k in range(len(ISSUES))]
        hood.setdefault(p["hood"], []).append(nums)
        for party in "DIR":   # where a party's own people stand: the pop without its party pulls, plus that party's pull
            for k, issue in enumerate(ISSUES):
                rest = base[k] + raw[at][k] / SPREAD - sum(issue["pulls"].get(g, 0) * p["pie"][c] for c, g in PARTY.items())
                side[party][k][0] += (rest + issue["pulls"].get(PARTY[party], 0)) * p["pie"][party]
                side[party][k][1] += p["pie"][party]
        at += 1
places = {}
for f in sorted((DATA / "game").glob("fl-12*.json")):
    for q in json.loads(f.read_text())["places"].values():
        got = [nums for h in q["members"] for nums in hood.get(h, [])]
        if got:
            places[q["id"]] = [round(sum(n[k] for n in got) / len(got)) for k in range(len(ISSUES))]
for pid, members in wide.districts(DATA).items():
    got = [nums for h in members for nums in hood.get(h, [])]
    if got:
        places[pid] = [round(sum(n[k] for n in got) / len(got)) for k in range(len(ISSUES))]
everyone = [nums for v in hood.values() for nums in v]
places["__state"] = [round(sum(n[k] for n in everyone) / len(everyone)) for k in range(len(ISSUES))]
usual = {}
for party, name in (("D", "dem"), ("I", "ind"), ("R", "rep")):
    usual[name] = []
    for k, issue in enumerate(ISSUES):
        mean = side[party][k][0] / side[party][k][1]
        usual[name].append(min(range(len(issue["stops"])), key=lambda i: abs(issue["stops"][i][0] - mean)))
listing = [{**{k: issue[k] for k in ("id", "name", "category", "weights", "stops")}, "pulls": {g: round(v * SPREAD, 2) for g, v in issue["pulls"].items()}, "base": round(base[i], 2)} for i, issue in enumerate(ISSUES)]
(DATA / "issues.json").write_text(json.dumps({"issues": listing, "usual": usual, "places": places}, separators=(",", ":")))
print(len(ISSUES), "issues,", at, "pops,", len(places), "places")
for k, issue in enumerate(ISSUES):
    print(f"{issue['name']:30} state {places['__state'][k]:+4}  D {issue['stops'][usual['dem'][k]][1]:24} I {issue['stops'][usual['ind'][k]][1]:24} R {issue['stops'][usual['rep'][k]][1]}")
