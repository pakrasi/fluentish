# What we learned building Fluentish

For future contributors and agents. Fluentish went from two old sites to one live app in about four days (3 to 6
October 2026, five rounds, about 300 commits), built mostly by coordinated Claude agents for one daily user. This page
keeps the decisions that should outlive that sprint, and why they were made. The round-by-round story is in
`docs/history/`; what comes next is `docs/ROADMAP.md`.

## Product decisions

**The owner is a lifelong learner. Exams are goals, not freezes.** The app began as an exam-week tool counting down to
a Goethe B1. In round 4 the owner said the B1 was a stepping stone and that he wants to become fluent over years. So
the default is a calm daily loop with no end date (maintenance), and an exam is one goal on a course that can be
added, moved or removed. Exam behaviour (the countdown's caps, the review owed before the day) starts only 14 days
before the date (`planPhase`, ARCHITECTURE §5). Nothing freezes after an exam; the next goal takes over. Planning for
the years matters more than planning for the date.

**One schedule, one allowance, one picture of what you know.** By round 3 there were five decks, four separate rules
for new items and three numbers for "what I know" that disagreed. The journey review scored that 4 out of 10 for
spacing and said to consolidate before adding anything. Now one FSRS schedule covers every deck. One function decides
how many new items the day holds (`domain/budget.js allowance()`), and every screen reads it. One definition of
"known" (`domain/knowledge.js`) feeds Today, the map and the progress log. Reviews are never hidden or dropped. The
new-item rate is capped at what the week's minutes can sustain, because round 4 found the allowance feeding 29 to 39
new items a day on a 45 to 60 minute day (synthetic learner).

**Honest numbers.** A readiness percentage that fell when he studied (a miss cuts stability, so recall on the exam day
dropped) was removed, not tuned. Showing a never-seen item is a study step, not a miss. Audio the phone was unsure of
is never marked wrong. A false correction is worse than a missed one: conversation feedback is checked verbatim
against what he wrote before it becomes a card.

**Plain copy.** Labels name the thing. No slogans, no "X, not Y", no metaphors (round 3 removed "Compass",
"Machine", "Welded on" from Word building), no streaks or guilt counters, no em dashes in UI strings. English chrome
with study-language content; the exam runner speaks the exam's language, as the real exam does.

**The privacy model.** The repository is public; the learner is private. Nothing personal is committed (scores,
mistakes, saved words, recordings, real exports, names, employer, tokens), and a privacy gate runs on every commit, on
push over the whole history, in CI and on the built site. Fixtures are synthetic. Personal text (pasted readings,
scripts, conversation transcripts) stays on the device and reaches `api.anthropic.com` only after a tap with a
disclosure. The off-device backup goes to a private repository, and what it may contain is an allowlist of keys
checked by a test, never a scan of bodies (a body scan in round 4's plan would have silently stopped every backup).

**Shareable without accounts.** Round 5 made the app safe to send to someone else before accounts exist: the results
repository and the study hours file are each profile's own settings with no owner defaults in code, a visitor's
actions reach nothing of the owner's, and device tokens are checked for scope and expiry (`docs/SHARING.md`).

**Phone first, and the real phone matters.** He studies on an iPhone in short sessions. WebKit at 390 px is the e2e
target, but the mic, speaker, ProMotion, VoiceOver and the real streaming API need checks on the device
(`docs/IOS-CHECKS.md`). Speaking practice failing outdoors was only found by using it on the street.

**Built for many languages without changing his data.** German lives in a language pack; engines are
language-neutral; new decks are `<lang>:<name>`; card ids, IndexedDB names and record shapes only ever gain fields.

## Engineering lessons

**Golden vectors before refactors.** Round 3 moved every German rule out of the grader into a language pack and turned
the exam engine into data. Both moves were proved byte-identical against vectors captured *before* the change
(`tests/vectors/`: grader, FSRS, clock, allowance, exam grading, result files). Without them a "pure refactor" of the
grader is a guess. Regenerate a vector only in its own commit, listing every changed entry and why.

**Generate test cases by error class, not by hand.** Round 4's German review wrote 622 careful cases and found 9 wrong
answers graded right. Generators that make each class of error on every item (infinitive for participle, zu dropped
or added, strong verbs with weak endings, prefix swaps, agreement, a lower-case formal Sie, `tests/corpus/morph-errors.mjs`)
found 222 wrong answers graded right across the corpus, which the hand-written cases had missed. After the fix every
class is at 0 on every set and the test keeps it there. Hand-written cases remain useful as a held-out set.

**Contract first, then parallel lanes.** Before round 4's lanes forked, a plan review checked the plan against the
code and found seven blockers (a new deck would have crashed Today, older cached clients would drop new settings
fields, a privacy body check would have stopped all backups, B2 items would have shifted his B1 numbers). They were
fixed in one behaviour-neutral contract commit (`7036cc3`, C0) that added every shared seam, deployed once, and was
proved neutral against the vectors. Each lane then extended only its own seam.

**Protect `main`.** `main` takes only a commit whose CI jobs, including the browser e2e, passed on a branch first, and
the deploy runs only for a commit whose e2e passed. Before round 3 every merge went to the app he uses daily without
ever running in a browser.

**Commit in small steps.** When a session crashed partway through a lane, only what had been committed survived. Small,
logical commits that each pass the gates cost little and make crashes, reviews, reverts and rebases cheap.

**Flaky e2e tests have real causes; find them.** Two recurring WebKit flakes were not "flaky":
- *A reload during a fetch.* Reloading while the app was still reading content made WebKit report the cut-off request
  as a page error. Wait until no request is in flight before reloading (`backup.spec`, `beb84c7`); `networkidle`
  does not wait again after the load.
- *Service-worker claim timing.* Reloading to get a page under the worker raced the worker's claim, and in WebKit a
  navigation fulfilled by a context route is never handed to the worker. Wait for the worker to control the page
  instead of reloading for it (`offline.spec`, `5cc36eb`).
- *A seed that depends on today.* The synthetic progress log skips random days, and which days depends on today's
  date. On 7 Oct the day meant to hold a map release was skipped, so `progress.spec` failed on a docs-only branch. A
  seeded event must land on the first recorded day on or after its day (`progress-seed.mjs`, `d96896c`), and a
  fixture built from "today" should be checked across a range of dates.

**The shared origin is a standing risk.** Every site under `pakrasi.github.io` is one browser origin, so any page
there can read Fluentish's IndexedDB, tokens included. The mitigations are no third-party script on the origin and a
strict CSP; the fix is the app's own domain (ROADMAP).

**Old clients are still running.** A phone with a cached service worker runs last week's code. A normaliser that
rebuilt records from a whitelist would have dropped new fields written by a newer device, and a restore could then lose
them for good. Keep unknown fields, and ship the reader of a new field before anything writes it.

**Reviews always find real bugs; budget for them.** Every review round found problems the builders had missed:
round 1 a keyboard blocker and numbers that disagreed between screens; round 2 a script splitter that turned right
German into wrong fragments, and Schreiben grading that let exam-costing errors through; round 3 the broken
one-schedule promise; round 4 a scheduler that over-fed new items and crammed the exam window, conversation charges
that went uncounted, a reading phrase copied into the backup, and B2 collocation grading wrong on a third of a sample.
Plan a review and a fix pass into every round; they are not optional extras.

**Small things worth keeping.**
- Keep the docs in the commit that changes the behaviour; drift crept in whenever docs were left for later.
- Stamp model-written reviews honestly (`reviewedBy: 'model-2pass'`), never as a native reviewer.
- Measure before claiming a fix (bitmap memory, false positives before and after, the corpus counts in a commit message).

## How the agents worked together

The playbook that worked across rounds 2 to 5:

1. **A shared brief.** One short file every agent reads first: what the owner asked for, the hard constraints, the
   privacy rules, the gates and the commit trailer.
2. **Planners, then a plan review.** Planners write plans only. A reviewer checks the plan against the code before
   anyone builds, and amends it.
3. **A contract commit.** Shared seams, schema fields and file-section ownership land first, behaviour-neutral, by
   the coordinator.
4. **Lanes with file ownership.** Each builder works in its own worktree and branch and owns named files. Shared
   hotspots (`content/manifest.json`, the shipped-ids ledger, `en.js`, `tsconfig.json`) have rules: regenerate, never
   hand-merge; add only inside your section; the typecheck ratchet takes the lower number.
5. **A merge order.** Written in advance, so lanes rebase on each other as they land.
6. **Reviewers in parallel.** Design and motion, UX and learning, German, and code with accessibility and privacy,
   each with its own port, browser session prefix, mocks and fake tokens, against hard gates.
7. **One fix pass.** The coordinator reconciles the reports into rulings (what to do, what is deferred, data-safety
   rules) and one implementer applies them.
8. **The coordinator merges.** In rounds 2 to 4 each lane fast-forwarded `main` itself once its CI was green. The
   rule now is that builders push branches and the coordinator merges after CI is green, asking the owner first for
   anything visual and any change to the plan.
