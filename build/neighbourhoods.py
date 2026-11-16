#!/usr/bin/env python3
"""Builds three candidate sets of neighbourhoods for one county so they can be compared.

A: precinct pieces. Blocks sharing a precinct, a city (or none) and a state house district.
B: block group pieces. The same, with the census block group in place of the precinct.
C: built. Starts from A and merges any piece under SMALL adults into the touching piece it shares the longest
   border with, never across a city or state house line. Pieces over BIG adults are counted, not yet split.
Commission and council districts are not used: they will be drawn from the neighbourhoods.
Sizes are given in pops of 100. The page takes the built set's pop counts from the pops file, which is the authority. Also writes WORK_DIR/neighbourhoods/<county>.csv: each block's C code.
Usage: neighbourhoods.py RAW_DIR WORK_DIR STATE_ABBR STATE_FIPS COUNTY_FIPS PRECINCT_PREFIX COUNTY_NAME CODE OUT_JSON
"""
import io
import json
import random
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAW, WORK, ST, SF, CF, PREFIX, COUNTY, CODE, OUT = (Path(sys.argv[1]), Path(sys.argv[2]), *sys.argv[3:9], Path(sys.argv[9]))
SMALL, BIG, POP = 300, 2000, 100

blocks = gpd.read_file(f"zip://{RAW}/blocks/{SF}{CF}.zip", engine="pyogrio")[["GEOID20", "geometry"]].rename(columns={"GEOID20": "block"})
with zipfile.ZipFile(RAW / f"pl/{ST.lower()}.zip") as z:
    geo = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}geo2020.pl")), sep="|", header=None, dtype=str, usecols=[2, 7, 9], encoding="latin-1", keep_default_na=False)
    geo.columns = ["sumlev", "rec", "block"]
    geo = geo[(geo.sumlev == "750") & geo.block.str.startswith(SF + CF)]
    s2 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000022020.pl")), sep="|", header=None, dtype=str, usecols=[4, 76]).set_axis(["rec", "adults"], axis=1)
    s3 = pd.read_csv(io.BytesIO(z.read(f"{ST.lower()}000032020.pl")), sep="|", header=None, dtype=str, usecols=[4, 7]).set_axis(["rec", "prison"], axis=1)
counts = geo.merge(s2, on="rec").merge(s3, on="rec")
counts["adults"] = (counts.adults.astype(int) - counts.prison.astype(int)).clip(lower=0)
blocks = blocks.merge(counts[["block", "adults"]], on="block", how="left").fillna({"adults": 0})
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


prec = gpd.read_file(WORK / f"pgeo/{ST}.geojson", engine="pyogrio")
prec = prec[prec.p.str.startswith(PREFIX)]
places = gpd.read_file(f"zip://{RAW}/tiger/{SF}_place.zip", engine="pyogrio")
places = places[places.CLASSFP.str.startswith("C")]
house = gpd.read_file(f"zip://{RAW}/tiger/{SF}_sldl.zip", engine="pyogrio")
blocks["precinct"] = inside(prec, "p", "precinct", nearest=True).str.replace(PREFIX, "", regex=False).str.lstrip("-")
blocks["city"] = inside(places, "NAME", "city").fillna("")
blocks["house"] = inside(house, "SLDLST", "house").astype(int)
blocks["bg"] = blocks.block.str[5:12]
hard = ["city", "house"]
blocks["hard"] = blocks[hard].astype(str).agg("|".join, axis=1)
blocks["A"] = blocks.precinct + "/" + blocks.hard
blocks["B"] = blocks.bg + "/" + blocks.hard


def built():
    key = blocks.A.copy()
    flat = blocks.to_crs(5070)
    while True:
        size = blocks.groupby(key).adults.sum().sort_values()
        shapes = flat.assign(k=key).dissolve("k").geometry
        merged = False
        for k in size[size < SMALL].index:
            me, mine = shapes[k], k.split("/")[1].split("#")[0]
            best, score = None, 0
            for other, shape in shapes.items():
                if other == k or other.split("/")[1].split("#")[0] != mine or not me.intersects(shape):
                    continue
                border = me.boundary.intersection(shape.boundary).length
                if border > score:
                    best, score = other, border
            if best:
                key[key == k] = best
                merged = True
                break
        if not merged:
            return key


blocks["C"] = built()
random.seed(12065)
out = {"county": COUNTY, "small": SMALL, "big": BIG, "options": {}}
for option, label in (("A", "Precinct pieces"), ("B", "Block group pieces"), ("C", "Built neighbourhoods")):
    g = blocks.dissolve(option, aggfunc={"adults": "sum", "city": "first", "house": "first", "precinct": lambda s: ", ".join(sorted(set(s), key=lambda x: (len(x), x)))})
    numbers = list(range(1, len(g) + 1))
    random.shuffle(numbers)
    g["code"] = [f"{CODE}-{n:02d}" for n in numbers]
    want, base = int(round(g.adults.sum() / POP)), (g.adults // POP).astype(int)
    for k in (g.adults / POP - base).sort_values(ascending=False).index[: want - base.sum()]:
        base[k] += 1
    g["pops"] = base
    g["geometry"] = g.geometry.simplify(0.0002)
    n = g.pops
    stats = {"neighbourhoods": len(g), "with no pops": int((n == 0).sum()), f"under {SMALL // POP} pops": int((n < SMALL // POP).sum()),
             f"over {BIG // POP} pops, to split later": int((n > BIG // POP).sum()), "median pops": float(n.median()), "largest, in pops": int(n.max()), "pops": int(n.sum())}
    out["options"][option] = {"label": label, "stats": stats,
                              "shapes": json.loads(g.reset_index(drop=True)[["code", "pops", "city", "house", "precinct", "geometry"]].to_json(drop_id=True))}
    if option == "C":
        (WORK / "neighbourhoods").mkdir(exist_ok=True)
        blocks[["block"]].assign(code=blocks.C.map(g.code)).to_csv(WORK / f"neighbourhoods/{SF}{CF}.csv", index=False)
    print(option, stats)
lines = {"Precincts": prec.dissolve("p").boundary, "City": places[places.NAME.isin(set(blocks.city) - {""})].boundary, "State House districts": house[house.SLDLST.astype(int).isin(set(blocks.house))].clip(blocks.union_all()).boundary}
out["lines"] = {name: json.loads(s.to_crs(blocks.crs).simplify(0.0002).to_json()) for name, s in lines.items()}
out["bounds"] = [round(v, 4) for v in blocks.total_bounds]
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, separators=(",", ":")))
print(OUT.stat().st_size)
