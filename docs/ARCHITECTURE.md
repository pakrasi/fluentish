# Fluentish architecture

This is the merged plan: the architecture plan (v1), with the principal-engineer review's **amended decisions** applied everywhere they override it, the UX plan's information architecture, and the design kit. Where the build differs from the plan, the "As built" notes say so. Stage A (this repo's first state) built the foundation; stage B adds Practice, Exam and Look up as feature modules (`docs/CONTRIBUTING-FEATURES.md`); stage C adds results sync, the service worker and the deploy. Rounds 2 to 5 are described in the sections they changed; this file is kept current with the code (last checked at `beb84c7`, round 5). Next steps are in `docs/ROADMAP.md`, the build history in `docs/history/`.

## 1. What it is

One app that replaces two: Igloo (chunk bank, drill, the B1 trainer) and the B1 mock-exam app. One daily workflow, one review schedule, one settings page, one exam date set by the learner. Built to grow into an iOS app and into accounts with profiles without a rewrite.

**Information architecture (UX §3):** four tabs, **Today · Practice · Exam · Look up**; Exam shows only when the profile has an exam goal. Settings live under the avatar (`#/profile`). English chrome, target-language content, exam screens in the exam's language. Routes are path-shaped so they map one to one onto an iOS navigation stack and deep links:

`#/today[/progress]` · `#/practice[/round?kind=…|/write[/build/<task>[/free]]|/speak[/teil2|/aloud/check]|/situations[/round?pick=…]|/scripts[/…]|/clusters[/…]|/sort|/known|/build[/…]|/read[/…]|/conversation[/…]|/words]` · `#/exam[/<test>[/<module>[/review/<attempt>]]]` · `#/lookup[/words|/phrases|/grammar|/frames|/map[?mode=…]]` · `#/profile[/goal|/week|/practice|/connections|/appearance|/data|/diagnostics]` · `#/welcome`. The registry (`src/features/registry.js`) is the full list.

## 2. Repository layout

```
index.html            the only shell: header, view, tab bar, live region; strict CSP; no inline script or style
404.html              /fluentish/<path> → /fluentish/#/<path> (src/redirect-404.js)
assets/               favicon (the mark)
styles/               tokens.css, motion.css, components.css (design kit, unchanged), paper-shaders.css, app.css
src/
  main.js             boot: storage → profile (+ one-time migration) → prefs → shell → router
  boot.js             pre-paint theme/motion (classic script)
  core/               clock, router, dom, bus, i18n, config, schema, log, ui, icons, motion (kit), brand (kit),
                      lang (the study language: lang/dir attributes, BCP-47, ASR locale, voice choice, the active
                      language pack), link (device link)
  lang/               language packs (§2.3): types.js (the LanguagePack interface), registry.js (the ten languages,
                      the active pack), de/ (German: text, grading, syntax, detectors, forms, morphology)
  services/           platform services behind interfaces (§2.2): speech, level, voice, audio, recorder, share, haptics;
                      claude (ask, stream), prompts/ (versioned, hash-pinned templates), sw
  data/               store, adapters/{idb,memory}, session, settings, migrate, transfer, content, ids
  domain/             pure, tested in node: fsrs, match, detect, speech, timer, readiness, b1ready, days, today
                      (match, detect, punct and forms are language-neutral engines over a language pack);
                      text/ is the text layer Scripts, Reading and Conversation share (§2.3)
  features/           registry, contract, day; today/ (progress/ is Today › Progress), profile/ (goals, the week
                      editor, backup), welcome/, exam/, lookup/, explore/ (Look up › Map; palace/ is its 3D view,
                      loaded on demand); Practice as sibling features: practice/ (hub, exam words), practice-round/,
                      practice-write/, practice-speak/, practice-script/, practice-clusters/ (clusters, Quick sort),
                      build/ (Word building), practice-read/ (the Reader), practice-conversation/; shared/ is the
                      practice runtime they share (a library). Features never import each other (§2.1)
  i18n/               en.js, de.js (partial; falls back to English)
  vendor/paper-shaders/   @paper-design/shaders 0.0.81, vendored (VENDOR.md)
  vendor/newsreader-map/  the map font (OFL) and its advance widths; vendor/palace-sdf/ its prebuilt SDF text atlas for 3D
content/              PUBLIC content + manifest.json (consumed by the app and later iOS)
authoring/            sources built into content/, briefs; never fetched
schemas/              content/*.schema.json, records/*.schema.json
tools/                validators, build_b1/build_turns, build-manifest, validate-content, check-privacy,
                      check-dates, make-fixtures, import_legacy_content, serve, install-hooks
tests/unit/           node:test; tests/fixtures/ (synthetic only); tests/private/ is git-ignored
tests/e2e/            @playwright/test against the stamped _site/ (WebKit 390 px, Chromium desktop), axe; §8
.githooks/            pre-commit, pre-push (privacy + dates)
.github/workflows/    ci.yml (the gates, the e2e included), deploy.yml (Pages, after ci)
docs/                 ARCHITECTURE.md (this), DESIGN.md, SCHEMA.md, CONTRIBUTING-FEATURES.md, SHARING.md, IOS-CHECKS.md,
                      CUTOVER.md, ROADMAP.md (next steps), LEARNINGS.md, history/ (rounds and historical specs)
```

### 2.1 Module graph

Layers, checked by `tests/unit/feature-graph.test.mjs` over every static, dynamic and JSDoc import:

| From | May import |
|---|---|
| `domain/` | `domain/` and `lang/` only (pure; a JSDoc type from `core/clock.js` loads nothing) |
| `lang/` | `lang/` only (pure: the language packs) |
| `core/`, `data/`, `services/`, `i18n/` | each other and `domain/`; never `features/` |
| `features/<id>/` | core, data, domain, services, i18n, vendor, the kernel (`features/*.js`), `features/shared/`; never another feature |
| `features/shared/` | the same, never a feature |
| `features/registry.js` | feature view, plan and boot modules, lazily |
| `main.js` | core, data, services and `features/registry.js` only |

### 2.2 Platform services

Everything that touches the device goes through `src/services/`, so the iOS shell (Capacitor) can swap in a native
implementation with one setter and every caller stays as it is (Arch #8, round 3). Every call takes a BCP-47 tag from
`core/lang.js`; no feature writes `de-DE` (a unit lint checks it).

| Service | Interface | Native later |
|---|---|---|
| `speech.js` | `speech().listen({lang, hold, check, onLevel, onPhase})` (every alternative with its confidence; a session that ends early restarted inside the attempt; a take ended when its words stop changing; a ~1 s noise check once a minute), `noise()`, `checkNoise()`, `record({onLevel})` (through `recorder.js`, the one MediaRecorder path), `blocked()`, `cancel()`; `setSpeech()`. The rules are `domain/hearing.js` (noise thresholds, restarts, `trust`) | SFSpeechRecognizer |
| `level.js` | `createMeter()` (AnalyserNode RMS → dBFS) and `audioConstraints()` (echo cancellation, noise suppression, gain as ideals; iOS Safari applies echo cancellation only) | AVAudioSession metering |
| `voice.js` | `say(text, bcp47, {prefer, avoid, rate, localOnly, onWord})`, `canSay`, `unlock()` (a silent utterance inside the tap), `hush()`; `setVoice()`. Voices come from the language's list in `core/lang.js`; "Multilingual" voices are never used | AVSpeechSynthesizer |
| `audio.js` | the only player: `clip(url, {stallMs})` (words, situation lines, exam cues, the sound check), `track(url, {limit, used, onCount})` (Hören: preload none, a play counts once it started), `stop()`, `setAudioHooks({duck})`; and word audio `play(content, text, store, bcp47)`. Both start inside the caller's tap; one thing plays at a time | AVAudioSession (ducking, routes, background) |
| `recorder.js` | `createRecorder()` | AVAudioRecorder |
| `share.js` | `shareFile(blob, name)`: the share sheet on a touch device, else a download | share sheet |
| `haptics.js` | `tap()` (`core/motion.js haptic()` calls it); `setHaptics()` | UIImpactFeedbackGenerator |

The real-iPhone checks for these are `docs/IOS-CHECKS.md`.

Practice was 35% of the code in one folder (round 2's assessment). Round 3 split it into sibling features, one per
product, each owning its routes and its Today rows; no route, CSS class, store key or card id changed
(`tests/fixtures/practice-routes.mjs`). Today reads the day's numbers from `domain/allowance.js` and the map's count
from `data/atlas.js`, so it imports no feature.

**No bundler, no framework.** Native ES modules run in Safari 17+ and node 22+; the domain code is tested with plain `import`. The deploy step (stage C) is the only build: it stamps the version, writes the manifest and copies publishable folders. Revisit esbuild only if first load on 4G exceeds 2 s or TypeScript sources are adopted. Types: JSDoc + `tsc --checkJs`, **strict and blocking** on `core`, `data` and the new domain modules; the ported domain modules are typed through `.d.ts` files where strict code imports them and checked non-strict (advisory) until annotated.

### 2.3 Language packs

Everything the app knows about one study language is a language pack (`src/lang/types.js`, Wave C2): its text rules
(normalising, tokenizing, folding), its typo policy's word lists (closed-class words, endings, form changes, minimal
pairs, the umlaut slip), its grammar (gender and articles, cases, the word card's forms, sticky-error detectors,
clause shapes, comma rules) and its speech locales, exams and content ids. `domain/match.js`, `detect.js`, `punct.js`
and `forms.js` hold only the language-neutral engines (alignment, Damerau-Levenshtein, slots, diffs, the typo policy,
the detector runner) and take a pack per call; without one they use the active pack, which `core/lang.js` sets from
`settings.language` (`pack()`). German (`src/lang/de/`) and French (`src/lang/fr/`, C3b) are the full packs;
`lang/registry.js` lists the other eight languages of the manifest as metadata (tag, script, direction, fonts, voices)
so the UI can offer them.

**French** (C3b) proves the interface: elision splits in the tokenizer (`l' ami`, `qu' il`; `aujourd'hui` is one
word), accents stay in the key and a dropped accent is a slip (`grading.slips.marks`) except the meaning pairs
(ou/où, a/à, la/là, du/dû, sur/sûr …) and a final é or és (parlé → parle is the present tense; common nouns in -é keep
the slip); articles, pronouns and prepositions are closed class; gender comes through the article, and an elided `l'`
noun accepts its indefinite article (`l'école`, `une école`) while the word card names the gender; the forms model
shows infinitive, présent, passé composé with its auxiliary, imparfait and futur, and the être agreement note; four
detectors (avoir with an être verb, ne … pas order, agreement after elle, elision) each pass a zero-fire check over
every French sentence of the content (`tests/unit/lang-fr.test.mjs`); `grading.sentenceStart` lets a capital follow
« ». `tests/corpus/grading-corpus.fr.mjs` is the French corpus (0 wrong answers graded right). No engine changed
behaviour for German: the golden vectors and the German corpus are unchanged.

**Verb forms** (round 4, the B2 grader review): `src/lang/de/conj.js` (pack `grammar.verbs`) indexes every verb of the
word list, the forms table, a table of strong base verbs and the prefixed and regular verbs the content uses, by slot
(infinitive, zu-infinitive, participle, person and number). The grader (`pool.js verbIndex` → `data.conj`) uses it so
that a misbuilt form (fallten, geratet) or a prefix swap (gedroht for bedroht) is never a typo, a phrase card's answer
with the model's verb in a form its frame does not take (hat … hinterziehen, um … decken, Die Stadt treffen) is wrong
(detector `verb-form`; on situations, formCheck flags it), and restCheck puts another accepted phrase into the model
only where its verb form fits and no article of the model's noun changes; the sentence shown for the model's own
phrase is the model itself. The polite Sie, Ihnen, Ihr … of a sentence that addresses someone formally are strict in
every item. `tests/corpus/morph-errors.mjs` makes these errors on every phrase, collocation and grammar item (its own
small conjugator), and the corpus test keeps each class at zero graded right.

**The text layer** (round 4, L2a): `domain/text/tokens.js` (sentences and tokens), `suggest.js` (which words to
underline, names and foreign words, card ids) and `estimate.js` (CEFR ranks, personal coverage and its band: easy from
98 %, study from 95 %, stretch from 90 %, else hard) are language-neutral and take a pack per call. The pack supplies
`grammar.morphology.index` (the word list indexed), `lookup` (one word against the list; Scripts' lemma),
`lemma(token, sentence, i, idx)` (a word in its sentence: German joins a separable particle at the end of the clause
to its verb, drops the zu of a zu-infinitive and reads Konjunktiv II and irregular adjective stems), and `reading`
(stop words, the cognate pattern, older spellings, the constructions the level estimate looks for, the foreign-word
checks and the abbreviations a full stop does not end a sentence after). German's are `src/lang/de/lemma.js` and
`reading.js`, moved from `practice-script`; Scripts bind the German pack in `features/practice-script/lemma.js` and
`suggest.js` and in `domain/script/parse.js`. The move changed no Script result (unit tests, parse fixtures and
`script.spec` unchanged). `tests/fixtures/lemma.de.json` is the lemma regression corpus (separable verbs at the clause
end, Funktionsverbgefüge, compounds, Konjunktiv, adjective endings), reviewed in a German pass.

**A course in another language** (`features/shared/course.js`): its review round lives in deck `<lang>:core` and
kv `<lang>.session` (German keeps `b1` and `b1.session`); its pool is the reviewed course file `course.<lang>`
(`tools/build-course.mjs`, phrase cards) and the word list `igloo.words.<lang>` (word cards with the word panel);
its counts go to kv `deck.stats`, which the allowance reads before the course's first card. Practice offers the hub
and the round (other Practice pages are German content and say so); Today has its review row and no exam-date prompt
when the language has no exam; Look up shows its phrases, grammar layer and word list; the map is German's and says so. The move was
byte-identical: the golden vectors and the grading corpus did not change. `tests/unit/lang-contract.test.mjs` is the
tokenizer and normaliser contract for German, French, Hindi and Arabic (the last three as text-only stubs under
`src/lang/{fr,hi,ar}/text.js`); `tests/unit/lang-registry.test.mjs` keeps the registry in step with the manifest.

**Direction and logical CSS** (C3a, Arch #16): every study-language node carries `lang` and `dir` from `core/lang.js`
(`langAttr()`, `dirAttr()`; an English island inside one is `lang="en" dir="ltr"`). `styles/` uses logical properties
(`margin-inline-start`, `padding-inline`, `inset-inline-end`, `border-start-start-radius`, `text-align: start`); the
physical left/right left are boxes centred with `left: 50%` and elements placed by JS from measured coordinates, listed
with the reason in `tests/unit/lang-dir.test.mjs`, which also keeps `lang` and `dir` paired. Bars that grow with
`scaleX` flip their origin under `:dir(rtl)`. The conversion left German rendering pixel-identical (25 screens at
WebKit 390 and Chromium 1280). `tests/e2e/rtl.spec.mjs` forces an Arabic fixture course (metadata-only pack) right to
left and checks that no main screen overflows and the tab bar stays mirrored and usable.

## 3. Data layer

### 3.1 Store (`src/data/store.js`)

Reads are synchronous from an in-memory cache filled when the store opens; writes update the cache and go to the adapter. **Cards, attempts and events are per-record and written through at once** (iOS can kill an async transaction; a 300 KB blob per answer is wasteful). Small collections that change in bursts (`settings`, `prefs`, `ui`, `activity`) are debounced 250 ms and flushed on `pagehide`/`visibilitychange`. Other tabs learn of writes over `BroadcastChannel('fluentish')` and reload that part; the event `seq` stays monotonic across tabs.

Adapters implement one interface (documented in `store.js`): `idb.js` (database `fluentish`, version 2, stores `device`, `profiles`, `kv [scope, name]`, `cards [profileId, deck, id]`, `attempts`, `outbox`, `blobs`, `archive`; reconnects when iOS closes the connection) and `memory.js` (the reference implementation, used by tests and as the fallback when the browser blocks storage). A server adapter (phase 4) implements the same interface; features don't change.

**Bounded outbox** (`data/archive.js`): at each start, events older than 30 days that a sync target acknowledged (or that no target ever sends: Script mode's local reviews, `legacy.imported`) move from `outbox` to `archive` in one transaction (version 2 only added that store). Events still pending for any target stay, and so do `exam.voice` events (the Exam tab lists them). Nothing is deleted; Export reads the archive too; the start loads only pending and recent events.

**Collections:** `settings` (profile, synced, merged per field by a hybrid logical clock), `prefs` (device, never synced), `secrets` (device, never synced or exported), `meta`, `activity`, `ui`, and the carried-over `b1.session`, `exams.*`, `vocab.*`. Formats: `docs/SCHEMA.md`.

**Identity seam:** every record carries `profileId`; profiles are local today (`kind: 'local'`), `'shadow'` marks a preview copy that never syncs (merged into the local profile and archived at the cutover), `'remote'` arrives with accounts. Record ids are UUIDv7; timestamps keep the device offset; mutable records carry an HLC `rev`.

### 3.2 Events and sync

Events (`event@1`) are append-only and the unit of sync: `{id, v, profileId, deviceId, seq, at, day, type, payload, synced, path}`. **`card.reviewed` carries `ctx`, `base` and `post`** so another device or a server can rebuild a card without replaying load balancing; events are the source of truth and card snapshots a cache.

**Connections** (`data/connection.js`, docs/SHARING.md). The results repository is the profile's own setting, `settings.connections.results`; there is no default in code. A profile without one is local only: the seam sends and reads nothing, and the backup, restore, merge, exam words and sync lines are hidden. The owner's devices got their repository and study hours file from a one-time additive migration per profile (`migrateConnections`, `meta.connections`). The device's token is checked with GitHub on link, on Connect and once a study day (`data/sync/token-check.js`: scope, expiry; a classic token with the `repo` scope is refused).

Features reach sync only through the seam `data/sync/index.js`: `results(store).record(type, payload)` appends a result event, `results(store).ref(event)` is the name the target files it under, and `sync(store)` flushes. Sync targets implement `push(events) → {acked, rejected, error}` and `pull(cursor) → {cursor, docs, changed}` with an opaque cursor. Until accounts exist, the target is the private results repository through the GitHub Contents API (`sync/github-b1exam.js`, stage C): it writes the exact files the Mac's `sync.py` imports and **derives each event's file path itself** from its type, payload and creation time (`YYYYMMDDTHHMMSS-…` in UTC, `pathOf`), so a retry writes the same file; events from before the seam keep the `path` they stored and are sent under it. It treats `422 sha` as acked, keeps voice blobs in IDB until both uploads succeed, and reads with ETags. One tab flushes at a time (Web Locks). The sync contract test runs the real `sync.py` over what the seam writes and pins the file names.

**Progress backup** (`sync/backup.js`, roadmap item 1). The same flush, on the same consent (a linked device, uploads allowed after the import notice, never a preview profile, one flush a minute, stopped by a connection or token error), backs up the learning events (`card.reviewed`, `card.marked_known`, `card.unmarked_known`, `card.checked`, `settings.changed`) to the private results repository as one NDJSON file per device per study day, `data/events/<deviceId>/<day>.ndjson`, at most every 5 minutes unless "Back up now". This device is the only writer of its folder: a file is read with its sha, the new lines are merged in by id, and it is written back with the sha (a stale sha reads again), so lines are only ever added. Written events are marked `synced`. Today's snapshot of the cards (every deck except `script`) and the learning collections goes to `data/snapshots/<deviceId>/<day>.json.gz` (gzip through `CompressionStream`; plain `.json` without it), rewritten in place at most every 6 hours when it changed; a profile without cards writes none, and "Delete all" gives the device a new id so a fresh start never writes over an old folder. Script mode's data (kv `scripts*`, deck `script`, reviews marked `local`), secrets and device prefs never leave the device; every body is checked for this device's secrets, token-shaped strings and script marks before it is sent, and a hit blocks the upload. `sync.py` reads only its own folders and never sees `data/events/`, `data/snapshots/` or `data/logs/` (the contract test runs it with them present). Formats: `docs/SCHEMA.md`.

**Progress log** (round 4, `domain/progress.js`, `domain/activity.js`, `data/progress.js`). One record per study day per course in kv `progress.<course>.<YYYY-MM>`: items known, shaky and seen by kind and CEFR level against that day's pool (`domain/knowledge.js`, the definition of Where you stand and the map), the pool's size, the day's new, learnt and missed cards, and the course's minutes per device and kind (`activity` gained `dev`, `by` and `lang`; every feature writes through `data/activity.js`). Written when the app opens and after study; missed days are computed again from the cards and events on the next open; the past is backfilled once per device from the backup's snapshots and events (exact from the first snapshot) and the cards' answer history (estimated before, flagged). It goes in every snapshot as a pattern-named collection (`backup.js SNAPSHOT_PREFIX`), which older readers pass by. Profile › Diagnostics shows "Progress log: N days recorded (M estimated)". Format: `docs/SCHEMA.md` › Progress log.

**Conversation practice** (round 4, lane L4; `features/practice-conversation/`, `domain/conversation.js`, `domain/conversation-feedback.js`, `services/prompts/conversation.js`). Open conversations with Claude in the study language, written, Free chat or Role-play. Each partner turn is one streamed Messages API request (`services/claude.js stream()`: an SSE reader and a message builder, both pure and tested with the stream split anywhere) to `claude-sonnet-5-5` at effort `low` (adaptive thinking is its default and cannot be disabled; at low it mostly skips thinking), with the system prompt in two blocks (the language's, byte-stable; the session's, with the cache breakpoint) and automatic caching of the history. The history is append-only (`commit`): an exchange is saved only after a complete reply, thinking blocks kept unchanged, so the cache and the API's check of earlier turns stay valid; Slower and the closing note are mid-conversation `system` messages after his message. No server fallback on turns: the fallback model (Sonnet 5) rejects mid-conversation system messages. A correction in a reply is marked `<r was="his words">…</r>` and shown only when well formed and `was` is in his last message. The end feedback is one `claude-opus-5-5` request (effort `medium`, structured output, server fallback on) whose JSON is validated before anything shows (`checkFeedback`: copied verbatim from his turn, a small edit, at most 5 shown, at most 3 cards, one per pattern, style and duplicates never carded). Limits: `max_tokens` 1,200 a turn, 600 characters a message; a session at 30 messages, 25 minutes, 120,000 input and 10,000 output tokens (80 %: the closing note; 100 %: the composer closes); a month at his cap (default $3, `conv.spend`, priced from `config.anthropic.prices`). A word of a reply is glossed from the word list on the device; a word it lacks can be asked of `claude-haiku-4-5` after a tap. Transcripts and feedback are device-only (`conv.transcripts`, `conv.feedback`: denied by the snapshot allowlist, left out of exports, scrubbed from the log upload by `backup.js convTexts`); `conv.sessions` holds numbers and ids only. A Talk day of the week plan (`LIVE_SLOTS` has `talk`) gets Today's Conversation row. Formats: `docs/SCHEMA.md` › Conversation.

**Restore and the cross-device merge** (`data/restore.js`, rule in `domain/cardmerge.js`). Profile › Data › Restore from backup lists the devices and days found, reads each device's newest snapshot and every event file, and shows the counts before anything changes. Cards merge by the B4 rule: the snapshots and this device's cards are joined (per card the newest record: larger `u`, then `reps`, then a fixed canonical tie-break, so the order of inputs never matters), then every learning event is replayed in one total order (time, device, seq, id): `post` is taken when the card matches `base`, otherwise only when `post` is newer. Collections merge by their rule (settings per field by HLC, fields never stamped are filled from the backup; activity per day, each device's minutes added up; the progress log per day; mistakes by id, deletions kept; the rest only when empty here). Script mode's deck and collections are never read or written. The plan is made again at apply time from the cards as they are then. Applying is journaled in the device kv `backup.journal`: the before-image of every record it changes is written first, then the records, then a read-back; a failed read-back puts the before-image back at once, and a start that finds the journal still `applying` (a killed tab) puts it back before the store opens. "Undo restore" puts back only records the restore left untouched since, and turns the automatic merge off. The **automatic merge** is a one-time opt-in per device (kv `backup.autoMerge`); it reads only the other devices' files whose sha changed, at most every 30 minutes, and only while the app is on Today or Profile. Tests: round trip, a two-device convergence plus a seeded fuzz of 1,000 random histories with stale snapshots, idempotency, a cut-off restore, a failed write, undo, and privacy on the way back.

Conflict policy: insert-only records are idempotent by id; cards merge by event order (`day`, `at`, `deviceId`, `seq`), first answer of the day writes; settings per field by HLC; exam drafts are device-local; a vocab tombstone beats later reviews.

### 3.3 Content

`content/manifest.json` is the single entry point (`docs/SCHEMA.md`): files by id with schema, size and sha256, plus the languages and each exam's module limits and pass lines. The app loads files with `?h=<sha8>`. CI validates every file against its schema and checks the manifest is current. Content files keep their shapes (no envelope); a breaking change bumps the schema and the path.

**One content pipeline** (C3a, Arch #15). Content is grouped into language packs: the manifest's `packs[<lang>]` lists each language's file ids and `packs.shared` the rest (`docs/SCHEMA.md`). Schema ids are generic (`lexicon@1`, `phrases@1`, `grammar@1` …) with the old ids as aliases (`schemas/content-ids.json`). Validation is two steps for every language: `tools/validate-content.mjs` (manifest current, sha256, every file against its schema, every file in exactly one pack, `reviewedBy`/`reviewedAt` as a pair) and `tools/validate-packs.mjs` (per pack, the same validators for every language: `validate.py`, `validate_sentences.py`, `validate_chunks.py`, `validate_accept.py`, `validate_grammar.py`, each taking the language and its rule plugin from `tools/langrules.py` (how answers fold, whether learners type a transliteration, which grammar item kinds exist), plus the pack's own checks (German: the B1 trainer, clusters, Word building, Schreiben sources) and each exam's validators). German's checks are the ones from before. Adding a language's content is data: its files, named for it, land in its pack and its checks run.

**Per-language precache.** `tools/stamp.mjs` writes `PRECACHE` (shell, code, assets, the manifest and `packs.shared`) and `PACKS` (each pack's files) into `sw.js`. A worker installs `PRECACHE` plus the packs its script URL names (`sw.js?packs=fr`); a plain `sw.js` is German, which is every registration made before courses, so his worker and its precache are as they were. The page (`services/sw.js`) registers the URL for the active course's pack and calls `repack()` when the language changes; the new worker waits and takes over like any update, only on Today. The offline e2e checks that no other language's files are cached.
**Speaking situations** (`content/speak/situations.json`, built from `authoring/speak/situations.json` by `tools/build-speak.mjs`; rules in `src/domain/sim.js`): about 200 everyday situations, A1 to B2, each a card `SS:<fn>-<nn>` in its own deck `speak` of the one FSRS schedule, so the B1 review count and readiness never include them. **Audio decision:** every line has a neural clip named `md5("<voice>|<text>").mp3` (monolingual de-DE edge-tts voices: three for the other person, a fourth for the model answer), synthesised by `tools/build_speak_audio.py` into the git-ignored `media/speak/` and published next to the exam audio, at `<exam media>/speak/` (`b1-exam/docs/audio/speak/` → `https://pakrasi.github.io/b1-exam/audio/speak/`), about 10 MB. Same origin as the exam and word audio, so the CSP is unchanged; nothing large enters this repository. The dev server serves `media/speak/` and the app tries it first on localhost; when no clip plays, the device's German voice reads the line. The July and August audiobooks were mined for their phrases (items marked `src: "audiobook"`); their per-phrase clips were not reused: the build kept them only in deleted temp folders, the finished .m4b files interleave English prompts and pauses, and they were read by a multilingual voice.

**Word building** (`content/build/de.json`, built from `authoring/build/*.de.json` by `tools/build-wordbuild.mjs`; since round 7 the word families are one lazy file per root, `content/build/family/<slug>.json`, with an index in de.json: `content/build/FAMILY-SCHEMA.md`; rules in `src/domain/wordbuild.js validateBuild`, checked in CI with `--check`): the prefix model, 15 root verbs, 170 root × prefix verbs, sentence frames, suffix rules and word chains (trees). It is its own feature (`src/features/build/`, registry id `build`, routes under `#/practice/build`) with its own deck `build` (card ids `PX:`, `PD:`, `PV:`, `PS:`, `SX:`, `PW:`, listed in the shipped-ids ledger) and its share of the day's one allowance of new items (§5.1; setting `practice.buildNew`, default 5, is what it wants), paused while an exam is ahead. Pure logic: `domain/wordbuild.js` (model, ids, chains), `domain/wordbuild-plan.js` (unlock order, rounds, Split or stay), `domain/wordbuild-grade.js` (strict typed grading, in the grading corpus). Knowledge maps `PD:`/`PV:` onto `W:<lemma>` when the verb is in the word list. The word list gained the 103 verbs the content names (`authoring/clusters/words-added.de.json`), which made the Explore map a release (`build-atlas --repack`). Audio: verbs with two readings (umfahren, übersetzen …) have no audio, because the neural and device voices cannot be told which syllable to stress; the stress is shown as a dot under the stressed vowel.

### 3.4 Exams as data

A mock exam is data, read by one engine (round 3, C2b). Goethe B1 is the first definition; nothing in `domain/grade.js` or `src/features/exam/` names a Goethe Teil, answer value or German string.

| Piece | File | What it holds |
|---|---|---|
| Definition (`exam-def@1`) | `content/exams/<id>/exam.json` | sections (modules) → parts → item types (`tf`, `mc`, `match`, `yn`, `who-said`, `writing`, `speaking`); each section's kind (objective, writing, speaking), minutes, maximum, pass line and clock (down, or up as in Hören); each part's minutes, printed first number, layout (`split` text beside its items, `match` situations and a choice list, `list` items under a lead, `block` a recording with its items), the dot paths to its items in a test file, recordings with play limits, reading time and automatic replay; the answer value rules per item type (Goethe: `r`/`f`, `a`/`b`/`c`, ad letters with `0` for none, `ja`/`nein`, `mod`/`a`/`b`); scoring (pass share); media folders; the test file pattern and schema; the locale id; the result-file adapter id |
| Exam-locale (`exam-locale@1`) | `content/exams/<id>/locale.<lang>.json` | the runner's strings in the exam's language (Goethe B1: German with Sie): buttons, instructions per part, play states, the start panel and recorder texts. Read through `exam.tx()` (`features/exam/locale.js`); the English chrome around the exam stays in `src/i18n/en.js` |
| Tests | `content/exams/<id>/dayNN.json` (+ `why/dayNN.json`) | the tests themselves, in the exam's own test schema (`goethe-b1-exam@1`); the definition points into them by path |
| Result-file adapter | `src/domain/exam-results.js` (`ADAPTERS`) | what an attempt, a recording and a correction become as files for the results target. `b1-exam-sync@1` is the format the Mac's `sync.py` imports (`data/attempts/<stamp>-dayNN-<module>.json`, `data/voice/dayNN/…`, `data/feedback-ai/…`, the B1 exam app's attempt shape); `github-b1exam.js` names its files with it |

`tools/build-manifest.mjs` finds every `content/exams/*/exam.json` and writes the manifest's `exams[]` summary from it (modules with minutes, maximum and pass line, `prepMinutes`/`planMinutes`, media base, note, the test numbers, and the ids of the definition and the locale), which is what Today, Profile and the Exam lists read. The Exam feature (`data.js examDef`) loads the definition and the locale with the manifest entry; the section's kind picks the runner; `domain/examdef.js` walks a test by the definition (items in exam order, item types, correct values, offered values, printed numbers) and `domain/grade.js` grades through it. Every Goethe B1 output is pinned by golden vectors captured before the engine became generic: `tests/vectors/exam.goethe-b1.json` (answer keys, item numbers, Teil ids and `grade()` over all 14 tests and 11 answer sheets per module) and `tests/vectors/exam-results.b1-exam.json` (the result files, byte for byte, through the sync target and through the adapter the definition names), plus the `server.py` answer-key test and the `sync.py` contract test.

**Adding an exam (DELF B1, DELE B1 …) is a definition, a locale and, only if its result files differ, an adapter:**

1. Write the tests as `content/exams/<id>/dayNN.json` with a test schema `schemas/content/<id>-exam.schema.json` (`<id>-exam@1`; the manifest assigns it by path). Objective items need an `id`, an `answer` and a `skill`.
2. Write `content/exams/<id>/exam.json` (`exam-def@1`): a section per module with its kind, minutes, max, pass and clock, and per part its item type, layout, first number, paths, recordings and the locale keys of its instruction and summary. DELF B1 as an example: `co` (Compréhension de l'oral, objective, `block` parts with `mc`/`tf` items and recordings heard twice, clock up), `ce` (Compréhension des écrits, objective, `split` and `match` parts), `pe` (Production écrite, writing, one task), `po` (Production orale, speaking, with `prepMinutes: 10`); each section `max: 25`, `pass: 5` (DELF's minimum per section); `locale: "fr"`. `tests/fixtures/exam-synthetic/` is a small French-shaped definition that the unit tests grade with no code of its own.
3. Write `content/exams/<id>/locale.<lang>.json` (`exam-locale@1`) with every key the definition and the exam screens name (`tests/unit/exam-def.test.mjs` lists the screens' keys; copy the Goethe catalog and translate it, in the exam's own register).
4. Results: name `b1-exam-sync@1` when the results go to a repository whose `sync.py` accepts the exam's module ids and test numbers; otherwise add one entry to `ADAPTERS` in `src/domain/exam-results.js` (the attempt file's shape and the three file names) and name it.
5. Run `node tools/build-manifest.mjs`; `npm run check:content` validates the definition, the locale and the tests. The profile's goal (`settings.exam.type`) picks the exam.

What a definition cannot yet express, and so would need engine code: a pass line over the whole exam (DELF's 50 of 100 besides the 5 of 25 per section; the app shows pass lines per module), item types beyond the seven (DELF's short written answers and its "vrai/faux + justification" pairs are not graded automatically), speaking parts other than `plan`, `present` and `questions`, and writing-task fields beyond `situation`, `points`, `quote`, `instruction` and `addressee`. The one-click Schreiben correction (`services/claude.js`) and the Today plan's Schreiben focus (`domain/modules.js writingFocus`) are still Goethe-specific.

## 4. Privacy and security

The repo is public; a learner's results, recordings, vocab, mistakes and keys never enter it.

- `content/` is shared material only. The import dropped B1 items mined from one learner's own exams (`src: "mine…"` and those naming his tutor), per-learner grammar evidence, the list of phrases on his Anki cards, and his name and employer in the Igloo self-introduction examples (replaced by a neutral persona). Such items go to a **private pack** in the results repository, loaded with the token and merged at runtime (stage B/C).
- The grader prompt (stage B) is a public template with a `{learner_profile}` slot filled from a private `learner.json` in the results repository.
- Fixtures are **synthetic** (`tools/make-fixtures.mjs`); real exports live only in the git-ignored `tests/private/`.
- `tools/check-privacy.mjs` runs as **pre-commit** (staged files) and **pre-push** (all files) hooks (`sh tools/install-hooks.sh`), in CI, and (stage C) on the built `_site/`. Rules: private data paths, tokens, local paths, mined items, grader profiles, media and database files, files over 5 MB, legacy dumps in unmarked fixtures, plus personal terms from a git-ignored `.privacy-terms`. Reviewed exceptions: `tools/privacy-allow.json`.
- **No third-party runtime JavaScript** on an origin that holds tokens: Paper Shaders is vendored. Fonts stay on Google Fonts (they can't execute); self-host them before launch.
- **CSP** (meta): `default-src 'self'; script-src 'self'; style-src 'self' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: pakrasi.github.io; connect-src 'self' api.github.com api.anthropic.com; object-src 'none'; base-uri 'none'; form-action 'none'`. No inline scripts or styles; styles go through the CSSOM.
- `core/dom.js` has no `html` attribute and refuses `javascript:` URLs; a unit test fails on `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` in `src/`.
- Secrets: the Claude key and the fine-grained GitHub token (one repository, Contents read/write, ≤ 90 days) stay on the device, are never exported or synced; Profile › Connections shows the token expiry and scope warnings from the token check, and Disconnect this device removes it. Sharing the site with other people: docs/SHARING.md. Phase 4 moves the Claude call behind a server proxy and drops the token.
- The service worker (stage C) will not intercept media (Safari range requests) and its kill switch only unregisters registrations whose scope is `/fluentish/`.

## 5. The exam date

**One source:** the active course's `goal.date` (`'YYYY-MM-DD'` or `null`; `settings.courses`, round 3), read **only** through `core/clock.js` (main.js passes it `data/settings.js examDate()`), written **only** by `setExamDate()` through `setCourse()` in `data/settings.js`. `settings.exam.date` remains as the active course's mirror, written in the same step with the same rev. No date literal exists in `src/` (CI and the pre-commit hook fail on one); new profiles have no date; a migrated profile keeps the date the old apps stored, and none is assumed when there was none.

`clock.js` is pure (now, exam date and the 04:00 cutoff are passed in) and exposes `today()`, `epochDay()` (Igloo's SM-2 unit), `phase()`, `context()`, Intl labels and `createClock()` for the app. `?today=YYYY-MM-DD` works on localhost only.

| Phase | When | Effect |
|---|---|---|
| `none` | no date, or more than 14 days before it | no countdown, no caps; FSRS and readiness use the `after` rules (retention 0.90, recall measured today); Today offers "Set an exam date" only for an exam goal with no date |
| `week` | 14 … 3 days | countdown and runway; new items allowed; an exam deck's card that would be recalled on the day under 0.90 gets one review before it, placed as late as each window day's minutes allow (the eve lightest); side decks keep their own schedule (CONTRIBUTING-FEATURES, the exam window) |
| `lastNew` | exam−2 | last day for new items |
| `eve` | exam−1 | no mock, no new items: reviews and the Sprechen frames |
| `day` | exam day | a 3-minute warm-up only; FSRS writes nothing |
| `after` | past | cap lifted, normal budget; "Set your next exam" |

**The exam window** (round 4, L1a): an exam date is a goal that can sit months ahead, so the phase the day is planned by is `planPhase` (`core/clock.js context().phase`): `none` until exam − 14 (`EXAM_WINDOW`), then the phases above. `days.phase()` itself has no window (a script's delivery date reads it). Before the window the scheduler gives no cap, so when the window opens by the passage of time (the date was seen outside it and is unchanged since), `features/day.js examWindow` writes once per date, through `fsrs.recap`, the review each card owes before the exam by the in-window rule (due after exam − 1 and R on the exam day < 0.95, what `b1ready.dueOn` caps on read), in the course's decks except `script`; kv `exam.window` records it. Setting, moving or removing a date never writes a card. A goal whose exam has no mock definition (`goethe-b2` before its tests, `other`) is date-only (`domain/modules.js hasMockExam`): the countdown and the window work, with no Exam tab, mock, Schreiben focus or half day kept for a mock.

Readiness is measured on a set that never depends on the date (the whole B1 pool, mistakes excluded): expected recall on the exam day, or today without a date. Moving the date changes the day it is measured on, never the set. The exam cap on review dates (no review after exam−1 unless it will still be recalled on the day) is applied when due dates are **read** (`b1ready.dueOn`), so changing the date never writes a card: 9 → 5 → 9 leaves every card and count as it was (tested). Profile restates what the date controls under the field ("6 days left. New items stop Wed 7 Oct. Reviews end Thu 8 Oct."); the line is live, so there is no toast.

**Courses** (round 3, Arch #11-12): a profile has one course per language (`settings.courses`, `activeCourse`); Profile › Courses lists them and "Add a course" (a language becomes addable when its content ships; until then it is listed as later); onboarding makes the first. Switching the active course rewrites the mirror (`language`, `level`, `exam`), so Today, Practice, the clock and the Exam tab follow it. Decks are namespaced (`docs/SCHEMA.md` › Decks and languages).

### 5.1 One daily allowance

How much a day holds has one answer: `domain/budget.js allowance()`, read from the store by `domain/allowance.js dayAllowance()`. Today's rows, hero and button, Practice's hub, every feature's `plan.js` and every round's composer read it; no deck has a cap of its own. Igloo's carried-over "new items per day" counts as Auto (a number counts only when chosen here, with a rev stamp, and then it is the whole day's, every deck included).

- **Decks:** mistakes (`F:`, including mistakes from corrections and conversations), b1 (the daily review round; the B2 layer's `G:`/`K:` items too), writing (Schreiben phrases), speak (situations), script, build (Word building), clusters, read (`de:read`, words and phrases saved in the Reader, `RW:`/`RP:`). A course in another language has `<lang>:core` (§2.3).
- **Mode** from the clock and the learner: `exam` (week, lastNew), `eve`, `day`, `maintenance` (after the exam or no date), `start` (no exam ahead and his first study week, from the earliest study day in any deck).
- **One number of new items** (Auto): what fits in the minutes after every deck's reviews and today's fixed rows (the Schreiben task, script steps), half the day while a mock is planned; at most the decks' wants together and 60 / 40 / 20 (exam / maintenance / first week); never under a small floor. None on the eve or the exam day.
- **Shares:** exam week in a fixed order after a floor each (mistakes, Schreiben when it is the weakest module, b1 at the ★/trap pace, situations, Schreiben otherwise, scripts delivered before the exam); Word building, clusters and other scripts **pause** their new items until after the exam. Maintenance: mistakes first, then in proportion to the wants of b1, script, Word building, clusters, situations, Schreiben. First week: b1 items of his level (8 on 30 minutes), situations from day 3, clusters from day 5 once used, no Schreiben or Word building. A deck that goes over its share (a map pick, "Practice all") uses up the day; the others' shares shrink, lowest value first.
- **Reviews are never limited or hidden.** Every deck's due cards count (`reviews.due`, the number Today's hero and Practice's hub both show: "reviews due today in all your practice"). Each plan row says how many due cards it carries; the composer counts those in the plan and those left out, and Today says plainly when they do not fit ("12 of 58 reviews due today do not fit in 30 min. They stay due, and the least urgent are last."). Rows are ordered by value, so what is left out is the least urgent. Cards in deck b1 that no round can ask (an exam word the triage leaves out today, a deleted mistake) are counted by neither screen (`'b1.session'.stats.outside`).
- **Phase drives the plan:** a mock row only while an exam date is ahead; with Schreiben the weakest module its mock comes first, and on a day too short for the whole module the task from memory (one Aufgabe) is the writing and the mock waits under "If you have time". After the exam: no mock, no Teil 2 talk; scripts (priority 30), Word building (35, even before a first start) and clusters (38) are his goals. Optional rows (Split or stay, side-deck new cards) never take the place of a row left out before them.

### 5.2 Where you stand

One picture of what he knows, one definition, on Today (`features/today/standing.js`, `domain/standing.js`):

- **Known** = `domain/knowledge.js` state `known`: predicted recall now (FSRS R today of the item's best graduated card, from any deck) ≥ 0.90, and no lapse in the last 7 days. A lapse counts **from the next study day**: on the day itself a miss comes back in the round until he types it right, so studying never lowers today's numbers; tomorrow the miss shows (shaky for 7 days) and recall decays from the new, lower stability. "Show me" on a never-seen item is a study step (hist flag `v`), never a lapse. A grammar concept is known from its graduated items only, so starting a new item never lowers it.
- **Per exam module** (with an exam goal): the latest mock score against its pass line (Schreiben and Sprechen from the correction's score line), the module's practice items known of all (Lesen: Lesen phrases and grammar; Schreiben: Schreiben phrases and his mistakes; Sprechen: Sprechen phrases; Hören: mock parts only), the weakest module marked, and one next action taken from the composed plan while study days are left.
- **Words and phrases:** known items of the whole Explore map, of all of them. The map's header and this line call the same function (`features/shared/data.js wordsKnown`: `data/atlas.js totals` over the same scores), so they always agree. It runs Igloo's placement import first (`ensurePlacement`, once a profile), so a migrated profile's first visit to the map counts the same as Today (before round 3 it showed fewer until Practice had loaded its pool). Tested in `tests/unit/explore-next.test.mjs`.
- Without an exam ahead: "This week: N learnt, M missed after being learnt".

The old "Readiness %" (expected recall of the 973-item B1 pool on the exam day, `b1ready.compute`) is gone from Today and the hub; it fell when he studied, because a miss cuts a card's stability and with it its recall on the exam day (7 % → 6 % after a round with one miss, reproduced in `tests/unit/learning-loop.test.mjs`). `compute` still draws Practice's area bars.

Results sync after a migration uploads nothing until the import notice has been seen; old unsent items from the legacy apps go only after the learner's tap (`ui.sendLegacy`). A Sprechen take in progress is written to IndexedDB every 2 seconds (`exams.takeInProgress` + blob `take:<id>`) and recovered on the next start.

## 6. Migration from the old apps

One-time per device and **read-only on the legacy keys** (`data/migrate.js`, `data/session.js`): on first run with no profile, the known legacy keys are copied out of localStorage, planned (pure function), and written to a new profile; the learner skips onboarding and Today shows "Imported N cards from Igloo, M exam attempts…" once (kept in Profile > Data). Scope (review A4): B1 FSRS cards and session, exam attempts (with legacy id and path, and `synced:false` kept so the outbox re-sends), drafts, training texts, voice-note list, local feedback, saved words, the exam date, the keys (`anthropic:key` first, then the raw `doors.apikey`; `gh:token`), the theme. Igloo's SM-2 deck stays owned by Igloo until Drill and Test move here (counted only). Caches are rebuilt. A per-key fingerprint is recorded for the **delta re-merge** (review B2). As built, the cutover uses it once: when it merges a preview, a legacy key the old app changed after the preview read it wins for that key (`data/cutover.js legacyChangedSince`). The boot-time re-merge of later legacy changes (7 days after the redirects: cards newer `u`, attempts by id, `remote:*` by path) was **not built**; since the redirects of 4 Oct only a stale offline Igloo tab could still write those keys. "Delete all" forgets the device's migration marker, so the next start imports from the untouched legacy keys again (or goes to onboarding when there are none). Leaving shadow mode (`data/cutover.js`, `session.js keepPreview`): on the first local boot, a device whose active profile is a preview (`shadow`) profile keeps the real profile (or makes it and runs the migration as on a first run), **merges every preview profile into it** (cards: the newer last review wins, logs united; attempts, events, recordings, corrections, mistakes, drafts, settings and the day log united by id, newest per item), queues the preview's results unsent with their original file names, reads the result back, and only then archives the preview (`archivedAt`); it is purged 30 days later. `device.cutover` records each step first, so a cut-off boot resumes; the notice on Today says what was kept. Rules in docs/CUTOVER.md.

**One writer per collection, always.** There is no adapter that writes the legacy keys. Before cutover the app runs only in **shadow mode** (`?shadow`, or before `fluentish.migrated`): its own IDB profile of kind `shadow`, no outbox flush, a persistent banner.

## 7. Phases and cutover

The plan was a freeze until the exam, then shadow, cutover and clean-up from 10 Oct. It ran earlier, because the preview held real exam-week work worth keeping (docs/CUTOVER.md has the runbook and its status).

| Phase | When | What happened |
|---|---|---|
| Shadow | 4 Oct (morning) | first deploy to `pakrasi.github.io/fluentish/`, in shadow mode (`config.deployShadow: true`, c85d042): preview profiles that never sync, a banner. Real exam-week work was done in the preview |
| Cutover | 4 Oct, 10:12–10:21 | Fluentish left shadow mode (41fec5c): each device merges its preview profiles into its real profile on its first start, then archives them (`archivedAt`, purged after 30 days). The same morning language-doors (c2c395f) and b1-exam (4de23a5) were switched: the B1 trainer and the exam app redirect to Fluentish (all hashes), Igloo keeps Drill, Test, Write and Look up and its own worker |
| Since | 5 Oct | Fluentish is the only writer of B1 and exam data. Progress backup and restore, the sync seam, the bounded outbox and the persisted error log shipped on 5 Oct (§3.2, §8) |
| Clean-up | later (docs/ROADMAP.md) | port Drill, Test, Write and Look up; migrate Igloo's SM-2 deck; redirect the remaining Igloo routes; retire Igloo's worker; the `/b1-review` skill text (CUTOVER step 6, open; `b1-token.py` is done and sends `repo` and `exp`) |
| Since | 5 to 6 Oct | rounds 3 to 5: one learning loop, language packs and exams as data, maintenance and B2, Reader, Conversation, Progress, share-safe connections (docs/history/) |
| Growth | later | accounts and a server, iOS, a media repository (§9, docs/ROADMAP.md) |

Back returns to where you were (`core/scroll.js`, round 8): every history entry the router shows gets a key in `history.state`; the y a view was left at is kept per key (in memory, and in the entry's state for a reload), and Back or Forward to a kept entry scrolls there inside the view's update and again while the view draws the rest after its first async step, until the page is still, the person scrolls, taps or types, or a text field has the focus. New navigations, `replace` and a refresh of the same entry start at the top; `history.scrollRestoration` is `manual`. A link opened before onboarding goes through Welcome as `#/welcome?next=…` (`safeNext`: a path inside the app only) and opens once Welcome is done. A view module that fails to load shows the error view with Try again (reloads the page) and Back to Today.

The router keeps the legacy hash map (`core/router.js mapLegacy`): `#b1…`, `#drill`, `#test`, `#write/<id>`, `#lookup/<tab>` from Igloo and `#/tag/N[/m][?review=ID]`, `#/woerter`, `#/training`, `#/fortschritt`, `#/einstellungen`, `#/export` from the exam app.

**Deploy (stage C):** `deploy.yml` after CI on `main`, and only for a commit whose browser e2e job passed (§8); immutable `/fluentish/v/<sha>/` code paths with the previous two versions kept, network-first `index.html` with `modulepreload`, content addressed by hash, Pages source "GitHub Actions" so `tools/`, `tests/`, `authoring/` are never published. **No web manifest until phase 4** (the iOS Home Screen container has separate storage). The SW applies updates only from Today.

## 8. Quality gates

Stage A: unit tests (node:test, in a New York / Berlin / Kolkata matrix in CI): the ported `test_match`, `test_b1`, `test_readiness` with unchanged assertions, plus clock, FSRS-with-dates, schema, store, migration, router and Today-plan tests; `tsc` strict; content schemas, the manifest and every ported validator; built content matches its sources; privacy and date gates as hooks and in CI. Since then: the grading corpus (zero wrong answers graded right), a contract test that runs the real `sync.py` (skipped where the b1-exam checkout is missing, so in CI), and the manual iPhone checklist (docs/CUTOVER.md).

**Browser e2e** (`tests/e2e/`, round 3; `npm run test:e2e`; the `e2e` job of `ci.yml`, a required check on `main`, and `deploy.yml` deploys only a commit it passed for). `@playwright/test` runs the site the deploy would publish (`tools/stamp.mjs` → `_site/`, served under `/fluentish/` by `tests/e2e/server.mjs`) in WebKit at an iPhone's 390 px and in desktop Chromium, from a synthetic profile written through the app's own data layer:
- specs: boot and the tabs; a typed round to Done (answers stored); a Lesen module answered, submitted and reviewed; an offline reload from the service worker (the spec stops its own server; it waits for the worker's claim and never reloads for it, since in WebKit a navigation the context route fulfils is never handed to the worker), with only the German pack and the shared files precached; an Arabic fixture course forced right to left (`rtl.spec`); I know this and its Undo; Check by typing before I know this on a situation; Quick sort with Undo, in Produce with the typo override, Skip and Recheck by typing (also from Look up › Words); progress backup to a mock results repository, Delete all, Restore from backup; export, Delete all, import; one Word building card; the Explore 2D map and a group sheet; a map group to its group page, a round and back; 3D "Study the gaps here" through the round size picker; the exam words list in Look up; a script's Marked words sheet never outliving its screen; speaking situations heard first, Check with the mic, and Say it aloud's old routes; Hören play limits (two hearings with the automatic second, the reading time, a reload keeps the count) and a situation line played as a recording (`audio.spec`); Export handing a phone's share sheet the file; the device link from `b1-token.py`, with the token kept out of the address, the history, the console, the error ring, the backup and the export (`link.spec`); records checked against `schemas/records` (§3, `data/records.js`);
- the network is sealed: GitHub (an in-memory Contents API that answers only a fake token), Anthropic, fonts and media are answered by route mocks, any other host fails the test, and service workers are blocked (the offline spec's worker serves only its own origin), so no token can reach a real server;
- every test fails on a console error or an uncaught exception, and axe (WCAG 2.1 A/AA) fails on serious and critical findings on each screen it visits.
- a Trusted Types tripwire: the shell is served with `require-trusted-types-for 'script'` and a default policy that refuses HTML and script strings (the service worker's same-origin URL passes), so an HTML string written into the DOM by the app or a vendored library fails the test.
Not covered there: the mic, the speaker and the mute switch, the keyboard, haptics, the share sheet and background behaviour on a real iPhone (the checklists in CUTOVER.md and IOS-CHECKS.md). **Golden vectors** (`tests/vectors/`, round 3): the exact outputs of the grader, FSRS, the clock and the day's allowance for fixed inputs, checked by `tests/unit/vectors.test.mjs`, for a language pack or a Swift port to match byte for byte (`tests/vectors/generate.mjs`).

**Accessibility:** focus moves to the view's `<h1>` on route change; the tab bar is a `<nav>` with `aria-current`; live regions for announcements; targets ≥ 44 px; text in the kit's sizes, inputs ≥ 16 px; `lang` on target-language text; every effect has a reduced-motion path (`html[data-motion]` is a user setting).

**i18n:** chrome strings through `t()` with `en` and `de` catalogs; dates through `Intl`.

**Diagnostics:** the error log (`core/log.js`) is a ring of the last 500 entries kept in IndexedDB (device kv `log`), scrubbed when logged (tokens, keys, Authorization values, URL queries, quoted text), shown with storage/outbox/device facts in Profile > Diagnostics, and uploaded once a study day with the progress backup to `data/logs/<deviceId>/<day>.ndjson` (entries since the last upload; a message holding three words in a row of a script, or a script's title, is replaced before it leaves).

## 9. Phase 4 (recorded so today's choices point at it)

The order and acceptance criteria for these are in `docs/ROADMAP.md` (Later).


Supabase (Postgres + RLS + Auth with anonymous-to-linked accounts, Sign in with Apple, email codes; Storage for recordings), a Claude proxy as an Edge Function (platform key, per-user quotas, optional bring-your-own key encrypted with Vault), Cloudflare R2 for public media, a custom domain, a Capacitor iOS shell (native speech, notifications, filesystem content packs, Sign in with Apple, share sheet, haptics) with platform services behind interfaces, and re-licensed TTS audio. Native SwiftUI stays possible: it would read `content/manifest.json` and the schemas directly and run the JS domain core in JavaScriptCore or a Swift port tested against the golden vectors.

## 10. Stage A: built, deferred, and where it differs from the plan

Built: the layout above, content and authoring with validators, schemas and the manifest, the ESM domain modules and clock, the store with both adapters, the migration, the shell, Today, Profile, onboarding, placeholders for the stage-B features, hooks and CI.

Differs from the plan, on purpose:
- A missing legacy exam date is **not** defaulted (the plan said keep the old default); BUILD's no-hard-coded-dates rule wins and the summary says "No exam date was set".
- The mock-exam pass lines and module limits live in content, not in code: the exam definitions (`content/exams/<id>/exam.json`, §3.4), summarised in the manifest.
- Today lets one mock module run over the daily minutes (a timed module can't be split).
- `<select>` is not used (WebKit reports it under the CSP); choices are chips.
- `validate_beginner.py` and `check_word_part.py` were not ported (the first is obsolete since `beginner_en.json` merged into `en.json`; the second reads a learner's own word list).

Deferred from stage A, and built since: the results sync and its outbox flush (stage C; behind the sync seam `data/sync/index.js`, §3.2); the Claude service and the grader template (`services/claude.js`, prompts versioned in `PROMPTS`); Practice, Exam and Look up (stage B, plus Explore, Word building and Scripts); restore from backup and the cross-device merge (§3.2); persisted diagnostics (§8); browser e2e with axe and a Trusted Types tripwire (round 3, §8); record checks against `schemas/records` in development and tests (round 3, §3).

Also built in round 3: golden vectors (§8), and the grader (`match.js`, `detect.js`, `speech.js`) in strict types, with a ratchet for every other module (`tools/typecheck-ratchet.mjs`: the error count may only fall).

Still deferred, and tracked in `docs/ROADMAP.md`: strict types for the modules under the ratchet; self-hosted fonts; LICENSE files (the owner chooses the licence; content sources and licences are in `content/NOTICE.md`). Dropped: the boot-time delta re-merge (§6).
