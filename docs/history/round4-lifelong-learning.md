# Round 4: from exam tool to lifelong learning (5 to 6 October 2026)

**Commits:** `0ed2e3b` … `5d4aca4` (88 commits). Historical record; living docs: `docs/CONTRIBUTING-FEATURES.md` (the
week, the allowance, the exam window, the level gate), `docs/ARCHITECTURE.md` (§2.3 the text layer and verb forms,
§3.2 the progress log and Conversation, §5), `docs/SCHEMA.md`, `docs/DESIGN.md`. Specs, privacy-scrubbed:
`specs/MAINTENANCE-PLAN.md`, `specs/CONTENT-INPUT-PLAN.md`, `specs/CONVERSATION-PLAN.md`.

## Goal

The owner: his exam might move; B1 is a stepping stone; he is a lifelong learner and wants to become fluent in German.
Five themes, all approved:

1. Maintenance as the default experience (no date, or after an exam).
2. Content beyond B1: a B2 layer, C1 later.
3. Real input: reading and listening to real material, with unknown words flowing into the schedule.
4. Conversation practice with Claude, with mistakes becoming cards.
5. A long-term picture of progress (weeks and months).

His answers: the next goal is B2 with an exam, and an exam is a movable goal whose behaviour starts 14 days before its
date; reading cards are backed up like other decks, conversation transcripts stay on the device; listening uses his
own audio files and pasted transcripts (no URL fetching); hours from his external time tracker appear as a separate
"All tracked" view, never added to app minutes.

## Decisions

- **Three plans, then a plan review.** The review checked the plans against the code and found seven blockers, among
  them: a `de:read` deck would have made Today read the wrong deck or crash; "phase none until 14 days before" would
  have changed scheduling without a recap; older cached clients would drop new course fields; a privacy body check
  on the backup would have stopped every backup after the first conversation mistake; B2 items in the B1 pool would
  have shifted his B1 numbers. It also cut scope (map frames over time, `dates[]`, a separate B2 exam lane, Explain and
  Debate and voice in Conversation v1).
- **A contract commit (C0, `7036cc3`) first:** every shared seam added, behaviour-neutral, deployed once before any lane
  wrote new fields; vectors regenerated in their own commit, every change listed.
- **B2 content process:** author pass, machine gates, two independent model review passes (the second blind to the
  first), re-review when the second pass finds over 2 % errors; stamped `reviewedBy: 'model-2pass'`.

## What shipped

- **The progress log** (one record per study day, minutes per device and kind) first, so every later day is recorded.
- **Goals and the week** (L1): the exam window (exam behaviour starts 14 days before the date, a recap once when it
  opens), the week plan with day kinds (Normal, Light, Read, Write, Talk, Off), the allowance on a planned day with a
  14-day review forecast cap, back-after-break behaviour, the per-strand level gate for B2 items, and an everyday
  Today with the week strip.
- **The text layer and the Reader** (L2): shared tokens, lemmas and level estimates in `domain/text/` and the German
  pack; a reading library, paste, tap-to-gloss, saving words into `de:read` with their sentence, its own review round,
  comprehension questions through Claude.
- **B2 content** (L3), batch by batch: grammar concepts and items, 180 Redemittel, 200 collocations (120
  Funktionsverbgefüge), 449 B2 words with domain tags, 36 graded texts plus 4 public-domain Kafka texts, and
  `content/NOTICE.md` for sources and licences.
- **Conversation** (L4): Free chat and Role-play, typed; streamed turns; recasts; end feedback checked against what he
  wrote before at most three mistakes become cards; per-session and monthly cost limits.
- **Progress** (L5): known over time, by level, learnt per week, time per week, study days, milestones, a weekly log.
- **A scheduler hotfix** before the exam: a sustainable new-item rate, an exam window that spreads reviews instead of
  cramming, the review round never dropped.
- **The B2 grader fix:** verb forms indexed in the German pack; morphology error generators in the corpus; every class
  at 0 wrong answers graded right.
- The review fix pass: privacy (marked phrases keep only an id; deleting a text purges the error log), cost safety
  (every billed request counted, the cap checked on retries and feedback), an incremental backfill, the Reader's level
  prior, Read days opening the next graded text, a minimal Write day, accessibility (the Reader readable as prose,
  roving tabindex, forced colours), and the design fixes.

## What the reviews found

Four reviewers in parallel; the coordinator's rulings were applied by implementer lanes.

- **UX and learning (6.5 / 10, from 6):** the right surfaces on an engine that over-fed new items (29 to 39 a day on a
  45 to 60 minute day for the synthetic learner), credited only knowledge the app had seen (a B1+ learner told a B1
  article was too hard), and crammed every deck into the last three days of the exam window while dropping the review
  round.
- **German:** no grammatical error in any sampled model sentence, key, article, plural or text, but B2 phrase grading
  over the 2 % bar: on a sample, 34 % of collocations graded clearly wrong German as right or showed broken German as
  the reference. Its 622 hand-written cases found 9 wrong answers graded right; the class generators then found 222
  across the corpus. All fixed to 0. Afterwards 34 of the review's 110 right answers are still graded Hard (ROADMAP).
- **Code, accessibility, privacy and cost:** P0, Off and Light days blocked new items inside the exam window; billed
  conversation requests went uncounted on failure, Stop or retry; a marked reading phrase copied private text into the
  backup; deleting a text left its sentences in the error log; the backfill was quadratic; forced colours broke the
  chat; a screen reader read the Reader one word-button at a time.
- **Design:** Progress was the strongest new work; the Reader was the weakest typography; Today was not yet one
  crafted moment (the week strip could not tell a missed day from a future one).

Left open (now in `docs/ROADMAP.md`): listening (L2d), Explain, Debate and voice in Conversation, Conversation against
the real API, A2 graded texts, two detector misfires, the `en.js` split and `shared/data.js` move.
