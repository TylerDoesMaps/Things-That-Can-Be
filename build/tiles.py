#!/usr/bin/env python3
"""Builds the game's map tiles from the shapes game.py leaves in WORK_DIR/game.

One layer each for neighbourhoods, commission districts, cities and unincorporated areas, counties, and the State House,
State Senate and Congress districts. Every place carries the numbers the map shades by, so the map needs no other file.
Usage: tiles.py WORK_DIR OUT_PMTILES
"""
import subprocess
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

WORK, OUT = Path(sys.argv[1]) / "game", Path(sys.argv[2])
places = pd.concat([gpd.read_file(f, engine="pyogrio") for f in sorted(WORK.glob("12*.gpkg"))])
args = []
for kind in ("hood", "district", "muni", "county"):
    part = places[places.kind == kind].drop(columns="kind")
    part.to_file(WORK / f"{kind}.geojsonl", driver="GeoJSONSeq", engine="pyogrio")
    args += ["-L", f"{kind}:{WORK / (kind + '.geojsonl')}"]
for field in ("house", "senate", "congress"):
    gpd.read_file(WORK / f"{field}.gpkg", engine="pyogrio").to_file(WORK / f"{field}.geojsonl", driver="GeoJSONSeq", engine="pyogrio")
    args += ["-L", f"{field}:{WORK / (field + '.geojsonl')}"]
OUT.unlink(missing_ok=True)
subprocess.run(["tippecanoe", "-o", str(OUT), "-Z5", "-z12", "--detect-shared-borders", "--no-tile-size-limit", "--no-feature-limit", "--no-tiny-polygon-reduction",
                "--simplification=4", "--force", "-q", *args], check=True)
print(OUT, round(OUT.stat().st_size / 1e6, 1), "MB")
