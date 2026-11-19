#!/usr/bin/env python3
"""Decides each neighbourhood's area type from how thickly it is settled and what it touches, across the whole state.

Built-up neighbourhoods that touch form clusters, whatever city or county they sit in; a smaller cluster within reach of
a city's cluster joins it. Then:
  urban       in a city's cluster, and well denser than that city's typical neighbourhood (so Miami's suburbs are not
              urban merely for being denser than Jacksonville's core)
  suburban    the rest of a city's cluster
  exurban     thinly settled land on a city's edge, or a thin hole inside it
  small town  a built-up cluster too small to be a city
  rural       everything else
Reads docs/data/neighbourhoods (shapes, pops, true density) and rewrites the area type there and on every pop in
docs/data/pops, with the word that describes it. Run after `florida.py fit` and before `game.py`.
Usage: areas.py DATA_DIR
"""
import json
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import pandas as pd

DATA = Path(sys.argv[1])
FLOOR, CORE, DENSER = 300, 3000, 1.5   # adults per square mile to count as built-up; the least a core can be; and how much denser than its own city's typical neighbourhood a core must be
CITY, TOWN = 40000, 750     # adults in a cluster: for a city (about 50,000 people), and for a town
JUMP = 2414                 # metres a city's cluster reaches across a gap (a mile and a half)
RING = 0.6                  # share of a thin neighbourhood's edge on a city that makes it a hole in that city
THIN, EDGE = 75, 1609       # adults per square mile to count as settled at all; metres from a city's edge (a mile)
WORD = {"urban": "in the city", "suburban": "suburban", "exurban": "exurban", "small town": "in town", "rural": "rural"}

files = sorted((DATA / "neighbourhoods").glob("fl-*.json"))
source = {f: json.loads(f.read_text()) for f in files}
g = pd.concat([gpd.GeoDataFrame.from_features(src["shapes"], crs=4269).assign(fips=src["fips"]) for src in source.values()]).set_index("code").to_crs(5070)
g["geometry"] = g.geometry.buffer(0)
g["adults"] = g.pops * 100
built = g[g.density >= FLOOR]
parent = {i: i for i in built.index}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


index = built.sindex
for i, shape in built.geometry.buffer(30).items():
    for j in built.index[index.query(shape, predicate="intersects")]:
        if j != i:
            parent[find(i)] = find(j)
cluster = pd.Series({i: find(i) for i in built.index})
size = built.adults.groupby(cluster).sum()
joined = True
while joined:
    joined = False
    for c in [c for c in size.index if size[c] >= CITY]:
        if c not in size.index:
            continue
        reach = built[cluster == c].geometry.union_all().buffer(JUMP)
        near = built.index[index.query(reach, predicate="intersects")]
        for d in set(cluster[near]) - {c}:
            if size[d] < CITY:
                cluster[cluster == d] = c
                joined = True
        size = built.adults.groupby(cluster).sum()
cities = built[cluster.map(size) >= CITY].geometry.union_all().buffer(30)
core = {}
for c in size.index[size >= CITY]:   # each city's own bar for its core: the density its middle resident lives at, times DENSER
    m = built[cluster == c].sort_values("density")
    half = m.adults.cumsum() >= m.adults.sum() / 2
    core[c] = max(CORE, DENSER * float(m.density[half].iloc[0]))


def kind(i):
    if i in cluster.index:
        n = size[cluster[i]]
        if n >= CITY:
            return "urban" if g.density[i] >= core[cluster[i]] else "suburban"
        return "small town" if n >= TOWN else "rural"
    edge = g.geometry[i].boundary
    if edge.length and edge.intersection(cities).length / edge.length >= RING:
        return "exurban"
    return "exurban" if g.density[i] >= THIN and g.geometry[i].distance(cities) <= EDGE else "rural"


area = {i: kind(i) for i in g.index}
before, after = Counter(), Counter()
for f, src in source.items():
    for feature in src["shapes"]["features"]:
        feature["properties"]["area"] = area[feature["properties"]["code"]]
    f.write_text(json.dumps(src, separators=(",", ":")))
    path = DATA / "pops" / f.name
    book = json.loads(path.read_text())
    for p in book["pops"]:
        before[p["area"]] += 1
        new = area.get(p["hood"], p["area"])
        p["words"] = [WORD[new] if w in WORD.values() else w for w in p["words"]]
        p["area"] = new
        after[new] += 1
    for h in book.get("neighbourhoods", []):
        if h["hood"] in area:
            h["area"] = area[h["hood"]]
    path.write_text(json.dumps(book, separators=(",", ":")))
print("cities:", int((size >= CITY).sum()), "| towns:", int(((size >= TOWN) & (size < CITY)).sum()))
print("pops before:", dict(before))
print("pops after: ", dict(after))
