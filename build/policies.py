"""The policy list and what a bill needs to know about every government.

    python3 policies.py DATA_DIR [SEED]

Reads docs/content/policies/*.yaml, the toolbox files (run toolbox.py first) and one seed, and writes
docs/data/policies.json:

  policies   the policy list as written, in order
  issues     for each position a policy folds under: its Keep stop and each party's pull
  bins       how the histograms of pop scores are cut
  govs       every government that can pass a bill: its pops, its rough tax bases, its chambers and members.
             A member is [seat, name, party, area, score on each issue]
  areas      for every government and district, a histogram of its pops' scores on each issue, split by party

A pop's ideal for a policy is today's value moved by its score against the Keep stop, so the page can
place every pop on Raise, Keep or Lower against any value, and move them when the value changes.
"""
import csv
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import yaml

DATA = Path(sys.argv[1])
SEED = sys.argv[2] if len(sys.argv) > 2 else "1"
CONTENT = DATA.parent / "content"

book = {"policies": []}
for f in sorted((CONTENT / "policies").glob("*.yaml")):
    part = yaml.safe_load(f.read_text())
    book["policies"] += part.pop("policies")
    book.update(part)
ISSUES = list(dict.fromkeys(p["position"] for p in book["policies"]))

T = json.loads((DATA / "toolbox.json").read_text())
N = T["pops"]
raw = (DATA / "toolbox.bin").read_bytes()
wide = {k: np.frombuffer(raw, "<u2", N, i * 2 * N) for i, k in enumerate(T["columns"]["wide"])}
at = 2 * N * len(T["columns"]["wide"])
small = {k: np.frombuffer(raw, "u1", N, at + i * N) for i, k in enumerate(T["columns"]["small"])}
at += N * len(T["columns"]["small"])
rest = np.frombuffer(raw, "i1", N * len(T["issues"]), at).reshape(N, len(T["issues"]))
issue_at = {i["id"]: k for k, i in enumerate(T["issues"])}
score = np.stack([rest[:, issue_at[i]] for i in ISSUES], axis=1).astype(float)      # pops x issues, party pulls left out
pull = {"D": [T["issues"][issue_at[i]]["dem"] for i in ISSUES], "R": [T["issues"][issue_at[i]]["rep"] for i in ISSUES], "I": [0] * len(ISSUES)}
keep = []
for i in ISSUES:
    stops = T["issues"][issue_at[i]]["stops"]
    keep.append(next((s[0] for s in stops if s[1].startswith("Keep")), 0))
share = {"D": wide["dem"] / 1000, "R": wide["rep"] / 1000}
share["I"] = np.clip(1 - share["D"] - share["R"], 0, 1)

hood = np.array([[h[1], h[2], h[3], h[4], h[5], h[6] if h[6] is not None else -1] for h in T["hoods"]])[wide["hood"]]
county, district, house, senate, congress, muni = hood.T

# every pop's id, in the order the toolbox wrote them, and how much of its home is owned
pop_at, owners = {}, np.zeros(N)
n = 0
with open(Path(__file__).parent / "fl-counties.csv") as f:
    by_prefix = {r["code"]: r for r in csv.DictReader(f)}
for c in T["counties"]:
    row = by_prefix[c[2]]
    for p in json.loads((DATA / "pops" / f"fl-{row['fips']}.json").read_text())["pops"]:
        pop_at[p["id"]] = n
        owners[n] = p.get("owners", 0.6)
        n += 1
assert n == N, (n, N)

# rough tax bases: statewide totals shared out among pops by income, and by ownership for property
w_inc = np.array([0.35, 0.75, 1.4, 3.5])[small["income"]]
shares = {"income": w_inc, "wages": w_inc, "profits": w_inc, "value": w_inc * (0.4 + owners), "sales": w_inc ** 0.6, "gallons": np.ones(N), "rooms": np.ones(N)}
B = {k: float(v) for k, v in book["bases"].items()}
per_pop = {k: B[k] * v / v.sum() for k, v in shares.items()}

LO, STEP, NB = -160, 20, 16
def cut(mask):
    """Histogram of every pop's score on every issue in this area, one per party, weighted by the party's people."""
    out = []
    idx = np.flatnonzero(mask)
    for k in range(len(ISSUES)):
        for party in "DIR":
            s = score[idx, k] + pull[party][k]
            b = np.clip(((s - LO) // STEP).astype(int), 0, NB - 1)
            out += [int(round(x * 10)) for x in np.bincount(b, weights=share[party][idx], minlength=NB)]
    return out
def base(mask):
    out = {k: float(v[mask].sum()) for k, v in per_pop.items()}
    out["homes"], out["new_homes"] = B["homes"] * int(mask.sum()), B["new_homes"] * int(mask.sum())
    return {k: round(v) for k, v in out.items()}
def mean(mask):
    return score[mask].mean(axis=0) if mask.any() else np.zeros(len(ISSUES))

areas, masks = {}, {}
def area(key, mask):
    if key not in areas:
        areas[key], masks[key] = cut(mask), mask
    return key
everyone = np.ones(N, bool)
area("all", everyone)

people, seats = {}, []
for f in sorted((DATA / "seeds" / SEED).glob("fl-*.json")):
    j = json.loads(f.read_text())
    people.update(j["people"])
    seats += j["seats"]
county_at = {c[0]: i for i, c in enumerate(T["counties"])}
muni_at = {m[0]: i for i, m in enumerate(T["munis"])}
def area_of(a):
    if a in ("country", "state"):
        return "all"
    if a in county_at:
        return area(f"c:{county_at[a]}", county == county_at[a])
    if a in muni_at:
        return area(f"m:{muni_at[a]}", muni == muni_at[a])
    for word, col in (("house-", house), ("senate-", senate), ("cd-", congress)):
        if a.startswith(word):
            return area(f"{word[0] if word != 'cd-' else 'g'}:{a[len(word):]}", col == int(a[len(word):]))
    if "-D" in a:
        code, d = a.split("-D")
        i = next(k for k, c in enumerate(T["counties"]) if c[2] == code)
        return area(f"d:{i}:{d}", (county == i) & (district == int(d)))
    return "all"
def member(q):
    p = people.get(q["holder"])
    if not p:
        return None
    party = {"dem": "D", "rep": "R"}.get(p.get("party"), "I")
    key = area_of(q["area"])
    s = score[pop_at[p["pop"]]] if p.get("pop") in pop_at else mean(masks[key])
    jitter = [int(hashlib.md5((p["id"] + i).encode()).hexdigest()[:4], 16) % 17 - 8 for i in ISSUES]
    return [q["label"], p["name"], party, key, *[int(round(s[k] + pull[party][k] + jitter[k])) for k in range(len(ISSUES))]]
def chamber(name, pick):
    rows = [m for m in (member(q) for q in seats if pick(q)) if m]
    return {"name": name, "seats": rows} if rows else None

govs = []
def gov(gid, name, kind, key, chambers, county_name=""):
    mask = masks[key]
    chambers = [c for c in chambers if c]
    if mask.sum() and chambers:
        govs.append({"id": gid, "name": name, "kind": kind, "county": county_name, "pops": int(mask.sum()), "area": key, "base": base(mask), "chambers": chambers})
gov("us", "United States", "federal", "all", [chamber("House", lambda q: q["office"] == "us.representative"), chamber("Senate", lambda q: q["office"] == "us.senator")])
gov("fl", "Florida", "state", "all", [chamber("House", lambda q: q["office"] == "fl.representative"), chamber("Senate", lambda q: q["office"] == "fl.senator")])
code_of = {c[2]: c[0] for c in T["counties"]}
for i, c in enumerate(T["counties"]):
    key = area(f"c:{i}", county == i)
    mine = lambda q, c=c: q["area"] == c[0] or q["area"].startswith(c[2] + "-D")
    gov(c[0], c[1], "county", key, [chamber("Commission", lambda q: q["government"] == "county" and q["kind"] == "legislator" and mine(q))], c[1])
    gov("school:" + c[0], c[1].replace(" County", "") + " County School District", "school", key, [chamber("School board", lambda q: q["government"] == "school" and q["kind"] == "board" and mine(q))], c[1])
for i, m in enumerate(T["munis"]):
    key = area(f"m:{i}", muni == i)
    gov(m[0], m[1], "city", key, [chamber("Council", lambda q: q["government"] == "city" and q["kind"] == "legislator" and q["area"] == m[0])], T["counties"][m[2]][1])

out = {"year": book["year"], "drift": book["drift"], "bands_tax": book["bands_tax"], "bands_spend": book["bands_spend"], "policies": book["policies"],
       "issues": [{"id": i, "name": T["issues"][issue_at[i]]["name"], "keep": keep[k]} for k, i in enumerate(ISSUES)],
       "bins": {"lo": LO, "step": STEP, "n": NB}, "govs": govs, "areas": areas}
(DATA / "policies.json").write_text(json.dumps(out, separators=(",", ":")))
kinds = {}
for g in govs:
    kinds[g["kind"]] = kinds.get(g["kind"], 0) + 1
print(f"{len(book['policies'])} policies; {len(govs)} governments {kinds}; {len(areas)} areas; {(DATA / 'policies.json').stat().st_size / 1e6:.1f} MB")
