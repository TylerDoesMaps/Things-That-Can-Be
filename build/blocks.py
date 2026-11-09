#!/usr/bin/env python3
"""Builds block layers and the Florida 2024 containment audit.

Usage: blocks.py RAW_DIR WORK_DIR FL_PRECINCT_CSV_GZ L2_CSV OUT_JSON
"""
import io
import json
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAW, WORK = Path(sys.argv[1]), Path(sys.argv[2])
PRECINCTS, L2, OUT = sys.argv[3], sys.argv[4], Path(sys.argv[5])
(WORK / "blocks").mkdir(parents=True, exist_ok=True)

places = pd.read_csv(RAW / "ref/national_place2020.txt", sep="|", dtype=str, encoding="latin-1")
cities = places[places.TYPE != "CENSUS DESIGNATED PLACE"]
CITY_IDS = set(cities.STATEFP + cities.PLACEFP)


def baf(fips, abbr, suffix):
    with zipfile.ZipFile(RAW / f"baf/{fips}_{abbr}.zip") as zf:
        name = next(n for n in zf.namelist() if n.endswith(f"_{suffix}.txt"))
        return pd.read_csv(io.BytesIO(zf.read(name)), sep="|", dtype=str, keep_default_na=False)


def load_blocks(fips):
    columns = ["GEOID20", "COUNTYFP20", "POP20", "ALAND20", "INTPTLAT20", "INTPTLON20", "geometry"]
    gdf = gpd.read_file(f"zip://{RAW}/blocks/tl_2024_{fips}_tabblock20.zip", engine="pyogrio", columns=columns[:-1])
    gdf = gdf.to_crs(4326)
    gdf["POP20"] = gdf.POP20.astype(int)
    gdf["ALAND20"] = gdf.ALAND20.astype("int64")
    return gdf


def attach_city(gdf, fips, abbr):
    table = baf(fips, abbr, "INCPLACE_CDP").set_index("BLOCKID").PLACEFP
    pid = fips + gdf.GEOID20.map(table).fillna("")
    gdf["c"] = pid.where(pid.isin(CITY_IDS), "")
    return gdf


def attach_district(gdf, path, field, column):
    lines = gpd.read_file(f"zip://{path}", engine="pyogrio", columns=[field]).to_crs(4326)
    points = gpd.GeoDataFrame(
        {"GEOID20": gdf.GEOID20.values},
        geometry=gpd.points_from_xy(gdf.INTPTLON20.astype(float), gdf.INTPTLAT20.astype(float)),
        crs=4326,
    )
    joined = gpd.sjoin(points, lines, how="left", predicate="within").drop_duplicates("GEOID20")
    gdf[column] = gdf.GEOID20.map(joined.set_index("GEOID20")[field]).fillna("")
    return gdf


def write_counties(gdf, columns):
    keep = gdf[(gdf.ALAND20 > 0) | (gdf.POP20 > 0)]
    for county, part in keep.groupby("COUNTYFP20"):
        fips = part.GEOID20.iloc[0][:5]
        part[columns + ["geometry"]].to_file(
            WORK / "blocks" / f"{fips}.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=6)
    return keep


def nunique(df, group, col):
    return df.groupby(group, sort=False)[col].nunique()


fl = attach_city(load_blocks("12"), "12", "FL")
pre = pd.read_csv(PRECINCTS, dtype={"GEOID20": str, "PRECINCTID": str}, keep_default_na=False).set_index("GEOID20")
fl["p"] = fl.GEOID20.map(pre.PRECINCTID).fillna("")
fl["pop"] = fl.POP20
fl["id"] = fl.GEOID20
for path, field, column in [
    (RAW / "geo/tl_2024_12_cd119.zip", "CD119FP", "cd"),
    (RAW / "geo/tl_2024_12_sldu.zip", "SLDUST", "su"),
    (RAW / "geo/tl_2024_12_sldl.zip", "SLDLST", "sl"),
]:
    fl = attach_district(fl, path, field, column)
kept = write_counties(fl, ["id", "pop", "c", "p", "cd", "su", "sl"])
print("FL blocks written", len(kept), "of", len(fl), flush=True)

nc = attach_city(load_blocks("37"), "37", "NC")
nc = nc[nc.COUNTYFP20.isin(["127", "065"])].copy()
nc["pop"], nc["id"] = nc.POP20, nc.GEOID20
write_counties(nc, ["id", "pop", "c"])
print("NC blocks written", len(nc), flush=True)

df = pd.DataFrame(fl.drop(columns="geometry"))
df["county"], df["bg"] = df.GEOID20.str[:5], df.GEOID20.str[:12]
assigned = df[df.p != ""]
lived = assigned[assigned.POP20 > 0]
audit = {
    "blocks": len(df),
    "blocks_with_people": int((df.POP20 > 0).sum()),
    "blocks_no_precinct": int((df.p == "").sum()),
    "blocks_no_precinct_people": int(df.loc[df.p == "", "POP20"].sum()),
    "precincts": int(assigned.p.nunique()),
    "precinct_multi_county": int((nunique(lived, "p", "county") > 1).sum()),
}
for col, key in [("c", "muni"), ("cd", "cd"), ("su", "sldu"), ("sl", "sldl"), ("bg", "bg")]:
    audit[f"precinct_cross_{key}"] = int((nunique(lived, "p", col) > 1).sum())
audit["bg_cross_precinct"] = int((nunique(lived, "bg", "p") > 1).sum())
audit["bg_with_people"] = int(lived.bg.nunique())
audit["neighborhoods"] = int(lived.groupby(["p", "c", "cd", "su", "sl"], sort=False).ngroups)
audit["neighborhoods_all_blocks"] = int(assigned.groupby(["p", "c", "cd", "su", "sl"], sort=False).ngroups)

blocks = set(df.GEOID20)
l2 = pd.read_csv(L2, dtype={"geoid20": str}, usecols=["geoid20", "voted_all", "reg_all"])
matched = l2[l2.geoid20.isin(blocks)]
unmatched = l2[~l2.geoid20.isin(blocks)]
audit["l2_rows"] = len(l2)
audit["l2_rows_matched"] = len(matched)
audit["l2_unmatched_ids"] = unmatched.geoid20.head(10).tolist()
audit["l2_voted"] = int(l2.voted_all.sum())
audit["l2_voted_unmatched"] = int(unmatched.voted_all.sum())
audit["l2_registered"] = int(l2.reg_all.sum())
audit["results_harris"] = int(round(pd.to_numeric(pre.G24PREDHAR, errors="coerce").sum()))
audit["results_trump"] = int(round(pd.to_numeric(pre.G24PRERTRU, errors="coerce").sum()))

OUT.write_text(json.dumps({k: v for k, v in audit.items() if not k.startswith("l2")}, indent=0))
print(json.dumps(audit, indent=1))
