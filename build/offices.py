#!/usr/bin/env python3
"""Counts every office in a state, county by county, from the Census Bureau's 2022 list of governments.

Each government gets seats from a rule: its real structure where the state's table has it, the state default otherwise.
'how' says who fills the seat: ballot (a public election), meeting (the district's own meeting, members or landowners), appointed.
Usage: offices.py UNITS_XLSX RAW_DIR STATE_ABBR OUT_JSON
"""
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd

UNITS, RAW, ST, OUT = sys.argv[1], Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
CUTOFF, CAP = 15000, 30


def courts(table):
    return {c.strip(): n for n, cs in table.items() for c in cs.split(",")}


KS = dict(
    name="Kansas", fips="20",
    commission=3,
    # Real structures. Only the counties in commission_checked were confirmed against a source.
    commissions={"Johnson": 7, "Sedgwick": 5, "Leavenworth": 5, "Saline": 5, "Douglas": 5, "Pottawatomie": 5, "Reno": 5,
                 "Butler": 5, "Miami": 5, "Franklin": 5, "Finney": 5, "Barton": 5, "Seward": 5, "Wyandotte": 10},
    commission_checked={"Leavenworth", "Douglas", "Saline"},
    county_mayor={"Wyandotte"},
    row=["county.clerk", "county.treasurer", "county.register_of_deeds", "county.sheriff", "county.attorney"],
    not_elected={"Riley": ["county.sheriff"], "Johnson": ["county.clerk", "county.treasurer", "county.register_of_deeds"],
                 "Wyandotte": ["county.clerk", "county.treasurer"]},
    unified={"Wyandotte": "Kansas City", "Greeley": "Tribune"},
    township=["township.trustee", "township.treasurer", "township.clerk"],
    # Cities over the cutoff: (mayor elected on his own, other members of the governing body). None are checked.
    cities={"WICHITA": (1, 6), "OVERLAND PARK": (1, 12), "OLATHE": (1, 6), "TOPEKA": (1, 9), "LAWRENCE": (0, 5),
            "SHAWNEE": (1, 8), "LENEXA": (1, 8), "MANHATTAN": (0, 5), "SALINA": (0, 5), "HUTCHINSON": (0, 5), "LEAVENWORTH": (0, 5),
            "LEAWOOD": (1, 8), "DODGE CITY": (0, 5), "GARDEN CITY": (0, 5), "EMPORIA": (0, 5), "DERBY": (1, 8), "GARDNER": (1, 5),
            "PRAIRIE VILLAGE": (1, 12), "JUNCTION CITY": (0, 5), "HAYS": (0, 5), "PITTSBURG": (0, 5), "LIBERAL": (0, 5), "NEWTON": (0, 5),
            "GREAT BEND": (1, 8), "ANDOVER": (1, 6), "MCPHERSON": (1, 2)},
    default_city=lambda people: (1, 8) if people >= 2000 else (1, 5),
    school=lambda county: (7, None),
    college=(6, "ballot"),
    # Independent districts by Census function code: (office, seats, how).
    districts={"02": ("district.cemetery", 3, "meeting"), "91": ("district.water", 5, "meeting"), "50": ("district.housing", 5, "appointed"),
               "88": ("district.conservation", 5, "meeting"), "63": ("district.watershed", 5, "meeting"), "51": ("district.drainage", 3, "ballot"),
               "52": ("district.library", 7, "appointed"), "40": ("district.hospital", 5, "ballot")},
    other=("district.other", 3, "meeting"),
    county_seats=[],
    court="Judicial district",
    courts=courts({1: "Atchison, Leavenworth", 2: "Jackson, Jefferson, Pottawatomie, Wabaunsee", 3: "Shawnee", 4: "Anderson, Coffey, Franklin, Osage",
                   5: "Chase, Lyon", 6: "Bourbon, Linn, Miami", 7: "Douglas", 8: "Dickinson, Geary, Marion, Morris", 9: "Harvey, McPherson", 10: "Johnson",
                   11: "Cherokee, Crawford, Labette", 12: "Cloud, Jewell, Lincoln, Mitchell, Republic, Washington", 13: "Butler, Elk, Greenwood",
                   14: "Chautauqua, Montgomery", 15: "Cheyenne, Logan, Rawlins, Sheridan, Sherman, Thomas, Wallace", 16: "Clark, Comanche, Ford, Gray, Kiowa, Meade",
                   17: "Decatur, Graham, Norton, Osborne, Phillips, Smith", 18: "Sedgwick", 19: "Cowley", 20: "Barton, Ellsworth, Rice, Russell, Stafford",
                   21: "Clay, Riley", 22: "Brown, Doniphan, Marshall, Nemaha", 23: "Ellis, Gove, Rooks, Trego", 24: "Edwards, Hodgeman, Lane, Ness, Pawnee, Rush",
                   25: "Finney, Greeley, Hamilton, Kearny, Scott, Wichita", 26: "Grant, Haskell, Morton, Seward, Stanton, Stevens", 27: "Reno", 28: "Ottawa, Saline",
                   29: "Wyandotte", 30: "Barber, Harper, Kingman, Pratt, Sumner", 31: "Allen, Neosho, Wilson, Woodson"}),
    judges=lambda n: "judges elected by party" if n in {13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 26, 27, 29} else "judges appointed, then retained",
    statewide=[("ks.governor", 1, "ballot"), ("ks.lieutenant_governor", 1, "ballot"), ("ks.attorney_general", 1, "ballot"), ("ks.secretary_of_state", 1, "ballot"),
               ("ks.treasurer", 1, "ballot"), ("ks.insurance_commissioner", 1, "ballot"), ("ks.senator", 40, "ballot"), ("ks.representative", 125, "ballot"),
               ("ks.board_of_education", 10, "ballot"), ("ks.supreme_court", 7, "appointed"), ("ks.court_of_appeals", 14, "appointed"), ("ks.district_judge", 163, "mixed")],
    federal=[("us.senator", 2, "ballot"), ("us.representative", 4, "ballot")],
    notes=[],
)

# School boards and superintendents: Florida School Boards Association, 2024. Checked.
FL_SCHOOL = {"Broward": 9, "Duval": 7, "Hillsborough": 7, "Lee": 7, "Miami-Dade": 9, "Orange": 8, "Palm Beach": 7, "Pinellas": 7, "Polk": 7}
FL_APPOINTED_SUPERINTENDENT = {"Alachua", "Brevard", "Broward", "Charlotte", "Collier", "Duval", "Escambia", "Flagler", "Hernando", "Hillsborough", "Indian River",
                               "Lake", "Lee", "Manatee", "Marion", "Martin", "Miami-Dade", "Monroe", "Okeechobee", "Orange", "Osceola", "Palm Beach", "Pinellas",
                               "Polk", "St. Johns", "St. Lucie", "Sarasota", "Seminole", "Volusia"}
FL = dict(
    name="Florida", fips="12",
    commission=5,
    commissions={"Miami-Dade": 13, "Duval": 19, "Broward": 9, "Hillsborough": 7, "Palm Beach": 7, "Pinellas": 7, "Orange": 6, "Volusia": 7, "Leon": 7, "Manatee": 7},
    commission_checked=set(),
    county_mayor={"Miami-Dade", "Orange", "Duval"},
    row=["county.clerk", "county.property_appraiser", "county.sheriff", "county.elections", "county.tax_collector"],
    not_elected={},
    unified={"Duval": "Jacksonville"},
    township=[],
    cities={"MIAMI": (1, 5), "TAMPA": (1, 7), "ORLANDO": (1, 6), "ST PETERSBURG": (1, 8), "HIALEAH": (1, 7), "PORT ST LUCIE": (1, 4), "CAPE CORAL": (1, 7),
            "TALLAHASSEE": (1, 4), "FORT LAUDERDALE": (1, 4), "PEMBROKE PINES": (1, 4), "HOLLYWOOD": (1, 6), "GAINESVILLE": (1, 6), "MIRAMAR": (1, 4),
            "CORAL SPRINGS": (1, 4), "PALM BAY": (1, 4), "WEST PALM BEACH": (1, 5), "CLEARWATER": (1, 4), "LAKELAND": (1, 6), "POMPANO BEACH": (1, 5),
            "MIAMI GARDENS": (1, 6), "DAVIE": (1, 4), "SUNRISE": (1, 4), "BOCA RATON": (1, 4), "DELTONA": (1, 6), "PALM COAST": (1, 4), "PLANTATION": (1, 5),
            "FORT MYERS": (1, 6), "DEERFIELD BEACH": (1, 4), "MELBOURNE": (1, 6), "MONTICELLO": (0, 5)},
    default_city=lambda people: (1, 4),
    school=lambda county: (FL_SCHOOL.get(county, 5), "appointed" if county in FL_APPOINTED_SUPERINTENDENT else "ballot"),
    college=(7, "appointed"),
    districts={"99": ("district.community", 5, "meeting"), "50": ("district.housing", 5, "appointed"), "24": ("district.fire", 5, "ballot"),
               "88": ("district.conservation", 5, "ballot"), "51": ("district.drainage", 3, "meeting"), "40": ("district.hospital", 5, "appointed"),
               "63": ("district.drainage", 3, "meeting"), "61": ("district.parks", 5, "ballot"), "42": ("district.housing", 5, "appointed"), "52": ("district.library", 5, "appointed")},
    other=("district.other", 5, "appointed"),
    county_seats=[("fl.county_judge", 1, "ballot")],
    court="Judicial circuit",
    courts=courts({1: "Escambia, Okaloosa, Santa Rosa, Walton", 2: "Franklin, Gadsden, Jefferson, Leon, Liberty, Wakulla", 3: "Columbia, Dixie, Hamilton, Lafayette, Madison, Suwannee, Taylor",
                   4: "Clay, Duval, Nassau", 5: "Citrus, Hernando, Lake, Marion, Sumter", 6: "Pasco, Pinellas", 7: "Flagler, Putnam, St. Johns, Volusia",
                   8: "Alachua, Baker, Bradford, Gilchrist, Levy, Union", 9: "Orange, Osceola", 10: "Hardee, Highlands, Polk", 11: "Miami-Dade", 12: "DeSoto, Manatee, Sarasota",
                   13: "Hillsborough", 14: "Bay, Calhoun, Gulf, Holmes, Jackson, Washington", 15: "Palm Beach", 16: "Monroe", 17: "Broward", 18: "Brevard, Seminole",
                   19: "Indian River, Martin, Okeechobee, St. Lucie", 20: "Charlotte, Collier, Glades, Hendry, Lee"}),
    judges=lambda n: "judges elected with no party on the ballot",
    statewide=[("fl.governor", 1, "ballot"), ("fl.lieutenant_governor", 1, "ballot"), ("fl.attorney_general", 1, "ballot"), ("fl.chief_financial_officer", 1, "ballot"),
               ("fl.agriculture_commissioner", 1, "ballot"), ("fl.senator", 40, "ballot"), ("fl.representative", 120, "ballot"), ("fl.state_attorney", 20, "ballot"),
               ("fl.public_defender", 20, "ballot"), ("fl.circuit_judge", 600, "ballot"), ("fl.supreme_court", 7, "appointed"), ("fl.appeal_judge", 71, "appointed")],
    federal=[("us.senator", 2, "ballot"), ("us.representative", 28, "ballot")],
    notes=["Circuit judges (600) and appeal judges (71) are round figures from memory.", "Each county is given one county judge. Larger counties have many more.",
           "Only the 30 largest cities have their own structure entered, all unchecked. Every other city is given a mayor and four commissioners."],
)
cfg = {"KS": KS, "FL": FL}[ST]
FIPS = cfg["fips"]

book = pd.ExcelFile(UNITS)
gp = book.parse("General Purpose", dtype=str).query("STATE == @ST and IS_ACTIVE == 'Y'")
sd = book.parse("Special District", dtype=str).query("STATE == @ST and IS_ACTIVE == 'Y'")
sc = book.parse("School District", dtype=str).query("STATE == @ST and IS_ACTIVE == 'Y'")
gp = gp.assign(people=gp.POPULATION.fillna(0).astype(float).astype(int), kind=gp.UNIT_TYPE.str[0])
big = set(gp[gp.kind == "2"].sort_values("people", ascending=False).head(CAP).query("people > @CUTOFF").UNIT_NAME) | {u for u in gp.UNIT_NAME if "MONTICELLO" in u and ST == "FL"}

counties = gpd.read_file(f"zip://{RAW}/geo/cb_county.zip", engine="pyogrio").query("STATEFP == @FIPS").to_crs(5070)
name_of = dict(zip(counties.COUNTYFP, counties.NAME))


def touching(layer):
    g = gpd.read_file(f"zip://{RAW}/tiger/{FIPS}_{layer}.zip", engine="pyogrio").to_crs(5070)
    field = [c for c in g.columns if (c.startswith("CD") and c.endswith("FP")) or c in ("SLDUST", "SLDLST")][0]
    o = gpd.overlay(counties[["COUNTYFP", "geometry"]], g[[field, "geometry"]], how="intersection")
    o = o[o.area / o.COUNTYFP.map(counties.set_index("COUNTYFP").area) > 0.01]
    out = defaultdict(list)
    for c, d in zip(o.COUNTYFP, o[field]):
        if str(d).strip("0").isdigit():
            out[c].append(int(d))
    return {c: sorted(set(v)) for c, v in out.items()}


cd, senate, house = touching("cd"), touching("sldu"), touching("sldl")
out = {}
for fp, name in sorted(name_of.items(), key=lambda x: x[1]):
    court = cfg["courts"][name]
    out[fp] = {"name": name, "people": 0, "governments": defaultdict(int), "seats": defaultdict(lambda: defaultdict(int)), "real": [], "notes": [],
               "facts": [f"Congress {', '.join(map(str, cd.get(fp, [])))}", f"State Senate {', '.join(map(str, senate.get(fp, [])))}",
                         f"State House {', '.join(map(str, house.get(fp, [])))}", f"{cfg['court']} {court}, {cfg['judges'](court)}"]}


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
    add(fp, "county.commissioner", cfg["commissions"].get(name, cfg["commission"]))
    if name in cfg["county_mayor"]:
        add(fp, "county.mayor", 1)
    for office in cfg["row"]:
        add(fp, office, 1, "appointed" if office in cfg["not_elected"].get(name, []) else "ballot")
    for office, n, how in cfg["county_seats"]:
        add(fp, office, n, how)
    if name in cfg["commissions"]:
        c["real"].append(f"County governing body of {cfg['commissions'][name]}" + ("" if name in cfg["commission_checked"] else " (unchecked)"))
    for office in cfg["not_elected"].get(name, []):
        c["notes"].append(f"{office} is not elected here (unchecked)")
    if name in cfg["unified"]:
        c["notes"].append(f"County and {cfg['unified'][name]} are one government; its seats are counted once, as the county's")

for r in gp.itertuples():
    fp, c = r.FIPS_COUNTY, out[r.FIPS_COUNTY]
    upper = r.UNIT_NAME.upper()
    if r.kind == "3":
        c["governments"]["township"] += 1
        for office in cfg["township"]:
            add(fp, office, 1)
        if r.people > CUTOFF:
            c["real"].append(f"{r.UNIT_NAME.title()}, {r.people:,} people: over the cutoff, same officers")
    elif r.kind == "2":
        city = upper
        for word in ("CITY OF ", "TOWN OF ", "VILLAGE OF "):
            city = city.replace(word, "")
        city = city.strip()
        if "UNIFIED GOVERNMENT" in upper or city == cfg["unified"].get(c["name"], "").upper():
            continue
        c["governments"]["city"] += 1
        if r.UNIT_NAME in big and city in cfg["cities"]:
            mayor, members = cfg["cities"][city]
            c["real"].append(f"{city.title()}: {'mayor and ' if mayor else ''}{members} members" + (" (unchecked)" if city != "MONTICELLO" else ""))
        else:
            mayor, members = cfg["default_city"](r.people)
            if r.UNIT_NAME in big:
                c["real"].append(f"{city.title()}: among the largest, structure not entered")
        add(fp, "city.mayor", mayor)
        add(fp, "city.council", members)
for r in sc.itertuples():
    fp, c = r.FIPS_COUNTY, out[r.FIPS_COUNTY]
    if "UNIVERSITY" in r.UNIT_NAME:
        c["governments"]["college"] += 1
        add(fp, "college.trustee", 9, "appointed")
    elif "COLLEGE" in r.UNIT_NAME:
        c["governments"]["college"] += 1
        add(fp, "college.trustee", *cfg["college"])
    else:
        board, chief = cfg["school"](c["name"])
        c["governments"]["school"] += 1
        add(fp, "school.board", board)
        if chief:
            add(fp, "school.superintendent", 1, chief)
for r in sd.itertuples():
    fp, c = r.FIPS_COUNTY, out[r.FIPS_COUNTY]
    office, n, how = cfg["districts"].get(r.FUNCTION_NAME[:2], cfg["other"])
    c["governments"]["district"] += 1
    add(fp, office, n, how)

total = defaultdict(lambda: defaultdict(int))
for c in out.values():
    c["governments"] = dict(c["governments"])
    c["seats"] = {k: dict(v) for k, v in c["seats"].items()}
    for office, hows in c["seats"].items():
        for how, n in hows.items():
            total[office][how] += n
result = {"state": cfg["name"], "year": 2022, "counties": list(out.values()), "local": {k: dict(v) for k, v in total.items()},
          "statewide": {o: {how: n} for o, n, how in cfg["statewide"]}, "federal": {o: {how: n} for o, n, how in cfg["federal"]}, "notes": cfg["notes"],
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
