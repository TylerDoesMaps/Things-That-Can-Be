#!/usr/bin/env python3
"""Builds docs/flow.json from design/connections.csv and fails if a node goes nowhere."""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TERMINAL = {"Map"}


def main() -> int:
    with open(ROOT / "design" / "connections.csv", newline="") as f:
        rows = list(csv.DictReader(f))

    outgoing, incoming = defaultdict(int), defaultdict(int)
    for row in rows:
        if not all(row[k].strip() for k in ("group", "source", "target", "effect")):
            print(f"incomplete row: {row}")
            return 1
        outgoing[row["source"]] += 1
        incoming[row["target"]] += 1

    nodes = sorted(set(outgoing) | set(incoming))
    dead = [n for n in nodes if not outgoing[n] and n not in TERMINAL]

    out = ROOT / "docs" / "flow.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"edges": rows, "nodes": nodes, "dead": dead}, indent=0))

    print(f"{len(nodes)} nodes, {len(rows)} connections")
    if dead:
        print("does nothing:", ", ".join(dead))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
