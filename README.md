# Fluentish

A daily language study app: one plan for today, one review queue, mock exams in the Goethe-Zertifikat B1 format, and a reference. Phone first. It replaces two earlier sites (Igloo and the B1 mock-exam app) and moves their progress over once, without touching them.

Static site, native ES modules, no build step for development. Practice in the format of the Goethe-Zertifikat B1; not affiliated with the Goethe-Institut.

## Run it

```
npm run serve            # http://localhost:8430/  (no-cache dev server)
npm test                 # unit tests (node:test)
npm run typecheck        # tsc strict on core, data and the new domain modules (npm ci first)
sh tools/install-hooks.sh   # once per clone: privacy and date checks before every commit and push
```

On localhost, `?today=YYYY-MM-DD` pretends it is another day (never on a deployed site).

## Where things are

| | |
|---|---|
| `src/` | the app: `core/` (clock, router, DOM helpers, i18n, kit motion and brand), `data/` (store, IndexedDB, migration, settings), `domain/` (scheduler, answer matching, readiness, Today's plan; pure, tested in node), `features/` (one folder per screen) |
| `content/` | public content and `manifest.json`, the entry point for the web app and a future iOS app |
| `authoring/` | sources that are built into `content/`, and the briefs they were written to |
| `schemas/` | JSON Schemas for content and for learner records |
| `tools/` | validators, builders, the privacy and date gates, the dev server |
| `docs/` | [ARCHITECTURE](docs/ARCHITECTURE.md) · [DESIGN](docs/DESIGN.md) · [SCHEMA](docs/SCHEMA.md) · [CONTRIBUTING-FEATURES](docs/CONTRIBUTING-FEATURES.md) |

## Content

Edit sources in `authoring/`, then rebuild and validate:

```
python3 tools/validate_b1.py --all && python3 tools/build_b1.py
python3 tools/build_turns.py
node tools/build-manifest.mjs && node tools/validate-content.mjs
```

Other validators: `tools/validate.py content/igloo/lang/<lang>.json`, `validate_sentences.py`, `validate_grammar.py de`, `validate_accept.py german`, `validate_chunks.py german`, `validate_levels.py`, `validate_exam.py`, `validate_exam_why.py`. CI runs all of them.

## Privacy

This repository is public. Nothing personal goes in: no learner's results, recordings, vocab, mistakes, keys or exports, and no items mined from one learner's exams. `tools/check-privacy.mjs` enforces that before every commit and push and in CI; personal terms to watch for go in a git-ignored `.privacy-terms`. Test fixtures are synthetic (`node tools/make-fixtures.mjs`); real exports belong in the git-ignored `tests/private/`.

The exam date is a setting. No date is written in `src/`; `tools/check-dates.mjs` fails on one.
