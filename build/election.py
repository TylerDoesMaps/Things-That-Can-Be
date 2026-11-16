#!/usr/bin/env python3
"""Runs the seed's starting election: every seat that is up in 2024, with no campaign.

Run after game.py. The presidency is an open race between two candidates from outside the state. Every other sitting official up for election runs again; the other party's nominee is drawn from the
characters who live in the seat's area, and may not file where the seat is lopsided or draws little attention.
Everyone who runs, and everyone in office, is given traits. Each pop then votes from its own lean and turnout,
moved by how the two candidates' stats and traits sit with that kind of pop, by where the candidates live, by
incumbency, and by the top of the ticket. The winners take the offices and pop mood is reset from who won.
The shifts listed as active in content/shifts.yaml are applied to every pop first.
With a number, runs that many more elections with other candidates and only reports the top lines, changing nothing.
With "match", pits the best and worst candidates the traits allow against each other for president, changing nothing.
Usage: election.py DATA_DIR COUNTY_TABLE_CSV OFFICES_YAML TRAITS_YAML NAMES_JSON SEED [TRIALS | match]
"""
import csv
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import yaml

DATA, TABLE, OFFICES, TRAITS, NAMES, SEED = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5]), int(sys.argv[6])
MODE = sys.argv[7] if len(sys.argv) > 7 else ""  # a number of trial elections, or "match" for the best and worst candidates head to head
TRIALS = int(MODE) if MODE.isdigit() else 0
SHIFTS = yaml.safe_load(open(Path(sys.argv[3]).parent.parent / "shifts.yaml"))
YEAR, SIZE = 2024, 100
# ---- the dials. Points are points of vote share near an even race.
STAT_POINTS = {"cha": 0.6, "gri": 0.25, "dip": 0.25, "sta": 0.15, "cun": 0.15}  # per point of the stat
HOME_HOOD, HOME_AREA, INCUMBENT = 4.0, 2.0, 2.0  # in the candidate's own neighbourhood; own district or county; for a sitting official
CAP = 12.0          # the pull toward the mean: however lopsided the candidates, the swing flattens out toward this many points
COATTAIL = 0.3      # share of the presidential swing that carries down to other party races
NO_PARTY = 0.35     # how much of a pop's party lean still counts in a race with no party on the ballot
POINT = 0.04        # one point, in log-odds
FILE_AT = 0.35      # a party always fields someone where it has at least this share; below that, in proportion
ATTENTION = {"federal": 1.0, "state": 1.0, "county": 0.85, "school": 0.7, "district": 0.5}  # chance a seat draws a challenger at all
ROLLOFF = {"us.president": 1.0, "us.senator": 0.985, "us.representative": 0.97, "fl.senator": 0.95, "fl.representative": 0.95, "fl.state_attorney": 0.93, "fl.public_defender": 0.92,
           "fl.county_judge": 0.78, "school.board": 0.8, "district.conservation": 0.65}  # share of voters who fill in the race; county party races 0.93
NATION_GAP = 11.6   # Florida's 2024 margin less the country's, in points: the country is this much less Republican than Florida
BLUE = {"Factory and plant", "Building and transport", "Oil, gas and mining"}
JOBS = {"Farm and ranch": ["farmer", "rancher"], "Oil, gas and mining": ["tradesman", "lineman"], "Factory and plant": ["factory_worker", "mechanic", "tradesman"],
        "Building and transport": ["construction_worker", "truck_driver", "tradesman", "lineman"], "Shops and service": ["small_business_owner", "salesperson", "restaurant_worker", "realtor", "barber"],
        "Office and professional": ["attorney", "accountant", "business_executive", "banker", "engineer", "realtor", "journalist"], "Schools and health": ["teacher", "nurse", "physician", "professor", "social_worker"],
        "Government and military": ["government_employee", "police_officer", "firefighter", "veteran"], "Retired": ["veteran", "teacher", "small_business_owner", "business_executive", "nurse"], "Student": ["office_worker"]}
HIGH_JOBS = ["attorney", "attorney", "business_executive", "banker", "physician", "small_business_owner", "teacher", "veteran", "farmer", "lobbyist"]

offices = {o["id"]: o for o in yaml.safe_load(open(OFFICES))["offices"]}
book = yaml.safe_load(open(TRAITS))
trait = {t["id"]: t for family in book["families"].values() for t in family}
names = json.load(open(NAMES))
table = [r for r in csv.DictReader(open(TABLE)) if (DATA / f"seeds/{SEED}/fl-{r['fips']}.json").exists()]
by_code = {r["code"]: r for r in table}


def logit(x):
    return np.log(np.clip(x, 0.001, 0.999) / (1 - np.clip(x, 0.001, 0.999)))


def pick(rng, rows):
    spot, mark = rng.random() * sum(w for _, w in rows), 0
    for value, weight in rows:
        mark += weight
        if spot <= mark:
            return value
    return rows[-1][0]


# ---------- the world as game.py left it
class County:
    def __init__(self, r):
        f = r["fips"]
        self.row, self.fips, self.code = r, f, r["code"]
        self.game = json.load(open(DATA / f"game/fl-{f}.json"))
        self.seed = json.load(open(DATA / f"seeds/{SEED}/fl-{f}.json"))
        pops = json.load(open(DATA / f"pops/fl-{f}.json"))["pops"]
        places = self.game["places"]
        self.hoods = [p for p in places.values() if p["kind"] == "hood"]
        number = {h["id"]: i for i, h in enumerate(self.hoods)}
        self.pops = pops
        self.hood = np.array([number[p["hood"]] for p in pops])
        col = lambda key: np.array([h[key] for h in self.hoods])[self.hood]
        self.district, self.house, self.senate, self.congress = col("district"), col("house"), col("senate"), col("congress")
        self.lean = logit(np.array([p["rep"] for p in pops]))
        self.pie = {k: np.array([p["pie"][k] for p in pops]) for k in "RID"}
        self.turnout = np.array([p["turnout"] for p in pops])
        text = lambda key: np.array([p[key] for p in pops])
        edu, inc, area, age, work, self.race = text("education"), text("income"), text("area"), text("age"), text("work"), text("race")
        self.text = {"education": edu, "income": inc, "area": area, "age": age, "work": work, "race": self.race}
        self.shift(SHIFTS.get("active") or [])
        self.aud = {"everyone": np.ones(len(pops)), "no_college": edu == "No college", "college": edu == "Bachelor's or more", "low_income": inc == "Under $35,000", "high_income": inc == "Over $150,000",
                    "rural": area == "rural", "small_town": area == "small town", "urban": area == "urban", "suburban": area == "suburban", "young": age == "18 to 29", "old": age == "65 and over",
                    "farm": work == "Farm and ranch", "blue_collar": np.isin(work, list(BLUE)), "service": work == "Shops and service", "government": work == "Government and military"}
        self.pop_of = {p["id"]: p for p in pops}
        self.leaders = [(self.seed["leaders"][p["id"]], i) for i, p in enumerate(pops)]  # (person, index of the pop they speak for)

    def shift(self, shifts):
        """Sets the moves that apply to every race: lean in points toward the Republican, turnout in points, by pop."""
        n = len(self.pops)
        self.move, self.more, self.fired = np.zeros(n), np.zeros(n), {"R": 0.0, "I": 0.0, "D": 0.0}
        for s in shifts:
            kind, _, value = s["who"].partition(":")
            if kind == "party":
                k = {"republicans": "R", "independents": "I", "democrats": "D"}[value]
                self.move += s.get("lean", 0) * self.pie[k]
                self.fired[k] += s.get("turnout", 0)
            else:
                mask = np.ones(n) if kind == "everyone" else (self.text[kind] == value)
                self.move += s.get("lean", 0) * mask
                self.more += s.get("turnout", 0) * mask

    def voters(self, area):
        """Which of this county's pops vote for a seat with this area."""
        if area in ("state", "country", self.game["places"][self.row["name"].lower().replace(" ", "-").replace(".", "")]["id"]) or area.startswith("circuit-"):
            return np.ones(len(self.pops), bool)
        for word, field in (("house-", self.house), ("senate-", self.senate), ("cd-", self.congress)):
            if area.startswith(word):
                return field == int(area.split("-")[1])
        place = self.game["places"].get(area)
        if place and place["kind"] == "district":
            return self.district == int(area.split("-D")[1])
        return np.zeros(len(self.pops), bool)


counties = {r["fips"]: County(r) for r in table}
state = json.load(open(DATA / f"seeds/{SEED}/fl-state.json"))
people = dict(state["people"])
for c in counties.values():
    people.update(c.seed["people"])
if any(s.get("won") for s in state["seats"]):
    sys.exit("This seed's election has already been run. Run game.py first.")
county_id = {c.fips: c.row["name"].lower().replace(" ", "-").replace(".", "") for c in counties.values()}
home_of = {}  # person -> (fips, hood number, district, race)
for c in counties.values():
    for pid, i in c.leaders:
        home_of[pid] = (c.fips, int(c.hood[i]), int(c.district[i]), c.pops[i]["race"], i)


# ---------- traits: the same person always draws the same ones
def dress(pid):
    person = people[pid]
    if "traits" in person:
        return person
    rng = random.Random(f"{SEED}|traits|{pid}")
    where = home_of.get(pid)
    pop = counties[where[0]].pops[where[4]] if where else None
    area, income, edu, work = (pop["area"], pop["income"], pop["education"], pop["work"]) if pop else ("suburban", "$75,000 to $150,000", "Bachelor's or more", None)
    up = pick(rng, [("middle_family", 30), ("working_family", 22 if edu != "Bachelor's or more" else 10), ("poor_family", 12 if income == "Under $35,000" else 5), ("wealthy_family", 14 if income == "Over $150,000" else 4),
                    ("farm_family", 20 if area == "rural" else 8 if area == "small town" else 1), ("military_family", 7), ("clergy_family", 4), ("political_family", 3 if pop else 12),
                    ("immigrant_family", 10 if pop and pop["race"] in ("Hispanic", "Asian") else 1)])
    level = pick(rng, [(1, 50), (2, 30), (3, 15), (4, 5)])
    child = rng.choice([t["id"] for t in book["families"]["childhood"] if t["level"] == level])
    job = rng.choice(JOBS[work]) if work else rng.choice(HIGH_JOBS)
    mine, shut = [], set()
    pool = [t for t in book["families"]["personality"]]
    rng.shuffle(pool)
    for t in pool:
        if len(mine) >= rng.choice([3, 4, 4, 5]):
            break
        if t["id"] not in shut:
            mine.append(t["id"])
            shut.add(t.get("opposite"))
    traits = [up, child, job] + mine
    stats = {k: 2 for k in STAT_POINTS}
    for t in traits:
        for k, v in trait[t]["stats"].items():
            stats[k] += v
    person["traits"], person["stats"] = traits, {k: max(0, min(10, v)) for k, v in stats.items()}
    person.setdefault("race", where[3] if where else "White")
    return person


def appeal(pid, c, who, against_incumbent, wide):
    """Points of vote share this candidate is worth with each of the county's pops in `who`."""
    person = dress(pid)
    points = np.full(who.sum(), sum(STAT_POINTS[k] * v for k, v in person["stats"].items()))
    for t in person["traits"]:
        for audience, worth in trait[t].get("likes", {}).items():
            if audience == "base":
                points += worth * c.pie["R" if person["party"] == "rep" else "D" if person["party"] == "dem" else "I"][who]
            elif audience == "independents":
                points += worth * c.pie["I"][who]
            elif audience == "same_race":
                points += worth * (c.race[who] == person["race"])
            elif audience == "against_incumbent":
                points += worth * against_incumbent
            else:
                points += worth * c.aud[audience][who]
    where = home_of.get(pid)
    if where and where[0] == c.fips:
        points += HOME_HOOD * (c.hood[who] == where[1])
        points += HOME_AREA * (np.ones(who.sum()) if wide else (c.district[who] == where[2]))
    return points


def pull(points):
    return CAP * np.tanh(points / CAP)


# ---------- the ballot
def races():
    out = []
    for s in state["seats"]:
        if YEAR in s["next"]:
            out.append({"seat": s, "key": f"{s['office']}|{s['label']}", "where": list(counties), "wide": True})
    for c in counties.values():
        for s in c.seed["seats"]:
            if YEAR in s["next"] and s["chosen"] == "elected" and s["government"] != "city":
                out.append({"seat": s, "key": f"{c.fips}|{s['office']}|{s['label']}", "where": [c.fips], "wide": False})
    return out


def lean_of(race):
    """Republican share of the two-party vote among the seat's voters before any candidate is named, and how many pops vote."""
    r = t = n = 0
    for f in race["where"]:
        c = counties[f]
        who = c.voters(race["seat"]["area"])
        w = c.turnout[who]
        r += (w / (1 + np.exp(-c.lean[who]))).sum()
        t += w.sum()
        n += int(who.sum())
    return (r / t if t else 0.5), n


def pool_for(race, party, holders):
    seat, out = race["seat"], []
    for f in race["where"]:
        c = counties[f]
        who = c.voters(seat["area"])
        if not race["wide"] and seat["label"].startswith("District ") and seat["office"] == "county.commissioner":
            who = c.district == int(seat["label"].split()[1])  # where commissioners are elected countywide they must still live in the district
        for pid, i in c.leaders:
            if who[i] and pid not in holders and (party is None or people[pid]["party"] == party):
                out.append(pid)
    return out


def run(roll, keep):
    rng = random.Random(f"{SEED}|election|{roll}")
    ballot = races()
    holders = {s["holder"] for s in state["seats"]} | {s["holder"] for c in counties.values() for s in c.seed["seats"]}
    drafted = set()
    for race in ballot:
        seat = race["seat"]
        share, size = lean_of(race)
        race["lean"] = share
        sitting = seat["holder"]
        a = b = None
        if seat["partisan"]:
            if people[sitting]["party"] in ("rep", "dem") and seat["office"] != "us.president":  # the presidency is an open race in 2024
                cands = {people[sitting]["party"]: sitting}
            else:
                cands = {}
            for party in ("rep", "dem"):
                if party in cands:
                    continue
                own = share if party == "rep" else 1 - share
                files = len(cands) == 0 or rng.random() < min(1, own / FILE_AT) * ATTENTION[seat["government"]]
                if not files:
                    continue
                if seat["office"] == "us.president":  # from outside the state
                    pid = f"s{SEED}-x-president-{party}-{roll}"
                    people[pid] = {"id": pid, "name": f"{pick(rng, names['first'][rng.choice('MF') + '|White'])} {pick(rng, names['last']['White'])}", "party": party, "home": "Elsewhere", "race": "White"}
                    cands[party] = pid
                else:
                    pool = [p for p in pool_for(race, party, holders) if p not in drafted]
                    if pool:
                        cands[party] = rng.choice(pool)
            a, b = cands.get("rep"), cands.get("dem")
            if a is None and b is None:
                a = sitting
        else:
            a = sitting
            if rng.random() < ATTENTION[seat["government"]] * 0.8:
                pool = [p for p in pool_for(race, None, holders) if p not in drafted]
                b = rng.choice(pool) if pool else None
        race["a"], race["b"], race["sitting"] = a, b, sitting
        drafted.update(x for x in (a, b) if x)
    # the vote, county by county
    top = next(r for r in ballot if r["seat"]["office"] == "us.president")
    tally = {r["key"]: defaultdict(lambda: [0.0, 0.0]) for r in ballot}
    hoods = {}
    for c in counties.values():
        everyone = np.ones(len(c.pops), bool)
        coat = appeal(top["a"], c, everyone, top["sitting"] == top["b"], True) - appeal(top["b"], c, everyone, top["sitting"] == top["a"], True) + INCUMBENT * ((top["sitting"] == top["a"]) - (top["sitting"] == top["b"]))
        for race in ballot:
            if c.fips not in race["where"]:
                continue
            seat, a, b = race["seat"], race["a"], race["b"]
            who = c.voters(seat["area"])
            if not who.any():
                continue
            roll = ROLLOFF.get(seat["office"], 0.93)
            cast = SIZE * np.clip(c.turnout[who] + c.more[who] / 100, 0.02, 0.98) * roll
            if a is None or b is None:
                tally[race["key"]][c.fips][0 if a else 1] += cast.sum() * 0.75
                continue
            gap = appeal(a, c, who, race["sitting"] == b, race["wide"]) - appeal(b, c, who, race["sitting"] == a, race["wide"]) + INCUMBENT * ((race["sitting"] == a) - (race["sitting"] == b))
            if seat["partisan"]:
                if race is not top:
                    gap = gap + COATTAIL * coat[who]
                odds = c.lean[who] + POINT * (pull(gap) + c.move[who])
                extra = [SIZE * roll * c.fired[k] / 100 * c.pie[k][who] for k in "RID"]  # a fired-up party's own people turn out more
            else:
                side = {"rep": 1, "dem": -1}
                tilt = (side.get(people[a]["party"], 0) - side.get(people[b]["party"], 0)) / 2
                odds = NO_PARTY * tilt * (c.lean[who] + POINT * c.move[who]) + POINT * pull(gap)
                extra = [0, 0, 0]
            share = 1 / (1 + np.exp(-odds))
            for_a, for_b = cast * share + extra[0] + extra[1] * share, cast * (1 - share) + extra[2] + extra[1] * (1 - share)
            tally[race["key"]][c.fips][0] += for_a.sum()
            tally[race["key"]][c.fips][1] += for_b.sum()
            if race is top and keep:
                hoods[c.fips] = (np.bincount(c.hood[who], for_a, len(c.hoods)), np.bincount(c.hood[who], for_b, len(c.hoods)))
                c.gap = pull(gap)
    for race in ballot:
        votes = [sum(v[0] for v in tally[race["key"]].values()), sum(v[1] for v in tally[race["key"]].values())]
        race["votes"], race["by_county"] = votes, {f: [round(v[0]), round(v[1])] for f, v in tally[race["key"]].items()}
        race["winner"] = race["a"] if (race["b"] is None or votes[0] >= votes[1]) and race["a"] else race["b"]
    return ballot, top, hoods


def summary(ballot, top):
    fl = top["votes"][0] / sum(top["votes"]) * 100
    nation = (2 * fl - 100) - NATION_GAP
    won = Counter()
    for r in ballot:
        if r["seat"]["partisan"]:
            won[r["seat"]["government"], people[r["winner"]]["party"]] += 1
    unopposed = sum(1 for r in ballot if r["a"] is None or r["b"] is None)
    return {"florida_rep": round(fl, 1), "nation_margin": round(nation, 1), "president": "rep" if nation > 0 else "dem", "unopposed": unopposed, "races": len(ballot),
            "legislature_rep": sum(v for (g, p), v in won.items() if g == "state" and p == "rep"), "legislature_dem": sum(v for (g, p), v in won.items() if g == "state" and p == "dem"),
            "county_rep": sum(v for (g, p), v in won.items() if g in ("county", "school") and p == "rep"), "county_dem": sum(v for (g, p), v in won.items() if g in ("county", "school") and p == "dem")}


def florida(a, b, shifts=()):
    """Republican share of Florida's two-party vote for president between two given candidates, under the given shifts."""
    r = d = 0.0
    for c in counties.values():
        c.shift(list(shifts))
        who = np.ones(len(c.pops), bool)
        gap = appeal(a, c, who, False, True) - appeal(b, c, who, False, True)
        share = 1 / (1 + np.exp(-(c.lean + POINT * (pull(gap) + c.move))))
        cast = SIZE * np.clip(c.turnout + c.more / 100, 0.02, 0.98)
        r += (cast * share + SIZE * c.fired["R"] / 100 * c.pie["R"] + SIZE * c.fired["I"] / 100 * c.pie["I"] * share).sum()
        d += (cast * (1 - share) + SIZE * c.fired["D"] / 100 * c.pie["D"] + SIZE * c.fired["I"] / 100 * c.pie["I"] * (1 - share)).sum()
        c.shift(SHIFTS.get("active") or [])
    return r / (r + d) * 100


if MODE == "match":
    def made(pid, party, traits):
        stats = {k: 2 for k in STAT_POINTS}
        for t in traits:
            for k, v in trait[t]["stats"].items():
                stats[k] += v
        people[pid] = {"id": pid, "name": pid, "party": party, "home": "Elsewhere", "race": "White", "traits": traits, "stats": {k: max(0, min(10, v)) for k, v in stats.items()}}
        return pid

    def worth(t, party):  # what one trait is worth across the whole state, in points
        made("probe", party, [t])
        made("blank", party, [])
        total = weight = 0.0
        for c in counties.values():
            who = np.ones(len(c.pops), bool)
            total += ((appeal("probe", c, who, False, True) - appeal("blank", c, who, False, True)) * c.turnout).sum()
            weight += c.turnout.sum()
        return total / weight

    def build(party, best):
        chosen = []
        for family in ("upbringing", "childhood", "job"):
            ranked = sorted(book["families"][family], key=lambda t: worth(t["id"], party), reverse=best)
            chosen.append(ranked[0]["id"])
        shut, count = set(), 0
        for t in sorted(book["families"]["personality"], key=lambda t: worth(t["id"], party), reverse=best):
            if count < 5 and t["id"] not in shut:
                chosen.append(t["id"])
                shut.add(t.get("opposite"))
                count += 1
        return chosen

    sets = {(party, best): build(party, best) for party in ("rep", "dem") for best in (True, False)}
    for (party, best), traits in sets.items():
        made(f"{'best' if best else 'worst'}-{party}", party, traits)
        print(f"{'best' if best else 'worst'} {party}:", ", ".join(trait[t]["name"] for t in traits), people[f"{'best' if best else 'worst'}-{party}"]["stats"])
    made("plain-rep", "rep", [])
    made("plain-dem", "dem", [])
    print("no candidates at all:", round(florida("plain-rep", "plain-dem"), 1))
    for a, b in (("best-rep", "best-dem"), ("worst-rep", "worst-dem"), ("best-rep", "worst-dem"), ("worst-rep", "best-dem")):
        base = florida(a, b)
        lo, hi = -40.0, 40.0
        for _ in range(30):  # the universal shift that would make it a tie
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if florida(a, b, [{"who": "everyone", "lean": mid}]) < 50 else (lo, mid)
        print(f"{a} v {b}: Florida {base:.1f}% Republican; a universal shift of {(lo + hi) / 2:+.1f} points would tie it")
    for name, shifts in SHIFTS["presets"].items():
        print(f"preset {name}: worst-rep v best-dem {florida('worst-rep', 'best-dem', shifts):.1f}, plain {florida('plain-rep', 'plain-dem', shifts):.1f}")
    sys.exit()

if TRIALS:
    for roll in range(1, TRIALS + 1):
        ballot, top, _ = run(roll, False)
        print(roll, summary(ballot, top), flush=True)
    sys.exit()

ballot, top, hoods = run(0, True)
top_line = summary(ballot, top)
print(top_line)
nation_winner = top["a"] if top_line["president"] == "rep" else top["b"]
top["winner"] = nation_winner  # the country decides the presidency, not Florida alone
out = DATA / f"seeds/{SEED}/election-{YEAR}"
out.mkdir(parents=True, exist_ok=True)


def card(race):
    seat = race["seat"]
    cands = []
    for pid, votes in ((race["a"], race["votes"][0]), (race["b"], race["votes"][1])):
        if pid:
            p = dress(pid)
            cands.append({"id": pid, "name": p["name"], "party": p["party"], "votes": round(votes), "sitting": pid == race["sitting"], "won": pid == race["winner"]})
    return {"office": seat["office"], "title": seat["title"], "label": seat["label"], "government": seat["government"], "partisan": seat["partisan"], "area": seat["area"], "lean": round(float(race["lean"]), 3),
            "cands": cands, "by_county": race["by_county"] if race["wide"] else None}


# the winners take office
for race in ballot:
    seat = race["seat"]
    seat["holder"] = race["winner"]
    seat["next"] = [YEAR + int(offices[seat["office"]].get("term", 4))]
    seat["won"] = YEAR
    for pid in (race["a"], race["b"]):
        if pid:
            dress(pid)["ran"] = f"{seat['title']}{', ' + seat['label'] if seat['label'] else ''}, {YEAR}"
for s in state["seats"]:
    dress(s["holder"])
for c in counties.values():
    for s in c.seed["seats"]:
        dress(s["holder"])

MOODS = ["Angry", "Dissatisfied", "Neutral", "Content", "Happy"]
governor = people[next(s["holder"] for s in state["seats"] if s["office"] == "fl.governor")]["party"]
place_share = {}
for c in counties.values():
    board = Counter(people[s["holder"]]["party"] for s in c.seed["seats"] if s["office"] == "county.commissioner").most_common(1)[0][0]
    holds = {"federal": people[nation_winner]["party"], "state": governor, "local": board}
    for p in c.pops:
        for level, party in holds.items():
            with_them = p["rep"] if party == "rep" else 1 - p["rep"] if party == "dem" else 0.5
            c.seed["moods"][p["id"]][level] = MOODS[4] if with_them >= 0.8 else MOODS[3] if with_them >= 0.6 else MOODS[2] if with_them >= 0.4 else MOODS[1] if with_them >= 0.2 else MOODS[0]
    r, d = hoods[c.fips]
    number = {h["id"]: i for i, h in enumerate(c.hoods)}
    for q in c.game["places"].values():
        idx = [number[m] for m in q["members"]]
        rr, dd = r[idx].sum(), d[idx].sum()
        place_share[q["id"]] = [round(float(rr / (rr + dd)), 3) if rr + dd else None, round(float(rr + dd))]
    for pid in c.seed["people"]:
        c.seed["people"][pid] = people[pid]
    (DATA / f"seeds/{SEED}/fl-{c.fips}.json").write_text(json.dumps(c.seed, separators=(",", ":")))
    (out / f"fl-{c.fips}.json").write_text(json.dumps({"races": [card(r) for r in ballot if not r["wide"] and r["where"] == [c.fips]]}, separators=(",", ":")))
state["people"] = {pid: p for pid, p in people.items() if "-x-" in pid and (pid in state["people"] or pid in (top["a"], top["b"]))}
state["election"] = dict(top_line, year=YEAR, president=nation_winner, president_party=people[nation_winner]["party"])
(DATA / f"seeds/{SEED}/fl-state.json").write_text(json.dumps(state, separators=(",", ":")))
(out / "fl-state.json").write_text(json.dumps({"summary": state["election"], "races": [card(r) for r in ballot if r["wide"]]}, separators=(",", ":")))
(out / "map.json").write_text(json.dumps(place_share, separators=(",", ":")))
# ---- for the test panel: every pop in a few bytes, so the presidential vote can be recounted in the browser under any shifts
LISTS = {"race": ["White", "Black", "Hispanic", "Asian", "Other"], "age": ["18 to 29", "30 to 44", "45 to 64", "65 and over"], "education": ["No college", "Some college", "Bachelor's or more"],
         "area": ["urban", "suburban", "small town", "rural"], "income": ["Under $35,000", "$35,000 to $75,000", "$75,000 to $150,000", "Over $150,000"],
         "work": ["Farm and ranch", "Oil, gas and mining", "Factory and plant", "Building and transport", "Shops and service", "Office and professional", "Schools and health", "Government and military", "Retired", "Student"]}
BITS = {"race": 0, "age": 3, "education": 5, "area": 7, "income": 9, "work": 11}
cols, hood_ids, parents, base = defaultdict(list), [], [], 0
for c in counties.values():
    places = c.game["places"]
    muni = {m: q["id"] for q in places.values() if q["kind"] == "muni" for m in q["members"]}
    for h in c.hoods:
        hood_ids.append(h["id"])
        parents.append([f"{c.code}-D{h['district']}", muni[h["id"]], county_id[c.fips]])
    packed = np.zeros(len(c.pops), np.uint16)
    for key, at in BITS.items():
        packed |= (np.array([LISTS[key].index(v) for v in c.text[key]], np.uint16) << at)
    cols["hood"].append((c.hood + base).astype(np.uint16))
    cols["kind"].append(packed)
    cols["lean"].append(np.clip(np.round(c.lean * 100), -32000, 32000).astype(np.int16))
    cols["turnout"].append(np.round(c.turnout * 200).astype(np.uint8))
    cols["r"].append(np.round(c.pie["R"] * 255).astype(np.uint8))
    cols["i"].append(np.round(c.pie["I"] * 255).astype(np.uint8))
    cols["gap"].append(np.clip(np.round(c.gap * 10), -127, 127).astype(np.int8))
    base += len(c.hoods)
order = ["hood", "kind", "lean", "turnout", "r", "i", "gap"]
(out / "pops.bin").write_bytes(b"".join(np.concatenate(cols[k]).tobytes() for k in order))
(out / "pops.json").write_text(json.dumps({"n": int(sum(len(c.pops) for c in counties.values())), "columns": [[k, str(np.concatenate(cols[k]).dtype)] for k in order], "lists": LISTS, "bits": BITS,
                                           "hoods": hood_ids, "parents": parents, "point": POINT, "size": SIZE, "nation_gap": NATION_GAP, "presets": SHIFTS["presets"]}, separators=(",", ":")))
(DATA / "traits.json").write_text(json.dumps({"stats": book["stats"], "traits": {t["id"]: t["name"] for t in trait.values()}}, separators=(",", ":")))

# search: everyone in the seed under the first letter of each of their names, officeholders first
role = {}
for seat in state["seats"] + [s for c in counties.values() for s in c.seed["seats"]]:
    role.setdefault(seat["holder"], seat["title"] + (", " + seat["label"] if seat["label"] else "") + (", " + seat["county"] + " County" if seat["county"] else ""))
shelves = defaultdict(list)
for person in list(state["people"].values()) + [p for c in counties.values() for p in c.seed["people"].values()]:
    row = [person["id"], person["name"], person["party"], role.get(person["id"], ""), "" if person["id"] in role else person.get("home", "")]
    for letter in {word[0].lower() for word in person["name"].split() if word[0].isalpha()}:
        shelves[letter].append(row)
(DATA / f"seeds/{SEED}/search").mkdir(exist_ok=True)
for letter, rows in shelves.items():
    rows.sort(key=lambda x: (not x[3], x[1]))
    (DATA / f"seeds/{SEED}/search/{letter}.json").write_text(json.dumps(rows, separators=(",", ":")))
print(len(ballot), "races;", top_line["unopposed"], "unopposed; turnover:", sum(1 for r in ballot if r["winner"] != r["sitting"]))
