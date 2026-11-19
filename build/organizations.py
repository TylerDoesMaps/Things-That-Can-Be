#!/usr/bin/env python3
"""Works out which organizations each pop's people belong to and which chapters each county has.

Each pop has one pie for each kind of organization (church, union, business, civic): the people out of its 100 who
belong to each organization, the rest being uninvolved. The rates below turn what a pop carries into those pies. The
mix between churches in a county is then fitted to the county's real religious identity (percentages only; how many
attend at all stays with the rates). An organization with too few members in a county has no chapter there: part of
its people fold into a larger organization and the rest are uninvolved. Run after the pops are fitted.
Writes docs/data/orgs/fl-<fips>.json: the list of organizations, the county's chapters with their members, and for
every pop (in the order of the pops file) a flat list of organization number, members, organization number, members.
Usage: organizations.py DATA_DIR ORGANIZATIONS_YAML RELIGION_CSV
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np
import yaml

INCOME = {"Under $35,000": 0, "$35,000 to $75,000": 1, "$75,000 to $150,000": 2, "Over $150,000": 3}
ALLIANCE = 0.08  # share of churchgoers who belong to the Ministerial Alliance directly


def rates(p):
    """People out of the pop's 100 who join each organization, before fitting and folding."""
    r = {}

    def add(org, n):
        if n > 0:
            r[org] = r.get(org, 0) + n

    race, age, edu, area, work = p["race"], p["age"], p["education"], p["area"], p["work"]
    inc, own, rep, dem = INCOME[p["income"]], p.get("owners", 0.6), p["pie"]["R"], p["pie"]["D"]
    old, mid, college, country = age == "65 and over", age == "45 to 64", edu == "Bachelor's or more", area in ("rural", "small town", "exurban")
    # ---- churches: who attends at all, then where
    attends = {"White": 30, "Black": 45, "Hispanic": 35}.get(race, 20) + {"18 to 29": -12, "30 to 44": -5, "45 to 64": 0, "65 and over": 8}[age] + {"rural": 8, "small town": 5, "exurban": 5, "suburban": 0, "urban": -6}[area]
    if race == "White":
        attends += 20 * (rep - 0.4)
        split = {"baptist_association": 40, "pentecostal_fellowship": 20, "mainline_council": 20, "catholic_diocese": 17, "jewish_federation": 2, "latter_day_saint_stake": 1}
        move = 10 if college else 0
        split["mainline_council"] += move
        split["baptist_association"] -= move
        move = 10 if country else -10
        split["baptist_association"] += move
        split["catholic_diocese"] -= move
    elif race == "Black":
        split = {"black_church_conference": 85, "pentecostal_fellowship": 8, "catholic_diocese": 5, "islamic_society": 2}
    elif race == "Hispanic":
        split = {"catholic_diocese": 55, "hispanic_evangelical_fellowship": 35, "pentecostal_fellowship": 5, "baptist_association": 5}
    else:
        split = {"catholic_diocese": 30, "mainline_council": 20, "pentecostal_fellowship": 20, "islamic_society": 15, "baptist_association": 15}
    attends = max(attends, 3)
    add("ministerial_alliance", attends * ALLIANCE)
    for org, part in split.items():
        add(org, attends * (1 - ALLIANCE) * max(part, 0) / 100)
    # ---- unions: by line of work, more in cities
    by_work = {"Government and military": {"public_employees_union": 10, "police_benevolent_association": 5, "firefighters_union": 3}, "Schools and health": {"teachers_union": 12, "health_workers_union": 4},
               "Building and transport": {"building_trades_council": 6, "transport_workers_union": 5}, "Shops and service": {"service_workers_union": 3}, "Factory and plant": {"labor_council": 6},
               "Oil, gas and mining": {"building_trades_council": 6}, "Farm and ranch": {"farmworkers_association": 8} if race == "Hispanic" or inc == 0 else {}, "Office and professional": {"public_employees_union": 2},
               "Retired": {"labor_council": 2}}
    for org, n in by_work.get(work, {}).items():
        add(org, n * {"urban": 1.3, "suburban": 1.0, "exurban": 0.8, "small town": 0.85, "rural": 0.7}[area])
    # ---- business: by line of work, more with income
    more = [0.5, 1, 1.5, 2.5][inc]
    by_work = {"Farm and ranch": {"growers_association": (35 if inc else 10) / more}, "Office and professional": {"chamber_of_commerce": 8, "realtors_association": 4, "bankers_association": 3, "bar_association": 2},
               "Schools and health": {"medical_society": [0, 0, 3, 15][inc] / more}, "Building and transport": {"home_builders_association": 5}, "Shops and service": {"merchants_association": 5, "hospitality_association": 4},
               "Factory and plant": {"industry_council": 4}, "Oil, gas and mining": {"industry_council": 4}, "Retired": {"chamber_of_commerce": 3}}
    for org, n in by_work.get(work, {}).items():
        add(org, n * more)
    if inc >= 2:
        add("chamber_of_commerce", 4)
    # ---- civic
    add("civic_league", 6 if old or mid else 3)
    if race == "Black":
        add("civil_rights_league", 12 + (4 if old or mid else 0) + (4 if college else 0))
    if race == "Hispanic":
        add("hispanic_civic_alliance", 6)
    add("veterans_post", {"18 to 29": 0, "30 to 44": 2, "45 to 64": 5, "65 and over": 8}[age] * (1.3 if country else 1) + (4 if work == "Government and military" else 0))
    add("seniors_association", 12 if old else 0)
    add("sportsmens_association", {"rural": 10, "small town": 6, "exurban": 8, "suburban": 3.8, "urban": 1.2}[area] * 2 * rep)
    add("homeowners_federation", {"rural": 0, "small town": 2, "exurban": 5, "suburban": 7.2, "urban": 4}[area] * own)
    add("conservation_society", {"Bachelor's or more": 6, "Some college": 2, "No college": 0}[edu] * 2 * dem)
    add("womens_league", (4 if college else 0) + (2 if old or mid else 0))
    add("taxpayers_association", 8 * rep if inc >= 2 else 0)
    return r


def county(pops, orgs, religion, row):
    """Members of each organization in each pop, as an array (organizations x pops), after fitting and folding; and which have a chapter."""
    number = {o["id"]: i for i, o in enumerate(orgs)}
    m = np.zeros((len(orgs), len(pops)))
    for j, p in enumerate(pops):
        for org, n in rates(p).items():
            m[number[org], j] = n
    # ---- fit the mix between churches to the county's religious identity
    churches = [i for i, o in enumerate(orgs) if o["kind"] == "church"]
    if row:
        groups = [([number[c] for c in g.get("churches", [name])], sum(float(row[c]) for c in g["columns"])) for name, g in religion["map"].items()]
        whole = sum(want for _, want in groups) or 1
        attends = m[churches].sum(axis=0)
        for _ in range(12):
            total = m[churches].sum() or 1
            for members, want in groups:
                have = m[members].sum()
                if have > 0:
                    m[members] *= min(max((want / whole) / (have / total), 0.05), 20)
            now = m[churches].sum(axis=0)
            m[churches] *= np.divide(attends, now, out=np.zeros_like(now), where=now > 0)  # each pop keeps the share that attends at all
    # ---- an organization below its bar has no chapter: part of its people fold into a larger one
    depth = lambda o: 0 if o.get("fallback") else 1 + depth(orgs[number[o["into"]]])
    live = np.ones(len(orgs), bool)
    for o in sorted((o for o in orgs if not o.get("fallback")), key=depth, reverse=True):
        i = number[o["id"]]
        if m[i].sum() < o["bar"]:
            m[number[o["into"]]] += m[i] * o["share"]
            m[i] = 0
            live[i] = False
    return m, live


if __name__ == "__main__":
    DATA, book = Path(sys.argv[1]), yaml.safe_load(open(sys.argv[2]))
    orgs = [o for o in book["organizations"] if o["kind"] != "party"]
    real = {r["fips"]: r for r in csv.DictReader(open(sys.argv[3]))}
    (DATA / "orgs").mkdir(exist_ok=True)
    chapters = people = members = 0
    for path in sorted((DATA / "pops").glob("fl-12*.json")):
        fips = path.stem[3:]
        pops = json.load(open(path))["pops"]
        m, live = county(pops, orgs, book["religion"], real.get(fips))
        whole = np.round(m).astype(int)
        pies = [[int(x) for i in np.nonzero(whole[:, j])[0] for x in (i, whole[i, j])] for j in range(len(pops))]
        out = {"organizations": [[o["id"], o["name"], o["kind"]] for o in orgs], "chapters": {orgs[i]["id"]: int(round(m[i].sum())) for i in range(len(orgs)) if live[i]}, "pies": pies}
        (DATA / f"orgs/fl-{fips}.json").write_text(json.dumps(out, separators=(",", ":")))
        chapters += int(live.sum())
        people += len(pops) * 100
        members += m.sum()
    print(chapters, "chapters;", round(members / people * 100, 1), "memberships per 100 people")
