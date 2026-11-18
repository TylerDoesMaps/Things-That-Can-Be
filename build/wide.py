"""The districts that cross county lines: which neighbourhoods make up each State House, State Senate and Congress district."""
import json
from pathlib import Path

KINDS = (("house", "State House"), ("senate", "State Senate"), ("congress", "Congress"))


def hoods(data):
    """Every neighbourhood's record, from the county files in data/game."""
    out = {}
    for f in sorted(Path(data, "game").glob("fl-12*.json")):
        for q in json.loads(f.read_text())["places"].values():
            if q["kind"] == "hood":
                out[q["id"]] = q
    return out


def districts(data):
    """{'house-10': [neighbourhood ids]} for the three kinds."""
    out = {}
    for h in hoods(data).values():
        for kind, _ in KINDS:
            if h.get(kind):
                out.setdefault(f"{kind}-{h[kind]}", []).append(h["id"])
    return out
