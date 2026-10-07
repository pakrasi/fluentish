> **Historical spec, not maintained.** Written 2026-10-05 in round 2 (the assessment that planned round 3) of the Fluentish build as the software architect's scalability assessment (scorecard 5.0/10) and roadmap.
> Copied here and privacy-scrubbed on 2026-10-07: personal data, names, local paths and scores were removed or
> summarised. Where it disagrees with the code, the code and the living docs win: `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` (which keeps the scorecard history).
> What was actually built, and what changed: `docs/history/round3-learning-loop-and-languages.md`.

# Fluentish: architecture assessment, round 2

Read on 2026-10-05 at `main` `6a21b26`, 138 commits in about 36 hours. Everything below was read from the repo, the original review, and the language-doors (Igloo) repo for Igloo's data. `npx tsc` was run with no emit. Unit tests were not run, because they write temp directories.

## Verdict

As a single-learner German B1 app this is a well-built product, about **7.5/10**. The engineering habits are better than most teams': pure domain modules, one clock, a store interface, events that carry `ctx/base/post`, versioned immutable deploys, privacy gates in hooks and on the built site, a strict CSP and no `innerHTML`.

Measured against the end state (10 languages, mobile web, iOS, profiles with roles), the overall scalability score is **5.0/10**. Three structural problems drive that:

1. **His progress exists on one device only.** FSRS cards and `card.reviewed` events never leave IndexedDB. Restore-from-backup (review S4) was not built. This is the biggest risk today, and it doesn't depend on any future plan.
2. **German is in the code, not in data.** The grader, the error detector, the umlaut rules, articles, TTS voices, `lang="de"`, the exam engine, the map's font layout and the deck namespace are all German or Goethe-specific. About 224 hard-coded German/B1 references sit in about 50 files. The 10-language data was carried over and is unused.
3. **Practice is turning into a god-module.** It is 9,418 of 26,914 source lines (35%) in 54 files. Features are coupled to the GitHub sync module, and Today imports Practice internals.

None of these needs a rewrite. All three get much more expensive after a second language or a second user.

---

## 1. Engineering best practices

### Module boundaries and coupling

| Area | Lines | Files | Note |
|---|---|---|---|
| `src/features/practice` | 9,418 | 54 | review rounds, Schreiben builder, speaking situations, scripts, clusters, "I know this", quick sort |
| `src/features/explore` | 3,318 | 8 | 2D map plus hand-written WebGL2 3D (`palace/index.js` 814) |
| `src/domain` | 3,772 | 21 | pure, no DOM |
| `src/features/exam` | 2,047 | 12 | |
| `src/data` | 2,284 | 15 | `cutover.js` alone is 378 |

- **Practice is a god-module.** `round.js` is 794 lines with 25 imports (`round.js:12-36`). It pulls in clusters, known, iknow, speech, Claude, audio and hub widgets. Scripts (`practice/script/`, 25 files), speaking situations (`sim*.js`), Schreiben (`write.js` 558) and clusters are separate products living under one feature folder. The rule "features never import each other" holds only because they all live in the same folder.
- **Features import each other anyway.** `features/today/index.js:16-17` imports `dueTomorrow`, `todayBudget` and `readinessFor` from `practice/plan.js` and `practice/field.js`. `main.js:154` imports `features/exam/data.js` (core depends on a feature).
- **Sync is not behind an interface.** `features/exam/data.js:14` imports `appendResult, attemptFile, pathFor, syncResults` from `data/sync/github-b1exam.js`. `today/index.js:18`, `profile/index.js:16` and `exam/pages.js:8` import from it too. The GitHub file path is stamped into every event (`store.js:160`, `path`). The `push/pull` SyncTarget from review A8 exists only inside the GitHub adapter (`github-b1exam.js:136-140`). There is no generic seam a Supabase target could replace.
- **The domain/UI separation is good.** `src/domain` has no DOM, storage or network access. The only clock leak is a default argument, `fsrs.js:63` `now = Date.now()`. `budget.js`, `today.js` and `knowledge.js` are pure and tested. Features call `new Date()`/`Date.now()` 66 times. Most are timing, but a rule-based check would be cheap.

### Tests
- 50 unit test files, about 6,500 lines and about 367 `test(` calls, run in a 3-timezone matrix (`ci.yml:24-37`). Good coverage includes the grading corpus (zero false accepts), cutover crash-resume, an append-only id check (`item-ids.test.mjs` with `shipped-ids.txt`), and a no-`innerHTML` lint (`router.test.mjs:66`).
- **There is no browser e2e in CI.** No Playwright and no axe in `package.json` or `.github/workflows`. The only Playwright use is the local `tools/cutover/run.sh`. Review A14 (WebKit and Chromium e2e with axe blocking) was not done. Every merge to `main` goes straight to the app he uses daily without ever running in a browser.
- **The sync contract test is skipped in CI.** `exam-sync.test.mjs:188` has `skip: !haveSyncPy`, and CI does not check out b1-exam, so it runs only on the owner's machine.
- Golden vectors (`tests/vectors/`, review S19) don't exist. They are needed for a Swift or server port.

### Typing
- Strict `tsc` covers 43 of 145 files, 7,352 of about 26,900 lines (**27%**) (`tsconfig.json` include list). Of `features/`, only `practice/sim-audio.js` is covered.
- The most safety-critical code is outside strict mode. `domain/match.js` (the grader) and `domain/detect.js` are only in the legacy config, which currently has **14 errors** (12 in `match.js`, 2 in `speech.js`), and CI marks it advisory (`ci.yml:47-49`, `continue-on-error: true`).
- Types are not generated from `schemas/` (review S20). There is real drift: `schemas/records/profile.schema.json:13` sets `additionalProperties: false` with no `archivedAt`/`archivedInto`, yet `data/cutover.js:9` and `session.js:35` write and read them. Records are never validated at runtime; `validate(` is used only in `transfer.js:61`. A server that enforces the schema would reject his profile record.

### Errors and observability
- `core/log.js:1-2` is an in-memory ring of 100 entries, lost on reload. The persisted IDB ring and the daily scrubbed upload (review A16) were not done. There are about 86 empty or comment-only `catch {}` blocks.
- Sync failures are visible only in Profile › Diagnostics on the device where they happened.

### Performance
- Good: lazy feature views (`registry.js:22-29`), `modulepreload`, immutable `v/<sha>/` caching, a per-device bitmap budget for the map (DESIGN.md:224), and 3D loaded on demand.
- Risks:
  - The store loads **every** card, attempt and event into memory at boot (`idb.js:93-98`).
  - `card.reviewed` events are never acknowledged (they are not in `TYPES`, `github-b1exam.js:37`), so the outbox grows with every answer, forever. `store.pending()` filters and sorts it all on every call (`store.js:174`).
  - Six render-blocking stylesheets plus Google Fonts sit in `index.html`.
  - Core precache is 5.7 MB.
  - The grader lexicon loads `igloo.words.de` (1 MB) (`practice/data.js:25`).
  - There is no performance budget in CI.

### Accessibility
Focus moves to `h1`, there is a `nav` with `aria-current`, live regions, 44 px targets, reduced motion as a setting, and List parity for the map. There are no automated checks: no axe, no contrast test. `lang: 'de'` is a literal in 152 places.

### Security
- Good: a strict meta CSP (`index.html:6`, `script-src 'self'`), vendored libraries, `h()` refuses `html`, and `textContent` everywhere.
- Weakness: secrets (a GitHub PAT with write access, and the Anthropic key) live in IndexedDB on the **shared origin** `pakrasi.github.io`. IndexedDB is per origin, not per path, so any script on `language-doors` or `b1-exam`'s Pages can read them. language-doors' `h()` still accepts `html:` (review S8).

### Content pipeline
- Strong: one manifest with sha256 per file (`content/manifest.json`, 75 files, 9.6 MB), schemas, about 12 validators, a CI check that built content matches its sources (`ci.yml:85-92`), and append-only card ids.
- Weak:
  - Two toolchains (Python and Node).
  - Validators are hard-wired to German: `validate_accept.py german`, `validate_chunks.py german`, `validate_grammar.py de`.
  - Schema names are exam-branded (`b1-*@1`, `goethe-b1-*@1`).

### Release process
Deploys use immutable `v/<sha>/` directories with 2 previous versions kept, rollback by sha (`deploy.yml:16-19`), a scoped SW kill switch through a repository variable, a privacy scan of `_site`, and a check that nothing outside the app is published. That is excellent for Pages. What's missing: preview deploys for PRs, a staging profile, and an e2e gate before production.

### Documentation
Extensive and mostly accurate (ARCHITECTURE, SCHEMA, CONTRIBUTING-FEATURES, DESIGN, CUTOVER, README). There is drift:
- `ARCHITECTURE.md:149` still lists "results-sync adapter … Practice, Exam and Look up" as deferred.
- `ARCHITECTURE.md:114` says "no deploy before the exam", while the README says the cutover happened on 4 Oct.
- `CUTOVER.md:5` contradicts `CUTOVER.md:63`.

---

## 2. Multi-language scalability

### What is German or Goethe in code today

| Concern | Where | What is hard-coded |
|---|---|---|
| Answer folding | `match.js:41-42`, `detect.js:6-8` | ä/ö/ü/ß → ae/oe/ue/ss |
| Closed-class words (never typos) | `match.js:43-53` | German articles, pronouns, prepositions, auxiliaries |
| Inflection-aware typo rule | `match.js:143-160` | `ENDINGS` (-ern, -est, -en …), ablaut `formChange`, `SOUNDS` homophones |
| Umlaut minimal pairs | `match.js:162-170` | konnte/könnte, wurde/würde … |
| Grammar detectors | `match.js:352-356`, `503-535`; `detect.js:9-30` | verb-final after `dass/weil`, V2 inversion, haben/sein, comma words, fronted adverbials |
| Punctuation rules | `domain/punct.js` | German comma rules |
| Articles / gender | `atlas.js:25,33`; word ids `das_Mittel` (`clusters.js:23-25`) | der/die/das as a word type |
| Morphology | `clusters.js:1-27` | separable prefixes, -ung/-heit with gender, two-way prepositions (`CASES`: dat/akk/gen) |
| Speech recognition / TTS | `practice/speech.js:27,37`; `services/audio.js:99`; `sim-audio.js:36`; `script/voice.js` | `de-DE`, in four separate places |
| `lang` attribute | 152 `lang: 'de'` literals in features | |
| Exam engine | `domain/grade.js:18-31`; `exam/speaking.js:20,178-185`; `exam/review.js:225`; `services/claude.js:12-21` | Goethe B1 Teile, answer values (`r/f`, `ja/nein`), German UI strings in code, German grader prompt |
| Deck namespace | `data/knowledge.js:8,57`; `practice/data.js:70-100` | deck `'b1'` is both "the German course" and an exam level; `lang: 'german'` default |
| Card ids | `domain/itemids.js` | `K:<chunk id>` uses Igloo's **language-independent** chunk ids (`ENG_CHUNK_0001`), so German and French cards in one deck would collide |
| Profile language | `data/settings.js:13-23` | one `language`, one `exam` per profile |
| Lookup | `lookup/sources.js:11-13` | `LANGS = { german }` only |
| Map layout | `tools/build-atlas.mjs`, DESIGN.md:202 | build-time line breaking with a Latin font that has no kerning or ligatures. That can't work for Devanagari or Bengali (conjuncts) or Arabic (contextual shaping, RTL) |
| RTL | styles | 139 physical `left/right` properties, 0 logical; no `dir` handling anywhere in `src` |

### What is already data
- `manifest.languages` has `script`, `rtl`, `full` and `content` per language (10 entries).
- `tokens.css:169-171` switches fonts by `lang` for Devanagari, Bengali and Arabic.
- Exam pass lines and limits live in the manifest.
- i18n chrome goes through `t()`.

### Igloo's 10-language data: carried, but not wired up
`content/igloo/chunks/*.json` (1,450 phrases × 10 languages, with transliteration `tr` and examples), `sentences/*.json` (10 languages, tokenised with roles and transliteration) and `lang/*.json` (the 5 "full" languages) are all in the manifest and validated in CI. The framework is language-independent. **No code consumes them except German.** Two things are left behind in language-doors:
- the per-language drill and test functionality (phase 3 was never ported);
- the learner's Igloo SM-2 progress (`doors.srs.v1`, keys `lang|id`). It stays in localStorage on the shared origin, and Fluentish reads only the `german|` slice (`domain/knowledge.js:165`).

### What has to become a language pack
- tokenisation (word regex; Devanagari virama and nukta; Arabic diacritics, tatweel and alef variants; French elision `l'`, `qu'`; Swiss German has no standard spelling);
- normalisation and folding, and which folds are slips and which are errors;
- transliteration as an input method (Hindi, Bengali and Arabic learners will type Latin);
- the closed-class list, inflectional endings and form-change rules for the typo policy;
- the grammar system: whether the language has gender, articles or case, and the verb-forms model;
- sticky-error detectors (pluggable, optional);
- BCP-47 tag, script, direction, fonts, TTS and recognition locales, voice preferences;
- exam frameworks (Goethe for German; DELF/DALF for French; DELE for Spanish; CELI/CILS for Italian; CAPLE for Portuguese; none for Khasi, Swiss German and Hindi).

### What the content pipeline needs for 10 languages
- Manifest `packs[lang]` listing that language's file ids, plus a `course` level that names decks.
- Language-parameterised validators: accept patterns, chunks and grammar for any language, with per-language rule plugins.
- One generic schema family (`lexicon@1`, `phrases@1`, `grammar@1`, `exam-def@1`) with the old ids kept as aliases.
- Lazy per-language precache (`stamp.mjs:31` already keys on `.german|.de`).
- A corpus test per language (the German zero-false-accept corpus becomes the model).
- Native-speaker review as a recorded field in the content (`reviewedBy`, `reviewedAt`).

---

## 3. Platform portability

**iOS: use a Capacitor shell first (as review A17 decided), and keep SwiftUI possible through the shared content and a domain port.** That decision still holds. What has to change now:

| Concern | State | What to change |
|---|---|---|
| Speech recognition | `practice/speech.js` defines a `Speech` interface, but it lives in a feature folder and is hard-wired to `de-DE` | Move it to `services/speech.js` with a `lang` parameter; one implementation per platform |
| TTS | Four implementations (`services/audio.js:85-105`, `sim-audio.js`, `script/voice.js`, `speech.js`), each picking German voices its own way | One `services/voice.js` (`say(text, bcp47, {prefer})`), voices chosen from the pack |
| Recording | `services/recorder.js` is behind an interface. `speech.js:57-60` duplicates MediaRecorder | Use the recorder only |
| Audio playback | `new Audio()` in `exam/player.js:31`, `pages.js:204`, `speaking.js:65`, `sim-audio.js:63` | `services/audio.js` as the only player (background audio, ducking and route changes are native concerns) |
| Storage | `idb.js` behind the store adapter interface (good) | Add an adapter for Capacitor SQLite in the shell. Durable app storage removes most of the IndexedDB eviction risk |
| File system / export | `dom.download` uses `<a download>` | `services/share.js` (share sheet on iOS) |
| Media URLs | absolute `https://pakrasi.github.io/b1-exam/audio/` via the manifest (good) and the CSP | fine; move to R2 or a custom domain later |
| Deep links | path-shaped hash routes (good) | add the custom domain and `apple-app-site-association` together |
| Haptics | `motion.js:181` (switch-input hack) | `services/haptics.js` |
| Domain port | pure ES modules | golden vectors for fsrs, match, clock and budget, so a JavaScriptCore bundle or a Swift port can be checked against them |

**IndexedDB eviction on iOS.** Daily use avoids Safari's 7-day ITP purge. The real risks are "Clear History and Website Data", storage pressure, a new phone, and the Home Screen container (a separate store). `persist()` is requested (`main.js:76`) but is only a hint. **The only real defence is an off-device copy plus restore, and that doesn't exist for cards.** Cross-device (iPhone and Mac) card sets also stay separate until it does.

---

## 4. Profiles, roles and backend

### Holding up
- `profileId` on every record, UUIDv7 ids, `deviceId` and `seq`, an HLC per settings field, tombstones, `kind: local|shadow|remote` with `remoteId`, and per-collection device/profile scope (`store.js:27`).
- Events carry `ctx/base/post` (enforced by the schema).
- Conflict policy is written down (ARCHITECTURE.md:61).
- The cutover merge shows the team can do safe idempotent merges (resume tests).

### Gaps
1. **Learning events never leave the device.** That is the main gap for multi-device, server replay, and safety.
2. Events are tied to the GitHub file layout: `path` on the event, and `dayNN-module` names from sync.py. Feature code imports the adapter directly.
3. **One language and one exam per profile** (`settings.language`, `settings.exam`). The end state needs `profile → courses[]` (language, level, goal, exam date, decks), and the clock reads the active course's exam.
4. Deck ids are not language-scoped (above).
5. No roles at all, and feedback records have no `author/model/promptVersion` (asked for by the review's "the review assistant does not scale" item; `exam/data.js:279-289` stores `model` only).

### Path to a real backend (Supabase, as already decided)
- Tables mirror the collections: `profiles`, `courses`, `cards (profile_id, deck, item_id)`, `events (id uuid pk, profile_id, device_id, seq, day, type, payload jsonb)`, `attempts`, `recordings` (Storage, private bucket), `feedback`, `kv`.
- **RLS:** `profile_id in (select profile_id from memberships where user_id = auth.uid())`.
- **Sync:** `push(events)` is an idempotent insert by id. `pull(cursor)` reads events where `server_seq > cursor`. Cards are rebuilt server-side with the B4 rule, or each device keeps sending snapshots.
- **Claim flow:** anonymous sign-in, then the local profile's events upload, then Sign in with Apple or an email code links the account.

### Roles

| Role | Can | RLS |
|---|---|---|
| learner | own profile, courses, events, recordings | `owner_id = auth.uid()` |
| reviewer (a tutor, or the review assistant) | read a linked learner's attempts and recordings; write `feedback` (`author_id`, `author_kind: 'tutor'|'ai'`) | `memberships(role='reviewer', learner_profile_id)` granted by the learner and revocable |
| content editor | propose and edit content packs; never sees learner data | content tables or PRs to the content repo; validators run in CI or an Edge Function |
| admin | user support, deletion, quotas | service role, audited |

### Secrets
The bring-your-own Anthropic key, sent browser-direct (`services/claude.js` with `anthropic-dangerous-direct-browser-access`), is fine for one user on a dedicated origin and not acceptable for others. The end state is an Edge Function proxy holding the platform key, with per-user quotas and prompts versioned on the server. Optional BYO keys are stored in Vault. The GitHub PAT goes away.

### Privacy
- Export exists (`transfer.js`), "Delete all" exists on the device, and secrets are excluded from export.
- Missing:
  - Server-side deletion: data already in the b1-exam repo stays in git history.
  - A retention policy for recordings.
  - TTS licensing: edge-tts is not cleared for redistribution (review N4).
  - LICENSE files.
  - App Store 5.1.1(v) account deletion.

---

## 5. Scorecard

| Dimension | Score | Evidence |
|---|---|---|
| Code quality | **6.5** | Clear conventions, pure domain, documented contracts, no `innerHTML`. Against that: Practice is 35% of the code; `round.js` is 794 lines; Today→Practice and core→Exam imports; about 86 silent catches; doc drift. |
| Testability | **6.0** | 367 node tests, TZ matrix, zero-false-accept grading corpus, crash-resume tests. Against that: no browser e2e or axe in CI; sync.py contract test skipped in CI; no golden vectors; grader outside strict types. |
| Multi-language readiness | **2.5** | Data for 10 languages carried, manifest has script/rtl, fonts per script. Against that: the matcher, detector, punctuation, articles, morphology, TTS, `lang`, exam engine, decks and settings are all German or Goethe; map layout is Latin-only; no RTL. |
| iOS readiness | **4.5** | Path routes, root from `import.meta.url`, recorder and speech interfaces, store adapter, no CDN. Against that: TTS and audio in four or five places; no durable storage adapter; no share or haptics service; no vectors. |
| Multi-user readiness | **4.0** | Profile seam, UUIDv7, HLC, B4 events. Against that: cards and events device-only; sync not abstracted; one language and exam per profile; schema drift; no runtime validation; no roles or authorship. |
| Content pipeline | **7.0** | Manifest with hashes, schemas, a CI check that built content matches its sources, append-only ids. Against that: German-only validators, two toolchains, exam-branded schemas. |
| Release / ops | **7.0** | Immutable versioned deploys, rollback by sha, scoped SW kill switch, `_site` privacy scan. Against that: no preview or staging; no e2e gate; logs in memory only. |
| Security / privacy | **6.0** | Strict CSP, vendored code, privacy hooks including history. Against that: write PAT and API key in IndexedDB on a shared origin with a sibling app that still uses `innerHTML`; browser-direct key; no server-side deletion. |
| Accessibility | **6.0** | Focus management, live regions, 44 px, reduced motion, `lang` on content, map List parity. Against that: no automated checks; `lang` hard-coded; no RTL. |
| Performance | **6.0** | Lazy views, modulepreload, immutable caching, bitmap budget. Against that: full event history loaded at boot and growing without bound; render-blocking CSS and fonts; 5.7 MB precache; no budget in CI. |

**Overall weighted scalability score: 5.0 / 10**

| Dimension | Weight | Score × weight |
|---|---|---|
| Multi-language | 20 | 50 |
| Multi-user | 15 | 60 |
| iOS | 12 | 54 |
| Code quality | 10 | 65 |
| Testability | 10 | 60 |
| Content pipeline | 10 | 70 |
| Security / privacy | 8 | 48 |
| Release / ops | 7 | 49 |
| Accessibility | 4 | 24 |
| Performance | 4 | 24 |
| **Total** | **100** | **504 → 5.0** |

The weights favour the three end-state goals he named (languages, users, iOS).

### How the original review's decisions held up

| Decision | Outcome |
|---|---|
| B1: no deploy before the exam | **Overridden.** Shadow deploy, then cutover on 4 Oct, a few days before the exam. Mitigated well: preview merge, read-back before archive, resumable steps (CUTOVER.md:44-59). The cost shows up as `cutover.js` (378 lines) of permanent complexity. |
| B2: one writer per collection | Held |
| B3: privacy gate | Held, and stronger than asked (history scan, `_site`) |
| B4: events carry `ctx/base/post` | Held in the schema, but **no value yet**: the events never leave the device |
| B5: scope of Igloo routes | Held |
| B6: vendoring, CSP | Held |
| S1, S2, S3, S5, S6, S9, S14, S15, S16 | Held |
| S10: exam cap | Held, and improved: applied when due dates are read (`b1ready.dueOn`) |
| **S4: restore from backup** | **Not done.** This is the most consequential miss. |
| S12 / A16: diagnostics | Partial: in memory only |
| S17 / A14: axe and e2e gates | Not done |
| S19: golden vectors | Not done. Contract test is local-only. |
| S20: strict types | 27% of lines; grader advisory; no schema-generated types |
| N6: model ids in config | Held (`config.js:31`) |
| Feedback authorship | Not done |

---

## 6. Roadmap

Effort: S is up to 1 day, M is 2–5 days, L is 1–3 weeks. "Safe" says how his live progress is protected.

### Now: single user, cheap, high leverage

1. **Back up learning events off the device, and add Restore.** M. Risk low.
   - Send `card.reviewed`, `card.marked_known/unmarked`, `settings.changed` and mistakes as one NDJSON file per device per day, `data/events/<deviceId>/<day>.ndjson`, to the private repo. Update it with its sha; no conflicts are possible because each file has one writer.
   - Mark those events `synced`.
   - Add Profile › Data › Restore that merges every device's files with the B4 rule (`post` when `base` matches). That also unifies iPhone and Mac.
   - Safe: append-only files, no change to record shapes, and sync.py ignores `data/events/`.
2. **Bound the outbox and the boot load.** S. Risk low.
   - After item 1, acknowledged events older than 30 days move to an IDB store such as `archive`, using an IDB version bump that only adds a store. Load only pending and recent events into memory.
   - Safe: nothing is deleted, and export still reads the archive.
3. **Put a sync seam in front of GitHub.** M. Risk medium.
   - New `data/sync/index.js`: `results.record(type, payload)` and `SyncTarget {push, pull}`. The GitHub adapter derives `path` itself, from the event id and time. The stored `path` stays as a field for old events.
   - Exam, Today and Profile stop importing `github-b1exam.js`.
   - Safe: the sync contract test pins the file names.
4. **Browser e2e in CI.** M. Risk low.
   - Playwright WebKit (390 px) and Chromium against `stamp.mjs --out _site`, with a synthetic fixture profile.
   - Covers boot, one typed round, one Lesen module, offline reload and SW update, plus axe (serious and critical block) and a Trusted Types tripwire.
   - Make it a required check for `main`.
5. **Get the grader into strict types.** S–M. Risk low.
   - Fix the 14 errors in `match.js` and `speech.js` and move them into `tsconfig.json`.
   - Add a ratchet: `features/**` advisory, but the error count may only go down.
   - Safe: the grading corpus has to stay unchanged.
6. **Fix schema drift and validate in tests.** S. Risk low.
   - Add `archivedAt/archivedInto` to `profile@1`.
   - In dev and tests, `store.append`/`set` validate against `schemas/records`.
   - Add `author`, `model` and `promptVersion` to feedback records (additive).
7. **Persist the error log.** S. Risk low. An IDB ring of 500 entries, scrubbed, uploaded once a day with item 1.
8. **Consolidate speech, TTS and audio into `services/`.** M. Risk medium (iOS gesture rules).
   - `speech.js` (recognition and recording), `voice.js` (TTS) and `audio.js` (playback), each taking a BCP-47 tag.
   - Re-run the iPhone checklist's mic, keyboard and audio items.
9. **Split Practice into sibling features under `/practice/*`.** M. Risk low.
   - The registry gains sub-features: `practice-round`, `practice-write`, `practice-speak` (situations), `practice-script`, `practice-clusters`.
   - Move `dueTomorrow`, `todayBudget` and `readinessFor` into `domain/` so Today stops importing Practice.
   - Routes, CSS and store keys stay the same.
10. **Update the docs.** S. ARCHITECTURE §7 and §10, and CUTOVER's status lines.

### Next: before a second language

11. **Course model.** M. Risk medium.
    - `settings.courses: [{id, lang, level, goal: {exam, date}, decks}]` plus `activeCourse`.
    - A migration adds course `de` built from the current `language/level/exam`, and keeps the old fields mirrored (read by old code; one writer, `setCourse`).
    - `clock` reads `activeCourse.goal.date`.
    - Safe: additive, HLC per field, tested with a pre-migration fixture.
12. **Deck namespacing.** S. Risk low if done before the first French card.
    - New decks are `<lang>:<name>` (`fr:core`). The existing `b1`, `speak`, `script` and `clusters` map to `de` through a fixed `LEGACY_DECK_LANG`.
    - **Card ids and IDB keys never change.** Events gain an additive `lang` field.
13. **Language-pack interface (below), German first.** L. Risk high for grading.
    - Move German rules out of `match.js`, `detect.js`, `punct.js`, `atlas.js` and `clusters.js` into `src/lang/de/`. `match.js` keeps only the language-neutral alignment, Damerau-Levenshtein, slots and diffs.
    - Prove it with golden vectors captured **before** the move (every corpus answer and its full result object) and the zero-false-accept corpus. The refactor must be byte-identical.
14. **Exams as data.** L. Risk medium.
    - `exam-def@1`: sections → parts → item types (`tf`, `mc`, `match`, `yn`, `who-said`, `writing`, `speaking`), timings, plays, scoring and pass lines, plus the locale for exam UI strings.
    - `grade.js` becomes generic over item types. Goethe B1 is the first definition. Keep the Goethe answer values and the sync.py rows through an adapter.
    - Move exam UI strings from code (`speaking.js:20,178`) into an exam-locale catalog.
15. **One content pipeline.** M. Language-parameterised validators, `packs[lang]` in the manifest, per-language precache, generic schema ids with the old ids kept as aliases.
16. **`lang`, `dir` and logical CSS.** M. Replace the 152 `lang: 'de'` literals with `pack.bcp47`. Set `dir` on target-language nodes. Convert the 139 physical properties to logical ones.
17. **Golden vectors.** S. `tests/vectors/{fsrs,match.de,clock,budget}.json`.
18. **Custom domain plus moving to the new origin.** M. Risk medium.
    - Depends on items 1 and 7. The old origin backs up, the new origin restores, then old-origin tabs redirect.
    - This takes secrets off the shared `pakrasi.github.io` origin.
    - Safe: IndexedDB doesn't move between origins, so restore from the repo is the move itself. Rehearse with a synthetic profile first.

### Later: before other users and iOS

19. **Supabase.** L. Schema from `schemas/records`, RLS, anonymous auth then linking, the claim flow, events as the source of truth, Storage for recordings. The GitHub target stays as a second SyncTarget during the transition.
20. **Claude proxy as an Edge Function.** M. Prompts versioned on the server, quotas, optional BYO key in Vault.
21. **Roles and memberships.** L. Reviewer feedback replaces the "review assistant on the owner's machine" path (`author_kind`). A content-editor workflow with validators in CI.
22. **Capacitor shell.** L. SQLite adapter, native speech plugin, filesystem content packs, share, haptics, deep links, Sign in with Apple, in-app account deletion.
23. **Privacy and legal.** M. Server-side export and delete, recording retention, LICENSE files, re-licensed TTS.
24. **Sentry** (browser and Capacitor) with `beforeSend` scrubbing. S.
25. **Map for non-Latin scripts.** L. Shape text at runtime (Canvas or DOM) for Devanagari, Bengali and Arabic, or keep Explore Latin-only and say so.

### Recommended language-pack interface

```ts
interface LanguagePack {
  id: 'de' | 'fr' | 'hi' | 'kha' | 'gsw' | 'bn' | 'es' | 'it' | 'pt' | 'ar';
  bcp47: string; script: 'Latn' | 'Deva' | 'Beng' | 'Arab'; dir: 'ltr' | 'rtl';
  fonts: { prompt: string; ui: string };

  text: {
    normalize(s: string): string;            // NFC, quotes, Arabic alef/yeh/tatweel, Devanagari nukta
    tokenize(s: string): Token[];            // offsets into the input; elision (l'), clitics, virama-safe
    fold(word: string): string;              // comparison key (de: ä→ae; fr: strip accents? no: see slips)
    sentenceInitial?(tokens: Token[], i: number): boolean;
  };

  input?: {                                  // typing in another script
    transliterate?(latin: string): string[]; // hi: "kyaa" → ["क्या"]; ar: arabizi
    acceptsTransliteration: boolean;
  };

  grading: {
    closedClass: ReadonlySet<string>;        // folded; never typos
    endings?: readonly string[];             // inflectional suffixes kept identical in a typo
    isFormChange?(a: string, b: string): boolean;   // de ablaut; fr é/è not a typo?
    slips: Array<{ kind: string; test(typed: string, expected: string): boolean; severity: 'hard' | 'miss' }>;
    minimalPairs: ReadonlySet<string>;       // de konnte/könnte; fr ou/où
    caseSensitive: 'nouns' | 'none' | 'proper';
  };

  grammar: {
    gender: null | { values: string[]; articles: Record<string, string[]>; elided?: string[] };
    cases: null | string[];
    verbForms: VerbFormModel;                // which forms a card shows (inf/pret/perf+aux; passé composé+être)
    detectors?: Detector[];                  // sticky errors (de: verb-final, V2); optional
    punctuation?: PunctRule[];
  };

  speech: {
    tts: { locales: string[]; prefer?: RegExp; avoid?: RegExp };   // monolingual voices
    asr: { locale: string } | null;          // null: no recognition (Khasi)
  };

  exams: string[];                           // exam-def ids: ['goethe-b1'], ['delf-b1'], []
  content: { lexicon?: string; phrases: string; accept?: string; grammar?: string; clusters?: string };
  i18n?: Record<string, string>;             // exam-locale strings
}
```

German becomes `src/lang/de/index.js` built from today's constants, unchanged. `Match.check(input, accepted, { pack, …opts })` replaces the module-level German constants.

### Second language: French

Why French as the pilot:
- **It forces every German assumption out without adding a script problem.** It has articles with elision (`le/la/l'/les`, `un/une`), so tokenisation and `articleMiss` have to generalise. It has no case. Accents can't be folded the German way (`ou/où`, `a/à` are meaning pairs). Its verb model is different (passé composé with être/avoir). Its punctuation conventions differ (spaces before `?!:;`).
- **It exercises the exam-as-data path with a real second framework:** DELF B1, with four skills and a different structure and scoring.
- **The data is the richest after German:** a full `igloo.lang.french`, chunks, sentences, and Latin script, so the map and fonts work.
- **It's low risk to his German work:** Latin script, so the refactor is checked by the German corpus and not hidden behind rendering problems.

Do this alongside: design the interface **on paper against Hindi and Arabic** with tokeniser and transliteration golden tests (Devanagari conjuncts, Arabic diacritics, RTL) before freezing `exam-def@1` and `LanguagePack`. Then make **Hindi the third language**, to prove script plus transliteration, and **Arabic** after that, to prove RTL.

Avoid Swiss German as an early pilot. It has no standard orthography, no exam and no recognition locale, so it can't be graded the way the matcher is built.

---

### Critical Files for Implementation
- `src/domain/match.js`
- `src/data/sync/github-b1exam.js`
- `src/data/store.js`
- `src/data/settings.js`
- `src/domain/grade.js`