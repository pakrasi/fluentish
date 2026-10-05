# Fluentish architecture

This is the merged plan: the architecture plan (v1), with the principal-engineer review's **amended decisions** applied everywhere they override it, the UX plan's information architecture, and the design kit. Where the build differs from the plan, the "As built" notes say so. Stage A (this repo's first state) built the foundation; stage B adds Practice, Exam and Look up as feature modules (`docs/CONTRIBUTING-FEATURES.md`); stage C adds results sync, the service worker and the deploy.

## 1. What it is

One app that replaces two: Igloo (chunk bank, drill, the B1 trainer) and the B1 mock-exam app. One daily workflow, one review schedule, one settings page, one exam date set by the learner. Built to grow into an iOS app and into accounts with profiles without a rewrite.

**Information architecture (UX §3):** four tabs, **Today · Practice · Exam · Look up**; Exam shows only when the profile has an exam goal. Settings live under the avatar (`#/profile`). English chrome, target-language content, exam screens in the exam's language. Routes are path-shaped so they map one to one onto an iOS navigation stack and deep links:

`#/today` · `#/practice[/round?kind=…|/write[/build/<task>[/free]]|/speak[/teil2|/aloud]]` · `#/exam[/<test>[/<module>[/review/<attempt>]]]` · `#/lookup[/words|/phrases|/grammar|/frames|/map[?mode=…]]` · `#/profile[/goal|/practice|/connections|/appearance|/data|/diagnostics]` · `#/welcome`.

## 2. Repository layout

```
index.html            the only shell: header, view, tab bar, live region; strict CSP; no inline script or style
404.html              /fluentish/<path> → /fluentish/#/<path> (src/redirect-404.js)
assets/               favicon (the mark)
styles/               tokens.css, motion.css, components.css (design kit, unchanged), paper-shaders.css, app.css
src/
  main.js             boot: storage → profile (+ one-time migration) → prefs → shell → router
  boot.js             pre-paint theme/motion (classic script)
  core/               clock, router, dom, bus, i18n, config, schema, log, ui, icons, motion (kit), brand (kit)
  data/               store, adapters/{idb,memory}, session, settings, migrate, transfer, content, ids
  domain/             pure, tested in node: fsrs, match, detect, speech, timer, readiness, b1ready, days, today
  features/           registry, contract, today/, profile/, welcome/, practice/, exam/, lookup/, explore/ (Look up › Map; palace/ is its 3D view, loaded on demand)
  i18n/               en.js, de.js (partial; falls back to English)
  vendor/paper-shaders/   @paper-design/shaders 0.0.81, vendored (VENDOR.md)
  vendor/newsreader-map/  the map font (OFL) and its advance widths; vendor/palace-sdf/ its prebuilt SDF text atlas for 3D
content/              PUBLIC content + manifest.json (consumed by the app and later iOS)
authoring/            sources built into content/, briefs; never fetched
schemas/              content/*.schema.json, records/*.schema.json
tools/                validators, build_b1/build_turns, build-manifest, validate-content, check-privacy,
                      check-dates, make-fixtures, import_legacy_content, serve, install-hooks
tests/unit/           node:test; tests/fixtures/ (synthetic only); tests/private/ is git-ignored
.githooks/            pre-commit, pre-push (privacy + dates)
.github/workflows/ci.yml
docs/                 ARCHITECTURE.md (this), DESIGN.md, SCHEMA.md, CONTRIBUTING-FEATURES.md
```

**No bundler, no framework.** Native ES modules run in Safari 17+ and node 22+; the domain code is tested with plain `import`. The deploy step (stage C) is the only build: it stamps the version, writes the manifest and copies publishable folders. Revisit esbuild only if first load on 4G exceeds 2 s or TypeScript sources are adopted. Types: JSDoc + `tsc --checkJs`, **strict and blocking** on `core`, `data` and the new domain modules; the ported domain modules are typed through `.d.ts` files where strict code imports them and checked non-strict (advisory) until annotated.

## 3. Data layer

### 3.1 Store (`src/data/store.js`)

Reads are synchronous from an in-memory cache filled when the store opens; writes update the cache and go to the adapter. **Cards, attempts and events are per-record and written through at once** (iOS can kill an async transaction; a 300 KB blob per answer is wasteful). Small collections that change in bursts (`settings`, `prefs`, `ui`, `activity`) are debounced 250 ms and flushed on `pagehide`/`visibilitychange`. Other tabs learn of writes over `BroadcastChannel('fluentish')` and reload that part; the event `seq` stays monotonic across tabs.

Adapters implement one interface (documented in `store.js`): `idb.js` (database `fluentish`, version 2, stores `device`, `profiles`, `kv [scope, name]`, `cards [profileId, deck, id]`, `attempts`, `outbox`, `blobs`, `archive`; reconnects when iOS closes the connection) and `memory.js` (the reference implementation, used by tests and as the fallback when the browser blocks storage). A server adapter (phase 4) implements the same interface; features don't change.

**Bounded outbox** (`data/archive.js`): at each start, events older than 30 days that a sync target acknowledged (or that no target ever sends: Script mode's local reviews, `legacy.imported`) move from `outbox` to `archive` in one transaction (version 2 only added that store). Events still pending for any target stay, and so do `exam.voice` events (the Exam tab lists them). Nothing is deleted; Export reads the archive too; the start loads only pending and recent events.

**Collections:** `settings` (profile, synced, merged per field by a hybrid logical clock), `prefs` (device, never synced), `secrets` (device, never synced or exported), `meta`, `activity`, `ui`, and the carried-over `b1.session`, `exams.*`, `vocab.*`. Formats: `docs/SCHEMA.md`.

**Identity seam:** every record carries `profileId`; profiles are local today (`kind: 'local'`), `'shadow'` marks a preview copy that never syncs (merged into the local profile and archived at the cutover), `'remote'` arrives with accounts. Record ids are UUIDv7; timestamps keep the device offset; mutable records carry an HLC `rev`.

### 3.2 Events and sync

Events (`event@1`) are append-only and the unit of sync: `{id, v, profileId, deviceId, seq, at, day, type, payload, synced, path}`. **`card.reviewed` carries `ctx`, `base` and `post`** so another device or a server can rebuild a card without replaying load balancing; events are the source of truth and card snapshots a cache.

Features reach sync only through the seam `data/sync/index.js`: `results(store).record(type, payload)` appends a result event, `results(store).ref(event)` is the name the target files it under, and `sync(store)` flushes. Sync targets implement `push(events) → {acked, rejected, error}` and `pull(cursor) → {cursor, docs, changed}` with an opaque cursor. Until accounts exist, the target is the private results repository through the GitHub Contents API (`sync/github-b1exam.js`, stage C): it writes the exact files the Mac's `sync.py` imports and **derives each event's file path itself** from its type, payload and creation time (`YYYYMMDDTHHMMSS-…` in UTC, `pathOf`), so a retry writes the same file; events from before the seam keep the `path` they stored and are sent under it. It treats `422 sha` as acked, keeps voice blobs in IDB until both uploads succeed, and reads with ETags. One tab flushes at a time (Web Locks). The sync contract test runs the real `sync.py` over what the seam writes and pins the file names.

**Progress backup** (`sync/backup.js`, roadmap item 1). The same flush, on the same consent (a linked device, uploads allowed after the import notice, never a preview profile, one flush a minute, stopped by a connection or token error), backs up the learning events (`card.reviewed`, `card.marked_known`, `card.unmarked_known`, `settings.changed`) to the private results repository as one NDJSON file per device per study day, `data/events/<deviceId>/<day>.ndjson`, at most every 5 minutes unless "Back up now". This device is the only writer of its folder: a file is read with its sha, the new lines are merged in by id, and it is written back with the sha (a stale sha reads again), so lines are only ever added. Written events are marked `synced`. Today's snapshot of the cards (every deck except `script`) and the learning collections goes to `data/snapshots/<deviceId>/<day>.json.gz` (gzip through `CompressionStream`; plain `.json` without it), rewritten in place at most every 6 hours when it changed; a profile without cards writes none, and "Delete all" gives the device a new id so a fresh start never writes over an old folder. Script mode's data (kv `scripts*`, deck `script`, reviews marked `local`), secrets and device prefs never leave the device; every body is checked for this device's secrets, token-shaped strings and script marks before it is sent, and a hit blocks the upload. `sync.py` reads only its own folders and never sees `data/events/`, `data/snapshots/` or `data/logs/` (the contract test runs it with them present). Formats: `docs/SCHEMA.md`.

**Restore and the cross-device merge** (`data/restore.js`, rule in `domain/cardmerge.js`). Profile › Data › Restore from backup lists the devices and days found, reads each device's newest snapshot and every event file, and shows the counts before anything changes. Cards merge by the B4 rule: the snapshots and this device's cards are joined (per card the newest record: larger `u`, then `reps`, then a fixed canonical tie-break, so the order of inputs never matters), then every learning event is replayed in one total order (time, device, seq, id): `post` is taken when the card matches `base`, otherwise only when `post` is newer. Collections merge by their rule (settings per field by HLC, fields never stamped are filled from the backup; activity per day; mistakes by id, deletions kept; the rest only when empty here). Script mode's deck and collections are never read or written. The plan is made again at apply time from the cards as they are then. Applying is journaled in the device kv `backup.journal`: the before-image of every record it changes is written first, then the records, then a read-back; a failed read-back puts the before-image back at once, and a start that finds the journal still `applying` (a killed tab) puts it back before the store opens. "Undo restore" puts back only records the restore left untouched since, and turns the automatic merge off. The **automatic merge** is a one-time opt-in per device (kv `backup.autoMerge`); it reads only the other devices' files whose sha changed, at most every 30 minutes, and only while the app is on Today or Profile. Tests: round trip, a two-device convergence plus a seeded fuzz of 1,000 random histories with stale snapshots, idempotency, a cut-off restore, a failed write, undo, and privacy on the way back.

Conflict policy: insert-only records are idempotent by id; cards merge by event order (`day`, `at`, `deviceId`, `seq`), first answer of the day writes; settings per field by HLC; exam drafts are device-local; a vocab tombstone beats later reviews.

### 3.3 Content

`content/manifest.json` is the single entry point (`docs/SCHEMA.md`): files by id with schema, size and sha256, plus the languages and each exam's module limits and pass lines. The app loads files with `?h=<sha8>`. CI validates every file against its schema and checks the manifest is current. Content files keep their shapes (no envelope); a breaking change bumps the schema and the path.

**Speaking situations** (`content/speak/situations.json`, built from `authoring/speak/situations.json` by `tools/build-speak.mjs`; rules in `src/features/practice/sim.js`): about 200 everyday situations, A1 to B2, each a card `SS:<fn>-<nn>` in its own deck `speak` of the one FSRS schedule, so the B1 review count and readiness never include them. **Audio decision:** every line has a neural clip named `md5("<voice>|<text>").mp3` (monolingual de-DE edge-tts voices: three for the other person, a fourth for the model answer), synthesised by `tools/build_speak_audio.py` into the git-ignored `media/speak/` and published next to the exam audio, at `<exam media>/speak/` (`b1-exam/docs/audio/speak/` → `https://pakrasi.github.io/b1-exam/audio/speak/`), about 10 MB. Same origin as the exam and word audio, so the CSP is unchanged; nothing large enters this repository. The dev server serves `media/speak/` and the app tries it first on localhost; when no clip plays, the device's German voice reads the line. The July and August audiobooks were mined for their phrases (items marked `src: "audiobook"`); their per-phrase clips were not reused: the build kept them only in deleted temp folders, the finished .m4b files interleave English prompts and pauses, and they were read by a multilingual voice.

## 4. Privacy and security

The repo is public; a learner's results, recordings, vocab, mistakes and keys never enter it.

- `content/` is shared material only. The import dropped B1 items mined from one learner's own exams (`src: "mine…"` and those naming his tutor), per-learner grammar evidence, the list of phrases on his Anki cards, and his name and employer in the Igloo self-introduction examples (replaced by a neutral persona). Such items go to a **private pack** in the results repository, loaded with the token and merged at runtime (stage B/C).
- The grader prompt (stage B) is a public template with a `{learner_profile}` slot filled from a private `learner.json` in the results repository.
- Fixtures are **synthetic** (`tools/make-fixtures.mjs`); real exports live only in the git-ignored `tests/private/`.
- `tools/check-privacy.mjs` runs as **pre-commit** (staged files) and **pre-push** (all files) hooks (`sh tools/install-hooks.sh`), in CI, and (stage C) on the built `_site/`. Rules: private data paths, tokens, local paths, mined items, grader profiles, media and database files, files over 5 MB, legacy dumps in unmarked fixtures, plus personal terms from a git-ignored `.privacy-terms`. Reviewed exceptions: `tools/privacy-allow.json`.
- **No third-party runtime JavaScript** on an origin that holds tokens: Paper Shaders is vendored. Fonts stay on Google Fonts (they can't execute); self-host them before launch.
- **CSP** (meta): `default-src 'self'; script-src 'self'; style-src 'self' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: pakrasi.github.io; connect-src 'self' api.github.com api.anthropic.com; object-src 'none'; base-uri 'none'; form-action 'none'`. No inline scripts or styles; styles go through the CSSOM.
- `core/dom.js` has no `html` attribute and refuses `javascript:` URLs; a unit test fails on `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` in `src/`.
- Secrets: the Claude key and the fine-grained GitHub token (one repository, Contents read/write, ≤ 90 days) stay on the device, are never exported or synced; Settings shows the token expiry from GitHub's response header. Phase 4 moves the Claude call behind a server proxy and drops the token.
- The service worker (stage C) will not intercept media (Safari range requests) and its kill switch only unregisters registrations whose scope is `/fluentish/`.

## 5. The exam date

**One source:** `settings.exam.date` (`'YYYY-MM-DD'` or `null`), read **only** through `core/clock.js`, written **only** by `setExamDate()` in `data/settings.js`. No date literal exists in `src/` (CI and the pre-commit hook fail on one); new profiles have no date; a migrated profile keeps the date the old apps stored, and none is assumed when there was none.

`clock.js` is pure (now, exam date and the 04:00 cutoff are passed in) and exposes `today()`, `epochDay()` (Igloo's SM-2 unit), `phase()`, `context()`, Intl labels and `createClock()` for the app. `?today=YYYY-MM-DD` works on localhost only.

| Phase | When | Effect |
|---|---|---|
| `none` | no date | no countdown, no caps; FSRS and readiness use the `after` rules (retention 0.90, recall measured today); Today offers "Set an exam date" |
| `week` | ≥ 3 days | countdown and runway; new items allowed; reviews capped at exam−1, load-balanced over exam−3…exam−1 |
| `lastNew` | exam−2 | last day for new items |
| `eve` | exam−1 | no mock, no new items: reviews and the Sprechen frames |
| `day` | exam day | a 3-minute warm-up only; FSRS writes nothing |
| `after` | past | cap lifted, normal budget; "Set your next exam" |

Readiness is measured on a set that never depends on the date (the whole B1 pool, mistakes excluded): expected recall on the exam day, or today without a date. Moving the date changes the day it is measured on, never the set. The exam cap on review dates (no review after exam−1 unless it will still be recalled on the day) is applied when due dates are **read** (`b1ready.dueOn`), so changing the date never writes a card: 9 → 5 → 9 leaves every card and count as it was (tested). Profile restates what the date controls under the field ("6 days left. New items stop Wed 7 Oct. Reviews end Thu 8 Oct."); the line is live, so there is no toast.

How much a day holds has one answer: `domain/budget.js dayBudget()` (new items, rounds, minutes, pace). Today's plan row and button, Practice's hub and pace line and the round's quota all read it. Igloo's carried-over "new items per day" counts as Auto (a number counts only when chosen here, with a rev stamp).

Results sync after a migration uploads nothing until the import notice has been seen; old unsent items from the legacy apps go only after the learner's tap (`ui.sendLegacy`). A Sprechen take in progress is written to IndexedDB every 2 seconds (`exams.takeInProgress` + blob `take:<id>`) and recovered on the next start.

## 6. Migration from the old apps

One-time per device and **read-only on the legacy keys** (`data/migrate.js`, `data/session.js`): on first run with no profile, the known legacy keys are copied out of localStorage, planned (pure function), and written to a new profile; the learner skips onboarding and Today shows "Imported N cards from Igloo, M exam attempts…" once (kept in Profile > Data). Scope (review A4): B1 FSRS cards and session, exam attempts (with legacy id and path, and `synced:false` kept so the outbox re-sends), drafts, training texts, voice-note list, local feedback, saved words, the exam date, the keys (`anthropic:key` first, then the raw `doors.apikey`; `gh:token`), the theme. Igloo's SM-2 deck stays owned by Igloo until Drill and Test move here (counted only). Caches are rebuilt. A per-key fingerprint is recorded for the **delta re-merge**: for 7 days after the redirect stubs go live, a boot that finds a changed legacy key merges only that delta (cards: newer `u` wins; attempts by id; `remote:*` by path). "Delete all" forgets the device's migration marker, so the next start imports from the untouched legacy keys again (or goes to onboarding when there are none). Leaving shadow mode (`data/cutover.js`, `session.js keepPreview`): on the first local boot, a device whose active profile is a preview (`shadow`) profile keeps the real profile (or makes it and runs the migration as on a first run), **merges every preview profile into it** (cards: the newer last review wins, logs united; attempts, events, recordings, corrections, mistakes, drafts, settings and the day log united by id, newest per item), queues the preview's results unsent with their original file names, reads the result back, and only then archives the preview (`archivedAt`); it is purged 30 days later. `device.cutover` records each step first, so a cut-off boot resumes; the notice on Today says what was kept. Rules in docs/CUTOVER.md.

**One writer per collection, always.** There is no adapter that writes the legacy keys. Before cutover the app runs only in **shadow mode** (`?shadow`, or before `fluentish.migrated`): its own IDB profile of kind `shadow`, no outbox flush, a persistent banner.

## 7. Phases and cutover

| Phase | When | Work |
|---|---|---|
| Freeze | until the exam (9 Oct) | repo-local only; **no deploy of any kind** to `pakrasi.github.io/fluentish/` (a service worker or IDB on the shared origin could touch the daily loop). Old apps get P0 fixes only. Stage A and B work happens here. |
| Shadow | 10–12 Oct | first deploy, shadow mode; try it on the iPhone (Safari tab, not the Home Screen: separate storage) and the Mac; dry run against real exports in `tests/private/` |
| Cutover | 13–16 Oct | B1 and the exam app only: migrate, redirect the exam app (all hashes) and Igloo `#b1*` (a hash guard in `app.html`); Igloo keeps its SW and other routes. Gate: one attempt per module type reaches `b1-review.py status`, Fritz's feedback shows on the review page, a saved word reaches `vocab-todo`, card counts match on iPhone and Mac, plus the manual iPhone checklist |
| Clean-up | ~25 Oct | Drill, Test, Write, Look up ported; Igloo SM-2 migrated; remaining Igloo routes redirected; results `progress.json` and the vocab audio manifest made private; `com.pakrasi.b1-sync` LaunchAgent before the server is called optional |
| Growth | later | accounts and a server, iOS, a media repository |

The router keeps the legacy hash map (`core/router.js mapLegacy`): `#b1…`, `#drill`, `#test`, `#write/<id>`, `#lookup/<tab>` from Igloo and `#/tag/N[/m][?review=ID]`, `#/woerter`, `#/training`, `#/fortschritt`, `#/einstellungen`, `#/export` from the exam app.

**Deploy (stage C):** `deploy.yml` after CI on `main`; immutable `/fluentish/v/<sha>/` code paths with the previous two versions kept, network-first `index.html` with `modulepreload`, content addressed by hash, Pages source "GitHub Actions" so `tools/`, `tests/`, `authoring/` are never published. **No web manifest until phase 4** (the iOS Home Screen container has separate storage). The SW applies updates only from Today.

## 8. Quality gates

Stage A: unit tests (node:test, in a New York / Berlin / Kolkata matrix in CI): the ported `test_match`, `test_b1`, `test_readiness` with unchanged assertions, plus clock, FSRS-with-dates, schema, store, migration, router and Today-plan tests; `tsc` strict; content schemas, the manifest and every ported validator; built content matches its sources; privacy and date gates as hooks and in CI. Later stages add: `@playwright/test` e2e in WebKit (iPhone) and Chromium with axe (serious/critical block), a Trusted Types tripwire, golden vectors in `tests/vectors/` for a Swift port, a contract test against the real `sync.py`, and the written manual iPhone checklist.

**Accessibility:** focus moves to the view's `<h1>` on route change; the tab bar is a `<nav>` with `aria-current`; live regions for announcements; targets ≥ 44 px; text in the kit's sizes, inputs ≥ 16 px; `lang` on target-language text; every effect has a reduced-motion path (`html[data-motion]` is a user setting).

**i18n:** chrome strings through `t()` with `en` and `de` catalogs; dates through `Intl`.

**Diagnostics:** an in-memory error log and storage/outbox/device facts in Profile > Diagnostics. Persisting the log and the daily scrubbed upload come with sync.

## 9. Phase 4 (recorded so today's choices point at it)

Supabase (Postgres + RLS + Auth with anonymous-to-linked accounts, Sign in with Apple, email codes; Storage for recordings), a Claude proxy as an Edge Function (platform key, per-user quotas, optional bring-your-own key encrypted with Vault), Cloudflare R2 for public media, a custom domain, a Capacitor iOS shell (native speech, notifications, filesystem content packs, Sign in with Apple, share sheet, haptics) with platform services behind interfaces, and re-licensed TTS audio. Native SwiftUI stays possible: it would read `content/manifest.json` and the schemas directly and run the JS domain core in JavaScriptCore or a Swift port tested against the golden vectors.

## 10. Stage A: built, deferred, and where it differs from the plan

Built: the layout above, content and authoring with validators, schemas and the manifest, the ESM domain modules and clock, the store with both adapters, the migration, the shell, Today, Profile, onboarding, placeholders for the stage-B features, hooks and CI.

Differs from the plan, on purpose:
- A missing legacy exam date is **not** defaulted (the plan said keep the old default); BUILD's no-hard-coded-dates rule wins and the summary says "No exam date was set".
- The mock-exam pass lines and module limits live in the content manifest, not in code.
- Today lets one mock module run over the daily minutes (a timed module can't be split).
- `<select>` is not used (WebKit reports it under the CSP); choices are chips.
- `validate_beginner.py` and `check_word_part.py` were not ported (the first is obsolete since `beginner_en.json` merged into `en.json`; the second reads a learner's own word list).

Deferred to later stages: the results-sync adapter and outbox flush; the Claude service and grader template; Practice, Exam and Look up; delta re-merge and restore-from-backup (restore-from-backup built since: §3.2); persisted diagnostics; e2e/axe; golden vectors; annotating the ported domain modules for strict types; self-hosted fonts; LICENSE files (the owner chooses the licence).
