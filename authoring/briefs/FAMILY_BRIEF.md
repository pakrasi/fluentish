# Word families: authoring brief (round 7)

The learner studies German daily (B1 now, lifelong). Two games use this content: **Word family** (a root and every
form made from it, with meaning, example, stress, split or not) and **Today's family** (a daily puzzle: he sees a clue
and builds the word from prefix and ending tiles). He will learn hundreds of words from it, so **correctness comes
before everything**. A wrong article, a wrong split, a gloss that misleads, or a real word called "not a word" teaches
him wrong German for years.

Read first: `content/build/FAMILY-SCHEMA.md` (the data shape), `authoring/build/families/stellen.json` (the worked
example), `authoring/build/particles.de.json` (prefix ids you may use besides `content/build/de.json` prefixes).

## What you write: `authoring/build/families/<root>.json`
- `stems`: every written form of the root stem that any form uses, lower case (geben: `geb`, `gib`, `gab`, `gäb`;
  nehmen: `nehm`, `nimm`, `nahm`, `nähm`, `nomm`; sehen: `seh`, `sieh`, `sah`, `sicht`). The example check also uses
  them to find the verb in the example (er nimmt → `nimm`).
- `head` (new roots only): `lemma`, `en` (no "to"), `pres3`, `pret`, `aux`, `pp` (check them).
- `forms`, in tree order: the root first (`parent: null`, with `ex`, `exEn`), then every form after its parent.
  - A form that already exists as a Word building verb or chain word is a pointer: `{"id", "verb": "<verb id>",
    "clue"}` or `{"id", "chain": "<chain id>/<node id>", "clue", "ex", "exEn"}` (chain words need an example; add
    `level` if the word list does not have the word). Do not repeat their other fields and do not change them; if a
    field of an existing verb or chain word is wrong, say so in your report (do not edit `verbs.de.json` or
    `chains.de.json`).
  - A new form: `id`, `word`, `cls`, `art` (nouns), `parent`, `add`, `side`, `kind` + `aux` + `pp` (verbs), `refl`
    (verbs used with sich), `en`, `clue`, `ex`, `exEn`, `why` (verbs; optional for others), `note` (an article
    exception, a stem change), `grade`, `level`, `lemma` (word-list id or omit), `rare` (real but rare), `seg` only
    when the build says it cannot split the word.
  - Entries marked `TODO` come from the word list's cluster family: complete them, fix their fields, place them in the
    tree, delete `TODO`. Every one must end up as a form. Exceptions (a reflexive reading of an existing verb such as
    `sich setzen`, `bestehen aus`, `sich verstehen`) are not separate forms: delete them and list them in your report
    as "covered by <form id>".
  - `listCandidates` are word-list words that contain the stem: use the ones that belong to this root's family and fit
    (prefix + root, root + ending, prefix + root + ending, a well-known compound of a family word), then delete the
    field.

## Which forms (aim for 20 to 35 per root)
1. Every prefixed verb of the root in common use, A1 to C1: the separable particles, be-/ver-/ent-/er-/zer-/ge-/miss-,
   the dual prefixes (both readings only when both are current German), and particles like fest-, her-, dar-, hin-,
   weg-, zurück-, zusammen-, los-, bei-, statt-, teil-, heraus-, vorbei-, weiter-, wahr- …
2. Their nouns and adjectives: -ung, -er (person/tool), the bare stem (der Abfall, der Umzug), -e (die Aufgabe), -t/-ft
   (die Ankunft), -nis, -bar, -lich, -ig, -sam, -heit/-keit, un- on an adjective, the infinitive noun (das Verhalten),
   the participle as an adjective (vergangen) or a noun (der/die Angestellte: `adjNoun: true`).
3. Nouns from the root itself (die Stelle, der Fall, der Zug).
4. Compounds only when they are already in the cluster family or the word list (`side: "cmp"`, `add` = the other
   element, `seg` written out).
Leave out: anything you are not sure is current standard German; regional or dated forms; denominal verbs whose
parent is a noun (veranlassen, beauftragen); feminine -in forms (unless the cluster family has them).

**Every new form must be attested.** Run the lookup for every new word (it writes nothing):
```
/private/tmp/claude-501/-Users-pakrasi-mini/1707e1ea-cc30-4405-8f05-5c48f4e32b6c/scratchpad/wfenv/bin/python -I \
  /private/tmp/claude-501/-Users-pakrasi-mini/1707e1ea-cc30-4405-8f05-5c48f4e32b6c/scratchpad/wg/lexq.py Herstellung zerstellen …
```
Keep a form only if it has a DWDS entry, or the word list has it, or it has at least 200 DWDS corpus hits AND you are
certain it is a real, current word. Then check gender, separability and the Perfekt yourself (Duden/DWDS knowledge);
the lookup does not prove those.

## Fields, exactly
- `id`: the word-list id when the word is listed (look in the lookup output), else `der_Wort` / `die_Wort` /
  `das_Wort`, `wort.verb`, `wort.adj`. Plural-only: `pl: true` and the plural id (`die_Einnahmen`).
- `parent`/`add`/`side`: ONE step. feststellen ← stellen (`add: "fest"`, `side: "pre"`); die Feststellung ←
  feststellen (`add: "ung"`, `side: "suf"`); der Abfall ← abfallen (`add: "stem"`); die Ankunft ← ankommen
  (`add: "t"`); die Aufgabe ← aufgeben (`add: "e"`); unvorstellbar ← vorstellbar (`add: "un"`, `side: "pre"`).
  A noun whose verb is not a form (der Beifall: there is no beifallen in use) hangs from the root with all its prefixes
  in `pre`/`suf` overrides, or hangs from the nearest real parent. Ending ids: ung heit keit schaft e t in er stem nis
  inf bar lich sam ig, plus pp (Partizip II), ppr (Partizip I), isch, los, s, ling.
- `kind`: `s` splits (ich stelle … fest), `i` never. A dual prefix (um, über, unter, durch, wider, wieder) has the
  reading's kind; give two forms (ids `-s.verb`/`-i.verb` style only if both readings are needed).
- `aux`/`pp`: haben or sein (`hat`, `ist`, `hat/ist`) and the Partizip II, exactly (zurückgegeben, bekommen, ist
  vorbeigekommen, hat wahrgenommen).
- `en`: the meanings a B1/B2 learner needs, most common first, separated by `;`. Plain English, no em/en dashes.
- `clue` (the puzzle shows it; he must produce exactly this word from it):
  - verbs start `to `; nouns start `the ` / `a ` / `an `; adjectives plain; at most 48 characters, about 3 to 7 words.
  - UNIQUE inside the family and **unambiguous among the family's forms**: "the order (you placed)" for die Bestellung,
    never just "order" (bestellen and die Ordnung exist). When two forms are near (die Darstellung / der Darsteller /
    darstellen; die Einstellung / einstellen), each clue must point to one of them only: noun vs verb by `to`/`the`,
    person vs action by the gloss.
  - It must not contain the German word or an obvious give-away.
  - When the form has several senses, use the 1 or 2 most common, with a short context in brackets.
- `ex`/`exEn`: ONE natural sentence a German would say, 5 to 12 words, A2 to B1 language around the word, present or
  Perfekt, everyday or work/news context. It must hold the form: a separable verb in a main clause with the particle
  at the end (Die Firma stellt Möbel her.), or as infinitive / zu-infinitive / Partizip II; a noun as the noun (any
  case or plural is fine); no names of real people, no brands, no dates, no em dashes. `exEn` is a natural English
  translation of the sentence (not word for word).
- `why` (verbs, and any form graded M or O): one line on how the parts give the meaning ("fest = firm, fixed: you fix
  a fact so that it stands."). For a word to learn (O): "Learn it as a word: …" and do not claim the parts explain it.
- `grade`, from the parent: `T` the parts give the meaning literally (aufstellen = set up; die Ausstellung =
  exhibition from ausstellen); `M` one picture or one figurative step (einstellen = hire: put a person "into" a firm);
  `O` the parts do not give it (bestellen = order; der Beifall = applause). Nouns made by a regular ending from their
  verb are usually T.
- `level`: CEFR for a learner (Goethe/Profile Deutsch feel). The word list's level wins when the word is listed; do not
  write `level` for listed words.
- `rare: true`: a real word a learner rarely meets (die Vorstellbarkeit). Never on A2/B1 boards.
- Articles: -ung/-heit/-keit/-schaft/-in/-t always die; -er (person/tool) der; -nis das except die Erlaubnis /
  Kenntnis / Erkenntnis; bare-stem nouns mostly der (das Angebot, das Verbot, das Gehalt are exceptions); -e mostly
  die; ge-...-e collectives das (das Gefälle). An exception needs `note` that names it ("das Gehalt: …").
- Stress is computed by rule (separable particle, else the stem; bare-stem nouns stress their prefix: der Unterschied).
  If a form's stress is not what the rule gives, add `"stress": <index of the stressed vowel in word>` and say why.

## Boards (`boards`): the default puzzle for each level
- `A2`: 6 words, levels A1 to B1, verbs and -ung/-e nouns, no rare words. `B1`: 10 words up to B2, verbs, -ung, -er,
  -e nouns. `B2`: 12 words up to C1, may add -bar/-keit/-heit/un-/two-step words.
- `light`: 6 of `words` (the most common). For A2 it is the same 6.
- Only forms with at most one prefix (or un- + one), one article, not `pl`/`adjNoun`/compounds.
- Two board words must never be built from the same tiles (same prefixes and endings), except the two readings of a
  dual verb on a B2 board.
- `tiles.pre`: every prefix of the board words plus the distractors; at most 12. `tiles.suf`: every ending of the
  board words (including `stem`, `e`, `t` when a board noun needs them).
- `distract`: A2 one (`"is": "extra"`: a prefix whose verb is a real form of the family, not on the board); B1 one
  `"is": "none"`; B2 two, at least one `none`. A `none` distractor needs a checked non-word below.

## Non-words (`none`) and rare combinations (`rare`)
The game says "Not a German word" ONLY for `none` entries. Everything else he builds that is not a form says "Not in
this family's list", which is always safe. So:
- Put 2 to 4 prefix + root infinitives in `none` that you are **certain** are not German words (`{"key": "zer|",
  "word": "zerstellen"}`). Prefer ones a learner might try (zer-, miss-, ent-, er-, ver-, wider-, emp- with a root
  that does not take it). Run the lookup: it must show no DWDS entry, at most 10 corpus hits, wordfreq 0. If you have
  ANY doubt (a technical, regional, poetic, dated or jocular use you half remember; zergehen, entfahren,
  verlaufen-type surprises), do not put it in `none`.
- Combinations that exist but you left out (rare, technical) go in `rare` with `why` ("DWDS: technical term …").

## Check your work
```
node tools/build-wordbuild.mjs --only <root>[,<root>…]
```
It lists every problem (parts that do not spell the word, a missing tile, an article against its ending's rule, a
clue used twice, an example that does not show the split …). Ignore only "found in no lexicon" (the lexicon file is
filled centrally after you finish) and "needs the recorded check" (same). Fix everything else. Then format:
`python3 /private/tmp/claude-501/-Users-pakrasi-mini/1707e1ea-cc30-4405-8f05-5c48f4e32b6c/scratchpad/wg/fmt.py authoring/build/families/<root>.json`.

Edit only your own roots' files. Do not commit. Report: per root, the number of forms, the cluster members you
covered by other forms, anything in existing verbs/chains you think is wrong, and every judgment you were unsure of.
