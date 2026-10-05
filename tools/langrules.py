"""Per-language rules for the content validators (round 3, C3a; Arch #15).

The validators (validate.py, validate_accept.py, validate_chunks.py, validate_grammar.py, validate_sentences.py) are
language-neutral and take a language; what differs between languages is here, one plugin per language:

  code, legacy   the pack id of src/lang/registry.js ('de') and the settings and file id ('german'); either names it
  translit       learners type Latin: every phrase, example and sentence token needs a transliteration
                 (content/igloo/framework.json languages[].translit, the one source)
  fold           how an accept pattern and an answer are compared (validate_accept.py norm): German folds ä/ö/ü/ß to
                 ae/oe/ue/ss (match.js and the German pack do the same); French keeps its accents (ou/où differ) and
                 writes œ/æ as oe/ae; Arabic drops the harakat and tatweel and writes one alef (src/lang/ar/text.js)
  grammar_kinds  the grammar item kinds the language has (choose-article only where there are articles)

German's entries are exactly the checks the validators made before they took a language.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# pack id -> settings/file id, in the registry's order (tests/unit/lang-registry.test.mjs keeps the registry in step
# with the manifest; tests/unit/content-pipeline.test.mjs keeps this table in step with the registry)
CODES = {
    "de": "german", "fr": "french", "es": "spanish", "it": "italian", "pt": "portuguese",
    "gsw": "swissgerman", "hi": "hindi", "bn": "bengali", "kha": "khasi", "ar": "arabic",
}

BASE_KINDS = {"transform", "gap", "join", "order", "translate"}
ARTICLE_LANGS = {"de", "gsw", "fr", "es", "it", "pt", "ar"}


def fold_german(s):
    return s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")


def fold_french(s):
    # œ/æ as typed, and elision split off as src/lang/fr/text.js tokenizes it (l'ami → l' ami, qu'il → qu' il;
    # aujourd'hui stays one word), so a pattern "parce qu'" matches "parce qu'il" here as in the app
    s = s.replace("œ", "oe").replace("æ", "ae").replace("’", "'")
    return re.sub(r"(?<![\w'])(jusqu|lorsqu|puisqu|quoiqu|qu|[cdjlmnst])'(?=\w)", r"\1' ", s, flags=re.I)


def fold_arabic(s):
    s = re.sub("[ً-ْٰـ]", "", s)
    return re.sub("[آأإٱ]", "ا", s).replace("ى", "ي")


FOLD = {"de": fold_german, "gsw": fold_german, "fr": fold_french, "ar": fold_arabic}


def _translit():
    fw = json.loads((ROOT / "content/igloo/framework.json").read_text())
    return {l["id"]: bool(l.get("translit")) for l in fw["languages"]}


class Lang:
    def __init__(self, code):
        self.code = code
        self.legacy = CODES[code]
        self.translit = _translit().get(self.legacy, False)
        self.fold = FOLD.get(code, lambda s: s)
        self.grammar_kinds = BASE_KINDS | ({"choose-article"} if code in ARTICLE_LANGS else set())

    def __repr__(self):
        return f"Lang({self.code})"


def lang(name):
    """The rules of a language named by its pack id ('de') or its settings id ('german')."""
    if name in CODES:
        return Lang(name)
    for code, legacy in CODES.items():
        if legacy == name:
            return Lang(code)
    raise SystemExit(f"unknown language {name!r}: one of {', '.join(CODES)} (or {', '.join(CODES.values())})")
