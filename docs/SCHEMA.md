# Data formats

Every format here has a JSON Schema in `schemas/` (draft 2020-12, the subset `src/core/schema.js` supports). The schemas are the source of truth; this page explains them. Content is public and shared; records are one learner's and never enter this repo.

## Content (`content/`, public)

`content/manifest.json` (`fluentish-content@1`) is the only entry point. Clients find files by **id**, never by path, and can verify each file by its sha256. It is written by `node tools/build-manifest.mjs` and has no timestamps, so CI can check it is current.

```json
{
  "schema": "fluentish-content@1",
  "version": "fb6d7793b60c",              // digest of all file hashes
  "languages": [{ "id": "german", "name": "German", "native": "Deutsch", "script": "latin", "rtl": false, "full": true }],
  "exams": [{ "id": "goethe-b1", "name": "Goethe-Zertifikat B1", "short": "Goethe B1", "language": "german", "level": "B1",
              "modules": [{ "id": "lesen", "name": "Lesen", "minutes": 65, "max": 30, "pass": 18 }, …],
              "media": "https://pakrasi.github.io/b1-exam/audio/", "def": "exam.goethe-b1.def", "locale": "exam.goethe-b1.locale.de", "tests": [1, …, 14] }],
  "packs": { "shared": ["igloo.chunks.en", "igloo.framework", …], "de": ["atlas.de", "b1.annot", …], "fr": ["igloo.chunks.french", …] },
  "files": [{ "id": "exam.goethe-b1.01", "path": "exams/goethe-b1/day01.json", "schema": "goethe-b1-exam@1", "bytes": 81234, "sha256": "…" }]
}
```

**Packs** (round 3, C3a): `packs[<lang>]` lists one language pack's file ids (the pack ids of `src/lang/registry.js`: `de`, `fr` …), `packs.shared` the files of no one language (the English sources, the framework, GO's tenses, the word themes). Every file is in exactly one pack, the one its id names (`build-manifest.mjs packOf`: a file named for its language, `igloo.chunks.french`, `clusters.de`; `b1.*` and `speak.*` are German; an exam's files are its language's). The service worker precaches `shared` and the active course's pack only (ARCHITECTURE §3.3).

**Schema ids** are generic (`lexicon@1`, `phrases@1`, `grammar@1`, `sentences@1`, `situations@1`, `trainer-items@1` …). The ids from before (`igloo-words@1`, `igloo-chunks@1`, `b1-items@1`, `speak-situations@1` …) are aliases of them (`schemas/content-ids.json`) and still validate; the manifest writes the generic id. An exam's test and explanation files keep the exam's own schemas (`goethe-b1-exam@1`, `goethe-b1-why@1`). The table below names files by their old ids where that is how the tools still call them.

**Native review**: a phrase bank, lexicon, grammar set or sentence bank may carry `reviewedBy` (a reviewer handle such as `native-fr-1`, never a real name: the repository is public) and `reviewedAt` (`YYYY-MM-DD`), on the file or on an entry; the two come together (`validate-content.mjs`).

The web app fetches `path?h=<sha256[:8]>`, so a changed file is never served from an old cache. Versioning: a breaking change to a file's shape bumps its schema (`@2`) and writes a new path; old clients keep reading the old one. File contents carry no envelope, so the validators below keep working on them.

| Ids | Schema | What |
|---|---|---|
| `igloo.framework` | `igloo-framework@1` | levels, layers, the ten languages, item ids, 30 scenarios |
| `igloo.lang.<lang>` | `igloo-lang@1` | one language's form for every framework item (5 full languages) |
| `igloo.sentences.en`, `.<lang>` | `igloo-sentences-en@1`, `igloo-sentences@1` | sentence bank, tokenised |
| `igloo.chunks.en`, `.<lang>` | `igloo-chunks-en@1`, `igloo-chunks@1` | the 1,450-phrase bank and its translations |
| `igloo.chunks.accept.german` | `igloo-chunks-accept@1` | accepted typed answers per phrase |
| `igloo.chunks.priority.de` | `igloo-chunks-priority@1` | Goethe B1 functions and phrase priorities |
| `igloo.words.de`, `.themes` | `igloo-words@1`, `igloo-word-themes@1` | German words A1–C2 |
| `igloo.grammar.items.de`, `.concepts.de` | `igloo-grammar-items@1`, `igloo-grammar-concepts@1` | typed grammar items |
| `igloo.turns` | `igloo-turns@1` | "go" in nine tenses |
| `b1.items`, `b1.annot`, `b1.grammar`, `b1.bank`, `b1.nouns`, `b1.frames`, `b1.wordmap`, `b1.plan` | `b1-*@1` | the B1 trainer |
| `exam.goethe-b1.NN`, `exam.goethe-b1.why.NN` | `goethe-b1-exam@1`, `goethe-b1-why@1` | 14 mock tests and their answer explanations |
| `exam.goethe-b1.def` | `exam-def@1` | the exam as data: sections, parts, item types, timings, play limits, scoring, pass lines, locale and result-file adapter (ARCHITECTURE §3.4) |
| `exam.goethe-b1.locale.de` | `exam-locale@1` | the runner's German strings (Sie), read through `exam.tx()` |

Sources that are built into `content/` live in `authoring/` (B1 item sources, phrase parts and accept parts, word slices, tense sources, the briefs content was written to). The app never fetches them.

### Goethe B1 mock test (`goethe-b1-exam@1`)

One file per test. The format follows the Goethe-Zertifikat B1 Modellsatz: Lesen Teil 1–5 (6 richtig/falsch, 2×3 MC, 7 situations to 10 ads with exactly one "0", 7 Ja/Nein comments, 4 MC), Hören Teil 1–4 (5 short texts × 2 items heard twice, a monologue with 5 MC heard once, a dialogue with 7 richtig/falsch heard once, a discussion with 8 who-said-it items heard twice), Schreiben Aufgabe 1–3 (20/25/15 minutes, 80/80/40 words), Sprechen Teil 1–3. Every objective item has an id (`L1-1`, `H1-1a`) and a `skill` (`detail`, `global`, `paraphrase`, `negation`, `number-time`, `attitude`, `inference`, `matching`). Answer keys are part of the content. The full annotated example is `authoring/briefs/EXAM_SCHEMA_SOURCE.md`; `tools/validate_exam.py` adds text-length checks the schema can't express. The field `day` is the test number (legacy name: tests are a library, not a calendar).

### Exam definition (`exam-def@1`) and exam-locale (`exam-locale@1`)

`content/exams/<id>/exam.json` describes one exam framework for the generic engine (`src/domain/examdef.js`, `src/domain/grade.js`, `src/features/exam/`): `sections` (id = module id in routes, drafts and result files; `kind` objective, writing or speaking; `minutes`, `max`, `pass`, `clock` down or up; `rules`/`intro` locale keys; speaking `prepMinutes`, `planMinutes`), each with `parts` (id = the Teil code in result rows, or the task id; `type`, or `{field, map, default}` when items carry their own; `first` printed number; `layout`; `group`/`groups`/`items` dot paths into a test; `audio: {id, file, plays, readSeconds?, replayAfter?}` where `id` is the play-count key in `exams.drafts`; writing `task` and `fields`; speaking `kind` plan, present or questions with `cues`/`questions` audio). `itemTypes` give each type's key rule (`bool` with true/false values, `index` into values, `value` with an optional none), how options are shown and the item's text template. `scoring.passShare`, `media {base, test}`, `tests {file, schema}`, `locale`, `results.adapter`. The manifest's `exams[]` entry is built from it. Full schema: `schemas/content/exam-def.schema.json`.

`content/exams/<id>/locale.<lang>.json`: `{lang, exam, strings}`, with the same value rules as `src/i18n` (`{name}` placeholders; `{one, other}` plurals).

### Answer explanations (`goethe-b1-why@1`)

Keyed by item id, 60 per test: `evidence` (a verbatim quote that decides the item), `why`, `trap`, each with an `_en` translation, plus `question_en`/`options_en`. `tools/validate_exam_why.py` checks the quotes are verbatim.

## Records (one learner; IndexedDB on the device, later a server)

Every client-created record carries `id` (UUIDv7), `profileId`, `deviceId` and `createdAt` (ISO with offset); mutable ones add `rev` (hybrid logical clock) and `deletedAt` when deletable. Legacy identifiers are kept under `legacy`.

**Checked while developing and testing** (`src/data/records.js`): on a dev server, in the browser e2e suite and in `tests/unit/records.test.mjs`, the store validates every `store.set` of `settings`, `prefs` and `exams.feedbackLocal`, every `store.append` (event@1) and every profile written to the adapter against `schemas/records/` before writing, and reports a mismatch (a console error in the browser, which fails the e2e suite; an exception in node). The deployed app loads no schema, so a record that drifts from its schema is caught before it ships, never in his app. A new field is added to its schema in the same commit.

| Schema | Where | Notes |
|---|---|---|
| `profile@1` | IDB `profiles` | `kind`: `local`, `shadow` (a preview copy that must never sync), `remote` (accounts, later); `archivedAt`, `archivedInto`: a preview merged at the cutover, never opened again, purged 30 days after `archivedAt` (in the schema since round 3; before, the schema refused the records the cutover wrote) |
| `settings@1` | kv `settings`, profile, synced | the goal and practice options. `courses` (round 3): one course per language, `{id, lang, level, goal: {exam, date}, decks}`, ordered by id, and `activeCourse`, the one Today, Practice and the clock follow. The active course's `goal.date` is the **only** source of the exam date (read through `data/settings.js examDate()`). `language`, `level`, `exam.type`, `exam.date` stay as the active course's mirror for code and devices from before courses; `setCourse()` is their one writer (same rev on both). `rev` holds an HLC per field path (`courses.<id>.goal.date`, `activeCourse`, the mirror's paths) for last-write-wins merges; courses are united by id. A record from before courses gains course `de` from its old fields with their revs (`data/session.js migrateCourses`, idempotent, no new stamp). Round 4 (C0) adds optional fields: a course's `goal.level`, `goal.by` (`YYYY-MM`) and `week` (`{min[7], kind[7]}`, Monday first, `domain/week.js`), `practice.readNew`/`readMin`, `conversation`, `connections.hours` (`{repo: 'owner/name', path, lang}`: the study hours file Today › Progress reads, a GitHub Pages file at `https://owner.github.io/name/path`; without it `config.hoursDefault`). A missing optional field means no goal of that kind; a new course is not stamped with them. A course keeps any field this build does not know (`courseList`), so an older device never drops what a newer one wrote |
| `prefs@1` | kv `prefs`, device | theme, motion, locale; never synced |
| (secrets) | kv `secrets`, device | `anthropicKey`, `githubToken`; never exported or synced, no schema on purpose |
| (log) | kv `log`, device | the error log ring, at most 500 `{at, where, message}` (`core/log.js`); never exported, uploaded scrubbed once a day |
| (palace) | kv `palace`, device | Explore › 3D's record of what it last showed: `{ver, st, day, played}`: the atlas ids' key with the profile id, one state digit per atlas item, the study day, and the item ids whose learned moment played that day (`domain/palace.js momentQueue`); never exported or synced, no schema on purpose |
| `card-fsrs@1` | IDB `cards` `[profileId, deck, itemId]` | the FSRS snapshot from `domain/fsrs.js`; a cache of the events |
| `exam-attempt@1` | IDB `attempts` | the B1 exam app's field names (`started_at`, `max_score`, `responses`, `writings`), which the Mac's `sync.py` imports, plus `examId` and `contentVersion` |
| `mistake@1` | kv `mistakes`, profile, private | a mistake from a correction: `{id: 'F:<attempt>-<n>', v: 1, wrong, right, rule, source: {attemptId, test, module, label}, createdAt, deletedAt}`; written only through `src/data/mistakes.js`; Practice reviews each as card `F:…` in deck `b1` |
| `feedback@1` | kv `exams.feedbackLocal`, profile | a correction of the learner's text: a one-click Schreiben correction made here (`features/exam/data.js saveCorrection`), or one carried over from the B1 exam app. `body` is required; `author` (`ai`, `tutor`, `self`), `model` and `promptVersion` (`schreiben-exam@1`, from `services/claude.js PROMPTS`) say who or what wrote it and with which prompt. They are additive: records from before them have none. The `feedback.created` event carries the same three, and its `data/feedback-ai/*.json` file adds `author` and `prompt_version` (sync.py ignores keys it does not read) |
| `event@1` | IDB `outbox`, then `archive` | append-only, the unit of sync (below); acknowledged events older than 30 days move to `archive` unchanged (`data/archive.js`) |
| `fluentish-export@1` | file | Profile > Data > Export: kv collections except prefs, secrets, palace and backup, cards, attempts, events (the outbox and its archive) |

### Events (`event@1`)

```js
{ id, v: 1, profileId, deviceId, seq, at: '…T21:04:05.120-04:00', day: 'YYYY-MM-DD', type, payload, synced, path }
```
`seq` is monotonic per device. `day` is the study day (04:00 cutoff) when the event happened. Types: `card.reviewed`, `card.marked_known`, `card.unmarked_known`, `exam.attempt`, `exam.voice`, `vocab.captured`, `vocab.reviewed`, `feedback.created`, `training.logged`, `settings.changed`, `legacy.imported`.

`card.marked_known` and `card.unmarked_known` ("I know this", src/domain/known.js and src/data/known.js) carry `{deck, by: 'self' | 'igloo', items: [{itemId, base, post}], ctx: {exam, phase, tz}}`, one event per deck and action; `post` is the card after the change (null: deleted by an undo). A marked card has an added `known` field: `{by, on, prev}` until its check, `{by, on, checked, ok}` after. `card.reviewed` must carry `{deck, itemId, g, ms, flags, mode, ctx: {exam, phase, tz}, base: {u, reps}, post}` (review B4): the scheduler's load balancing and the exam-date cap depend on the moment of review, so a replay elsewhere takes `post` when `base` matches the current card and otherwise re-runs `schedule()` with `forecast = () => 0`. The schema enforces these fields. `path` is the GitHub file path for the results sync. Events from before the sync seam stored it when they were created; events recorded through `data/sync/index.js` store `null` and the GitHub target derives the same name from the type, payload and `at` (`github-b1exam.js pathOf`), so retries still write the same file (review S5). A stored path always wins.

### Progress backup (private results repository, `data/sync/backup.js`)

| Path | Format | Writer |
|---|---|---|
| `data/events/<deviceId>/<day>.ndjson` | one `event@1` per line without `synced` and `path`, by `seq`; the learning events (`card.reviewed`, `card.marked_known`, `card.unmarked_known`, `settings.changed`) of that study day, except reviews marked `local` and events of deck `script` | this device only; lines are only added (read with sha, merge by id, write with sha) |
| `data/logs/<deviceId>/<day>.ndjson` | `{at, where, message, build}` per line: the error log entries since the last upload, scrubbed (`core/log.js`), script text replaced | this device, once a study day |
| `data/snapshots/<deviceId>/<day>.json.gz` (or `.json`) | `fluentish-snapshot@1`: `{schema, deviceId, profileId, at, day, seq, build, counts: {cards}, cards: {deck: {itemId: card-fsrs@1}}, kv: {settings, activity, mistakes, lookup.seen, known, b1.session, speak.sim, clusters, practice.write, exams.feedbackLocal, exams.seen, exams.learnerNotes, vocab.local, vocab.events, fr.session, and every progress-log month progress.<course>.<YYYY-MM>}}`, every deck except `script`. Collections matched by name pattern (`backup.js SNAPSHOT_PREFIX`: only `^progress\.[a-z0-9-]+\.\d{4}-\d\d$`, rule `progressDays`) are additive: a reader from before round 4 reads only the fixed names and passes them by | this device only; rewritten in place during the study day |

The device's backup state is the device-scope kv `backup` (`{on, at, error, eventsAt, snapshot: {day, at, hash, path, sha, profileId, cards}, autoMerge: {since} | null, mergedAt, mergeSeen: {profileId, files: {path: sha}}}`); the last restore or merge is the device-scope kv `backup.journal` (`{id, at, kind: 'restore' | 'merge', profileId, stage: 'applying' | 'done' | 'rolledBack' | 'undoing' | 'undone', counts, sources, before: {cards: {deck: {itemId: record | null}}, kv: {name: value | null}}, after: {cards: {deck: {itemId: hash}}, kv: {name: hash}}}`). Neither is exported or uploaded; "Delete all" clears both. The device record gains `previousDeviceIds` (the ids before each "Delete all").

### Study minutes (`activity`, `src/domain/activity.js`)

`activity[day] = {minutes, rounds, by?: {[kind]: minutes}, lang?: {[lang]: minutes}, dev?: {[deviceId]: {minutes, rounds, by?, lang?}}}` (round 4, additive). Every feature writes through `data/activity.js addActivity(store, day, {minutes, rounds, kind, split})`; kinds are exactly `review`, `new`, `write`, `speak`, `read`, `talk`, `build`, `script`, `exam` (a mixed round passes `split: {review, new}` and its minutes are shared by item count; any other kind counts without one). `minutes`, `rounds`, `by` and `lang` are the sums over `dev`, so Today, the allowance and the runway read the same numbers as before. Merging (restore, the automatic merge, two tabs): each device's larger numbers, totals summed, so two devices on one day add up. Minutes no device is named for (days from before `dev`) sit under device `_` and merge by the larger, the old rule; a day with only those keeps the old shape `{minutes, rounds}`.

### Progress log (`progress.<course>.<YYYY-MM>`, `src/domain/progress.js`, `src/data/progress.js`)

Profile kv, one key per course and month, `progress@1` (`schemas/records/progress.schema.json`): `{[day]: record}`, one record per study day.

```js
{ v: 1, at, dev, src: 'live' | 'replay' | 'estimate', estimated?: true, fin?: true, atlas: '<hash of the pool files>',
  known: {w, p, g}, shaky: {w, p, g}, seen: {w, p, g}, of: {w, p, g},   // by CEFR level [A1, A2, B1, B2, C1, C2, none], trailing zeros left out
  day: {new, learnt, missed, reviews, again},
  min: {total, rounds, dev: {[deviceId]: {m, by?}}, by?},
  jump?: {from: 'igloo', known} }
```
- **Counts:** `domain/knowledge.js` states over the course's pool (the map `atlas.<lang>` for German, else `course.<lang>` phrases and `igloo.words.<lang>`), the definition Where you stand and the map use. `of` is that day's pool, `atlas` its version. Words / phrases / grammar concepts.
- **Day:** cards first answered that day (`new`), of them graduated by its end (`learnt`), misses on cards learnt before (`missed`), cards reviewed that were not new (`reviews`), cards with a miss (`again`).
- **Minutes:** the course's minutes that day per device (`activity` `lang`, or every minute without a language for the first course, German), with kinds when the day's study was all this course's.
- **When:** today's record (`src: 'live'`) when the app opens and 20 s after study; missed days of the last 60 when the app opens or a new day starts, computed again from the cards and this device's events (`fin: true`); the past once per device (`backfill`, below). A record is written only when its picture changed.
- **Merge** (restore, merge, import): per day the counts of the more complete record (exact before estimated, then more of that day's study, then more items seen, then `fin`, then later `at`); minutes: each device's larger entry, totals summed.
- **Backfill** (device kv `progress.device`: `{profileId, at, from, exactFrom, jumpDay, withBackup, days, estimated}`, never exported or uploaded; "Delete all" clears it): every study day from the first answered card to yesterday. The cards of a past day are each backup snapshot of that day or before plus every card not changed since, with the learning events up to that day replayed on them (`cardsAt`, the merge's own order); a card that changed later and is in neither is estimated from its answer history (`estimateCard`: the last 12 answers replayed through the scheduler), and its day is `estimated: true`. With the backup readable (a linked device), every snapshot and event file of every device is read through `data/restore.js`, so the days from the first snapshot on are exact. Igloo's placement results count from the day they were imported (`known.placement`, else the migration's day), whose record carries `jump`. It runs again once if it ran before the backup could be read; running it again changes nothing.
- **Size:** about 600 bytes a study day with two devices: about 230 KB a year raw, under 10 KB gzipped in the snapshot.
- No map frames are stored: the daily snapshots are exact from the day they began, so per-item pictures can be computed from them later.

### Decks and languages (`src/domain/decks.js`)

A deck made from round 3 on is named `<lang>:<name>` (`fr:core`). The decks from before courses keep their names and are German through the fixed `LEGACY_DECK_LANG` (`b1`, `speak`, `script`, `clusters`, `build` → `de`). Card ids and the IDB keys `[profileId, deck, itemId]` never change; no card moves deck. Events whose payload names a deck carry an additive top-level `lang` (`deckLang(deck)`). Knowledge (`data/knowledge.js knowledgeDecks`), the allowance (`domain/allowance.js`) and Where you stand read only the active course's decks; for German that is every legacy deck, so their outputs are unchanged.

Decks per course (C3a): the allowance (`domain/allowance.js`), and with it the budget, Today's count, `dueTomorrow` and the first week, counts the active course's `<lang>:<name>` decks: each in the allowance deck its name gives (`decks.js allowanceDeck`: `fr:speak` → speak, `fr:script`, `fr:build`, `fr:clusters`, `fr:writing`, `fr:mistakes` likewise, `fr:core` and any other → the daily round's b1 share; `<lang>:read`, `de:read` included, → read, round 4): due cards, cards first answered today, and the new items its feature records open today in kv `deck.stats` (`{[deck]: {day, open}}`; any number without a record). German's only namespaced deck is `de:read` (round 4), which counts in read alone, so its b1 numbers are the legacy reading, byte for byte (`todayBudget` reads deck b1 for any course with the legacy decks).

The French course (C3b) is the first: deck `fr:core` (card ids `K:ENG_CHUNK_nnnn` for phrase cards and `W:<lemma>.<pos>` for word cards), kv `fr.session` (the shape of `b1.session`: round, rounds, day, days, variants; in the snapshot as `fill`), and `deck.stats['fr:core'] = {day, open, next}` (`next`: the next round's size, which Today's button and Practice's Start both show). A deck with a `deck.stats` record counts for its course before its first card.

### Course content (`content/course/<code>.json`, `course@1`)

Built by `tools/build-course.mjs <code>` (CI: `--check` in `validate-packs`) from `authoring/chunks/accept/<lang>/p*.json` (accepted answers, checked by `validate_accept.py`), `content/igloo/chunks/<lang>.json` (model sentences) and `content/igloo/chunks/en.json` (the English sentence and its highlighted span). `{lang, reviewedBy, reviewedAt, phrases: {id: {en, hl, ex, n, accept, level, cat, fn}}}`, in level order. The same build writes `content/igloo/chunks/accept_<lang>.json` and the word list `content/igloo/words/<code>.json` (`lexicon@1` with French fields: `g` gender, `forms` "il va · il est allé · il allait · il ira", `aux`, `pp`, `fem`, `before`, `note`), every entry stamped with its native review (`authoring/chunks/accept/<lang>/REVIEW.json`; the change log is `review-log.json` beside it). Rules checked with the app's own matcher and the language's pack: every model sentence matches a pattern, no detector fires on a model or a word's example, the word list passes the pack's `validateForms`.

**Item ids per language** (`domain/itemids.js scopeItem`, `splitItem`): German item ids are unscoped and stay so (`K:ENG_CHUNK_0001`, `W:haus.n`; never re-keyed). Another language's item ids are `<lang>:<id>` (`fr:K:ENG_CHUNK_0001`), because the chunk bank's ids are the same in every language. Card ids inside a namespaced deck stay plain (`fr:core` / `K:ENG_CHUNK_0001`: the deck scopes the card in the IndexedDB key); knowledge scopes the item a card resolves to by its deck's language, and Igloo's legacy `lang|id` data by the course's. A feature that keys anything by item id (Look up's seen, exam words) passes its course's language to `scopeItem`.

### Item ids in deck `b1`

Every card id names its kind by prefix (`src/domain/itemids.js`): `BP:` B1 phrase, `BL:` Lesen phrase, `BG:` B1 grammar, `BT:` situation (topic match), `BR:` situation (reply), `K:` chunk-bank phrase, `G:` Igloo grammar item, `W:` exam word in the word list, `BW:` exam word outside it, `F:` mistake from a correction. The migrated cards keep their ids; `wordId(lemma, wordmap)` and `mistakeId(attempt, n)` build the two that come from private data.

### Key-value collections

`settings`, `prefs`, `secrets`, `meta` (migration record: `migratedAt`, `legacyDeviceId`, a per-key fingerprint for the delta re-merge, `summary`), `activity` (`{[day]: {minutes, rounds, by?, lang?, dev?}}` for the runway and study days; see Study minutes below), `ui` (dismissed notices), and the collections carried over for stage B: `b1.session`, `exams.drafts` (`{"N:module": {answers, start, pause, seen, tab, meta, prepStart}, "plays:N": {...}}`), `exams.training`, `exams.voice`, `exams.seen`, `exams.feedbackLocal`, `vocab.local`, `vocab.events`. Practice adds `practice.write` (Schreiben, device-local: `{builds: {[task]: {day, right, total}}, drafts: {[task]: text}, corrections: {[task]: {body, text, at}}}`). Progress (round 4) adds `hours.external` (device-only, never exported or in the snapshot: the study hours file as last read, `{url, day, at, syncedAt, entries: [{date, hours, lang}]}`, read at most once a study day; `features/today/progress/hours.js`). The exam window (round 4) adds `exam.window` (device-only, not in the snapshot: `{exam: the date last seen | null, outside: bool, recapped: {[date]: {on, moved}}}`; `features/day.js examWindow`).

### Conversation (round 4, `features/practice-conversation/data.js`)

| kv | Where | Shape |
|---|---|---|
| `conv.sessions` | profile, backed up (`fill`) | `{[id]: conv-session@1 {id (UUIDv7), v: 1, mode: 'free'\|'roleplay', topic: {kind: 'topic'\|'scenario'\|'own', ref: content id \| null}, level, partnerLevel, register: 'du'\|'sie', day, startedAt, endedAt, turns, words, minutes, slower, toldSlower, models: {turn, feedback}, promptVersions: {turn, session, feedback}, usage: {in, cacheRead, cacheWrite, out}, costUsd, closing, counted, cards, status: 'open'\|'ended'\|'finished', deletedAt}}`. No free text: his own topic and every title live in the transcript (PLAN-REVIEW B6) |
| `conv.transcripts` | device only (never in a snapshot, log upload or export) | `{[id]: {id, title, system: {base, session, interests}, messages: Messages API history exactly as sent, append-only, thinking blocks kept, turns: [{i, who: 'learner'\|'partner', text, at, input?: 'typed'}]}}` |
| `conv.feedback` | device only | `{[sessionId]: conv-feedback@1 {id, v: 1, sessionId, model, promptVersion, createdAt, raw (the model's JSON, domain/conversation-feedback.js schema), dropped: [{field, index, reason}], added: card ids}}` |
| `conv.used` | profile, backed up (`seen`) | `{[itemId]: {first, last, n}}`: words of the list he used in typed turns or saved from a reply; knowledge source `conversation` (`data/knowledge.js EVIDENCE_KV`), never a state |
| `conv.spend` | device only | `{month: 'YYYY-MM', usd, sessions}`: this device's spend on his key, against `settings.conversation.monthlyCapUsd` (default 3) |

Mistakes he chooses become `F:C-<session id>-<n>` through `data/mistakes.js` (deck `b1`, `module: 'conversation'`), backed up like every other mistake (PLAN-REVIEW B5). Content: `content/conversation/<lang>.json` (`conversation@1`, manifest id `conversation.<lang>`): topics `{id, de, en, lv, tags}` and role-play scenarios `{id, title, en, fn, reg, lv, role, setup, goal, opener}`.

## Legacy localStorage keys (read once, never written)

`src/data/migrate.js` lists them (`LEGACY_KEYS`, `LEGACY_PREFIXES`) with the mapping. Codecs: everything is JSON except `doors.apikey` (a raw string). Igloo's SM-2 keys (`doors.srs.v1`, `doors.know.v1`, `doors.progress.v1`, `doors.days.v1`, `doors.today.v1`) stay owned by Igloo until Drill and Test move here, and Igloo's SM-2 `due`/`last` are UTC epoch days (`clock.epochDay`), never reinterpreted.

### Schreiben content (`content/b1/schreiben.json`, `b1-schreiben@1`)

Built from `authoring/schreiben-src/` by `tools/build_schreiben.py` (which runs every validate_b1 item rule on each item and email line). `items`: Schreiben phrases with ids `BS:a<n>-<slug>`, area `writing`, group = Teil (`W1`–`W3`), `fn` = a function of `functions`, `tier` 1–3, `rank` (introduction order), `punct` (punctuation rules: `comma-end`, `no-comma-end`, `lower-start`, `comma-before:<word>`, a slip graded by `domain/punct.js`). `linked`: the B1 trainer's letter items (`BP:w1-…`) filed under a function; the pool moves them to area `writing`. `tasks`: Build an email (mock task, points, parts: `fixed` formulas and `free` lines built on a `frame` with `glue` connectors).
