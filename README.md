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

## Deploy

Live at **https://pakrasi.github.io/fluentish/** (GitHub Pages, source "GitHub Actions"). Shadow mode is off (`config.deployShadow: false`, the cutover of 4 Oct): the site makes local profiles that sync results to the b1-exam repo. A device that opened the preview keeps that work: on its first start the preview profile is merged into the real one (newest per item, the preview's results queued with their original file names), archived, and purged 30 days later. What was kept is listed once on Today and in Profile › Data. Details and rollback: docs/CUTOVER.md.

How a change goes live:

1. Push to `main`. `ci.yml` runs the gates: unit tests in three time zones, `tsc`, the privacy check (tracked files and every version in history), the date gate, the content validators, and a trial build.
2. When `ci` passes for a push to `main`, `deploy.yml` checks out that commit and runs `node tools/build-manifest.mjs --check` and `node tools/stamp.mjs`, which writes `_site/`:
   - code under `v/<sha>/src` and `v/<sha>/styles`, plus the two previously deployed versions, so a cached `index.html` never mixes modules from two deploys inside Pages' 10-minute cache
   - `index.html` with `modulepreload` for the boot graph, `404.html` (deep paths → `#/<path>`), `sw.js` stamped with the version and precache list, `version.json`, `assets/`, `content/`
   - never `tools/`, `tests/`, `authoring/`, `docs/` or `schemas/`
3. It checks `_site/` with `check-privacy --dir`, then publishes with `actions/upload-pages-artifact` and `actions/deploy-pages`.

Check a deploy: `curl -s https://pakrasi.github.io/fluentish/version.json` shows the live sha.

To preview the built site locally: `node tools/stamp.mjs`, serve `_site/` at `/fluentish/`, and add `?sw=on` (the service worker is off on localhost otherwise).

**Roll back:** Actions → deploy → Run workflow, and enter the sha of an earlier good commit (any commit that has `tools/stamp.mjs`). From the shell: `gh workflow run deploy.yml -f sha=<sha>`. The next push to `main` deploys the head again.

**Service worker:** scope `/fluentish/` only. Navigations are network first (3 s), `v/<sha>/` and hashed content are cache first, and GitHub, Anthropic, fonts, audio and Range requests are never handled. A new version waits and takes over only from Today. Kill switch: a `version.json` with `"sw": "off"`. It unregisters only Fluentish's registration and deletes only `fluentish-*` caches. No code change is needed: `tools/stamp.mjs` takes the value from `--sw on|off`, else the `FLUENTISH_SW` environment variable, else `on`, and `deploy.yml` sets `FLUENTISH_SW` from its `sw` input, else the repository variable `FLUENTISH_SW`:

```
gh variable set FLUENTISH_SW --body off && gh workflow run deploy.yml   # off, and stays off for every later push
gh variable delete FLUENTISH_SW && gh workflow run deploy.yml           # back on
gh workflow run deploy.yml -f sw=off                                    # off for this deploy only; the next push turns it on again
```

Check it with `curl -s https://pakrasi.github.io/fluentish/version.json` (`"sw"`). If the old Igloo `swKill` removes Fluentish's worker, it registers again on the next visit.
