# Cutover: from Igloo B1 and the B1 exam app to Fluentish

Phase 2 of ARCHITECTURE.md §8, as amended by the review (A1, A4, B2, B5, S2). This page lists what is ready, what must happen first, the order of the switch, the iPhone check, the commands and the rollback.

The old apps stay in use until the exam on 9 Oct **and** the iPhone check below. Nothing here goes live until the owner runs the commands.

## What moves, and what stays

| Old entry point | After the cutover |
|---|---|
| `language-doors/app.html#b1…` (B1 trainer) | `/fluentish/#b1…`; Fluentish's router maps it (table below) |
| `language-doors/app.html#drill`, `#test`, `#lookup/…`, `#write/…` | **stay on Igloo** until phase 3 ports them (review B5/A4) |
| `language-doors/` (home, Prism), `index.html#how`, `explore.html` | stay on Igloo |
| `b1-exam/app/` (Pages app, every hash) | `/fluentish/#…`; the router maps it |
| `b1-exam/` (public results dashboard) | `/fluentish/#/progress` → Exam |
| `b1-exam/audio/`, `b1-exam/exams/` | stay published: Fluentish streams this audio |
| server.py on the Mac (LAN, port 8426) | keeps the old exam app as a Mac-only fallback, plus `/api` for `/b1-review` |

Igloo keeps its service worker for Drill offline, and its SM-2 data (`doors.srs.v1`, `doors.know.v1`, …) stays owned by Igloo.

## Branches (local, not pushed)

| Repo | Branch | Commits on top of main |
|---|---|---|
| `~/language-doors` | `cutover` (from `origin/main` 4d90cfb) | `88fd783` B1 hash guard, B1 assets dropped, scoped `swKill`, V 20261004a · `9712b4e` `scripts/cutover-merge.sh` |
| `~/pakrasi-lab/b1-exam` | `cutover` (from main b8833f7) | `380d861` app guard + dashboard stub · `62ba54f` privacy fix · `81487ca`, `1166280` `scripts/cutover-merge.sh` (merge, `--redirect-only`, `--rollback`) |
| `~/pakrasi-lab/b1-exam` | `cutover-redirects` | points at `380d861` (the stubs alone) |
| `~/fluentish` | `docs-cutover` | this page and `tools/cutover/` (the rehearsal) |

### What each stub does

- **Igloo `app.html`**: the first script in `<head>` checks the hash. On `#b1…` (also `#/b1…`) it runs `location.replace('/fluentish/#' + hash)` on load and on `hashchange`, and the page's own scripts return at once. Not a single localStorage key is read or written on the way out. The B1 nav link, `b1.css` and the nine B1 scripts are no longer loaded. A saved view of `b1` opens Drill. `swKill()` now unregisters only the registration whose scope is `/language-doors/`.
- **b1-exam `docs/app/index.html`**: on a path under `/b1-exam/` (Pages) it unregisters service workers scoped under `/b1-exam/` (none exist today), passes the hash on unchanged and skips `app.js`. An empty hash opens `#/exam`. A `#token=…` link opens `#/profile`, and the token is dropped and never passed on. Served by server.py at `/` on the LAN, it runs the old app as before.
- **b1-exam `docs/index.html`**: a redirect. Pages goes to `/fluentish/#/progress`; server.py `/dashboard` goes to `/#/fortschritt`.
- **Stale tabs**: an open Igloo B1 hub checks `version.json` (at most once a minute). The new V makes it reload into the redirect. An open b1-exam tab checks `docs/app/version.json` on its next navigation, except in the middle of a module, and reloads into the stub. The pre-commit hook bumps that file.

### `version.json` and service workers

- Igloo's `version.json` stays `"sw":"on"`. The old `swKill` on origin/main unregisters **every** registration on `pakrasi.github.io`, Fluentish's included, and any stale B1 tab would run it on `"sw":"off"`. So the cutover only bumps V. The new `swKill` is scoped. Retiring Igloo's worker belongs to phase 3, and that should ship a self-unregistering `sw.js` (`self.registration.unregister()` on activate, scoped by nature) rather than `"sw":"off"`.
- Fluentish (`src/services/sw.js`) registers itself on every load and whenever the page becomes visible, so even an unscoped kill heals on the next visit (tested, E1 below). Its own kill switch is `"sw":"off"` in **Fluentish's** `version.json`. That affects only `/fluentish/` and `fluentish-*` caches. `tools/stamp.mjs` currently writes `sw: 'on'` (line ~147). Using the switch therefore means changing that value and deploying.

## Before the switch (blockers)

1. **Preview profiles must convert (Fluentish code, not done yet).** The live build runs in shadow mode (`config.deployShadow: true`, `src/core/config.js`). A device that opened it has a `shadow` profile as `device.activeProfile`, and the shadow migration set `device.migratedAt`. Once `deployShadow` is false, `openSession` (`src/data/session.js`) still opens that existing profile. It stays `kind: 'shadow'`, so it never syncs, and it holds the legacy data from the preview day, not from exam week. The real migration never runs, because `migratedAt` is set. Profile › Delete all doesn't help either: it keeps `migratedAt` on purpose. Never clear Safari's site data for pakrasi.github.io as a workaround: the origin is shared, so that also deletes the legacy keys of both old apps.
   **Needed:** when the session opens with `kind: 'local'` and the active profile is `shadow`, delete the shadow profiles (they never synced), forget a `migratedAt` that came from a shadow migration (record the profile kind next to it), then migrate from the legacy keys as on a first run. Add a test: shadow migrate → legacy keys change → local boot → counts equal the new legacy data.
2. **Fluentish must read the word-audio index privately** before the full b1-exam merge. `src/services/audio.js` fetches the public `<exam media>/vocab/manifest.json`. The b1-exam `cutover` branch moves that file to private `data/vocab-audio.json`, so Fluentish has to fetch it like the other private files, with the token. Add `'vocab-audio'` to `PULLED` in `src/data/sync/github-b1exam.js` and have `audioManifest()` read the pulled copy. Without a token: no recordings, use the device voice. Until then, merge b1-exam with `--redirect-only`. Without it, word audio silently falls back to the device voice.
   `progress.json` needs nothing: Fluentish never reads it. It reads `data/results.json`, `feedback.json`, `vocab.json` and `learner.json`.
3. **Leave shadow mode.** `deployShadow: false`, deployed. This step makes Fluentish the writer for the B1 and exam collections, so from here on use Fluentish only for B1 and exams (one writer per collection, review B2). Old Igloo Drill/Test/Write stay fine.

## Order of the switch (planned for 13–16 Oct)

1. Blockers 1 and 2 merged in Fluentish, CI green.
2. On each device (iPhone Safari, Mac browser), run the **count bookmark** below on any pakrasi.github.io page and keep the numbers.
3. Fluentish leaves shadow mode (commands below). Open `https://pakrasi.github.io/fluentish/` on each device once.
4. Run the **iPhone checklist**. Any failure: stop and roll back Fluentish only (the old apps were never touched).
5. Same day: switch language-doors and b1-exam (one command each).
6. Update the `/b1-review` skill text and `b1-token.py`.
7. 7 days later: the delta re-merge window (review B2) closes. Phase 3 starts: port Drill, Test, Write and Look up, then retire Igloo's worker.

## iPhone checklist (the phase-2 gate)

Do it on the iPhone in the same place he uses daily: either a Safari tab or the Home Screen icon. They have separate storage (review S3), so don't mix them.

- [ ] **Migrated counts match.** Fluentish's import notice on Today shows cards, exam attempts, drafts and words. They equal the bookmark's `b1 cards`, `exam attempts`, `drafts` and `words`, except for cards that migrate.js skips as unusable (no valid S, D, due or reps). Any gap beyond a few cards is a stop. Check the Mac browser the same way.
- [ ] **Mic**: Practice › Say it aloud: the mic check passes and a spoken answer is graded. Exam › a Sprechen part records, plays back and shows its length.
- [ ] **Keyboard stays up** through a typed Practice round of at least 10 items: after Return the field keeps focus and the keyboard does not drop between items, including after a wrong answer and the retype.
- [ ] **Haptics**: a correct answer gives a light tap (`haptic()` in `src/core/motion.js`: iOS has no `navigator.vibrate`, so it clicks a hidden switch input) and the keyboard stays up right after the tap.
- [ ] **A real Sprechen upload reaches the Mac.** Record one short Sprechen part in Fluentish. On the Mac: `python3 ~/pakrasi-lab/b1-exam/scripts/sync.py && python3 ~/pakrasi-lab/b1-exam/scripts/b1-review.py status`. The new recording is listed for that day. Repeat with one Lesen or Hören submit, and one Schreiben submit.
- [ ] **Fritz feedback shows.** Write a short feedback for that day (`b1-review.py feedback N sprechen -`), wait for the sync, then open the day's review page in Fluentish: the feedback is there with its formatting.
- [ ] **A captured word reaches the Mac**: save a word in an exam review, sync, `b1-review.py vocab-todo` lists it.
- [ ] **Background and resume**: lock the phone during a Sprechen recording, unlock: the take is kept or recovered, not lost.
- [ ] **Airplane mode**: answer a few items offline, reconnect: Today shows them sent within a minute.
- [ ] **Word audio** (after blocker 2): ▶ on a saved word plays the recording, not the device voice.

**Count bookmark** (save as a bookmark, run it on any `pakrasi.github.io` page; it only reads):

```
javascript:(()=>{const n=k=>{try{const j=JSON.parse(localStorage.getItem(k));return Array.isArray(j)?j.length:j?Object.keys(j).length:0}catch(e){return 0}};alert('b1 cards '+n('doors.b1.fsrs.v1')+'\nexam attempts '+n('remote:attempts')+'\nwords '+n('remote:vocab')+'\nigloo cards '+n('doors.srs.v1')+'\ndrafts '+Object.keys(localStorage).filter(k=>k.startsWith('draft:')).length)})()
```

## Commands

Each switch command checks for a clean tree, merges, runs that repo's gates, pushes `main` and says how to check the deploy. Each script is run straight from the branch, so it works before it is on `main`.

**Fluentish leaves shadow mode** (after blockers 1 and 2):

```
cd ~/fluentish && git switch main && git pull --ff-only
sed -i '' 's/deployShadow: true,/deployShadow: false,/' src/core/config.js
npm test && git commit -am "Cutover: leave shadow mode" && git push origin main
curl -s https://pakrasi.github.io/fluentish/version.json    # "sha" is the new commit once deploy.yml finishes
```

**language-doors** (merge `cutover`, fresh V with `bump_v.sh`, gates `test_match`, `test_b1`, `b1_regress.sh`, push):

```
bash <(git -C ~/language-doors show cutover:scripts/cutover-merge.sh)
```

**b1-exam** (merge under the sync lock, so sync.py can't interleave; resolve the expected conflicts in `docs/data/progress.json`, the word-audio index and `docs/app/version.json`; push; restart server.py):

```
bash <(git -C ~/pakrasi-lab/b1-exam show cutover:scripts/cutover-merge.sh)                   # redirects + privacy fix
bash <(git -C ~/pakrasi-lab/b1-exam show cutover:scripts/cutover-merge.sh) --redirect-only   # if blocker 2 is not done yet
```

Running it again without `--redirect-only` later merges the privacy fix. Afterwards `curl -sI https://pakrasi.github.io/b1-exam/data/progress.json` gives 404 (after the full merge) and the next `sync.py` writes `data/progress.json`.

After the switch, his language-doors working branch `b1-trainer` is behind `main`; continue on `main`.

## Rollback

- **Fluentish**: `cd ~/fluentish && git revert --no-edit <cutover commit> && git push origin main`, or redeploy an earlier build with `gh workflow run deploy.yml -f sha=<sha>`. Profiles already made `local` stay local: the rollback stops new devices from leaving shadow mode, and it doesn't undo synced data.
- **language-doors**: `cd ~/language-doors && git switch main && git pull --ff-only && git revert --no-edit -m 1 <merge sha> && bash scripts/bump_v.sh && git commit -qam "Rollback V" && git push origin main`. The merge sha is in `git log --merges -1`.
- **b1-exam**: `bash <(git -C ~/pakrasi-lab/b1-exam show cutover:scripts/cutover-merge.sh) --rollback`. It reverts every cutover merge under the sync lock, newest first, puts the word-audio index back in `docs/` with the entries added since, pushes, and restarts server.py.
- **What a rollback can't bring back**: B1 reviews done in Fluentish after the cutover exist only in Fluentish. Exam attempts, recordings, words and feedback are safe, because they went to the b1-exam repo. The old apps' localStorage still holds the state from the migration, since migrate.js never writes it.

## `/b1-review` skill text (vault skill, symlinked to `~/.claude/skills/b1-review`)

```
-description: Fritz reviews the learner's daily Goethe B1 mock exam (app at localhost:8426) — reads …
+description: Fritz reviews the learner's daily Goethe B1 mock exam (app at https://pakrasi.github.io/fluentish/#/exam) — reads …

-and voice files in `…/fritz/b1-voice/`. He may have taken the exam on the Pages app (https://pakrasi.github.io/b1-exam/app/), in which case
-results arrive as files in `data/` of the repo — run `python3 ~/pakrasi-lab/b1-exam/scripts/sync.py` first to import them.
-The app shows feedback on the day page and under Fortschritt (Pages app: after the next sync, which the feedback command triggers).
+and voice files in `…/fritz/b1-voice/`. He takes the exams in Fluentish (https://pakrasi.github.io/fluentish/#/exam); results
+arrive as files in `data/` of the repo — run `python3 ~/pakrasi-lab/b1-exam/scripts/sync.py` first to import them.
+Fluentish shows feedback on the test's review page after the next sync, which the feedback command triggers.
+The old exam app on localhost:8426 is a Mac-only fallback.
```

Under "Content upkeep" add: Fluentish reads its own copy of the exams (`content/exams/goethe-b1/`). An edited `docs/exams/dayNN.json` has to be copied there too and validated there. Its audio stays in b1-exam.

Also in b1-exam: `scripts/b1-token.py` opens `https://pakrasi.github.io/b1-exam/app/#token=…`. After the cutover that link drops the token and opens Fluentish's Profile, where the device is linked. Point `APP` at the Fluentish link flow once it accepts a token link, or link devices from Profile.

## Test evidence

`bash tools/cutover/run.sh` rebuilds the rehearsal. One local server stands in for pakrasi.github.io, with `/language-doors/`, `/b1-exam/` and `/fluentish/` and a switch from old to new for each site. Old means `origin/main` / `main`; new means the `cutover` branches; Fluentish is this checkout. It seeds synthetic legacy keys, registers Fluentish's real `sw.js` and a dummy worker under `/b1-exam/app/`, opens the old apps, deploys the new ones under them and then checks:

| Check | Chromium | WebKit (iPhone 14) |
|---|---|---|
| A1–A3 old Igloo registers its SW; old B1 hub and old b1-exam app load | pass | pass |
| B1 a stale b1-exam tab reloads into `/fluentish/#/exam` on its next navigation | pass | pass |
| B2 a stale B1 hub reloads into `/fluentish/#/practice` after its version check | pass | pass |
| C1 no legacy localStorage key changed by any redirect or by Fluentish | pass | pass |
| C2 no token stored or left in a URL | pass | pass |
| C3 the migration ran (no redirect ended on `#/welcome`) | pass | pass |
| C4 an in-page `#b1/round` link on the new Igloo goes to Fluentish | pass | pass |
| D1–D3 after every stub: Fluentish's and Igloo's workers registered, `/b1-exam/app/` removed | pass | pass |
| D4 the new Igloo `sw.js` (V 20261004a) is served; D5 the Drill page runs without B1 | pass | pass |
| D6 the scoped `DG.swKill()` removes `/language-doors/` only | pass | pass |
| E1 after the **old** unscoped swKill removed Fluentish's worker, Fluentish re-registers it on its next load | pass | pass |
| 40 old links → expected route (table below) | 40/40 | 40/40 |

Links checked (old → final URL):

| Old | Fluentish |
|---|---|
| `app.html#b1`, `#/b1` | `#/practice` |
| `#b1/round` · `#b1/missed` | `#/practice/round` · `…?kind=missed` |
| `#b1/words`, `#b1/words/round` · `#b1/sprechen`, `#b1/situations` · `#b1/lesen` · `#b1/grammar` | `#/practice/round?kind=area:words` · `area:speaking` · `area:reading` · `area:grammar` |
| `#b1/grammar/dass` | `#/practice/round?kind=topic:dass` |
| `#b1/aloud`, `#b1/aloud/go` · `#b1/teil2` | `#/practice/speak/aloud` · `#/practice/speak/teil2` |
| `#b1/frames` | `#/lookup/frames` |
| `b1-exam/app/`, `#/`, `#/fortschritt`, `b1-exam/`, `b1-exam/index.html` | `#/exam` |
| `#/tag/3` · `#/tag/3/lesen` · `#/tag/3/schreiben?review=42` | `#/exam/3` · `#/exam/3/lesen` · `#/exam/3/schreiben/review/42` |
| `#/woerter`, `#/woerter/ueben` · `#/woerter?tag=4` | `#/lookup/words` · `#/lookup/words?test=4` |
| `#/training`, `#/training/1-aufgabe1` | `#/practice/write` |
| `#/einstellungen` · `#/export` · `#token=…` | `#/profile` · `#/profile/data` · `#/profile` |
| Igloo `#drill`, `#test`, `#lookup/phrases`, `#write`, `#b1x`, bare `app.html` (saved view `b1`), `/`, `index.html#how`, `explore.html` | stay on Igloo (Drill, Test, Look up, Write; home; `index.html`) |

Also checked:
- **Igloo gates on the `cutover` branch**: `test_match.mjs`, `test_b1.mjs`, and `b1_regress.sh` ("Test/Drill unchanged").
- **server.py from the `cutover` branch, in a sandbox** (`B1_SANDBOX=1`, `--no-sync`, throwaway HOME): `/` runs the old app with no redirect; `/audio/vocab/manifest.json` is served from `data/vocab-audio.json`; `/dashboard` goes to `/#/fortschritt`.
- **`sync.py --no-push` on a copy of the branch, with a throwaway HOME and DB**: it writes `data/progress.json` and no `docs/data/`. `vocab_audio.py` carries every entry of the old public index into `data/vocab-audio.json`.
- **Both merge scripts on throwaway clones with a fake remote**:
  - language-doors: merge, V bump, gates, push.
  - b1-exam `--redirect-only`, then the full merge, after main had moved on (a sync, a new audio entry, an app version bump). The new entry survived, `docs/data/progress.json` and the public index were gone, and a rerun said "nothing to merge".
  - b1-exam `--rollback`: it brought back the old app and dashboard, `docs/data/progress.json` and the public index with every entry.

## Risks left

- **Blocker 1** (preview profiles) is the main data risk: without it, exam-week progress on a device that opened the preview never reaches Fluentish, and nothing syncs.
- **Offline at the moment of cutover**: Igloo's old worker answers `app.html` from its cache when the network fails. An old B1 hub can then run offline and write legacy keys after the migration. The delta re-merge (review B2) has to catch this for 7 days.
- **Pages caches HTML for up to 10 minutes**, so for that long after a push a browser can still get the old `app.html` and old app. The version checks and the delta re-merge cover it.
- **Hashed audio names stay public** (review N1): `md5(voice|text)` lets someone confirm a guessed word. The fix is the HMAC naming after the exam.
- **Mid-module b1-exam tabs** don't reload until the module ends, by design. A module finished in the old tab after the cutover still uploads through the old app and reaches the Mac as before.
- **WebKit in Playwright is not an iPhone**: mic, keyboard, haptics, Home Screen storage and background behaviour are covered only by the checklist above.
