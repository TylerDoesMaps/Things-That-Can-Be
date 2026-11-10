#!/usr/bin/env python3
"""Builds the tier map layers for one state: the country, the state, its counties, the municipal tier and what sits inside it.

The municipal tier is every Census county subdivision: townships, and cities that stand outside any township.
The tier inside it is every incorporated city that sits within a township.
Also writes summary.json: the state name, its bounds and how many of each kind there are.
Usage: tiers.py RAW_DIR OUT_DIR STATE_FIPS STATE_ABBR
"""
import io
import json
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAW, OUT, FIPS, ABBR = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
OUT.mkdir(parents=True, exist_ok=True)


def cb(name):
    return gpd.read_file(f"zip://{RAW}/geo/cb_{name}.zip", engine="pyogrio").to_crs(4326)


def tiger(name):
    return gpd.read_file(f"zip://{RAW}/tiger/{FIPS}_{name}.zip", engine="pyogrio", read_geometry=False).set_index("GEOID")


with zipfile.ZipFile(RAW / f"pl/{ABBR.lower()}.zip") as z:
    geo = pd.read_csv(io.BytesIO(z.read(f"{ABBR.lower()}geo2020.pl")), sep="|", header=None, dtype=str,
                      usecols=[2, 9, 90], encoding="latin-1", keep_default_na=False)
people = geo[geo[2].isin(["050", "060", "160"])].set_index(9)[90].astype(int).to_dict()


counts = {}


def write(frame, name):
    for kind, n in (frame["kind"].value_counts().items() if "kind" in frame else []):
        counts[kind] = int(n)
    frame.to_file(OUT / f"{name}.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=5)
    print(name, len(frame))


states = cb("state")
states = states[states.STATEFP.astype(int) <= 56]
write(gpd.GeoDataFrame({"name": states.NAME.values, "here": (states.STATEFP == FIPS).values}, geometry=states.geometry.values, crs=4326), "us")

counties = cb("county")
counties = counties[counties.STATEFP == FIPS]
county_name = dict(zip(counties.COUNTYFP, counties.NAME))
write(gpd.GeoDataFrame({"name": counties.NAMELSAD.values, "kind": "County", "people": counties.GEOID.map(people).values},
                       geometry=counties.geometry.values, crs=4326), "county")

subs, sub_info = cb("cousub"), tiger("cousub")
subs = subs[subs.STATEFP == FIPS]
klass = subs.GEOID.map(sub_info.CLASSFP)
active = subs.GEOID.map(sub_info.FUNCSTAT) == "A"
kind = ["City outside any township" if c.startswith("C") else "Township" if a else "Township, inactive" for c, a in zip(klass, active)]
write(gpd.GeoDataFrame({"name": subs.NAME.values, "kind": kind, "county": subs.COUNTYFP.map(county_name).values,
                        "people": subs.GEOID.map(people).values}, geometry=subs.geometry.values, crs=4326), "municipal")

places, place_info = cb("place"), tiger("place")
places = places[(places.STATEFP == FIPS) & (places.GEOID.map(place_info.CLASSFP) == "C1")]
write(gpd.GeoDataFrame({"name": places.NAME.values, "kind": "City inside a township", "people": places.GEOID.map(people).values},
                       geometry=places.geometry.values, crs=4326), "within")

box = [round(v, 3) for v in counties.total_bounds]
(OUT / "summary.json").write_text(json.dumps({"state": states[states.STATEFP == FIPS].NAME.iloc[0], "bounds": [box[:2], box[2:]], "counts": counts}))
