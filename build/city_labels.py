#!/usr/bin/env python3
"""Gives every city one permanent label point and one permanent zoom level.

Larger cities claim their spot first. A label that fits at a zoom keeps fitting at every higher zoom.
Usage: city_labels.py COUNTY_RAW WORK_DIR DATA_DIR
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAW, WORK, DATA = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
MIN_POP = {7: 50000, 8: 15000, 9: 5000}
CELL = 256

pops = {}
for vintage in (2021, 2024):
    d = pd.read_csv(RAW / f"acs/{vintage}-b01003.dat", sep="|", dtype=str)
    d = d[d.GEO_ID.str.startswith("1600000US")]
    pops.update(zip(d.GEO_ID.str[-7:], pd.to_numeric(d.B01003_E001, errors="coerce").fillna(0).astype(int)))

cities = gpd.read_file(WORK / "city.geojson", engine="pyogrio")
cities = cities[~cities.ST.isin(["AK", "HI"])].copy()
items = []
for row in cities.itertuples():
    geometry = row.geometry
    if geometry.geom_type == "MultiPolygon":
        geometry = max(geometry.geoms, key=lambda g: g.area)
    point = geometry.representative_point()
    items.append({"name": row.NAME, "lon": round(point.x, 4), "lat": round(point.y, 4), "pop": pops.get(row.GEOID, 0)})
items.sort(key=lambda c: -c["pop"])


def pixel(lon, lat, zoom):
    size = 512 * 2 ** zoom
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return size * (lon + 180) / 360, size * (1 - y / math.pi) / 2


def box(item, zoom):
    x, y = pixel(item["lon"], item["lat"], zoom)
    w = len(item["name"]) * 6.4 + 10
    return x - w / 2, y - 9, x + w / 2, y + 9


def cells(b):
    for cx in range(int(b[0] // CELL), int(b[2] // CELL) + 1):
        for cy in range(int(b[1] // CELL), int(b[3] // CELL) + 1):
            yield cx, cy


placed = []
remaining = items
for zoom in range(7, 15):
    grid = defaultdict(list)
    for item in placed:
        b = box(item, zoom)
        for c in cells(b):
            grid[c].append(b)
    waiting = []
    for item in remaining:
        if item["pop"] < MIN_POP.get(zoom, 0):
            waiting.append(item)
            continue
        b = box(item, zoom)
        clash = any(o[0] < b[2] and o[2] > b[0] and o[1] < b[3] and o[3] > b[1] for c in cells(b) for o in grid[c])
        if clash:
            waiting.append(item)
            continue
        item["z"] = zoom
        placed.append(item)
        for c in cells(b):
            grid[c].append(b)
    remaining = waiting

(DATA / "city_labels.json").write_text(json.dumps(
    [[c["name"], c["lon"], c["lat"], c["z"]] for c in placed], separators=(",", ":"), ensure_ascii=False))
print(len(placed), "labels of", len(items), {z: sum(c["z"] == z for c in placed) for z in range(7, 15)})
