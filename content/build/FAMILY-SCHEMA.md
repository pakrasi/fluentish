# Word families: `content/build/family/<slug>.json` and the index in `content/build/de.json` (round 7)

The data behind **Word family** (`#/practice/build/family/<root>`) and **Today's family** (`#/practice/build/today`),
WORDGAMES-DESIGN §7. Built by `tools/build-wordbuild.mjs` from `authoring/build/families/<root>.json` and
`authoring/build/particles.de.json`; checked by `src/domain/wordbuild-family-check.js validateFamilies` (run by
`validateBuild` on the merged content). Nothing existing changes: `prefixes`, `roots`, `verbs`, `frames`, `suffixes`
and `chains` keep their shapes (chain nodes gain `ex`/`exEn`).

## Where the families live (round 7, second pass: per-root lazy files)

The families were 790 KB of the 930 KB `de.json` (193 KB of 225 KB gzipped), and Today's cold load waited for all of
it to show one row about one root. They now live in one file per root; `de.json` keeps a small index. A file is named by the root's ASCII slug
(`hören` → `hoeren.json`, `schließen` → `schliessen.json`: manifest ids are `[a-z0-9.-]`, and a non-ASCII file name
can change its Unicode form between macOS and the web server); the index gives each root's manifest id as `file`.

| file | manifest id | schema | holds |
|---|---|---|---|
| `content/build/de.json` | `build.de` | `build@1` | everything it held before except `families`, plus `particles` and `familyIndex` |
| `content/build/family/<slug>.json` | `build.family.<slug>` | `build-family@1` | one family: exactly one entry of the old `families[]` (the shape below, unchanged) |

**Merging is the identity.** `familyIndex.roots.map(r => load(r.file))` in index order is the old
`families[]`, deep-equal (`tests/unit/build-family-files.test.mjs` proves it on every build). Every pure function that
took `c.families` (familyModel, lemmaMaps, lexiconOf, familyLexicon, pfIds, validateFamilies) behaves the same when
handed `{...c, families}`. Node tools and tests read the merged content through `tools/family-files.mjs`
(`readBuild()`, `withFamilies(c)`).

**Manifest and precache.** Each family file is a manifest file with `"lazy": true`, in pack `de` (pack membership is
the language it belongs to). `tools/stamp.mjs contentPrecache` leaves lazy files out of the install precache, so the
core precache is unchanged in count and 160 KB lighter. The service worker already serves `content/*?h=<sha8>` cache
first and stores what it fetched, so a family file is cached after its first use. Policy for the loader lane:
- Today's plan loads `build.de` only, picks the day's root from the index (`pickRoot`, below), then loads that one
  family file. The family view loads its root on open; Browse by prefix or ending loads the rest on demand.
- Offline: a family he has opened is there. Warming the other files after first paint (idle, low priority) is allowed
  and recommended; never block a screen on it.
- Across deploys: lazy files are content-hashed (`?h=`), so a new service worker may copy any it finds in the old
  cache, as install does for immutable precache entries, instead of dropping them (sw.js, the loader lane's call).
- A missing family file costs only that family (the row and the view say it could not load); nothing else waits on it.

### `familyIndex` (in `de.json`)
```jsonc
"familyIndex": {
  "roots": [ {                               // in families[] order (roots[] order, then the rest)
    "root": "stellen", "file": "build.family.stellen",   // file: the manifest id of the root's family file
    "lemma": "stellen.verb", "en": "put (upright), place", "level": "A1", "zipf": 4.9,
    "boards": ["A2", "B1", "B2"],            // the levels with a content board
    "forms": [                               // EVERY form, in the family file's order: [id, card, lemma, level, flags]
      ["stellen.verb", null, "stellen.verb", "A1", ""],
      ["abstellen.verb", "PV:abstellen", "abstellen.verb", "A2", "b"],
      ["der_Aufsteller", "PF:der_Aufsteller", null, "C1", "br"] ],
                                             // flags: b = a board form the game can build (card, tile key, board,
                                             //   clue: boardFor's `playable` before level and reports); r = rare
    "words": ["stellen", "gestellt", "abstellen", "abgestellt", …],   // what lexiconOf adds: every form's word and pp
    "rare": ["Aufsteller", …] } ]           // the rare words (familyLexicon)
}
```
What it answers without loading a family: which roots exist and their level and meaning (the hub, the Map's links,
"Family: stellen ›" on a word page via a form's lemma), a card's root and lemma (PF cards in the Word building round,
`lemmaMaps`), the known count ("3 of 41 known": every form's card and lemma), the typed-answer lexicon, and
**Today's root**: `pickRoot` in `src/domain/wordbuild-family-index.js` takes the index's roots and returns the same
root `boardFor` would (boardFor calls it), so the plan loads one file. The pure functions read the index when
`families` is absent (`lemmaMaps`, `pfIds`, `cardIds`, `lexiconOf`, `familyLexicon`; `lemmaIndexOf` is
`familyIndex(familyModel(…))` for word pages), with the same answers (tests/unit/build-family-files.test.mjs).

**Until the per-root loader lands** (the UI lane), `src/features/build/family-data.js ensureFamilies` loads all 40
files once a session through `src/data/build-content.js loadBuild`, and only where a family is needed: Today's plan
when it makes the day's board, the Word building hub, a Word building round, the family view and Today's family.
Today, knowledge, word pages and the Map read the index only.

## Board rules (round 7, second pass)

`boardFor` (the live board) and the content's default boards follow one set of rules
(`src/domain/wordbuild-family-index.js BOARD_RULES`); the validator holds the content boards to them and
`tests/unit/family-boards.test.mjs` simulates fresh learners at A2, B1 and B2 for 60 days and holds the live boards
to them. "Where the family allows" means: unless the root has too few playable forms of that kind at that level.

- **Rotation.** Today's root is the playable root (6 or more board forms at or under his level + 1) not used in the
  last 14 days that was used **longest ago** (never used first), then the most due, then the most unseen, then the
  day's hash. Every playable root comes round: 38 at A2 (stimmen and fragen have under six board forms at A1 to B1),
  40 at B1 and B2. (Before: the most-unseen ranking cycled the same 15 roots every 15 days.)
- **Verbs.** At least 40 % of a board's words are verbs (A2 and Light 3 of 6, B1 4 of 10, B2 5 of 12).
- **Articles.** Every board noun has `artBy`: `ending` (the ending always gives it: -ung, -heit, -keit, -schaft,
  -in, -er, the infinitive), `usual` (the ending usually gives it: the bare stem der, -e die, -t die, -nis das) or
  `except` (against its ending's usual article: das Verbot, das Gehalt, der Nachkomme, das Gefälle, der Gefallen).
  A board holds at most 2 (A2, Light), 3 (B1) or 4 (B2) `ending` nouns, at least 1 (A2) or 2 (B1, B2) `usual` or
  `except` nouns, and from B1 an `except` noun when the family has one at the level.
- **Room for distractors.** Board words use at most 9 prefix tiles (A2, B1) or 8 (B2) of the ring's 10, so the
  level's distractors always fit (A2 one, B1 a checked non-word, B2 two with a non-word). A family whose words each
  need their own prefix gets a smaller board (bringen: 9 at B1 and B2).
- Content boards are composed by the same rule (`tools/family-boards.mjs`: `boardFor` for a new learner on that root):
  A2 wherever the family has six board forms at A1 to B1 (the validator asks for one then), B1 and B2 always; `light`
  is 6 of `words` by the same rule. An `extra` distractor is a prefix that, alone or with an ending, builds a board
  form of the family that is not on the board.

## A family (one file, and one entry of the old `families[]`)
```jsonc
// in de.json:
"particles": [ { "id": "her", "kind": "s", "core": "here, toward the speaker", "short": "here, toward",
                 "senses": [{ "en": "making, producing", "ex": ["herstellen"] }], "sep": "…", "insep": "…" } ],
               // prefixes that only families use (fest, her, dar, hin, weg, zurück, zusammen, los, bei, wieder, statt,
               // teil, heraus, hinter …). Same meaning as `prefixes[]` (s splits, i never splits, d both); they are NOT
               // in `prefixes[]`, so the compass, the Table and the PX cards do not change. A family form's `pre` ids
               // are in `prefixes[]` ∪ `particles[]` ∪ {"un"}.
// content/build/family/stellen.json (was families[i]):
{
  "root": "stellen",            // stable id; for the 15 build roots it is the `roots[]` id
  "lemma": "stellen.verb", "en": "put (upright), place", "pres3": "stellt", "pret": "stellte", "aux": "hat", "pp": "gestellt",
  "level": "A1", "zipf": 4.9,
  "stems": ["stell"],           // the written root stems the forms use (geben: ["geb","gab","gib","gäb"]); [0] is the centre tile
  "forms": [ Form, … ],         // the root itself first (parent null), then a tree: every form's parent is earlier
  "boards": { "A2": Board, "B1": Board, "B2": Board },   // C1 uses B2; A2 only when the family has 6 board forms at A1 to B1 (else use B1)
  "none": [ { "key": "zer|", "word": "zerstellen", "chk": { "dwds": false, "wf": 0, "hits": 0 } } ],  // CHECKED non-words: the only words the game may call "not a German word"
  "rare": [ { "key": "auf|er", "word": "Aufsteller", "why": "Found by the lexicon check: DWDS has an entry." } ],  // not in this family's list (may be rare): never called wrong, never called real
  "reviewedBy": "model-2pass", "reviewedAt": "2026-10-08"
}
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
| `artBy` | Nouns with a noun ending (not compounds, adjNoun or plurals): `ending` · `usual` · `except`, how the article is known (Board rules). Built from `suffixes[]` (and -ling, der). |
| `board` | Eligible for a board: single article, at most one prefix (or `un` + one), not `pl`/`adjNoun`/`cmp`, a unique clue, and a key the tiles build (`tileKey`; the validator checks it). |
| `lemma` | Word-list id or `null`. Knowledge item: `W:<lemma>` when set, else the card id (PV/PW rules as today). |
| `lex` | Where the form was found: `list` (word list), `dwds` (a DWDS dictionary entry), `corpus` (200+ hits in the DWDS corpora), `wf` (wordfreq Zipf > 0). Every form has `list`, `dwds` or `corpus`. |

## Board
```jsonc
{ "words": ["bestellen.verb", …],      // the level's board, in clue order (A2 6, B1 10, B2 12; fewer only when the ring is full)
  "light": [ … ],                      // the Light-day board: 6 of `words`
  "tiles": { "pre": ["auf","vor",…], "suf": ["ung","er"] },   // ring order; every board word's parts are tiles
  "distract": [ { "pre": "zer", "is": "none" }, { "pre": "an", "is": "extra" } ] }   // extra = builds a real word not on the board (alone or with an ending)
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
- The families are per-root files since the second pass (Where the families live). `de.json` with the index is
  about 50 KB gzipped (it was 193 KB); a family file is 2 to 9 KB gzipped.
