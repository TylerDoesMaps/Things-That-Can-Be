#!/usr/bin/env python3
"""Packs counties for the game shell and generates a seed's characters.

For each county writes the county file (every place: county, commission districts, cities and the unincorporated
area, neighbourhoods, with shape and what its pops add up to) and the seed file (one named leader per pop, a holder
for every seat, and each pop's starting mood). Holders of state and federal seats are generated once from the seed
and the seat, so they are the same people in every county. Characters are names and parties only for now.
Usage: game.py DATA_DIR OFFICES_YAML NAMES_JSON SEED COUNTY_FIPS [COUNTY_FIPS ...]
"""
import json
import random
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import yaml

DATA, OFFICES, NAMES, SEED, FIPS = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]), sys.argv[5:]
# What differs by county. at_large: commissioners elected by the whole county on top of the district seats.
# countywide: district seats are voted on by the whole county and the district is only where the holder must live.
COUNTIES = {"12065": {"name": "Jefferson", "code": "JEF"}, "12129": {"name": "Wakulla", "code": "WAK", "countywide": True}, "12073": {"name": "Leon", "code": "LEO", "at_large": 2}}
DORMANT = 10  # pops; a city under 1,000 people has no seats
MOODS = ["Angry", "Dissatisfied", "Neutral", "Content", "Happy"]
offices = yaml.safe_load(open(OFFICES))
names = json.load(open(NAMES))
ST = offices["state"]


def pick(rng, table):
    spot, mark = rng.random() * sum(w for _, w in table), 0
    for value, weight in table:
        mark += weight
        if spot <= mark:
            return value
    return table[-1][0]


def named(rng, race, taken):
    for _ in range(200):
        sex = rng.choice("MF")
        name = f"{pick(rng, names['first'][f'{sex}|{race}'])} {pick(rng, names['last'][race])}"
        if name not in taken:
            break
    taken.add(name)
    return name


def lean_party(rng, share):
    odds = share ** 3 / (share ** 3 + (1 - share) ** 3)
    return "rep" if rng.random() < odds else "dem"


loaded = {}
for f in FIPS:
    src = json.load(open(DATA / f"neighbourhoods/fl-{f}.json"))
    loaded[f] = {"src": src, "shapes": gpd.GeoDataFrame.from_features(src["shapes"], crs=4269).set_index("code"), "pops": json.load(open(DATA / f"pops/fl-{f}.json")),
                 "drawn": json.load(open(DATA / f"districts/fl-{f}.json"))}
# how the part of each wider district that we have built voted, to give its holder a party
wide = Counter()
for c in loaded.values():
    for h in c["pops"]["neighbourhoods"]:
        row = c["shapes"].loc[h["hood"]]
        for key in ("all", f"house-{int(row.house)}", f"senate-{int(row.senate)}", f"cd-{int(row.congress)}"):
            wide[key, "r"] += h["rep2024"]
            wide[key, "d"] += h["dem2024"]
taken, outsiders = set(), {}


def outside(key, partisan, share=None):
    """The same person for the same seat in every county."""
    if key not in outsiders:
        rng = random.Random(f"{SEED}|{key}")
        race = pick(rng, [("White", 60), ("Black", 15), ("Hispanic", 20), ("Asian", 3), ("Other", 2)])
        share = share if share is not None else wide["all", "r"] / (wide["all", "r"] + wide["all", "d"])
        party = lean_party(rng, share) if partisan else pick(rng, [("rep", 40), ("ind", 25), ("dem", 35)])
        outsiders[key] = {"id": f"s{SEED}-x-{key}", "name": named(rng, race, taken), "party": party, "home": "Elsewhere"}
    return outsiders[key]


for f in FIPS:
    cfg, c = COUNTIES[f], loaded[f]
    COUNTY, CODE, shapes, pops, drawn = cfg["name"], cfg["code"], c["shapes"], c["pops"]["pops"], c["drawn"]
    rng = random.Random(f"{SEED}|{f}")
    real = {h["hood"]: h for h in c["pops"]["neighbourhoods"]}
    city_of = {code: shapes.city[code] or "" for code in shapes.index}
    by_hood = {code: [] for code in shapes.index}
    for p in pops:
        by_hood[p["hood"]].append(p)
    places, features = {}, []

    def add(pid, kind, name, sub, members, geometry, extra=None):
        mine = [p for m in members for p in by_hood[m]]
        n = len(mine) or 1
        count = lambda key: dict(Counter(p[key] for p in mine).most_common())
        rep, dem, cast = (sum(real[m][k] for m in members) for k in ("rep2024", "dem2024", "votes2024"))
        places[pid] = {"id": pid, "kind": kind, "name": name, "sub": sub, "members": sorted(members), "pops": len(mine),
                       "party": [round(sum(p["pie"][k] for p in mine) / n, 3) for k in "RID"], "turnout": round(sum(p["turnout"] for p in mine) / n, 3),
                       "race": count("race"), "age": count("age"), "education": count("education"), "income": count("income"), "work": count("work"), "area": count("area"),
                       "rep2024": round(rep / (rep + dem), 3) if rep + dem else None, "votes2024": round(cast), **(extra or {})}
        features.append({"type": "Feature", "properties": {"id": pid, "kind": kind}, "geometry": json.loads(gpd.GeoSeries([geometry]).to_json())["features"][0]["geometry"]})

    hoods, district_of = list(shapes.index), drawn["assignment"]
    for code in hoods:
        add(code, "hood", code, f"Neighbourhood, {city_of[code] or 'outside any city'}", [code], shapes.geometry[code],
            {"city": city_of[code], "district": district_of[code], "house": int(shapes.house[code]), "senate": int(shapes.senate[code]), "congress": int(shapes.congress[code]),
             "local": real[code].get("local", 0.0)})
    for d in sorted(set(district_of.values())):
        members = [h for h in hoods if district_of[h] == d]
        add(f"{CODE}-D{d}", "district", f"District {d}", f"{COUNTY} County Commission district", members, shapes.geometry[members].union_all())
    for city in sorted(set(city_of.values())):
        members = [h for h in hoods if city_of[h] == city]
        add((city or "unincorporated").lower().replace(" ", "-").replace(".", ""), "muni", city or f"Unincorporated {COUNTY} County", "City" if city else "Outside any city", members, shapes.geometry[members].union_all())
    add(COUNTY.lower(), "county", f"{COUNTY} County", ST, hoods, shapes.geometry.union_all())

    # ---- a leader for every pop
    people, leader = dict((o["id"], o) for o in outsiders.values()), {}
    for p in pops:
        spot, pie = rng.random(), p["pie"]
        party = "rep" if spot < pie["R"] else "ind" if spot < pie["R"] + pie["I"] else "dem"
        pid = f"s{SEED}-{CODE}-{len(leader) + 1:05d}"
        people[pid] = {"id": pid, "name": named(rng, p["race"], taken), "party": party, "pop": p["id"], "home": p["hood"]}
        leader[p["id"]] = pid

    # ---- seats
    held, seats = set(), []

    def local(members, partisan):
        pool = [leader[p["id"]] for m in members for p in by_hood[m] if leader[p["id"]] not in held]
        if partisan:
            rep, dem = sum(real[m]["rep2024"] for m in members), sum(real[m]["dem2024"] for m in members)
            want = lean_party(rng, rep / (rep + dem))
            pool = [x for x in pool if people[x]["party"] == want] or pool
        choice = rng.choice(pool)
        held.add(choice)
        return choice

    def seat(office, label, holder, area, title=None):
        seats.append({"office": office["id"], "title": title or office["title"], "government": office["government"], "label": label, "holder": holder, "area": area,
                      "kind": office["kind"], "chosen": office["chosen"], "partisan": office.get("partisan", False), "next": office.get("next", [])})

    def far(key, office, share=None):
        o = outside(key, office.get("partisan", False) or office["chosen"] == "appointed", share)
        people[o["id"]] = o
        return o["id"]

    def share_of(key):
        return wide[key, "r"] / (wide[key, "r"] + wide[key, "d"])

    by_id = {o["id"]: o for o in offices["offices"]}
    cities = [q for q in places.values() if q["kind"] == "muni" and q["sub"] == "City" and q["pops"] >= DORMANT]
    for o in offices["offices"]:
        gov, partisan, oid = o["government"], o.get("partisan", False), o["id"]
        if oid in ("fl.appeal_judge", "fl.circuit_judge") or gov == "city":
            continue
        if oid == "county.commissioner":
            for d in sorted(set(district_of.values())):
                seat(o, f"District {d}", local(places[f"{CODE}-D{d}"]["members"], True), COUNTY.lower() if cfg.get("countywide") else f"{CODE}-D{d}")
            for i in range(cfg.get("at_large", 0)):
                seat(o, f"At large, Group {i + 1}", local(hoods, True), COUNTY.lower())
        elif gov in ("county", "school", "district") or oid == "fl.county_judge":
            many = o.get("seats", 1)
            for i in range(many):
                seat(o, f"Seat {i + 1}" if many > 1 else "", local(hoods, partisan), COUNTY.lower(), o["title"] if gov != "district" else o["title"])
        elif oid in ("fl.representative", "fl.senator", "us.representative"):
            field, word = {"fl.representative": ("house", "house"), "fl.senator": ("senate", "senate"), "us.representative": ("congress", "cd")}[oid]
            for n in sorted({places[h][field] for h in hoods}):
                seat(o, f"District {n}", far(f"{word}-{n}", o, share_of(f"{word}-{n}")), f"{word}-{n}")
        else:
            many = o.get("seats", 1)
            for i in range(many):
                seat(o, "", far(f"{oid}-{i + 1}", o, 0.5 if oid == "us.president" else None), "state" if gov == "state" else "country")
    for town in cities:
        if town["name"] == "Monticello":
            council = []
            for i in range(by_id["city.council"]["seats"]):
                council.append(local(town["members"], False))
                seat(by_id["city.council"], f"Group {i + 1}", council[-1], town["id"])
            seat(by_id["city.mayor.chosen"], "", rng.choice(council), town["id"])
            for oid in ("city.manager", "city.clerk", "city.police_chief"):
                seat(by_id[oid], "", local(town["members"], False), town["id"])
        else:  # a mayor and four commissioners, all elected by the whole city, and a manager they hire
            seat(by_id["city.mayor"], "", local(town["members"], False), town["id"])
            for i in range(by_id["city.council.generic"]["seats"]):
                seat(by_id["city.council.generic"], f"Seat {i + 1}", local(town["members"], False), town["id"])
            seat(by_id["city.manager"], "", local(town["members"], False), town["id"])

    # ---- mood toward each level starts higher where the pop's side holds it
    def side(office_id):
        return people[next(s["holder"] for s in seats if s["office"] == office_id)]["party"]

    board = Counter(people[s["holder"]]["party"] for s in seats if s["office"] == "county.commissioner").most_common(1)[0][0]
    holds = {"federal": side("us.president"), "state": side("fl.governor"), "local": board}
    moods = {}
    for p in pops:
        moods[p["id"]] = {}
        for level, party in holds.items():
            with_them = p["rep"] if party == "rep" else 1 - p["rep"]
            moods[p["id"]][level] = "Content" if with_them >= 0.65 else "Neutral" if with_them >= 0.4 else "Dissatisfied"

    (DATA / "game").mkdir(parents=True, exist_ok=True)
    (DATA / f"game/fl-{f}.json").write_text(json.dumps({"county": COUNTY, "state": ST, "code": CODE, "fips": f, "bounds": c["src"]["bounds"], "places": places, "holds": holds,
                                                         "calibration": c["pops"]["summary"]["calibration"], "shapes": {"type": "FeatureCollection", "features": features}, "lines": c["src"]["lines"]}, separators=(",", ":")))
    (DATA / f"seeds/{SEED}").mkdir(parents=True, exist_ok=True)
    (DATA / f"seeds/{SEED}/fl-{f}.json").write_text(json.dumps({"seed": SEED, "people": people, "leaders": leader, "seats": seats, "moods": moods}, separators=(",", ":")))
    print(COUNTY, len(places), "places,", len(people), "people,", len(seats), "seats;", dict(Counter(people[s["holder"]]["party"] for s in seats)), holds, [q["name"] for q in cities])
(DATA / "game/counties.json").write_text(json.dumps([{"fips": f, "name": COUNTIES[f]["name"], "state": ST} for f in FIPS]))
