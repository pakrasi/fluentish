#!/usr/bin/env python3
"""Validate content/igloo/sentences/<lang>.json against content/igloo/sentences/en.json.
Usage: python3 tools/validate_sentences.py content/igloo/sentences/german.json"""
import json, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
EN = json.loads((root / "content/igloo/sentences/en.json").read_text())
ROLES = set(EN["roles"])
path = pathlib.Path(sys.argv[1])
try: L = json.loads(path.read_text())
except Exception as e: print("INVALID JSON:", e); sys.exit(1)
need_tr = L.get("lang") in ("hindi", "bengali", "arabic")
errs = []
keys = {f"{m['id']}.{v['id']}": (m, v) for m in EN["meanings"] for v in m["variants"]}
got = L.get("variants", {})
for k, (m, v) in keys.items():
    s = got.get(k)
    if not s: errs.append(f"missing variant {k}"); continue
    toks = s.get("tokens", [])
    if not toks: errs.append(f"{k}: no tokens"); continue
    en_roles = {r for t in v["tokens"] for r in t[1].split("|")}
    seen = set()
    for i, t in enumerate(toks):
        if not isinstance(t, list) or len(t) < 2 or not isinstance(t[0], str) or not t[0].strip(): errs.append(f"{k}: token {i} malformed"); continue
        for r in t[1].split("|"):
            if r not in ROLES: errs.append(f"{k}: token '{t[0]}' has unknown role '{r}'")
            seen.add(r)
        if need_tr and (len(t) < 3 or not t[2]): errs.append(f"{k}: token '{t[0]}' needs transliteration")
    core = {"door", "door2", "verb", "verb2", "glue"} & en_roles
    for r in core - seen: errs.append(f"{k}: English role '{r}' has no token in this language (if truly absent, tag the nearest word with it and explain in why)")
    why = s.get("why", "")
    if not (20 <= len(why) <= 180): errs.append(f"{k}: why must be 20-180 chars (got {len(why)})")
    sent = " ".join(t[0] for t in toks)
    if len(sent) > 140: errs.append(f"{k}: sentence longer than 140 chars")
extra = set(got) - set(keys)
if extra: errs.append(f"unknown variant keys: {sorted(extra)}")
if errs:
    print(f"{len(errs)} problem(s) in {path.name}:"); [print(" -", e) for e in errs]; sys.exit(1)
print(f"OK {path.name}: {len(got)} variants")
