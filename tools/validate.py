#!/usr/bin/env python3
"""Validate a language file against content/igloo/framework.json.
Usage: python3 tools/validate.py content/igloo/lang/german.json
Exit code 0 = valid. Prints every problem it finds."""
import json, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
fw = json.loads((root / "content/igloo/framework.json").read_text())
path = pathlib.Path(sys.argv[1])
try:
    L = json.loads(path.read_text())
except Exception as e:
    print(f"INVALID JSON: {e}"); sys.exit(1)

errs = []
def err(m): errs.append(m)

lang_meta = next((l for l in fw["languages"] if l["id"] == L.get("lang")), None)
if not lang_meta:
    err(f"lang '{L.get('lang')}' is not one of {[l['id'] for l in fw['languages']]}")
need_translit = bool(lang_meta and lang_meta["translit"])

for k in ["lang", "name", "native", "notes", "turnGrid", "items", "scenarios"]:
    if k not in L: err(f"missing top-level key: {k}")

notes = L.get("notes", {})
for k in ["variety", "turns", "wordOrder", "slotGrammar", "sound", "register"]:
    if not isinstance(notes.get(k), str) or len(notes.get(k, "")) < 40:
        err(f"notes.{k} missing or too short (min 40 chars)")

# turnGrid: 3 rows (past, present, future) x 3 cols (simple, progressive, perfect) for the GO door
tg = L.get("turnGrid", [])
cells = {(c.get("time"), c.get("aspect")) for c in tg if isinstance(c, dict)}
for t in ["past", "present", "future"]:
    for a in ["simple", "progressive", "perfect"]:
        if (t, a) not in cells: err(f"turnGrid missing cell {t}/{a}")
for c in tg:
    if not isinstance(c, dict): continue
    for k in ["time", "aspect", "form", "gloss", "note"]:
        if k not in c: err(f"turnGrid cell {c.get('time')}/{c.get('aspect')} missing '{k}'")
    if need_translit and c.get("form") and not c.get("translit"):
        err(f"turnGrid cell {c.get('time')}/{c.get('aspect')} needs translit")

master = {i["id"]: i for i in fw["items"]}
seen = {}
for it in L.get("items", []):
    iid = it.get("id")
    if iid not in master: err(f"item id not in framework: {iid}"); continue
    if iid in seen: err(f"duplicate item: {iid}")
    seen[iid] = it
    for k in ["target", "gloss"]:
        if not isinstance(it.get(k), str) or not it.get(k).strip(): err(f"{iid}: missing '{k}'")
    if need_translit and it.get("target") and not it.get("translit"): err(f"{iid}: needs translit")
    ex = it.get("example")
    if master[iid]["layer"] in ("door", "glue", "chunk", "slot", "turn", "function"):
        if not isinstance(ex, dict) or not ex.get("target") or not ex.get("gloss"):
            err(f"{iid}: example.target and example.gloss required for layer {master[iid]['layer']}")
        elif need_translit and not ex.get("translit"): err(f"{iid}: example needs translit")
    if "note" in it and not isinstance(it["note"], str): err(f"{iid}: note must be string")
missing = [i for i in master if i not in seen]
if missing: err(f"{len(missing)} framework items missing: {missing[:12]}{' ...' if len(missing) > 12 else ''}")
stars = sum(1 for it in seen.values() if it.get("star"))
if not (30 <= stars <= 70): err(f"star count {stars}, want 30-70")

ms = {s["id"]: s for s in fw["scenarios"]}
sseen = set()
for s in L.get("scenarios", []):
    sid = s.get("id")
    if sid not in ms: err(f"scenario id not in framework: {sid}"); continue
    sseen.add(sid)
    m = s.get("model", {})
    if not m.get("target") or not m.get("gloss"): err(f"{sid}: model.target and model.gloss required")
    if need_translit and m.get("target") and not m.get("translit"): err(f"{sid}: model needs translit")
    bd = s.get("breakdown", [])
    if not bd or len(bd) < 3: err(f"{sid}: breakdown needs at least 3 blocks")
    for b in bd:
        if b.get("layer") not in ("function", "door", "turn", "glue", "slot", "lexicon", "sound", "chunk", "filler"):
            err(f"{sid}: breakdown block has bad layer {b.get('layer')}")
        if b.get("id") and b["id"] not in master: err(f"{sid}: breakdown block id {b['id']} not in framework")
        if not b.get("text"): err(f"{sid}: breakdown block missing text")
    joined = "".join(b.get("text", "") for b in bd).replace(" ", "")
    if m.get("target") and joined and joined != m["target"].replace(" ", ""):
        err(f"{sid}: breakdown texts joined must equal model.target exactly (ignoring spaces)")
    keys = s.get("keys", [])
    if not keys or len(keys) < 2: err(f"{sid}: keys needs at least 2 entries")
    for k in keys:
        if m.get("target") and k not in m["target"]: err(f"{sid}: key '{k}' not found in model.target")
    if not s.get("tip"): err(f"{sid}: tip required")
    if not s.get("alt"): err(f"{sid}: alt (a second acceptable answer) required")
smissing = [i for i in ms if i not in sseen]
if smissing: err(f"scenarios missing: {smissing}")

if errs:
    print(f"{len(errs)} problem(s) in {path.name}:")
    for e in errs: print(" -", e)
    sys.exit(1)
print(f"OK {path.name}: {len(seen)} items, {len(sseen)} scenarios, {stars} starred")
