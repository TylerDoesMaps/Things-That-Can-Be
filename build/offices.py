#!/usr/bin/env python3
"""Counts every office in a state, county by county, from the Census Bureau's 2022 list of governments.

Each government gets seats from a rule: its real structure where the list below has it, the state default otherwise.
'how' says who fills the seat: ballot (a public election), meeting (the district's own meeting or members), appointed.
Usage: offices.py UNITS_XLSX RAW_DIR OUT_JSON
"""
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd

UNITS, RAW, OUT = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
ST, FIPS = "KS", "20"

# Real structures. checked says whether each was confirmed against a source.
COMMISSION = {"Johnson": 7, "Sedgwick": 5, "Leavenworth": 5, "Saline": 5, "Douglas": 5, "Pottawatomie": 5, "Reno": 5,
              "Butler": 5, "Miami": 5, "Franklin": 5, "Finney": 5, "Barton": 5, "Seward": 5, "Wyandotte": 10}
COMMISSION_CHECKED = {"Leavenworth", "Douglas", "Saline"}
NOT_ELECTED = {"Riley": ["county.sheriff"], "Johnson": ["county.clerk", "county.treasurer", "county.register_of_deeds"],
               "Wyandotte": ["county.clerk", "county.treasurer"]}
UNIFIED = {"Wyandotte": "KANSAS CITY", "Greeley": "TRIBUNE"}
ROW = ["county.clerk", "county.treasurer", "county.register_of_deeds", "county.sheriff", "county.attorney"]
# Cities over the cutoff: (mayor elected on his own, other members of the governing body). None are checked.
CITIES = {"WICHITA": (1, 6), "OVERLAND PARK": (1, 12), "KANSAS CITY": (1, 0), "OLATHE": (1, 6), "TOPEKA": (1, 9), "LAWRENCE": (0, 5),
          "SHAWNEE": (1, 8), "LENEXA": (1, 8), "MANHATTAN": (0, 5), "SALINA": (0, 5), "HUTCHINSON": (0, 5), "LEAVENWORTH": (0, 5),
          "LEAWOOD": (1, 8), "DODGE CITY": (0, 5), "GARDEN CITY": (0, 5), "EMPORIA": (0, 5), "DERBY": (1, 8), "GARDNER": (1, 5),
          "PRAIRIE VILLAGE": (1, 12), "JUNCTION CITY": (0, 5), "HAYS": (0, 5), "PITTSBURG": (0, 5), "LIBERAL": (0, 5), "NEWTON": (0, 5),
          "GREAT BEND": (1, 8), "ANDOVER": (1, 6), "MCPHERSON": (1, 2)}
CUTOFF = 15000
# Independent districts by Census function code: (office, seats, how).
DISTRICTS = {"02": ("district.cemetery", 3, "meeting"), "91": ("district.water", 5, "meeting"), "50": ("district.housing", 5, "appointed"),
             "88": ("district.conservation", 5, "meeting"), "63": ("district.watershed", 5, "meeting"), "51": ("district.drainage", 3, "ballot"),
             "52": ("district.library", 7, "appointed"), "40": ("district.hospital", 5, "ballot")}
OTHER = ("district.other", 3, "meeting")
JUDICIAL = {1: "Atchison, Leavenworth", 2: "Jackson, Jefferson, Pottawatomie, Wabaunsee", 3: "Shawnee", 4: "Anderson, Coffey, Franklin, Osage",
            5: "Chase, Lyon", 6: "Bourbon, Linn, Miami", 7: "Douglas", 8: "Dickinson, Geary, Marion, Morris", 9: "Harvey, McPherson", 10: "Johnson",
            11: "Cherokee, Crawford, Labette", 12: "Cloud, Jewell, Lincoln, Mitchell, Republic, Washington", 13: "Butler, Elk, Greenwood",
            14: "Chautauqua, Montgomery", 15: "Cheyenne, Logan, Rawlins, Sheridan, Sherman, Thomas, Wallace", 16: "Clark, Comanche, Ford, Gray, Kiowa, Meade",
            17: "Decatur, Graham, Norton, Osborne, Phillips, Smith", 18: "Sedgwick", 19: "Cowley", 20: "Barton, Ellsworth, Rice, Russell, Stafford",
            21: "Clay, Riley", 22: "Brown, Doniphan, Marshall, Nemaha", 23: "Ellis, Gove, Rooks, Trego", 24: "Edwards, Hodgeman, Lane, Ness, Pawnee, Rush",
            25: "Finney, Greeley, Hamilton, Kearny, Scott, Wichita", 26: "Grant, Haskell, Morton, Seward, Stanton, Stevens", 27: "Reno", 28: "Ottawa, Saline",
            29: "Wyandotte", 30: "Barber, Harper, Kingman, Pratt, Sumner", 31: "Allen, Neosho, Wilson, Woodson"}
JUDGES_BY_PARTY = {13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 26, 27, 29}
STATE_SEATS = [("ks.governor", 1, "ballot"), ("ks.lieutenant_governor", 1, "ballot"), ("ks.attorney_general", 1, "ballot"), ("ks.secretary_of_state", 1, "ballot"),
               ("ks.treasurer", 1, "ballot"), ("ks.insurance_commissioner", 1, "ballot"), ("ks.senator", 40, "ballot"), ("ks.representative", 125, "ballot"),
               ("ks.board_of_education", 10, "ballot"), ("ks.supreme_court", 7, "appointed"), ("ks.court_of_appeals", 14, "appointed"), ("ks.district_judge", 163, "mixed")]
FEDERAL_SEATS = [("us.senator", 2, "ballot"), ("us.representative", 4, "ballot")]

book = pd.ExcelFile(UNITS)
gp = book.parse("General Purpose", dtype=str).query("STATE == @ST and IS_ACTIVE == 'Y'")
sd = book.parse("Special District", dtype=str).query("STATE == @ST and IS_ACTIVE == 'Y'")
sc = book.parse("School District", dtype=str).query("STATE == @ST and IS_ACTIVE == 'Y'")
gp = gp.assign(people=gp.POPULATION.fillna(0).astype(float).astype(int), kind=gp.UNIT_TYPE.str[0])

counties = gpd.read_file(f"zip://{RAW}/geo/cb_county.zip", engine="pyogrio").query("STATEFP == @FIPS").to_crs(5070)
name_of = dict(zip(counties.COUNTYFP, counties.NAME))
judicial = {c.strip(): n for n, cs in JUDICIAL.items() for c in cs.split(",")}


def touching(layer, field):
    g = gpd.read_file(f"zip://{RAW}/tiger/{FIPS}_{layer}.zip", engine="pyogrio").to_crs(5070)
    o = gpd.overlay(counties[["COUNTYFP", "geometry"]], g[[field, "geometry"]], how="intersection")
    o = o[o.area / o.COUNTYFP.map(counties.set_index("COUNTYFP").area) > 0.01]
    out = defaultdict(list)
    for c, d in zip(o.COUNTYFP, o[field]):
        if str(d).strip("0").isdigit():
            out[c].append(int(d))
    return {c: sorted(set(v)) for c, v in out.items()}


cd, senate, house = touching("cd", [c for c in gpd.read_file(f"zip://{RAW}/tiger/{FIPS}_cd.zip", engine="pyogrio", rows=1).columns if c.startswith("CD") and c.endswith("FP")][0]), touching("sldu", "SLDUST"), touching("sldl", "SLDLST")

out = {}
for fp, name in sorted(name_of.items(), key=lambda x: x[1]):
    out[fp] = {"name": name, "people": 0, "governments": defaultdict(int), "seats": defaultdict(lambda: defaultdict(int)), "real": [], "notes": [],
               "congress": cd.get(fp, []), "senate": senate.get(fp, []), "house": house.get(fp, []), "judicial": judicial[name],
               "judges": "elected by party" if judicial[name] in JUDGES_BY_PARTY else "appointed, then retained"}


def add(fp, office, n, how="ballot"):
    if n:
        out[fp]["seats"][office][how] += n


with zipfile.ZipFile(RAW / f"pl/{ST.lower()}.zip") as z:
    geo = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}geo2020.pl")), sep="|", header=None, dtype=str, usecols=[2, 9, 90], encoding="latin-1", keep_default_na=False)
for code, n in geo[geo[2] == "050"].set_index(9)[90].astype(int).items():
    out[code[-3:]]["people"] = n
for fp, c in out.items():
    name = c["name"]
    c["governments"]["county"] += 1
    add(fp, "county.commissioner", COMMISSION.get(name, 3))
    for office in ROW:
        add(fp, office, 1, "appointed" if office in NOT_ELECTED.get(name, []) else "ballot")
    if name in COMMISSION:
        c["real"].append(f"County commission of {COMMISSION[name]}" + ("" if name in COMMISSION_CHECKED else " (unchecked)"))
    for office in NOT_ELECTED.get(name, []):
        c["notes"].append(f"{office} is not elected here (unchecked)")
    if name in UNIFIED:
        c["notes"].append(f"County and {UNIFIED[name].title()} are one unified government; its seats are counted once, as the county's")

for r in gp.itertuples():
    fp, c = r.FIPS_COUNTY, out[r.FIPS_COUNTY]
    if r.kind == "3":
        c["governments"]["township"] += 1
        for office in ("township.trustee", "township.treasurer", "township.clerk"):
            add(fp, office, 1)
        if r.people > CUTOFF:
            c["real"].append(f"{r.UNIT_NAME.title()}, {r.people:,} people: over the cutoff, same three officers")
    elif r.kind == "2":
        city = r.UNIT_NAME.upper().replace("CITY OF ", "").replace("UNIFIED GOVERNMENT OF WYANDOTTE COUNTY AND ", "").strip()
        if "UNIFIED GOVERNMENT" in r.UNIT_NAME.upper():
            if c["name"] == "Wyandotte":
                add(fp, "city.mayor", 1)
            continue
        c["governments"]["city"] += 1
        if r.people > CUTOFF:
            mayor, members = CITIES.get(city, (1, 8))
            c["real"].append(f"{city.title()}: {'mayor and ' if mayor else ''}{members} members (unchecked)" if city in CITIES else f"{city.title()}: over the cutoff, structure not entered")
        else:
            mayor, members = (1, 8) if r.people >= 2000 else (1, 5)
        add(fp, "city.mayor", mayor)
        add(fp, "city.council", members)
for r in sc.itertuples():
    fp, c = r.FIPS_COUNTY, out[r.FIPS_COUNTY]
    if "UNIVERSITY" in r.UNIT_NAME:
        c["governments"]["college"] += 1
        add(fp, "college.trustee", 9, "appointed")
    elif "COLLEGE" in r.UNIT_NAME:
        c["governments"]["college"] += 1
        add(fp, "college.trustee", 6)
    else:
        c["governments"]["school"] += 1
        add(fp, "school.board", 7)
for r in sd.itertuples():
    fp, c = r.FIPS_COUNTY, out[r.FIPS_COUNTY]
    office, n, how = DISTRICTS.get(r.FUNCTION_NAME[:2], OTHER)
    c["governments"]["district"] += 1
    add(fp, office, n, how)

total = defaultdict(lambda: defaultdict(int))
for c in out.values():
    c["governments"] = dict(c["governments"])
    c["seats"] = {k: dict(v) for k, v in c["seats"].items()}
    for office, hows in c["seats"].items():
        for how, n in hows.items():
            total[office][how] += n
state = {o: {how: n} for o, n, how in STATE_SEATS}
federal = {o: {how: n} for o, n, how in FEDERAL_SEATS}
result = {"state": "Kansas", "year": 2022, "counties": list(out.values()), "local": {k: dict(v) for k, v in total.items()}, "statewide": state, "federal": federal,
          "governments": {k: sum(c["governments"].get(k, 0) for c in out.values()) for k in ["county", "township", "city", "school", "college", "district"]}}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(result, separators=(",", ":")))

by_how = defaultdict(int)
for hows in total.values():
    for how, n in hows.items():
        by_how[how] += n
print("governments", result["governments"], sum(result["governments"].values()))
print("local seats by how", dict(by_how))
for office, hows in sorted(total.items()):
    print(f"  {office:28s}", dict(hows))
