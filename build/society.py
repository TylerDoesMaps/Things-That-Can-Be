"""Fills in what sits around the elected seats once a seed's election has been run. Called by election.py for each county.

Departments and boards: every county and every city with seats gets the departments and boards for its size, from
content/government/departments.yaml. The executive names each head (the mayor or county mayor; where there is none,
the chair the commission picks from its own members). A head is a pop leader who lives there, has a job bound to the
department and shares the executive's party; where there is none, someone is hired from within the department. Heads
and board members keep their pops. Confirmation votes are not simulated yet.
Organizations: every chapter in docs/data/orgs elects a leader from the pop leaders who belong to it. Each pop backs
the candidate it thinks most of, and its vote counts for the members it has in the chapter. The two parties have a
chapter in every county, chosen the same way by their own people.
"""
import json
import random
from pathlib import Path

import numpy as np
import yaml

HERE = Path(__file__).parent
ladder = yaml.safe_load(open(HERE.parent / "docs/content/government/departments.yaml"))
orgbook = yaml.safe_load(open(HERE.parent / "docs/content/organizations/organizations.yaml"))
BOUND = 3        # what a job bound to the department adds to Statecraft when judging a head
LOOK = 40        # how many local leaders an executive considers for each post
RUNNERS = 3      # candidates for a chapter's leadership


def tier_of(pops):
    return next(t for t in ladder["tiers"] if pops < t["under"])


def fill(c, x):
    """c is election.py's county; x carries its people, dress, appeal and names."""
    rng = random.Random(f"{x.SEED}|society|{c.fips}")
    people, seed, places = x.people, c.seed, c.game["places"]
    county_id = next(q["id"] for q in places.values() if q["kind"] == "county")
    everyone = np.ones(len(c.pops), bool)
    leader_at = [pid for pid, _ in c.leaders]
    party_of = lambda pid: people[pid]["party"]
    job_of = lambda pid: x.dress(pid)["traits"][2]

    # ---- who appoints: the elected executive, or the chair the commission picks
    seats = seed["seats"]
    board = [s for s in seats if s["office"] == "county.commissioner"]
    top = next((s for s in seats if s["office"] in ("county.mayor", "county.chair")), None)
    if not top:
        sides = [party_of(s["holder"]) for s in board]
        most = max(set(sides), key=sides.count)
        top = max((s for s in board if party_of(s["holder"]) == most), key=lambda s: (x.dress(s["holder"])["known"], x.dress(s["holder"])["stats"]["cha"]))
        top["chair"] = True
    governments = [(county_id, len(c.pops), everyone, top["holder"], True)]
    for s in seats:
        if s["office"].startswith("city.mayor"):
            town = places[s["area"]]
            governments.append((town["id"], town["pops"], np.isin(c.hood, [c.hood_number[m] for m in town["members"]]), s["holder"], False))

    # ---- departments and boards
    posted, departments, boards, hires = set(s["holder"] for s in seats), [], [], 0
    taken_by_officers = {f for office, fs in ladder["elected"].items() for f in fs}
    qualifies = lambda pid, functions: bool(set(ladder["jobs"].get(job_of(pid), [])) & set(functions))
    for gov, size, mask, boss, is_county in governments:
        t = tier_of(size)
        local = [leader_at[i] for i in np.nonzero(mask)[0]]
        side = party_of(boss)
        for name, functions in t["departments"]:
            if is_county:
                functions = [f for f in functions if f not in taken_by_officers]
            if not functions:
                continue
            if len(functions) == 1:
                name = ladder["functions"][functions[0]]
            look = [p for p in rng.sample(local, min(LOOK, len(local))) if p not in posted]
            fit = [p for p in look if qualifies(p, functions) and (side == "ind" or party_of(p) == side)]
            if fit:
                head, hired = max(fit, key=lambda p: x.dress(p)["stats"]["sta"]), False
            else:  # hired from within: knows the work and little else
                hires += 1
                job = rng.choice([j for j, fs in ladder["jobs"].items() if set(fs) & set(functions)])
                pop = c.pops[rng.choice(np.nonzero(mask)[0])]
                head, hired = f"s{x.SEED}-{c.code}-h{hires:04d}", True
                personal = rng.sample([t2["id"] for t2 in x.book["families"]["personality"]], 2)
                people[head] = seed["people"][head] = {"id": head, "name": x.named(rng, pop["race"]), "party": rng.choice(["rep", "ind", "ind", "dem"]), "home": gov, "race": pop["race"], "hired": name,
                                                       "traits": ["middle_family", rng.choice([t2["id"] for t2 in x.book["families"]["childhood"] if t2["level"] == 2]), job] + personal,
                                                       "stats": {"cha": rng.randint(1, 2), "sta": rng.randint(7, 9), "gri": rng.randint(1, 3), "dip": rng.randint(1, 2), "cun": rng.randint(1, 2)}, "known": 2, "known_in": gov}
            posted.add(head)
            departments.append({"gov": gov, "name": name, "functions": functions, "head": head, "hired": hired, "skill": x.dress(head)["stats"]["sta"] + BOUND})
        for name, functions in t["boards"]:
            if is_county:
                functions = [f for f in functions if f not in taken_by_officers] or functions
            look = [p for p in rng.sample(local, min(LOOK + 20, len(local))) if p not in posted]
            look.sort(key=lambda p: (qualifies(p, functions), side == "ind" or party_of(p) == side, x.dress(p)["stats"]["sta"]), reverse=True)
            members = look[:t["seats"]]
            posted.update(members)
            boards.append({"gov": gov, "name": name, "functions": functions, "members": members})
    seed["departments"], seed["boards"] = departments, boards
    seed["executives"] = {gov: boss for gov, _, _, boss, _ in governments}

    # ---- organizations: each chapter elects a leader
    src = json.load(open(x.DATA / f"orgs/fl-{c.fips}.json"))
    orgs = src["organizations"]
    m = np.zeros((len(orgs), len(c.pops)))
    for j, flat in enumerate(src["pies"]):
        m[flat[0::2], j] = flat[1::2]
    first = {}  # the organization each pop's leader belongs to, for each kind: the largest slice of their pop
    for kind in set(o[2] for o in orgs):
        rows = [i for i, o in enumerate(orgs) if o[2] == kind]
        best = np.array(rows)[m[rows].argmax(axis=0)]
        first[kind] = np.where(m[rows].max(axis=0) > 0, best, -1)
    letter = {"rep": "R", "ind": "I", "dem": "D"}
    worth = {}

    def regard(pid):  # every pop's opinion of this character, -100 to 100 before clipping: their appeal there, and how much of the pop shares their party
        if pid not in worth:
            worth[pid] = x.OPINION * x.appeal(pid, c, everyone, False, False) + x.PARTY_OPINION * (c.pie[letter[party_of(pid)]] - 1 / 3)
        return worth[pid]

    def elect(weights, eligible):
        eligible = [j for j in eligible if weights[j] > 0] or [int(weights.argmax())]
        odds = weights[eligible] / weights[eligible].sum()
        runners = [leader_at[j] for j in np.random.default_rng(rng.randrange(1 << 30)).choice(eligible, size=min(RUNNERS, len(eligible)), replace=False, p=odds)]
        choice = np.stack([regard(p) for p in runners]).argmax(axis=0)
        votes = [float(weights[choice == k].sum()) for k in range(len(runners))]
        order = sorted(range(len(runners)), key=lambda k: -votes[k])
        return runners[order[0]], [[runners[k], round(votes[k])] for k in order]

    chapters = []
    for i, (oid, name, kind) in enumerate(orgs):
        if oid not in src["chapters"]:
            continue
        leader, vote = elect(m[i], list(np.nonzero(first[kind] == i)[0]))
        chapters.append({"org": oid, "name": name, "kind": kind, "members": src["chapters"][oid], "leader": leader, "vote": vote})
    for o in orgbook["organizations"]:
        if o["kind"] == "party":
            weights = c.pie[letter[o["party"]]] * 100
            leader, vote = elect(weights, [j for j, pid in enumerate(leader_at) if party_of(pid) == o["party"]])
            chapters.append({"org": o["id"], "name": o["name"], "kind": "party", "members": int(round(weights.sum())), "leader": leader, "vote": vote})
    seed["chapters"] = chapters
    return len(departments), len(boards), hires, len(chapters)
