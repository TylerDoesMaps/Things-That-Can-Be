#!/bin/bash
# Converts prepared GeoJSON into web layers. Usage: topo.sh WORK_DIR DATA_DIR
set -euo pipefail
WORK=$1
DATA=$2
MS="mapshaper-xl 12gb"
mkdir -p "$DATA"/{city,township,bg,blocks,precinct}

$MS "$WORK/state.geojson" -simplify 12% keep-shapes -o "$DATA/state.json" format=topojson quantization=1e5
$MS "$WORK/county.geojson" -simplify 18% keep-shapes -o "$DATA/county.json" format=topojson quantization=1e5

for layer in city township bg; do
  mkdir -p "$WORK/split_$layer"
  percent=60%
  [ "$layer" = bg ] && percent=40%
  $MS "$WORK/$layer.geojson" -simplify $percent keep-shapes -split ST -o "$WORK/split_$layer/" format=topojson quantization=1e5 singles
  for f in "$WORK/split_$layer"/*.json; do
    name=$(basename "$f")
    name=${name#"$layer"-}
    cp "$f" "$DATA/$layer/$name"
  done
done

for f in "$WORK"/blocks/*.geojson; do
  fips=$(basename "$f" .geojson)
  $MS "$f" -simplify interval=6 keep-shapes -o "$DATA/blocks/$fips.json" format=topojson quantization=1e5 2>/dev/null
done

$MS -i "$WORK"/blocks/12*.geojson combine-files -merge-layers force \
  -filter 'p !== "" && p !== null' \
  -dissolve p sum-fields=pop copy-fields=cd \
  -simplify interval=8 keep-shapes \
  -o "$DATA/precinct/FL.json" format=topojson quantization=1e5
