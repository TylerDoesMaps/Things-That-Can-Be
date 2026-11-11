# Things That Can Be

Election night view: https://tylerdoesmaps.github.io/Things-That-Can-Be/

- `docs/` the site
- `docs/presets/` national presets
- `docs/content/` every event, the call registry and the shared word list
- `docs/builder.html` the event builder
- `docs/map.html` the tiers of government in Kansas, one click at a time
- `docs/offices.html` every seat that represents one address, nested by tier
- `docs/pops.html` the pops of Rice County, with what demographics alone predict against the 2024 result
- `docs/government.html` what government does and who holds each function, shown for one county
- `docs/tiles/` map tiles for each level
- `docs/data/` 2024 results by city, township and district, and the method comparison
- `build/` scripts that rebuild everything (`build/run.sh`)
- `resources/` source files that cannot be downloaded again

## Events

Each event is one file in `docs/content/events/`, named by its ID. The game and the builder read the same files.

- **IDs** are lowercase words joined by dots, broad to specific: `creation.school.caught`. An ID never changes and is never reused. An answer is `event#answer`.
- **Calls** go in curly braces. `{player.first_name}` fills in a value. `{pick: watch_party}` takes a phrase from `picks.yaml`. `{when place.setting is rural}` … `{otherwise}` … `{end}` swaps whole lines.
- **Square brackets** mark text still to be written. The builder counts them.
- `docs/content/registry.yaml` lists every call that exists. `build/check_content.py` refuses unknown calls and locks that point at nothing, and rebuilds `docs/content/index.json`.

Saving from the builder needs a GitHub token with write access to this repository's contents, pasted into the builder. It is kept in that browser only.

## Government

`docs/content/government/functions.yaml` is the fixed list of functions: the Census Bureau's 28 state and local lines, 3 federal ones and 7 split out for politics. Each level that holds a function has a generic department and title, how its head is chosen, whether it sits in a cabinet, and the real Kansas equivalent with a mark for whether that was checked against a source.

`build/government.py` pulls every government in one county, with staff by function, from the 2022 Census of Governments individual unit files.

`build/tiers.py` builds the tier map for one state from Census boundaries. Tier 3 is the county. Tier 4 is every county subdivision: townships, and cities that stand outside any township. Tier 5 is every city that sits inside a township. Run it with another state's code to get that state's layers.

`docs/content/government/offices.yaml` is the master list of offices for Kansas: each seat's government, kind, how it is chosen, term, next election and whether the player can hold it, plus the state's rules on running (sore loser, resign to run, holding two offices). Lines not confirmed against a source are marked `checked: false`.

`build/offices.py` counts every office in Kansas county by county from the Census Bureau's 2022 list of governments and writes `docs/data/offices/ks.json`. Each county has its governments, its seats by office and by how they are filled, the districts that cover it, and any real structure entered by hand.

`build/pops.py` builds the pops for one county: groups of 100 adults who share race, age and education and live in one precinct piece. It reads Census blocks and American Community Survey tract tables kept outside the repo. The lean, turnout and wealth numbers come from placeholder national rates at the top of the script and are not yet fitted to any result.

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
