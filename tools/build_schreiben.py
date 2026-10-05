#!/usr/bin/env python3
"""Check and build the Goethe B1 Schreiben practice content: authoring/schreiben-src → content/b1/schreiben.json.

    python3 tools/build_schreiben.py           # check every source file, then write content/b1/schreiben.json
    python3 tools/build_schreiben.py --check   # check only; exit 1 on any error (nothing written)

Sources (authoring/schreiben-src/):
  functions.json   the three Aufgaben, the functions inside each, and the B1 trainer's letter items filed under them
  a1.json a2.json a3.json   items: one English sentence → the German chunk, with accept patterns, wrong answers (the
                   mistake learners make), the trap and one rule line. Ids are BS:a<n>-<slug> (domain/itemids.js).
  tasks.json       "Build an email": mock tasks taken apart into parts (greeting, one line per point, closing).

Every item and every task part goes through validate_b1.check_item (the same rules as the B1 trainer: patterns,
model case, trap detectors, the app's matcher on the model and every wrong answer). On top of that:
  - ids, functions, tiers, the Aufgabe in the id; no id or model the B1 trainer already has
  - register: an Aufgabe 1 item has no Sie forms, an Aufgabe 3 item no du forms
  - punctuation rules (punct): the model keeps each rule (practice/punct.js grades the same rules)
  - task parts: keys, points, glue words in the model, the model email's length per Aufgabe

Rank (the order new items come in): tier 1 first, Aufgabe 3, 1, 2 in turn within a tier (A3's formulas are the
cheapest points), the trainer's letter items at the front of their Aufgabe in tier 1.
"""
import json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_b1 as V  # noqa: E402

ROOT = V.ROOT
SRC = ROOT / "authoring/schreiben-src"
OUT = ROOT / "content/b1/schreiben.json"
AUFGABEN = ["A1", "A2", "A3"]
TEIL = {"A1": "W1", "A2": "W2", "A3": "W3"}
CHECK_FN = {"A1": "inf_open", "A2": "forum_opinion", "A3": "f_request"}   # a validate_b1 function id of that Teil
ORDER = ["A3", "A1", "A2"]
PUNCT = re.compile(r"^(comma-end|no-comma-end|lower-start|comma-before:[a-zäöüß]+)$")
SIE_FORMS = {"Sie", "Ihnen", "Ihr", "Ihre", "Ihren", "Ihrem", "Ihrer", "Ihres"}
DU_FORMS = {"du", "dich", "dir", "dein", "deine", "deinen", "deinem", "deiner", "deines"}
ITEM_KEYS = {"id", "fn", "tier", "prompt", "hl", "model", "accept", "wrong", "trap", "focus", "strict", "rule", "punct", "task"}
PART_KEYS = {"key", "kind", "point", "lower", "frame", "glue", "cue", "model", "accept", "wrong", "trap", "focus", "strict", "punct", "rule"}
TASK_KEYS = {"id", "aufgabe", "exam", "to", "title", "situation", "quote", "points", "parts"}
WORDS = {"A1": (60, 110), "A2": (55, 110), "A3": (30, 75)}


def load(name):
    return json.loads((SRC / name).read_text())


def hl_of(prompt):
    return re.sub(r"\s*\([^()]*\)\s*$", "", prompt).rstrip(" .?!")


def sentences(text):
    return [s for s in re.split(r"(?<=[.!?:])\s+", text.strip()) if s]


def register_errors(text, aufgabe, at):
    """Sie forms (not sentence-initial Sie as 'she/they') in A1, du forms in A3."""
    errs = []
    for sent in sentences(text):
        toks = re.findall(r"[\wäöüßÄÖÜ]+", sent)
        for i, t in enumerate(toks):
            if aufgabe == "A1" and t in SIE_FORMS and i > 0:
                errs.append(f"{at}: {t!r} in an Aufgabe 1 (du) text")
            if aufgabe == "A3" and t.lower() in DU_FORMS:
                errs.append(f"{at}: {t!r} in an Aufgabe 3 (Sie) text")
    return errs


def polite_errors(model, strict, at):
    """A polite Sie, Ihnen, Ihr … in the middle of a sentence is strict: in lower case it means she, they or you all."""
    errs = []
    for sent in sentences(model):
        for i, t in enumerate(re.findall(r"[\wäöüßÄÖÜ]+", sent)):
            if i > 0 and t in SIE_FORMS and t not in strict:
                errs.append(f"{at}: add {t!r} to strict (a polite form in lower case is another word)")
    return errs


def polite_pattern_errors(accept, strict, model, at):
    """The same for the accept patterns of a Sie text (they are lower case): a polite form after a pattern's first word
    must be in strict, or "Ich danke ihnen im Voraus." (ihnen = them) is graded right. A lower-case form the model
    itself uses (ihr = her) is meant as written."""
    errs, lower_ok = [], set()
    for sent in sentences(model):
        lower_ok |= {t for t in re.findall(r"[\wäöüßÄÖÜ]+", sent)[1:] if t.lower() == t}
    polite = {f.lower(): f for f in SIE_FORMS}
    for p in accept or []:
        for t in re.findall(r"[\wäöüßÄÖÜ]+", p)[1:]:
            f = polite.get(t)
            if f and f not in strict and t not in lower_ok:
                errs.append(f"{at}: accept {p!r} has {t!r}; add {f!r} to strict (a polite form in lower case is another word)")
    return sorted(set(errs))


def punct_errors(model, punct, at):
    errs = []
    for p in punct or []:
        if not isinstance(p, str) or not PUNCT.match(p):
            errs.append(f"{at}: punct {p!r} is not comma-end, no-comma-end, lower-start or comma-before:<word>")
            continue
        m = model.strip()
        if p == "comma-end" and not m.endswith(","):
            errs.append(f"{at}: punct comma-end but the model does not end with a comma")
        if p == "no-comma-end" and m.endswith(","):
            errs.append(f"{at}: punct no-comma-end but the model ends with a comma")
        if p.startswith("comma-before:"):
            w = p.split(":", 1)[1]
            if not re.search(rf",\s+{w}\b", m, re.I):
                errs.append(f"{at}: punct {p} but the model has no ', {w}'")
    return errs


def as_b1(it, aufgabe, kind="phrase"):
    """An item in validate_b1's shape (a BP:/BT: id and a Teil function), so check_item runs every B1 rule on it."""
    topic = kind == "topic"
    return {
        "id": ("BT:" if topic else "BP:") + re.sub(r"[^a-z0-9-]", "-", it["id"].split(":", 1)[1]),
        "kind": kind, "area": "speaking", "group": "write", "teil": TEIL[aufgabe], "fn": CHECK_FN[aufgabe],
        "star": it.get("tier") == 1, "trap": it.get("trap"), "focus": it.get("focus") or ["chunk"], "strict": it.get("strict") or [],
        "plan": "choice" if topic else "recall", "task": it.get("task"), "prompt": it["prompt"], "prompt_lang": "en",
        "hl": None if topic else it["hl"], "partner": None, "prefill": None, "accept": it["accept"], "anywhere": True,
        "model": it["model"], "wrong": it.get("wrong") or [], "rule": it["rule"], "src": "schreiben", "chunk": None, "level": "B1",
    }


def build_items(fns, ctx, prev_models, E, W):
    items, seen = [], set()
    for a in AUFGABEN:
        f = load(f"{a.lower()}.json")
        if f.get("aufgabe") != a:
            E.append(f"{a.lower()}.json: aufgabe must be {a}")
        for i, src in enumerate(f.get("items", [])):
            at = f"{a.lower()}.json[{i}] {src.get('id', '?')}"
            extra = set(src) - ITEM_KEYS
            if extra:
                E.append(f"{at}: unknown keys {sorted(extra)}")
            iid = src.get("id", "")
            if not re.fullmatch(rf"BS:{a.lower()}-[a-z0-9]+(-[a-z0-9]+)*", iid):
                E.append(f"{at}: id must look like BS:{a.lower()}-lowercase-words")
            if iid in seen:
                E.append(f"{at}: duplicate id")
            seen.add(iid)
            fn = fns.get(src.get("fn"))
            if not fn or fn["aufgabe"] != a:
                E.append(f"{at}: fn must be a function of {a} in functions.json")
            if src.get("tier") not in (1, 2, 3):
                E.append(f"{at}: tier is 1, 2 or 3")
            if not all(isinstance(src.get(k), str) and src[k].strip() for k in ("prompt", "model", "rule")):
                E.append(f"{at}: prompt, model and rule are needed")
                continue
            it = {**src, "hl": src.get("hl") or hl_of(src["prompt"])}
            e, w = V.check_item(as_b1(it, a), ctx, at)
            E += e
            W += w
            E += punct_errors(it["model"], it.get("punct"), at)
            E += register_errors(it["model"], a, at)
            E += polite_errors(it["model"], it.get("strict") or [], at)
            if a == "A3":
                E += polite_pattern_errors(it["accept"], it.get("strict") or [], it["model"], at)
            if V.norm(it["model"]) in prev_models:
                E.append(f"{at}: the B1 trainer already has this model sentence ({prev_models[V.norm(it['model'])]})")
            items.append((a, it))
    js = V.js_check([as_b1(it, a) for a, it in items], "items")
    E += js
    return items


def check_tasks(tasks, ctx, E, W):
    ids = set()
    parts_b1 = []
    for k, t in enumerate(tasks):
        at = f"tasks.json[{k}] {t.get('id', '?')}"
        if set(t) - TASK_KEYS:
            E.append(f"{at}: unknown keys {sorted(set(t) - TASK_KEYS)}")
        if not re.fullmatch(r"a[123]-[a-z0-9-]+", t.get("id", "")) or t["id"] in ids:
            E.append(f"{at}: id must be unique and look like a1-short-name")
        ids.add(t.get("id"))
        a = t.get("aufgabe")
        if a not in AUFGABEN or not t.get("id", "").startswith(a.lower() if a else "?"):
            E.append(f"{at}: aufgabe A1, A2 or A3, the same as the id")
            continue
        for key in ("situation", "title", "to"):
            if not isinstance(t.get(key), str) or not t[key].strip():
                E.append(f"{at}: {key} missing")
        pts = t.get("points") or []
        if not 3 <= len(pts) <= 5:
            E.append(f"{at}: 3-5 points")
        if a == "A2" and not t.get("quote"):
            E.append(f"{at}: an Aufgabe 2 task quotes the post it answers")
        if t.get("exam") is not None:
            ex = t["exam"]
            p = ROOT / f"content/exams/goethe-b1/day{int(ex.get('test', 0)):02d}.json"
            if not p.exists():
                E.append(f"{at}: exam test {ex.get('test')} does not exist")
            else:
                s = json.loads(p.read_text())["schreiben"].get(ex.get("aufgabe"), {})
                if V.norm(s.get("situation", "")) != V.norm(t["situation"]):
                    E.append(f"{at}: situation differs from the exam's {ex.get('aufgabe')} in test {ex.get('test')}")
        keys, covered = set(), set()
        parts = t.get("parts") or []
        for i, p in enumerate(parts):
            pat = f"{at} part {p.get('key', i)}"
            if set(p) - PART_KEYS:
                E.append(f"{pat}: unknown keys {sorted(set(p) - PART_KEYS)}")
            if p.get("key") in keys or not re.fullmatch(r"open|intro|p[1-5]|close|sign", p.get("key", "")):
                E.append(f"{pat}: key is open, intro, p1-p5, close or sign, once each")
            keys.add(p.get("key"))
            if p.get("kind") not in ("fixed", "free"):
                E.append(f"{pat}: kind is fixed or free")
                continue
            if p.get("point") is not None:
                if not isinstance(p["point"], int) or not 1 <= p["point"] <= len(pts):
                    E.append(f"{pat}: point must be 1..{len(pts)}")
                covered.add(p["point"])
            if not all(isinstance(p.get(x), str) and p[x].strip() for x in ("cue", "model", "rule")):
                E.append(f"{pat}: cue, model and rule are needed")
                continue
            # the cue names the connector in brackets and the addressee by name: neither counts as German in the prompt
            cue = re.sub(r"\s*\([^()]*\)", "", p["cue"]).replace(t["to"].split()[-1], "X")
            src = {"id": f"BX:{t['id']}-{p['key']}", "tier": 1, "prompt": cue, "hl": hl_of(cue), **{x: p.get(x) for x in ("model", "accept", "wrong", "trap", "focus", "strict", "rule")}}
            b1 = as_b1(src, a, "topic" if p["kind"] == "free" else "phrase")
            e, w = V.check_item(b1, ctx, pat)
            E += e
            W += w
            parts_b1.append(b1)
            E += punct_errors(p["model"], p.get("punct"), pat)
            E += register_errors(p["model"], a, pat)
            if p["kind"] == "fixed":
                E += polite_errors(p["model"], p.get("strict") or [], pat)
            if a == "A3":
                E += polite_pattern_errors(p.get("accept"), p.get("strict") or [], p["model"], pat)
            if p.get("lower") and not ("lower-start" in (p.get("punct") or [])):
                E.append(f"{pat}: a lower part needs the lower-start rule")
            for g in p.get("glue") or []:
                if not re.search(rf"(?<![\wäöüß]){re.escape(g)}(?![\wäöüß])", p["model"], re.I):
                    E.append(f"{pat}: glue word {g!r} is not in the model")
            if p["kind"] == "free" and not p.get("frame"):
                E.append(f"{pat}: a free part shows its frame")
            if p["kind"] == "free" and p.get("glue"):
                miss = [x for x in p["accept"] if not any(re.search(rf"\b{re.escape(V.norm(g))}\b", V.norm(x)) for g in p["glue"])]
                if miss:
                    W.append(f"{pat}: patterns without a glue word: {miss}")
        if covered != set(range(1, len(pts) + 1)):
            E.append(f"{at}: every point needs a part (have {sorted(covered)})")
        if a != "A2" and not {"open", "sign"} <= keys:
            E.append(f"{at}: an email has open and sign parts")
        n = len(re.findall(r"[\wäöüßÄÖÜ-]+", " ".join(p.get("model", "") for p in parts)))
        lo, hi = WORDS[a]
        if not lo <= n <= hi:
            E.append(f"{at}: the model text has {n} words (aim {lo}-{hi} for {a})")
    E += V.js_check(parts_b1, "tasks")


def slot_errors(rows):
    """A mandatory [x] right before nicht or leider is almost always an optional slot written as mandatory: "leider kann
    ich [x] nicht kommen" rejects the plainest right answer, "Leider kann ich nicht kommen" (German review round 2)."""
    return [f"{at}: accept {p!r} has a mandatory [x] before nicht/leider; write ([x]) if the slot can be empty"
            for at, pats in rows for p in pats if re.search(r"(?<!\()\[x\]\s+(nicht|leider)\b", p)]


def main():
    check_only = "--check" in sys.argv
    E, W = [], []
    ctx = V.Ctx()
    meta = load("functions.json")
    fns = {f["id"]: f for f in meta["functions"]}
    if [a["id"] for a in meta["aufgaben"]] != AUFGABEN:
        E.append("functions.json: aufgaben are A1, A2, A3")
    prev = json.loads((ROOT / "content/b1/items.json").read_text())
    prev_by_id = {i["id"]: i for i in prev}
    prev_models = {V.norm(i["model"]): i["id"] for i in prev if i.get("model")}
    for iid, fn in meta["existing"].items():
        it = prev_by_id.get(iid)
        if not it or it.get("group") != "write" and not str(it.get("teil", "")).startswith("W"):
            E.append(f"functions.json existing {iid}: not a letter item of content/b1/items.json")
        elif fn not in fns or TEIL[fns[fn]["aufgabe"]] != it["teil"]:
            E.append(f"functions.json existing {iid}: {fn} is not a function of its Teil {it['teil']}")
        elif it["teil"] == "W3":   # a formal letter item: pool.js adds the model's polite forms to strict, not the patterns'
            polite = [w for sent in sentences(it["model"]) for w in re.findall(r"[\wäöüßÄÖÜ]+", sent)[1:] if w in SIE_FORMS]
            E += polite_pattern_errors(it["accept"], (it.get("strict") or []) + polite, it["model"], f"linked {iid} (authoring/b1-src)")
    items = build_items(fns, ctx, prev_models, E, W)
    tasks = load("tasks.json")["tasks"]
    E += slot_errors([(it["id"], it["accept"]) for _, it in items] + [(f"{t['id']}/{p['key']}", p.get("accept") or []) for t in tasks for p in t["parts"]])
    check_tasks(tasks, ctx, E, W)
    for w in W:
        print("warn:", w)
    for e in E:
        print("ERROR:", e)
    if E:
        print(f"build_schreiben: {len(E)} error(s)")
        sys.exit(1)

    # rank: tier, then A3, A1, A2 in turn; the trainer's letter items lead tier 1 of their Aufgabe
    queues = {}
    for iid, fn in meta["existing"].items():
        queues.setdefault((1, fns[fn]["aufgabe"]), []).append(("link", iid, fn))
    for a, it in items:
        queues.setdefault((it["tier"], a), []).append(("item", it["id"], it))
    order = []
    for tier in (1, 2, 3):
        qs = [list(queues.get((tier, a), [])) for a in ORDER]
        while any(qs):
            for q in qs:
                if q:
                    order.append(q.pop(0))
    rank = {x[1]: i + 1 for i, x in enumerate(order)}

    out_items = []
    for a, it in items:
        out_items.append({
            "id": it["id"], "kind": "phrase", "area": "writing", "group": TEIL[a], "teil": TEIL[a], "aufgabe": a,
            "fn": it["fn"], "star": it["tier"] == 1, "tier": it["tier"], "rank": rank[it["id"]],
            "trap": it.get("trap"), "focus": it.get("focus") or ["chunk"], "strict": it.get("strict") or [], "plan": "recall",
            "task": it.get("task"), "prompt": it["prompt"], "prompt_lang": "en", "hl": it["hl"], "partner": None, "prefill": None,
            "accept": it["accept"], "anywhere": True, "model": it["model"], "wrong": it.get("wrong") or [], "rule": it["rule"],
            "punct": it.get("punct") or [], "src": "schreiben", "chunk": None, "level": "B1",
        })
    out_items.sort(key=lambda x: x["rank"])
    count = {}
    for x in out_items:
        count[x["fn"]] = count.get(x["fn"], 0) + 1
    for iid, fn in meta["existing"].items():
        count[fn] = count.get(fn, 0) + 1
    data = {
        "about": "Goethe B1 Schreiben practice. Built from authoring/schreiben-src by tools/build_schreiben.py; do not edit.",
        "aufgaben": meta["aufgaben"],
        "functions": [{**f, "n": count.get(f["id"], 0)} for f in meta["functions"]],
        "items": out_items,
        "linked": {iid: {"fn": fn, "rank": rank[iid]} for iid, fn in meta["existing"].items()},
        "tasks": [{**t, "parts": [{"point": None, "lower": False, "frame": None, "glue": [], "trap": None, "strict": [], "punct": [], "wrong": [], **p,
                                   "focus": p.get("focus") or ["chunk"]} for p in t["parts"]]} for t in tasks],
    }
    by = {a: sum(1 for b, _ in items if b == a) for a in AUFGABEN}
    print(f"schreiben: {len(out_items)} items ({', '.join(f'{a} {n}' for a, n in by.items())}) + {len(meta['existing'])} linked trainer items · "
          f"tier 1 {sum(1 for _, i in items if i['tier'] == 1)} · {len(tasks)} email tasks, {sum(len(t['parts']) for t in tasks)} parts")
    if check_only:
        return
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
