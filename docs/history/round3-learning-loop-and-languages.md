# Round 3: one learning loop, and a platform for many languages (5 October 2026)

**Commits:** `26b331e` … `65b9c56` (39 commits). Historical record; living docs: `docs/ARCHITECTURE.md` (§2.2 platform
services, §2.3 language packs, §3.4 exams as data, §5.1 the allowance, §5.2 Where you stand, §8 quality gates),
`docs/ROADMAP.md`.

## Goal

Two inputs:

- **A whole-journey review** (learning science, UX and German together) scored the product 6 / 10: "a strong core;
  the next round should consolidate, not add". Four features had arrived in three days, each with its own deck, its
  own new-item rule and its own way to show what you know. The one-schedule promise was broken in practice (5 decks,
  4 new-item rules, clusters uncapped), three numbers for "what I know" disagreed, and the phase changed the copy but
  not the plan.
- **The architecture assessment** (5.0 / 10 scalability, `specs/ARCH-ASSESSMENT.md`).

Principle for the round: one learner, one schedule, one daily allowance, one "where you stand", one way to do each
thing; build for 10 languages and other users without changing a card id or losing progress.

## Decisions

- Waves of parallel lanes in their own worktrees, each owning named files, shipping through a protected `main`.
- Golden vectors captured *before* any refactor, so the language-pack move could be proved byte-identical.
- The owner chose to build wave C (the language platform) before his exam, on the condition that German grading,
  scheduling and exam behaviour stay byte-identical (vectors, corpus and e2e as the guard).
- French as the second language: it forces every German assumption out without a new script.

## What shipped

- **Wave A.** One daily allowance across every deck; reviews always counted and never hidden; "Where you stand" per
  module replacing the readiness percentage; the phase drives the plan (maintenance after the exam, a level-fit first
  week); Show me on a new item is not a miss. Golden vectors for the grader, FSRS, the clock and the budget; the
  grader in strict types with a ratchet for everything else; the grader accepts more right Schreiben answers. Browser
  e2e with Playwright (WebKit 390 px and Chromium, axe, a Trusted Types tripwire, every other host mocked) as a
  required check on `main`; schema drift fixed; records validated in development and tests.
- **Wave B.** Practice split into sibling features that never import each other; platform services (speech, voice,
  one audio player, share, haptics) behind setters with a BCP-47 tag; Practice in three groups; Look up and Explore
  joined to study; the device link from `b1-token.py`.
- **Wave C.** Courses and deck namespacing (`<lang>:<name>`; German keeps its legacy deck names); the German language
  pack with language-neutral engines; exams as data (`exam-def@1`, Goethe B1 as the first definition, an exam-locale
  catalog); one content pipeline with packs per language and per-language precache; `lang` and `dir` on study text and
  logical CSS (an Arabic fixture course runs right to left in e2e); the French pilot (a full pack, a reviewed course
  and its round end to end).
- A native-style German review of the content, with its fixes.

## What the reviews found

The journey review is this round's input review (above). Its German findings: under 0.3 % wrong German, about 1 %
misleading rules, and a grader too strict on valid Schreiben variants (about a fifth rejected), with "Also correct"
lines shown without commas. After wave C the coordinator estimated multi-language readiness at about 6.5 / 10 (from
2.5); the full scorecard was not re-run (`docs/ROADMAP.md`).
