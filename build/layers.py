#!/usr/bin/env python3
"""Prepares national map layers as GeoJSON, ready for mapshaper.

Usage: layers.py RAW_DIR WORK_DIR
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAW, WORK = Path(sys.argv[1]), Path(sys.argv[2])
WORK.mkdir(parents=True, exist_ok=True)
FIFTY = {f"{i:02d}" for i in range(1, 57)} - {"03", "07", "14", "43", "52"}

ABBR = {}
refs = pd.read_csv(RAW / "ref/national_place2020.txt", sep="|", dtype=str, encoding="latin-1")
ABBR = dict(zip(refs.STATEFP, refs.STATE))
cousubs = pd.read_csv(RAW / "ref/national_cousub2020.txt", sep="|", dtype=str, encoding="latin-1")
cousubs["GEOID"] = cousubs.STATEFP + cousubs.COUNTYFP + cousubs.COUSUBFP
active_towns = set(cousubs[cousubs.CLASSFP.str.startswith("T") & (cousubs.FUNCSTAT == "A")].GEOID)


def load(name):
    gdf = gpd.read_file(f"zip://{RAW}/geo/cb_2020_us_{name}_500k.zip", engine="pyogrio")
    return gdf[gdf.STATEFP.isin(FIFTY)].to_crs(4326)


def write(gdf, name):
    gdf.to_file(WORK / f"{name}.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=6)
    print(name, len(gdf), flush=True)


states = load("state")
bounds = {r.STUSPS: [round(v, 3) for v in r.geometry.bounds] for r in states.itertuples()}
write(states[["GEOID", "NAME", "STUSPS", "geometry"]], "state")

counties = load("county")
counties["ST"] = counties.STATEFP.map(ABBR)
write(counties[["GEOID", "NAME", "ST", "geometry"]], "county")
county_bounds = {r.GEOID: [round(v, 3) for v in r.geometry.bounds] for r in counties.itertuples()}

places = load("place")
places = places[places.LSAD != "57"].copy()
places["ST"] = places.STATEFP.map(ABBR)
write(places[["GEOID", "NAME", "ST", "geometry"]], "city")

towns = load("cousub")
towns = towns[towns.GEOID.isin(active_towns)].copy()
towns["ST"] = towns.STATEFP.map(ABBR)
write(towns[["GEOID", "NAME", "ST", "geometry"]], "township")

bgs = load("bg")
bgs["ST"] = bgs.STATEFP.map(ABBR)
write(bgs[["GEOID", "ST", "geometry"]], "bg")

(WORK / "bounds.json").write_text(json.dumps({"states": bounds, "counties": county_bounds}))
