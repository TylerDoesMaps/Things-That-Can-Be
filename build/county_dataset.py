#!/usr/bin/env python3
"""Builds one row per county: results, ten race-by-education groups, age, income, urban share.

Connecticut uses the 2021 ACS, the last release on its 2020 counties.
Usage: county_dataset.py COUNTY_RAW WORK_DIR DATA_DIR
"""
import json
import sys
from pathlib import Path

import pandas as pd

RAW, WORK, DATA = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
RACES = {"wnh": "c15002h", "blk": "c15002b", "asn": "c15002d", "hsp": "c15002i"}


def acs(table, vintage):
    d = pd.read_csv(RAW / f"acs/{vintage}-{table}.dat", sep="|", dtype=str)
    d = d[d.GEO_ID.str.startswith("0500000US")].copy()
    d["fips"] = d.GEO_ID.str[-5:]
    return d.set_index("fips")


def num(d, table, n):
    col = f"{table.upper()}_E{n:03d}"
    return pd.to_numeric(d[col], errors="coerce")


def demographics(vintage):
    out = pd.DataFrame()
    total = acs("b15003", vintage)
    all_25 = num(total, "b15003", 1)
    all_col = sum(num(total, "b15003", n) for n in range(22, 26))
    taken_all, taken_col = 0, 0
    for race, table in RACES.items():
        d = acs(table, vintage)
        everyone = num(d, table, 1).reindex(all_25.index).fillna(0)
        college = (num(d, table, 6) + num(d, table, 11)).reindex(all_25.index).fillna(0)
        out[f"{race}_col"], out[f"{race}_non"] = college, everyone - college
        taken_all, taken_col = taken_all + everyone, taken_col + college
    out["oth_col"] = (all_col - taken_col).clip(lower=0)
    out["oth_non"] = ((all_25 - taken_all) - (all_col - taken_col)).clip(lower=0)
    groups = [f"{r}_{e}" for r in ("wnh", "blk", "hsp", "asn", "oth") for e in ("col", "non")]
    shares = out[groups].div(out[groups].sum(axis=1), axis=0).round(4)
    shares["adults_25"] = all_25

    age = acs("b01001", vintage)
    band = lambda a, b: sum(num(age, "b01001", n) + num(age, "b01001", n + 24) for n in range(a, b + 1))
    young, mid, older, senior = band(7, 11), band(12, 14), band(15, 19), band(20, 25)
    vap = young + mid + older + senior
    shares["vap"] = vap
    for name, value in [("age_18_29", young), ("age_30_44", mid), ("age_45_64", older), ("age_65", senior)]:
        shares[name] = (value / vap).round(4)
    shares["pop"] = num(acs("b01003", vintage), "b01003", 1)
    shares["cvap"] = num(acs("b29001", vintage), "b29001", 1)
    income = num(acs("b19013", vintage), "b19013", 1)
    shares["income"] = income.where(income > 0)
    return shares


counties = [f["properties"] for f in json.loads((WORK / "county.geojson").read_text())["features"]]
base = pd.DataFrame(counties).set_index("GEOID").rename(columns={"NAME": "name"})
modern, old = demographics(2024), demographics(2021)
demo = pd.concat([modern[~modern.index.str.startswith("09")], old[old.index.str.startswith("09")]])
table = base.join(demo)

urban = pd.read_excel(RAW / "2020_UA_COUNTY.xlsx", dtype=str)
urban["fips"] = urban.STATE.str.zfill(2) + urban.COUNTY.str.zfill(3)
table["urban"] = pd.to_numeric(urban.set_index("fips").POPPCT_URB, errors="coerce").reindex(table.index).mul(100).round(1)
land = pd.read_csv(RAW / "gaz.zip", sep="\t", dtype={"GEOID": str}, encoding="latin-1")
land.columns = [c.strip() for c in land.columns]
table["density"] = (table["pop"] / pd.to_numeric(land.set_index("GEOID").ALAND_SQMI).reindex(table.index)).round(1)


def results():
    d = pd.read_csv(RAW / "mit.csv", dtype={"county_fips": str})
    d = d[d.year.isin([2016, 2020, 2024]) & d.county_fips.notna()].copy()
    d["fips"] = d.county_fips.str.zfill(5)
    d["fips"] = d.fips.replace({"46113": "46102"})  # Oglala Lakota was renumbered in 2015.
    # Some counties list each voting method plus a TOTAL row; never count both.
    has_total = d[d["mode"] == "TOTAL"].groupby(["year", "fips"]).size().rename("has").reset_index()
    d = d.merge(has_total, how="left", on=["year", "fips"])
    d = d[d.has.isna() | (d["mode"] == "TOTAL")]
    d["state"] = d.fips.str[:2]
    votes = {}
    for year, part in d.groupby("year"):
        pivot = part.pivot_table(index="fips", columns="party", values="candidatevotes", aggfunc="sum").fillna(0)
        votes[int(year)] = pd.DataFrame({"d": pivot["DEMOCRAT"], "r": pivot["REPUBLICAN"], "t": pivot.sum(axis=1)})
    return votes


votes = results()
fips_to_state = dict(zip(table.index.str[:2], table.ST))
states = {}
for year, v in votes.items():
    grouped = v.groupby(v.index.str[:2]).sum()
    for code, row in grouped.iterrows():
        if code in fips_to_state:
            states.setdefault(fips_to_state[code], {})[str(year)] = [int(row.d), int(row.r), int(row.t)]
(DATA / "results/state_years.json").write_text(json.dumps(states, separators=(",", ":")))
us = {str(y): [int(sum(s[str(y)][i] for s in states.values())) for i in range(3)] for y in votes}
(DATA / "results/us_years.json").write_text(json.dumps(us))

for year, v in votes.items():
    v = v.reindex(table.index)
    # Alaska reports by House district, and those codes collide with borough codes.
    v.loc[v.index.str.startswith("02")] = float("nan")
    for k in "drt":
        table[f"{k}{year % 100}"] = v[k]

rel = pd.read_excel(RAW / "rel.xlsx", sheet_name="2020 County Summary", dtype={"FIPS": str})
rel["FIPS"] = rel.FIPS.str.zfill(5)
table["adherents"] = pd.to_numeric(rel.set_index("FIPS")["Adherents as % of Population"], errors="coerce").reindex(table.index).round(4)

table["in_model"] = (~table.ST.isin(["AK", "HI"])).astype(int)

CATHOLIC, LDS, MUSLIM = {"081"}, {"151"}, {"267"}
JEWISH = {"270", "271", "275", "276", "FGR", "FGS"}
BLACK = {"003", "005", "101", "141", "300", "301", "302", "304", "364", "232", "155", "D71", "F58", "E54", "445", "384",
         "110", "122", "120", "A47", "D59", "D92", "D83", "C22", "FGV", "F57"}
MAINLINE = {"449", "207", "193", "355", "019", "443", "093", "288", "157", "371", "293", "295", "391", "393", "225",
            "175", "176", "290", "389", "338", "292", "461"}
OTHER_FAITH = {"895", "896", "890", "891", "892", "056", "435", "239", "268", "408", "416", "425", "462", "490", "904",
               "303", "124", "FER", "233", "111"}
OTHER_CHRISTIAN = {"500", "272", "173", "087"}


def tradition(code, name):
    if code in CATHOLIC: return "rel_catholic"
    if code in LDS: return "rel_lds"
    if code in MUSLIM: return "rel_muslim"
    if code in JEWISH: return "rel_jewish"
    if code in BLACK: return "rel_black_prot"
    if code in MAINLINE: return "rel_mainline"
    if code in OTHER_FAITH: return "rel_other_faith"
    if code in OTHER_CHRISTIAN or "Orthodox" in name and "Presbyterian" not in name: return "rel_other_christian"
    if "Catholic" in name: return "rel_other_christian"
    return "rel_evangelical"


groups = pd.read_excel(RAW / "groups.xlsx", sheet_name="2020 Group by County", dtype={"FIPS": str, "Group Code": str})
groups = groups[groups.FIPS.notna() & groups["Group Code"].notna()].copy()
groups["FIPS"] = groups.FIPS.str.zfill(5)
groups["trad"] = [tradition(c, str(n)) for c, n in zip(groups["Group Code"], groups["Group Name"])]
groups["n"] = pd.to_numeric(groups["Adherents"], errors="coerce").fillna(0)
by_trad = groups.pivot_table(index="FIPS", columns="trad", values="n", aggfunc="sum").fillna(0)
population = pd.to_numeric(rel.set_index("FIPS")["2020 Population"], errors="coerce")
shares = by_trad.div(population.reindex(by_trad.index), axis=0).round(4)
table = table.join(shares)
table["rel_unclaimed"] = (1 - table[list(by_trad.columns)].sum(axis=1)).clip(lower=0).round(4)

table.index.name = "fips"
table.to_csv(DATA / "county.csv")

fields = [c for c in table.columns if c not in ("name", "ST")]
coverage = {c: int(table[c].notna().sum()) for c in fields}
county_results = {}
for fips, row in table.iterrows():
    item = {}
    for year in votes:
        y = year % 100
        if pd.notna(row[f"t{y}"]) and row[f"t{y}"] > 0:
            item[str(year)] = [int(row[f"d{y}"]), int(row[f"r{y}"]), int(row[f"t{y}"])]
    if item:
        county_results[fips] = item
(DATA / "results/county_years.json").write_text(json.dumps(county_results, separators=(",", ":")))
(DATA / "county_coverage.json").write_text(json.dumps({"counties": len(table), "fields": coverage}))

print(len(table), "counties")
print({k: v for k, v in coverage.items() if v < len(table)})
for year in votes:
    y = year % 100
    print(year, int(table[f"d{y}"].sum()), int(table[f"r{y}"].sum()), int(table[f"t{y}"].sum()))
print(table.loc["12031"].to_dict())
groups = [c for c in table.columns if c.endswith(("_col", "_non"))]
print("shares sum range", table[groups].sum(axis=1).min(), table[groups].sum(axis=1).max())
