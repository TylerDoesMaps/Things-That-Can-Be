#!/bin/bash
# Rebuilds every layer, preset and tile set from scratch.
# Needs: python3 with geopandas, tippecanoe, mapshaper. Usage: build/run.sh WORK_DIR
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
WORK=${1:-$REPO/raw}
RAW=$WORK/raw
mkdir -p "$RAW"/{geo,tiger,pl,res} "$WORK"/{pgeo,alloc,tiles}
ln -sfn "$REPO/resources" "$RAW/nyt"
C=https://www2.census.gov
get() { [ -s "$2" ] || curl -s -f --retry 3 -o "$2" "$1" || echo "missing $1"; }

# Display shapes: 2024 cartographic boundaries, plus 2020 counties for Connecticut.
for n in state county place cousub sldu sldl cd119; do get $C/geo/tiger/GENZ2024/shp/cb_2024_us_${n}_500k.zip "$RAW/geo/cb_$n.zip"; done
get $C/geo/tiger/GENZ2020/shp/cb_2020_us_county_500k.zip "$RAW/geo/cb2020_county.zip"
# Alaska house districts, 2024.
get https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2024_US_County_Level_Presidential_Results.csv "$RAW/res/2024.csv"

# 2020 blocks (adults, area, internal point) and full-detail 2024 lines for placing them.
STATES="01:Alabama:AL 04:Arizona:AZ 05:Arkansas:AR 06:California:CA 08:Colorado:CO 09:Connecticut:CT 10:Delaware:DE 11:District_of_Columbia:DC 12:Florida:FL 13:Georgia:GA 15:Hawaii:HI 16:Idaho:ID 17:Illinois:IL 18:Indiana:IN 19:Iowa:IA 20:Kansas:KS 21:Kentucky:KY 22:Louisiana:LA 23:Maine:ME 24:Maryland:MD 25:Massachusetts:MA 26:Michigan:MI 27:Minnesota:MN 28:Mississippi:MS 29:Missouri:MO 30:Montana:MT 31:Nebraska:NE 32:Nevada:NV 33:New_Hampshire:NH 34:New_Jersey:NJ 35:New_Mexico:NM 36:New_York:NY 37:North_Carolina:NC 38:North_Dakota:ND 39:Ohio:OH 40:Oklahoma:OK 41:Oregon:OR 42:Pennsylvania:PA 44:Rhode_Island:RI 45:South_Carolina:SC 46:South_Dakota:SD 47:Tennessee:TN 48:Texas:TX 49:Utah:UT 50:Vermont:VT 51:Virginia:VA 53:Washington:WA 54:West_Virginia:WV 55:Wisconsin:WI 56:Wyoming:WY"
LIST=""
for s in $STATES; do
  IFS=: read -r f name st <<< "$s"
  lower=$(echo "$st" | tr A-Z a-z)
  get "$C/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/$name/${lower}2020.pl.zip" "$RAW/pl/$lower.zip"
  for l in place cousub sldu sldl; do get "$C/geo/tiger/TIGER2024/$(echo $l | tr a-z A-Z)/tl_2024_${f}_$l.zip" "$RAW/tiger/${f}_$l.zip"; done
  get "$C/geo/tiger/TIGER2024/CD/tl_2024_${f}_cd119.zip" "$RAW/tiger/${f}_cd.zip"
  mapshaper "$REPO/resources/precinct/$st.json" -o "$WORK/pgeo/$st.geojson" format=geojson precision=0.00001
  LIST="$LIST $st"
done

python3 -W ignore "$REPO/build/allocate.py" "$RAW" "$WORK" $LIST
python3 -W ignore "$REPO/build/layers.py" "$RAW" "$WORK" "$REPO"
python3 "$REPO/build/compare_methods.py" "$WORK" "$REPO/docs/data/split-methods.json"

for n in county city township; do
  mapshaper "$WORK/geo/$n.geojson" -filter-fields id,name,st -o "$REPO/docs/presets/maps/us-$n.topojson" format=topojson quantization=1e6
done

T="tippecanoe -q --force --no-tile-size-limit --no-feature-limit --simplify-only-low-zooms --detect-shared-borders"
OUT=$REPO/docs/tiles
$T --no-tiny-polygon-reduction-at-maximum-zoom -o "$OUT/state.pmtiles" -l state -Z0 -z7 "$WORK/geo/state.geojson"
for n in county cd; do $T --no-tiny-polygon-reduction-at-maximum-zoom -o "$OUT/$n.pmtiles" -l $n -Z0 -z9 "$WORK/geo/$n.geojson"; done
for n in sldu sldl city township; do $T --no-tiny-polygon-reduction-at-maximum-zoom -o "$OUT/$n.pmtiles" -l $n -Z0 -z10 "$WORK/geo/$n.geojson"; done
# Precincts are cut into two zoom bands so each file stays under GitHub's 100 MB limit.
$T -x id -o "$OUT/precinct-a.pmtiles" -l precinct -Z3 -z8 "$WORK"/geo/precinct/*.geojson
$T -x id --no-tiny-polygon-reduction-at-maximum-zoom -o "$OUT/precinct-b.pmtiles" -l precinct -Z9 -z10 "$WORK"/geo/precinct/*.geojson
