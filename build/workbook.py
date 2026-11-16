#!/usr/bin/env python3
"""Writes the tracking tables for one state's counties and cities: what each one is like and whether it gets its own content.

Reads the office count (docs/data/offices/<st>.json), the Census list of governments and the tables in this file.
Usage: workbook.py UNITS_XLSX OFFICES_JSON OUT_DIR
"""
import csv
import json
import sys
from pathlib import Path

import pandas as pd

UNITS, OFFICES, OUT = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
COUNTY_LINE, CITY_LINE, AWAKE, CUTOFF, CAP = 250000, 200000, 1000, 15000, 30
HOME = {"Jefferson": "Home county", "MONTICELLO": "Home city"}
# How commissioners are elected: Florida Association of Counties, county districting page, read November 2026.
SINGLE = "Bradford,Brevard,Broward,Calhoun,Collier,Columbia,Escambia,Franklin,Gadsden,Gulf,Hamilton,Hendry,Jackson,Jefferson,Madison,Miami-Dade,Palm Beach,Sarasota,Taylor,Union".split(",")
MIXED = "Duval,Hillsborough,Leon,Manatee,Orange,Pinellas,Volusia".split(",")
CROSSES = {"FANNING SPRINGS": "Gilchrist and Levy", "LONGBOAT KEY": "Manatee and Sarasota", "MARINELAND": "Flagler and St. Johns"}

data = json.load(open(OFFICES))
gp = pd.read_excel(UNITS, "General Purpose", dtype=str).query("STATE == 'FL' and IS_ACTIVE == 'Y'")
gp = gp.assign(people=gp.POPULATION.fillna(0).astype(float).astype(int), kind=gp.UNIT_TYPE.str[0])
cities = gp[gp.kind == "2"].sort_values("people", ascending=False)
largest = set(cities.head(CAP).query("people > @CUTOFF").UNIT_NAME)
OUT.mkdir(parents=True, exist_ok=True)


def seats(c, office, how="ballot"):
    return c["seats"].get(office, {}).get(how, 0)


with open(OUT / "fl-counties.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["County", "People, 2020", "Content", "Real district lines", "Lines found", "Commissioners elected", "Governing body", "Elected county mayor", "School board",
                "Superintendent", "Judicial circuit", "Congress", "State Senate", "State House", "Cities", "Other districts", "Notes"])
    for c in data["counties"]:
        name, real = c["name"], c["people"] >= COUNTY_LINE
        method = "By district" if name in SINGLE else "Both" if name in MIXED else "Countywide"
        facts = {x.split(" ")[0] + (" " + x.split(" ")[1] if x.startswith("State") or x.startswith("Judicial") else ""): x for x in c["facts"]}
        after = lambda key: facts[key].replace(key + " ", "").split(",")[0] if key == "Judicial circuit" else facts[key].replace(key + " ", "")
        w.writerow([name, c["people"], HOME.get(name) or ("Own content" if real else "Generic"), "Yes" if real else "No",
                    "Not started" if real and method != "Countywide" else "None needed: elected countywide" if real else "Drawn from neighbourhoods",
                    method, seats(c, "county.commissioner"), "Yes" if seats(c, "county.mayor") else "No", seats(c, "school.board"),
                    "Elected" if seats(c, "school.superintendent") else "Appointed", after("Judicial circuit"), after("Congress"), after("State Senate"), after("State House"),
                    c["governments"].get("city", 0), c["governments"].get("district", 0), "; ".join(c["real"] + c["notes"])])
names = {r.FIPS_COUNTY: r.COUNTY_AREA_NAME.title() for r in gp.itertuples()}
with open(OUT / "fl-cities.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["City", "County", "People, 2021", "Content", "Real council lines", "Lines found", "Own structure entered", "Simulated", "Sits in two counties", "Notes"])
    for r in cities.itertuples():
        city = r.UNIT_NAME.upper()
        for word in ("CITY OF ", "TOWN OF ", "VILLAGE OF "):
            city = city.replace(word, "")
        real, own = r.people >= CITY_LINE, r.UNIT_NAME in largest or city in HOME
        w.writerow([city.title(), names[r.FIPS_COUNTY], r.people, HOME.get(city) or ("Own content" if real else "Own structure" if own else "Generic"), "Yes" if real else "No",
                    "Not started" if real else "Drawn from neighbourhoods", "Yes" if own else "No", "Yes" if r.people >= AWAKE or city in HOME else "Dormant",
                    CROSSES.get(city, ""), "One government with Duval County" if city == "JACKSONVILLE" else ""])
for name in ("fl-counties.csv", "fl-cities.csv"):
    rows = list(csv.reader(open(OUT / name)))
    print(name, len(rows) - 1)
    for row in rows[:4]:
        print("  ", row)
