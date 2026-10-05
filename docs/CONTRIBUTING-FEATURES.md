# Building a feature (stage B and later)

Practice, Exam and Look up are built as **feature modules** on top of the stage-A core. Each one lives in its own folder and can be built in parallel without touching core, the router or another feature.

```
src/features/
  registry.js          lists every feature once: its paths, its tab, its view, plan and boot modules (core)
  contract.js          the ctx types below, as JSDoc
  day.js               Today's plan, composed once for Today and Practice (core)
  today/  profile/  welcome/        core screens (stage A)
  exam/ lookup/ explore/            features: index.js (view) + plan.js (Today provider)
  practice/ practice-round/ practice-write/ practice-speak/ practice-script/ practice-clusters/ build/
                       Practice: sibling features under #/practice, each with its own routes and plan.js (round 3)
  shared/              the practice runtime the Practice features share (pool, round state, grading, picker, done
                       hero, self-grade, progress, recall bar, cluster layout); a library: no routes, no plan
```

The day's numbers (every deck's due cards and the one allowance of new items) are `domain/allowance.js`
(`dayAllowance`, `todayBudget`, `simToday`, `clusterToday`, `dueTomorrow`), so Today and every feature read them from
`domain/` and never from each other.

## The rules

1. **Stay in your folder.** `src/features/<id>/**` plus your own CSS in `styles/features/<id>.css` (add the `<link>` to `index.html` in the same commit). Anything you need from core goes through `ctx` or a core import (`core/*`, `data/*`, `domain/*`). If core is missing something, add it in a separate, reviewed commit.
2. **Features never import each other.** They meet through the store, the bus and links (`href="#/exam/3/lesen"`). Code two features need goes to `domain/` (pure), `data/` (storage) or, for the Practice features, `features/shared/`. `tests/unit/feature-graph.test.mjs` scans the import graph (static, dynamic and JSDoc type imports) and fails on a feature importing another, `shared/` importing a feature, `domain/` importing outside `domain/`, or core, data and services importing a feature. `main.js` reaches features only through the registry: work a feature does once at start-up is its `boot` module (`start(app)`, see `exam/boot.js`).
3. **Your routes are yours.** You own every path under your prefix. The router gives you the rest in `ctx.params.rest` (`/exam/3/lesen/review/0192…` → `rest = '3/lesen/review/0192…'`), the query in `ctx.query` and the registry path that matched in `ctx.route` (for a feature with more than one prefix). Parse it in your `index.js`. A registry path may be `{ path, when(query) }`, a route that matches only when the query passes too (`/practice/round` with `kind=script:<id>` belongs to the scripts); list it before the feature it narrows. Old routes never stop resolving: `tests/fixtures/practice-routes.mjs` lists Practice's, checked in node and in the browser.
4. **Only `clock` knows dates.** Read today and the exam through `ctx.clock.ctx()` (`today`, `exam`, `phase`, `daysLeft`, `lastNewDay`, `capDay`, `newItems`, `mocks`). Never `new Date()` for a study day, never a literal date (CI fails on `20NN-MM-DD` in `src/`). Labels: `label(day)` → "Fri 9 Oct", `labelDe(day)` → "9. Okt.".
5. **Only `data/settings.js` writes settings,** and only `setExamDate()` writes the exam date.
6. **No markup from strings.** Build with `h()` from `core/dom.js`; it throws on `html`/`innerHTML`. Render Claude's or anyone's text as text nodes. CSP is `script-src 'self'` with no inline styles: set styles through `el.style` / `style: {…}` in `h()`, never a `style` attribute string, and don't use `<select>` (WebKit reports it under the CSP; use chips or the segmented control).
7. **The device through `services/`, the language through `core/lang.js`.** Microphone, recogniser, voices, playback, share and haptics only through `services/` (speech, voice, audio, share, haptics; ARCHITECTURE §2.2): never `new Audio`, `speechSynthesis`, `MediaRecorder` or `navigator.share` in a feature. Pass the tag from `core/lang.js` (`bcp47()`, `asrLocale()`), and mark study-language text with `lang: langAttr()`, not a literal `'de'` (Look up and Explore still have a few) and never `'de-DE'`. Start audio inside the tap (iOS plays only from a user gesture).
8. **Strings go through `t()`.** Add keys to `src/i18n/en.js` under your feature's prefix (`practice.*`, `exam.*`, `lookup.*`). Copy rules: labels name the thing, no slogans or praise, numbers with units, one middle dot per line at most, no em or en dashes. Study-language content carries `lang: langAttr()`.
9. **Motion from the kit only** (`core/motion.js`, `core/brand.js`), so reduced motion is handled once.
10. **Tests in node.** Keep logic in pure functions (in your folder or `src/domain/`) and test them in `tests/unit/<feature>-*.test.mjs` with `node:test`. Fixtures are synthetic; real data goes in the git-ignored `tests/private/`.

## The view: `index.js`

```js
/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const [test, module] = (ctx.params.rest || '').split('/');
  replace(el, h('div', { class: 'stack' }, h('h1', null, ctx.t('exam.title')), …));   // every view has one h1
  const off = ctx.store.subscribe('attempts', () => …);
  return {
    unmount() { off(); },                       // stop timers, audio, recorders, subscriptions
    canLeave() { return !running || confirm(…) },   // optional; return false to stay (e.g. a timed module in progress)
  };
}
```
`mount` may return nothing, a cleanup function, or `{ unmount, canLeave }`. Focus moves to your `<h1>` after mount.

`ViewCtx`:

| Field | What |
|---|---|
| `store` | `get/set/update(name)` for key-value collections, `cards(deck)` / `putCards(deck, [[id, rec]])`, `attempts()` / `putAttempts([...])`, `append(type, payload)` for events, `subscribe(name, fn)` (`'cards:b1'`, `'attempts'`, `'outbox'`, any kv name) |
| `clock` | `clock.ctx()`, `clock.today()`, `clock.epochDay()` |
| `settings()` | normalised `settings@1`, read fresh each call |
| `content` | `manifest()`, `load(id)` (cached, cache-busted by hash), `exam(id)` |
| `bus` | `on/emit`: `settings:changed`, `store:changed`, `prefs:changed`, `profile:changed`, `sync:status` |
| `t` | interface strings |
| `go(path, {replace})`, `toast(text, {action, onAction})`, `refreshShell()` | navigation, the kit toast, re-render header and tabs |
| `params`, `query` | `params.rest` = your sub-path |
| `app` | `{ hlc, device, profile, adapter }` for writers that need them (`setSetting`, migrations) |

### Full-screen flows

Routes listed with `chrome: false` in the registry hide the header and tab bar (the onboarding does). A round or the exam runner can do the same for a sub-path: set `document.body.dataset.chrome = 'off'` on mount and restore `'on'` in `unmount`. If you need that, say so in your PR so the registry entry can grow a per-path flag instead.

## The Today provider: `plan.js`

Today asks every feature what it offers and composes the day with `composeToday()` (`src/domain/today.js`). The composer, not your feature, applies the exam-date rules: no mock on the eve or the day, no new items from exam−1, only `warmup`/`read` items on the exam day, rows in priority order while they fit the minutes (the first always fits, one mock may run over), at most five open rows; a row done today always stays with its check.

```js
/** @param {import('../contract.js').PlanCtx} ctx  { store, c: clockCtx, settings, exam: manifestExam | null, t } */
export function planItems(ctx) { return [/* PlanItem */]; }          // may be async; no DOM, no network
export async function prepare(viewCtx) {}                           // optional: refresh cached stats (may load content) before Today composes
export function todayFeedback(ctx) { return [/* FeedbackRow */]; }   // optional
export function todayModules(ctx) { return [/* ModuleBar */]; }      // optional (Exam)
```

`PlanItem`:

| Field | Meaning |
|---|---|
| `id` | stable within the day, `'<feature>.<thing>'` |
| `source` | your feature id |
| `kind` | `review`, `new`, `mock`, `mistakes`, `speak`, `write`, `read`, `warmup`, `setup` |
| `title`, `detail` | "Review round", "24 due, 8 new" |
| `minutes` | honest estimate (`roundMinutes(n)` for rounds); 0 for `setup` |
| `href` | where the row and the sticky button go |
| `priority` | bands: 10 warm-up · 20 review round · 25 mistakes from corrections · 30 mock module · 40 new-only rounds · 45 things to read · 50 speaking/writing practice · 90 setup |
| `done` | finished today (shows a check; the sticky button moves to the next row) |
| `introducesNew` | shows never-seen items (dropped from exam−1) |
| `reviews` | due cards the row carries (any deck); Today counts them in the plan and left out, and says when they do not fit. Read new and due numbers from `domain/allowance.js dayAllowance()`, never a cap of your own |
| `optional` | never takes the place of a row left out before it (games, side-deck new cards) |
| `noOverrun` | a mock that may not run over the day's minutes |
| `mock` | a timed exam module (dropped on the eve and the day) |
| `action` | sticky button label, "Start round · 12 questions, 4 min" |

`FeedbackRow`: `{ id, title, status, href, action? }` (at most three show). `ModuleBar`: `{ id, name, score | null, max, pass, href? }`.

What stage A already provides (replace freely inside your folder):
- Practice's rows, one plan.js per sibling feature (round 3): `practice-round` the warm-up, the review round and mistakes from corrections; `practice-write` the Schreiben task from memory and the Schreiben phrases; `practice-speak` speaking situations, the frames on the eve and the Teil 2 talk; `practice-script` the scripts; `practice-clusters` word clusters; `build` Word building. Row ids keep their `practice.*` names; the composer orders by priority, then id, so the split changes no plan.
- `exam/plan.js`: `nextModule()` (a started draft, else Schreiben/Sprechen never attempted, else the lowest latest score, on the first test not yet done), uncorrected Schreiben and unread local corrections as feedback, and the module bars against the manifest's pass lines. Stage B: the full run on exam−4/−3, Fritz's feedback from the results sync, "fits before the exam" counts.

## Data you will find in the store

A learner who used the old apps arrives migrated (`src/data/migrate.js`): B1 FSRS cards in deck `b1`, exam attempts with `legacy: {id, path}` and their `synced` flags, `exams.drafts`, `exams.training`, `exams.voice`, `exams.seen`, `exams.feedbackLocal`, `vocab.local`, `vocab.events`, `b1.session`. Igloo's SM-2 deck is **not** moved (Igloo owns it until Drill and Test move here); `meta.summary.iglooCards` counts it. Formats: `docs/SCHEMA.md`.

### Mistakes from corrections (Exam → Practice)

A corrected Schreiben or Sprechen attempt hands its mistakes to the review queue through `src/data/mistakes.js` (no feature import needed):

```js
import { addMistakes, listMistakes } from '../../data/mistakes.js';
const ids = addMistakes(ctx.store, { attemptId: attempt.id, test: 2, module: 'schreiben', label: 'Test 2 · Schreiben',
  items: feedback.errors.map(e => ({ wrong: e.wrong, right: e.right, rule: e.rule })) });
ctx.go('/practice/round?kind=mistakes');      // "Practise these mistakes · N"
```
Calling it again for the same attempt replaces its list and keeps the ids (and schedules) of unchanged sentences. Each mistake becomes card `F:<attempt>-<n>` in deck `b1`; Practice shows it as "Rewrite this sentence correctly" with the source line "Your Schreiben Test 2", puts unseen ones at the front of rounds (one in three) and offers a mistakes-only round. `listMistakes(store)` gives the count for a button. The records are private and never leave the device except through the results sync.

### Card ids are append-only

Card ids made from content (B1 phrases and grammar, `BS:` Schreiben phrases, `W:` words, `CO:`/`CF:`/`CP:` cluster cards, `SS:` situations) are listed in `tests/fixtures/shipped-ids.txt`. `tests/unit/item-ids.test.mjs` fails when one of them is no longer created by the content (a renamed slug, a word moved from family member to family head, a deleted gap), because the learner's card under that id would lose its schedule. Keep the old id, or migrate its cards and list it in `tests/fixtures/retired-ids.txt` with a reason. After adding content, run `node tools/shipped-ids.mjs --write`; it only ever appends.

## Before you open a PR

```
npm test                      # node:test, all unit tests
npm run test:tz               # the same in three time zones
npm run typecheck             # strict on core, data and the new domain modules
node tools/validate-content.mjs
node tools/check-privacy.mjs --all && node tools/check-dates.mjs
npm run serve                 # http://localhost:8430/ ; ?today=YYYY-MM-DD works on localhost only
npm run test:e2e              # the stamped site in WebKit 390 px and Chromium, mocks for every other host, axe
```
A feature with a new screen or flow adds a spec in `tests/e2e/<feature>.spec.mjs`: start from `seed(page)` (a synthetic profile), `open(page, '#/…')`, drive it by role and label, assert what was stored with `storedCards(page, deck)`, and call `checkA11y(page, '<screen>')` on each new screen. A spec fails on any console error, any request to a host the fixtures do not mock, an HTML string written into the DOM (the Trusted Types tripwire), and any record that does not match `schemas/records` (a new field goes into its schema in the same commit). `main` takes only commits whose `ci` jobs, the e2e among them, passed on a branch first.

Look at your screens at 390 px (WebKit, light and dark, reduced motion) and 1280 px. Playwright's WebKit screenshots inject a style that this CSP reports, so read the console **before** taking a screenshot.
