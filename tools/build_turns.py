#!/usr/bin/env python3
"""Build content/igloo/turns.json: the GO tense table (3 times x 3 aspects) for all ten languages.

The five full languages (khasi, german, hindi, french, swissgerman) take gloss and note from
content/igloo/lang/<lang>.json turnGrid plus the authored table A below. The other five (bengali, spanish,
italian, portuguese, arabic) come from authoring/turns-src/<lang>.json: nine cells, each
{time, aspect, form, alt, status, marker, gloss, note, translit, markerTr}. Romanisation of
their `alt` forms (Bengali, Arabic) is authored here in ALT_TR.

The homepage's "Tenses" section reads only this file, so it does not have to download the
full content/igloo/lang/<lang>.json files. gloss and note are copied from each language's turnGrid; the
fields below are authored here:

  form    the main form (the text before " / " in turnGrid, written out in full)
  alt     another common way to say it, or the feminine form for Hindi (altLabel "said by a woman")
  status  "form"        the language has a real tense or construction for this cell
          "periphrasis" no dedicated form; speakers use a workaround (an adverb, a rephrase)
          "none"        the notes say the form does not exist or is not used
  marker  the word or words in `form` that carry the time or aspect, compared with the
          present simple (which has no markers: it is the baseline). Each marker is a run of
          whole words from `form`.
  markerTr  the same words in the transliteration (Hindi, Bengali, Arabic)

Run: python3 tools/build_turns.py   (validates markers and writes content/igloo/turns.json)
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TIMES = ["past", "present", "future"]
ASPECTS = ["simple", "progressive", "perfect"]
LANGS = ["khasi", "german", "hindi", "french", "swissgerman"]
SRC_LANGS = ["bengali", "spanish", "italian", "portuguese", "arabic"]

# romanisation of the `alt` forms in data/turns_src, in each file's own scheme
ALT_TR = {
 "bengali": {
  "past.simple":         "aami gechhilaam",
  "past.perfect":        "aami gechhilaam",
  "present.perfect":     "aami giyechhi",
  "future.progressive":  "aami jete thaakbo",
  "future.perfect":      "aami giye thaakbo",
 },
 "arabic": {
  "past.progressive":    "kuntu adh-hab",
  "present.progressive": "adh-hab al-aan",
  "present.perfect":     "dhahabtu",
  "future.simple":       "sawfa adh-hab",
  "future.progressive":  "sa-adh-hab",
 },
}

ENGLISH = {
    "past.simple":         ("I went", ["went"], "went"),
    "past.progressive":    ("I was going", ["was going"], "was going"),
    "past.perfect":        ("I had gone", ["had gone"], "had gone"),
    "present.simple":      ("I go", [], "go"),
    "present.progressive": ("I am going", ["am going"], "am going"),
    "present.perfect":     ("I have gone", ["have gone"], "have gone"),
    "future.simple":       ("I will go", ["will"], "will go"),
    "future.progressive":  ("I will be going", ["will be going"], "will be going"),
    "future.perfect":      ("I will have gone", ["will have gone"], "will have gone"),
}

# (form, alt, status, marker[, translit, altTranslit, markerTr])
A = {
 "khasi": {
  "past.simple":         ("nga la leit", None, "form", ["la"]),
  "past.progressive":    ("nga la dang leit", None, "form", ["la dang"]),
  "past.perfect":        ("nga la lah leit", None, "form", ["la lah"]),
  "present.simple":      ("nga leit", None, "form", []),
  "present.progressive": ("nga dang leit", None, "form", ["dang"]),
  "present.perfect":     ("nga lah leit", None, "form", ["lah"]),
  "future.simple":       ("ngan leit", "ngan sa leit", "form", ["ngan"]),
  "future.progressive":  ("ngan dang leit", "ngan leit lashai", "form", ["ngan dang"]),
  "future.perfect":      ("ngan lah leit", None, "form", ["ngan lah"]),
 },
 "german": {
  "past.simple":         ("ich bin gegangen", "ich ging", "form", ["bin gegangen"]),
  "past.progressive":    ("ich ging gerade", "ich war gerade unterwegs", "periphrasis", ["ging gerade"]),
  "past.perfect":        ("ich war gegangen", None, "form", ["war gegangen"]),
  "present.simple":      ("ich gehe", None, "form", []),
  "present.progressive": ("ich gehe gerade", None, "periphrasis", ["gerade"]),
  "present.perfect":     ("ich bin gegangen", None, "form", ["bin gegangen"]),
  "future.simple":       ("ich gehe morgen", "ich werde gehen", "form", ["morgen"]),
  "future.progressive":  ("ich gehe dann gerade", "ich werde dann gerade gehen", "none", ["dann gerade"]),
  "future.perfect":      ("ich werde gegangen sein", "bis dahin bin ich gegangen", "form", ["werde gegangen sein"]),
 },
 "hindi": {
  "past.simple":         ("मैं गया", "मैं गई", "form", ["गया"], "main gayaa", "main gaii", ["gayaa"]),
  "past.progressive":    ("मैं जा रहा था", "मैं जा रही थी", "form", ["रहा था"], "main jaa rahaa thaa", "main jaa rahii thii", ["rahaa thaa"]),
  "past.perfect":        ("मैं गया था", "मैं गई थी", "form", ["गया था"], "main gayaa thaa", "main gaii thii", ["gayaa thaa"]),
  "present.simple":      ("मैं जाता हूँ", "मैं जाती हूँ", "form", [], "main jaataa huun", "main jaatii huun", []),
  "present.progressive": ("मैं जा रहा हूँ", "मैं जा रही हूँ", "form", ["रहा"], "main jaa rahaa huun", "main jaa rahii huun", ["rahaa"]),
  "present.perfect":     ("मैं गया हूँ", "मैं गई हूँ", "form", ["गया"], "main gayaa huun", "main gaii huun", ["gayaa"]),
  "future.simple":       ("मैं जाऊँगा", "मैं जाऊँगी", "form", ["जाऊँगा"], "main jaauungaa", "main jaauungii", ["jaauungaa"]),
  "future.progressive":  ("मैं जा रहा हूँगा", "मैं जा रही हूँगी", "form", ["रहा हूँगा"], "main jaa rahaa huungaa", "main jaa rahii huungii", ["rahaa huungaa"]),
  "future.perfect":      ("मैं गया हूँगा", "मैं गई हूँगी", "form", ["गया हूँगा"], "main gayaa huungaa", "main gaii huungii", ["gayaa huungaa"]),
 },
 "french": {
  "past.simple":         ("je suis allé(e)", None, "form", ["suis allé(e)"]),
  "past.progressive":    ("j'allais", "j'étais en train d'aller", "form", ["j'allais"]),
  "past.perfect":        ("j'étais allé(e)", None, "form", ["j'étais allé(e)"]),
  "present.simple":      ("je vais", None, "form", []),
  "present.progressive": ("je suis en train d'aller", "je vais", "periphrasis", ["suis en train"]),
  "present.perfect":     ("je suis allé(e)", None, "form", ["suis allé(e)"]),
  "future.simple":       ("je vais aller", "j'irai", "form", ["vais"]),
  "future.progressive":  ("je serai en train d'aller", None, "none", ["serai en train"]),
  "future.perfect":      ("je serai allé(e)", None, "form", ["serai allé(e)"]),
 },
 "swissgerman": {
  "past.simple":         ("ich bin ggange", None, "form", ["bin ggange"]),
  "past.progressive":    ("ich bin grad am Gaa gsi", None, "periphrasis", ["bin grad am", "gsi"]),
  "past.perfect":        ("ich bin scho ggange gsi", None, "form", ["bin", "ggange gsi"]),
  "present.simple":      ("ich gang", None, "form", []),
  "present.progressive": ("ich bin am Gaa", None, "form", ["bin am"]),
  "present.perfect":     ("ich bin ggange", None, "form", ["bin ggange"]),
  "future.simple":       ("ich gang morn", "ich wird gaa", "form", ["morn"]),
  "future.progressive":  ("ich bin dänn am Gaa", None, "none", ["bin dänn am"]),
  "future.perfect":      ("ich bin dänn scho ggange", "bis dänn bin ich ggange", "none", ["bin dänn scho ggange"]),
 },
}

def words(s): return s.split()

def check_markers(form, markers, where):
    w = words(form); ok = True
    for m in markers:
        mw = words(m)
        if not any(w[i:i + len(mw)] == mw for i in range(len(w) - len(mw) + 1)):
            print(f"{where}: marker {m!r} is not a run of whole words in {form!r}", file=sys.stderr); ok = False
    return ok

def main():
    ok = True
    out = {"about": "GO in nine tenses. Built by tools/build_turns.py from content/igloo/lang/<lang>.json turnGrid plus authored status/marker/alt, and from authoring/turns-src/<lang>.json.",
           "times": TIMES, "aspects": ASPECTS,
           "english": {k: {"form": v[0], "marker": v[1], "short": v[2]} for k, v in ENGLISH.items()},
           "languages": {}}
    for lang in LANGS:
        L = json.loads((ROOT / "content/igloo/lang" / f"{lang}.json").read_text())
        grid = {f"{c['time']}.{c['aspect']}": c for c in L.get("turnGrid", [])}
        cells = {}
        for t in TIMES:
            for a in ASPECTS:
                k = f"{t}.{a}"
                if k not in A[lang] or k not in grid:
                    print(f"{lang} {k}: missing", file=sys.stderr); ok = False; continue
                row = A[lang][k]
                form, alt, status, marker = row[:4]
                src = grid[k]
                if status not in ("form", "periphrasis", "none"):
                    print(f"{lang} {k}: bad status {status}", file=sys.stderr); ok = False
                ok &= check_markers(form, marker, f"{lang} {k}")
                if k == "present.simple" and marker:
                    print(f"{lang} {k}: the baseline must have no markers", file=sys.stderr); ok = False
                cell = {"form": form, "status": status, "marker": marker, "gloss": src.get("gloss", ""), "note": src.get("note", ""), "source": src.get("form", "")}
                if alt: cell["alt"] = alt
                if len(row) > 4:
                    cell["translit"], cell["altTranslit"], cell["markerTr"] = row[4], row[5], row[6]
                if lang == "hindi" and alt:
                    cell["altLabel"] = "said by a woman"
                    ok &= check_markers(row[4], row[6], f"{lang} {k} translit")
                cells[k] = cell
        out["languages"][lang] = {"name": L.get("name", lang), "native": L.get("native", ""), "cells": cells}
    FW = {l["id"]: l for l in json.loads((ROOT / "content/igloo/framework.json").read_text())["languages"]}
    for lang in SRC_LANGS:
        src = {f"{c['time']}.{c['aspect']}": c for c in json.loads((ROOT / "authoring/turns-src" / f"{lang}.json").read_text())}
        needs_tr = FW[lang].get("translit", False)
        cells = {}
        for t in TIMES:
            for a in ASPECTS:
                k = f"{t}.{a}"
                c = src.get(k)
                if not c:
                    print(f"{lang} {k}: missing", file=sys.stderr); ok = False; continue
                form, status, marker = c["form"].strip(), c["status"], c.get("marker") or []
                if status not in ("form", "periphrasis", "none"):
                    print(f"{lang} {k}: bad status {status}", file=sys.stderr); ok = False
                ok &= check_markers(form, marker, f"{lang} {k}")
                if k == "present.simple" and marker:
                    print(f"{lang} {k}: the baseline must have no markers", file=sys.stderr); ok = False
                cell = {"form": form, "status": status, "marker": marker, "gloss": c.get("gloss", ""), "note": c.get("note", "")}
                alt = (c.get("alt") or "").strip()
                if alt: cell["alt"] = alt
                if needs_tr:
                    tr, mtr = (c.get("translit") or "").strip(), c.get("markerTr") or []
                    if not tr:
                        print(f"{lang} {k}: missing translit", file=sys.stderr); ok = False
                    if len(mtr) != len(marker):
                        print(f"{lang} {k}: markerTr has {len(mtr)} entries, marker has {len(marker)}", file=sys.stderr); ok = False
                    ok &= check_markers(tr, mtr, f"{lang} {k} translit")
                    cell["translit"], cell["markerTr"] = tr, mtr
                    if alt:
                        atr = ALT_TR.get(lang, {}).get(k)
                        if not atr:
                            print(f"{lang} {k}: no romanisation for alt {alt!r} in ALT_TR", file=sys.stderr); ok = False
                        else: cell["altTranslit"] = atr
                cells[k] = cell
        extra = set(ALT_TR.get(lang, {})) - {k for k, v in cells.items() if "alt" in v}
        if extra:
            print(f"{lang}: ALT_TR has entries for cells without an alt: {sorted(extra)}", file=sys.stderr); ok = False
        out["languages"][lang] = {"name": FW[lang]["name"], "native": FW[lang]["native"], "cells": cells}
    if not ok:
        sys.exit(1)
    p = ROOT / "content/igloo/turns.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("wrote", p, sum(len(v["cells"]) for v in out["languages"].values()), "cells")

if __name__ == "__main__":
    main()
