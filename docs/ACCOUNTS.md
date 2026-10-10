# Accounts

Fluentish works without an account and always will: progress lives on the device, and the GitHub backup is the
owner's second copy. Accounts add sign-in with an email code and a server copy of the same backup files, so
progress follows a person across devices without a GitHub token. This page holds the design, the stages and the
owner's setup list. The full assessment, with the provider comparison and the sources, is the round 8 auth report.

## Where it stands

**Stage 0 is built and off.** The code is in, the default provider is LocalOnly, and nothing changes for anyone
until `config.accounts` is filled in on an origin that the guard accepts. With LocalOnly:

- `account.available()` is false. Profile has no Account section and Diagnostics has no Accounts line; the page is
  byte for byte what it was (checked by a DOM diff against the commit before).
- No request is made. The local provider has no network code at all. A unit test runs every call with a `fetch`
  that fails the test, and `sharing.spec` fails on any request to `*.supabase.co`.
- The store is never read or written for accounts.

## Design

### Module (`src/data/account/`)

| File | Role |
|---|---|
| `index.js` | `openAccount({store})`: the only import for features and data modules. Made lazily by Profile, once per store; `main.js` does not load it |
| `config.js` | `resolveAccountsConfig(config.accounts, location)` → `{provider: 'local' \| 'fake' \| 'supabase', reason}`; `connectHost()` for the CSP |
| `session-store.js` | the `SessionStore` port; default the device kv `account.session`. The iOS shell can swap in the Keychain |
| `providers/local.js` | LocalOnly, the default: every call answers `off` |
| `providers/fake.js` | an in-memory server for development and e2e: `?accounts=fake` on localhost only; the code is `123456` |
| `providers/supabase.js` | a thin `fetch` client for Supabase Auth, no SDK. Loaded only for a resolved project |
| `types.js` | `Account`, `Provider`, `Session`, `AccountState`, `AccountError` |

The account (`types.js Account`): `available()`, `provider()`, `reason()`, `state()` (`off`, `signedOut`,
`codeSent`, `signedIn`, `offline`), `getSession()` → `{userId, email, expiresAt}`, `signIn({email})` sends the
6-digit code, `verify({code})`, `restart()`, `signOut({everywhere})`, `authFetch(path, init)`, `onChange(fn)`, and
`deleteAccount()` (stage 3).

Rules, each covered by `tests/unit/account.test.mjs`:
- **No token leaves the module.** `getSession()` and `onChange()` carry no token. Data modules reach the server
  through `authFetch()`, which adds the key and the bearer token.
- **Offline is a state.** A refresh that gets no answer, or a 5xx (a paused free project), keeps the session and
  shows `offline`. Only a refused refresh token (400 or 401) signs out.
- **One tab refreshes.** A Supabase refresh token works once, and a reuse after 10 seconds ends the session. The
  refresh runs under `navigator.locks` `account-refresh`. A tab that waited takes the pair the other tab stored; the
  store's BroadcastChannel carries the kv to every tab. `authFetch` retries once after a 401.
- **Sign out is local first.** The session is gone at once, offline too; then the server is told when it can be.

### The config guard

`config.accounts` is `{provider, url, publishableKey, origins}`, all public values. Accounts turn on only when all
of these hold; anything else is LocalOnly with a reason, shown in Diagnostics unless the reason is "not configured":

- `provider` is `'supabase'`
- `url` is `https://<20-character ref>.supabase.co`, with no path or port
- `publishableKey` starts with `sb_publishable_`. A legacy key (a JWT, anon or service_role) and a secret key
  (`sb_secret_`) are refused
- `origins` lists exact https origins, none on `github.io`
- the page's origin is one of them, and it is not on `github.io`

Why github.io is refused: every repository's site under `pakrasi.github.io` shares one origin, so any of those pages
could read Fluentish's IndexedDB and take the session. Accounts need an origin of their own.

`tools/stamp.mjs` adds the project URL to `connect-src` only when the config could turn accounts on. No `wss:`, script,
frame or image host is added.

### What is stored, and where it never goes

| kv (device scope) | Shape | Written |
|---|---|---|
| `account.session` | `{accessToken, refreshToken, expiresAt (ms), userId, email}` or null | stage 0 with the fake provider; stage 2 for real |
| `account.claim` | the first sign-in's upload journal | stage 2 |
| `backup.account` | the account target's backup state: kv `backup`'s shape plus `seqHigh` | stage 2 |

All three are in `store.js DEVICE_SCOPE` and `transfer.js NOT_EXPORTED`. An export leaves them out and an import
skips them; a snapshot never holds them (its kv list is an allow-list); `core/log.js` scrubs JWTs, `sb_secret_` keys
and the token field names; `tools/check-privacy.mjs` blocks `sb_secret_` keys and JWTs in the repo. The profile kv
`meta.account = {userId, profileId, claimedAt, deviceId}` and `profile.remoteId` are reserved for stage 2 and not
written before then.

### The backup seam

`backup.js backupProgress()` takes `stateKv`, `pending` and `markSent` (defaults: `'backup'`, the events not marked
synced, `event.synced`). Stage 2 calls it a second time with `'backup.account'`, its own selector by `seq`, and its own
mark, so the GitHub target and the account target never share a flag. The account's `Files` (read, write, list by
path) is the `files` table; the restore and the automatic merge read it unchanged.

### Server (stage 2)

`supabase/migrations/0001_accounts.sql`: tables `profiles`, `devices`, `files`, RLS on each with
`(select auth.uid())`, grants to `authenticated` only, the sha, size and a 200 MB quota per account set by a trigger,
at most 5 profiles. `supabase/tests/rls.sql`: 21 checks that print ok. Both were dry-run on PGlite (Postgres in
WebAssembly) with a stand-in auth schema; the first run on Supabase is part of the owner's setup.

The Auth endpoints the client uses (`/auth/v1/otp`, `/verify`, `/token?grant_type=refresh_token`, `/logout`) are
described in the GoTrue README, not in Supabase's reference docs. `tests/fixtures/account/supabase.json` pins the
shapes the client depends on; re-record them from the real project at stage 2.

## Stages

0. **Prep (built).** The module, LocalOnly, the guard, the fake provider, the hidden Profile section, the CSP and
   privacy hooks, the SQL, the backup parameters.
1. **Own origin.** Serve the same build from the new domain through a second deploy target. A "Move to the new
   address" flow on the old origin hands the data over with `postMessage` after an exact origin check. Do not put a
   custom domain on `pakrasi/fluentish`: GitHub would redirect, and the progress stored on the old origin could no
   longer be opened.
2. **Accounts for the owner.** Fill `config.accounts`, run the SQL, email-code sign-in, the claim (a local export
   first, then this device's files up, read back and compared), the GitHub-to-account copy byte for byte, the account
   as a second backup target. Phone first, then the second device joins.
   Done in round 8 integration: `Delete all` clears the three account kv (b5117d8); `backup.js leakIn` refuses JWTs
   and `sb_secret_` keys (a4794c0).
   Code still to write before stage 2 (round 8 code review S9): **a refresh across two tabs can burn the session.**
   Tab A refreshes and writes the new pair with `store.set`; it posts to the BroadcastChannel only after the IndexedDB
   write, but releases the `account-refresh` lock as soon as `run` returns. Tab B then takes the lock, reads its
   in-memory kv (still the old refresh token) and sends the rotated one; outside Supabase's reuse interval that
   revokes the token family and both tabs are signed out (`data/account/index.js` refresh, `store.js` set). Fix: inside
   the lock read `account.session` from the adapter (`adapter.loadScope('device')`), not the store cache, or hold the
   lock until the store write and the post have resolved. Test: two tabs in a unit test with a delayed channel.
3. **Other people.** Invite-only or open sign-ups with custom SMTP; results to the account; `delete-account` Edge
   Function; "Download my data"; no `#token=` device links for account users.
4. **Real sync, then GitHub retires.** An `events` table with a server sequence; the Claude proxy; `sync.py` and
   `/b1-review` read from Supabase; the PAT goes after 30 days of both targets agreeing.
5. **iOS.** Keychain `SessionStore`, `capacitor://localhost` origin, passkeys once Supabase marks them GA, optional
   native Sign in with Apple.

No anonymous accounts at any stage: the app already serves anonymous visitors locally, and the first real sign-in
is the claim.

## Owner setup

Nothing here is needed for stage 0. Steps 1 to 4 unblock stage 1, steps 5 to 12 stage 2.

**A. Domain and hosting**
1. Buy a domain, or pick a subdomain of one you own (about USD 10 to 20 a year).
2. Pick the host for the new origin: Cloudflare Pages (free, real CSP and HSTS headers) or a second GitHub Pages
   repository. Do not set a custom domain on `pakrasi/fluentish` or on `pakrasi.github.io`.
3. DNS: a `CNAME` for a subdomain; for a GitHub apex, the four `A` and four `AAAA` records and the
   `_github-pages-challenge-pakrasi` `TXT` record.
4. Turn on HTTPS (up to 24 hours on GitHub), then send the coordinator the final origin, e.g.
   `https://fluentish.example.com`.

**B. Supabase**

5. Create a new project `fluentish` (not the leaderboard one), Free plan, Central EU (Frankfurt). Keep the database
   password in your password manager.
6. Auth › URL configuration: Site URL and one redirect URL, both exactly `https://<new domain>/`.
7. Auth › Providers: Email on. Anonymous sign-ins, phone and every social provider off. Manual linking off.
8. Auth › Email templates, Magic Link: show the code `{{ .Token }}` and no link. Code expiry about 10 minutes.
9. Custom SMTP: a free Resend account, its SPF and DKIM records in your DNS, its SMTP details under Auth › SMTP.
   Then raise the email rate limit to about 30 an hour.
10. Create your own user under Auth › Users; keep sign-ups closed or invite-only.
11. In the SQL editor, run `supabase/migrations/0001_accounts.sql`, then `supabase/tests/rls.sql`. Every line of the
    result must say ok.
12. Send the coordinator only two values from Settings › API Keys: the Project URL `https://<ref>.supabase.co` and
    the publishable key `sb_publishable_…`. Never the `sb_secret_…` key, the database password or the SMTP password.

**C. Later.** Stage 3: the Supabase CLI to deploy `delete-account`, its secret set in the dashboard. Stage 5: the
Apple Developer Program, an App ID with associated domains.

**Costs.** Stage 0: nothing. Stages 1 and 2: the domain. Supabase Free, Resend Free and Cloudflare Free cost nothing;
Supabase Pro ($25 a month) only stops the pause after 7 idle days.

## Turning accounts on (stage 2, for the coordinator)

```js
// src/core/config.js
accounts: { provider: 'supabase', url: 'https://<ref>.supabase.co', publishableKey: 'sb_publishable_…',
  origins: ['https://<new domain>'] },
```
The guard keeps accounts off on `pakrasi.github.io` even with this config. Turning them off again is
`provider: 'local'` and a deploy.
