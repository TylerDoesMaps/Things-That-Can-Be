# Things That Can Be

Election night view: https://tylerdoesmaps.github.io/Things-That-Can-Be/

- `docs/` the site
- `docs/presets/` national presets
- `docs/tiles/` map tiles for each level
- `docs/data/` 2024 results by city, township and district, and the method comparison
- `build/` scripts that rebuild everything (`build/run.sh`)
- `resources/` source files that cannot be downloaded again

## National presets

Listed in `docs/presets/presets.json`.

| Preset | File |
|---|---|
| US counties | `maps/us-county.topojson` |
| US cities | `maps/us-city.topojson` |
| US townships | `maps/us-township.topojson` |
| President 2016 by county | `results/us-president-2016-county.csv` |
| President 2020 by county | `results/us-president-2020-county.csv` |
| President 2024 by county | `results/us-president-2024-county.csv` |

Counties use 2024 lines, with two exceptions. Connecticut keeps its eight counties, because results before 2024 do not exist for the planning regions. Alaska is one unit, because it reports by election district and not by borough.

Cities are incorporated places. Townships are the active towns and townships in the 20 states where they are governments: CT, IL, IN, KS, ME, MA, MI, MN, MO, NE, NH, NJ, NY, ND, OH, PA, RI, SD, VT, WI.

## Levels

| Level | Lines | Results |
|---|---|---|
| State, County | Census 2024 | 2016, 2020, 2024 as reported |
| Precinct | 2024 precincts | 2024 as reported |
| City, Township | Census 2024 | 2024, built from precincts |
| State House, State Senate | Census 2024 | 2024, built from precincts |
| Congress | 119th Congress, the lines used in 2024 | 2024, built from precincts |

## Splitting precincts

A precinct that crosses a city or district line has its votes divided among 2020 census blocks in proportion to the adults living in each block. Each block sits in exactly one city, township and district, so block totals add up to any of them. `build/allocate.py` also computes two alternatives, by area and by assigning each precinct whole, and `docs/data/split-methods.json` records how far they disagree.

Units where the precinct file covers less than 98% of adults show the share covered.

## Sources

- County results 2016 to 2024: MIT Election Data and Science Lab, County Presidential Election Returns 2000-2024. Kansas City is added back into Jackson County, Missouri.
- Precinct lines and results 2024: The New York Times, 2024 precinct-level presidential results. Florida's layer was built from blocks. No precinct file exists for Alaska; its house districts come from the state's district returns, and Oklahoma, South Dakota and Vermont are incomplete.
- Lines: US Census Bureau, 2024 cartographic boundary files and TIGER/Line.
- Blocks: US Census Bureau, 2020 redistricting file (PL 94-171).
- Maine and Nebraska district margins for 2016 and 2020 are entered by hand in `docs/data/districts.json`.
