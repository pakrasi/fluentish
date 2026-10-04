#!/usr/bin/env python3
"""Check content/exams/goethe-b1/why/dayNN.json: all 60 Lesen/Hören item ids present, required fields, evidence verbatim in the exam."""
import json, re, sys
from pathlib import Path
BASE = Path(__file__).resolve().parent.parent
FIELDS = ("evidence", "evidence_en", "why", "why_en", "trap", "trap_en")

def norm(t):
    return re.sub(r"\s+", " ", re.sub(r"[„“”\"'‚‘’«»]", "", t or "")).strip().lower()

def strings(o):
    if isinstance(o, str): yield o
    elif isinstance(o, dict):
        for v in o.values(): yield from strings(v)
    elif isinstance(o, list):
        for v in o: yield from strings(v)

def check(path):
    n = int(re.search(r"day(\d+)", path).group(1))
    ex = json.load(open(BASE / "content" / "exams" / "goethe-b1" / f"day{n:02d}.json", encoding="utf-8"))
    ids = set(re.findall(r'"id":\s*"([LH]\d-\d+[ab]?)"', json.dumps(ex["lesen"]) + json.dumps(ex["hoeren"])))
    ids = {i for i in ids if not re.fullmatch(r"H1-\d", i)}          # Hören Teil 1 text ids (H1-1…H1-5) are containers, their items are H1-1a/b
    corpus = norm(" ".join(strings(ex["lesen"])) + " " + " ".join(strings(ex["hoeren"])))
    d = json.load(open(path, encoding="utf-8"))
    errs = []
    for i in sorted(ids - set(d)): errs.append(f"missing {i}")
    for i in sorted(set(d) - ids): errs.append(f"unknown id {i}")
    items = {}
    for part in (ex["lesen"], ex["hoeren"]):
        for m in re.finditer(r'\{[^{}]*"id":\s*"([LH]\d-\d+[ab]?)"[^{}]*\}', json.dumps(part, ensure_ascii=False)):
            try: items[m.group(1)] = json.loads(m.group(0))
            except Exception: pass
    for i, v in d.items():
        if "--en" in sys.argv:
            if not (v.get("question_en") or "").strip(): errs.append(f"{i}: empty question_en")
            opts = items.get(i, {}).get("options")
            if opts and len(v.get("options_en") or []) != len(opts): errs.append(f"{i}: options_en must have {len(opts)} entries")
        for f in FIELDS:
            if not (v.get(f) or "").strip(): errs.append(f"{i}: empty {f}")
        ev = norm(v.get("evidence", "")).replace("…", " ").replace("...", " ")
        parts = [p.strip() for p in re.split(r"\s{2,}| … ", ev) if len(p.strip()) > 8] or [ev]
        if not all(p in corpus for p in parts): errs.append(f"{i}: evidence not verbatim: {v.get('evidence','')[:70]}")
    return errs

bad = 0
for p in [a for a in sys.argv[1:] if not a.startswith('--')]:
    e = check(p); print(f"{p}: {'OK' if not e else str(len(e)) + ' problems'}"); [print("   -", x) for x in e[:40]]; bad += bool(e)
sys.exit(1 if bad else 0)
