# Word families in `content/build/de.json` (round 7)

The data behind **Word family** (`#/practice/build/family/<root>`) and **Today's family** (`#/practice/build/today`),
WORDGAMES-DESIGN §7. Built by `tools/build-wordbuild.mjs` from `authoring/build/families/<root>.json` and
`authoring/build/particles.de.json`; checked by `src/domain/wordbuild.js validateFamilies` (run by `validateBuild`).
Nothing existing changes: `prefixes`, `roots`, `verbs`, `frames`, `suffixes` and `chains` keep their shapes (chain
nodes gain `ex`/`exEn`). Two new top-level keys:

```jsonc
"particles": [ { "id": "her", "kind": "s", "core": "here, toward the speaker", "short": "here, toward",
                 "senses": [{ "en": "making, producing", "ex": ["herstellen"] }], "sep": "…", "insep": "…" } ],
               // prefixes that only families use (fest, her, dar, hin, weg, zurück, zusammen, los, bei, wieder, statt,
               // teil, heraus, hinter …). Same meaning as `prefixes[]` (s splits, i never splits, d both); they are NOT
               // in `prefixes[]`, so the compass, the Table and the PX cards do not change. A family form's `pre` ids
               // are in `prefixes[]` ∪ `particles[]` ∪ {"un"}.
"families": [ {
  "root": "stellen",            // stable id; for the 15 build roots it is the `roots[]` id
  "lemma": "stellen.verb", "en": "put (upright), place", "pres3": "stellt", "pret": "stellte", "aux": "hat", "pp": "gestellt",
  "level": "A1", "zipf": 4.9,
  "stems": ["stell"],           // the written root stems the forms use (geben: ["geb","gab","gib","gäb"]); [0] is the centre tile
  "forms": [ Form, … ],         // the root itself first (parent null), then a tree: every form's parent is earlier
  "boards": { "A2": Board, "B1": Board, "B2": Board },   // C1 uses B2
  "none": [ { "key": "zer|", "word": "zerstellen", "chk": { "dwds": false, "wf": 0, "hits": 0 } } ],  // CHECKED non-words: the only words the game may call "not a German word"
  "rare": [ { "key": "ent|", "word": "entstellen", "why": "exists: disfigure" } ],  // combos checked and NOT safe to call wrong
  "reviewedBy": "model-2pass", "reviewedAt": "2026-10-08"
} ]
```

## Form
| field | |
|---|---|
| `id` | Stable forever. The word-list id when the word is listed (`der_Hersteller`, `herstellen.verb`), else the same shape (`die_Zustellung`, `zerlegbar.adj`); a dual verb's reading is `<verb id>.verb` (`umstellen-s.verb`). |
| `card` | `PV:<verb>` (a `verbs[]` verb), `PW:<word>` (a chain word), `PF:<id>` (every other form), `null` for the root. One form, one build card. `familyCardIds(c)` lists the `PF:` ids. |
| `word` | As written: nouns capitalised, no article, no `sich`. `pl: true` marks a plural-only noun (`Einnahmen`). |
| `cls` | `verb` · `noun` · `adj` · `adv` |
| `art` | Nouns: `der` · `die` · `das`. `adjNoun: true` = a participle/adjective noun (der/die Angestellte): never on a board. |
| `kind` | Prefixed verbs: `s` splits (ich stelle … her), `i` never splits. `refl: true`: used with sich. `aux`, `pp` on verbs. |
| `parent`, `add`, `side` | One step in the tree: parent form id, the prefix or ending id added, `pre` / `suf` / `cmp` (compound: `add` is the other element, e.g. `Arbeit`). |
| `pre`, `suf` | All prefix ids (outermost first) and ending ids (innermost first) from the root. Ending ids: `suffixes[]` ids plus `pp` (Partizip II), `ppr` (Partizip I), `isch`, `los`, `s` (adverb -s). |
| `key` | `pre.join('+') + '|' + suf.join('+')` (`aus|ung`, `|e`, `un+vor|bar`, `her|`): what the tiles build. A bare-stem noun has `stem` (`ab|stem` = der Abfall), so it never collides with the verb (`ab|`). |
| `seg` | The written word in parts: `[["p","Aus"],["r","stell"],["s","ung"]]`; kinds `p` prefix, `r` root stem (one of `stems`), `s` ending, `i` inflection (-en, ge-…-t of a participle), `c` compound element, `l` linking -s-. Joined they spell `word`. Draw joints/welds from it. |
| `stress` | 0-based index into `word` of the stressed vowel (the stress dot). Computed by rule, authored only where the rule fails. |
| `en` | Meaning (all senses). `clue`: the board clue, ~6 words, unique inside the family; verbs start `to `, nouns `the `/`a `, plurals say so. |
| `ex`, `exEn` | One authored example and its English. Every form has one. |
| `why`, `note` | Optional: how the parts give the meaning; a rule note (article, stem change). |
| `grade`, `how` | Derivability from its parent: `T` literal (`lit`), `M` picture (`pic`/`hist`), `O` learn as a word (`word`). |
| `level`, `zipf` | CEFR (word list when listed) and Zipf frequency (wordfreq, CC BY-SA 4.0; word list value when listed). |
| `rare` | Real but rare: never on A2/B1 boards. |
| `board` | Eligible for a board: single article, at most one prefix (or `un` + one), not `pl`/`adjNoun`/`cmp`, a unique clue. |
| `lemma` | Word-list id or `null`. Knowledge item: `W:<lemma>` when set, else the card id (PV/PW rules as today). |
| `lex` | Where the form was found: `list` (word list), `dwds` (a DWDS dictionary entry), `corpus` (200+ hits in the DWDS corpora), `wf` (wordfreq Zipf > 0). Every form has `list`, `dwds` or `corpus`. |

## Board
```jsonc
{ "words": ["bestellen.verb", …],      // the level's board, in clue order (A2 6, B1 10, B2 12)
  "light": [ … ],                      // the Light-day board: 6 of `words`
  "tiles": { "pre": ["auf","vor",…], "suf": ["ung","er"] },   // ring order; every board word's parts are tiles
  "distract": [ { "pre": "zer", "is": "none" }, { "pre": "an", "is": "extra" } ] }   // extra = builds a real word not on the board
```
A2: 6 prefixes + 1 distractor; B1: + 1 checked non-word; B2: + 2 (§5.3). The game may swap board words for due or new
ones from the same family (`boardFor`); `words` is the default composition and is always valid.

## Classifying what he builds (the game)
1. `key` matches a board word → that clue (or another board word: fill it, no try spent).
2. matches any other form of the family → an extra word (never a miss).
3. matches a `none` entry → "Not a German word" (the only place this is said).
4. anything else (including `rare`) → "Not in this family's list". Never "not a word".

## How a non-word is checked
`chk` is recorded by `tools/family_lexcheck.py` (facts only: no DWDS text and no wordfreq list is copied): no DWDS
dictionary entry, at most 10 hits in the DWDS corpora (about 53 billion tokens), wordfreq Zipf 0 for the infinitive and
its finite forms. The validator also requires it to be in no lexicon the build knows (the word list, its morphology,
every build and family word), and both model review passes must agree (`authoring/de/build/REVIEW.json`). Anything in
doubt goes to `rare` instead.
