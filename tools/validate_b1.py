#!/usr/bin/env python3
"""Check B1 trainer content (authoring/b1-src/*.json). Content agents run it on their own file until it reports 0 errors.

    python3 tools/validate_b1.py authoring/b1-src/c1-01.json [more files]   # item files or *-annot.json files
    python3 tools/validate_b1.py --all                                 # every file in authoring/b1-src/ + coverage report
    python3 tools/validate_b1.py --assemble                            # --all, then write content/b1/items.json + annot.json
    python3 tools/validate_b1.py --selftest                            # the validator's own fixture tests

The item schema and the reasons for each rule are in the content briefs (00-COMMON.md). Pattern syntax is
validate_accept.py's, with slots of up to 10 words and "([x])" for optional content (0-10 words).
Exit code 1 when there is any error.
"""
import json, re, sys, unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_accept import norm, to_regex  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "authoring/b1-src"
SLOT_MAX = 10

KIND_PREFIX = {"phrase": "BP", "topic": "BT", "reply": "BR", "grammar": "BG", "reading": "BL"}
KIND_AREA = {"phrase": "speaking", "topic": "speaking", "reply": "speaking", "grammar": "grammar", "reading": "reading"}
TRAPS = ["verb-final", "v2", "fuer-vor", "cap", "neuter"]
FOCUS = ["chunk", "verb-final", "v2", "inversion", "connector-order", "fuer-vor", "prep-case", "cap", "neuter", "article",
         "ending", "perfekt-aux", "participle", "konj2", "umlaut", "register", "word-choice", "paraphrase"]
NEEDS_WRONG = {"verb-final", "v2", "inversion", "fuer-vor", "cap", "neuter", "article", "ending", "prep-case",
               "perfekt-aux", "participle", "umlaut"}
PLANS = ["recall", "transform", "choice"]
LEVELS = ["A1", "A2", "B1", "B2"]
TEILE = {"speaking": ["S1", "S2", "S3", "W1", "W2", "W3"], "reading": ["L2", "L3", "L5"]}
GROUP_TEILE = {"S1": ["S1"], "S2": ["S2"], "S3": ["S3"], "opinion": ["S1", "S2", "S3", "W2"], "write": ["W1", "W2", "W3"]}
SPEAK_GROUPS = list(GROUP_TEILE)
READ_GROUPS = ["rules", "paraphrase", "signal"]
FN_TEIL = [("t1_", ["S1"]), ("t2_", ["S2"]), ("t3_", ["S3"]), ("inf_", ["W1"]), ("f_", ["W3"]),
           ("forum_", ["S1", "S2", "S3", "W2"])]
MOVES = [("agree", "Agree"), ("doubt", "Doubt + reason"), ("other", "Other idea")]
SUBORD = {"dass", "weil", "wenn", "ob", "obwohl", "als", "damit", "sobald", "bevor", "nachdem", "waehrend", "falls",
          "indem", "sodass", "seit", "seitdem", "bis", "wer"}
# a clause must end with its verb: these can't be the last word of a pattern that has a subordinator
NOT_VERB_END = set(norm("""der die das den dem des ein eine einen einem einer eines kein keine keinen keinem ich mich mir
    du dich dir er ihn ihm sie ihr ihnen es wir uns euch man sich mein meine meinen meinem dein deine deinen sein seine
    an am auf aus bei beim durch für gegen im in ins mit nach ohne über um unter von vom vor zu zum zur nicht auch noch
    schon sehr gern gerne mal doch ja so dann da hier dort heute morgen und oder aber""").split()) | SUBORD
OPINION_VERBS = ["glaube", "glauben", "denke", "denken", "finde", "finden", "meine", "meinen", "sage", "sagen",
                 "hoffe", "hoffen"]
OPTIONAL_KEYS = {"moves", "wrong_move", "extra"}
KEYS = ["id", "kind", "area", "group", "teil", "fn", "star", "trap", "focus", "strict", "plan", "task", "prompt",
        "prompt_lang", "hl", "partner", "prefill", "accept", "anywhere", "model", "wrong", "rule", "src", "chunk", "level"]
HINT_RE = re.compile(r"\b(verbs?|ans Ende|Nebensatz|Hauptsatz|Akkusativ|Dativ|Genitiv|Nominativ|accusative|dative|"
                     r"genitive|nominative|(?<!in )case|articles?|Artikel|subjunctive|Konjunktiv|infinitive|participle|"
                     r"clause|word order|inversion|Perfekt|Präteritum|umlaut|capital(?:s|ise|ize)?)\b", re.I)
LOANS = set("""party picknick homeoffice online team hotel restaurant computer film internet handy job app apps
    email e-mail chat sport baby kino taxi bus pizza burger fast food smartphone laptop tablet stress park
    programm system thema problem klima""".split())
GAP = "___"


def load_json(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        return default


class Ctx:
    def __init__(self):
        self.plan = load_json(ROOT / "content/b1/plan.json")
        self.topics = {t["id"]: t for t in self.plan["topics"]}
        prio = load_json(ROOT / "content/igloo/chunks/priority_de.json")
        self.fns = {f["id"] for f in prio["functions"]} | {f["id"] for f in self.plan["functions"]}
        self.chunk_ids = {c["id"] for c in load_json(ROOT / "content/igloo/chunks/en.json", [])}
        self.gitems = {g["id"]: g for g in load_json(ROOT / "content/igloo/grammar/items_de.json", [])}
        words = load_json(ROOT / "content/igloo/words/de.json", [])
        self.nouns, lower = set(), set()
        for w in words:
            forms = [w.get("w") or ""] + ([w["pl"]] if w.get("pl") else [])
            for f in forms:
                for t in re.findall(r"[\wäöüß]+", f, re.I):
                    (self.nouns if w.get("pos") == "noun" and t[:1].isupper() else lower).add(t if w.get("pos") == "noun" else t.lower())
        # words seen in lowercase mid-sentence in Igloo's German (glaube, essen, leben): never flagged as nouns
        texts = [w.get("ex") or "" for w in words]
        texts += [c.get("ex") or "" for c in (load_json(ROOT / "content/igloo/chunks/german.json", {}) or {}).get("chunks", {}).values()]
        for g in self.gitems.values():
            texts += g["answer"] if isinstance(g["answer"], list) else [g["answer"]]
        for t in texts:
            for sent in re.split(r"(?<=[.!?:])\s+", t):
                lower |= {w for w in re.findall(r"[a-zäöüß]+", sent[1:])}
        self.lower_ok = lower
        self.cheat = load_json(ROOT / "authoring/b1-cheatsheet-rows.json", [])
        prev = load_json(ROOT / "content/b1/items.json", [])
        self.prev_ids = {i["id"] for i in prev} if isinstance(prev, list) else set()


# ---------- pattern helpers ----------
def pat_tokens(p):
    return re.findall(r"\(\[[^\]]*\]\)|\[[^\]]*\]|\([^)]*\)|[^\s\[\]()]+", norm(p))


def fixed_words(p):
    return [t for t in pat_tokens(p) if not t.startswith(("(", "["))]


def m_search(answer, pattern):
    return bool(to_regex(pattern, SLOT_MAX).search(" " + norm(answer) + " "))


def m_anchored(answer, pattern):
    return bool(to_regex(pattern, SLOT_MAX, anchored=True).search(norm(answer)))


def m_item(answer, pattern, anywhere):
    return m_search(answer, pattern) if anywhere else m_anchored(answer, pattern)


def gap_base(prompt):
    return re.sub(r"\s*\([^()]*\)\s*$", "", prompt).strip()


def gap_fill(prompt, ans):
    b = gap_base(prompt)
    return b.replace(GAP, ans, 1) if GAP in b else None


def pattern_errors(p, where):
    errs = []
    if not isinstance(p, str) or not p.strip():
        return [f"{where}: empty pattern"]
    if p != p.lower():
        errs.append(f"{where}: write patterns in lowercase: {p!r} (the model carries the capitals)")
    if p.count("(") != p.count(")") or p.count("[") != p.count("]"):
        errs.append(f"{where}: unbalanced brackets in {p!r}")
    if re.search(r"[/|…]|\.\.\.", p):
        errs.append(f"{where}: {p!r} uses / | or …; write each variant as its own pattern and use [x] for free content")
    for g in re.findall(r"\(([^)]*)\)", p):
        if "[" in g and not re.fullmatch(r"\[[^\]]*\]", g.strip()):
            errs.append(f"{where}: {p!r}: an optional group holds words or one slot, not both: ({g})")
        if norm(g) in ("dass",):
            errs.append(f"{where}: {p!r}: don't make dass optional; write one pattern with dass (verb at the end) and one without (verb second)")
    if re.search(r"\[[^\]]*\[|\([^)]*\(", p):
        errs.append(f"{where}: nested brackets in {p!r}")
    if not fixed_words(p):
        errs.append(f"{where}: pattern {p!r} has no fixed words")
    return errs


def clause_end_error(p):
    """None, or why the pattern stops before the verb of its subordinate clause. 'slot' when it ends in a slot."""
    toks = pat_tokens(p)
    sub_at = [i for i, t in enumerate(toks) if (t if not t.startswith("(") else t[1:-1]).split() and
              any(w in SUBORD for w in (t if not t.startswith("(") else t[1:-1]).split())]
    # "Was meinst du damit": damit at the end or before a finite verb is an adverb; "wer lädt …": a question word
    sub_at = [i for i in sub_at if not (toks[i] == "damit" and (i == len(toks) - 1 or toks[i + 1] in FINITE))
              and not (toks[i] == "wer" and i == 0 and len(toks) > 1 and not toks[1].startswith(("(", "[")))]
    if not sub_at:
        return None
    last = toks[-1]
    if last.startswith("["):
        return "slot"
    if last.startswith("(["):
        return "slot"
    if last.startswith("("):
        return "ends with an optional group; end with the clause verb as a fixed word"
    if sub_at[-1] == len(toks) - 1:
        return f"stops at {last!r}"
    if last in NOT_VERB_END and last not in PARTICLES:
        return f"ends with {last!r}, which is not the clause verb"
    return None


# ---------- trap detectors (reference for detect.js; the engine runs them on every answer) ----------
FINITE = set(norm("""bin bist ist sind seid war warst waren habe hab hast hat haben habt hatte hatten kann kannst können
    könnt muss musst müssen will willst wollen soll sollst sollen darf darfst dürfen möchte möchtest möchten werde wirst
    wird werden würde würdest würden könnte könntest könnten hätte hättest hätten wäre wärst wären mag gibt geht kommt
    macht regnet passt klappt sollte sollten solltest wollte wollten konnte konnten musste mussten durfte durften
    mochte mochten wurde wurden gab ging kam""").split())
PRON = set(norm("ich du er sie es wir ihr man das dies jemand niemand").split())
DET = set(norm("der die das den dem des ein eine einen einem einer mein meine meinen dein deine sein seine ihr ihre unser unsere euer eure kein keine dieser diese dieses jede jeder jedes jeden alle viele manche einige beide meisten wenige").split())
SUB_DETECT = SUBORD - {"als", "bis", "seit", "wer"}
FRONTED = None
COMMA_OK = None
TIME_NOUNS = set(norm("abend morgen nachmittag mittag vormittag nacht wochenende anfang ende jahr woche monat").split())
WH = set(norm("wie warum wo wann was wer wohin woher womit wofür worüber worauf wovon welche welcher welches").split())
# a main clause that introduces an indirect question: "Mich würde interessieren, wie …", "Ich weiß nicht, wo …"
WH_FRAME = re.compile(r"\b(interessier\w*|wissen|weiss|weisst|weiß|weißt|frage|fragen|fragt|sag|sagen|sagt|erklaer\w*|erklär\w*|"
                      r"verstehe|verstehen|ahnung|unklar|sicher|ueberlegen|überlegen|zeig\w*)\b")
NONVERB = set(norm("""der die das den dem des ein eine einen einem einer eines mein meine meinen meinem dein deine sein seine
    ihr ihre unser unsere euer eure kein keine keinen dieser diese dieses diesen jede jeder jedes jeden alle viele manche
    einige beide ich du er sie es wir man mich dich sich uns euch ihnen ihm ihn mir dir an auf aus bei mit nach von vor zu
    in um über unter für gegen ohne durch nicht auch noch schon sehr gern gerne ganz mehr wieder immer oben unten heute
    morgen gestern hier dort dann denn aber oder und sondern""").split())


PARTICLES = set(norm("ab an auf aus ein mit vor zu zurück weg los fest teil statt vorbei hin her nach").split())


def clause_verbs(model):
    """The last word of each subordinate clause in the model: its finite verb (arbeiten muss -> muss)."""
    out = set()
    for clause in re.split(r"[,.;:!?]", model or ""):
        toks = norm(clause).split()
        if any(t in SUB_DETECT for t in toks[:-1]) and toks:
            out.add(toks[-1])
            for pre in sorted(PARTICLES, key=len, reverse=True):   # abhängt -> hängt (the verb without its particle)
                if toks[-1].startswith(pre) and len(toks[-1]) > len(pre) + 2:
                    out.add(toks[-1][len(pre):])
                    break
    return out


def detect(text, model=None):
    """Trap classes that fire on text: 'verb-final' (weil ich muss arbeiten), 'inversion' (Wenn ich Zeit habe, ich
    lerne), 'v2' (Am Ende, wir machen ...). A Python reference for detect.js, used to vet wrong examples."""
    global FRONTED
    out = set()
    fin = FINITE | clause_verbs(model)

    def subject_end(toks, j):
        """index after the subject that starts at j, or None"""
        if j >= len(toks):
            return None
        if toks[j] in DET and j + 1 < len(toks) and toks[j + 1] in PRON:
            return None  # "meinen Sie …": a verb, not a determiner
        if toks[j] in DET and j + 1 < len(toks) and toks[j + 1] not in fin:
            return j + 2
        if toks[j] in PRON or toks[j] in DET:
            return j + 1
        return None

    pieces = re.split(r"([,.;:!?])", text)
    for k in range(0, len(pieces), 2):
        clause = pieces[k]
        toks = norm(clause).split()
        before = pieces[k - 1] if k else ""
        if before == "," and len(toks) >= 3 and toks[0] in WH and WH_FRAME.search(norm(pieces[k - 2] if k >= 2 else "")):
            # "…, wie sieht deine Familie das": verb right after the question word, then a subject, verb not last
            v = toks[1]
            if (v in fin or FINITE_ANY(v)) and (toks[2] in PRON or toks[2] in DET) and not (toks[-1] in fin or FINITE_ANY(toks[-1])):
                out.add("verb-final")
        for i, t in enumerate(toks):
            if t == "als":   # only "als + subject + finite verb + more": "als ich habe die Nachricht bekommen"
                j = subject_end(toks, i + 1)
                if j is not None and j < len(toks) - 1 and toks[j] in fin and any(r not in fin for r in toks[j + 1:]):
                    out.add("verb-final")
                continue
            if t not in SUB_DETECT:
                continue
            # a finite verb 1-4 words after the subordinator (after a subject or a phrase like "bei dir") that is not
            # the clause's last word: "weil ich muss arbeiten", "dass bei dir ist alles gut"
            if i + 1 < len(toks) and toks[i + 1] in FINITE:
                continue  # "Damit bin ich …": an adverb, not a clause
            for j in range(i + 1, min(i + 5, len(toks) - 1)):
                if toks[j] in SUB_DETECT:
                    break
                rest = toks[j + 1:]
                if toks[j] in fin and rest[0] not in ("oder", "und", "aber") and any(r not in fin for r in rest):
                    out.add("verb-final")
                    break
            # separable verb split in the clause: "dass es hängt von der Firma ab"
            cl = toks[i + 1:]
            if len(cl) >= 3 and cl[-1] in PARTICLES and any(c in fin or FINITE_ANY(c) for c in cl[1:-1]):
                out.add("verb-final")
    for sent in re.split(r"(?<=[.!?])\s+", text.strip()):
        # "Wer hat Fragen, kann …" (a wer-clause before a comma, not a question): the verb goes to the end
        head = norm(sent.split(",", 1)[0]).split()
        if "," in sent and not sent.rstrip().endswith("?") and len(head) >= 3 and head[0] == "wer" \
                and head[1] in fin and any(r not in fin for r in head[2:]):
            out.add("verb-final")
        parts = sent.split(",", 1)
        # "Wer Fragen hat, er kann …": the second clause picks up wer with der, not er/sie
        if len(parts) == 2 and not sent.rstrip().endswith("?") and len(head) >= 2 and head[0] == "wer":
            r2 = norm(parts[1]).split()
            if len(r2) >= 2 and r2[0] in ("er", "sie"):
                out.add("wer-der")
        if len(parts) == 2 and norm(parts[0]).split()[:1] and norm(parts[0]).split()[0] in SUB_DETECT \
                and "oder nicht" not in norm(parts[0]):
            rest = norm(parts[1]).split()
            j = subject_end(rest, 0)
            if j is not None and j < len(rest) and rest[j] in fin | FINITE_ANY(rest[j]):
                out.add("inversion")
            elif len(rest) >= 2 and rest[0] in PRON and rest[0] != "das" and rest[1] in ("meine", "meinst", "meint", "meinen"):
                out.add("inversion")  # "Wenn …, Sie meinen"
    global COMMA_OK
    if FRONTED is None:
        plan = load_json(ROOT / "content/b1/plan.json")
        v2 = next(t for t in plan["traps"] if t["id"] == "v2")
        FRONTED = sorted({norm(f) for f in v2["fronted"]}, key=len, reverse=True)
        COMMA_OK = {norm(f) for f in v2.get("comma_ok", [])}
    for sent in re.split(r"(?<=[.!?])\s+", text.strip()):
        n = norm(sent)
        for f in FRONTED:
            if n.startswith(f + " "):
                if f in COMMA_OK and re.match(r"\s*\S+(\s+\S+){%d}\s*," % (len(f.split()) - 1), sent):
                    after = norm(sent.split(",", 1)[1]).split()
                    if len(after) >= 3 and after[0] == "es" and after[1] in fin:
                        out.add("v2")  # "Natürlich, es ist …"
                    break  # "Natürlich, das stimmt.": a comma starts a new clause
                rest = n[len(f):].split()
                raw = re.findall(r"[\w'-]+", sent)[len(f.split()):]
                j = subject_end(rest, 0)
                if j is None and raw and raw[0][:1].isupper() and rest and rest[0] not in TIME_NOUNS:
                    j = 1  # a bare noun or name as the subject: "Einerseits Online-Lernen ist …"
                # a pronoun subject then a verb is always wrong; after "der Woche" or a noun, a pronoun after the verb
                # means the verb was second after all ("Am Ende der Woche war es …", "Heute Abend gehe ich …")
                if j is not None and j < len(rest) and (rest[j] in fin or FINITE_ANY(rest[j])) and \
                        (rest[0] in PRON or not (j + 1 < len(rest) and rest[j + 1] in PRON)):
                    out.add("v2")
                break
    return out


def FINITE_ANY(w):
    """A loose finite-verb guess for main clauses after a subject: lerne, machen, arbeitet (never an article,
    pronoun or preposition, never -ung, -heit ...)."""
    return {w} if w not in NONVERB and re.fullmatch(r"[a-z]{2,}(e|st|t|en|n)", w) and not re.search(r"(ung|heit|keit|lein)$", w) else set()


# ---------- model case ----------
def model_case_errors(model, ctx, where):
    errs = []
    s = model.strip().lstrip("„\"'¿¡(").strip()
    if s and s[0].isalpha() and not s[0].isupper():
        errs.append(f"{where}: model should start with a capital letter: {model!r}")
    if model == model.lower() and re.search(r"[a-zäöü]{4}", model):
        errs.append(f"{where}: model is all lowercase; it is the case reference for the capitals check")
    toks = list(re.finditer(r"[A-Za-zÄÖÜäöüß]+", model))
    for k, m in enumerate(toks):
        w = m.group(0)
        if k == 0 or re.search(r"[.!?:„\"]\s*$", model[:m.start()]):
            continue
        if w[0].islower() and w[0].upper() + w[1:] in ctx.nouns and w not in ctx.lower_ok:
            errs.append(f"{where}: model has {w!r} in lowercase, but {w[0].upper() + w[1:]!r} is a noun; nouns take a capital")
    return errs


# ---------- one item ----------
def check_item(it, ctx, where):
    E, W = [], []
    if not isinstance(it, dict):
        return [f"{where}: item is not an object"], W
    iid = it.get("id", "?")
    at = f"{where} {iid}"
    missing = [k for k in KEYS if k not in it]
    if missing:
        E.append(f"{at}: missing keys {missing}")
        return E, W
    extra = set(it) - set(KEYS) - OPTIONAL_KEYS
    if extra:
        E.append(f"{at}: unknown keys {sorted(extra)}")
    kind = it["kind"]
    if kind not in KIND_PREFIX:
        return E + [f"{at}: kind must be one of {list(KIND_PREFIX)}"], W
    if not isinstance(iid, str) or not re.fullmatch(r"(BP|BT|BR|BG|BL):[a-z0-9-]+", iid):
        E.append(f"{at}: id must look like BP:lowercase-words")
    elif not iid.startswith(KIND_PREFIX[kind] + ":"):
        E.append(f"{at}: kind {kind} needs the id prefix {KIND_PREFIX[kind]}:")
    area = it["area"]
    if area != KIND_AREA[kind]:
        E.append(f"{at}: kind {kind} goes in area {KIND_AREA[kind]!r}")
    grp, teil, fn = it["group"], it["teil"], it["fn"]
    if area == "speaking":
        if grp not in SPEAK_GROUPS:
            E.append(f"{at}: speaking group must be one of {SPEAK_GROUPS}")
        elif teil not in GROUP_TEILE[grp]:
            E.append(f"{at}: group {grp} needs teil in {GROUP_TEILE[grp]}")
        if fn not in ctx.fns:
            E.append(f"{at}: fn {fn!r} is not a function id (priority_de.json or plan.json functions)")
        else:
            for pre, ok in FN_TEIL:
                if fn.startswith(pre) and teil not in ok:
                    E.append(f"{at}: fn {fn} belongs to {ok}, not teil {teil}")
    elif area == "reading":
        if grp not in READ_GROUPS:
            E.append(f"{at}: reading group must be one of {READ_GROUPS}")
        if teil not in TEILE["reading"]:
            E.append(f"{at}: reading teil must be one of {TEILE['reading']}")
        if fn is not None:
            E.append(f"{at}: fn is null for reading items")
    elif area == "grammar":
        if grp not in ctx.topics:
            E.append(f"{at}: grammar group must be a plan.json topic id, not {grp!r}")
        if teil is not None or fn is not None:
            E.append(f"{at}: teil and fn are null for grammar items")
    for k in ("star", "anywhere"):
        if not isinstance(it[k], bool):
            E.append(f"{at}: {k} must be true or false")
    trap = it["trap"]
    if trap is not None and trap not in TRAPS:
        E.append(f"{at}: trap must be null or one of {TRAPS}")
    focus = it["focus"]
    if not isinstance(focus, list) or not focus or any(f not in FOCUS for f in focus):
        E.append(f"{at}: focus must be a non-empty list from {FOCUS}")
        focus = [f for f in focus if f in FOCUS] if isinstance(focus, list) else []
    if trap and trap not in focus:
        E.append(f"{at}: focus must include the trap {trap!r}")
    if it["plan"] not in PLANS:
        E.append(f"{at}: plan must be one of {PLANS}")
    if it["level"] not in LEVELS:
        E.append(f"{at}: level must be one of {LEVELS}")
    if it["chunk"] is not None and it["chunk"] not in ctx.chunk_ids:
        E.append(f"{at}: chunk {it['chunk']!r} is not an Igloo chunk id")
    for k in ("prompt", "rule", "src"):
        if not isinstance(it[k], str) or not it[k].strip():
            E.append(f"{at}: {k} must be a non-empty string")
    if E:
        return E, W
    prompt, hl, model, task = it["prompt"], it["hl"], it["model"], it["task"]
    mine = it["src"].startswith("mine")
    # --- prompt ---
    if len(prompt) > 160:
        E.append(f"{at}: prompt is {len(prompt)} characters (max 160)")
    for k in ("prompt", "hl", "rule", "task", "model", "partner"):
        if isinstance(it[k], str) and "—" in it[k]:
            E.append(f"{at}: no em dashes in {k}")
    if it["prompt_lang"] not in ("en", "de"):
        E.append(f"{at}: prompt_lang must be en or de")
    for k in ("prompt", "hl"):
        if isinstance(it[k], str):
            m = HINT_RE.search(it[k])
            if m and not (area == "reading" and m.group(0).lower().startswith("article")):
                E.append(f"{at}: {k} contains the grammar word {m.group(0)!r}; prompts carry meaning only (put the cue in task)")
    if it["prompt_lang"] == "en":
        if re.search(r"[äöüßÄÖÜ„“]", prompt):
            E.append(f"{at}: English prompt contains German characters")
        if isinstance(model, str):
            de = [t.lower() for t in re.findall(r"[A-Za-zäöüß]{4,}", model)]
            en = [t.lower() for t in re.findall(r"[A-Za-z]{4,}", prompt)]
            shared = [t for t in en if t in de and t not in LOANS]
            pairs = [(a, b) for a, b in zip(en, en[1:]) if a in de and b in de and a not in LOANS and b not in LOANS]
            if pairs:
                E.append(f"{at}: English prompt contains German from the answer: {' '.join(pairs[0])!r}")
            elif shared:
                W.append(f"{at}: English prompt shares the word {shared[0]!r} with the model (fine if it's a name or loanword)")
    if hl is not None:
        if not isinstance(hl, str) or hl not in prompt:
            E.append(f"{at}: hl must be an exact substring of prompt")
        if kind in ("topic", "reply", "reading"):
            E.append(f"{at}: hl is null for {kind} items")
        if kind == "grammar" and it["prompt_lang"] != "en":
            E.append(f"{at}: hl on a grammar item only with an English prompt")
    elif kind == "phrase":
        E.append(f"{at}: phrase items need hl (the graded part of the prompt)")
    if it["partner"] is not None and kind not in ("topic", "reply"):
        E.append(f"{at}: partner is only for topic and reply items")
    if it["prefill"] is not None and kind != "grammar":
        E.append(f"{at}: prefill is only for grammar items")
    if kind == "grammar" and not (isinstance(task, str) and task.strip()):
        E.append(f"{at}: grammar items need a task line")
    if isinstance(it["rule"], str):
        r = it["rule"]
        if len(r) > 160 or re.search(r"[.!?]\s+[A-ZÄÖÜ]", r.rstrip()):
            E.append(f"{at}: rule must be one short sentence: {r!r}")
    strict = it["strict"]
    if not isinstance(strict, list) or not all(isinstance(s, str) for s in strict):
        E.append(f"{at}: strict must be a list of words")
        strict = []
    wrong = it["wrong"]
    if not isinstance(wrong, list) or not all(isinstance(w, str) and w.strip() for w in wrong):
        E.append(f"{at}: wrong must be a list of sentences")
        wrong = []
    if (trap or set(focus) & NEEDS_WRONG or mine) and not wrong:
        E.append(f"{at}: needs at least one wrong (the mistake he actually makes), because of trap/focus{' or src mine' if mine else ''}")
    if mine:
        if it["prompt_lang"] != "en":
            E.append(f"{at}: items from his own mistakes are English → German (never show his wrong German)")
        if any(norm(w) in norm(prompt) for w in wrong):
            E.append(f"{at}: the prompt must not show his wrong sentence")

    # --- reply ---
    if kind == "reply":
        moves = it.get("moves")
        if it["accept"] != [] or it["model"] is not None:
            E.append(f"{at}: reply items keep accept [] and model null; patterns go in moves")
        if not isinstance(moves, list) or [(m.get("key"), m.get("label")) for m in moves if isinstance(m, dict)] != MOVES:
            E.append(f"{at}: moves must be three objects with key/label {MOVES}")
            return E, W
        if it.get("wrong_move") not in [k for k, _ in MOVES]:
            E.append(f"{at}: wrong_move must name the move whose patterns the wrong answer is tested against")
        if not it["partner"]:
            E.append(f"{at}: reply items need the partner's line")
        for m in moves:
            mw = f"{at} move {m.get('key')}"
            if m.get("fn") not in ctx.fns:
                E.append(f"{mw}: fn {m.get('fn')!r} is not a function id")
            acc = m.get("accept")
            if not isinstance(acc, list) or not 2 <= len(acc) <= 8:
                E.append(f"{mw}: 2-8 patterns")
                continue
            for p in acc:
                E += pattern_errors(p, mw)
            if not isinstance(m.get("model"), str) or not m["model"].strip():
                E.append(f"{mw}: model missing")
                continue
            E += model_case_errors(m["model"], ctx, mw)
            if detect(m["model"], m["model"]):
                E.append(f"{mw}: model {m['model']!r} trips the {sorted(detect(m['model'], m['model']))} detector")
            if not any(pattern_errors(acc[0], mw)) and not m_search(m["model"], acc[0]):
                E.append(f"{mw}: model {m['model']!r} does not match accept[0] {acc[0]!r}")
            E += dass_variant_errors(acc, mw)
            for p in acc:
                ce = clause_end_error(p)
                if ce and ce != "slot":
                    E.append(f"{mw}: pattern {p!r} {ce}")
                elif ce == "slot" and "verb-final" not in focus:
                    E.append(f"{mw}: pattern {p!r} ends in a slot after a subordinator; add verb-final to focus and a wrong with the verb second")
        wm = next((m for m in moves if m.get("key") == it.get("wrong_move")), None)
        if wm and isinstance(wm.get("accept"), list):
            for w in wrong:
                hit = [p for p in wm["accept"] if not pattern_errors(p, "") and m_search(w, p)]
                if hit and not (detect(w, " ".join(m.get("model") or "" for m in moves)) & set(focus)):
                    E.append(f"{at}: wrong {w!r} matches {hit[0]!r} of move {wm['key']}; a wrong answer must match no pattern of its move, or trip a trap detector in its focus")
        return E, W

    # --- patterns ---
    acc = it["accept"]
    lo = 3 if kind == "topic" else 1
    if not isinstance(acc, list) or not lo <= len(acc) <= 8:
        E.append(f"{at}: accept needs {lo}-8 patterns")
        return E, W
    if kind == "phrase" and len(acc) < 2:
        W.append(f"{at}: only one pattern; add du/Sie, word-order and synonym variants if they exist")
    for p in acc:
        E += pattern_errors(p, at)
    if len({norm(p) for p in acc}) != len(acc):
        E.append(f"{at}: duplicate patterns")
    if any(e.startswith(at + ":") and "pattern" in e for e in E):
        return E, W
    gap = kind in ("grammar", "reading") and GAP in prompt
    if kind in ("grammar", "reading") and prompt.count(GAP) > 1:
        E.append(f"{at}: a gap prompt has exactly one ___")
    anywhere = it["anywhere"]
    if kind == "topic":
        if not anywhere or it["plan"] != "choice" or hl is not None:
            E.append(f"{at}: topic items: anywhere true, plan choice, hl null")
        if "word-choice" not in focus:
            E.append(f"{at}: topic items have word-choice in focus")
        if it["partner"] is None and teil not in ("S2",):
            W.append(f"{at}: no partner line (only Teil 2 items usually have none)")
    if gap and anywhere:
        E.append(f"{at}: gap items are anywhere false")
    if it["prefill"] is not None and anywhere:
        E.append(f"{at}: items with prefill grade the whole answer: anywhere false")

    # clause-end rule
    for p in acc:
        ce = clause_end_error(p)
        if ce == "slot":
            if kind != "topic":
                E.append(f"{at}: pattern {p!r} ends in a slot after a subordinator; end it with the clause verb ([x] in the middle only)")
            elif "verb-final" not in focus or not wrong:
                E.append(f"{at}: topic pattern {p!r} ends in [x] after a subordinator; add verb-final to focus and a wrong with the verb second")
        elif ce:
            E.append(f"{at}: pattern {p!r} {ce}; a pattern with dass/weil/wenn/ob/... must end with the clause verb")
    E += dass_variant_errors(acc, at, it)

    # model
    if not isinstance(model, str) or not model.strip():
        E.append(f"{at}: model missing")
        return E, W
    E += model_case_errors(model, ctx, at)
    if gap:
        f = gap_fill(prompt, acc[0])
        if norm(model) != norm(f or ""):
            E.append(f"{at}: model must be the prompt with accept[0] in the gap: {f!r}")
        answers_ok = lambda ans: any(norm(ans) == norm(a) or norm(ans) == norm(gap_fill(prompt, a) or "") for a in acc) or \
            any(m_anchored(ans, a) or m_anchored(ans, gap_fill(prompt, a) or a) for a in acc)
    else:
        if it["prefill"] is not None:
            pf = it["prefill"]
            if not model.startswith(pf):
                E.append(f"{at}: model must start with the prefill {pf!r}")
            for p in acc:
                if not norm(p).startswith(norm(pf)):
                    E.append(f"{at}: pattern {p!r} must start with the prefill words ({norm(pf)!r}); accept holds whole answers")
        if not m_item(model, acc[0], anywhere):
            E.append(f"{at}: model {model!r} does not match accept[0] {acc[0]!r}" + ("" if anywhere else " (whole answer)"))
        else:
            E += slot_flex_errors(model, acc[0], anywhere, at)
        answers_ok = lambda ans: any(m_item(ans, p, anywhere) for p in acc)
    # the trap detectors run on every answer, so the model must not trip them, and a trap's wrong should
    fired = detect(model, model)
    if fired:
        E.append(f"{at}: model {model!r} trips the {sorted(fired)} detector; reword it (or report a detector bug)")
    for w in wrong:
        cls = {c for c in (trap, *focus) if c in ("verb-final", "v2", "inversion")}
        if cls and not (detect(w, model) & (cls | {"verb-final", "v2", "inversion"})):
            W.append(f"{at}: wrong {w!r} doesn't trip the {sorted(cls)} detector; make sure it's his real mistake (verb in the wrong place)")
    # strict words are in the model
    mwords = re.findall(r"[\wäöüßÄÖÜ'-]+", model)
    for s in strict:
        if s not in mwords and not (mwords and s.lower() == mwords[0].lower()):
            E.append(f"{at}: strict word {s!r} is not in model (case-sensitive)")
    # wrong answers
    capitems = "cap" in focus or trap == "cap"
    for w in wrong:
        if norm(w) == norm(model) and not capitems:
            E.append(f"{at}: wrong {w!r} is the model")
            continue
        if answers_ok(w):
            if capitems and case_only_diff(w, model, strict, ctx):
                continue  # the matcher ignores case; match.js checks capitals against the cased model
            if kind == "topic" and (detect(w, model) & set(focus)):
                continue  # free [x] content: the trap detector (run on every answer) catches it
            E.append(f"{at}: wrong {w!r} matches a pattern; a wrong answer must match no pattern"
                     + (" (or, for a topic item, must trip a trap detector in its focus)" if kind == "topic" else ""))
    if capitems and wrong and not any(case_only_diff(w, model, strict, ctx) or not answers_ok(w) for w in wrong):
        E.append(f"{at}: cap item needs a wrong that differs from the model in capitals")
    return E, W


def case_only_diff(w, model, strict, ctx):
    """True when w is the model with a noun (or a strict word) written in the wrong case."""
    a, b = re.findall(r"[\wäöüßÄÖÜ]+", w), re.findall(r"[\wäöüßÄÖÜ]+", model)
    if len(a) != len(b) or [x.lower() for x in a] != [x.lower() for x in b]:
        return False
    diffs = [(x, y) for i, (x, y) in enumerate(zip(a, b)) if x != y and i > 0]
    return bool(diffs) and all(y in strict or (y[0].isupper() and (y in ctx.nouns or y.lower() not in ctx.lower_ok)) for _, y in diffs)


def dass_variant_errors(acc, at, it=None):
    """Opinion verb + dass needs the no-dass variant (Ich glaube, das ist ...), unless the task names dass."""
    if it is not None:
        if "dass" in norm(it.get("task") or "") or "dass" in norm(it.get("prefill") or ""):
            return []
    errs = []
    for v in OPINION_VERBS:
        with_dass = [p for p in acc if re.search(rf"\b{v}\b(?:\s+\([^)]*\))*\s+dass\b", norm(p))]
        if with_dass and not any(re.search(rf"\b{v}\b", norm(p)) and not re.search(r"\bdass\b", norm(p)) for p in acc):
            errs.append(f"{at}: {with_dass[0]!r}: add the variant without dass, verb second (ich {v} das ist ...); both are correct")
    return errs


def slot_flex_errors(model, pat, anywhere, at):
    """Slot content may be 8 words long, and an optional slot may be empty."""
    rx = to_regex(pat, SLOT_MAX, anchored=not anywhere, groups=True)
    s = norm(model) if not anywhere else " " + norm(model) + " "
    m = rx.search(s)
    if not m or not m.groupdict():
        return []
    errs = []
    toks = pat_tokens(pat)
    opt = [t.startswith("([") for t in toks if t.startswith(("[", "(["))]
    for fill in ("long", "empty"):
        out, pos = "", 0
        for k, (name, val) in enumerate(sorted(m.groupdict().items(), key=lambda kv: int(kv[0][1:]))):
            if val is None:
                continue
            st, en = m.span(name)
            if fill == "empty" and not opt[k]:
                rep = val
            else:
                rep = "" if fill == "empty" else " ".join(f"xq{j}" for j in range(8))
            out += s[pos:st] + rep
            pos = en
        out += s[pos:]
        out = " ".join(out.split())
        if not m_item(out, pat, anywhere):
            errs.append(f"{at}: accept[0] {pat!r} fails when the slot content is {'8 words' if fill == 'long' else 'empty'}")
    return errs


# ---------- annotation files ----------
ANNOT_KEYS = {"topic", "trap", "focus", "strict", "wrong", "rule", "skip", "why"}


def check_annot(data, ctx, where):
    E, W = [], []
    if not isinstance(data, dict):
        return [f"{where}: an annotation file is an object keyed by G:<item id>"], W
    for k, a in data.items():
        at = f"{where} {k}"
        gid = k[2:] if k.startswith("G:") else None
        g = ctx.gitems.get(gid)
        if not g:
            E.append(f"{at}: not an item id in items_de.json (keys look like G:dass-saetze.01)")
            continue
        if not isinstance(a, dict) or set(a) - ANNOT_KEYS or "skip" not in a:
            E.append(f"{at}: keys are {sorted(ANNOT_KEYS)}, skip required")
            continue
        if a["skip"]:
            if not a.get("why"):
                E.append(f"{at}: skip needs a why")
            continue
        if a.get("topic") not in ctx.topics:
            E.append(f"{at}: topic must be a plan.json topic id")
        elif g["concept"] not in ctx.topics[a["topic"]]["concepts"]:
            W.append(f"{at}: concept {g['concept']} is not listed under topic {a['topic']}")
        trap, focus = a.get("trap"), a.get("focus") or []
        if trap is not None and trap not in TRAPS:
            E.append(f"{at}: trap must be null or one of {TRAPS}")
        if any(f not in FOCUS for f in focus):
            E.append(f"{at}: focus words must come from {FOCUS}")
        wrong = a.get("wrong") or []
        if (trap or set(focus) & NEEDS_WRONG) and not wrong:
            E.append(f"{at}: needs at least one wrong (trap/focus set)")
        ans = g["answer"] if isinstance(g["answer"], list) else [g["answer"]]
        forms = set()
        for x in ans:
            forms.add(norm(x))
            f = gap_fill(g["prompt"], x)
            if f:
                forms.add(norm(f))
        for w in wrong:
            if norm(w) in forms and not ("cap" in focus or trap == "cap"):
                E.append(f"{at}: wrong {w!r} equals an accepted answer")
        allw = " ".join(ans + [gap_fill(g["prompt"], x) or "" for x in ans])
        for s in a.get("strict") or []:
            if s not in re.findall(r"[\wäöüßÄÖÜ'-]+", allw):
                E.append(f"{at}: strict word {s!r} is not in any answer (case-sensitive)")
        if a.get("rule") and (len(a["rule"]) > 160 or re.search(r"[.!?]\s+[A-ZÄÖÜ]", a["rule"].rstrip())):
            E.append(f"{at}: rule must be one short sentence")
    return E, W


# ---------- files ----------
def check_file(path, ctx, seen):
    path = Path(path)
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return None, [f"{path.name}: not valid JSON: {e}"], []
    if path.name.endswith("-annot.json"):
        E, W = check_annot(data, ctx, path.name)
        return data, E, W
    if not isinstance(data, list):
        return None, [f"{path.name}: an item file is a JSON array"], []
    E, W = [], []
    for i, it in enumerate(data):
        e, w = check_item(it, ctx, f"{path.name}[{i}]")
        E += e
        W += w
    E += js_check(data, path.name)
    for i, it in enumerate(data):
        iid = it.get("id") if isinstance(it, dict) else None
        if iid in seen:
            E.append(f"{path.name}[{i}] {iid}: duplicate id (also in {seen[iid]})")
        elif iid:
            seen[iid] = path.name
    return data, E, W


def js_check(data, name):
    """The app grades with match.js (typo tolerance, umlauts, strict words): run every model and wrong through it."""
    import subprocess, shutil
    if not shutil.which("node"):
        return []
    r = subprocess.run(["node", str(Path(__file__).resolve().parent / "b1_jscheck.mjs")], input=json.dumps(data),
                       capture_output=True, text=True)
    if r.returncode:
        return [f"{name}: the app-matcher check failed: {r.stderr.strip()[:300]}"]
    return [f"{name}[{i}] {data[i].get('id', '?')}: {msg}" for i, msg in json.loads(r.stdout or "[]")]


def coverage(items, ctx):
    rows = [r for r in ctx.cheat if r.get("sec") in (2, 3, 4, 5, 6, 10, 11)]
    if not rows:
        return
    toks = lambda s: set(re.findall(r"[a-zäöüß]{3,}", unicodedata.normalize("NFC", s or "").lower()))
    out = []
    for r in rows:
        rt = toks(r["de"])
        best = 0
        for it in items:
            if f"§{r['sec']}" not in it.get("src", "") and not it.get("src", "").startswith("mine"):
                continue
            texts = [it.get("model") or ""] + [m.get("model", "") for m in it.get("moves") or []] + [it.get("prompt") or ""]
            for t in texts:
                if rt:
                    best = max(best, len(rt & toks(t)) / len(rt))
        if best < 0.6:
            out.append(r)
    stars = [r for r in out if r.get("star") and r["sec"] in (3, 4, 5, 6, 10)]
    print(f"coverage: {len(rows) - len(out)} of {len(rows)} cheatsheet rows (sec 2-6, 10, 11) have an item; "
          f"{len(stars)} ★ rows in sec 3-6, 10 uncovered")
    for r in stars[:40]:
        print(f"  uncovered ★ §{r['sec']} {r['de'][:80]}")


def report(items):
    from collections import Counter
    c = Counter((i["area"], i["group"]) for i in items if isinstance(i, dict) and "area" in i)
    print("by area/group:", ", ".join(f"{a}/{g} {n}" for (a, g), n in sorted(c.items())))
    t = Counter(i.get("trap") for i in items if isinstance(i, dict) and i.get("trap"))
    print("by trap:", dict(t), "· star:", sum(1 for i in items if isinstance(i, dict) and i.get("star")),
          "· mine:", sum(1 for i in items if isinstance(i, dict) and str(i.get("src", "")).startswith("mine")))


def run(paths, ctx, assemble=False, cover=False):
    seen, errs, items, annot = {}, 0, [], {}
    for p in paths:
        data, E, W = check_file(p, ctx, seen)
        for w in W:
            print("WARN ", w)
        for e in E:
            print("ERROR", e)
        errs += len(E)
        n = len(data) if data is not None else 0
        print(f"{Path(p).name}: {n} {'annotations' if str(p).endswith('-annot.json') else 'items'}, {len(E)} error(s), {len(W)} warning(s)")
        if isinstance(data, list):
            items += data
        elif isinstance(data, dict):
            dup = set(data) & set(annot)
            if dup:
                print(f"ERROR {Path(p).name}: annotations also in another file: {sorted(dup)[:5]}")
                errs += 1
            annot.update(data)
    if cover or assemble:
        gone = ctx.prev_ids - set(seen)
        if gone and assemble:
            print(f"ERROR ids in content/b1/items.json that no src file has any more (ids are stable): {sorted(gone)[:10]}")
            errs += 1
        if items:
            report(items)
        coverage(items, ctx)
    if assemble and not errs:
        (ROOT / "content/b1/items.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")) + "\n")
        (ROOT / "content/b1/annot.json").write_text(json.dumps(annot, ensure_ascii=False, separators=(",", ":")) + "\n")
        print(f"wrote content/b1/items.json ({len(items)} items) and content/b1/annot.json ({len(annot)} annotations)")
    print(f"{errs} error(s)")
    return errs


# ---------- self test ----------
def selftest(ctx):
    fx = json.loads((ROOT / "tests/fixtures/b1-sample-items.json").read_text())
    seen = {}
    bad = 0
    for i, it in enumerate(fx):
        e, _ = check_item(it, ctx, f"sample[{i}]")
        if e:
            print("FAIL good fixture has errors:", e)
            bad += 1
        seen[it["id"]] = 1
    good = fx[0]  # a verb-final phrase item

    def expect(mut, needle, label):
        nonlocal bad
        it = json.loads(json.dumps(good))
        mut(it)
        e, _ = check_item(it, ctx, "case")
        if not any(needle in x for x in e):
            print(f"FAIL {label}: expected an error containing {needle!r}, got {e}")
            bad += 1

    expect(lambda it: it["accept"].append("ich schlage vor dass wir [x]"), "subordinator", "pattern ends in a slot after dass")
    expect(lambda it: it["accept"].append("ich schlage vor dass"), "stops at", "pattern stops at dass")
    expect(lambda it: it["accept"].append("ich schlage vor dass wir uns"), "not the clause verb", "pattern ends with a pronoun")
    expect(lambda it: it.update(prompt=it["prompt"] + " (verb at the end)"), "grammar word", "grammar hint in prompt")
    expect(lambda it: it.update(wrong=[it["model"].replace("treffen.", "").replace("uns", "uns treffen")]), "matches a pattern", "a wrong that matches")
    expect(lambda it: it.update(hl="Let us meet"), "substring", "hl not in prompt")
    expect(lambda it: it.update(model=it["model"].lower()), "capital", "uncased model")
    expect(lambda it: it.update(model=it["model"].replace("Bahnhof", "bahnhof")), "noun", "lowercase noun in model")
    expect(lambda it: it.update(prompt="I suggest — that we meet at the station."), "em dash", "em dash")
    expect(lambda it: it.update(trap="verb-final", wrong=[]), "needs at least one wrong", "trap without wrong")
    expect(lambda it: it.update(accept=["ich glaube dass das eine gute idee ist"], model="Ich glaube, dass das eine gute Idee ist.",
                                hl=it["prompt"].rstrip(".")), "without dass", "no-dass variant missing")
    expect(lambda it: it.update(accept=["ich glaube (dass) das eine gute idee ist"]), "optional", "optional dass")
    expect(lambda it: it.update(accept=["Ich Schlage vor"]), "lowercase", "uppercase pattern")
    expect(lambda it: it.update(accept=["du / sie"]), "/", "slash in pattern")
    expect(lambda it: it.update(id="BG:x"), "prefix", "id prefix")
    expect(lambda it: it.update(src="mine: Tag 1", prompt_lang="de"), "English", "mine item with a German prompt")
    reply = next(x for x in fx if x["kind"] == "reply")

    def expect_r(mut, needle, label):
        nonlocal bad
        it = json.loads(json.dumps(reply))
        mut(it)
        e, _ = check_item(it, ctx, "case")
        if not any(needle in x for x in e):
            print(f"FAIL {label}: expected {needle!r}, got {e}")
            bad += 1
    expect_r(lambda it: it.update(wrong=["Das ist zwar eine gute Idee, aber ich habe keine Zeit."]), "matches", "reply wrong matches its move")
    expect_r(lambda it: it.update(wrong_move="nope"), "wrong_move", "reply wrong_move")
    # matcher: optional slot and 10-word slots
    from validate_accept import matches
    assert matches("ich schlage vor dass wir uns treffen", "ich schlage vor dass wir uns ([x]) treffen", 10)
    assert matches("ich schlage vor dass wir uns am samstag treffen", "ich schlage vor dass wir uns ([x]) treffen", 10)
    assert matches("das ist eine sehr sehr sehr sehr sehr sehr gute idee", "das ist [x] idee", 10)
    assert not matches("das ist eine sehr sehr sehr sehr sehr sehr gute idee", "das ist [x] idee", 6)
    for w, cls in [("Ich hoffe, dass bei dir ist alles gut.", "verb-final"), ("Ich war froh, als ich habe die Nachricht bekommen.", "verb-final"),
                   ("Wer hat Fragen, kann mich anrufen.", "verb-final"), ("Mich würde interessieren, wie sieht deine Familie das?", "verb-final"),
                   ("Tatsächlich ich habe keine Zeit.", "v2"), ("Einerseits Online-Lernen ist praktisch.", "v2"), ("Ich denke, dass es hängt von der Firma ab.", "verb-final"), ("Das geht nicht, weil ich muss arbeiten.", "verb-final"),
                   ("Ich glaube, dass das ist gut.", "verb-final"), ("Am Ende, wir machen eine Party.", "v2"),
                   ("Wenn ich Zeit habe, ich lerne.", "inversion")]:
        if cls not in detect(w):
            print(f"FAIL detector misses {cls}: {w}")
            bad += 1
    for ok in ["Ich hoffe, dass bei dir alles gut ist.", "Das geht nicht, weil ich arbeiten muss.", "Am Ende machen wir eine Party.",
               "Wenn ich Zeit habe, lerne ich.", "Wir fahren an den Strand, egal ob es regnet oder nicht.",
               "Ich denke, dass es von der Firma abhängt.", "Damit bin ich am Ende meiner Präsentation.",
               "Ich bin der Meinung, dass Rauchen verboten werden sollte.", "Er ist größer als ich.", "Als Lehrer arbeite ich viel.",
               "Wer hat Fragen?", "Wer Fragen hat, kann mich anrufen.", "Ich war froh, als ich die Nachricht bekommen habe.",
               "Wenn ich Sie richtig verstehe, meinen Sie die Kosten?", "Wir könnten grillen, was meinst du?",
               "Natürlich, das stimmt.", "Mich würde interessieren, wie deine Familie das sieht.", "Was meinst du damit?",
               "Am Ende der Woche war es schön.", "Heute Abend gehe ich ins Kino.", "Ich weiß nicht, wie lange du arbeitest."]:
        if detect(ok, ok):
            print(f"FAIL detector fires on a right sentence: {ok} {detect(ok, ok)}")
            bad += 1
    print("selftest:", "ok" if not bad else f"{bad} failure(s)")
    return bad


def main():
    args = sys.argv[1:]
    ctx = Ctx()
    if not args:
        print(__doc__)
        sys.exit(2)
    if args[0] == "--selftest":
        sys.exit(1 if selftest(ctx) else 0)
    if args[0] in ("--all", "--assemble"):
        paths = sorted(SRC.glob("*.json"))
        sys.exit(1 if run(paths, ctx, assemble=args[0] == "--assemble", cover=True) else 0)
    sys.exit(1 if run(args, ctx) else 0)


if __name__ == "__main__":
    main()
