#!/usr/bin/env python3
"""Allocates 2024 precinct votes to cities, townships and districts through 2020 census blocks.

Each block is placed in one precinct and one unit of every layer by its internal point.
A precinct's votes are shared among its blocks three ways, so the methods can be compared:
  vap    by voting-age population (the published numbers)
  area   by block area
  whole  the whole precinct goes to the unit holding most of its adults
Usage: allocate.py RAW_DIR WORK_DIR ST [ST ...]
"""
import io
import json
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAW, WORK = Path(sys.argv[1]), Path(sys.argv[2])
FIPS = dict(AL="01", AK="02", AZ="04", AR="05", CA="06", CO="08", CT="09", DE="10", DC="11", FL="12", GA="13",
            HI="15", ID="16", IL="17", IN="18", IA="19", KS="20", KY="21", LA="22", ME="23", MD="24", MA="25",
            MI="26", MN="27", MS="28", MO="29", MT="30", NE="31", NV="32", NH="33", NJ="34", NM="35", NY="36",
            NC="37", ND="38", OH="39", OK="40", OR="41", PA="42", RI="44", SC="45", SD="46", TN="47", TX="48",
            UT="49", VT="50", VA="51", WA="53", WV="54", WI="55", WY="56")
TOWNSHIP_STATES = set("CT IL IN KS ME MA MI MN MO NE NH NJ NY ND OH PA RI SD VT WI".split())
LAYERS = ["city", "township", "cd", "sldu", "sldl"]


def blocks(st):
    with zipfile.ZipFile(RAW / f"pl/{st.lower()}.zip") as z:
        geo = pd.read_csv(io.BytesIO(z.read(f"{st.lower()}geo2020.pl")), sep="|", header=None, dtype=str,
                          usecols=[2, 7, 9, 84, 85, 92, 93], encoding="latin-1", keep_default_na=False)
        geo.columns = ["sumlev", "rec", "block", "land", "water", "lat", "lon"]
        geo = geo[geo.sumlev == "750"]
        seg = pd.read_csv(io.BytesIO(z.read(f"{st.lower()}000022020.pl")), sep="|", header=None, dtype=str,
                          usecols=[4, 5])
        seg.columns = ["rec", "vap"]
    b = geo.merge(seg, on="rec")
    b["vap"] = b.vap.astype(float)
    b["area"] = b.land.astype(float) + b.water.astype(float)
    return gpd.GeoDataFrame(b[["block", "vap", "area"]],
                            geometry=gpd.points_from_xy(b.lon.astype(float), b.lat.astype(float)), crs=4269)


def layer(st, name):
    path = RAW / f"tiger/{FIPS[st]}_{name}.zip"
    if not path.exists():
        return None
    return gpd.read_file(f"zip://{path}", engine="pyogrio")


def units(st):
    out = {}
    g = layer(st, "place")
    out["city"] = g[~g.CLASSFP.str[0].isin(["U", "M"])][["GEOID", "geometry"]]
    if st in TOWNSHIP_STATES:
        g = layer(st, "cousub")
        out["township"] = g[g.CLASSFP.str.startswith("T") & (g.FUNCSTAT == "A")][["GEOID", "geometry"]]
    for name in ["cd", "sldu", "sldl"]:
        g = layer(st, name)
        if g is not None:
            g = g[~g.GEOID.str.endswith("ZZ") & ~g.GEOID.str.endswith("ZZZ")]
            out[name] = g[["GEOID", "geometry"]]
    return out


def votes_county(p):
    return p[:5] if p[:5].isdigit() else ""


def run(st):
    pts = blocks(st)
    pre = gpd.read_file(WORK / f"pgeo/{st}.geojson", engine="pyogrio")[["p", "geometry"]].set_crs(4269, allow_override=True)
    pre["geometry"] = pre.geometry.make_valid()
    votes = json.loads((RAW / f"nyt/results/{st}.json").read_text())
    votes = {k: [x or 0 for x in v] for k, v in votes.items()}

    j = gpd.sjoin(pts, pre, how="left", predicate="within")
    j = j[~j.index.duplicated()].drop(columns="index_right")
    miss = j.p.isna() & (j.vap > 0)
    if miss.any():
        # Populated blocks just outside a simplified precinct edge take the nearest precinct within 500 m.
        utm = pre.estimate_utm_crs()
        near = gpd.sjoin_nearest(j.loc[miss, ["geometry"]].to_crs(utm), pre.to_crs(utm), how="left", max_distance=500)
        near = near[~near.index.duplicated()]
        j.loc[miss, "p"] = near.p
    nearest = int(miss.sum())
    uncovered = int(j.loc[j.p.isna(), "vap"].sum())
    j["county"] = j.block.str[:5]
    us = units(st)

    def tag(frame):
        for name, g in us.items():
            k = gpd.sjoin(frame[["geometry"]], g, how="left", predicate="within")
            frame[name] = k[~k.index.duplicated()].GEOID.fillna("")
        return frame

    j = tag(j)
    # Share of each unit's adults living in a block that has a precinct.
    cover = {}
    for name in ["county"] + list(us):
        have = j[j.p.notna()].groupby(name).vap.sum()
        cover[name] = (have.reindex(j[name].unique()).fillna(0) / j.groupby(name).vap.sum().replace(0, np.nan)).fillna(1)
    j = j[j.p.notna()]

    # A precinct that caught no block still has to land somewhere.
    caught = set(j.p)
    lost = [p for p in votes if votes[p][2] > 0 and p not in caught]
    if lost:
        sub = pre[pre.p.isin(lost)].drop_duplicates("p")
        extra = gpd.GeoDataFrame({"block": "", "vap": 1.0, "area": 1.0, "p": sub.p.values},
                                 geometry=sub.geometry.representative_point().values, crs=4269)
        extra["county"] = [votes_county(p) for p in extra.p]
        j = pd.concat([j, tag(extra)], ignore_index=True)

    v = pd.DataFrame.from_dict(votes, orient="index", columns=["d", "r", "t"])
    j = j[j.p.isin(v.index)].copy()
    tot = j.groupby("p")[["vap", "area"]].transform("sum")
    j["w_vap"] = j.vap / tot.vap.replace(0, np.nan)
    zero = tot.vap <= 0
    if zero.any():
        s = (j.loc[zero, "area"] + 1)
        j.loc[zero, "w_vap"] = s / s.groupby(j.loc[zero, "p"]).transform("sum")
    j["w_area"] = (j.area + 1) / (j.area + 1).groupby(j.p).transform("sum")
    for c in "drt":
        j[c] = j.p.map(v[c]).astype(float)

    out = {"state": st, "layers": {}, "stats": {}, "blocks": len(pts), "nearest": nearest, "uncovered_vap": uncovered, "vap": int(pts.vap.sum()), "lost": len(lost),
           "unplaced_votes": int(v.t.sum() - v.t.reindex(j.p.unique()).sum()),
           "votes": [int(v.d.sum()), int(v.r.sum()), int(v.t.sum())]}
    for name in ["county"] + list(us):
        pu = j.groupby(["p", name]).agg(w=("w_vap", "sum"), a=("w_area", "sum")).reset_index()
        for c in "drt":
            pu[c] = pu.p.map(v[c]).astype(float)
        top = pu.sort_values(["p", "w", "a"]).groupby("p").tail(1).set_index("p")
        pu["whole"] = (pu[name].values == top[name].reindex(pu.p).values).astype(float)
        res = {}
        for method, col in [("vap", "w"), ("area", "a"), ("whole", "whole")]:
            agg = pu[["d", "r", "t"]].mul(pu[col], axis=0).groupby(pu[name]).sum()
            for gid, row in agg.iterrows():
                if gid:
                    res.setdefault(gid, {})[method] = [round(row.d, 1), round(row.r, 1), round(row.t, 1)]
        for gid in res:
            res[gid]["in"] = round(float(cover[name].get(gid, 1)), 3)
        out["layers"][name] = res
        parts = pu[pu.w > 1e-9].groupby("p").size()
        split = parts[parts > 1].index
        t_all = v.t.reindex(pu.p.unique()).sum()
        moved = (v.t.reindex(split) * (1 - top.w.reindex(split))).sum()
        out["stats"][name] = {"precincts": int(pu.p.nunique()), "split": int(len(split)),
                              "votes": int(t_all), "votes_in_split": int(v.t.reindex(split).sum()),
                              "votes_minority_side": int(moved)}
    (WORK / f"alloc/{st}.json").write_text(json.dumps(out, separators=(",", ":")))
    print(st, out["blocks"], "nearest", nearest, "uncovered_vap", uncovered, "lost", len(lost), "unplaced", out["unplaced_votes"],
          {k: (s["split"], s["precincts"]) for k, s in out["stats"].items()}, flush=True)


for st in sys.argv[3:]:
    try:
        run(st)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("FAILED", st, e, flush=True)
