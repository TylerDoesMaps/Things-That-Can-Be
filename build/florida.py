#!/usr/bin/env python3
"""Runs the county builders over every Florida county in build/fl-counties.csv, several at a time.

Steps: hoods (neighbourhoods then pops for each county), fit (calibrate each TV market), lines (commission districts).
Counties with real lines under docs/data/districts/real are snapped to them; the rest are drawn by the tool,
with the number of districts the county table gives. Real lines not in use yet are kept under docs/data/districts/real-later.
Usage: florida.py RAW_DIR WORK_DIR STEP [COUNTY_FIPS ...]
"""
import csv
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAW, WORK, STEP, ONLY = sys.argv[1], sys.argv[2], sys.argv[3], set(sys.argv[4:])
HERE, DATA = Path(__file__).parent, Path(__file__).parent.parent / "docs/data"
rows = [r for r in csv.DictReader(open(HERE / "fl-counties.csv")) if not ONLY or r["fips"] in ONLY]
logs = Path(WORK) / "logs"
logs.mkdir(exist_ok=True)


def run(args, log):
    with open(log, "a") as out:
        return subprocess.run(["python3", "-W", "ignore", *map(str, args)], stdout=out, stderr=subprocess.STDOUT).returncode


def hoods(r):
    f, log = r["fips"], logs / f"{r['fips']}.log"
    a = run([HERE / "neighbourhoods.py", RAW, WORK, "FL", "12", f[2:], r["prefix"] + "-:", r["name"], r["code"], DATA / f"neighbourhoods/fl-{f}.json"], log)
    b = a or run([HERE / "pops.py", RAW, WORK, "FL", "12", f[2:], r["prefix"] + "-:", DATA / f"pops/fl-{f}.json"], log)
    print(r["name"], "ok" if not (a or b) else "FAILED", flush=True)


def lines(r):
    f, log = r["fips"], logs / f"{r['fips']}.log"
    real = DATA / f"districts/real/fl-{f}-blocks.csv"
    if real.exists():
        code = run([HERE / "districts_from_blocks.py", DATA / f"neighbourhoods/fl-{f}.json", DATA / f"pops/fl-{f}.json", Path(WORK) / f"neighbourhoods/{f}.csv", real,
                    f"{r['name']} County Commission", "Real lines", DATA / f"districts/fl-{f}.json"], log)
    else:
        code = run([HERE / "districts.py", DATA / f"neighbourhoods/fl-{f}.json", DATA / f"pops/fl-{f}.json", r["districts"], f"{r['name']} County Commission", DATA / f"districts/fl-{f}.json"], log)
    print(r["name"], "ok" if not code else "FAILED", flush=True)


if STEP == "fit":
    markets = defaultdict(list)
    for r in csv.DictReader(open(HERE / "fl-counties.csv")):
        if (DATA / f"pops/fl-{r['fips']}.json").exists():
            markets[r["market"]].append(DATA / f"pops/fl-{r['fips']}.json")
    for name, files in markets.items():
        print(name, len(files), "counties", "ok" if not run([HERE / "calibrate.py", name, *files], logs / "fit.log") else "FAILED", flush=True)
    import json
    built = [{"fips": r["fips"], "name": r["name"], "state": "Florida", "market": r["market"]} for r in csv.DictReader(open(HERE / "fl-counties.csv")) if (DATA / f"pops/fl-{r['fips']}.json").exists()]
    (DATA / "game/built.json").write_text(json.dumps(built))
else:
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(hoods if STEP == "hoods" else lines, rows))
