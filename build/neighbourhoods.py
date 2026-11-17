#!/usr/bin/env python3
"""Builds the neighbourhoods of one county.

Blocks are grouped by precinct, city (or none), State House, State Senate and congressional district. A piece over
BIG pops is split along census block groups into parts of about PART pops. A piece under SMALL pops is merged into
the touching piece it shares the longest border with, never across a city or district line. Commission and council
districts are not boundaries: they are drawn from neighbourhoods afterwards.
Each neighbourhood gets an area type from its density and the size of its city.
Sizes here use the 2020 voting-age count less prisoners; the pops file is the authority on pop counts.
Writes OUT_JSON for the site and WORK_DIR/neighbourhoods/<county>.csv with each block's neighbourhood.
Usage: neighbourhoods.py RAW_DIR WORK_DIR STATE_ABBR STATE_FIPS COUNTY_FIPS PRECINCT_PREFIX COUNTY_NAME CODE OUT_JSON
"""
import io
import json
import random
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import shapely
import pandas as pd

RAW, WORK, ST, SF, CF, PREFIX, COUNTY, CODE, OUT = (Path(sys.argv[1]), Path(sys.argv[2]), *sys.argv[3:9], Path(sys.argv[9]))
POP, SMALL, BIG, PART = 100, 3, 50, 20
URBAN_CITY, URBAN_DENSITY, SUBURBAN_DENSITY, TOWN = 50000, 2000, 400, 750  # people in the city; adults per square mile; adults in the city

blocks = gpd.read_file(f"zip://{RAW}/blocks/{SF}{CF}.zip", engine="pyogrio")[["GEOID20", "ALAND20", "geometry"]].rename(columns={"GEOID20": "block", "ALAND20": "land"})
with zipfile.ZipFile(RAW / f"pl/{ST.lower()}.zip") as z:
    geo = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}geo2020.pl")), sep="|", header=None, dtype=str, usecols=[2, 7, 9, 87, 90], encoding="latin-1", keep_default_na=False)
    geo.columns = ["sumlev", "rec", "block", "name", "people"]
    city_people = geo[geo.sumlev == "160"].assign(name=lambda d: d.name.str.replace(r" (city|town|village)$", "", regex=True)).set_index("name").people.astype(int).to_dict()
    geo = geo[(geo.sumlev == "750") & geo.block.str.startswith(SF + CF)]
    s2 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000022020.pl")), sep="|", header=None, dtype=str, usecols=[4, 76]).set_axis(["rec", "adults"], axis=1)
    s3 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000032020.pl")), sep="|", header=None, dtype=str, usecols=[4, 7]).set_axis(["rec", "prison"], axis=1)
counts = geo.merge(s2, on="rec").merge(s3, on="rec")
counts["adults"] = (counts.adults.astype(int) - counts.prison.astype(int)).clip(lower=0)
blocks = blocks.merge(counts[["block", "adults"]], on="block", how="left").fillna({"adults": 0}).reset_index(drop=True)
pts = gpd.GeoDataFrame(blocks[["block"]], geometry=blocks.geometry.representative_point(), crs=blocks.crs)


def inside(layer, field, name, nearest=False):
    layer = layer.to_crs(pts.crs)[[field, "geometry"]].rename(columns={field: name})
    j = gpd.sjoin(pts, layer, how="left", predicate="within")
    j = j[~j.index.duplicated()]
    if nearest and j[name].isna().any():
        miss = j[name].isna()
        near = gpd.sjoin_nearest(pts[miss.values].to_crs(5070), layer.to_crs(5070), how="left")
        j.loc[miss, name] = near[~near.index.duplicated()][name]
    return j[name]


def tiger(layer):
    return gpd.read_file(f"zip://{RAW}/tiger/{SF}_{layer}.zip", engine="pyogrio")


prec = gpd.read_file(WORK / f"pgeo/{ST}.geojson", engine="pyogrio")
prec = prec[prec.p.str.startswith(PREFIX)]
places = tiger("place")
places = places[places.CLASSFP.str.startswith("C")]
house, senate, congress = tiger("sldl"), tiger("sldu"), tiger("cd")
cd_field = [c for c in congress.columns if c.startswith("CD") and c.endswith("FP")][0]
blocks["precinct"] = inside(prec, "p", "precinct", nearest=True).str.replace(PREFIX, "", regex=False).str.lstrip("-")
blocks["city"] = inside(places, "NAME", "city").fillna("")
blocks["house"] = inside(house, "SLDLST", "house", nearest=True).astype(int)
blocks["senate"] = inside(senate, "SLDUST", "senate", nearest=True).astype(int)
blocks["congress"] = inside(congress, cd_field, "congress", nearest=True).astype(int)
blocks["bg"] = blocks.block.str[5:12]
blocks["hard"] = blocks[["city", "house", "senate", "congress"]].astype(str).agg("|".join, axis=1)

# ---- which blocks touch, and along how much border
flat = blocks.to_crs(5070).geometry
pairs = gpd.sjoin(gpd.GeoDataFrame(geometry=flat), gpd.GeoDataFrame(geometry=flat), predicate="intersects")
pairs = pairs[pairs.index < pairs.index_right]
border = {}
for a, b in zip(pairs.index, pairs.index_right):
    length = flat[a].boundary.intersection(flat[b].boundary).length
    if length > 1:
        border[(a, b)] = length

# ---- pieces, as a graph
piece = (blocks.precinct + "/" + blocks.hard).tolist()


def graph(labels):
    size, near = defaultdict(float), defaultdict(lambda: defaultdict(float))
    for label, adults in zip(labels, blocks.adults):
        size[label] += adults
    for (a, b), length in border.items():
        if labels[a] != labels[b]:
            near[labels[a]][labels[b]] += length
            near[labels[b]][labels[a]] += length
    return size, near


def merge_small(labels, limit, same):
    """Merges every piece under 'limit' adults into its longest-bordered neighbour that 'same' allows."""
    size, near = graph(labels)
    into = {}
    stuck = set()
    while True:
        small = [k for k in size if size[k] < limit and k not in stuck]
        if not small:
            break
        k = min(small, key=lambda x: size[x])
        options = {o: length for o, length in near[k].items() if same(k, o)}
        if not options:
            stuck.add(k)
            continue
        best = max(options, key=options.get)
        into[k] = best
        size[best] += size.pop(k)
        for o, length in near.pop(k).items():
            del near[o][k]
            if o != best:
                near[best][o] += length
                near[o][best] += length

    def root(k):
        while k in into:
            k = into[k]
        return k
    return [root(k) for k in labels]


hard_of = lambda k: k.split("/")[1].split("#")[0]
size, _ = graph(piece)
big = {k for k, n in size.items() if n > BIG * POP}
to_split = len(big)
if big:
    piece = [f"{k}#{bg}" if k in big else k for k, bg in zip(piece, blocks.bg)]
    piece = merge_small(piece, PART * POP * 0.6, lambda a, b: "#" in a and "#" in b and a.split("#")[0] == b.split("#")[0])
piece = merge_small(piece, SMALL * POP, lambda a, b: hard_of(a) == hard_of(b))
blocks["piece"] = piece

# ---- neighbourhoods
g = blocks.dissolve("piece", aggfunc={"adults": "sum", "land": "sum", "city": "first", "house": "first", "senate": "first", "congress": "first",
                                      "precinct": lambda s: ", ".join(sorted(set(s), key=lambda x: (len(x), x)))})
random.seed(int(SF + CF))
numbers = list(range(1, len(g) + 1))
random.shuffle(numbers)
width = max(2, len(str(len(g))))
g["code"] = [f"{CODE}-{n:0{width}d}" for n in numbers]
want, base = int(round(g.adults.sum() / POP)), (g.adults // POP).astype(int)
for k in (g.adults / POP - base).sort_values(ascending=False).index[: want - base.sum()]:
    base[k] += 1
g["pops"] = base
g["density"] = (g.adults / (g.land / 2589988.11).clip(lower=0.01)).round().astype(int)
city_adults = blocks.groupby("city").adults.sum()
metro = any(city_people.get(c, 0) >= URBAN_CITY for c in set(blocks.city) - {""})


def area(row):
    if row.city and city_people.get(row.city, 0) >= URBAN_CITY and row.density >= URBAN_DENSITY:
        return "urban"
    if (metro and row.density >= SUBURBAN_DENSITY) or (row.city and city_people.get(row.city, 0) >= URBAN_CITY):
        return "suburban"
    if (row.city and city_adults.get(row.city, 0) >= TOWN) or row.density >= SUBURBAN_DENSITY:
        return "small town"
    return "rural"


g["area_type"] = g.apply(area, axis=1)
area_of = g.area_type.to_dict()
# true sizes and shared borders, taken before the shapes are simplified for drawing
true = g.to_crs(5070).geometry
code_of = blocks.piece.map(g.code).tolist()
borders = defaultdict(lambda: defaultdict(float))
for (a, b), length in border.items():
    if code_of[a] != code_of[b]:
        borders[code_of[a]][code_of[b]] += length
        borders[code_of[b]][code_of[a]] += length
measures = {c: {"sq_m": round(true[k].area), "edge_m": round(true[k].length), "borders": {o: round(v) for o, v in borders[c].items()}} for k, c in g.code.items()}
# simplify all the shapes together, so a border two neighbourhoods share stays one line
# cut away the sea: the Census's water areas for the county that are bay, sound, gulf or ocean, and any river of a square kilometre or more.
# Lakes, ponds and reservoirs stay as land, so the map has no holes in it.
water = gpd.read_file(f"zip://{RAW}/water/{SF}{CF}.zip", engine="pyogrio").to_crs(5070)
water = water[water.MTFCC.isin(["H2051", "H2053"]) | ((water.MTFCC == "H3010") & (water.area >= 1e6))]
cut = gpd.overlay(gpd.GeoDataFrame({"piece": true.index}, geometry=true.buffer(0).values, crs=5070), gpd.GeoDataFrame(geometry=water.geometry.buffer(0).values, crs=5070), how="difference").dissolve("piece").geometry
dry = cut.apply(lambda s: shapely.unary_union([p for p in shapely.get_parts(s) if p.geom_type == "Polygon" and p.area > 400])).reindex(true.index)
gone = [k for k in true.index if (dry[k] is None or dry[k].area < 0.1 * true[k].area) and g.pops[k] == 0]  # a neighbourhood that is nine-tenths water or more and holds nobody is left off the map
dry = dry.where(~(dry.isna() | dry.is_empty), true)  # one that holds people keeps its shape rather than vanish
g, dry = g.drop(index=gone), dry.drop(index=gone)
g["geometry"] = gpd.GeoSeries(shapely.coverage_simplify(dry.buffer(0).values, 15), index=g.index, crs=5070).to_crs(blocks.crs).buffer(0)
(WORK / "neighbourhoods").mkdir(exist_ok=True)
blocks[["block", "adults"]].assign(code=code_of, area=blocks.piece.map(area_of)).to_csv(WORK / f"neighbourhoods/{SF}{CF}.csv", index=False)
n = g.pops
stats = {"neighbourhoods": len(g), "left off as water": len(gone), "pops": int(n.sum()), "median pops": float(n.median()), "largest, in pops": int(n.max()), "under 3 pops": int((n < SMALL).sum()),
         "over 50 pops": int((n > BIG).sum()), "precinct pieces that were split": to_split, "area types": g.area_type.value_counts().to_dict()}
outline = g.geometry.union_all().boundary.buffer(0.00002)


def between(field):
    """The borders between neighbourhoods that differ on this field, cut from the neighbourhood shapes so they sit exactly on them."""
    return gpd.GeoSeries([g.dissolve(field).boundary.union_all().difference(outline)], crs=blocks.crs)


lines = {"Precincts": prec.to_crs(blocks.crs).geometry.buffer(0).boundary.simplify(0.0002), "City": between("city")}
for name, field in (("State House districts", "house"), ("State Senate districts", "senate"), ("Congressional districts", "congress")):
    if g[field].nunique() > 1:
        lines[name] = between(field)
out = {"county": COUNTY, "code": CODE, "fips": SF + CF, "stats": stats, "bounds": [round(v, 4) for v in g.total_bounds], "measures": measures,
       "shapes": json.loads(g.reset_index(drop=True)[["code", "pops", "city", "house", "senate", "congress", "precinct", "area_type", "density", "geometry"]].rename(columns={"area_type": "area"}).to_json(drop_id=True)),
       "lines": {name: json.loads(s.to_json()) for name, s in lines.items()}}
OUT.parent.mkdir(parents=True, exist_ok=True)
def trim(o):
    if isinstance(o, float):
        return round(o, 5)
    if isinstance(o, list):
        return [trim(v) for v in o]
    if isinstance(o, dict):
        return {k: trim(v) for k, v in o.items()}
    return o


out["shapes"], out["lines"] = trim(out["shapes"]), trim(out["lines"])
OUT.write_text(json.dumps(out, separators=(",", ":")))
print(COUNTY, stats, OUT.stat().st_size)
