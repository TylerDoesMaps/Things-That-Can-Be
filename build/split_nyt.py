#!/usr/bin/env python3
"""Splits the national NYT precinct TopoJSON into one TopoJSON per state.

The file is too long for ordinary JSON parsers, so arcs are streamed as raw text.
Usage: split_nyt.py SOURCE OUT_DIR
"""
import json
import mmap
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

with open(SRC, "rb") as f:
    mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    start = mm.find(b'"arcs":[') + len(b'"arcs":[')
    tail = mm.rfind(b'],"transform":')
    meta = json.loads(b"{" + mm[tail + 2:])
    print("arcs text", tail - start, "geometries", len(meta["objects"]["tiles"]["geometries"]), flush=True)

    geometries = meta["objects"]["tiles"]["geometries"]
    used = defaultdict(list)

    def walk(node, out):
        if isinstance(node, int):
            out.append(node if node >= 0 else ~node)
        else:
            for child in node:
                walk(child, out)

    by_state = defaultdict(list)
    for geometry in geometries:
        if "arcs" not in geometry:
            continue
        state = geometry["properties"]["state"]
        by_state[state].append(geometry)
        walk(geometry["arcs"], used[state])

    ids = {s: np.unique(np.array(v, dtype=np.int64)) for s, v in used.items()}
    used.clear()
    needed = defaultdict(list)
    for state, arr in ids.items():
        for i in arr.tolist():
            needed[i].append(state)

    handles = {s: open(OUT / f"{s}.json", "wb") for s in ids}
    written = dict.fromkeys(ids, 0)
    for state, handle in handles.items():
        handle.write(b'{"type":"Topology","arcs":[')

    index = 0
    position = start
    separator = b"]],[["
    while position < tail:
        end = mm.find(separator, position, tail)
        stop = tail if end < 0 else end + 2
        arc = mm[position:stop]
        for state in needed.get(index, ()):
            handle = handles[state]
            if written[state]:
                handle.write(b",")
            handle.write(arc)
            written[state] += 1
        index += 1
        position = stop + 1 if end >= 0 else tail
    print("arcs streamed", index, flush=True)


def remap(node, table):
    if isinstance(node, int):
        return int(np.searchsorted(table, node)) if node >= 0 else ~int(np.searchsorted(table, ~node))
    return [remap(child, table) for child in node]


for state, handle in handles.items():
    table = ids[state]
    if written[state] != len(table):
        raise SystemExit(f"{state}: wrote {written[state]} arcs, expected {len(table)}")
    out = []
    for geometry in by_state[state]:
        out.append({
            "type": geometry["type"],
            "arcs": remap(geometry["arcs"], table),
            "properties": {
                "p": geometry["properties"]["GEOID"],
                "ST": state,
                "off": 1 if geometry["properties"].get("official_boundary") else 0,
            },
        })
    handle.write(b'],"transform":')
    handle.write(json.dumps(meta["transform"]).encode())
    handle.write(b',"objects":{"precincts":{"type":"GeometryCollection","geometries":')
    handle.write(json.dumps(out, separators=(",", ":")).encode())
    handle.write(b"}}}")
    handle.close()
    print(state, len(out), len(table), flush=True)
