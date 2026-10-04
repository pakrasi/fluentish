# Fluentish: notes for Claude

Fluentish is a static language-study app (daily plan, review rounds, Goethe B1 mock exams, look up) that is live at https://pakrasi.github.io/fluentish/ and used daily by the owner. It uses native ES modules with no bundler, a strict CSP and vanilla JS. Read `docs/ARCHITECTURE.md` and `docs/CONTRIBUTING-FEATURES.md` before changing code, and `docs/DESIGN.md` before changing anything visual.

## Rules
- **Public repo, private learner.** Never commit personal data: scores, mistakes, saved words, recordings, real exports, names, employer, tokens. Fixtures are synthetic. `.privacy-terms` and `authoring/private/` are git-ignored and exist only on the owner's Mac. In a cloud session they're missing, so the privacy check only runs its generic patterns. Treat anything about a real person as private.
- **Only `src/core/clock.js` knows dates.** There are no date literals in `src/` (`npm run check:dates`). The exam date is a user setting.
- **Data safety.** Card ids (`W:`, `BW:`, `F:` …), IndexedDB collection names and record shapes never change; add fields instead. Legacy localStorage keys from the old apps (`doors.*`, `examDate`, `gh:token`, `remote:*` …) are read-only. Sync output must match what `pakrasi/b1-exam`'s `scripts/sync.py` imports (see the sync contract tests).
- **Grading.** `tests/unit/grading-corpus.test.mjs` must stay at zero wrong answers graded right. Don't loosen typo tolerance on endings, articles or umlauts.
- **Copy.** Use plain labels that name the thing. No slogans, no "X, not Y", no metaphors or rule-of-three flourishes, and no em dashes in UI strings. Interface strings go in `src/i18n/en.js`. The exam runner is German (Sie); everything else is English chrome with German content.
- **Phone first** (390 px), 44 px tap targets on touch, reduced motion respected. Motion comes only from `core/motion.js` and `core/brand.js`.
- No runtime CDN imports. Vendor any library under `src/vendor/` with its hash.
- **Deploys.** Never push to `main` from a cloud session; open a pull request. A merge to `main` deploys to production through `.github/workflows/deploy.yml` once CI passes.

## Before every commit
```
npm test && npm run test:tz && npm run typecheck && npm run check:privacy && npm run check:dates && npm run check:content
```
Install the git hooks once per clone with `npm run hooks`. A SessionStart hook in `.claude/settings.json` does this in cloud sessions.
