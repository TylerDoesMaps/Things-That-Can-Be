#!/usr/bin/env python3
"""Measures which geographies nest inside which, from Census block assignment files.

Usage: containment.py RAW_DIR OUT_DIR
Writes OUT_DIR/containment.json and OUT_DIR/rel/XX.json.
"""
import io
import json
import sys
import zipfile
from pathlib import Path

import pandas as pd

RAW, OUT = Path(sys.argv[1]), Path(sys.argv[2])
(OUT / "rel").mkdir(parents=True, exist_ok=True)

places = pd.read_csv(RAW / "ref/national_place2020.txt", sep="|", dtype=str, encoding="latin-1")
cousubs = pd.read_csv(RAW / "ref/national_cousub2020.txt", sep="|", dtype=str, encoding="latin-1")
cities = places[places.TYPE != "CENSUS DESIGNATED PLACE"].copy()
cities["id"] = cities.STATEFP + cities.PLACEFP
towns = cousubs[cousubs.CLASSFP.str.startswith("T") & (cousubs.FUNCSTAT == "A")].copy()
towns["id"] = towns.STATEFP + towns.COUNTYFP + towns.COUSUBFP
CITY_NAME = dict(zip(cities.id, cities.PLACENAME))
TOWN_NAME = dict(zip(towns.id, towns.COUSUBNAME))


def read(zf, suffix):
    name = next((n for n in zf.namelist() if n.endswith(f"_{suffix}.txt")), None)
    if name is None:
        return None
    return pd.read_csv(io.BytesIO(zf.read(name)), sep="|", dtype=str, keep_default_na=False)


def load_state(path):
    with zipfile.ZipFile(path) as zf:
        df = read(zf, "INCPLACE_CDP").rename(columns={"BLOCKID": "block", "PLACEFP": "place"})
        for suffix, col in [("CD", "cd"), ("SLDU", "sldu"), ("SLDL", "sldl")]:
            part = read(zf, suffix)
            df[col] = "" if part is None else part.set_index("BLOCKID").DISTRICT.reindex(df.block).values
        vtd = read(zf, "VTD")
        df["vtd"] = "" if vtd is None else (vtd.set_index("BLOCKID").DISTRICT.reindex(df.block).fillna("").values)
        mcd = read(zf, "MCD")
        df["mcd"] = "" if mcd is None else mcd.set_index("BLOCKID").COUSUBFP.reindex(df.block).fillna("").values
    df["state"] = df.block.str[:2]
    df["county"] = df.block.str[:5]
    df["bg"] = df.block.str[:12]
    place_id = df.state + df.place
    df["city"] = place_id.where(place_id.isin(CITY_NAME), "")
    town_id = df.county + df.mcd
    df["town"] = town_id.where(town_id.isin(TOWN_NAME), "")
    df["muni"] = df.city + "|" + df.town
    has_vtd = df.vtd.ne("") & df.vtd.ne("ZZZZZZ")
    df["vtdkey"] = (df.county + df.vtd).where(has_vtd, "")
    return df


def nunique_per(df, group, col):
    return df.groupby(group, sort=False)[col].nunique()


def state_stats(df):
    bg_muni = nunique_per(df, "bg", "muni")
    city_rows = df[df.city != ""]
    city_cty = nunique_per(city_rows, "city", "county")
    voted = df[df.vtdkey != ""]
    s = {
        "blocks": len(df),
        "block_groups": df.bg.nunique(),
        "counties": df.county.nunique(),
        "cities": city_rows.city.nunique(),
        "townships": df[df.town != ""].town.nunique(),
        "precincts": voted.vtdkey.nunique(),
        "blocks_no_precinct": int((df.vtdkey == "").sum()),
        "cities_multi_county": int((city_cty > 1).sum()),
        "bg_one_muni": int((bg_muni == 1).sum()),
        "blocks_in_city": int((df.city != "").sum()),
        "blocks_in_township": int((df.town != "").sum()),
        "blocks_no_muni": int(((df.city == "") & (df.town == "")).sum()),
        "neighborhoods_no_precinct": int(df.groupby(["county", "city", "town", "cd", "sldu", "sldl"], sort=False).ngroups),
        "neighborhoods": int(df.groupby(["county", "vtdkey", "city", "town", "cd", "sldu", "sldl"], sort=False).ngroups),
    }
    if len(voted):
        for col, key in [("muni", "precinct_cross_muni"), ("cd", "precinct_cross_cd"),
                         ("sldu", "precinct_cross_sldu"), ("sldl", "precinct_cross_sldl"),
                         ("bg", "precinct_cross_bg")]:
            s[key] = int((nunique_per(voted, "vtdkey", col) > 1).sum())
        s["bg_cross_precinct"] = int((nunique_per(voted, "bg", "vtdkey") > 1).sum())
        s["bg_with_precinct"] = voted.bg.nunique()
    else:
        for key in ("precinct_cross_muni", "precinct_cross_cd", "precinct_cross_sldu", "precinct_cross_sldl",
                    "precinct_cross_bg", "bg_cross_precinct", "bg_with_precinct"):
            s[key] = 0
    return s


def relations(df):
    rel = {"county": {}, "city": {}, "town": {}, "bg": {}, "names": {}}
    for cty, g in df.groupby("county", sort=False):
        rel["county"][cty] = {
            "cities": sorted(x for x in g.city.unique() if x),
            "towns": sorted(x for x in g.town.unique() if x),
            "bg": int(g.bg.nunique()),
            "blocks": len(g),
            "precincts": int(g.loc[g.vtdkey != "", "vtdkey"].nunique()),
        }
    bg_set = df.groupby("bg", sort=False).muni.nunique()
    for col, kind in [("city", "city"), ("town", "town")]:
        rows = df[df[col] != ""]
        for pid, g in rows.groupby(col, sort=False):
            bgs = g.bg.unique()
            rel[kind][pid] = {
                "counties": sorted(g.county.unique()),
                "bg_in": int((bg_set.reindex(bgs) == 1).sum()),
                "bg_part": int((bg_set.reindex(bgs) > 1).sum()),
                "blocks": len(g),
            }
            rel["names"][pid] = CITY_NAME.get(pid) or TOWN_NAME.get(pid)
    for bg, g in df.groupby("bg", sort=False):
        ids = sorted({x for x in g.city.unique() if x} | {x for x in g.town.unique() if x})
        rel["bg"][bg] = {"m": ids, "un": bool(((g.city == "") & (g.town == "")).any()), "blocks": len(g)}
    return rel


def main():
    states, cross = [], []
    for path in sorted((RAW / "baf").glob("*.zip")):
        fips, abbr = path.stem.split("_")
        df = load_state(path)
        s = state_stats(df)
        s.update(fips=fips, state=abbr)
        states.append(s)
        (OUT / "rel" / f"{abbr}.json").write_text(json.dumps(relations(df), separators=(",", ":")))
        city_rows = df[df.city != ""]
        by = city_rows.groupby(["city", "county"], sort=False).size().rename("n").reset_index()
        for cid, g in by.groupby("city", sort=False):
            if len(g) < 2:
                continue
            total = int(g.n.sum())
            share = sorted((g.n / total).tolist(), reverse=True)
            cross.append({"id": cid, "name": CITY_NAME[cid], "state": abbr, "counties": len(g),
                          "blocks": total, "second_share": round(share[1], 4)})
        print(abbr, s["blocks"], s["neighborhoods"], flush=True)

    national = {k: sum(x[k] for x in states) for k in states[0] if k not in ("fips", "state")}
    meaningful = [c for c in cross if c["second_share"] >= 0.05]
    cross.sort(key=lambda c: -c["blocks"])
    (OUT / "containment.json").write_text(json.dumps({
        "national": national, "states": states,
        "cross_county_cities": cross[:60],
        "cross_county_substantial": len(meaningful),
        "cross_county_total": len(cross),
    }, indent=0))
    print(json.dumps(national, indent=1))
    print("cross", len(cross), "substantial", len(meaningful))


main()
