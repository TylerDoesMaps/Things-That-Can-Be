# Principles

1. **No pops.** Census blocks underlie the data. Groups exist only as shares in each place.
2. **No subtext.** No taglines, helper sentences or "what this means" boxes in the interface. If a label needs explaining, rename it. Numbers stay. Detail lives in a hover.
3. **Top down.** National election first, with functional states and counties, then smaller politics. The playtest section comes before the playable game.
4. **Tethered to real elections.** 2016, 2020 and 2024 set each place's baseline. Calibrated to match reality for now, easy to manipulate.
5. **Judged by shifts.** Fitting three elections proves nothing on its own. The measure is how much of each county's movement between them comes from national variables and candidates alone.
6. **Shared surprises.** Randomness runs national, region, state, county, and is shared among similar places.
7. **One election function.** A contest is a set of voters, some candidates and an environment. President is the largest case.
8. **Data lives where it was measured.** Every variable records its source, year, native level and how it reaches a neighborhood.
9. **Every mechanic does something.** Every connection is an entry in `design/connections.csv`, with a label for its effect. Charts are generated from that list. Anything with no outgoing line fails the check.

## Data levels

| Data | Measured at | How it reaches a neighborhood |
|---|---|---|
| Population, race, age | Block | Added directly |
| Turnout, party | Block (L2) | Added directly |
| Education, income | Block group | Allocated by adult population |
| Election results | Precinct | Allocated by voters |
| Religion | County | Inherited |

## Geography

All layers use 2020 Census boundaries, so every layer shares one set of IDs with the blocks.

A neighborhood is a precinct split until no piece crosses a county, municipal or legislative line. Each neighborhood is one object with one field per level of government. City tags can cross counties. The county map always shows counties.

Neighborhoods are generated from blocks and the current lines. Redrawing a district regenerates them.

## Repo rules

Build scripts live in `build/`. Raw data stays out of the repo. L2 data never enters this repo because the repo is public.
