# Fluentish

A language study app for daily use over years, phone first. Live at **https://pakrasi.github.io/fluentish/**.

What it does today (German is the full course; French has a course and its review round; eight more languages are
listed as later):

- **Today:** one plan for the day from one daily allowance across every deck, reviews first; the week plan (Normal,
  Light, Read, Write, Talk and Off days); Where you stand; Progress over weeks and months.
- **Practice:** typed review rounds with a strict grader; Schreiben (phrases, Build an email, writing from memory);
  Sprechen (speaking situations, the mic check, the Teil 2 talk, Conversation with Claude); words (clusters, Word
  building, Quick sort, exam words); your own material (Scripts, the Reader with graded B1+ and B2 texts).
- **Exam:** timed mock exams in the Goethe-Zertifikat B1 format, defined as data, with reviews and corrections.
  An exam is a goal you can set, move or remove; exam behaviour starts 14 days before its date.
- **Look up:** words, phrases, grammar and frames with one search, and Explore: a map of everything with a 3D view.

It replaced two earlier sites (Igloo and a B1 mock-exam app) and moved their progress over once. Static site,
native ES modules, no build step for development. Practice in the format of the Goethe-Zertifikat B1; not affiliated
with the Goethe-Institut.

## Run it

```
npm run serve            # http://localhost:8430/  (no-cache dev server)
npm test                 # unit tests (node:test); npm run test:tz runs them in three time zones
npm run typecheck        # tsc strict on core, data and the new domain modules (npm ci first)
npm run test:e2e         # stamps _site/ and runs the browser e2e suite (WebKit 390 px + Chromium); once: npx playwright install chromium webkit
npm run hooks            # once per clone: privacy and date checks before every commit and push
```

The gates every commit must pass (CI runs them too, plus the e2e suite):

```
npm test && npm run test:tz && npm run typecheck && npm run check:privacy && npm run check:dates && npm run check:content
```

On localhost, `?today=YYYY-MM-DD` pretends it is another day (never on a deployed site). On the dev server every record the app writes is checked against `schemas/records/`; a mismatch is a console error (`src/data/records.js`).

## Where things are

| | |
|---|---|
| `src/` | the app: `core/` (clock, router, DOM helpers, i18n, kit motion and brand), `data/` (store, IndexedDB, migration, settings, sync and backup), `domain/` (scheduler, grader engines, the allowance, Today's plan; pure, tested in node), `lang/` (language packs), `services/` (speech, voice, audio, recorder, Claude), `features/` (one folder per screen or Practice product) |
| `content/` | public content and `manifest.json`, the entry point for the web app and a future iOS app |
| `authoring/` | sources that are built into `content/`, and the briefs they were written to |
| `schemas/` | JSON Schemas for content and for learner records |
| `tools/` | validators, builders, the privacy and date gates, the dev server |
| `tests/` | `unit/` (node:test, synthetic fixtures in `fixtures/`), `corpus/` (grading), `e2e/` (Playwright against the stamped site, with mocks for every other host) |
| `docs/` | the documentation, below |

## Documentation

| Doc | Read it for |
|---|---|
| [ROADMAP](docs/ROADMAP.md) | the single list of next steps (Now, Next, Later) and the scorecard history |
| [LEARNINGS](docs/LEARNINGS.md) | product decisions and engineering lessons, and how the agents worked together |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | how the app is built: layers, data, sync and backup, language packs, exams as data, the clock |
| [CONTRIBUTING-FEATURES](docs/CONTRIBUTING-FEATURES.md) | the feature contract, the day's allowance and week API, and the checks before you push |
| [DESIGN](docs/DESIGN.md) | the design system: tokens, components, motion, copy |
| [SCHEMA](docs/SCHEMA.md) | record and content formats, the backup files |
| [SHARING](docs/SHARING.md) | what a visitor can reach, token safety, the device link |
| [IOS-CHECKS](docs/IOS-CHECKS.md) | the checks to run on a real iPhone |
| [CUTOVER](docs/CUTOVER.md) | how the old apps were switched over (done 4 Oct), and the rollback |
| [history/](docs/history/) | one summary per build round, and the historical design specs (not maintained) |

## Content

Edit sources in `authoring/`, then rebuild and validate:

```
python3 tools/validate_b1.py --all && python3 tools/build_b1.py
python3 tools/build_turns.py
node tools/build-manifest.mjs && node tools/validate-content.mjs
```

`npm run check:content` runs `tools/validate-content.mjs` (manifest, hashes, every file against its schema) and `tools/validate-packs.mjs` (each language pack's validators, each exam's validators); CI runs both. Other builders: `tools/build-speak.mjs` (speaking situations), `tools/build-wordbuild.mjs` (Word building), `tools/build-course.mjs` (courses in other languages), `tools/b2.mjs` (the reviewed B2 batches and graded texts), `tools/build-atlas.mjs` (the Explore map layout). After adding content, `node tools/shipped-ids.mjs --write` appends the new card ids to the ledger; ids that shipped never disappear.

## Privacy

This repository is public. Nothing personal goes in: no learner's results, recordings, vocab, mistakes, keys or exports, and no items mined from one learner's exams. `tools/check-privacy.mjs` enforces that before every commit and push and in CI; personal terms to watch for go in a git-ignored `.privacy-terms`. Test fixtures are synthetic (`node tools/make-fixtures.mjs`); real exports belong in the git-ignored `tests/private/`.

The exam date is a setting. No date is written in `src/`; `tools/check-dates.mjs` fails on one.

## Deploy

Live at **https://pakrasi.github.io/fluentish/** (GitHub Pages, source "GitHub Actions"). A profile keeps its progress in the browser. A profile that connects its own private results repository (Profile › Connections, docs/SHARING.md) also sends exam results there and backs up its learning progress; one without a connection sends nothing. The switch from the old apps happened on 4 Oct (docs/CUTOVER.md).

How a change goes live:

1. Push a branch. `ci.yml` runs the gates on it: unit tests in three time zones, `tsc`, the privacy check (tracked files and every version in history), the date gate, the content validators, a trial build, and the browser e2e suite (`e2e`: the stamped site in WebKit at 390 px and in Chromium, with axe, all other hosts mocked; about 3 minutes).
2. The coordinator fast-forwards `main` to that commit and pushes (with the owner's approval for visual or planning changes). `main` is protected: it only takes a commit whose `ci` jobs passed (required status checks, admins included), so a commit that never ran in a browser cannot reach it.
3. When `ci` passes for the push to `main`, `deploy.yml` checks that the `e2e` job passed for that commit, checks out the commit and runs `node tools/build-manifest.mjs --check` and `node tools/stamp.mjs`, which writes `_site/`:
   - code under `v/<sha>/src` and `v/<sha>/styles`, plus the two previously deployed versions, so a cached `index.html` never mixes modules from two deploys inside Pages' 10-minute cache
   - `index.html` with `modulepreload` for the boot graph, `404.html` (deep paths → `#/<path>`), `sw.js` stamped with the version and precache list, `version.json`, `assets/`, `content/`
   - never `tools/`, `tests/`, `authoring/`, `docs/` or `schemas/`
4. It checks `_site/` with `check-privacy --dir`, then publishes with `actions/upload-pages-artifact` and `actions/deploy-pages`.

Check a deploy: `curl -s https://pakrasi.github.io/fluentish/version.json` shows the live sha.

To preview the built site locally: `node tools/stamp.mjs`, then `node tests/e2e/server.mjs` serves `_site/` at http://127.0.0.1:8471/fluentish/; add `?sw=on` (the service worker is off on localhost otherwise).

**Roll back:** Actions → deploy → Run workflow, and enter the sha of an earlier good commit (any commit that has `tools/stamp.mjs`). From the shell: `gh workflow run deploy.yml -f sha=<sha>`. The commit needs a passing `e2e` run; a commit from before the e2e suite (before round 3) needs `-f untested=true`. The next push to `main` deploys the head again.

**Service worker:** scope `/fluentish/` only. A launch never waits on the network: the worker answers the shell (`index.html`), `assets/`, `v/<sha>/` code and content (the manifest too, as `manifest.json?h=<hash>`, the hash `index.html` names) from its cache. On pakrasi.github.io it also keeps Google Fonts (font files cache first, the stylesheet refreshed in the background, cache `fluentish-fonts`); GitHub, Anthropic, audio and Range requests are never handled. A deploy reaches a device as a new worker: the browser checks `sw.js` at every launch and the page again whenever it becomes visible; the new worker installs in the background and takes over only from Today (the page reloads once), so a page never mixes two versions. An install whose `index.html` is already a newer deploy's, or whose manifest doesn't match its hash, fails and the installed version keeps serving until the next check.

**Kill switch**, from the safest step to the strongest. No code change is needed: `tools/stamp.mjs` takes the value from `--sw on|now|off`, else the `FLUENTISH_SW` environment variable, else `on`, and `deploy.yml` sets `FLUENTISH_SW` from its `sw` input, else the repository variable `FLUENTISH_SW`.

1. A bad deploy: roll back (above) or push the fix. It arrives like any update, from Today.
2. A deploy broke the page itself (Today never shows, so no update can take over): deploy the fix or the rollback with `-f sw=now`. Its worker takes over as soon as it has installed; close the app fully and open it again (twice on a slow network: one launch installs, the next runs it). Use `now` as the input of one run only, never as the variable. It needs a commit from round 8 or later (older `tools/stamp.mjs` accepts only on/off); for an older sha use step 3.
3. The worker itself misbehaves: `sw=off`. `version.json` says `"sw": "off"`, so a working page unregisters the worker and deletes the `fluentish-*` caches; and `sw.js` becomes a worker that takes over at once, deletes the same caches and unregisters itself, which needs no page at all (the browser fetches `sw.js` at every launch). After one launch the app loads from the network with no worker; after the next it runs the deployed version. It unregisters only Fluentish's registration and deletes only `fluentish-*` caches. Turn it back on (variable deleted, or the next push after a one-run `-f sw=off`) and the page registers the worker again.

```
gh workflow run deploy.yml -f sha=<good sha> -f sw=now                  # step 2: a fix or a rollback that takes over at once
gh variable set FLUENTISH_SW --body off && gh workflow run deploy.yml   # step 3: off, and stays off for every later push
gh variable delete FLUENTISH_SW && gh workflow run deploy.yml           # back on
gh workflow run deploy.yml -f sw=off                                    # off for this deploy only; the next push turns it on again
```

Check it with `curl -s https://pakrasi.github.io/fluentish/version.json` (`"sw"`). If the old Igloo `swKill` removes Fluentish's worker, it registers again on the next visit.
