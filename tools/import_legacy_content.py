#!/usr/bin/env python3
"""One-time import of the public content from the two legacy repos into this repo.

    python3 tools/import_legacy_content.py --igloo <path to language-doors> --exam <path to b1-exam>

Copies shared learning material into content/ (runtime, public, read by the app and later by iOS) and its
sources into authoring/ (never fetched by the app). It never copies personal data, and it drops or cleans the
few places where personal material sits inside otherwise public files:

  * B1 items whose `src` starts with "mine" or names Fritz (items mined from one learner's own exams)
  * the `fritz` evidence field on German grammar concepts (one learner's error counts)
  * a learner's name in the cheatsheet sign-off rows (coverage report input)
  * the hard-coded exam date in the B1 plan's `about` text
  * local file-system paths in the authoring briefs

Not copied at all: data/words/seed_de.json (words one learner already knows, built from his Anki and exam vocab),
scripts that read private sources (seed_words_de.py, build_chunk_master.py), b1-exam data/, audio and anything
under docs/data/. Re-running it overwrites the copied files; run `python3 tools/build_b1.py` afterwards.
"""
import argparse, json, re, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PERSONAL_SRC = re.compile(r"^\s*mine\b|fritz", re.I)
# Name and employer in the Igloo self-introduction sentences → a neutral persona. The pairs are personal, so they
# live in the git-ignored authoring/private/scrub.json ([[old, new], …]), never in this repository.
SCRUB = ROOT / "authoring/private/scrub.json"
PERSONA = [tuple(x) for x in json.loads(SCRUB.read_text())] if SCRUB.exists() else []


def cp(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
    else:
        shutil.copy2(src, dst)


def dump(path: Path, data, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    else:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--igloo", required=True, type=Path)
    ap.add_argument("--exam", required=True, type=Path)
    a = ap.parse_args()
    ld, ex = a.igloo / "data", a.exam / "docs/exams"
    C, A = ROOT / "content", ROOT / "authoring"

    # ---- Igloo: framework, languages, turns, sentences, phrases, words, grammar ----
    cp(ld / "framework.json", C / "igloo/framework.json")
    cp(ld / "turns.json", C / "igloo/turns.json")
    for f in sorted(ld.glob("*.json")):
        if f.name not in ("framework.json", "turns.json"):
            # the self-introduction examples used one learner's name and employer: same sentences, neutral persona
            text = f.read_text()
            for old, new in PERSONA:
                text = text.replace(old, new)
            (C / "igloo/lang").mkdir(parents=True, exist_ok=True)
            (C / "igloo/lang" / f.name).write_text(text)
    cp(ld / "sentences", C / "igloo/sentences")
    for f in sorted((ld / "chunks").glob("*.json")):
        if f.name in ("en_source.json", "beginner_en.json"):   # sources merged into en.json; the app never loads them
            cp(f, A / "chunks" / f.name)
        else:
            cp(f, C / "igloo/chunks" / f.name)
    # priority_de.json listed which phrases one learner already had on his Anki cards: not shared material
    prio = json.loads((ld / "chunks/priority_de.json").read_text())
    prio.pop("anki", None)
    prio["about"] = re.sub(r"\s*anki = .*$", "", prio["about"]).replace(" (exam October 2026)", "")
    dump(C / "igloo/chunks/priority_de.json", prio)
    for d in ("src", "parts", "levels", "accept"):
        cp(ld / "chunks" / d, A / "chunks" / d)
    cp(ld / "words/de.json", C / "igloo/words/de.json")
    cp(ld / "words/themes.json", C / "igloo/words/themes.json")
    cp(ld / "words/parts", A / "words-parts")
    cp(ld / "grammar/items_de.json", C / "igloo/grammar/items_de.json")
    concepts = json.loads((ld / "grammar/concepts_de.json").read_text())
    for c in concepts:
        c.pop("fritz", None)
    dump(C / "igloo/grammar/concepts_de.json", concepts)
    cp(ld / "turns_src", A / "turns-src")

    # ---- B1 trainer: sources without personal items, then the built files ----
    dropped = []
    (A / "b1-src").mkdir(parents=True, exist_ok=True)
    for f in sorted((ld / "b1/src").glob("*.json")):
        data = json.loads(f.read_text())
        if isinstance(data, list):
            keep = [i for i in data if not PERSONAL_SRC.search(str(i.get("src") or ""))]
            dropped += [i["id"] for i in data if i not in keep]
            if not keep:
                continue
            data = keep
        dump(A / "b1-src" / f.name, data)
    for name in ("annot.json", "grammar.json", "bank.json", "nouns.json", "frames.json", "wordmap.json"):
        cp(ld / "b1" / name, C / "b1" / name)
    items = [i for i in json.loads((ld / "b1/items.json").read_text()) if i["id"] not in set(dropped)]
    dump(C / "b1/items.json", items, compact=True)
    plan = json.loads((ld / "b1/plan.json").read_text())
    plan["about"] = re.sub(r"\s*\(Goethe-Zertifikat B1, [^)]*\)", " (Goethe-Zertifikat B1)", plan["about"])
    dump(C / "b1/plan.json", plan)

    # ---- authoring inputs for the validators ----
    rows = json.loads((a.igloo / "scripts/b1_cheatsheet_rows.json").read_text())
    for r in rows:
        if isinstance(r.get("de"), str):
            # sign-off examples carried one learner's name: use a neutral one
            r["de"] = re.sub(r"Dein [A-ZÄÖÜ]\w+$", "Dein Alex", r["de"])
            r["de"] = re.sub(r"Grüßen\s*[A-ZÄÖÜ]\w+ [A-ZÄÖÜ]\w+$", "Grüßen Alex Berger", r["de"])
    dump(A / "b1-cheatsheet-rows.json", rows)
    sample = [i for i in json.loads((a.igloo / "scripts/b1_fixtures/sample-items.json").read_text()) if not PERSONAL_SRC.search(str(i.get("src") or ""))]
    dump(ROOT / "tests/fixtures/b1-sample-items.json", sample)
    for f in sorted((a.igloo / "scripts").glob("*BRIEF*.md")):
        text = f.read_text()
        text = re.sub(r"/Users/[^/\s`]+/language-doors", "<repo>", text)
        text = text.replace("data/b1/src", "authoring/b1-src").replace("scripts/", "tools/")
        (A / "briefs").mkdir(parents=True, exist_ok=True)
        (A / "briefs" / f.name).write_text(text)

    # ---- Goethe B1 mock exams (shared exam content; answer keys are part of the content) ----
    for f in sorted(ex.glob("day*.json")):
        cp(f, C / "exams/goethe-b1" / f.name)
    for f in sorted((ex / "why").glob("day*.json")):
        cp(f, C / "exams/goethe-b1/why" / f.name)
    cp(ex / "why/README.md", A / "briefs/EXAM_WHY_BRIEF.md")
    cp(a.exam / "SCHEMA.md", A / "briefs/EXAM_SCHEMA_SOURCE.md")

    print(f"imported; dropped {len(dropped)} personal B1 items")


if __name__ == "__main__":
    main()
