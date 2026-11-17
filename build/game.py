#!/usr/bin/env python3
"""Packs every county in the county table for the game and generates a seed's characters.

For each county writes the county file (every place: county, commission districts, cities and the unincorporated
area, neighbourhoods, with what its pops add up to) and the seed file (one named leader per pop, a holder for every
local seat, and each pop's starting mood). A leader who holds elected office stops leading: their pop gets a new leader and stays their home. State and federal seats and their holders go in one statewide seed file.
Shapes for the map are written to WORK_DIR/game for tiles.py. Characters are names and parties only for now.
Usage: game.py DATA_DIR WORK_DIR COUNTY_TABLE_CSV OFFICES_YAML NAMES_JSON SEED
"""
import csv
import json
import random
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import pandas as pd
import yaml

DATA, WORK, TABLE, OFFICES, NAMES, SEED = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5]), int(sys.argv[6])
DORMANT = 10  # pops; a city under 1,000 people has no seats
MOODS = ["Angry", "Dissatisfied", "Neutral", "Content", "Happy"]
ONE_WITH_COUNTY = {("Duval", "Jacksonville")}  # the city and the county are one government: the county's seats are the city's
offices = yaml.safe_load(open(OFFICES))
names = json.load(open(NAMES))
ST = offices["state"]
table = [r for r in csv.DictReader(open(TABLE)) if (DATA / f"districts/fl-{r['fips']}.json").exists()]
by_id = {o["id"]: o for o in offices["offices"]}


def pick(rng, rows):
    spot, mark = rng.random() * sum(w for _, w in rows), 0
    for value, weight in rows:
        mark += weight
        if spot <= mark:
            return value
    return rows[-1][0]


def named(rng, race, taken):
    for _ in range(50):
        sex = rng.choice("MF")
        name = f"{pick(rng, names['first'][f'{sex}|{race}'])} {pick(rng, names['last'][race])}"
        if name not in taken:
            break
    taken.add(name)
    return name


def lean_party(rng, share):
    odds = share ** 3 / (share ** 3 + (1 - share) ** 3)
    return "rep" if rng.random() < odds else "dem"


def slug(text):
    return text.lower().replace(" ", "-").replace(".", "").replace("'", "")


loaded = {}
for r in table:
    f = r["fips"]
    src = json.load(open(DATA / f"neighbourhoods/fl-{f}.json"))
    shapes = gpd.GeoDataFrame.from_features(src["shapes"], crs=4269).set_index("code")
    shapes["geometry"] = shapes.geometry.buffer(0)
    loaded[f] = {"src": src, "shapes": shapes, "pops": json.load(open(DATA / f"pops/fl-{f}.json")), "drawn": json.load(open(DATA / f"districts/fl-{f}.json"))}
# how each wider district voted, to give its holder a party
wide = Counter()
for r in table:
    c = loaded[r["fips"]]
    for h in c["pops"]["neighbourhoods"]:
        if h["hood"] not in c["shapes"].index:  # all water, left off the map
            continue
        row = c["shapes"].loc[h["hood"]]
        for key in ("all", f"house-{int(row.house)}", f"senate-{int(row.senate)}", f"cd-{int(row.congress)}", f"circuit-{r['circuit']}"):
            wide[key, "r"] += h["rep2024"]
            wide[key, "d"] += h["dem2024"]


def share_of(key):
    return wide[key, "r"] / max(1, wide[key, "r"] + wide[key, "d"])


taken, outsiders, state_seats = set(), {}, {}


def far(key, office, share):
    """The same person for the same seat wherever it is looked up."""
    if key not in outsiders:
        rng = random.Random(f"{SEED}|{key}")
        race = pick(rng, [("White", 60), ("Black", 15), ("Hispanic", 20), ("Asian", 3), ("Other", 2)])
        partisan = office.get("partisan", False) or office["chosen"] == "appointed"
        party = lean_party(rng, share) if partisan else pick(rng, [("rep", 40), ("ind", 25), ("dem", 35)])
        outsiders[key] = {"id": f"s{SEED}-x-{key}", "name": named(rng, race, taken), "party": party, "home": "Elsewhere"}
    return outsiders[key]["id"]


def seat_row(office, label, holder, area, county="", **over):
    row = {"office": office["id"], "title": office["title"], "government": office["government"], "label": label, "holder": holder, "area": area, "kind": office["kind"],
           "chosen": office["chosen"], "partisan": office.get("partisan", False), "next": office.get("next", []), "county": county}
    row.update(over)
    return row


def turn(n, first=2024):
    """Staggered seats: odd numbers vote in presidential years, even numbers in the years between (s. 100.041)."""
    return [first if n % 2 else first + 2]


def state_seat(office, label, key, area, share, next_up):
    if key not in state_seats:
        state_seats[key] = seat_row(office, label, far(key, office, share), area, next=next_up)


# seats above the county, once for the whole state
for o in offices["offices"]:
    oid, gov = o["id"], o["government"]
    if gov not in ("state", "federal") or oid in ("fl.appeal_judge", "fl.circuit_judge", "fl.county_judge"):
        continue
    if oid in ("fl.representative", "fl.senator", "us.representative"):
        word = {"fl.representative": "house", "fl.senator": "senate", "us.representative": "cd"}[oid]
        for n in sorted({int(k[0].split("-")[1]) for k in wide if k[0].startswith(word + "-")}):
            state_seat(o, f"District {n}", f"{word}-{n}", f"{word}-{n}", share_of(f"{word}-{n}"), turn(n) if oid == "fl.senator" else [2024])
    elif oid in ("fl.state_attorney", "fl.public_defender"):
        for n in sorted({int(r["circuit"]) for r in table}):
            state_seat(o, f"Circuit {n}", f"{oid}-{n}", f"circuit-{n}", share_of(f"circuit-{n}"), [2024])
    else:
        for i in range(o.get("seats", 1)):
            up = [2024] if oid == "us.president" else [[2024], [2028]][i] if oid == "us.senator" else [] if o["chosen"] == "appointed" else [2026]
            state_seat(o, "", f"{oid}-{i + 1}", "state" if gov == "state" else "country", 0.5 if oid == "us.president" else share_of("all"), up)

index, wider_parts, all_seats, everyone = [], [], [], []
(WORK / "game").mkdir(parents=True, exist_ok=True)
(DATA / "game").mkdir(parents=True, exist_ok=True)
(DATA / f"seeds/{SEED}").mkdir(parents=True, exist_ok=True)
for r in table:
    f, COUNTY, CODE = r["fips"], r["name"], r["code"]
    c = loaded[f]
    shapes, pops, drawn = c["shapes"], c["pops"]["pops"], c["drawn"]
    rng = random.Random(f"{SEED}|{f}")
    real = {h["hood"]: h for h in c["pops"]["neighbourhoods"]}
    city_of = {code: shapes.city[code] or "" for code in shapes.index}
    by_hood = {code: [] for code in shapes.index}
    for p in pops:
        by_hood[p["hood"]].append(p)
    places, geoms, county_id = {}, {}, slug(COUNTY)

    def add(pid, kind, name, sub, members, geometry, extra=None):
        mine = [p for m in members for p in by_hood[m]]
        n = len(mine) or 1
        count = lambda key: dict(Counter(p[key] for p in mine).most_common())
        rep, dem, cast = (sum(real[m][k] for m in members) for k in ("rep2024", "dem2024", "votes2024"))
        places[pid] = {"id": pid, "kind": kind, "name": name, "sub": sub, "members": sorted(members), "pops": len(mine),
                       "party": [round(sum(p["pie"][k] for p in mine) / n, 3) for k in "RID"], "turnout": round(sum(p["turnout"] for p in mine) / n, 3),
                       "race": count("race"), "age": count("age"), "education": count("education"), "income": count("income"), "work": count("work"), "area": count("area"),
                       "rep2024": round(rep / (rep + dem), 3) if rep + dem else None, "votes2024": round(cast), "county": county_id, "code": CODE, "fips": f, **(extra or {})}
        geoms[pid] = geometry

    hoods, district_of = list(shapes.index), drawn["assignment"]
    for code in hoods:
        add(code, "hood", code, f"Neighbourhood, {city_of[code] or 'outside any city'}", [code], shapes.geometry[code],
            {"city": city_of[code], "district": district_of[code], "house": int(shapes.house[code]), "senate": int(shapes.senate[code]), "congress": int(shapes.congress[code]),
             "circuit": int(r["circuit"]), "local": real[code].get("local", 0.0)})
    for d in sorted(set(district_of.values())):
        members = [h for h in hoods if district_of[h] == d]
        add(f"{CODE}-D{d}", "district", f"District {d}", f"{COUNTY} County Commission district", members, shapes.geometry[members].union_all())
    for city in sorted(set(city_of.values())):
        members = [h for h in hoods if city_of[h] == city]
        add(f"{CODE}-{slug(city or 'unincorporated')}".lower(), "muni", city or f"Unincorporated {COUNTY} County", "City" if city else "Outside any city", members, shapes.geometry[members].union_all())
    add(county_id, "county", f"{COUNTY} County", ST, hoods, shapes.geometry.union_all(), {"circuit": int(r["circuit"])})

    # ---- a leader for every pop
    people, leader, pop_by_id = {}, {}, {p["id"]: p for p in pops}
    for p in pops:
        spot, pie = rng.random(), p["pie"]
        party = "rep" if spot < pie["R"] else "ind" if spot < pie["R"] + pie["I"] else "dem"
        pid = f"s{SEED}-{CODE}-{len(leader) + 1:05d}"
        people[pid] = {"id": pid, "name": named(rng, p["race"], taken), "party": party, "pop": p["id"], "home": p["hood"]}
        leader[p["id"]] = pid

    # ---- local seats
    held, seats = set(), []

    def local(members, partisan):
        pool = [leader[p["id"]] for m in members for p in by_hood[m] if leader[p["id"]] not in held]
        if partisan:
            rep, dem = sum(real[m]["rep2024"] for m in members), sum(real[m]["dem2024"] for m in members)
            want = lean_party(rng, rep / max(1, rep + dem))
            pool = [x for x in pool if people[x]["party"] == want] or pool
        choice = rng.choice(pool or list(leader.values()))
        held.add(choice)
        return choice

    def seat(office, label, holder, area, **over):
        seats.append(seat_row(office, label, holder, area, COUNTY, **over))

    own_cycle = [int(r["city_cycle"])] if r["city_cycle"] else None  # Duval votes with Jacksonville, in the spring of odd years
    party_board = r["commission_partisan"] == "yes"
    o = dict(by_id["county.commissioner"], title="City Council Member" if COUNTY == "Duval" else by_id["county.commissioner"]["title"])
    for d in sorted(set(district_of.values())):
        seat(o, f"District {d}", local(places[f"{CODE}-D{d}"]["members"], party_board), county_id if r["countywide"] == "yes" else f"{CODE}-D{d}", partisan=party_board, next=own_cycle or turn(d))
    for i in range(1, int(r["at_large"]) + 1):
        seat(o, f"At large, Group {i}", local(hoods, party_board), county_id, partisan=party_board, next=own_cycle or turn(i))
    if r["executive"]:
        o = by_id["county.chair" if r["executive"] == "County Chair" else "county.mayor"]
        seat(o, "", local(hoods, party_board), county_id, partisan=party_board, next=[int(r["executive_next"])], title="Mayor of Jacksonville" if COUNTY == "Duval" else o["title"])
    plain = set(r["officers_nonpartisan"].split(";"))
    for oid in ("county.clerk", "county.property_appraiser", "county.sheriff", "county.elections", "county.tax_collector"):
        seat(by_id[oid], "", local(hoods, oid not in plain), county_id, partisan=oid not in plain, next=own_cycle if own_cycle and oid != "county.clerk" else [2024])
    for i in range(1, int(r["judges"]) + 1):
        seat(by_id["fl.county_judge"], f"Group {i}" if int(r["judges"]) > 1 else "", local(hoods, False), county_id, next=[[2024], [2026], [2028]][(i - 1) % 3])
    o, many = by_id["school.board"], int(r["board_districts"])
    for i in range(1, many + 1):  # boards of five: two seats with the president, three between; larger boards the other way round
        seat(o, f"District {i}", local(hoods, False), county_id, next=turn(i) if many > 5 else turn(i + 1))
    for i in range(1, int(r["board_at_large"]) + 1):
        seat(o, "Chair, at large" if COUNTY == "Orange" else f"At large, Seat {i}", local(hoods, False), county_id, next=turn(i))
    o = by_id["school.superintendent"]
    if r["superintendent"] == "elected":
        seat(o, "", local(hoods, True), county_id, next=[2024])
    else:
        seat(o, "", local(hoods, False), county_id, chosen="appointed", partisan=False, next=[])
    if r["soil"] == "yes":
        for i in range(1, 6):
            seat(by_id["district.conservation"], f"Seat {i}", local(hoods, False), county_id, next=turn(i + 1))
    for town in [q for q in places.values() if q["kind"] == "muni" and q["sub"] == "City" and q["pops"] >= DORMANT]:
        if (COUNTY, town["name"]) in ONE_WITH_COUNTY:
            continue
        if town["name"] == "Monticello":
            council = []
            for i in range(by_id["city.council"]["seats"]):
                council.append(local(town["members"], False))
                seat(by_id["city.council"], f"Group {i + 1}", council[-1], town["id"])
            seat(by_id["city.mayor.chosen"], "", rng.choice(council), town["id"])
        else:  # a mayor and four commissioners, all elected by the whole city. There is no hired manager: departments answer to the mayor
            seat(by_id["city.mayor"], "", local(town["members"], False), town["id"])
            for i in range(by_id["city.council.generic"]["seats"]):
                seat(by_id["city.council.generic"], f"Seat {i + 1}", local(town["members"], False), town["id"])

    # ---- nobody holds elected office and leads a pop: each pop whose leader sits in a seat gets a new leader
    for s in seats:
        old = people[s["holder"]]
        if s["chosen"] == "elected" and leader.get(old["pop"]) == old["id"]:
            p, spot = pop_by_id[old["pop"]], rng.random()
            pid = f"s{SEED}-{CODE}-{len(people) + 1:05d}"
            people[pid] = {"id": pid, "name": named(rng, p["race"], taken), "party": "rep" if spot < p["pie"]["R"] else "ind" if spot < p["pie"]["R"] + p["pie"]["I"] else "dem", "pop": p["id"], "home": p["hood"], "after": old["id"]}
            leader[p["id"]], old["heir"] = pid, pid

    # ---- mood toward each level starts higher where the pop's side holds it
    board = Counter(people[s["holder"]]["party"] for s in seats if s["office"] == "county.commissioner").most_common(1)[0][0]
    holds = {"federal": outsiders["us.president-1"]["party"], "state": outsiders["fl.governor-1"]["party"], "local": board}
    moods = {}
    for p in pops:
        moods[p["id"]] = {}
        for level, party in holds.items():
            with_them = p["rep"] if party == "rep" else 1 - p["rep"]
            moods[p["id"]][level] = MOODS[4] if with_them >= 0.8 else MOODS[3] if with_them >= 0.6 else MOODS[2] if with_them >= 0.4 else MOODS[1] if with_them >= 0.2 else MOODS[0]

    all_seats += seats
    everyone += people.values()
    (DATA / f"game/fl-{f}.json").write_text(json.dumps({"county": COUNTY, "state": ST, "code": CODE, "fips": f, "places": places, "holds": holds,
                                                         "calibration": c["pops"]["summary"]["calibration"]}, separators=(",", ":")))
    (DATA / f"seeds/{SEED}/fl-{f}.json").write_text(json.dumps({"seed": SEED, "people": people, "leaders": leader, "seats": seats, "moods": moods}, separators=(",", ":")))
    # shapes for the tiles, each with the numbers the map shades by
    rows = []
    for pid, q in places.items():
        n = q["pops"] or 1
        part = lambda key, value: round(q[key].get(value, 0) / n, 3)
        rows.append({"id": pid, "kind": q["kind"], "name": q["name"], "fips": f, "city": 1 if q["sub"] == "City" else 0, "pops": q["pops"], "pr": q["party"][0], "pi": q["party"][1], "pd": q["party"][2],
                     "r24": q["rep2024"] if q["rep2024"] is not None else 0.5, "local": q.get("local", 0.0), "race": next(iter(q["race"]), ""), "rw": part("race", "White"), "rb": part("race", "Black"),
                     "rh": part("race", "Hispanic"), "area": next(iter(q["area"]), ""), "ba": part("education", "Bachelor's or more"), "old": part("age", "65 and over"),
                     "inc": part("income", "Under $35,000"), "geometry": geoms[pid]})
    gpd.GeoDataFrame(rows, crs=4269).to_file(WORK / f"game/{f}.gpkg", driver="GPKG")
    wider_parts.append(shapes[["house", "senate", "congress", "geometry"]])
    b = c["src"]["bounds"]
    index.append({"fips": f, "id": county_id, "name": f"{COUNTY} County", "code": CODE, "market": r["market"], "circuit": int(r["circuit"]), "bounds": b, "pops": len(pops),
                  "places": [[q["id"], q["name"], q["kind"]] for q in places.values() if q["kind"] in ("muni", "district")]})
    print(COUNTY, len(places), "places,", len(people), "people,", len(seats), "seats", flush=True)

everything = pd.concat(wider_parts)
for field in ("house", "senate", "congress"):
    parts = everything.dissolve(field)
    gpd.GeoDataFrame({"n": parts.index.astype(int)}, geometry=parts.geometry.buffer(0.00005).buffer(-0.00005).values, crs=4269).to_file(WORK / f"game/{field}.gpkg", driver="GPKG")
(DATA / f"seeds/{SEED}/fl-state.json").write_text(json.dumps({"seed": SEED, "people": {o["id"]: o for o in outsiders.values()}, "seats": list(state_seats.values())}, separators=(",", ":")))
# ---- search: everyone in the seed, filed under the first letter of each of their names, officeholders first
role = {}
for seat in list(state_seats.values()) + all_seats:
    role.setdefault(seat["holder"], seat["title"] + (", " + seat["label"] if seat["label"] else "") + (", " + seat["county"] + " County" if seat["county"] else ""))
shelves = {}
for person in list(outsiders.values()) + everyone:
    row = [person["id"], person["name"], person["party"], role.get(person["id"], ""), "" if person["id"] in role else person.get("home", "")]
    for letter in {word[0].lower() for word in person["name"].split() if word[0].isalpha()}:
        shelves.setdefault(letter, []).append(row)
(DATA / f"seeds/{SEED}/search").mkdir(exist_ok=True)
for letter, rows in shelves.items():
    rows.sort(key=lambda x: (not x[3], x[1]))
    (DATA / f"seeds/{SEED}/search/{letter}.json").write_text(json.dumps(rows, separators=(",", ":")))
(DATA / "game/fl-index.json").write_text(json.dumps({"state": ST, "counties": index}, separators=(",", ":")))
for old in ("fl-lines.json", "counties.json"):
    (DATA / "game" / old).unlink(missing_ok=True)
print(len(index), "counties,", len(state_seats), "state and federal seats")
