#!/usr/bin/env python3
"""Validate content/igloo/grammar/items_<lang>.json against content/igloo/grammar/concepts_<lang>.json.
Usage: python3 tools/validate_grammar.py [lang]   (default: de; the pack id or the settings id)
The item kinds a language has come from its plugin (tools/langrules.py)."""
import json, re, sys, pathlib
from collections import Counter
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "tools"))
from langrules import lang as lang_rules  # noqa: E402
L = lang_rules(sys.argv[1] if len(sys.argv) > 1 else "de")
lang = L.code
KINDS = L.grammar_kinds
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
errs = []
try:
    concepts = json.loads((root / "content/igloo/grammar" / f"concepts_{lang}.json").read_text())
    items = json.loads((root / "content/igloo/grammar" / f"items_{lang}.json").read_text())
except Exception as e:
    print("INVALID JSON:", e); sys.exit(1)
C = {}
for c in concepts:
    if c["id"] in C: errs.append(f"duplicate concept id {c['id']}")
    C[c["id"]] = c
    if c.get("level") not in LEVELS: errs.append(f"concept {c['id']}: bad level {c.get('level')!r}")
seen, per = set(), Counter()
for n, it in enumerate(items):
    iid = it.get("id", f"#{n}")
    if iid in seen: errs.append(f"duplicate item id {iid}")
    seen.add(iid)
    c = C.get(it.get("concept"))
    if not c: errs.append(f"{iid}: unknown concept {it.get('concept')!r}"); continue
    if not re.fullmatch(re.escape(c["id"]) + r"\.\d{2}", iid): errs.append(f"{iid}: id must be {c['id']}.NN")
    if it.get("level") != c["level"]: errs.append(f"{iid}: level {it.get('level')} != concept level {c['level']}")
    if it.get("kind") not in KINDS: errs.append(f"{iid}: bad kind {it.get('kind')!r}")
    for f in ("task", "prompt", "note"):
        if not isinstance(it.get(f), str) or not it[f].strip(): errs.append(f"{iid}: empty {f}")
    a = it.get("answer")
    if not isinstance(a, list) or not a or not all(isinstance(x, str) and x.strip() for x in a):
        errs.append(f"{iid}: answer must be a non-empty list of non-empty strings")
    elif len(set(a)) != len(a): errs.append(f"{iid}: duplicate answers")
    if not isinstance(it.get("strict_case"), bool): errs.append(f"{iid}: strict_case must be true/false")
    per[c["id"]] += 1
for cid, c in C.items():
    k, lv = per[cid], c["level"]
    if lv in ("B2", "C1"):
        if k != 8: errs.append(f"{cid} ({lv}): needs exactly 8 items, has {k}")
    else:
        need = 14 if c.get("sticky") else 8
        if k < need: errs.append(f"{cid} ({lv}{', sticky' if c.get('sticky') else ''}): needs {need}+ items, has {k}")
if errs:
    print(f"{len(errs)} problem(s):"); [print(" -", e) for e in errs]; sys.exit(1)
by = Counter(C[i["concept"]]["level"] for i in items)
cl = Counter(c["level"] for c in concepts)
print(f"OK {len(items)} items, {len(concepts)} concepts")
for lv in LEVELS: print(f"  {lv}: {cl[lv]} concepts, {by[lv]} items")
