# Fluentish roadmap

This is the single list of next steps. If work is planned and not listed here, it is not planned. When something
ships, move it to the round's history file under `docs/history/` and delete it here, in the same commit.

State on 2026-10-07: `main` at `beb84c7` is live at https://pakrasi.github.io/fluentish/ and used every day by its
owner, a lifelong learner of German. Rounds 1 to 5 are summarised in `docs/history/`. What we learned along the way is
in `docs/LEARNINGS.md`.

**Effort:** S is up to a day, M is 2 to 5 days, L is 1 to 3 weeks (the scale used since round 2's assessment).
**Risk** is the risk to his live progress and to grading. Every item follows the standing rules in `CLAUDE.md`: card
ids, IndexedDB names and record shapes only gain fields; the backup stays `fluentish-snapshot@1`; the grading corpus
stays at 0 wrong answers graded right; golden vectors change only in their own commit that lists every changed entry;
plain copy; phone first; nothing personal in the repo.

## Now

Small, safe and useful this week.

### 1. Device links must carry `exp`
- **Why:** a device link puts a GitHub token in a URL. The app refuses a link whose `exp` has passed, but it still
  accepts a link with no `exp` at all, which never expires. `b1-token.py` (in the private results repository) has sent
  `exp` since its commit `a28d95b`, so nothing legitimate depends on the old form any more.
- **Effort / risk:** S / low.
- **Builds on:** `docs/SHARING.md` §2.4 and §3.2; `src/core/link.js takeLink`.
- **Change:** `const expired = found.exp == null || …` in `takeLink`; update the "link without exp still links" case
  in `tests/unit/sharing.test.mjs` and add one to `tests/e2e/link.spec.mjs`.
- **Done when:** a link without `exp` shows "This link has expired", stores nothing and is scrubbed from the address
  and history; a fresh link from `b1-token.py` still links the iPhone (IOS-CHECKS › Device link).

### 2. A cost cap for Reader questions and translations
- **Why:** Conversation counts every billed request against a monthly cap (`conv.spend`, round 4). The Reader also
  calls Claude with the learner's key (sentence translation in `practice-read/reader.js`, comprehension questions in
  `questions.js`), and those calls are neither counted nor capped. A learner who shares the app with their own key
  should have one honest monthly number.
- **Effort / risk:** S to M / low (no learning data changes).
- **Builds on:** ARCHITECTURE §3.2 (Conversation practice: limits and `conv.spend`), `src/domain/conversation.js`
  (`spentIn`), round 4 implementer ruling 2 (`docs/history/round4-lifelong-learning.md`).
- **Done when:** one spend record (additive; either `conv.spend` generalised or a new kv read alongside it) counts
  every billed Claude call from the Reader, including failed, cut and retried calls, using the response's usage or a
  conservative estimate; a call past the cap is refused before it is sent, with the same plain line Conversation uses;
  cache hits cost nothing; unit tests cover each path; Profile shows the month's total once.

### 3. Run the iPhone checks backlog
- **Why:** WebKit e2e cannot test the mic, speaker, VoiceOver, ProMotion or the real streaming API. Several checklists
  are written and not yet run on the device.
- **Effort / risk:** S (owner time on the phone) / none; it finds bugs.
- **Builds on:** `docs/IOS-CHECKS.md` (Speaking outdoors, and the new "Round 4 surfaces" section: 3D at 120 Hz,
  VoiceOver in the Reader and Progress, Conversation streaming, the week sheet), `docs/CUTOVER.md` › iPhone checklist
  (never recorded as done).
- **Done when:** each box is ticked or has a linked issue; failures become items on this list.

### 4. Two detector misfires
- **Why:** two right German sentences are flagged by the sticky-error detectors (round 4 known issues): a clause with
  "als ob … sei" (Konjunktiv I after als ob) and a fronted phrase such as "Am Ende der Diskussion zeigte sich …". A
  false error teaches him to doubt correct German.
- **Effort / risk:** S / medium (detectors touch grading).
- **Builds on:** `src/lang/de/` detectors, `tests/corpus/`, ARCHITECTURE §2.3.
- **Done when:** both shapes are in the corpus's right set and graded right; the zero-fire check over all content
  still passes; 0 wrong answers graded right; vectors regenerated only if needed, with every changed entry listed.

## Next

### 5. The 34 right answers still graded Hard
- **Why:** after the round 4 grader fix, 34 of the 110 right answers in the round 4 German review's held-out set are
  graded Hard (partly right) rather than right (`tests/unit/grading-corpus.test.mjs` keeps a ceiling for them). Hard
  shortens the interval and tells him a right answer was partly wrong.
- **Effort / risk:** M / medium.
- **Builds on:** `domain/match.js` restCheck, `domain/notes.js`, the corpus (`docs/history/round4-lifelong-learning.md`).
- **Done when:** each of the 34 is either graded right or has a written reason it stays Hard; the ceiling in the
  corpus test drops to the new count; no wrong answer moves toward right (0 false positives on every set and class).

### 6. Content pass on short phrase-bank accept lists
- **Why:** some accepted alternatives on the short phrase-bank cards (`K:` ids, the chunk bank carried over from
  Igloo) are not idiomatic German. Round 5's grader work deliberately left bank chunks out of the alternative-sentence
  generator (`f8330a4`), because their alternatives are written for the chunk alone, so they were never reviewed as
  whole answers.
- **Effort / risk:** M / medium (accept lists are grading).
- **Builds on:** the round 4 review process (author pass, machine gates, two independent model passes, the second
  blind; `reviewedBy`/`reviewedAt`), `authoring/chunks/`, `tools/validate_accept.py`.
- **Done when:** every bank item's accept alternatives have been through both passes; unidiomatic ones are removed or
  carry a note; ids unchanged (the shipped-ids ledger passes); corpus at 0 false positives; vector changes listed.

### 7. Knowledge uses production evidence (`card.checked`)
- **Why:** round 5 added typed production checks (Quick sort's Produce mode, Recheck by typing, the spot check),
  recorded as `card.checked` events and kv `known.checks`. `domain/knowledge.js` still reads only a marked card's
  `known.checked` flag; a failed production check on a known item, or a passing one on a seen item, does not change
  what Where you stand, the map and the progress log call known.
- **Effort / risk:** M / medium (one definition shared by three screens).
- **Builds on:** `docs/SCHEMA.md` (`card.checked`, `known.checks`), `src/domain/checks.js`, ARCHITECTURE §5.2.
- **Done when:** the rule is written in ARCHITECTURE §5.2 first (for example: a failed production check makes a known
  item shaky until its next right answer; a passing one is evidence and never makes an unseen item known); Where you
  stand, the map header and the progress log agree (`tests/unit/explore-next.test.mjs` style test); no card record
  changes without a learner action.

### 8. Tune the noise thresholds from the device log
- **Why:** `domain/hearing.js NOISE` holds first guesses (median −42 dBFS counts as loud). Each mic attempt logs the
  room level, confidence and flags in the device-only kv `speech.log` so they can be tuned.
- **Effort / risk:** S, after about two weeks of outdoor use / low.
- **Builds on:** `docs/IOS-CHECKS.md` › Speaking outdoors, `src/domain/hearing.js`.
- **Done when:** thresholds change in one commit with the reasoning in its message and synthetic test frames;
  the learner's logged numbers themselves stay on the device and are never committed.

### 9. Conversation against the real API
- **Why:** Conversation has only ever run against mocks. The e2e mock delivers the whole stream at once, so real
  streaming, real usage accounting and the quality of corrections are unverified. The plan's phase-0 quality run (false
  corrections must be 0) was never done.
- **Effort / risk:** S to M / low for data, medium for cost (stay under the cap).
- **Builds on:** `docs/history/specs/CONVERSATION-PLAN.md` §10 and §13, ARCHITECTURE §3.2. Check model ids, prices
  and request fields with the `claude-api` skill first; `config.anthropic.prices` must match.
- **Done when:** a handful of real sessions in both modes stream visibly on the iPhone; the counted spend matches the
  provider's usage within a few percent; a reviewed sample of feedback cards has no false correction; findings fixed or
  listed here.

### 10. Conversation: Explain, Debate and voice
- **Why:** v1 shipped Free chat and Role-play, typed. Explain (talk through one of his Scripts to a curious listener)
  and Debate (B2 argument with the pack's connectors) were deferred by the round 4 plan review, as was spoken input.
- **Effort / risk:** M / low.
- **Builds on:** item 9; `CONVERSATION-PLAN.md` §1 and §13 phase 2; `services/speech.js` and the outdoor rules.
- **Done when:** both modes ship with pack content (`content/conversation/de.json`), a script body never leaves the
  device (sentinel test), spoken turns are flagged and never carded unchecked, e2e and axe pass.

### 11. Listening with his own audio files (L2d)
- **Why:** reading shipped; listening, the other half of real input, did not. The owner chose his own audio files and
  pasted transcripts (no URL fetching).
- **Effort / risk:** M / low (device-only data).
- **Builds on:** `docs/history/specs/CONTENT-INPUT-PLAN.md` §5.6 with the plan review's cuts (cues from SRT, VTT or a
  YouTube transcript paste, else an even split; no tap-to-sync in v1), `services/audio.js` (`clip()` gains `rate`).
- **Done when:** an audio file is stored as a device-only blob, never in the backup, export, sync or error log (a
  sentinel test over each path); Listen first, Read along and Sentence loop work; the device voice reads a text that
  has no audio; e2e with a synthetic clip.

### 12. A2 graded texts
- **Why:** the round 4 learning review found that an A2 learner gets no reading input: the graded library starts at
  B1+. Sharing the app makes this matter more.
- **Effort / risk:** M / low.
- **Builds on:** `readers@1` (`schemas/content/readers.schema.json`), the round 4 content process, the Reader's level
  estimate (`domain/text/estimate.js`).
- **Done when:** about 12 A2 texts (`licence: own`) with reviewed questions pass both review passes; the estimator's
  calibration test holds within one level; an A2 profile's Read day opens one.

### 13. Engineering clean-up: split `en.js`, move `shared/data.js`
- **Why:** `src/i18n/en.js` is one 2,700-line file every lane edits, and `features/shared/data.js` is profile study
  state living in a feature library. The round 4 implementer ruling asked for both; neither was done.
- **Effort / risk:** M / low if kept behaviour-neutral.
- **Builds on:** ARCHITECTURE §2.1 (module graph), `tests/unit/feature-graph.test.mjs`.
- **Done when:** `src/i18n/en/*.js` per feature with one barrel and a test that no key was lost or changed;
  `src/data/study-state.js` with a re-export shim at the old path; unit, vectors and e2e unchanged.

### 14. The `/b1-review` skill text (CUTOVER step 6)
- **Why:** the review skill on the Mac still describes the old exam app; results now come from Fluentish.
- **Effort / risk:** S / none (outside this repo).
- **Builds on:** `docs/CUTOVER.md` › `/b1-review` skill text.
- **Done when:** the skill names Fluentish's routes and result files; CUTOVER's status line says step 6 is done.

### Word families: what comes after round 7
- **One word** (WORDGAMES-DESIGN §5.2, phase 3): a typed Wordle round on one form, offered on the done screen; the
  seam is the done screen's action row in `features/build/today.js`.
- **Level adaptation** (§5.3): two forms up after three all-found days, two down after two days with three shown; read
  `kv build.family`.
- **Add to my next round** for a form not seen (the family card), inside the allowance.
- The content lane's families (40 roots, clues, examples, non-words): the model reads FAMILY-SCHEMA's full shape as
  it is; check each batch's boards on a phone (long clues wrap the clue card to three lines).

## Later

### 15. Own domain and moving off the shared origin
- **Why:** every site under `pakrasi.github.io` is one browser origin, so any page there could read the tokens
  Fluentish keeps in IndexedDB. Today only the "no third-party script on an origin that holds tokens" rule protects them.
- **Effort / risk:** M / medium (IndexedDB does not move between origins).
- **Builds on:** `docs/SHARING.md` §1.3, `docs/history/specs/ARCH-ASSESSMENT.md` item 18.
- **Done when:** the old origin backs up, the new origin restores (rehearsed on a synthetic profile first), old tabs
  redirect, the service worker and CSP are re-scoped, and the iPhone relinks with a fresh device link.

### 16. French beyond rounds, and a DELF exam definition
- **Why:** French has a full language pack and a reviewed course, but only the hub and the round (Practice's other
  pages are German content). The exam engine is data-driven and has never run a second real exam.
- **Effort / risk:** L / low for German.
- **Builds on:** ARCHITECTURE §2.3 (French) and §3.4 (adding an exam, with DELF B1 as the worked example and the list
  of what a definition cannot yet express).
- **Done when:** French gets at least situations, clusters or the Reader from French pack content; a `delf-b1`
  definition, locale and a small set of tests pass `check:content` and grade with no engine code of their own beyond
  the gaps §3.4 lists.

### 17. Hindi and Arabic packs
- **Why:** they prove the two hardest pack features: transliterated input (Hindi) and right to left (Arabic). Today
  both are text-only stubs and an Arabic fixture course for the RTL e2e.
- **Effort / risk:** L / low for German.
- **Builds on:** `ARCH-ASSESSMENT.md` (the LanguagePack interface, the order French → Hindi → Arabic),
  `tests/unit/lang-contract.test.mjs`, `tests/e2e/rtl.spec.mjs`. The map is Latin-only (build-time layout).
- **Done when:** each pack has tokeniser and transliteration golden tests, a corpus at 0 false positives, a reviewed
  course, and the map either shapes the script or says plainly it is not available.

### 18. Accounts, roles and a Claude proxy (Supabase)
- **Why:** sharing without accounts works (round 5), but each visitor needs their own key, a GitHub token is a long
  credential in a URL, and nothing can be one-time. Accounts retire the per-device token.
- **Effort / risk:** L / high (a second sync target for his data).
- **Builds on:** ARCHITECTURE §9, `ARCH-ASSESSMENT.md` §4 and items 19 to 21, `CONVERSATION-PLAN.md` §11 (the proxy
  transport), `docs/SHARING.md` §3.3.
- **Done when:** RLS tables mirror the collections; anonymous to linked accounts with a claim flow; the GitHub target
  runs beside the new one during the move; the Claude proxy holds the key with per-user quotas; reviewer and content
  editor roles exist; export and delete work on the server.

### 19. The iOS app (Capacitor)
- **Why:** the target device is an iPhone; a shell gives durable storage, native speech and notifications.
- **Effort / risk:** L / medium (the Home Screen container has separate storage, so it starts by restoring).
- **Builds on:** ARCHITECTURE §2.2 (platform services behind setters) and §9, `tests/vectors/` for any Swift port.
- **Done when:** the shell runs the same `_site`, a SQLite store adapter passes the store tests, native speech and
  audio sit behind `services/`, restore brings his progress over, and in-app account deletion exists.

### 20. Licences
- **Why:** the repository has no LICENSE file. The speaking-situation clips are edge-tts output published next to the
  exam audio, and edge-tts is not cleared for redistribution. Word frequencies come from wordfreq data (CC BY-SA 4.0),
  credited in `content/NOTICE.md`.
- **Effort / risk:** S for the decision, M if audio must be re-voiced / low.
- **Builds on:** `content/NOTICE.md`, ARCHITECTURE §3.3 (audio decision), `ARCH-ASSESSMENT.md` §4 › Privacy.
- **Done when:** the owner has chosen licences for code and content and LICENSE files are committed; the published
  clips are either cleared or replaced by audio under clear terms; NOTICE says which.

### 21. Smaller later items
- Port Igloo's Drill, Test, Write and Look up, migrate its SM-2 deck and redirect its last routes (CUTOVER phase 3). L.
- A Goethe B2 exam definition and mock tests (today `goethe-b2` is a date-only goal). L, mostly content.
- C1 content after the B2 layer (`CONTENT-INPUT-PLAN.md` §2.7). L.
- Self-hosted fonts (ARCHITECTURE §4). S.
- Strict types for the modules still under the ratchet (`tools/typecheck-ratchet.mjs`). M, in steps.
- Error reporting with scrubbing (Sentry or similar) once there are other users. S.

### Decided against, for now
- The boot-time delta re-merge of legacy keys (ARCHITECTURE §6): since the redirects of 4 Oct only a stale offline
  Igloo tab could write them.
- Map "Over time" frames and per-release id tables (cut by the round 4 plan review; snapshots allow it later).
- The full exam run as one sitting (deferred in round 1, not asked for since).

## Scalability scorecard history

Round 2's architecture assessment scored the app against its end state (10 languages, mobile web, iOS, profiles with
roles). Its full table and weights are in `docs/history/specs/ARCH-ASSESSMENT.md` §5.

| When | Overall | Multi-language | Basis |
|---|---|---|---|
| 5 Oct, `6a21b26` (before round 3) | 5.0 / 10 | 2.5 | the full assessment, every dimension scored |
| 5 Oct, after round 3 wave C (`65b9c56`) | not re-scored | about 6.5 | the coordinator's estimate after the language pack, exams as data, one content pipeline, `lang`/`dir` and logical CSS, and the French pilot |

Honest note: nothing has been re-scored since. Round 3 also built most of the assessment's "Now" list (off-device
backup and restore, the sync seam, browser e2e as a required check, the grader in strict types, persisted errors,
platform services, the Practice split), which should lift multi-user, testability, iOS and release scores; and rounds
4 and 5 added surface area that has not been weighed. A fresh assessment against the same weights is the only way to
know the current number.
