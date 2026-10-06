#!/usr/bin/env python3
"""Build the B1 trainer's runtime data in content/b1/ from the authored parts and Igloo's data.

    python3 tools/build_b1.py            # assemble authoring/b1-src → items.json + annot.json (all files must pass)
    python3 tools/build_b1.py --lenient  # skip src files that have errors (while content agents are still writing)

Writes:
  items.json    authored items (validate_b1 --assemble)
  annot.json    annotations of existing grammar items
  grammar.json  existing Igloo grammar items for the plan's topics, annotations merged, skipped ones removed
  bank.json     Igloo bank phrases for the Sprechen/Forum functions: {id: {en, hl, ex, accept, fn, part, prio, level, n}}
  nouns.json    capitalised nouns for the capitals check ({folded lowercase: Cased}), minus words that also occur lowercase
  frames.json   ★ Sprechen frame models, for the exam-day read-through
  wordmap.json  {lemma: [Igloo word id, level]} for exam words (b1more.js)
Prints the sizes. Gate: the files the app loads (items, grammar, bank, plan, frames, nouns) are ≤ 200 KB gzipped
(Pages serves them gzipped; the raw total is larger because items carry every accepted pattern).
"""
import json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_b1 as V  # noqa: E402

ROOT = V.ROOT
OUT = ROOT / "content/b1"


def dump(name, data):
    p = OUT / name
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    return p.stat().st_size


def main():
    lenient = "--lenient" in sys.argv
    ctx = V.Ctx()
    files = sorted(V.SRC.glob("*.json"))
    if lenient:
        ok, seen = [], {}
        for f in files:
            _, E, _ = V.check_file(f, ctx, dict(seen))
            if E:
                print(f"skip {f.name}: {len(E)} error(s)")
            else:
                ok.append(f)
                V.check_file(f, ctx, seen)
        files = ok
        ctx.prev_ids = set()  # a skipped file must not count as removed ids
    errs = V.run(files, ctx, assemble=True, cover=False)
    if errs:
        print("build stopped: fix the errors above (or use --lenient)")
        sys.exit(1)
    annot = json.loads((OUT / "annot.json").read_text())
    items = json.loads((OUT / "items.json").read_text())
    plan = ctx.plan
    concept_topic = {c: t["id"] for t in plan["topics"] for c in t["concepts"]}
    rank = {t["id"]: t["rank"] for t in plan["topics"]}

    # grammar.json
    grammar, skipped = [], 0
    for g in json.loads((ROOT / "content/igloo/grammar/items_de.json").read_text()):
        if g["concept"] not in concept_topic:
            continue
        if g.get("layer") == "b2":   # the B2 layer (round 4) never enters the B1 trainer (PLAN-REVIEW B7)
            continue
        a = annot.get("G:" + g["id"], {})
        if a.get("skip"):
            skipped += 1
            continue
        if g["concept"] == "praeteritum" and not re.search(r"infinitiv|präsens|present", g["task"], re.I):
            skipped += 1
            continue
        out = {k: g[k] for k in ("id", "concept", "level", "kind", "task", "prompt", "answer", "note", "strict_case")}
        out["topic"] = a.get("topic") or concept_topic[g["concept"]]
        for k in ("trap", "focus", "strict", "wrong", "rule"):
            if a.get(k):
                out[k] = a[k]
        grammar.append(out)

    # bank.json: phrases of the Sprechen and Forum functions
    prio = json.loads((ROOT / "content/igloo/chunks/priority_de.json").read_text())
    en = {c["id"]: c for c in json.loads((ROOT / "content/igloo/chunks/en.json").read_text())}
    de = json.loads((ROOT / "content/igloo/chunks/german.json").read_text())["chunks"]
    acc = json.loads((ROOT / "content/igloo/chunks/accept_german.json").read_text())
    bank = {}
    for f in prio["functions"]:
        if not (f["part"].startswith("Sprechen") or f["part"] == "Forum"):
            continue
        for cid in f["chunk_ids"]:
            c, d, a = en.get(cid), de.get(cid), acc.get(cid)
            if not (c and d and a and a.get("accept")) or a.get("weak") or cid in bank:
                continue
            if a["core_en"].lower() not in c["natural_example"].lower():
                continue
            bank[cid] = {"en": c["natural_example"], "hl": a["core_en"], "ex": d.get("ex"), "n": d.get("n"), "accept": a["accept"],
                         "fn": f["id"], "part": f["part"], "prio": prio["prio"].get(cid, 3), "level": c.get("cefr_level") or "B1"}

    # nouns.json
    nouns = {}
    for w in sorted(ctx.nouns):
        if w.lower() in ctx.lower_ok or len(w) < 3:
            continue
        nouns[V.norm(w)] = w
    # frames.json
    frames = [{"teil": i["teil"], "fn": i["fn"], "de": i["model"], "id": i["id"]} for i in items
              if i.get("kind") == "phrase" and i.get("group") in ("S1", "S2", "S3") and i.get("star")]

    # wordmap.json: lemma → [Igloo word id, level], for exam words (W:<id> when Igloo has the word; the B1-list filter)
    wordmap = {}
    for w in json.loads((ROOT / "content/igloo/words/de.json").read_text()):
        if w.get("w") and w["w"] not in wordmap:
            wordmap[w["w"]] = [w["id"], w.get("level") or ""]

    sizes = {n: dump(n, d) for n, d in [("grammar.json", grammar), ("bank.json", bank), ("nouns.json", nouns), ("frames.json", frames), ("wordmap.json", wordmap)]}
    for n in ("items.json", "annot.json", "plan.json"):
        sizes[n] = (OUT / n).stat().st_size
    import gzip
    loaded = [k for k in sizes if k not in ("annot.json", "wordmap.json")]   # wordmap: only fetched with a b1-exam token
    gz = sum(len(gzip.compress((OUT / k).read_bytes())) for k in loaded)
    print(f"grammar.json {len(grammar)} items ({skipped} skipped) · bank.json {len(bank)} phrases · nouns.json {len(nouns)} · frames.json {len(frames)}")
    print("sizes: " + ", ".join(f"{k} {v // 1024} KB" for k, v in sizes.items()) + f" · loaded by the app: {gz // 1024} KB gzipped (gate 200 KB)")
    if gz > 200 * 1024:
        print("ERROR: the B1 data the app loads is over 200 KB gzipped")
        sys.exit(1)


if __name__ == "__main__":
    main()
