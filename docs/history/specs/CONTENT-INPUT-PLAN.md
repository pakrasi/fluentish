> **Historical spec, not maintained.** Written 2026-10-05 in round 4 of the Fluentish build as the plan for content beyond B1 (the B2 layer) and real input (Reading, and Listening, which is not built yet) (amended before the build by the round 4 plan review).
> Copied here and privacy-scrubbed on 2026-10-07: personal data, names, local paths and scores were removed or
> summarised. Where it disagrees with the code, the code and the living docs win: `docs/CONTRIBUTING-FEATURES.md` (the level gate), `docs/ARCHITECTURE.md` §2.3 (the text layer), `src/features/practice-read/`, `docs/ROADMAP.md` (Listening, A2 texts).
> What was actually built, and what changed: `docs/history/round4-lifelong-learning.md`.

# Round 4: content beyond B1 (theme 2) and learning from real input (theme 3)

Author: curriculum and content planner, 2026-10-05. Plan only; no repo edits.
Read: the round 4 brief, CLAUDE.md, ARCHITECTURE §2.3, §3.3, §5.1–5.2, SCHEMA.md, the round 2 Scripts UX spec (`SCRIPT-UX.md`), and these files:
`content/` (every file counted below), `src/features/practice-script/*`, `src/domain/script/*`, `domain/{knowledge,allowance,itemids,wordtriage}.js`,
`features/shared/{pool,compose}.js`, `lang/de/index.js`, `lang/types.js`, `services/claude.js`, the French review files
(`authoring/chunks/accept/french/REVIEW.json`, `review-log.json`) and the authoring briefs.
Prototype: a static reading page with screenshots at 390 px (WebKit, iPhone 14), kept outside the repo and not preserved.

---

## 0. Decisions

1. **B2 is mostly a reachability problem, and second a content problem.** The word list already has 973 B2 words, but the German
   daily round draws only on the B1 trainer (`b1.items`, `b1.grammar`, `b1.bank`). So 147 of the 166 B2 phrases and 78 of the
   96 B2 grammar items exist and can never be practised. Make them reachable first (engine work: S/M), then write the missing
   B2 layer (content work: L).
2. **New content goes into the shared, language-keyed files.** Redemittel and collocations go into the chunk bank
   (`ENG_CHUNK_1451+`, English source plus a German translation), so French gets the same functions later as a translation
   job, not a redesign. Grammar goes into `igloo.grammar.*.de` under new concept ids. Words go into `igloo.words.de` with additive
   fields. There is one new file type, graded texts `read.<lang>` (`readers@1`). No German goes into an engine.
3. **Reading is its own feature (`practice-read`), built on a text layer taken out of Scripts.** Scripts is for memorising a
   text to say aloud: sections, a ladder, a delivery date, Ready %, and at most two active. Reading is for understanding a text:
   a library of dozens, a level estimate, questions, no ladder and no deadline. They need different scheduling, numbers and
   Today rows, so they are separate features. They need the same tokeniser, lemmatiser, suggestions, word sheet and tray, so
   those pieces move to `domain/text/` and `features/shared/textview.js`, and both features import them. One button in each
   connects them: "Learn to say it" sends a reading text to Scripts as a Retell script, as a copy.
4. **Words captured while reading are a new source, `read`.** Their cards go to a new namespaced deck `<lang>:read` (`de:read`
   for German, the first German deck after round 3's naming rule), keep one card per lemma, and count in a new allowance deck
   `read`. The texts never leave the device.
5. **Two native review passes, done independently, for every B2 item**, with the French C3b log format, plus machine gates that
   use the app's own matcher, detectors and grading corpus (§3).

---

## 1. Level audit (German pack, 2026-10-05)

| Content (file) | A1 | A2 | B1 | B2 | C1 | C2 | Reachable in a practice round |
|---|---|---|---|---|---|---|---|
| Words (`igloo.words.de`, 4,355) | 708 | 772 | 1,059 | **973** | 651 | 192 | via clusters, the map and exam words; no B2 path in the daily round |
| verbs with `forms` | 121 | 169 | 238 | 177 | 144 | 44 | (every verb has forms; nouns have plural only) |
| Phrase bank (`igloo.chunks.*`, 1,450) | 92 | 475 | 717 | **166** | **0** | 0 | only the 102 in `b1.bank` (2/11/70/**19**) |
| Grammar concepts (67) | 7 | 21 | 21 | **12** | 6 | – | via `b1.plan` topics only |
| Grammar items (`igloo.grammar.items.de`, 693) | 79 | 240 | 230 | **96** | 48 | – | `b1.grammar`: 49/114/191/**18** (je…desto, two-part connectors) |
| Speaking situations (210) | 23 | 59 | 101 | 27 | – | – | yes (deck speak) |
| B1 trainer, Schreiben, mocks | – | – | 445 + 87 + 14 tests | – | – | – | B1 exam only |
| Framework items (`igloo.framework`, 284) | 51 | 50 | 60 | 57 | 51 | – | Look up only |
| Clusters 146 families, Word building 170 verbs | level-agnostic | | | | | | yes |

Where B2 is thin:
- **Grammar:** 12 concepts × 8 items. Missing: Konjunktiv II for wishes, for modal verbs in the past and in the passive, and
  conditions without *wenn*; indirect questions and commands in reported speech; Passiv Perfekt; the double infinitive; basic
  nominalisation; *indem*, *ohne dass*, *sodass*, *wohingegen*, *selbst wenn*; nouns made from adjectives; Futur II for guesses;
  adjectives and nouns with prepositions; extended relative clauses; *sich lassen*. Partizipialattribute and Nominalstil exist
  only at C1 (receptive B2 practice is needed first).
- **Functions:** of the 166 B2 phrases, about 30 argue, concede or hedge, and they are spread over one-off functions. Nothing
  covers presentations past B1 Teil 2, chairing a discussion, describing data, summarising a source, or formal statements.
- **Collocations:** the word list has 13 B2 multi-word entries (*in Betracht ziehen*, *Wert legen auf* …) and 8 grammar items
  on nominal–verbal combinations. There is no Funktionsverbgefüge set.
- **Domains:** the themes have no politics, environment, technology or health (they are folded into society, nature, science
  and body), so the domain counts are hidden. Work 68, media 36, society 63, law 54, science 52, body 46, nature 42 at B2.
- **Texts:** there is no reading material outside the 14 B1 mock tests.

---

## 2. The B2 layer

### 2.1 Grammar: 20 new concepts, 12 existing concepts topped up, about 400 items

Ids are new kebab-case ids (none renamed). Every concept gets **12 items** of at least 3 kinds (`gap`, `transform`, `join`,
`order`, `translate`, `choose-article`). The 12 existing B2 concepts grow from 8 to 12 items (+48).
`irreale-vergleichssaetze` (*als ob*) moves from C1 to B2 (the level field only; its id stays). Goethe B2 and Profile deutsch
both place *als ob* at B2.

| Group | New concept ids (12 items each) | Native traps the items must test |
|---|---|---|
| Konjunktiv II, all uses | `konjunktiv-2-wunsch` (Wenn ich doch …! Hätte ich nur …), `konjunktiv-2-modal-vergangenheit` (hätte … machen sollen), `konjunktiv-2-passiv` (müsste repariert werden; hätte gemacht werden müssen), `konditional-ohne-wenn` (Hätte ich Zeit, …) | *käme* and *würde kommen* are both right; *hatte*/*hätte* and *wurde*/*würde* stay wrong (umlaut minimal pairs); the order is *dass er es hätte machen sollen*, never *… machen sollen hätte* |
| Indirect speech | `indirekte-rede-ersatz` (Konjunktiv II where Konjunktiv I looks like the indicative: *sie hätten*), `indirekte-rede-fragen-aufforderungen` (ob/w-questions, sollen/mögen) | an item that asks for Konjunktiv I does not accept *wäre* for *sei*; an Ersatz item accepts both *würden … kommen* and *kämen* |
| Passive | `passiv-perfekt` (ist … worden), `ersatzinfinitiv` (hat kommen müssen; dass er hat kommen müssen) | *worden*, not *geworden*, in the passive |
| Nominal style (B2, as reading and transforming) | `nominalisierung-praepositionen` (weil → wegen + Gen., nachdem → nach, obwohl → trotz, wenn → bei, um … zu → zum/zur) | genitive after *wegen*/*trotz* in writing; the dative is accepted only with a note when no article shows the case |
| Connectors | `indem-dadurch-dass`, `ohne-statt-zu-dass`, `sodass-so-dass`, `waehrend-wohingegen` (contrast), `konzessiv-selbst-wenn` | comma before *sodass*; *so dass* is accepted as a spelling variant |
| Nouns and adjectives | `adjektiv-als-nomen` (der Angestellte, ein Angestellter), `adjektive-mit-praepositionen` (stolz auf, abhängig von), `nomen-mit-praepositionen` (Interesse an, Angst vor) | the n-Deklination is a B1 concept; here the mixed declension of nouns made from adjectives |
| Other | `futur-2-vermutung`, `relativsaetze-erweitert` (wer/was, wo(r)+, dessen/deren), `lassen-konstruktionen` (sich lassen + Infinitiv), `wortstellung-mittelfeld` (pronoun before noun, dative before accusative) | *was* after *alles*, *nichts* and *das Beste*; *das* after a noun |

Partizipialattribute and Nominalstil: the B2 items **unpack** an attribute into a relative clause (*die gestern angekommenen
Gäste* → *die Gäste, die gestern angekommen sind*). Building one stays at C1 (`erweiterte-partizipialattribute`).
`partizip-als-adjektiv` gets 4 one-element extensions in its top-up.

Schema: `grammar@1`, unchanged. Additive concept fields: `rank` (order of introduction inside the level) and `fn` (the
function it serves: `argue`, `report`, `condition` …), both optional.

### 2.2 Functions and Redemittel: 180 phrases (`ENG_CHUNK_1451`–`1630`)

Twelve function groups of 15 phrases each, B2, `category` `sentence_frame`, `gambit_filler` or `discourse_connector`:

1 giving and backing an opinion (*Ich vertrete die Auffassung, dass …*) · 2 arguing and giving examples (*Dafür spricht vor
allem, dass …*) · 3 hedging and qualifying (*Das trifft nur bedingt zu*) · 4 conceding and countering (*Zwar …, aber …*;
*Das mag sein, allerdings …*) · 5 nuanced agreement and disagreement · 6 guesses and probability (*Vermutlich …*, *Es ist
davon auszugehen, dass …*) · 7 weighing and concluding · 8 reporting and summarising a source (*Laut …*, *Dem Bericht
zufolge …*, *Der Autor vertritt die These, dass …*) · 9 presentations: opening, outline, transitions, closing · 10 chairing
and taking part in a discussion (taking the floor, interrupting, coming back to a point, building on someone) · 11 describing
graphs and figures (*Der Anteil ist um … gestiegen*) · 12 work and formal writing (a statement, a complaint, a request).

The 166 existing B2 phrases get a `fn` tag (an additive field in the German entry) so they join these groups. The tagging
also finds overlaps, which are merged before anything new is written.

Schema: `phrases@1` (`en.json` entry: id, chunk, category, pragmatic_function, register, slots, examples, level),
`igloo.chunks.german` `{t, ex, n}` and accepted answers in `authoring/chunks/accept/german/p7.json`, all unchanged.
The priority file gains a `b2` function list beside `functions` (additive). French does not need them yet; the English source
makes them a translation job when French reaches B2.

### 2.3 Collocations and Funktionsverbgefüge: 200 entries (`ENG_CHUNK_1631`–`1830`)

- **120 Funktionsverbgefüge**, in frequency order from a corpus count of the noun and verb pair: *eine Entscheidung treffen*,
  *in Frage stellen*, *zur Verfügung stellen/stehen*, *Kritik üben an*, *Bezug nehmen auf*, *in Anspruch nehmen*, *zum
  Ausdruck bringen*, *in Kauf nehmen*, *Maßnahmen ergreifen*, *Rücksicht nehmen auf*, *zur Sprache bringen*, *Stellung nehmen
  zu*, *einen Antrag stellen*, *in Kraft treten*, *unter Druck stehen*, *eine Rolle spielen* …
- **80 other collocations** across the domains (*heftige Kritik*, *ein hohes Risiko eingehen*, *Wert legen auf*, *eine Frage
  aufwerfen*, *Bilanz ziehen*).
- In the bank as `category: collocation`. The German entry gets an additive `fvg: {verb, noun, prep, case, alt}` (`alt`:
  *eine Entscheidung fällen*), so `nomen-verb-verbindungen` can generate its typed items ("eine Entscheidung ___" → treffen).
  That concept grows from 8 to **24** items.
- The 13 B2 multi-word entries in the word list stay where they are (their `W:` ids have cards). The build links them to their
  bank twin through `chunkOf`, so knowledge counts one item.

### 2.4 Vocabulary domains: +450 B2 words and a domain tag on every B2/C1 word

- Additive `dom: string[]` on `lexicon@1` entries: `work`, `economy`, `news`, `politics`, `science`, `tech`, `health`,
  `environment`, `society`. All 973 B2 and 651 C1 words are tagged. `theme` is unchanged, because the map's layout keys on it.
- **450 new B2 words**, aimed at the domains: politics 60, environment 60, tech and digital life 60, health 60, economy and work
  70, science and research 50, news and media 40, general abstract 50. That takes A1–B2 to about 3,960 lemmas, the usual size
  of a B2 receptive vocabulary list.
- Additive `col: string[]` (2–3 typical collocations) on 300 B2 nouns. The word panel shows them after the answer.
- Every entry keeps the `WORDS_BRIEF.md` rules: `ex` and `exen`, an unambiguous first gloss, `alt` only for true synonyms,
  `forms` on verbs.

### 2.5 Graded texts: `content/read/de.json` (`readers@1`, new), 40 texts

- 12 B1+ bridge texts (about 250 words) and 24 B2 texts (about 400 words: the 7 domains × 3, plus 3 opinion pieces). Each text
  re-uses at least 8 of its level's target items (words, Redemittel, FVG, grammar), so reading revises the B2 layer.
- 4 public-domain texts in modern spelling (Hebel's Kalendergeschichten, Kafka's short prose) with `licence: "PD"` and the
  original source. Older spellings (*daß*, *muß*) are mapped through a pack spelling table; the text itself is never changed silently.
- Each text has 5 reviewed questions with a verbatim evidence quote (`validate_exam_why.py`'s quote check is reused).

```json
{ "lang": "de", "reviewedBy": "de-review-2pass", "reviewedAt": "YYYY-MM-DD",
  "texts": [{ "id": "R:b2-umwelt-01", "level": "B2", "dom": ["environment"], "title": "…", "licence": "own" | "PD" | "CC-BY-4.0",
    "source": null | {"author": "…", "work": "…", "year": 1811}, "words": 402,
    "sections": [{ "id": "s1", "sentences": [{ "id": "a1", "de": "…", "en": "…" }] }],
    "targets": ["W:die_Maßnahme", "K:ENG_CHUNK_1640", "GC:passiv-perfekt"],
    "questions": [{ "id": "q1", "type": "mc" | "tf", "skill": "global" | "detail" | "inference" | "attitude",
                    "q": "…", "options": ["…"], "answer": 0, "evidence": "verbatim quote" }] }] }
```
`readers@1` is generic: `read.fr` uses the same shape. The manifest puts `read.de` in pack `de`.

### 2.6 Where content comes from, and licences

| Need | Source | Licence and use |
|---|---|---|
| Candidates (words, phrases, items, texts) | generated by Claude from a brief per slice (like `WORDS_BRIEF.md`, `GRAMMAR_BRIEF.md`) | ours; nothing copied |
| Frequency (`zipf`, FVG order) | wordfreq (code Apache-2.0, data CC BY-SA 4.0); Leipzig Corpora Collection counts (CC BY) as a cross-check | numbers only, credited in a new `content/NOTICE.md`; **confirm before C-B2c** where the existing `zipf` values came from, because no notice exists today |
| Level checks | Goethe and telc B2 word lists, Profile deutsch | used to check levels; nothing copied (copyrighted) |
| Forms, gender, plurals | the generator, checked against DWDS and Duden by the reviewers | facts only; no Wiktionary text is copied, because CC BY-SA would bind the file |
| Texts | written for the app; PD texts from Project Gutenberg's German collection (author died over 70 years ago) | `licence` field required; the validator refuses any other value |

### 2.7 C1, later

Start once the B2 layer has shipped and he knows about 70 % of it. Planned counts: 12 more C1 grammar concepts (Nominalstil
built, Partizipialattribute built, subjective modal verbs, *sein/haben + zu*, correlates, Konjunktiv I throughout) with 12 items
each; 150 C1 phrases (academic register, nuance, irony); +300 academic words (C1 already has 651); 24 C1 texts. Same schemas,
same review.

---

## 3. Native review: two independent passes

Before (the French course, C3b): an author pass, then a native editor and examiner pass that logged every change
(`review-log.json`: file, id, field, before, after, severity `error`/`improve`, why) and stamped `reviewedBy`/`reviewedAt`.
For B2 German the second pass becomes two independent ones:

1. **Author pass.** One slice at a time (one concept group, one function group, 50 words, 6 texts), written to its brief.
2. **Machine gates.** Each slice must pass these before any reviewer sees it:
   - schema; `validate_grammar.py de`, `validate_chunks.py`, `validate_accept.py`, `validate.py` (words), `validate_sentences.py`;
     the pack's `validateForms`;
   - the **app's own matcher**: every model answer and example matches one of its accepted patterns (`build-course.mjs` rule);
   - **zero-fire**: no German error detector fires on a model sentence, an example or a text sentence (`lang-fr.test.mjs` rule);
   - **grading corpus**: for every new item, the near misses (*hatte* for *hätte*, *wurde* for *würde*, *müsste* for *müsse*,
     *geworden* for *worden*, a wrong article, a dropped umlaut) go into `tests/corpus/` and must stay wrong (0 false positives);
   - **self-consistency**: a separate model call answers each item blind; any disagreement with the key is flagged for review;
   - level sanity (a B2 word with zipf over 4.8 or under 2.5 is flagged), duplicates against all 4,355 words and 1,450 phrases,
     ids checked against the shipped-ids ledger, and every question's evidence found verbatim in its text.
3. **Review pass A** (`de-native-review-a`, persona: a native de-DE editor and Goethe/telc B2 examiner). Logs every change.
4. **Review pass B** (`de-native-review-b`, persona: a native editor from Austria or Switzerland, for `alt` forms and
   regional usage). Reviews pass A's output **without seeing pass A's log**, and logs its own changes.
5. **Reconcile.** Changes that both passes made agree and go in. Where only one pass changed something, the change goes in when
   it is an `error`; an `improve` from one pass goes to a third, adjudicating pass. If pass B finds `error`s in more than 2 % of
   a slice's entries, the whole slice goes through pass A again. The log keeps the error rate per slice, so it is visible
   whether the author briefs are getting better.
6. **Stamp.** `REVIEW.json` per slice holds the ids and both handles; the build stamps `reviewedBy: "de-review-2pass"` and
   `reviewedAt`. A new rule in `validate-content.mjs`: any German entry at B2 or above added after the round-4 baseline must
   carry the stamp, or CI fails.
7. **Human spot check.** Each week, 20 random B2 items go to a human reviewer through the existing private feedback path.
   This is outside the repo and never names anyone.

Things the reviewers check by name: Konjunktiv I forms that look like the indicative; the double infinitive in subordinate
clauses; *recht/Recht geben* and *ohne Weiteres/weiteres* (both are accepted spellings since 2006, so both must be accepted);
optional commas with infinitive clauses (`punct` rules must not mark either choice wrong); FVG alternatives; the gender of
loanwords (*das/der Virus*: both, with a note); register (Sie and du both shown, as in the framework).

---

## 4. How levels unlock for a B1 → B2 learner

`course.level` stays what he says his level is. New additive course field `target` (default: one level up; Profile ›
Courses › "Working towards: B2"). The composer's `levelBand` only acts below B1 today; it becomes a **per-strand gate**
(strands: grammar, phrases, words), pure and tested in node (`domain/levels.js`):

| His coverage of the strand at his level (`seen` = any card; `known` from `knowledge.js`) | Next-level items among his new items |
|---|---|
| under 50 % seen | none (consolidate first) |
| 50–80 % seen | 1 in 4 new items of that strand |
| over 80 % seen, or he chose "Practise B2 now" | the level itself is open; B2 first in rank order, B1 leftovers spread through (1 in 3) |

- **While an exam is ahead** (phases week to day), next-level new items pause, as clusters and Word building do, unless the
  exam is at that level (`goal.exam` level B2). Reviews of B2 cards already made continue (reviews are never hidden).
- **Maintenance mode** (no date, or after the exam): B2 new items come through the b1 share of the one allowance. No new deck
  is needed: the ids are `G:`, `K:` and `W:` in deck `b1`, so one card per item, as now.
- **Moving up.** When he knows over 85 % of the B1 pool **and** his last 5 texts at B2 had personal coverage of 95 % or more,
  Profile suggests "Set your level to B2" once. The level is never changed automatically.
- Where you stand gains one line per strand, for example "B2 grammar: 14 of 33 concepts seen, 6 known" (illustrative
  figures; theme 5 draws it over time).
- Theme 1's new words in frequency order use the same gate for the word strand, so B2 words come in by zipf once the gate opens.

Engine changes (S/M): `pool.js` takes the pack's grammar items for concepts above B1 (topic = concept, rank from the concept)
and the bank's B2 phrases with an accept list, beside the B1 trainer; `compose.js` uses `levels.js` in place of `levelBand`.
B1-only learners see no change; a golden vector pins the B1 new-item order.

---

## 5. Real input: Reading and Listening

### 5.1 Placement and routes
Practice › **Reading** (`features/practice-read/`, registry id `read`): `#/practice/read` (library), `/new` (paste),
`/<id>` (reader), `/<id>/listen`, `/<id>/questions`, `/lib/<textId>` (graded texts), and the review round
`#/practice/round?kind=read`. One Today row in maintenance.

### 5.2 Screens (390 px)

```
Library                               Paste                                 Reader (prototype)
┌────────────────────────────────┐   ┌────────────────────────────────┐   ┌────────────────────────────────┐
│ Reading                [+ New] │   │ ‹ Reading        New text      │   │ ‹ Reading            [▶ Listen]│
│ For you now (95–98 % known)    │   │ Title [Vier-Tage-Woche       ] │   │ [Study (intensive)|Read on    ]│
│  Weniger arbeiten …  B2 · 96 % │   │ Source note (optional)         │   │ (About B2) You know 90.6 % of  │
│  Die Wärmepumpe      B2 · 97 % │   │ [A news site, 4 Oct         ]  │   │ the words: 1 new word in 11.   │
│ Your texts                     │   │ ┌────────────────────────────┐ │   │ ███████████████████▒▒░░░       │
│  A pasted text     B1+ · 98 %  │   │ │ Paste German text, a       │ │   │ Weniger arbeiten, mehr         │
│   ▮▮▮▮▮▯▯ 60 % read · 4 words  │   │ │ transcript, or subtitles   │ │   │ schaffen?                      │
│ Graded texts (40)              │   │ │ (SRT, VTT, YouTube)        │ │   │ Seit einigen Jahren wird …     │
│  B1+ 12 · B2 24 · Classics 4   │   │ └────────────────────────────┘ │   │ Befürworter argumentieren …    │
│                                │   │ 412 words · about B2 · 94 %    │   │ ┄┄┄┄┄┄┄┄┄┄                     │
│ This week: 3,140 words read    │   │ known: a stretch               │   │ ┌────────────────────────────┐ │
│                                │   │ [Add audio file]  (optional)   │   │ │2 words to review [Questions]│ │
│                                │   │ Stays on this device.  [Save]  │   │ └────────────────────────────┘ │
└────────────────────────────────┘   └────────────────────────────────┘   └────────────────────────────────┘
Word sheet                            Finish (intensive)                    Listen
┌────────────────────────────────┐   ┌────────────────────────────────┐   ┌────────────────────────────────┐
│ B2 · verb · ▮▮▮▮ · New to you  │   │ Done: Weniger arbeiten …       │   │ ‹ Text   Listen first | Along  │
│ übertragen                     │   │ 132 words · 6 min · 3 looked up│   │ Abschnitt 2 of 4               │
│ überträgt · übertrug · hat …   │   │ Did you understand it?   2 / 3 │   │ (text hidden until questions)  │
│ to transfer, to apply (to)     │   │ Words to review                │   │ ──●───────────── 1:12 / 4:30   │
│ Meaning from the word list.    │   │  beibehalten · Branche ·       │   │ [↺ sentence] [0.8×] [▶] [→]    │
│ sich übertragen lassen: …      │   │  übertragen       [Edit]       │   │ Sentence loop: tap a sentence  │
│ │Kritiker halten dagegen, dass │   │ [Learn to say it]  (to Scripts)│   │ to repeat it                   │
│ │… auf alle Branchen übertragen│   │ [Next text at your level ›]    │   │ Device voice (no audio file)   │
│ [Add to review][Translate]     │   │                                │   │ [Questions] [Show text]        │
└────────────────────────────────┘   └────────────────────────────────┘   └────────────────────────────────┘
```

All figures in these mock-ups are sample data. The prototype's screenshots (not preserved) covered the reader in light and
dark, the word sheet, a collocation band (*jemandem recht geben*), a separable verb (*halten … dagegen* → *dagegenhalten*,
both parts lit), Questions (a wrong answer shows the evidence) and extensive mode. The text was written for the
prototype, about the four-day week, 132 words at B2. It still needs a native pass before it ships anywhere.

### 5.3 The flow
1. **Paste** German text, a transcript, or subtitles. Detection uses Scripts' `detect()`, plus SRT/VTT and YouTube's
   copied-transcript format (`0:03` / `1:02:03` lines), which become cue times. No URL fetching: the CSP allows no other origin,
   and he decides what to keep.
2. **Estimate** (local, before saving): the level and his personal coverage (§5.5). The verdict: "An easy read" (98 % or more,
   good for extensive reading), "Right for study" (95–98 %), "A stretch" (90–95 %), "Too hard for now" (under 90 %). The cut-offs
   come from the reading research: about 98 % coverage to read unassisted, 95 % minimum to read with help.
3. **Read.** Every word is a 44 px tap target. Tapping a word opens the sheet: lemma (with separable verbs joined across the
   sentence), forms, gloss, level, frequency, his state, a grammar note when a construction is detected, the sentence, and
   "Add to review" and "Translate sentence". A phrase band (bank or collocation match) opens the phrase first; "Just this word"
   opens the word.
   - **Intensive (Study):** suggested-new words dotted (Scripts' `suggest.js`, capped at 12 % of tokens), phrase bands shown,
     and Questions at the end.
   - **Extensive (Read on):** no marks, tap only when stuck, "Add to review" one tap with no sheet text; it counts words read
     and minutes. A text over 98 % opens in this mode.
4. **Capture.** "Add to review" makes or reuses the word's card (§6.2) and keeps the sentence as its context. The word card
   later shows **his sentence with the word gapped**, as exam words and script words do.
5. **Finish:** words read, minutes, look-ups, the captured list (editable), questions (intensive), "Learn to say it", and the
   next text at his level.
6. **Graded texts** open the same reader; their questions come reviewed from the content, not from Claude.

### 5.4 Claude, with his key, cached on the device
| Call | When | Prompt (public template in `services/claude.js PROMPTS`) | Cache |
|---|---|---|---|
| Off-list meanings | words not in the word list, batched once per text | `read-gloss@1` (Scripts' `meaningsPrompt` with the language name from the pack) | `read.cache[id].gloss` |
| Sentence translation | the "Translate sentence" tap | `read-translate@1`, small model | `read.cache[id].tr[sentenceId]` |
| Questions | the first open of Questions | `read-questions@1`: 5 items (2 gist, 2 detail, 1 inference), mc or richtig/falsch, in the target language, each with a verbatim `evidence` | `read.cache[id].q` with `{promptVersion, model, textHash}` |

Validating the questions: the reply must parse; `answer` must be in range; the options must be distinct; the `evidence` must be
found verbatim in the text after `pack.text.normalize`; the question must be in the target language (Scripts' `langOf`, moved
to the pack). Items that fail are dropped; if fewer than 3 are left, one retry, then "Couldn't write questions for this text."
Answers are graded locally and are not FSRS cards; the score goes to `read.progress`. Without a key: list glosses, typed
meanings, no questions or translations (the same no-key line as Scripts).

### 5.5 Level estimation (pure, `domain/text/estimate.js`)
- Tokens through `pack.text.tokenize`, lemmas through `pack.morphology.lemma` (German: Scripts' `lemma.js`, moved into
  `lang/de/`), with names, numbers and English words removed (the rules from Scripts' `suggest.js`, made pack data).
- **Personal coverage** = the share of running words that are known or shaky in `knowledge.js`, or transparent (a cognate by the
  pack's `cognate` pattern, or a compound whose last part is known), or at least two levels below his level with zipf 5 or more
  and never missed. Unseen words at or above his level count as unknown.
- **Text level** = the lowest CEFR level whose cumulative word list covers 95 % of the lemmas, raised one step when the
  constructions the pack detects (`pack.reading.constructions`: Konjunktiv I, passive with modals, Partizipialattribut, *je …
  desto*, nominal style) occur more than once per 100 words, or when the mean sentence length is over 22 words. The label is
  always "About B2" (an estimate), with the coverage figure beside it.
- **i+1:** the library's "For you now" lists texts at 95–98 % personal coverage. A graded text ships with its lemma list so it
  is scored without parsing.

### 5.6 Listening
- **His audio file** (a podcast episode or voice memo he downloaded) through a file input → IndexedDB blob `read:<id>:audio`
  → a `blob:` URL (the CSP already allows `media-src blob:`). Cap: 60 MB per file; a warning over 300 MB in total. Never synced,
  exported or uploaded.
- **Timing:** cue times from SRT/VTT/YouTube paste; otherwise **tap-to-sync** (play, tap "Next sentence" at each start: one
  pass, then fine-tune), otherwise an even split by characters until he syncs.
- **Modes:** *Listen first* (text hidden, section by section, then the questions, then the text revealed with the parts he missed);
  *Read along* (current sentence lit, tap to seek); *Sentence loop* (repeat one sentence at 0.75–1.0×; `audio.js clip()` gains an
  additive `rate`).
- **No audio file:** the device voice through `voice.js say()` sentence by sentence, with `onWord` read-along. Graded texts can
  get neural clips later, built like the speaking situations (edge-tts on the Mac, published next to the exam audio). Licence
  question in §9.
- YouTube and podcast URLs: never fetched. He watches in the YouTube app and reads the pasted transcript here, or downloads the
  audio himself.
- Later: dictation (hear a sentence, type it, graded by `match.js` with the pack, language-neutral).

### 5.7 Copyright and privacy
Pasted texts, translations, questions, audio and timings live in IndexedDB only. They are never in the repo, the backup, the
results sync or the error log (`core/log.js` already replaces script text; reading text gets the same rule). They are left out
of Export unless he ticks "Include reading texts". The app has no way to share or publish a pasted text. A text goes to
api.anthropic.com only for the call he taps, with the one-line notice Scripts uses. Graded texts in the repo are only `own` or
`PD`, enforced by the validator.

---

## 6. Data model (additive only)

### 6.1 Collections (profile scope, device-only unless stated)
```js
// kv 'reads': { [id]: read@1 }
{ id, v: 1, profileId, lang: 'de', title, source: { kind: 'paste' | 'graded' | 'subs', label: string | null, textId?: 'R:b2-umwelt-01' },
  mode: 'intensive' | 'extensive', format: 'de' | 'pairs' | 'srt' | 'vtt' | 'yt',
  sections: [{ id, title, sentences: [{ id, de, en: string | null, at?: [startMs, endMs] }] }],   // Scripts' shape; graded: none (read from content)
  marks: [{ id, kind: 'word' | 'phrase', sentenceId, start, end, surface, lemma, gloss, glossFrom: 'list' | 'claude' | 'me', cardId: string | null }],
  estimate: { level, coverage, words, at, ver },          // ver: the estimator version, so it is recomputed after changes
  audio: { blob: 'read:<id>:audio', mime, bytes, ms, cues: 'subs' | 'taps' | 'even' } | null,
  createdAt, rev, deletedAt }
// kv 'read.progress': { [id]: { pos: sentenceId, done: day | null, ms, words, looked, q: { right, of, at } | null } }
// kv 'read.cache':    { [id]: { gloss: {…}, tr: { [sentenceId]: en }, q: { promptVersion, model, textHash, items: […] } } }
// kv 'read.words':    { [cardId]: { lemma, gloss, level, zipf, ctx: [{ readId, sentenceId, de }] (max 3, de ≤ 240 chars), at } }
// activity[day].read = { words, ms }   additive; numbers only, so it is backed up like activity (theme 5 reads it)
```

### 6.2 Cards, ids, knowledge
- Deck **`<lang>:read`** (`de:read`), allowance deck `read` (`decks.js allowanceDeck`: `*:read` → `read`, a one-line addition).
- Card ids: `W:<word id>` (a list word), `RW:<slug>` (an off-list lemma), `K:<chunk id>` (a bank or collocation match),
  `RP:<slug>` (another phrase he marks). New tags `RW` (kind word, area words) and `RP` (kind phrase, area speaking) in
  `itemids.js TAGS` and the shipped-ids ledger. Neither collides (SS: is the speaking situations; Scripts never shipped its
  planned `SS:` sentence cards).
- **One card per item:** if any deck of the course already has a card for the item (b1, clusters, script), capture adds context
  to `read.words` and no new card. Otherwise the card goes to `de:read`.
- `knowledge.js resolver`: deck `*:read`: `W:` as is; `RW:<slug>` → `W:<id>` when the lemma is listed, else `BW:<slug>` (the
  same item as an exam word); `RP:` as itself; `K:` as is. **Origin `read`** joins `exam | speech | practice | lookup | script |
  test | self`, so the map and the word panel show "From your reading".
- Triage (`wordtriage.js`, a new input `source: 'read'`): a captured word goes into the queue when it has a meaning and
  (zipf 3 or more, or at or below his target level). Otherwise it stays "reference" (kept with its sentence, visible in Look up,
  not scheduled). This stops a rare word in a novel from costing reviews for years.
- **Sync and backup:** `de:read` cards and their `card.reviewed` events are learning progress, so they are backed up like other
  decks; the ids are word ids. `read.words` goes in the snapshot **without** `ctx[].de`. `reads`, `read.cache` and the audio
  blobs are never sent. (Scripts' `local: true` exclusion stays as it is for deck `script`.)

### 6.3 Pack interface additions (`lang/types.js`, all optional)
`morphology.lemma(token, sentenceTokens, index)` (German: separable particles joined across the clause, participles, compounds,
umlaut plurals), `reading: { stop: Set, cognate: RegExp, spelling: Record<old,new>, constructions: [{id, concept, test}],
foreign(token, ctx) }`. German fills all of them from code moved out of `practice-script` (DE_STOP, ENGLISH, COGNATE, PREFIXES);
French gets text-only versions first (elision, its stop words, accents). Engines in `domain/text/` take a pack per call, as
`match.js` does.

---

## 7. How it plugs into the allowance, Today and knowledge

- **`domain/budget.js`:** a new allowance deck `read`. Its want = captured words waiting, at most `practice.readNew` (default 6).
  Maintenance: proportional, beside script, Word building and clusters. Exam week: new captures wait ("after the exam"), like
  clusters. First week: none.
- **Reviews:** `de:read` due cards count in `reviews.due`. With no exam and nothing urgent, they join the main review round (the
  source line says "From: Weniger arbeiten …"), as Scripts' words do.
- **Today row:** "Reading · 10 min" at priority 40 in maintenance (after scripts at 30, Word building 35 and clusters 38) when a
  text is in progress or the library has one at i+1. Under "If you have time" while an exam is ahead. Minutes:
  `practice.readMin` (default 10), the time actually spent goes into `activity[day].read`.
- **Knowledge and Where you stand:** captured items score through the normal resolver; "This week: 3,140 words read, 14 words
  saved" (illustrative figures) is a line for theme 5; the B2 strand lines from §4.
- **Allowance invariants** (tests): with no `de:read` deck and no `reads`, every German number is byte-identical to today (a
  golden vector over `dayAllowance`); a `de:read` capture never raises the day's total new items, only takes a share.

---

## 8. Effort and phasing

| Phase | What | Effort | Depends on |
|---|---|---|---|
| **E1** Reachability | `pool.js` reads the pack's B2 grammar items and bank phrases; `domain/levels.js` gate; `course.target`; B1 golden vector | M | none |
| **R0** Text layer | move tokenizer, lemma, suggest, langOf, names into `domain/text/` + `lang/de/`; `features/shared/textview.js` (tappable text, sheet, tray); Scripts unchanged (its parse fixtures and e2e as the guard) | M | none |
| **R1** Reader | library, paste, estimate, intensive/extensive, capture to `de:read`, `RW:`/`RP:`, origin `read`, triage, allowance deck, Today row, privacy and export rules | L | R0 |
| **C-B2a** Grammar | 20 concepts × 12, top-ups (+52), the FVG concept to 24, corpus near misses, 2-pass review | L | E1 |
| **R2** Questions and graded texts | Claude glosses, translation and questions with validation and cache; `readers@1`; 12 bridge texts first | M | R1 |
| **C-B2b** Redemittel and FVG | 180 + 200 bank entries, German translations and accept lists, `fvg` field, review | L | E1 |
| **R3** Listening | audio blob, SRT/VTT/YouTube cues, tap-to-sync, three modes, `audio.js` rate, TTS fallback | M | R1 |
| **C-B2c** Words | `dom` tags on 1,624 words, +450 B2 words, `col` on 300 nouns, the frequency licence notice | L | licence check |
| **C-B2d** Texts | the remaining 24 B2 and 4 PD texts with questions | M | R2, C-B2a–c |
| **C1** | §2.7 | L | B2 shipped |

Order of value: E1 (B2 practice from content that already exists, in days) → R0/R1 (real input) → C-B2a → R2 → C-B2b → R3 →
C-B2c/d. Review cost: about 1,300 B2 entries × 2 passes; slices of about 60 entries keep each pass to one sitting.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A wrong German item at scale (one bad Konjunktiv key teaches an error for years) | the gates in §3; self-consistency; corpus near misses; pass B blind to pass A; error rate per slice; a human reviewer's weekly sample |
| Lemma errors on real text: separable particles at the clause end (*stellt … vor*), FVG spread over a clause (*traf gestern eine Entscheidung*), compounds, names | clause-level lemma in the pack; "Change" on the sheet (as in Scripts); guessed lemmas shown as guesses; never auto-captured |
| The level estimate misleads (names, cognates, topic words) | always "About", with personal coverage beside it; estimator version stored; graded texts give a calibration set (labelled level vs estimate, a unit test with tolerance ±1) |
| Capture inflation turns reading into review debt | triage by zipf and level; `practice.readNew` cap; extensive mode captures only on purpose |
| Claude questions that are wrong or answerable without reading | verbatim evidence check; gist/detail mix; drop and retry; cached per text hash, so no cost to re-open |
| A pasted text leaks (backup, log, export, a fixture) | exclusion lists tested in unit tests (snapshot keys, export keys, log scrub); synthetic fixture texts only; the privacy check flags `reads` in fixtures |
| Licences: the source of the existing `zipf` values is not recorded; edge-tts audio terms; CC BY-SA share-alike | confirm and write `content/NOTICE.md` before C-B2c; no published neural audio for texts until its terms are clear (device voice meanwhile); copy no CC BY-SA text |
| iOS storage eviction or quota with audio files | the home-screen app is exempt from the 7-day eviction; caps and a size line in Profile › Data; the audio is his own copy, so losing it loses no progress |
| B2 crowds out B1 before an exam moves | the gate pauses next-level new items whenever a B1 exam is ahead; reviews are unaffected |
| French and other packs fall behind the German-specific pieces | everything new is pack data or an optional pack hook; French reads with text-only hooks on day one; B2 Redemittel are English-keyed bank entries |
| The first German namespaced deck (`de:read`) trips a legacy assumption ("German has no namespaced decks") | a test that German allowance, knowledge and backup with `de:read` present equal the legacy reading plus that deck; review `decks.js inLang`, `knowledgeDecks` and the snapshot deck filter |

## 10. Open questions for the owner
1. Is B2 the next goal, and is there a B2 exam in mind (Goethe or telc)? That decides whether B2 new items run during an exam
   period.
2. Is backing up `de:read` cards to the private results repo fine? (The texts stay on the device either way.)
3. Reading minutes a day after the exam: 10, or more?
4. For audio: do you have podcast files or only YouTube? If only YouTube, transcript plus device voice is the path for now.
