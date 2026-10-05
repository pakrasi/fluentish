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
              "media": "https://pakrasi.github.io/b1-exam/audio/", "tests": [1, …, 14] }],
  "files": [{ "id": "exam.goethe-b1.01", "path": "exams/goethe-b1/day01.json", "schema": "goethe-b1-exam@1", "bytes": 81234, "sha256": "…" }]
}
```

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

Sources that are built into `content/` live in `authoring/` (B1 item sources, phrase parts and accept parts, word slices, tense sources, the briefs content was written to). The app never fetches them.

### Goethe B1 mock test (`goethe-b1-exam@1`)

One file per test. The format follows the Goethe-Zertifikat B1 Modellsatz: Lesen Teil 1–5 (6 richtig/falsch, 2×3 MC, 7 situations to 10 ads with exactly one "0", 7 Ja/Nein comments, 4 MC), Hören Teil 1–4 (5 short texts × 2 items heard twice, a monologue with 5 MC heard once, a dialogue with 7 richtig/falsch heard once, a discussion with 8 who-said-it items heard twice), Schreiben Aufgabe 1–3 (20/25/15 minutes, 80/80/40 words), Sprechen Teil 1–3. Every objective item has an id (`L1-1`, `H1-1a`) and a `skill` (`detail`, `global`, `paraphrase`, `negation`, `number-time`, `attitude`, `inference`, `matching`). Answer keys are part of the content. The full annotated example is `authoring/briefs/EXAM_SCHEMA_SOURCE.md`; `tools/validate_exam.py` adds text-length checks the schema can't express. The field `day` is the test number (legacy name: tests are a library, not a calendar).

### Answer explanations (`goethe-b1-why@1`)

Keyed by item id, 60 per test: `evidence` (a verbatim quote that decides the item), `why`, `trap`, each with an `_en` translation, plus `question_en`/`options_en`. `tools/validate_exam_why.py` checks the quotes are verbatim.

## Records (one learner; IndexedDB on the device, later a server)

Every client-created record carries `id` (UUIDv7), `profileId`, `deviceId` and `createdAt` (ISO with offset); mutable ones add `rev` (hybrid logical clock) and `deletedAt` when deletable. Legacy identifiers are kept under `legacy`.

| Schema | Where | Notes |
|---|---|---|
| `profile@1` | IDB `profiles` | `kind`: `local`, `shadow` (a preview copy that must never sync), `remote` (accounts, later); `archivedAt`, `archivedInto`: a preview merged at the cutover, never opened again, purged 30 days after `archivedAt` |
| `settings@1` | kv `settings`, profile, synced | the goal and practice options; `exam.date` is the **only** place the exam date lives; `rev` holds an HLC per field path for last-write-wins merges |
| `prefs@1` | kv `prefs`, device | theme, motion, locale; never synced |
| (secrets) | kv `secrets`, device | `anthropicKey`, `githubToken`; never exported or synced, no schema on purpose |
| (palace) | kv `palace`, device | Explore › 3D's record of what it last showed: `{ver, st, day, played}`: the atlas ids' key with the profile id, one state digit per atlas item, the study day, and the item ids whose learned moment played that day (`domain/palace.js momentQueue`); never exported or synced, no schema on purpose |
| `card-fsrs@1` | IDB `cards` `[profileId, deck, itemId]` | the FSRS snapshot from `domain/fsrs.js`; a cache of the events |
| `exam-attempt@1` | IDB `attempts` | the B1 exam app's field names (`started_at`, `max_score`, `responses`, `writings`), which the Mac's `sync.py` imports, plus `examId` and `contentVersion` |
| `mistake@1` | kv `mistakes`, profile, private | a mistake from a correction: `{id: 'F:<attempt>-<n>', v: 1, wrong, right, rule, source: {attemptId, test, module, label}, createdAt, deletedAt}`; written only through `src/data/mistakes.js`; Practice reviews each as card `F:…` in deck `b1` |
| `event@1` | IDB `outbox` | append-only, the unit of sync (below) |
| `fluentish-export@1` | file | Profile > Data > Export: kv collections except prefs, secrets, palace and backup, cards, attempts, events |

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
| `data/snapshots/<deviceId>/<day>.json.gz` (or `.json`) | `fluentish-snapshot@1`: `{schema, deviceId, profileId, at, day, seq, build, counts: {cards}, cards: {deck: {itemId: card-fsrs@1}}, kv: {settings, activity, mistakes, lookup.seen, known, b1.session, speak.sim, clusters, practice.write, exams.feedbackLocal, exams.seen, exams.learnerNotes, vocab.local, vocab.events}}`, every deck except `script` | this device only; rewritten in place during the study day |

The device's backup state is the device-scope kv `backup` (`{on, at, error, eventsAt, snapshot: {day, at, hash, path, sha, profileId, cards}}`); it is never exported or uploaded.

### Item ids in deck `b1`

Every card id names its kind by prefix (`src/domain/itemids.js`): `BP:` B1 phrase, `BL:` Lesen phrase, `BG:` B1 grammar, `BT:` situation (topic match), `BR:` situation (reply), `K:` chunk-bank phrase, `G:` Igloo grammar item, `W:` exam word in the word list, `BW:` exam word outside it, `F:` mistake from a correction. The migrated cards keep their ids; `wordId(lemma, wordmap)` and `mistakeId(attempt, n)` build the two that come from private data.

### Key-value collections

`settings`, `prefs`, `secrets`, `meta` (migration record: `migratedAt`, `legacyDeviceId`, a per-key fingerprint for the delta re-merge, `summary`), `activity` (`{[day]: {minutes, rounds}}` for the runway and study days), `ui` (dismissed notices), and the collections carried over for stage B: `b1.session`, `exams.drafts` (`{"N:module": {answers, start, pause, seen, tab, meta, prepStart}, "plays:N": {...}}`), `exams.training`, `exams.voice`, `exams.seen`, `exams.feedbackLocal`, `vocab.local`, `vocab.events`. Practice adds `practice.write` (Schreiben, device-local: `{builds: {[task]: {day, right, total}}, drafts: {[task]: text}, corrections: {[task]: {body, text, at}}}`).

## Legacy localStorage keys (read once, never written)

`src/data/migrate.js` lists them (`LEGACY_KEYS`, `LEGACY_PREFIXES`) with the mapping. Codecs: everything is JSON except `doors.apikey` (a raw string). Igloo's SM-2 keys (`doors.srs.v1`, `doors.know.v1`, `doors.progress.v1`, `doors.days.v1`, `doors.today.v1`) stay owned by Igloo until Drill and Test move here, and Igloo's SM-2 `due`/`last` are UTC epoch days (`clock.epochDay`), never reinterpreted.

### Schreiben content (`content/b1/schreiben.json`, `b1-schreiben@1`)

Built from `authoring/schreiben-src/` by `tools/build_schreiben.py` (which runs every validate_b1 item rule on each item and email line). `items`: Schreiben phrases with ids `BS:a<n>-<slug>`, area `writing`, group = Teil (`W1`–`W3`), `fn` = a function of `functions`, `tier` 1–3, `rank` (introduction order), `punct` (punctuation rules: `comma-end`, `no-comma-end`, `lower-start`, `comma-before:<word>`, a slip graded by `domain/punct.js`). `linked`: the B1 trainer's letter items (`BP:w1-…`) filed under a function; the pool moves them to area `writing`. `tasks`: Build an email (mock task, points, parts: `fixed` formulas and `free` lines built on a `frame` with `glue` connectors).
