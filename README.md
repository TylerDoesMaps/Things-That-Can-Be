# Things That Can Be

Election night view: https://tylerdoesmaps.github.io/Things-That-Can-Be/

- `docs/` the site
- `docs/presets/` national presets
- `docs/content/` every event, the call registry and the shared word list
- `docs/builder.html` the event builder
`docs/game.html` is the shell: the old game's interface (its stylesheet is kept whole as `game-old.css`) running on the new data. It has the map with layers and shading, the infobox, place and person pages, voters, elections and officeholders, and a labelled placeholder for each later update. Nothing in it advances time yet.

`build/game.py` packs a county for the shell (`docs/data/game/`) and generates a seed's characters and seat holders (`docs/data/seeds/<seed>/`). In seed 1 a character is a name and a party only: one per pop, drawn from the pop, plus a holder for every seat on the office list.

Florida is the working state. The map, offices and pops pages read Florida; the same pages for Kansas are kept as `map-ks.html`, `offices-ks.html` and `pops-ks.html`, linked from `kansas.html`. Each page reads its state from `data-state` on the body, and `nav.js` writes the shared header.

- `docs/map.html` the tiers of government in Kansas, one click at a time
- `docs/offices.html` every seat that represents one address, nested by tier
- `docs/pops.html` the pops of Rice County, with what demographics alone predict against the 2024 result
- `docs/government.html` what government does and who holds each function, shown for one county
- `docs/tiles/` map tiles for each level
- `docs/data/` 2024 results by city, township and district, and the method comparison
- `build/` scripts that rebuild everything (`build/run.sh`)
- `resources/` source files that cannot be downloaded again

## Society

`build/organizations.py` gives every pop a pie for each kind of organization (church, union, business, civic) and works out which chapters each county has (`docs/data/orgs/`). The list, the members a chapter needs and what folds into what are in `docs/content/organizations/organizations.yaml`; the mix between churches is fitted to county percentages in `religion-fl.csv` (PRRI, 2020 Census of American Religion).

`build/election.py` runs a seed's starting election and then calls `build/society.py`, which fills each county's and city's departments and boards from `docs/content/government/departments.yaml` and has every chapter elect a leader. Run order for a seed: `game.py`, `organizations.py`, `election.py`.

## Issues

`docs/content/issues/issues.yaml` lists the issues: each one's stops (the positions a character can take, each at a fixed value from -100 to 100, left end positive), its weight at local, state and national level, and the pulls of each kind of pop. `build/issues.py docs/data` gives every pop a number on every issue and writes `docs/data/issues.json` with each place's averages and each party's usual stop. The game works a single pop's numbers out from the same base and pulls. Pulls marked with a survey in `source` were fitted from the Cooperative Election Study (2020, 2022, 2024); the survey files are not kept here. Run it after `organizations.py`.

## Camps

`docs/content/camps/camps.yaml` lists the camps inside each party, each with a fixed position on every issue. `build/camps.py docs/data` sorts each pop's Democrats, independents and Republicans into the nearest camp of their party and writes `docs/data/camps/` (one row per pop) and `docs/data/camps.json` (each place's share of people in each camp). Run it after `issues.py`.

## Area types

`build/areas.py docs/data` decides whether each neighbourhood is urban, suburban, exurban, small town or rural, for the whole state at once. Built-up neighbourhoods that touch form clusters across city and county lines; a cluster of about 50,000 people or more is a city, and its core is urban where it is well denser than that city's typical neighbourhood. Thinly settled land on a city's edge, or inside it, is exurban. The step rewrites the area type in `docs/data/neighbourhoods` and on every pop. Run it after `florida.py fit` and before `game.py`; the type `neighbourhoods.py` writes is only a first guess.

## Map shading

`build/shades.py docs/data` writes `docs/data/shades.json`: every field the map can shade by (race, age, education, income, work, area type, home owning, turnout, party) for every place with an outline, including State House, State Senate and Congress districts, which the tiles carry as shapes only. `build/wide.py` lists which neighbourhoods make up those districts; `issues.py` and `camps.py` use it too. Run `shades.py` after `game.py`.

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

`docs/content/government/offices-ks.yaml` and `offices-fl.yaml` are the master lists of offices for each state: each seat's government, kind, how it is chosen, term, next election and whether the player can hold it, plus the state's rules on running (sore loser, resign to run, holding two offices). Lines not confirmed against a source are marked `checked: false`.

`build/offices.py` counts every office in Kansas county by county from the Census Bureau's 2022 list of governments and writes `docs/data/offices/ks.json`. Each county has its governments, its seats by office and by how they are filled, the districts that cover it, and any real structure entered by hand.

`build/pops.py` builds the pops for one county: groups of 100 adults who share race, age and education and live in one precinct piece. It reads Census blocks and American Community Survey tract tables kept outside the repo. The lean, turnout and wealth numbers come from placeholder national rates at the top of the script and are not yet fitted to any result.

`build/neighbourhoods.py` builds three candidate sets of neighbourhoods for one county (precinct pieces, block group pieces, and built ones that merge small pieces) and `docs/neighbourhoods.html` compares them. The built set is the one pops live in and results are counted by. Commission and council districts are not used as boundaries; they will be drawn from neighbourhoods.

`docs/data/districts/real-lines.csv` lists the counties over 250,000 people and cities over 200,000 that get their real commission or council district lines, with a `lines` column for progress.

`build/districts.py` draws districts from neighbourhoods: contiguous, compact, roughly equal in pops and as competitive as it can manage. It takes any neighbourhood file and a number of districts. `build/workbook.py` writes `docs/data/workbook/fl-counties.csv` and `fl-cities.csv`, which track what each Florida county and city is like and whether it gets its own content.

Sizes are counted in pops of 100. Nobody who cannot vote exists in the game's numbers.

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

## Election toolbox

`docs/toolbox.html` pits made-up candidates against each other on the game's pops, in a party primary or a general election, with no campaign. Nothing it does is saved to the seed. `build/toolbox.py` packs what it needs about every pop into `docs/data/toolbox.json` and `docs/data/toolbox.bin`; run it after `camps.py` whenever pops, issues or camps change.

A pop's Democrats, independents and Republicans each keep a ledger of points for every candidate. The gap between ledgers decides how their votes split: a lead of 5 points takes two votes in three. The lines are the policy areas (each the net of its issues, weighted by the office's level of government; positive inside a set distance, with a boost for the closest candidate and a malus for the furthest), their party and the local lean (general elections only; the local lean is whatever makes two plain candidates give the pop its real vote), same or partner camp, traits (the `likes` in `traits.yaml`), name ID, incumbent, home county (full in the candidate's own county, halving every so many miles from it), home state (from Florida or not), same race, a free number and luck. Every weight can be changed on the page. Votes are the pop's turnout times a level for primaries or generals. Who may vote in a primary is a switch; Florida is closed.
