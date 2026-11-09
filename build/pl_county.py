#!/usr/bin/env python3
"""Pulls adults by race from the 2020 census redistricting files, county level only.

Usage: pl_county.py OUT_CSV
Downloads each state's file, keeps county rows, deletes the download.
"""
import csv
import io
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

OUT = Path(sys.argv[1])
BASE = "https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171"
STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District_of_Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New_Hampshire",
    "NJ": "New_Jersey", "NM": "New_Mexico", "NY": "New_York", "NC": "North_Carolina", "ND": "North_Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode_Island",
    "SC": "South_Carolina", "SD": "South_Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West_Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
# Segment 2 holds five ID columns, then 71 cells of table P3, then table P4.
P4_START = 5 + 71
FIELDS = ["total", "hispanic", "not_hispanic", "one_race", "white", "black", "aian", "asian", "nhpi", "other"]

with open(OUT, "w", newline="") as handle:
    writer = csv.writer(handle)
    writer.writerow(["fips", *FIELDS, "multi"])
    for abbr, name in STATES.items():
        low = abbr.lower()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pl.zip"
            subprocess.run(["curl", "-sS", "--retry", "4", "-m", "900", "-o", str(path),
                            f"{BASE}/{name}/{low}2020.pl.zip"], check=True)
            with zipfile.ZipFile(path) as zf:
                counties = {}
                with zf.open(f"{low}geo2020.pl") as raw:
                    for line in io.TextIOWrapper(raw, encoding="latin-1"):
                        parts = line.split("|")
                        if parts[2] == "050":
                            counties[parts[7]] = parts[8][-5:]
                rows = 0
                with zf.open(f"{low}000022020.pl") as raw:
                    for line in io.TextIOWrapper(raw, encoding="latin-1"):
                        parts = line.rstrip("\n").split("|")
                        fips = counties.get(parts[4])
                        if fips is None:
                            continue
                        p4 = [int(x) for x in parts[P4_START:P4_START + 11]]
                        writer.writerow([fips, *p4])
                        rows += 1
        print(abbr, rows, flush=True)
