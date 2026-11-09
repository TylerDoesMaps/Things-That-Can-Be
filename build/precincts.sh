#!/bin/bash
# Converts split NYT state TopoJSON files into per-state web layers.
# Florida keeps its block-built layer so it nests exactly in blocks.
# Usage: precincts.sh SPLIT_DIR WORK_DIR DATA_DIR
set -euo pipefail
SPLIT=$1
WORK=$2
DATA=$3
mkdir -p "$WORK/precinct_geo" "$DATA/precinct"
for f in "$SPLIT"/*.json; do
  st=$(basename "$f" .json)
  mapshaper-xl 6gb "$f" -simplify 30% keep-shapes \
    -o "$WORK/precinct_geo/$st.json" format=geojson precision=0.00001 2>/dev/null
  [ "$st" = FL ] && continue
  mapshaper-xl 6gb "$WORK/precinct_geo/$st.json" -o "$DATA/precinct/$st.json" format=topojson quantization=1e5 2>/dev/null
done
