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
  "boards": { "A2": Board, "B1": Board, "B2": Board },   // C1 uses B2; A2 only when the family has 6 board forms at A1 to B1 (else use B1)
  "none": [ { "key": "zer|", "word": "zerstellen", "chk": { "dwds": false, "wf": 0, "hits": 0 } } ],  // CHECKED non-words: the only words the game may call "not a German word"
  "rare": [ { "key": "auf|er", "word": "Aufsteller", "why": "Found by the lexicon check: DWDS has an entry." } ],  // not in this family's list (may be rare): never called wrong, never called real
  "reviewedBy": "model-2pass", "reviewedAt": "2026-10-08"
} ]
```

## Form
| field | |
|---|---|
| `id` | Stable forever. The word-list id when the word is listed (`der_Hersteller`, `herstellen.verb`), else the same shape (`die_Zustellung`, `zerlegbar.adj`); a dual verb's reading is `<verb id>.verb` (`umstellen-s.verb`). |
| `card` | `PV:<verb>` (a `verbs[]` verb), `PW:<word>` (a chain word), `PF:<id>` (every other form), `null` for the root. One form, one build card. `familyCardIds(c)` lists the `PF:` ids. |
| `word` | As written: nouns capitalised, no article, no `sich`. `pl: true` marks a plural-only noun (`Einnahmen`). |
| `cls` | `verb` · `noun` · `adj` · `adv` · `conj` · `prep` |
| `art` | Nouns: `der` · `die` · `das`. `adjNoun: true` = a participle/adjective noun (der/die Angestellte): never on a board. |
| `kind` | Prefixed verbs: `s` splits (ich stelle … her), `i` never splits. `refl: true`: used with sich. `aux`, `pp` on verbs. |
| `parent`, `add`, `side` | One step in the tree: parent form id, the prefix or ending id added, `pre` / `suf` / `cmp` (compound: `add` is the other element, e.g. `Arbeit`). |
| `pre`, `suf` | All prefix ids (outermost first) and ending ids (innermost first) from the root. Ending ids: `suffixes[]` ids plus `pp` (Partizip II), `ppr` (Partizip I), `isch`, `los`, `s` (adverb -s). |
| `key` | `pre.join('+') + '|' + suf.join('+')` (`aus|ung`, `|e`, `un+vor|bar`, `zu|stem+ig`, `her|`): what the tiles build. A bare-stem noun has `stem` (`ab|stem` = der Abfall), so it never collides with the verb (`ab|`). The tiles build a key with at most two prefixes, the outer one `un` (un + ver), and a chain of up to three endings (`lich+keit`, `stem+ig+keit`); not a verb with an ending (`wordbuild-family.js tileKey`, the one rule for the game, its boards and the validator). |
| `seg` | The written word in parts: `[["p","Aus"],["r","stell"],["s","ung"]]`; kinds `p` prefix, `r` root stem (one of `stems`), `s` ending, `i` inflection (-en, ge-…-t of a participle), `c` compound element, `l` linking -s-. Joined they spell `word`. Draw joints/welds from it. |
| `stress` | 0-based index into `word` of the stressed vowel (the stress dot). Computed by rule, authored only where the rule fails. |
| `en` | Meaning (all senses). `clue`: the board clue, ~6 words, unique inside the family; verbs start `to `, nouns `the `/`a `, plurals say so. |
| `ex`, `exEn` | One authored example and its English. Every form has one. |
| `why`, `note` | Optional: how the parts give the meaning; a rule note (article, stem change). |
| `grade`, `how` | Derivability from its parent: `T` literal (`lit`), `M` picture (`pic`/`hist`), `O` learn as a word (`word`). |
| `level`, `zipf` | CEFR (word list when listed) and Zipf frequency (wordfreq, CC BY-SA 4.0; word list value when listed). |
| `rare` | Real but rare: never on A2/B1 boards. |
| `board` | Eligible for a board: single article, at most one prefix (or `un` + one), not `pl`/`adjNoun`/`cmp`, a unique clue, and a key the tiles build (`tileKey`; the validator checks it). |
| `lemma` | Word-list id or `null`. Knowledge item: `W:<lemma>` when set, else the card id (PV/PW rules as today). |
| `lex` | Where the form was found: `list` (word list), `dwds` (a DWDS dictionary entry), `corpus` (200+ hits in the DWDS corpora), `wf` (wordfreq Zipf > 0). Every form has `list`, `dwds` or `corpus`. |

## Board
```jsonc
{ "words": ["bestellen.verb", …],      // the level's board, in clue order (A2 6, B1 10, B2 12)
  "light": [ … ],                      // the Light-day board: 6 of `words`
  "tiles": { "pre": ["auf","vor",…], "suf": ["ung","er"] },   // ring order; every board word's parts are tiles
  "distract": [ { "pre": "zer", "is": "none" }, { "pre": "an", "is": "extra" } ] }   // extra = builds a real word not on the board
```
A2: 6 prefixes + 1 distractor; B1: + 1 checked non-word; B2: + 2 (§5.3). `un` is a prefix tile and every ending of a
chain is a tile. The game may swap board words for due or new ones from the same family (`boardFor`); `words` is the
default composition and is always valid: the validator holds every board word to `tileKey`, and
`tests/unit/family-grading.test.mjs` builds every slot of every content and live board with the tiles.

## Classifying what he builds (the game)
Tiles (`judge`):
1. `key` matches the clue's word → right (a noun with the wrong article: "article"). The bare stem writes no letters
   before another ending, so zu + -ig is zufällig (`zu|stem+ig`) unless zu + -ig is another word of the family.
2. matches another open board word → that word is named with its meaning; nothing is filled or graded, no try spent.
3. matches any other form of the family → an extra word (never a miss).
4. matches a `none` entry → "Not a German word" (the only place this is said).
5. anything else → "Not in this family's list". Never "not a word".

Typed (`judgeTyped`): a typed word is a word, never cut into tiles. It is right only when it is the clue's own word,
graded as the round grades typed cards (`gradeTyped`: no typo tolerance; a dropped umlaut or a noun's small letter is
a slip, rated Hard, unless the plain spelling is a word of the lexicon). Any other form of the family is that form (2
or 3 above): das Gebot is never das Gebiet, das Schloss never der Schluss with a wrong article, vertraglich never
verträglich. A capital or an article picks the noun of a verb-noun pair (das Verhalten), else the verb. A wrong
article is reported only when the noun is right. A word of `rare` says "Not in this family's list (it may be a rare
word)"; a `none` word is "Not a German word"; anything else is "Not in this family's list".

## How a non-word is checked
`chk` is recorded by `tools/family_lexcheck.py` (facts only: no DWDS text and no wordfreq list is copied): no DWDS
dictionary entry, at most 10 hits in the DWDS corpora (about 53 billion tokens), wordfreq Zipf 0 for the infinitive and
its finite forms. The validator also requires it to be in no lexicon the build knows (the word list, its morphology,
every build and family word), and both model review passes must agree (`authoring/de/build/REVIEW.json`). Anything in
doubt goes to `rare` instead.

## Notes for the game
- `rare` means "not in this family's list (may be rare)": combinations with a DWDS dictionary entry, established or
  technical words without one (Errichter, Einleiter). Never show a rare entry as "a real word".
  The round 7 German review found about a quarter of the old list was corpus noise (Betragung, Beitretung, Befinder,
  and the doubtful zerbringen or missgehen); those are now unlisted: still never called wrong, only "not in this
  family's list". A rare key or word is never a form's (validator), and
  a standard word a learner meets belongs in `forms` (round 7 moved zuhalten, der Besteller, die Übertretung,
  vernehmen, befallen and die Erarbeitung there).
- A board word's key may also be a non-board form's key only for the two readings of a dual verb.
- `content/build/de.json` is about 930 KB (190 KB gzipped) with the families; if the hub's first load suffers, the
  families can move to their own file (`content/build/families.de.json`) without changing their shape.
