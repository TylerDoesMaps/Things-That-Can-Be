#!/usr/bin/env python3
"""Checks every event file and writes docs/content/index.json.

Fails on a bad or duplicate ID, a lock that points at nothing, a call that is not in the
registry, an unknown pick, or an unclosed {when} block.
Usage: check_content.py [REPO_DIR]
"""
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]) / "docs/content"
ID = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)+$")
ANSWER = re.compile(r"^[a-z0-9_]+$")
CALL = re.compile(r"\{([^{}]*)\}")
BRACKET = re.compile(r"\[[^\[\]]*\]")


def flatten(items):
    for item in items:
        if isinstance(item, list):
            yield from flatten(item)
        else:
            yield item


registry = yaml.safe_load((ROOT / "registry.yaml").read_text())
scopes = {name: set(flatten(props)) for name, props in registry["scopes"].items()}
values = registry["values"]
picks = yaml.safe_load((ROOT / "picks.yaml").read_text())
errors = []


def known(call):
    for scope in sorted(scopes, key=len, reverse=True):
        if call.startswith(scope + "."):
            return call[len(scope) + 1:] in scopes[scope]
    return False


def check_text(where, text):
    depth = 0
    for inner in CALL.findall(text or ""):
        inner = inner.strip()
        if inner.startswith("pick:"):
            if inner[5:].strip() not in picks:
                errors.append(f"{where}: unknown pick {{{inner}}}")
        elif inner.startswith("when "):
            depth += 1 if depth == 0 else 0
            match = re.match(r"when (\S+) is (not )?(.+)$", inner)
            if not match or not known(match.group(1)):
                errors.append(f"{where}: bad condition {{{inner}}}")
            elif match.group(1) in values and match.group(3) not in values[match.group(1)]:
                errors.append(f"{where}: {match.group(3)!r} is not a value of {match.group(1)}")
        elif inner == "otherwise":
            if depth == 0:
                errors.append(f"{where}: {{otherwise}} outside a {{when}} block")
        elif inner == "end":
            if depth == 0:
                errors.append(f"{where}: {{end}} without {{when}}")
            depth = 0
        elif not known(inner.split("|")[0].strip()):
            errors.append(f"{where}: unknown call {{{inner}}}")
    if depth:
        errors.append(f"{where}: {{when}} block is never closed with {{end}}")


for name, pick in picks.items():
    if "otherwise" not in pick:
        errors.append(f"pick {name}: no otherwise line")
    if not known(pick.get("by", "")):
        errors.append(f"pick {name}: 'by' is not a known call")
    for key, text in pick.items():
        if key != "by":
            check_text(f"pick {name}.{key}", text)

events, targets = {}, set()
for path in sorted((ROOT / "events").rglob("*.yaml")):
    event = yaml.safe_load(path.read_text())
    eid = event.get("id", "")
    if not ID.match(eid):
        errors.append(f"{path.name}: bad id {eid!r}")
    if path.stem != eid:
        errors.append(f"{path.name}: file name does not match id {eid!r}")
    if eid in events:
        errors.append(f"{eid}: duplicate id")
    events[eid] = (path, event)
    targets.add(eid)
    seen = set()
    for answer in event.get("answers") or []:
        aid = answer.get("id", "")
        if not ANSWER.match(aid) or aid in seen:
            errors.append(f"{eid}: bad or repeated answer id {aid!r}")
        seen.add(aid)
        targets.add(f"{eid}#{aid}")

index = []
for eid, (path, event) in events.items():
    for field, allowed in [("type", "types"), ("level", "levels"), ("status", "statuses")]:
        if event.get(field) not in values[allowed]:
            errors.append(f"{eid}: {field} {event.get(field)!r} is not one of {values[allowed]}")
    answers = event.get("answers") or []
    for need in (event.get("needs") or []) + [n for a in answers for n in (a.get("needs") or [])]:
        if need not in targets:
            errors.append(f"{eid}: locked behind {need!r}, which does not exist")
    texts = [event.get("text", "")] + [a.get("text", "") for a in answers]
    for text in texts:
        check_text(eid, text)
    index.append({
        "id": eid, "file": str(path.relative_to(ROOT)), "was": event.get("was", ""), "title": event.get("title", ""),
        "group": event.get("group", ""), "order": event.get("order", 0), "type": event.get("type"),
        "level": event.get("level"), "status": event.get("status"), "answers": [a.get("id") for a in answers],
        "needs": event.get("needs") or [],
        "gates": [{"answer": a.get("id"), "need": n} for a in answers for n in (a.get("needs") or [])],
        "brackets": sum(len(BRACKET.findall(t or "")) for t in texts),
    })

index.sort(key=lambda row: (row["order"], row["id"]))
(ROOT / "index.json").write_text(json.dumps(index, indent=0, ensure_ascii=False) + "\n")
for line in errors:
    print("ERROR", line)
print(f"{len(index)} events, {sum(r['brackets'] for r in index)} brackets left, {len(errors)} errors")
sys.exit(1 if errors else 0)
