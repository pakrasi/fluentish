# Sharing Fluentish safely

Fluentish at `https://pakrasi.github.io/fluentish/` is now shared with other people. There are no accounts yet
(ARCHITECTURE §9, Supabase with Auth and row-level security, is the later fix), so this document covers how the app
keeps the owner's private device sync protected and keeps everyone else's use separate. It has three parts: the
audit (what a visitor could reach or see before this change, and what they can now), the rules the code follows, and
the open items for the coordinator.

Terms used here:

- **Visitor**: anyone who opens the site without a GitHub token on their device. Their profile is local only.
- **Owner's device**: a device that already synced with the owner's results repository before this change. It
  holds a token, or sync state that only a sync can write.
- **Connection**: a profile's results repository (`settings.connections.results`, `owner/name`) plus the token on the
  device (`secrets.githubToken`, device scope, never exported, synced or backed up). The code is in
  `src/data/connection.js`.

## 1. Audit

The tests named below check each finding. "Before" describes `main` at 5d4aca4, and "after" describes this branch.

### 1.1 Ways a visitor's actions could reach the owner's repository or data

| Path | Before | After | Test |
|---|---|---|---|
| Results sync (`data/sync/index.js` → `github-b1exam.js`): attempts, recordings, corrections, words, word answers, training texts | Sends only with a token on the device. The repository was hard-coded (`config.resultsRepo`), so a visitor's own token was tried against the owner's repository (it gets a 404 because it has no access) | Sends only when the profile connects a repository **and** the device holds a token. A visitor has neither, so no request is made | `sharing.test` › visitor: sync, backup, restore and the merge make no request |
| Progress backup (`data/events/`, `data/snapshots/`) and the daily error-log upload (`data/logs/`) | The same consent as the sync, with a token and the hard-coded repository | The same as the sync. The backup block is hidden without a repository | the same test, plus the e2e visitor spec |
| Restore from backup and the automatic merge (reads other devices' files) | Token only | Connected only. `restore().merge()` returns `null` without making a request | the same test |
| Exam words (`data/vocab.json`), Look up › Words › mine, Practice › Exam words | Token only, URL built from the hard-coded repository | Connected only. The URL comes from the profile's repository (`shared/data.js vocabUrl`) | e2e visitor spec (Look up › Words: no link notice, no request) |
| Feedback from the results review (`/b1-review` writes `feedback.json`; the app pulls it) | Pulled with a token | Pulled only when connected. A visitor has none, so the feedback rows never exist on their device | `sharing.test`, e2e visitor spec |
| Private word audio index (`vocab-audio.json`, `exams.vocabAudio`) | Pulled with a token | Connected only | as above |
| Device link (`#token=…` from `b1-token.py`) | Any URL-safe string was stored as the token without a check | The token is checked with GitHub **before** it is stored. A token that cannot reach the repository is dropped, a classic token with the `repo` scope is refused, and a link whose `exp` has passed is refused | `sharing.test` › device link; `link.spec` › expired link |
| Token check (`GET /repos/<repo>`, `GET /user/repos`) | Only on a manual "Check" | On link, on Connect, and on start at most once a study day, only with the device's own token for the connected repository | `sharing.test` › token check, recheck |
| Study hours file (`https://pakrasi.github.io/language-stack/data/toggl.json`) | **Fetched for any visitor who picked Progress › Time per week › All tracked**, which showed the owner's Toggl hours | No default. All tracked appears only after a learner enters their own file. The owner's devices keep his file through the migration (§2.2) | `progress-view.test`, `sharing.test` › new profile, e2e visitor spec |
| Claude calls | The visitor's own key, sent to `api.anthropic.com` only | Unchanged | (none needed) |
| Exam audio (`https://pakrasi.github.io/b1-exam/audio/`) | Public exam recordings that the app publishes. No personal data | Unchanged | (none needed) |

**Expected result, confirmed:** with no token on the device, no path reaches the owner's repository. The e2e spec
`tests/e2e/sharing.spec.mjs` records every request on a first visit and on every tab of a seeded visitor (Today,
Progress, Practice, Exam, Look up › Words, Profile, the opened connect form). It finds zero requests to
`api.github.com` and zero to `pakrasi.github.io` outside the exam audio. This runs on top of the suite-wide sealed
network, where GitHub answers only a fake token.

### 1.2 Places where the owner's personal data or names showed to a visitor

| Where | Before | After |
|---|---|---|
| Progress › Time per week › All tracked | **The owner's Toggl hours** (the finding the brief expected) | Hidden until a learner adds their own file ("Add a study hours file") |
| Progress › source line | "Source: pakrasi/language-stack, data/toggl.json" | Only the learner's own source |
| Profile › Connections | The token hint named `pakrasi/b1-exam` | "Not connected. Your progress stays in this browser." The connect form is closed by default and empty |
| Profile › Data › Backup | "…go to pakrasi/b1-exam…", "Restore from backup", the automatic merge | Replaced by "Where your progress is kept" (stays in this browser, export to keep a copy, accounts are planned) |
| Exam tab sync line | "Results stay on this device until it is linked to your results repository. Link in Profile" | Hidden without a repository |
| Exam › Sprechen review | "…Link it to your results repository in Profile so they can be corrected" | "Your recordings are saved on this device." |
| Look up › Words › mine | "Exam words … are kept with your B1 exam results: link this device" | Hidden without a repository |
| Corrections from the results review ("Correction from your tutor", "Your tutor transcribes…") | Shown only when connected, so a visitor could never see them | Unchanged (owner only). No string names Fritz or the owner |
| Today import notice ("…not sent to {repo}…") | Only after a legacy import with a token | Uses the profile's repository |
| Profile › Data | Printed "null" for each optional part it left out (a DOM `append(null)` bug that visitors saw first) | Fixed |

The e2e visitor spec checks the rendered text of every page above against the repository names, `toggl.json`,
"your tutor" and every term in the git-ignored `.privacy-terms` (on the owner's machines; CI checks the generic
terms).

### 1.3 Residual risks (not fixed here)

- **Shared origin.** Every site under `pakrasi.github.io` is one browser origin, so any page there can read
  Fluentish's IndexedDB on the same browser, including the owner's token. This has always been true. The rule "no
  third-party script on an origin that holds tokens" (ARCHITECTURE §4) is what protects it. Moving the app to its own
  domain (ARCHITECTURE §9) removes the risk.
- **Someone else's export.** If a visitor imports an export file from the owner, the file's settings carry
  `connections.results`. The visitor's profile then says "Not connected on this device. This profile's repository is
  …". Nothing can be sent without a token for it. Exports never carry tokens, the token check or device collections.
- **A token in a link stays a token.** `exp` stops the app from accepting an old link. It does not stop someone
  holding the URL or the QR image from reading the token in it (§3.3).

## 2. What the code does

### 2.1 No owner defaults

- `src/core/config.js` names no repository. `config.resultsRepo` and `config.hoursDefault` are gone. A unit test
  fails if any module other than `src/data/connection.js` names `pakrasi/…`, `b1-exam` or `language-stack`.
- The repository is `settings.connections.results`: per profile, synced and merged per field like other settings,
  validated as `owner/name` (`schemas/records/settings.schema.json`).
- `connectionState(store)` is `'none'` (no repository, local only), `'device'` (a repository but no token on this
  device) or `'connected'`. `githubToken(store)` returns `null` when no repository is set, so a token on its own is
  never used.
- The study hours file is `settings.connections.hours`. With none set, Progress shows only the app's minutes and an
  "Add a study hours file" button. "Remove source" goes back to that state.

### 2.2 The owner migration (his devices keep working)

`migrateConnections()` runs at boot in `main.js`, once per profile:

1. It skips a preview (shadow) profile, and any profile whose `meta.connections` is already set.
2. It looks for a trace that only the owner's devices can have: a GitHub token on the device, the pulled results
   (`exams.remote` with a cursor or `fetchedAt`), the sync status (`exams.syncStatus.at`), or backup state (`backup`
   with `at`, `snapshot` or `files`). Results waiting in the outbox do **not** count, because a visitor who took a
   mock exam has those.
3. When it finds a trace, it fills only the fields that are unset: `connections.results = 'pakrasi/b1-exam'` and
   `connections.hours = {repo: 'pakrasi/language-stack', path: 'data/toggl.json', lang: 'german'}`. A null `hours`,
   which meant "the old default", counts as unset. An hours file the owner chose himself is kept.
4. It always records `meta.connections = {at, owner, set}`. The second run does nothing, and the migration never
   refills a value the learner removed later. A visitor's profile is marked `owner: false` on its first start, so a
   token added later never turns it into the owner's.

Evidence from `tests/unit/sharing.test.mjs`. The fixture is the owner's current state shape: a token, `exams.remote`
with an ETag cursor, `exams.syncStatus`, a backup state with a snapshot, settings from before connections, and the
import record with `importSeen`.

- The migration sets the repository and the hours file. Every other settings field and every existing `rev` stamp is
  unchanged. `meta.migratedAt` and the import summary are kept, so the upload consent is unchanged.
- **Idempotent:** a second run leaves `settings` and `meta` byte-identical and appends no event.
- Each trace on its own is enough, his own hours file is never overwritten, and a shadow profile is never touched.
- **The sync output is unchanged:** the same fixture with the same results synced (1) through the old path, straight
  to `pakrasi/b1-exam`, and (2) after the migration through the seam. Both write the same result files byte for byte
  (`data/attempts/20261003T180405-day03-lesen.json` and the rest) and the same backup paths
  (`data/events/<device>/<day>.ndjson`, `data/snapshots/…`). The only difference is two additive `settings.changed`
  lines in the events file (the migration's own writes).
- The existing sync contract tests still pass, now running as an owner profile (`sync-harness.mjs ownerConnect`).
  That includes the test that runs the real `scripts/sync.py` over everything the adapter writes, and the cutover's
  `sync.py` test.
- The e2e owner fixture (a device with a token, then a boot) shows "Connected to pakrasi/b1-exam.", "Back up now"
  and Restore. `progress.spec` › All tracked runs as that device and reads the Toggl file. `backup.spec` backs up,
  deletes everything, relinks with the device link and restores.

His devices see one difference: a token check on start, at most once a study day (two GET requests). After that,
Profile › Connections shows the token's expiry and any warning.

### 2.3 Token safety (`src/data/sync/token-check.js`)

- **When:** on a device link before anything is stored, on Connect in Profile, and on start when the last check is
  from an earlier study day or for another token. The check is kept in device kv `connection.check` with a 12-hex
  SHA-256 fingerprint of the token. It never holds the token, is never exported, and is never uploaded.
- **What:** `GET /repos/<repo>` (200 means the token reaches it; 401, 403 and 404 mean denied;
  `github-authentication-token-expiration` gives the expiry; `x-oauth-scopes` is present only for classic and OAuth
  tokens), then for a fine-grained token `GET /user/repos?visibility=private`, to see whether it reaches other private
  repositories.
- **Verdicts:**
  - Refused: a classic token (`ghp_`/`gho_`, or any token reported with scopes) that has the `repo` scope. It is never
    stored, and a stored one is removed on the next check with a toast. The owner's current token is fine-grained,
    which was checked by its prefix only, so his devices are not affected.
  - Denied: a 401, 403 or 404.
  - Offline: GitHub could not be reached.
  - OK, with warnings: `broad` (classic, or reaches other private repositories), `noExpiry` and `readOnly`.
- **The token is never shown:** password fields that are emptied after use, with a generic placeholder. No feature
  builds a link or a QR code from it, and nothing logs it. A unit test scans `src/` for both, and
  `core/log.js` scrubs token shapes. The e2e checks that the page HTML and every input value lack the token.
- **Disconnect this device** removes the token and its check. The profile keeps its repository, so "Connect this
  device" with a new token works again. **Forget the repository** removes that too.
- **Lost a device?** Profile › Connections links to `https://github.com/settings/personal-access-tokens`: revoking
  the token there stops it on every device at once, and the other devices are then linked again with a new token.

### 2.4 Device link (`src/core/link.js`, `main.js linkDevice`)

The fragment may carry `token`, `repo=owner/name` and `exp=<unix seconds>`. All three are scrubbed from the address
before anything else runs. Then:

- `exp` in the past, more than one hour ahead, or not a number: refused ("This link has expired"). GitHub is not asked.
- The repository is the link's `repo`, else the profile's, else, for a profile with none, the owner's. That fallback
  is what `b1-token.py` links rely on today. A link never moves a profile to another repository.
- The token must pass the check (§2.3), with a 12-second limit. Only then are the token and the repository stored.
  When the repository is the owner's, the owner's hours file is set too, as the migration would. A failed or offline
  check stores nothing.

### 2.5 Visitor experience

A first-time visitor gets the full app on their device: onboarding, Today, Practice, Exam (results stay local and
Writing corrections use their own Claude key), Look up, Progress with the app's minutes, export and import.
Profile › Data says that progress is saved in this browser only, that clearing site data or a private window removes
it, how to export and import, and that accounts are planned. Results sync is offered as an optional, closed
"Connect a GitHub repository" form for someone with a repository of their own.

## 3. For the coordinator

### 3.1 Merge notes

- Additive data only: a new settings field (`connections.results`), a new field in kv `meta` (`connections`), and a
  new device kv `connection.check` (in `DEVICE_SCOPE` and `NOT_EXPORTED`). No collection or record shape changed. The
  settings schema's `connections.hours.lang` now also accepts a project name such as `german`, which is what the file
  uses.
- Files touched outside sync and Profile: `features/exam/{data,pages,review}.js` (sync line and Sprechen text only),
  `features/lookup/{data,index}.js`, `features/practice/hub.js` and `features/shared/data.js` (the token check
  becomes `connected()`), and `features/today/{index.js,progress/*}`. Practice-round grading, mistakes, explore,
  quick sort and speech are untouched.

### 3.2 Exact change for `b1-token.py` (pakrasi/b1-exam, not edited here)

Make the link short-lived and name its repository. Fluentish already enforces both:

```python
import time
# …
    exp = int(time.time()) + 600          # the link works for 10 minutes
    url = f"{APP}#/profile?token={token}&repo={REPO}&exp={exp}"
```

Also:

- Accept only fine-grained tokens. Replace `token.startswith(("github_pat_", "ghp_"))` with
  `token.startswith("github_pat_")`, because Fluentish refuses a classic token with the `repo` scope anyway.
- Delete the QR image after use: `b1-app-qr.png` holds the token in clear text. Add `png.unlink()` once the
  phone has scanned it, or don't write the PNG at all.
- Print that the link expires in 10 minutes. Run the script again for another device.

Once the script sends `exp`, the app can require it. In `src/core/link.js takeLink`, treat a missing `exp` as expired
(`const expired = found.exp == null || …`), and update the "link without exp still links" case in
`tests/unit/sharing.test.mjs`.

### 3.3 Still open

- `exp` limits how long the app accepts a link. It does not make the token in the URL one-time. Only accounts can do
  that, with a server-issued, single-use link code (ARCHITECTURE §9 and the Supabase accounts plan: anonymous to
  linked accounts with RLS, which also retire the per-device PAT).
- A separate origin for the app (§1.3).
