#!/usr/bin/env python3
"""Packs one county for the game shell and generates a seed's characters.

Writes the county file: every place (county, drawn districts, city and unincorporated area, neighbourhoods) with its
shape and what its pops add up to. Writes the seed file: one character per pop (a name and a party drawn from the
pop) and a holder for every seat on the state's office list. Characters are names and parties only for now.
Usage: game.py NEIGHBOURHOODS_JSON POPS_JSON DISTRICTS_JSON OFFICES_YAML NAMES_JSON SEED COUNTY_NAME CODE OUT_COUNTY_JSON OUT_SEED_JSON
"""
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import geopandas as gpd
import yaml

HOODS, POPS, DISTRICTS, OFFICES, NAMES, SEED, COUNTY, CODE, OUT, OUT_SEED = (Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5]),
                                                                           int(sys.argv[6]), sys.argv[7], sys.argv[8], Path(sys.argv[9]), Path(sys.argv[10]))
src = json.load(open(HOODS))
shapes = gpd.GeoDataFrame.from_features(src["options"]["C"]["shapes"], crs=4269).set_index("code")
pop_file = json.load(open(POPS))
pops = pop_file["pops"]
drawn = json.load(open(DISTRICTS))
offices = yaml.safe_load(open(OFFICES))
names = json.load(open(NAMES))
votes = {c["precinct"]: (c["actual_votes"] * (c["actual_rep"] or 0.5), c["actual_votes"] * (1 - (c["actual_rep"] or 0.5)), c["actual_votes"]) for c in pop_file["precincts"]}
city_of = {p["precinct"]: p["city"] for p in pops}

# ---- places
places, features = {}, []


def add(pid, kind, name, sub, members, geometry, extra=None):
    mine = [p for p in pops if p["precinct"] in members]
    n = len(mine) or 1
    count = lambda key: dict(Counter(p[key] for p in mine).most_common())
    rep, dem, cast = (sum(votes[m][i] for m in members) for i in range(3))
    places[pid] = {"id": pid, "kind": kind, "name": name, "sub": sub, "members": sorted(members), "pops": len(mine),
                   "party": [round(sum(p["pie"][i] for p in mine) / n, 3) for i in range(3)], "turnout": round(sum(p["turnout"] for p in mine) / n, 3),
                   "race": count("race"), "age": count("age"), "education": count("education"), "income": count("income"), "work": count("work"), "area": count("area"),
                   "rep2024": round(rep / (rep + dem), 3) if rep + dem else None, "votes2024": round(cast), **(extra or {})}
    features.append({"type": "Feature", "properties": {"id": pid, "kind": kind}, "geometry": json.loads(gpd.GeoSeries([geometry]).to_json())["features"][0]["geometry"]})


hoods = list(shapes.index)
district_of = drawn["assignment"]
for code in hoods:
    city = city_of.get(code, "")
    add(code, "hood", code, f"Neighbourhood, {city or 'outside any city'}", [code], shapes.geometry[code],
        {"city": city, "district": district_of[code], "house": int(shapes.house[code])})
for d in sorted(set(district_of.values())):
    members = [c for c in hoods if district_of[c] == d]
    add(f"{CODE}-D{d}", "district", f"District {d}", f"{COUNTY} County Commission district", members, shapes.geometry[members].union_all())
for city in sorted(set(city_of.values())):
    members = [c for c in hoods if city_of.get(c, "") == city]
    add((city or "unincorporated").lower().replace(" ", "-"), "muni", city or f"Unincorporated {COUNTY} County", "City" if city else "Outside any city", members, shapes.geometry[members].union_all())
add(COUNTY.lower(), "county", f"{COUNTY} County", offices["state"], hoods, shapes.geometry.union_all())

# ---- characters: one per pop
rng = random.Random(SEED)
taken, people = set(), {}


def pick(table):
    spot, mark = rng.random() * sum(w for _, w in table), 0
    for value, weight in table:
        mark += weight
        if spot <= mark:
            return value
    return table[-1][0]


def person(race, party, **more):
    for _ in range(200):
        sex = rng.choice("MF")
        name = f"{pick(names['first'][f'{sex}|{race}'])} {pick(names['last'][race])}"
        if name not in taken:
            break
    taken.add(name)
    pid = f"s{SEED}-{len(people) + 1:05d}"
    people[pid] = {"id": pid, "name": name, "party": party, **more}
    return pid


def draw_party(pie):
    spot = rng.random()
    return "rep" if spot < pie[0] else "ind" if spot < pie[0] + pie[1] else "dem"


leader = {}
for p in pops:
    leader[p["id"]] = person(p["race"], draw_party(p["pie"]), pop=p["id"], home=p["precinct"])

# ---- seats
county_lean = places[COUNTY.lower()]["rep2024"]
held, seats = set(), []


def lean_party(share):
    odds = share ** 3 / (share ** 3 + (1 - share) ** 3)
    return "rep" if rng.random() < odds else "dem"


def local(members, partisan):
    pool = [leader[p["id"]] for p in pops if p["precinct"] in members and leader[p["id"]] not in held]
    if partisan:
        rep = sum(votes[m][0] for m in members)
        want = lean_party(rep / (rep + sum(votes[m][1] for m in members)))
        pool = [x for x in pool if people[x]["party"] == want] or pool
    choice = rng.choice(pool)
    held.add(choice)
    return choice


def outside(partisan=True):
    race = pick([("White", 60), ("Black", 15), ("Hispanic", 20), ("Asian", 3), ("Other", 2)])
    return person(race, lean_party(county_lean) if partisan else draw_party([0.4, 0.25, 0.35]), home="Elsewhere")


def seat(office, label, holder, area):
    seats.append({"office": office["id"], "title": office["title"], "government": office["government"], "label": label, "holder": holder, "area": area,
                  "kind": office["kind"], "chosen": office["chosen"], "partisan": office.get("partisan", False), "next": office.get("next", [])})


city_places = [p for p in places.values() if p["kind"] == "muni" and p["sub"] == "City"]
skip = {"city.mayor", "city.council.generic", "fl.appeal_judge", "fl.circuit_judge"}
council = []
for o in offices["offices"]:
    if o["id"] in skip:
        continue
    gov, partisan = o["government"], o.get("partisan", False)
    if o["id"] == "county.commissioner":
        for d in sorted(set(district_of.values())):
            seat(o, f"District {d}", local(places[f"{CODE}-D{d}"]["members"], True), f"{CODE}-D{d}")
    elif gov in ("county", "school", "district") or o["id"] == "fl.county_judge":
        many = o.get("seats", 1)
        for i in range(many):
            seat(o, f"Seat {i + 1}" if many > 1 else "", local(hoods, partisan), COUNTY.lower())
    elif gov == "city":
        town = city_places[0]
        if o["id"] == "city.council":
            for i in range(o["seats"]):
                council.append(local(town["members"], False))
                seat(o, f"Group {i + 1}", council[-1], town["id"])
        elif o["id"] == "city.mayor.chosen":
            seat(o, "", rng.choice(council), town["id"])
        else:
            seat(o, "", local(town["members"], False), town["id"])
    elif o["id"] == "fl.representative":
        for n in sorted({places[c]["house"] for c in hoods}):
            seat(o, f"District {n}", outside(), f"house-{n}")
    else:
        for i in range(o.get("seats", 1)):
            seat(o, "", outside(partisan or o["chosen"] == "appointed"), "state" if gov == "state" else "country")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"county": COUNTY, "state": offices["state"], "code": CODE, "bounds": src["bounds"], "places": places,
                           "shapes": {"type": "FeatureCollection", "features": features}, "lines": src["lines"]}, separators=(",", ":")))
OUT_SEED.parent.mkdir(parents=True, exist_ok=True)
OUT_SEED.write_text(json.dumps({"seed": SEED, "people": people, "leaders": leader, "seats": seats}, separators=(",", ":")))
print(len(places), "places,", len(people), "people,", len(seats), "seats;", Counter(p["party"] for p in people.values()))
for s in seats[:40]:
    print(f"  {s['title']:34s} {s['label']:11s} {people[s['holder']]['name']:24s} {people[s['holder']]['party']} {s['area']}")
