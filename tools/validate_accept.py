#!/usr/bin/env python3
"""Check authoring/chunks/accept/<lang>/*.json (accepted typed answers per phrase).

    python3 tools/validate_accept.py german [part]      # one part file, or all parts
    python3 tools/validate_accept.py german --assemble  # all parts -> content/igloo/chunks/accept_<lang>.json

Entry: {"ENG_CHUNK_0301": {"core_en": "how do you know", "accept": ["woher kennst du [x]", "woher kennen Sie [x]"]}}
"weak": true marks a phrase whose German is a single generic word ("oder", "also"); the typed Test skips it.

Pattern rules (match.js implements the same):
  - case and punctuation are ignored; ae/oe/ue/ss == ä/ö/ü/ß
  - "(word word)" = optional words
  - "[anything]" = a slot: 1 to 6 words (slot_max; the B1 trainer uses 10)
  - "([x])" = an optional slot: 0 to slot_max words (B1 items only; no accept_<lang>.json pattern uses it)
  - a pattern matches if it appears anywhere in the answer (the answer may add context around it)
"""
import json, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def norm(s):
    s = unicodedata.normalize("NFC", s).lower()
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = re.sub(r"[^\w\s\[\]()'’-]", " ", s)
    return " ".join(s.replace("’", "'").split())


SLOT_OPT = "\x00"


def to_regex(pattern, slot_max=6, anchored=False, groups=False):
    """Compile an accept pattern. anchored: the whole answer must match. groups: slots become named groups s0, s1, ..."""
    p = norm(pattern)
    out = []
    toks = re.findall(r"\(\[[^\]]*\]\)|\[[^\]]*\]|\([^)]*\)|[^\s\[\]()]+", p)
    slot = r"\S+(?: \S+){0,%d}" % (slot_max - 1)
    kinds = []
    for tok in toks:
        g = f"?P<s{len([k for k in kinds if k != 'w'])}>" if groups else "?:"
        if tok.startswith("(["):
            out.append(f"({g}{slot})"); kinds.append("o")
        elif tok.startswith("["):
            out.append(f"({g}{slot})"); kinds.append("s")
        elif tok.startswith("("):
            inner = " ".join(re.escape(w) for w in tok[1:-1].split())
            out.append(f"(?:{inner})?" if inner else ""); kinds.append("w")
        else:
            out.append(re.escape(tok)); kinds.append("w")
    # optional groups may be absent, so spacing between fixed parts is flexible;
    # a slot must be separated from its neighbours by whitespace (no half-word slots).
    # An optional slot "([x])" is folded into the separator around it: " words " or the plain separator.
    parts = [(x, k) for x, k in zip(out, kinds) if x]
    body, pending = "", None
    for i, (x, k) in enumerate(parts):
        if k == "o":
            pending = x if pending is None else pending[:-1] + r"(?:\s+" + x + "))"  # two optional slots in a row
            continue
        if body:
            prev_slot = parts_kind_last == "s"
            sep = r"\s+" if (k == "s" or prev_slot) else r"\s*"
            body += sep if pending is None else r"(?:\s+" + pending + r"\s+|" + sep + ")"
        elif pending is not None:
            body += r"(?:" + pending + r"\s+)?"
        body += x
        parts_kind_last, pending = k, None
    if pending is not None:
        body += r"(?:\s+" + pending + ")?"
    if anchored:
        return re.compile(r"^\s*" + body + r"\s*$")
    return re.compile(r"(?:^|\s)" + body + r"(?:\s|$)")


def matches(answer, pattern, slot_max=6, anchored=False):
    a = norm(answer)
    return bool(to_regex(pattern, slot_max, anchored).search(a if anchored else " " + a + " "))


def load(lang):
    en = {c["id"]: c for c in json.loads((ROOT / "content/igloo/chunks/en.json").read_text())}
    tr = json.loads((ROOT / f"content/igloo/chunks/{lang}.json").read_text())["chunks"]
    return en, tr


def check_part(path, en, tr):
    data = json.loads(Path(path).read_text())
    errors, warnings = [], []
    for cid, e in data.items():
        if cid not in en:
            errors.append(f"{cid}: unknown id")
            continue
        if not {"core_en", "accept"} <= set(e) <= {"core_en", "accept", "weak"}:
            errors.append(f"{cid}: keys must be core_en, accept (and optional weak)")
            continue
        ex_en = en[cid]["natural_example"]
        if e["core_en"].lower() not in ex_en.lower():
            errors.append(f"{cid}: core_en {e['core_en']!r} is not in the English example {ex_en!r}")
        acc = e["accept"]
        if not (isinstance(acc, list) and acc and all(isinstance(a, str) and a.strip() for a in acc)):
            errors.append(f"{cid}: accept must be a non-empty list of strings")
            continue
        if len(acc) != len({norm(a) for a in acc}):
            warnings.append(f"{cid}: duplicate patterns")
        for a in acc:
            if a.count("(") != a.count(")") or a.count("[") != a.count("]"):
                errors.append(f"{cid}: unbalanced brackets in {a!r}")
            if not re.sub(r"\[[^\]]*\]|\([^)]*\)", "", a).strip(" .,!?"):
                errors.append(f"{cid}: pattern {a!r} has no fixed words")
        ex_de = tr.get(cid, {}).get("ex", "")
        if ex_de and not any(matches(ex_de, a) for a in acc):
            errors.append(f"{cid}: the German example does not match any pattern: {ex_de!r}")
    return data, errors, warnings


def main():
    lang = sys.argv[1]
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    en, tr = load(lang)
    pdir = ROOT / f"authoring/chunks/accept/{lang}"
    parts = [pdir / f"{arg}.json"] if arg and arg != "--assemble" else sorted(pdir.glob("*.json"))
    merged, errs = {}, 0
    for p in parts:
        data, errors, warnings = check_part(p, en, tr)
        for w in warnings:
            print("WARN ", w)
        for e in errors:
            print("ERROR", e)
        errs += len(errors)
        print(f"{p.name}: {len(data)} phrases, {len(errors)} error(s), {len(warnings)} warning(s)")
        merged.update(data)
    if arg == "--assemble":
        missing = [c for c in en if c not in merged]
        if missing:
            print(f"ERROR {len(missing)} phrases have no entry, e.g. {missing[:10]}")
            errs += 1
        if not errs:
            out = ROOT / f"content/igloo/chunks/accept_{lang}.json"
            out.write_text(json.dumps(merged, ensure_ascii=False, separators=(",", ":")) + "\n")
            print(f"wrote {out.relative_to(ROOT)} ({len(merged)} phrases)")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
