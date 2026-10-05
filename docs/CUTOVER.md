# Cutover: from Igloo B1 and the B1 exam app to Fluentish

Phase 2 of ARCHITECTURE.md §8, as amended by the review (A1, A4, B2, B5, S2). This page lists what is ready, what must happen first, the order of the switch, the iPhone check, the commands and the rollback.

**Status (5 Oct): the switch is done.** It was brought forward from 13–16 Oct to the morning of 4 Oct, so the exam-week work done in the preview is kept: Fluentish left shadow mode (41fec5c, 10:12), then language-doors (c2c395f, 10:20) and b1-exam (4de23a5, 10:20) were merged and pushed. Fluentish is the one writer of B1 and exam data; Igloo keeps Drill, Test, Write and Look up. Still open: the iPhone checklist below (not recorded as done), the `/b1-review` skill text (step 6; `b1-token.py` is done), and phase 3. The boot-time delta re-merge (step 7, ARCHITECTURE §6) was not built.

The rest of this page is the runbook as it was written before the switch, with each step's status.

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

## Branches (local, not pushed, except Fluentish's)

| Repo | Branch | Commits on top of main |
|---|---|---|
| `~/language-doors` | `cutover` (from `origin/main` 4d90cfb) | `88fd783` B1 hash guard, B1 assets dropped, scoped `swKill`, V 20261004a · `9712b4e` `scripts/cutover-merge.sh` |
| `~/pakrasi-lab/b1-exam` | `cutover` (from main b8833f7) | `380d861` app guard + dashboard stub · `62ba54f` privacy fix · `81487ca`, `1166280` `scripts/cutover-merge.sh` (merge, `--redirect-only`, `--rollback`) |
| `~/pakrasi-lab/b1-exam` | `cutover-redirects` | points at `380d861` (the stubs alone) |
| `~/fluentish` | `docs-cutover` | this page and `tools/cutover/` (the rehearsal); merged into `main` with both blockers fixed and since deleted; the preview merge and the switch are on `main` |

### What each stub does

- **Igloo `app.html`**: the first script in `<head>` checks the hash. On `#b1…` (also `#/b1…`) it runs `location.replace('/fluentish/#' + hash)` on load and on `hashchange`, and the page's own scripts return at once. Not a single localStorage key is read or written on the way out. The B1 nav link, `b1.css` and the nine B1 scripts are no longer loaded. A saved view of `b1` opens Drill. `swKill()` now unregisters only the registration whose scope is `/language-doors/`.
- **b1-exam `docs/app/index.html`**: on a path under `/b1-exam/` (Pages) it unregisters service workers scoped under `/b1-exam/` (none exist today), passes the hash on unchanged and skips `app.js`. An empty hash opens `#/exam`. A `#token=…` link opens `#/profile`, and the token is dropped and never passed on. Served by server.py at `/` on the LAN, it runs the old app as before.
- **b1-exam `docs/index.html`**: a redirect. Pages goes to `/fluentish/#/progress`; server.py `/dashboard` goes to `/#/fortschritt`.
- **Stale tabs**: an open Igloo B1 hub checks `version.json` (at most once a minute). The new V makes it reload into the redirect. An open b1-exam tab checks `docs/app/version.json` on its next navigation, except in the middle of a module, and reloads into the stub. The pre-commit hook bumps that file.

### `version.json` and service workers

- Igloo's `version.json` stays `"sw":"on"`. The old `swKill` on origin/main unregisters **every** registration on `pakrasi.github.io`, Fluentish's included, and any stale B1 tab would run it on `"sw":"off"`. So the cutover only bumps V. The new `swKill` is scoped. Retiring Igloo's worker belongs to phase 3, and that should ship a self-unregistering `sw.js` (`self.registration.unregister()` on activate, scoped by nature) rather than `"sw":"off"`.
- Fluentish (`src/services/sw.js`) registers itself on every load and whenever the page becomes visible, so even an unscoped kill heals on the next visit (tested, E1 below). Its own kill switch is `"sw":"off"` in **Fluentish's** `version.json`. That affects only `/fluentish/` and `fluentish-*` caches. It needs no code change: `tools/stamp.mjs` reads `--sw`, else `FLUENTISH_SW`, and `deploy.yml` sets that from its `sw` input or the repository variable `FLUENTISH_SW` (README › Service worker): `gh variable set FLUENTISH_SW --body off && gh workflow run deploy.yml`.

## Before the switch (blockers)

1. **Preview profiles are kept, not deleted. Done** (`src/data/cutover.js`, `src/data/session.js` `keepPreview`, tests in `tests/unit/cutover.test.mjs`). The live build ran in shadow mode (`config.deployShadow: true`) and real exam-week work was done in it (exam modules, recordings, rounds). A device that opened it has a `shadow` profile as `device.activeProfile`. On the first boot with `deployShadow: false`, `openSession` runs these steps, each recorded in `device.cutover` before it writes:
   1. **Real profile.** A local profile that exists is kept as it is (no second import). Otherwise a new local profile is made and the one-time legacy import runs into it, exactly as on a first run, reading the legacy keys only (never `setItem`, `removeItem` or `clear`). The device's prefs and keys are merged, not overwritten: the theme and the keys the device has stay unless the old app changed that legacy key after the preview read it.
   2. **Merge.** Each preview profile (oldest first) is merged into the real one. Whether "the old app changed a key after the preview read it" is decided by the per-key fingerprint the preview's own import stored (`meta.fingerprint`); with no fingerprint the preview counts as newer.
      - **Cards**: per card id, the record whose last review is newer wins (`u`, the time of the last write; else `last`, the day of the last review), in both directions. The review logs (`hist`) of both are united (dated, the winner's last answer stays last, the last 12 kept as the app does).
      - **Review events** (`card.reviewed`) and every other preview event: united by id.
      - **Exam attempts**: united by id; the preview's records keep their id, times, `eventId`, file `path` and `synced: false`. A preview copy of an old-app attempt (it has `legacy.id`) defers to the import's fresh copy of that attempt, so none is there twice.
      - **Recordings**: the bytes stay in IndexedDB under their `blobRef` (blobs are not per profile, so nothing is copied or deleted). A Sprechen take that was cut off (`exams.takeInProgress` + `take:<id>`) moves over and is recovered on start.
      - **Corrections** (`exams.feedbackLocal`), **saved words** (`vocab.local`), **word answers** (`vocab.events`, keyed by day, word and time), **voice-note list**, **seen feedback**, **mistakes** (by id; `deletedAt` counts as a change): united by id. On a conflict the record with the newer time (`updated_at`, `deletedAt`, `created_at`, `at`) wins; on a tie the preview's for work made in it, the import's for records copied from the old apps. A record either side already sent stays sent, with the file name it was sent under.
      - **Drafts**: per module the draft worked on last (its clock); play counts per recording, the higher. **Writing texts**: by task; a conflict goes to the old app if it changed `training:<task>` since the preview, else to the preview.
      - **Settings** (exam date, minutes, …): per field by `rev` (hybrid logical clock). A field the legacy import stamped (exam date, language, level, exam type, onboarded) goes to the preview's value unless the old app changed that key (`examDate`) after the preview read it. The theme (device prefs) follows the same rule on `doors.prefs.v2`.
      - **Day log and study minutes**: `b1.session.days` united by day (the larger count of rounds wins), the newer `day` stays today's, rounds in progress by start time; `activity` per day, the larger minutes and rounds (the same rule two tabs use).
      - **Not merged**: caches the next sync refills (`exams.remote`, `exams.syncStatus`, `exams.vocabAudio`, `words.exam`), the preview's own import record (`meta`), and the consent flags in `ui` (`importSeen`, `sendLegacy`): the notice must be seen on the real profile.
   3. **Outbox.** Every preview event the results sync sends (`exam.attempt`, `exam.voice`, `feedback.created`, `vocab.captured`, `vocab.reviewed`, `training.logged`) is in the real profile's outbox, unsent, with its original id, `seq`, `at` and file path, so the file names are the ones the preview fixed when the work was done (`YYYYMMDDTHHMMSS` of the original time) and sync.py imports each once (it dedupes by path; a retry of a file that arrived counts as sent). A preview attempt or correction whose event is missing gets one at its own time under a fixed id. Nothing goes out until the notice on Today has been seen (`ui.importSeen`, and `ui.previewSeen` when the real profile existed before); old unsent items from the legacy apps still wait for their own tap.
   4. **Read back, then archive.** The merged records are read back and compared with what was written, and every preview event must be in the real outbox. Only then is the preview profile archived (`archivedAt`, `archivedInto`; it is never opened again) and the real profile made active. It is purged 30 days after `archivedAt`; a recording the real profile still points at is not deleted with it. If the read-back differs, the preview stays as it is, work goes on in the real profile, a toast says so, and the next start merges again.
   - **Resume and idempotence**: a boot cut off during the import removes its half-made real profile (nothing of the preview is in it yet) and imports again; one cut off during the merge merges again, and every write is a put of a merged value, so a second pass changes only what the first did not write. Tested by killing a boot after each of its writes and resuming: every run ends equal to an uninterrupted one. A second boot after a finished cutover changes no record.
   - **Notice**: one toast ("Your work from the preview is kept. Today lists what was added."), then the notice on Today: "Kept from the preview: 2 exam modules, 1 recording, 1 correction, 64 reviews. Imported from the old apps: 412 cards from Igloo, …", plus how many preview results go to the results repo when it is closed. Profile › Data keeps both lines.
   Still: never clear Safari's site data for pakrasi.github.io. The origin is shared, so that also deletes the legacy keys of both old apps.
2. **Word audio reads the private index. Fixed** (`src/services/audio.js`, `src/data/sync/github-b1exam.js`, tests in `tests/unit/audio.test.mjs`). `'vocab-audio'` is in `PULLED`: the results sync reads `data/vocab-audio.json` from the b1-exam repo with the device's token and keeps it under its own store key `exams.vocabAudio` (not exported). `audioManifest()` uses, in order: that private copy; the public `<exam media>/vocab/manifest.json` while it still exists; nothing, and then ▶ uses the device's German voice. The recordings themselves stay public under `b1-exam/audio/vocab/`. A device that isn't linked (or a preview profile, which never syncs) gets the device voice once the public index is gone. So `--redirect-only` is no longer needed: merge b1-exam in full.
   `progress.json` needs nothing: Fluentish never reads it. It reads `data/results.json`, `feedback.json`, `vocab.json`, `learner.json` and `vocab-audio.json`.
3. **Leave shadow mode. Done** (commit "Cutover: leave shadow mode; keep preview work"). `deployShadow: false`, deployed. This step makes Fluentish the writer for the B1 and exam collections, so from here on use Fluentish only for B1 and exams (one writer per collection, review B2). Old Igloo Drill/Test/Write stay fine.

## Order of the switch (planned for 13–16 Oct, done on 4 Oct)

1. Blockers 1 and 2 merged in Fluentish, CI green. **Done.**
2. On each device (iPhone Safari, Mac browser), run the **count bookmark** below on any pakrasi.github.io page and keep the numbers. **Not recorded.**
3. Fluentish leaves shadow mode. **Done 4 Oct** (41fec5c). Open `https://pakrasi.github.io/fluentish/` on each device once; each converts its own preview profile.
4. Run the **iPhone checklist**. Any failure: stop and roll back Fluentish only (the old apps were never touched). **Open: not recorded as done.**
5. Same day: switch language-doors and b1-exam (one command each). **Done 4 Oct** (c2c395f, 4de23a5): `b1-exam/data/progress.json` and `b1-exam/audio/vocab/manifest.json` answer 404.
6. Update the `/b1-review` skill text and `b1-token.py`. **`b1-token.py` done 5 Oct** (b1-exam 53ef168): it opens `https://pakrasi.github.io/fluentish/#/profile?token=…`, which Fluentish takes out of the address, stores on the device and confirms with "Device linked." (`src/core/link.js`). **Open**: the skill text still names the app at localhost:8426.
7. 7 days later: the delta re-merge window (review B2) closes. **Not built**: only the cutover's own merge uses the fingerprints (ARCHITECTURE §6). Phase 3 starts after the exam: port Drill, Test, Write and Look up, then retire Igloo's worker.

## iPhone checklist (the phase-2 gate)

Do it on the iPhone in the same place he uses daily: either a Safari tab or the Home Screen icon. They have separate storage (review S3), so don't mix them.

- [ ] **Preview kept.** On a device that opened the preview, the first visit shows the toast "Your work from the preview is kept…", the preview banner is gone, and Today's notice starts "Kept from the preview:" with the exam modules, recordings and reviews done there. Exam shows the preview's modules, and a preview recording plays back.
- [ ] **Migrated counts match.** Fluentish's import notice on Today shows cards, exam attempts, drafts and words. They equal the bookmark's `b1 cards`, `exam attempts`, `drafts` and `words`, except for cards that migrate.js skips as unusable (no valid S, D, due or reps). Any gap beyond a few cards is a stop. Check the Mac browser the same way.
- [ ] **Mic**: Practice › Sprechen › Mic check passes, and in a speaking situation Check with the mic hears a spoken answer and suggests a grade (Say it aloud folded into the situations in round 3). Exam › a Sprechen part records, plays back and shows its length.
- [ ] **Keyboard stays up** through a typed Practice round of at least 10 items: after Return the field keeps focus and the keyboard does not drop between items, including after a wrong answer and the retype.
- [ ] **Haptics**: a correct answer gives a light tap (`src/services/haptics.js`: iOS has no `navigator.vibrate`, so it clicks a hidden switch input) and the keyboard stays up right after the tap.
- [ ] **A real Sprechen upload reaches the Mac.** Record one short Sprechen part in Fluentish. On the Mac: `python3 ~/pakrasi-lab/b1-exam/scripts/sync.py && python3 ~/pakrasi-lab/b1-exam/scripts/b1-review.py status`. The new recording is listed for that day. Repeat with one Lesen or Hören submit, and one Schreiben submit.
- [ ] **Fritz feedback shows.** Write a short feedback for that day (`b1-review.py feedback N sprechen -`), wait for the sync, then open the day's review page in Fluentish: the feedback is there with its formatting.
- [ ] **A captured word reaches the Mac**: save a word in an exam review, sync, `b1-review.py vocab-todo` lists it.
- [ ] **Background and resume**: lock the phone during a Sprechen recording, unlock: the take is kept or recovered, not lost.
- [ ] **Airplane mode**: answer a few items offline, reconnect: Today shows them sent within a minute.
- [ ] **Word audio** (after the b1-exam merge in step 5 and one sync, e.g. reopen Today): `curl -sI https://pakrasi.github.io/b1-exam/audio/vocab/manifest.json` gives 404, and ▶ on a word in Look up still plays the recording, not the device voice.

**Count bookmark** (save as a bookmark, run it on any `pakrasi.github.io` page; it only reads):

```
javascript:(()=>{const n=k=>{try{const j=JSON.parse(localStorage.getItem(k));return Array.isArray(j)?j.length:j?Object.keys(j).length:0}catch(e){return 0}};alert('b1 cards '+n('doors.b1.fsrs.v1')+'\nexam attempts '+n('remote:attempts')+'\nwords '+n('remote:vocab')+'\nigloo cards '+n('doors.srs.v1')+'\ndrafts '+Object.keys(localStorage).filter(k=>k.startsWith('draft:')).length)})()
```

## Commands

All three ran on 4 Oct; they stay here for the record and for a rollback. Each switch command checks for a clean tree, merges, runs that repo's gates, pushes `main` and says how to check the deploy. Each script is run straight from the branch, so it works before it is on `main`.

**Fluentish leaves shadow mode** (done; this is what ran):

```
cd ~/fluentish && git switch main && git pull --ff-only
sed -i '' 's/deployShadow: true,/deployShadow: false,/' src/core/config.js
npm run test:tz && git commit -am "Cutover: leave shadow mode; keep preview work" && git push origin main
curl -s https://pakrasi.github.io/fluentish/version.json    # "sha" is the new commit once deploy.yml finishes
```

**language-doors** (merge `cutover`, fresh V with `bump_v.sh`, gates `test_match`, `test_b1`, `b1_regress.sh`, push):

```
bash <(git -C ~/language-doors show cutover:scripts/cutover-merge.sh)
```

**b1-exam** (merge under the sync lock, so sync.py can't interleave; resolve the expected conflicts in `docs/data/progress.json`, the word-audio index and `docs/app/version.json`; push; restart server.py). Both blockers are fixed, so this is the full merge, redirects and privacy fix together:

```
bash <(git -C ~/pakrasi-lab/b1-exam show cutover:scripts/cutover-merge.sh)
```

`--redirect-only` is no longer needed (it stays in the script, for a merge of the stubs alone). Afterwards `curl -sI https://pakrasi.github.io/b1-exam/data/progress.json` and `…/b1-exam/audio/vocab/manifest.json` give 404, and the next `sync.py` writes `data/progress.json`.

After the switch, his language-doors working branch `b1-trainer` is behind `main`; continue on `main`.

## Rollback

- **Fluentish**: `cd ~/fluentish && git revert --no-edit <cutover commit>`, pushed to a branch first and then fast-forwarded to `main` once its `ci` passed (`main` takes only such commits since round 3), or redeploy an earlier build with `gh workflow run deploy.yml -f sha=<sha>`. Profiles already made `local` stay local and keep syncing (a shadow-mode build opens the active local profile): the rollback stops new devices from leaving shadow mode, and it doesn't undo synced data. An archived preview profile stays archived; for 30 days its data is still on the device, and `archivedAt` can be removed by hand to reopen it. A build from before the cutover change (ae8af0e or older) never deletes an archived preview either: it doesn't know the field and opens the active local profile. A service worker problem alone: `gh variable set FLUENTISH_SW --body off && gh workflow run deploy.yml` (README › Service worker).
- **After a b1-exam rollback**, Fluentish's word audio needs nothing: the private copy it pulled stays in use until the next sync finds `data/vocab-audio.json` gone and drops it, and from the next start it reads the restored public index.
- **language-doors**: `cd ~/language-doors && git switch main && git pull --ff-only && git revert --no-edit -m 1 <merge sha> && bash scripts/bump_v.sh && git commit -qam "Rollback V" && git push origin main`. The merge sha is in `git log --merges -1`.
- **b1-exam**: `bash <(git -C ~/pakrasi-lab/b1-exam show cutover:scripts/cutover-merge.sh) --rollback`. It reverts every cutover merge under the sync lock, newest first, puts the word-audio index back in `docs/` with the entries added since, pushes, and restarts server.py.
- **What a rollback can't bring back**: B1 reviews done in Fluentish after the cutover exist only in Fluentish. Exam attempts, recordings, words and feedback are safe, because they went to the b1-exam repo. The old apps' localStorage still holds the state from the migration, since migrate.js never writes it.

## `/b1-review` skill text (vault skill, symlinked to `~/.claude/skills/b1-review`)

The skill names the learner where this page says "the learner"; keep its wording there.

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

Also in b1-exam: `scripts/b1-token.py` opens Fluentish with the token in the fragment (`#/profile?token=…`); Fluentish links the device and scrubs the address (`src/core/link.js`, `tests/e2e/link.spec.mjs`). The QR code opens Safari; the Home Screen icon has its own storage, so link it from Profile › Connections.

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
| `#b1/aloud`, `#b1/aloud/go` · `#b1/teil2` | `#/practice/speak/aloud` (since round 3 it opens `#/practice/situations`) · `#/practice/speak/teil2` |
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

- **Home Screen icon and Safari tab** keep separate storage (review S3): each merges its own preview profile on its first visit after the switch. Work done in each is in that storage's outbox under its own file names, so both reach the Mac, each once.
- **The same legacy items in two storages**: the import of old unsent items (legacy `synced:false`) can happen once per storage. Their file names come from the old app's path or their own time (the migration time only when they carry none), so in the usual case a second send is a "422 sha" and counts as sent.
- **Old app and preview changed the same key**: a value the old app holds has no time of its own. When the fingerprint shows the old app changed it after the preview read it, the old app's value wins (exam date, theme, keys, writing texts), even if the preview changed it later still.
- **Offline at the moment of cutover**: Igloo's old worker answers `app.html` from its cache when the network fails. An old B1 hub can then run offline and write legacy keys after the migration. The delta re-merge (review B2) has to catch this for 7 days.
- **Pages caches HTML for up to 10 minutes**, so for that long after a push a browser can still get the old `app.html` and old app. The version checks and the delta re-merge cover it.
- **Hashed audio names stay public** (review N1): `md5(voice|text)` lets someone confirm a guessed word. The fix is the HMAC naming after the exam.
- **Mid-module b1-exam tabs** don't reload until the module ends, by design. A module finished in the old tab after the cutover still uploads through the old app and reaches the Mac as before.
- **WebKit in Playwright is not an iPhone**: mic, keyboard, haptics, Home Screen storage and background behaviour are covered only by the checklist above. Since round 3 the browser e2e suite (ARCHITECTURE §8) runs on every push and gates the deploy; it covers the flows, not the device.
