"""Fills in what sits around the elected seats once a seed's election has been run. Called by election.py for each county.

Departments and boards: every county and every city with seats gets the departments and boards for its size, from
content/government/departments.yaml. The executive names each head (the mayor or county mayor; where there is none,
the chair the commission picks from its own members). A head is a pop leader who lives there, has a job bound to the
department and shares the executive's party; where there is none, someone is hired from within the department. Heads
and board members keep their pops. Confirmation votes are not simulated yet.
Organizations: every chapter in docs/data/orgs elects a leader from the pop leaders who belong to it. Each pop backs
the candidate it thinks most of, and its vote counts for the members it has in the chapter. The two parties have a
chapter in every county, chosen the same way by their own people.
Camps: inside each party, every camp with enough people stands as its own organization; smaller ones join their set
partner until each is big enough, and a party left with one has none. Their leaders are chosen the same way, from pop
leaders of the party whose own pop sits in one of the organization's camps. Needs docs/data/camps (build/camps.py).
"""
import json
import random
from pathlib import Path

import numpy as np
import yaml

HERE = Path(__file__).parent
ladder = yaml.safe_load(open(HERE.parent / "docs/content/government/departments.yaml"))
orgbook = yaml.safe_load(open(HERE.parent / "docs/content/organizations/organizations.yaml"))
campbook = yaml.safe_load(open(HERE.parent / "docs/content/camps/camps.yaml"))
issuebook = yaml.safe_load(open(HERE.parent / "docs/content/issues/issues.yaml"))["issues"]
BOUND = 3        # what a job bound to the department adds to Statecraft when judging a head
LOOK = 40        # how many local leaders an executive considers for each post
RUNNERS = 3      # candidates for a chapter's leadership


def tier_of(pops):
    return next(t for t in ladder["tiers"] if pops < t["under"])


def clubs(c, x, elect, leader_at, party_of, letter):
    """The camp organizations of each party in one county."""
    path = x.DATA / f"camps/fl-{c.fips}.json"
    if not path.exists():
        return []
    rows = json.load(open(path))["pops"]   # one row per pop: the camp of its Democrats, independents and Republicans
    assert len(rows) == len(c.pops), "run build/camps.py after the pops change"
    camps, out = campbook["camps"], []
    value = [{s[1]: s[0] for s in i["stops"]} for i in issuebook]
    for party, col in (("dem", 0), ("rep", 2)):
        mine = [k for k, camp in enumerate(camps) if camp["party"] == party]
        people = c.pie[letter[party]] * 100
        of = np.array([r[col] for r in rows])
        size = {camps[k]["id"]: float(people[of == k].sum()) for k in mine}
        home, total = {cid: cid for cid in size}, sum(size.values())
        folds = {camp["id"]: camp["folds"] for camp in camps if camp["party"] == party}
        own = {camp["id"]: {**campbook["bar"], **camp.get("bar", {})} for camp in camps}   # a camp may set its own bar
        need = lambda h, what: min(own[cid][what] for cid in home if home[cid] == h)
        fits = lambda h: size[h] >= need(h, "people") and size[h] / total >= need(h, "share")
        while len(set(home.values())) > 1:
            heads = set(home.values())
            small = [h for h in heads if not fits(h)]
            if not small:
                break
            least, seen = min(small, key=lambda h: size[h]), set()
            to = folds[least]
            while home[to] == least:   # its partner already sits inside it: follow the chain, or take the largest other
                seen.add(to)
                to = folds[to]
                if to in seen:
                    to = max((h for h in heads if h != least), key=lambda h: size[h])
                    break
            to = home[to]
            for cid in home:
                if home[cid] == least:
                    home[cid] = to
            size[to] += size.pop(least)
        heads = set(home.values())
        if len(heads) < 2:
            continue
        for head in sorted(heads, key=lambda h: -size[h]):
            held = [camp for camp in camps if camp["party"] == party and home[camp["id"]] == head]
            ids = [camp["id"] for camp in held]
            name = held[0]["club"] if len(held) == 1 else next((u["name"] for u in campbook["umbrellas"] if sorted(u["holds"]) == sorted(ids)), campbook["united"][party])
            inside = np.isin(of, [k for k in mine if camps[k]["id"] in ids])
            weights = np.where(inside, people, 0.0)
            leader, vote = elect(weights, [j for j, pid in enumerate(leader_at) if party_of(pid) == party and inside[j]])
            stand = []
            for n, issue in enumerate(issuebook):   # the stop nearest the middle of its camps' positions
                middle = sum(value[n][camp["positions"][issue["id"]]] for camp in held) / len(held)
                stand.append(min(range(len(issue["stops"])), key=lambda i: abs(issue["stops"][i][0] - middle)))
            out.append({"org": "+".join(ids), "name": name, "kind": "party", "party": party, "camps": ids, "members": int(round(size[head])), "leader": leader, "vote": vote, "stand": stand})
    return out


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
    chapters += clubs(c, x, elect, leader_at, party_of, letter)
    seed["chapters"] = chapters
    return len(departments), len(boards), hires, len(chapters)
