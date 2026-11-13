#!/usr/bin/env python3
"""Builds the tier map layers for one state: the country, the state, its counties, the municipal tier and what sits inside it.

In a state with townships the municipal tier is every Census county subdivision: townships, and cities that stand
outside any township. The tier inside it is every incorporated city that sits within a township.
In a state without townships the municipal tier is every incorporated place and nothing sits inside it.
Also writes summary.json: the state name, its bounds, and each kind with its tier and count.
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
TOWNSHIP_STATES = set("CT IL IN KS ME MA MI MN MO NE NH NJ NY ND OH PA RI SD VT WI".split())


def cb(name):
    return gpd.read_file(f"zip://{RAW}/geo/cb_{name}.zip", engine="pyogrio").to_crs(4326)


def tiger(name):
    return gpd.read_file(f"zip://{RAW}/tiger/{FIPS}_{name}.zip", engine="pyogrio", read_geometry=False).set_index("GEOID")


with zipfile.ZipFile(RAW / f"pl/{ABBR.lower()}.zip") as z:
    geo = pd.read_csv(io.BytesIO(z.read(f"{ABBR.lower()}geo2020.pl")), sep="|", header=None, dtype=str,
                      usecols=[2, 9, 90], encoding="latin-1", keep_default_na=False)
people = geo[geo[2].isin(["050", "060", "160"])].set_index(9)[90].astype(int).to_dict()
kinds = []


def write(frame, name, tier=None):
    if tier:
        for kind, n in frame["kind"].value_counts().items():
            kinds.append({"kind": kind, "tier": tier, "count": int(n)})
    frame.to_file(OUT / f"{name}.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=5)
    print(name, len(frame))


states = cb("state")
states = states[states.STATEFP.astype(int) <= 56]
write(gpd.GeoDataFrame({"name": states.NAME.values, "here": (states.STATEFP == FIPS).values}, geometry=states.geometry.values, crs=4326), "us")

counties = cb("county")
counties = counties[counties.STATEFP == FIPS]
county_name = dict(zip(counties.COUNTYFP, counties.NAME))
write(gpd.GeoDataFrame({"name": counties.NAMELSAD.values, "kind": "County", "people": counties.GEOID.map(people).values},
                       geometry=counties.geometry.values, crs=4326), "county", 3)

places, place_info = cb("place"), tiger("place")
places = places[places.STATEFP == FIPS]
klass = places.GEOID.map(place_info.CLASSFP)
if ABBR in TOWNSHIP_STATES:
    subs, sub_info = cb("cousub"), tiger("cousub")
    subs = subs[subs.STATEFP == FIPS]
    sub_class = subs.GEOID.map(sub_info.CLASSFP)
    active = subs.GEOID.map(sub_info.FUNCSTAT) == "A"
    kind = ["City outside any township" if c.startswith("C") else "Township" if a else "Township, inactive" for c, a in zip(sub_class, active)]
    write(gpd.GeoDataFrame({"name": subs.NAME.values, "kind": kind, "county": subs.COUNTYFP.map(county_name).values,
                            "people": subs.GEOID.map(people).values}, geometry=subs.geometry.values, crs=4326), "municipal", 4)
    inside = places[klass == "C1"]
    write(gpd.GeoDataFrame({"name": inside.NAME.values, "kind": "City inside a township", "people": inside.GEOID.map(people).values},
                           geometry=inside.geometry.values, crs=4326), "within", 5)
else:
    towns = places[klass.str.startswith("C").fillna(False)]
    spot = gpd.GeoDataFrame(geometry=towns.geometry.representative_point().values, crs=4326)
    home = gpd.sjoin(spot, counties[["NAME", "geometry"]], how="left", predicate="within").NAME
    home = home[~home.index.duplicated()]
    kind = towns.NAMELSAD.str.split().str[-1].str.capitalize().where(lambda s: s.isin(["City", "Town", "Village"]), "City")
    write(gpd.GeoDataFrame({"name": towns.NAME.values, "kind": kind.values, "county": home.values, "people": towns.GEOID.map(people).values},
                           geometry=towns.geometry.values, crs=4326), "municipal", 4)

box = [round(v, 3) for v in counties.total_bounds]
(OUT / "summary.json").write_text(json.dumps({"state": states[states.STATEFP == FIPS].NAME.iloc[0], "bounds": [box[:2], box[2:]], "kinds": kinds}))
