# Round 1: consolidation (3 to 4 October 2026)

**Commits:** `2dfbcea` … `152ea1e` (78 commits, including merges). Historical record; the living docs are
`docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SCHEMA.md`, `docs/CUTOVER.md` and `docs/ROADMAP.md`.

## Goal

The owner studied German on two separate sites: Igloo (a chunk bank, drill and a B1 trainer) and a Goethe B1
mock-exam app (14 full mock exams with audio, Schreiben and Sprechen correction). Each had its own Today screen, word
schedule, settings and budget, and both counted down from an exam date written into the code. He asked for:

1. one fresh site at `pakrasi.github.io/fluentish`, built so it could grow into an iOS app and into profiles for
   other users;
2. one workflow instead of two;
3. an exam date he sets himself, with everything derived from it (caps, countdown, daily budgets, copy);
4. motion and graphic design with taste ("good but lacks taste");
5. a full review at the end.

His first exam was a few days away, so nothing could break his daily study and no progress could be lost.

## Decisions

- **Plans, then a principal-engineer review of the plan.** An architecture plan, a UX plan and a design kit were
  written first. The review overrode the plan in three places: no deploy before the exam (later overridden again, see
  below), no adapter writing the old apps' keys in place (one writer per collection; a one-time, read-only
  migration), and events that carry their result and context (`ctx`, `base`, `post`) from the first event written, so
  a server or another device can rebuild the schedule.
- **Four tabs:** Today, Practice, Exam (only with an exam goal), Look up; settings under the avatar.
- **One clock:** only `core/clock.js` knows dates; no date literal in `src/` (a CI gate). No date set means plain
  practice.
- **No bundler, no framework:** native ES modules, strict CSP, vanilla JS, JSDoc types checked by `tsc`.
- **Privacy from the first commit:** a privacy gate as a git hook and in CI; items mined from the learner's own exams
  and his name and employer in old example content were dropped on import; fixtures are synthetic.
- **The design language:** graphite neutrals, Newsreader for prompts and the one big number, Geist for UI, ink as the
  action colour, one cobalt accent meaning "you, today, progress"; motion as feedback, always with a reduced-motion
  path (`docs/DESIGN.md`).

## What shipped

- The foundation (stage A): content and validators, schemas and the manifest, domain modules ported as ES modules
  with their tests, the IndexedDB store with a profile seam and outbox, the migration from the old apps, the shell,
  Today, Profile and onboarding, CI.
- The features (stage B), built as parallel feature modules on a written contract
  (`docs/CONTRIBUTING-FEATURES.md`): Practice (rounds, speaking), Exam (timed runners, reviews, results sync to the
  private results repository in the exact format its import script reads), Look up (words, phrases, grammar,
  frames).
- The review fix pass (see below), then the deploy (stage C): `tools/stamp.mjs` builds `_site/` with code under
  `v/<sha>/`, `deploy.yml` publishes after CI, rollback by sha, a scoped service worker with a kill switch.
- **Shadow mode and an early cutover.** The first deploy ran in shadow mode (preview profiles that never sync). Real
  exam-week work was being done in the preview, so the cutover was brought forward to the morning of 4 October:
  each device merged its preview into its real profile, and the old apps redirected their B1 and exam routes to
  Fluentish (`docs/CUTOVER.md`).
- A grading hotfix (no green check on wrong German) and `CLAUDE.md` with a cloud SessionStart hook.

## What the reviews found

Three reviewers (design, UX and copy, code and accessibility) walked the app on a WebKit iPhone viewport and desktop
Chromium with mocked services. Main findings, all fixed in the coordinator's 15 rulings:

- The numbers disagreed: Today, Practice and Exam gave different answers to "how much today"; a 60-minute day was
  planned at 79 to 86 minutes; the readiness percentage moved when the exam date moved. Ruling: one budget function,
  and readiness defined on a set that never depends on the date. Changing the date never rewrites a card.
- A keyboard blocker: on a phone, Practice's only visible Start button was `aria-hidden`.
- Tap targets under 44 px across chips, segmented controls and the exam runner; low-contrast data bars.
- The brand layer (readiness field, ripples, the atmosphere) was built but never wired into a screen.
- Data safety: a recording cut off by iOS could be discarded; starting a mistakes round wiped a paused main round;
  a malformed Claude reply could be saved as a correction; legacy unsent results uploaded before the learner had seen
  the import notice.
- The exam runner mixed English into the German exam environment.
