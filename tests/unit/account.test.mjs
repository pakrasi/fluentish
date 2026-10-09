// Accounts, stage 0 (docs/ACCOUNTS.md, round 8 lane ACC0). Nothing here may change anything for anyone until the
// owner configures a provider on his own origin:
//   - LocalOnly is the default: no fetch, ever (a fetch that fails the test), no store read or write, no UI;
//   - the config guard refuses github.io, origins not on the list, bad URLs, legacy (JWT) and secret keys;
//   - the fake provider runs on localhost only;
//   - the session is device-only: never exported, never in a snapshot or the backup, never in the log, and
//     getSession() never hands out a token;
//   - the Supabase client, on recorded request/response shapes (tests/fixtures/account/supabase.json) and a fake
//     fetch: code, verify, refresh under the one-tab lock, the 401 retry, refused and offline refreshes, offline logout.
// All data here is synthetic; no token is real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, DEVICE_SCOPE } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { NOT_EXPORTED, exportBundle, importFile } from '../../src/data/transfer.js';
import { snapshotOf, SNAPSHOT_KV } from '../../src/data/sync/backup.js';
import { config } from '../../src/core/config.js';
import { scrub } from '../../src/core/log.js';
import { resolveAccountsConfig, configProblem, connectHost, NO_ACCOUNTS } from '../../src/data/account/config.js';
import { openAccount, createAccount, accountsStatus } from '../../src/data/account/index.js';
import { ACCOUNT_DEVICE_KV, SESSION_KV, memorySessionStore, kvSessionStore } from '../../src/data/account/session-store.js';
import { localProvider } from '../../src/data/account/providers/local.js';
import { fakeProvider, FAKE_CODE } from '../../src/data/account/providers/fake.js';
import { supabaseProvider } from '../../src/data/account/providers/supabase.js';
import { withConnectSrc } from '../../tools/stamp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FX = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/account/supabase.json'), 'utf8'));
const PID = '0192a3b4-c5d6-7e8f-9a0b-00000000acc0';
const DAY = '2026-10-20';
const URL_OK = FX.project.url;
const KEY_OK = FX.project.publishableKey;
const ORIGIN = 'https://fluentish.example.com';
const GOOD = { provider: 'supabase', url: URL_OK, publishableKey: KEY_OK, origins: [ORIGIN] };
/** A page's location. @param {string} href */
const at = href => { const u = new URL(href); return { origin: u.origin, hostname: u.hostname, search: u.search }; };
// a JWT-shaped string, built here so no file in the repo holds one (tools/check-privacy.mjs rule 'jwt')
const b64 = (/** @type {any} */ o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', iss: 'supabase', ref: 'abcdefghijklmnopqrst' })}.c2lnbmF0dXJlLW5vdC1yZWFs`;
const SECRET_KEY = ['sb', 'secret', 'fixtureNotRealAtAll0123456789'].join('_');

/** A fetch that fails the test on any call. */
function forbiddenFetch() {
  const calls = [];
  const f = async (/** @type {any} */ url) => { calls.push(String(url)); throw new Error(`fetch called: ${url}`); };
  return { f, calls };
}

async function newStore() {
  const adapter = createMemoryAdapter();
  /** @type {string[]} */ const writes = [];
  const put = adapter.putKV.bind(adapter);
  adapter.putKV = (/** @type {string} */ scope, /** @type {string} */ name, /** @type {any} */ v) => { writes.push(`${scope}/${name}`); return put(scope, name, v); };
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'devacc01', seq: 0 }, clock: { today: () => DAY } });
  return { store, writes };
}

/* ---------- LocalOnly ---------- */

test('LocalOnly is the default: the committed config is off, and it resolves to local everywhere', () => {
  assert.deepEqual({ ...config.accounts }, { ...NO_ACCOUNTS });
  for (const href of ['https://pakrasi.github.io/fluentish/', 'http://127.0.0.1:8471/fluentish/', 'https://fluentish.example.com/', 'capacitor://localhost/']) {
    const r = resolveAccountsConfig(config.accounts, at(href));
    assert.equal(r.provider, 'local', href);
    assert.equal(r.reason, 'notConfigured', href);
  }
  assert.equal(accountsStatus({ location: undefined }).provider, 'local');
});

test('LocalOnly never calls fetch and never touches the store: every call, with a fetch that fails the test', async () => {
  const { f, calls } = forbiddenFetch();
  const saved = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (f);
  try {
    const { store, writes } = await newStore();
    const gets = [];
    const get = store.get.bind(store);
    store.get = (/** @type {string} */ n, /** @type {any} */ fb) => { gets.push(n); return get(n, fb); };
    await store.flush();
    writes.length = 0;
    for (const loc of [at('https://pakrasi.github.io/fluentish/'), at('http://localhost:8430/'), null]) {
      const acc = await openAccount({ store: { ...store, subscribe: store.subscribe.bind(store), get: store.get, set: store.set.bind(store) }, location: loc });
      assert.equal(acc.available(), false);
      assert.equal(acc.provider(), 'local');
      assert.equal(acc.state(), 'off');
      assert.equal(acc.getSession(), null);
      let changed = 0;
      acc.onChange(() => { changed++; });
      assert.deepEqual(await acc.signIn({ email: 'learner@example.com' }), { error: 'off' });
      assert.deepEqual(await acc.verify({ email: 'learner@example.com', code: '123456' }), { error: 'off' });
      acc.restart();
      await acc.signOut();
      await acc.signOut({ everywhere: true });
      await assert.rejects(acc.authFetch('/rest/v1/files'), (/** @type {any} */ e) => e.code === 'off');
      assert.deepEqual(await acc.deleteAccount(), { ok: false, error: 'off' });
      assert.equal(changed, 0);
      assert.equal(acc.state(), 'off');
    }
    // the provider itself, called directly
    const p = localProvider();
    assert.equal(p.network, false);
    assert.deepEqual(await p.requestCode({ email: 'a@b.cd' }), { error: 'off' });
    assert.deepEqual(await p.verifyCode({ email: 'a@b.cd', code: '123456' }), { error: 'off' });
    assert.deepEqual(await p.refresh('x'), { error: 'off' });
    await p.logout('x', 'global');
    await assert.rejects(p.fetchAuthed('/x', {}, 'x'));
    await store.flush();
    assert.deepEqual(calls, [], 'no fetch');
    assert.deepEqual(writes, [], 'no store write');
    assert.deepEqual(gets.filter(n => ACCOUNT_DEVICE_KV.includes(/** @type {any} */ (n))), [], 'no account kv read');
  } finally { globalThis.fetch = saved; }
});

test('LocalOnly\'s source holds no network API at all', () => {
  const src = readFileSync(path.join(ROOT, 'src/data/account/providers/local.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(/);
  // and index.js reaches fetch only inside the supabase branch
  const idx = readFileSync(path.join(ROOT, 'src/data/account/index.js'), 'utf8');
  assert.equal((idx.match(/globalThis\.fetch/g) || []).length, 1);
  assert.match(idx, /resolved\.provider === 'supabase'\) \{\s*p = \(await import\('\.\/providers\/supabase\.js'\)\)/);
});

/* ---------- the config guard ---------- */

test('the guard: github.io is refused, as a page and as a listed origin, even with a valid project', () => {
  assert.deepEqual(resolveAccountsConfig(GOOD, at(`${ORIGIN}/`)).provider, 'supabase');
  assert.equal(resolveAccountsConfig({ ...GOOD, origins: [ORIGIN, 'https://pakrasi.github.io'] }, at('https://pakrasi.github.io/fluentish/')).reason, 'badOrigins');
  assert.equal(resolveAccountsConfig(GOOD, at('https://pakrasi.github.io/fluentish/')).reason, 'sharedOrigin');
  assert.equal(resolveAccountsConfig(GOOD, at('https://someone.github.io/')).reason, 'sharedOrigin');
  assert.equal(resolveAccountsConfig({ ...GOOD, origins: ['https://x.GitHub.io'] }, at('https://x.github.io/')).reason, 'badOrigins');
});

test('the guard: only an exact allowed https origin turns accounts on', () => {
  assert.equal(resolveAccountsConfig(GOOD, at('https://other.example.com/')).reason, 'originNotAllowed');
  assert.equal(resolveAccountsConfig(GOOD, at('https://fluentish.example.com:8443/')).reason, 'originNotAllowed');
  assert.equal(resolveAccountsConfig(GOOD, at('http://fluentish.example.com/')).reason, 'originNotAllowed');
  assert.equal(resolveAccountsConfig(GOOD, at('http://localhost:8430/')).reason, 'originNotAllowed');
  for (const origins of [[], ['http://fluentish.example.com'], ['https://fluentish.example.com/'], ['https://fluentish.example.com/app'], ['*'], [42]]) {
    assert.equal(configProblem({ ...GOOD, origins: /** @type {any} */ (origins) }), 'badOrigins', JSON.stringify(origins));
  }
});

test('the guard: bad project URLs, legacy and secret keys, unknown providers', () => {
  for (const url of ['http://abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co/', 'https://abcdefghijklmnopqrs.supabase.co',
    'https://ABCDEFGHIJKLMNOPQRST.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co.evil.example', 'https://abcdefghijklmnopqrst.supabase.co:443',
    'https://evil.example/abcdefghijklmnopqrst.supabase.co', '', null]) {
    assert.equal(configProblem({ ...GOOD, url: /** @type {any} */ (url) }), 'badUrl', String(url));
  }
  assert.equal(configProblem({ ...GOOD, publishableKey: JWT }), 'legacyKey');
  assert.equal(configProblem({ ...GOOD, publishableKey: SECRET_KEY }), 'secretKey');
  for (const k of ['', null, 'sb_publishable_', 'anon', 'sb_publishable_ has spaces']) assert.equal(configProblem({ ...GOOD, publishableKey: /** @type {any} */ (k) }), 'badKey', String(k));
  assert.equal(configProblem({ ...GOOD, provider: 'firebase' }), 'unknownProvider');
  assert.equal(configProblem(null), 'notConfigured');
  assert.equal(configProblem(NO_ACCOUNTS), 'notConfigured');
  // a refusal is LocalOnly: no URL or key is handed on
  const r = resolveAccountsConfig({ ...GOOD, publishableKey: SECRET_KEY }, at(`${ORIGIN}/`));
  assert.deepEqual(r, { provider: 'local', reason: 'secretKey', url: null, publishableKey: null });
});

test('the fake provider: localhost with ?accounts=fake only', () => {
  for (const href of ['http://localhost:8726/?accounts=fake', 'http://127.0.0.1:8471/fluentish/?accounts=fake#/profile', 'http://[::1]:8726/?accounts=fake']) {
    assert.equal(resolveAccountsConfig(NO_ACCOUNTS, at(href)).provider, 'fake', href);
  }
  for (const href of ['https://pakrasi.github.io/fluentish/?accounts=fake', `${ORIGIN}/?accounts=fake`, 'http://localhost.example.com/?accounts=fake',
    'http://127.0.0.2/?accounts=fake', 'http://localhost:8726/?accounts=fakes', 'http://localhost:8726/#/profile?accounts=fake']) {
    assert.notEqual(resolveAccountsConfig(GOOD, at(href)).provider, 'fake', href);
  }
});

test('connect-src: the project host only for a config that could turn accounts on; tools/stamp.mjs writes it', () => {
  assert.equal(connectHost(NO_ACCOUNTS), null);
  assert.equal(connectHost(config.accounts), null);
  assert.equal(connectHost({ ...GOOD, publishableKey: JWT }), null);
  assert.equal(connectHost({ ...GOOD, origins: ['https://pakrasi.github.io'] }), null);
  assert.equal(connectHost(GOOD), URL_OK);
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(withConnectSrc(html, NO_ACCOUNTS), html, 'unchanged when off');
  assert.equal(withConnectSrc(html, config.accounts), html, 'unchanged with the committed config');
  const on = withConnectSrc(html, GOOD);
  const csp = /** @type {string} */ (/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(on)?.[1]);
  const connect = csp.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src')) || '';
  assert.deepEqual(connect.split(/\s+/).slice(-1), [URL_OK]);
  assert.equal(on.replace(` ${URL_OK}`, ''), html, 'nothing else changes');
  assert.doesNotMatch(csp, /wss:|supabase\.co[^;]*;[^;]*supabase/, 'no realtime, one directive');
});

/* ---------- the session stays on the device ---------- */

test('the account kv are device-only: in DEVICE_SCOPE and NOT_EXPORTED, never in the snapshot allow-list', () => {
  for (const k of ACCOUNT_DEVICE_KV) {
    assert.ok(DEVICE_SCOPE.has(k), `${k} device scope`);
    assert.ok(NOT_EXPORTED.has(k), `${k} not exported`);
    assert.ok(!(k in SNAPSHOT_KV), `${k} not in a snapshot`);
  }
});

test('a signed-in fake session: export, snapshot and import never carry it; getSession and onChange give no token', async () => {
  const { store } = await newStore();
  store.putCards('b1', [['W:Haus.n', { S: 3, D: 5, due: '2026-10-25', reps: 1, lapses: 0, last: DAY, first: DAY, stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [] }]]);
  const acc = await openAccount({ store, location: at('http://localhost:8726/?accounts=fake'), locks: null });
  assert.equal(acc.available(), true);
  assert.equal(acc.state(), 'signedOut');
  /** @type {any[]} */ const seen = [];
  acc.onChange((s, session) => seen.push([s, session]));
  assert.deepEqual(await acc.signIn({ email: 'not an email' }), { error: 'badEmail' });
  assert.deepEqual(await acc.signIn({ email: ' learner@example.com ' }), { step: 'code' });
  assert.equal(acc.state(), 'codeSent');
  assert.equal(acc.pendingEmail(), 'learner@example.com');
  assert.deepEqual(await acc.verify({ code: '000000' }), { error: 'badCode' });
  assert.deepEqual(await acc.verify({ code: 'abc' }), { error: 'badCode' });
  const ok = await acc.verify({ code: ` ${FAKE_CODE.slice(0, 3)} ${FAKE_CODE.slice(3)} ` });
  assert.ok('session' in ok);
  assert.equal(acc.state(), 'signedIn');
  const stored = store.get(SESSION_KV);
  assert.match(stored.accessToken, /^fake-access-/);
  assert.match(stored.refreshToken, /^fake-refresh-/);
  // what features see
  assert.deepEqual(Object.keys(/** @type {any} */ (acc.getSession())).sort(), ['email', 'expiresAt', 'userId']);
  assert.equal(acc.getSession()?.email, 'learner@example.com');
  for (const s of [JSON.stringify(acc.getSession()), JSON.stringify(ok), JSON.stringify(seen)]) {
    assert.ok(!s.includes(stored.accessToken) && !s.includes(stored.refreshToken), s);
  }
  // what leaves the device
  await store.flush();
  const bundle = JSON.stringify(exportBundle(store, { profile: { id: PID, name: '' }, includeScripts: true, includeReads: true }));
  const snap = JSON.stringify(snapshotOf(store, { now: Date.parse(`${DAY}T10:00:00Z`) }));
  for (const [what, text] of [['export', bundle], ['snapshot', snap]]) {
    assert.ok(!text.includes('fake-access-') && !text.includes('fake-refresh-'), `${what} has no token`);
    assert.ok(!text.includes(SESSION_KV), `${what} has no session kv`);
  }
  // an imported file can never plant a session
  const { store: other } = await newStore();
  const planted = { ...JSON.parse(bundle), kv: { ...JSON.parse(bundle).kv, [SESSION_KV]: stored, 'account.claim': { id: 'x' }, 'backup.account': { on: true } } };
  await importFile(JSON.stringify(planted), { store: other, hlc: { now: () => '0' } });
  for (const k of ACCOUNT_DEVICE_KV) assert.equal(other.get(k, null), null, `import skips ${k}`);
  // sign out: local first, the kv emptied
  await acc.signOut();
  assert.equal(acc.state(), 'signedOut');
  assert.equal(acc.getSession(), null);
  assert.equal(store.get(SESSION_KV), null);
});

test('the log scrubs session tokens: JWTs, sb_secret_ keys and token fields', () => {
  for (const msg of [`verify failed: ${JWT}`, `key ${SECRET_KEY} rejected`, '{"access_token":"fixture-access-token-1","refresh_token":"fixture-refresh-token-1"}',
    'refresh_token=fixture-refresh-token-1 bad', '{"accessToken":"fake-access-9","refreshToken":"fake-refresh-9"}', 'Authorization: Bearer fixture-access-token-1']) {
    const out = scrub(msg);
    for (const bad of [JWT, SECRET_KEY, 'fixture-access-token-1', 'fixture-refresh-token-1', 'fake-access-9', 'fake-refresh-9']) assert.ok(!out.includes(bad), `${out} still holds ${bad}`);
  }
  assert.equal(scrub('accounts are off'), 'accounts are off');
});

test('check-privacy blocks a Supabase secret key and a JWT, and passes a publishable key', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acc-privacy-'));
  try {
    const run = () => { try { execFileSync('node', [path.join(ROOT, 'tools/check-privacy.mjs'), '--dir', dir], { stdio: 'pipe' }); return ''; } catch (e) { return String(/** @type {any} */ (e).stderr); } };
    writeFileSync(path.join(dir, 'config.js'), `export const k = '${KEY_OK}';\n`);
    assert.equal(run(), '');
    writeFileSync(path.join(dir, 'config.js'), `export const k = '${SECRET_KEY}';\n`);
    assert.match(run(), /supabase-secret/);
    writeFileSync(path.join(dir, 'config.js'), `export const k = '${JWT}';\n`);
    assert.match(run(), /\[jwt\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- the Supabase client on recorded shapes ---------- */

/**
 * A fake fetch answering from a queue of [status, body] per path, recording every request.
 * @param {Record<string, ([number, any] | 'offline')[]>} answers
 */
function recordedFetch(answers) {
  /** @type {{url: string, method: string, headers: Record<string, string>, body: any}[]} */ const calls = [];
  const f = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const u = new URL(url);
    const key = u.pathname + u.search;
    const h = init.headers instanceof Headers ? Object.fromEntries(init.headers) : Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, method: init.method || 'GET', headers: h, body: init.body ? JSON.parse(init.body) : null });
    const q = answers[key] || answers[u.pathname];
    const next = q && q.length ? q.shift() : [404, { msg: 'not mocked' }];
    if (next === 'offline') throw new TypeError('Load failed');
    const [status, body] = next;
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

const NOW = 1_800_000_000_000 - 30 * 60e3;   // half an hour before the fixture's first expiry
/** @param {ReturnType<typeof recordedFetch>} rf @param {any} [o] */
function supa(rf, o = {}) {
  const sessions = o.sessions || memorySessionStore();
  const provider = supabaseProvider({ url: URL_OK, publishableKey: KEY_OK, fetch: /** @type {any} */ (rf.f), now: () => o.now?.() ?? NOW });
  const acc = createAccount({ provider, resolved: { provider: 'supabase', reason: 'none', url: URL_OK, publishableKey: KEY_OK }, sessions, locks: o.locks ?? null, now: () => o.now?.() ?? NOW });
  return { acc, sessions };
}

test('supabase: the code request and verify send the recorded shapes; the key goes in apikey only', async () => {
  const rf = recordedFetch({ '/auth/v1/otp': [[FX.otp.ok.status, FX.otp.ok.body]], '/auth/v1/verify': [[FX.verify.expired.status, FX.verify.expired.body], [200, FX.verify.ok.body]] });
  const { acc, sessions } = supa(rf);
  assert.deepEqual(await acc.signIn({ email: 'learner@example.com' }), { step: 'code' });
  const [otp] = rf.calls;
  assert.equal(otp.url, `${URL_OK}${FX.otp.request.path}`);
  assert.equal(otp.method, 'POST');
  assert.deepEqual(otp.body, FX.otp.request.body);
  assert.equal(otp.headers.apikey, KEY_OK);
  assert.equal(otp.headers.authorization, undefined, 'the publishable key is not a bearer token');
  assert.deepEqual(await acc.verify({ code: '123456' }), { error: 'badCode' });
  const r = await acc.verify({ code: '123456' });
  assert.deepEqual(rf.calls[2].body, FX.verify.request.body);
  assert.deepEqual(r, { session: { userId: FX.verify.ok.body.user.id, email: 'learner@example.com', expiresAt: FX.verify.ok.body.expires_at * 1000 } });
  assert.deepEqual(sessions.read(), { accessToken: 'fixture-access-token-1', refreshToken: 'fixture-refresh-token-1', expiresAt: 1_800_000_000_000, userId: FX.verify.ok.body.user.id, email: 'learner@example.com' });
});

test('supabase: errors are plain codes; no answer and a 5xx are offline, never signed out', async () => {
  const rf = recordedFetch({ '/auth/v1/otp': [[422, FX.otp.noAccount.body], [429, FX.otp.rateLimited.body], 'offline', [503, {}], [400, {}]] });
  const { acc } = supa(rf);
  for (const want of ['noAccount', 'rateLimited', 'offline', 'offline', 'badEmail']) assert.deepEqual(await acc.signIn({ email: 'learner@example.com' }), { error: want });
  assert.equal(acc.state(), 'signedOut');
});

/** A signed-in account whose access token runs out at `exp`. */
function signedIn(rf, { exp = NOW + 3600e3, locks = null, now = undefined } = {}) {
  const sessions = memorySessionStore();
  sessions.write({ accessToken: 'fixture-access-token-1', refreshToken: 'fixture-refresh-token-1', expiresAt: exp, userId: FX.verify.ok.body.user.id, email: 'learner@example.com' });
  return supa(rf, { sessions, locks, now });
}

test('supabase: authFetch sends the user token, retries once after a 401 with a refreshed pair', async () => {
  const rf = recordedFetch({ '/rest/v1/files': [[401, { message: 'JWT expired' }], [200, []]], '/auth/v1/token?grant_type=refresh_token': [[200, FX.refresh.ok.body]] });
  const { acc, sessions } = signedIn(rf);
  const res = await acc.authFetch('/rest/v1/files', { method: 'GET' });
  assert.equal(res.status, 200);
  assert.deepEqual(rf.calls.map(c => [c.url.replace(URL_OK, ''), c.headers.authorization || null]), [
    ['/rest/v1/files', 'Bearer fixture-access-token-1'],
    ['/auth/v1/token?grant_type=refresh_token', null],
    ['/rest/v1/files', 'Bearer fixture-access-token-2'],
  ]);
  assert.deepEqual(rf.calls[1].body, FX.refresh.request.body);
  assert.equal(sessions.read()?.refreshToken, 'fixture-refresh-token-2');
  // a second 401 is handed back, not retried again
  const rf2 = recordedFetch({ '/rest/v1/files': [[401, {}], [401, {}]], '/auth/v1/token?grant_type=refresh_token': [[200, FX.refresh.ok.body]] });
  assert.equal((await signedIn(rf2).acc.authFetch('/rest/v1/files')).status, 401);
  assert.equal(rf2.calls.length, 3);
});

test('supabase: a token about to run out is refreshed first, once for many calls, under the cross-tab lock', async () => {
  const rf = recordedFetch({ '/rest/v1/files': [[200, []], [200, []], [200, []]], '/auth/v1/token?grant_type=refresh_token': [[200, FX.refresh.ok.body]] });
  /** @type {string[]} */ const locked = [];
  const locks = { request: async (/** @type {string} */ name, /** @type {() => Promise<any>} */ fn) => { locked.push(name); return fn(); } };
  const { acc } = signedIn(rf, { exp: NOW + 30e3, locks });
  await Promise.all([acc.authFetch('/rest/v1/files'), acc.authFetch('/rest/v1/files'), acc.authFetch('/rest/v1/files')]);
  assert.equal(rf.calls.filter(c => c.url.includes('/auth/v1/token')).length, 1, 'one refresh');
  assert.deepEqual(locked, ['account-refresh']);
  assert.ok(rf.calls.filter(c => c.url.endsWith('/rest/v1/files')).every(c => c.headers.authorization === 'Bearer fixture-access-token-2'));
});

test('supabase: a tab that waited for the lock takes the pair another tab stored, without spending the refresh token', async () => {
  const rf = recordedFetch({ '/rest/v1/files': [[200, []]] });
  const sessions = memorySessionStore();
  sessions.write({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: NOW + 10e3, userId: 'u1', email: 'learner@example.com' });
  // the other tab refreshes while this one waits
  const locks = { request: async (/** @type {string} */ _n, /** @type {() => Promise<any>} */ fn) => { sessions.write({ accessToken: 'tab2-access', refreshToken: 'tab2-refresh', expiresAt: NOW + 3600e3, userId: 'u1', email: 'learner@example.com' }); return fn(); } };
  const { acc } = supa(rf, { sessions, locks });
  await acc.authFetch('/rest/v1/files');
  assert.deepEqual(rf.calls.map(c => [c.url.replace(URL_OK, ''), c.headers.authorization]), [['/rest/v1/files', 'Bearer tab2-access']]);
});

test('supabase: a refused refresh signs out; an unanswered one keeps the session and shows offline', async () => {
  const rf = recordedFetch({ '/auth/v1/token?grant_type=refresh_token': [[400, FX.refresh.used.body]] });
  const { acc, sessions } = signedIn(rf, { exp: NOW });
  await assert.rejects(acc.authFetch('/rest/v1/files'), (/** @type {any} */ e) => e.code === 'signedOut' && e.auth === true);
  assert.equal(acc.state(), 'signedOut');
  assert.equal(sessions.read(), null);

  const rf2 = recordedFetch({ '/auth/v1/token?grant_type=refresh_token': ['offline', [503, {}], [200, FX.refresh.ok.body]], '/rest/v1/files': [[200, []]] });
  const b = signedIn(rf2, { exp: NOW });
  await assert.rejects(b.acc.authFetch('/rest/v1/files'), (/** @type {any} */ e) => e.code === 'offline' && e.offline === true);
  assert.equal(b.acc.state(), 'offline');
  assert.equal(b.sessions.read()?.refreshToken, 'fixture-refresh-token-1', 'kept');
  await assert.rejects(b.acc.authFetch('/rest/v1/files'), (/** @type {any} */ e) => e.code === 'offline');
  assert.equal(b.sessions.read()?.refreshToken, 'fixture-refresh-token-1', 'kept after a 5xx');
  assert.equal((await b.acc.authFetch('/rest/v1/files')).status, 200);
  assert.equal(b.acc.state(), 'signedIn');
});

test('supabase: sign out is local first and works offline; everywhere asks for the global scope', async () => {
  const rf = recordedFetch({ '/auth/v1/logout': ['offline'] });
  const { acc, sessions } = signedIn(rf);
  await acc.signOut();
  assert.equal(acc.state(), 'signedOut');
  assert.equal(sessions.read(), null);
  assert.equal(rf.calls[0].url, `${URL_OK}${FX.logout.request.path}`);
  assert.equal(rf.calls[0].headers.authorization, 'Bearer fixture-access-token-1');
  const rf2 = recordedFetch({ '/auth/v1/logout': [[204, null]] });
  await signedIn(rf2).acc.signOut({ everywhere: true });
  assert.equal(rf2.calls[0].url, `${URL_OK}/auth/v1/logout?scope=global`);
});

test('openAccount loads the Supabase client only for a resolved project, and once per store', async () => {
  const rf = recordedFetch({ '/auth/v1/otp': [[200, {}]] });
  const { store } = await newStore();
  const acc = await openAccount({ store, accounts: GOOD, location: at(`${ORIGIN}/#/profile`), fetch: /** @type {any} */ (rf.f), locks: null });
  assert.equal(acc.provider(), 'supabase');
  assert.equal(await openAccount({ store }), acc, 'the same account for the same store');
  assert.deepEqual(await acc.signIn({ email: 'learner@example.com' }), { step: 'code' });
  assert.equal(rf.calls.length, 1);
  // the same config on github.io: LocalOnly, and the fake fetch is never called
  const { store: s2 } = await newStore();
  const off = await openAccount({ store: s2, accounts: GOOD, location: at('https://pakrasi.github.io/fluentish/'), fetch: /** @type {any} */ (forbiddenFetch().f) });
  assert.equal(off.provider(), 'local');
  assert.equal(off.reason(), 'sharedOrigin');
  assert.deepEqual(await off.signIn({ email: 'learner@example.com' }), { error: 'off' });
});

test('another tab signing out or in reaches this tab through the store kv', async () => {
  const { store } = await newStore();
  const acc = await openAccount({ store, location: at('http://localhost:8726/?accounts=fake'), locks: null });
  const sessions = kvSessionStore(store);
  sessions.write({ accessToken: 'fake-access-7', refreshToken: 'fake-refresh-7', expiresAt: Date.now() + 3600e3, userId: 'u7', email: 'other@example.com' });
  assert.equal(acc.state(), 'signedIn');
  sessions.write(null);
  assert.equal(acc.state(), 'signedOut');
  const fp = fakeProvider();
  assert.equal(fp.network, false);
});

/* ---------- backup.js takes its state kv and pending selector (stage 2's account target) ---------- */

test('backupProgress with a second target: its own state kv and selector; the results repository state and event.synced untouched', async () => {
  const { backupProgress, pendingEvents } = await import('../../src/data/sync/backup.js');
  const { store } = await newStore();
  store.putCards('b1', [['W:Haus.n', { S: 3, D: 5, due: '2026-10-25', reps: 1, lapses: 0, last: DAY, first: DAY, stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [] }]]);
  store.append('card.reviewed', { deck: 'b1', itemId: 'W:Haus.n', g: 3, ms: 900, flags: [], mode: 'typed', ctx: { exam: null, phase: 'none', tz: 'Europe/Berlin' }, base: { u: 0, reps: 0 }, post: null }, { day: DAY });
  // a signed-in session on this device: it must not reach any uploaded file
  kvSessionStore(store).write({ accessToken: 'fake-access-42', refreshToken: 'fake-refresh-42', expiresAt: Date.now() + 3600e3, userId: 'u42', email: 'learner@example.com' });
  /** @type {Map<string, string>} */ const disk = new Map();
  let n = 0;
  const files = {
    read: async (/** @type {string} */ p) => (disk.has(p) ? { sha: `s${p}`, bytes: new TextEncoder().encode(/** @type {string} */ (disk.get(p))) } : null),
    write: async (/** @type {string} */ p, /** @type {any} */ body) => { disk.set(p, typeof body === 'string' ? body : Buffer.from(body).toString('latin1')); return `sha${++n}`; },
    list: async () => [],
  };
  /** @type {string[]} */ const sent = [];
  const before = pendingEvents(store).length;
  assert.equal(before, 1);
  const r = await backupProgress(store, /** @type {any} */ (files), { force: true, stateKv: 'backup.account', pending: s => s.pending(), markSent: (_s, evs) => { sent.push(...evs.map(e => e.id)); } });
  assert.equal(r.error, null);
  assert.equal(r.ok, 1);
  assert.equal(sent.length, 1);
  assert.equal(pendingEvents(store).length, 1, 'event.synced untouched: the results repository still sends it');
  assert.equal(store.get('backup', null), null, 'the results repository state untouched');
  assert.ok(store.get('backup.account')?.at, 'the target state in its own kv');
  const zlib = await import('node:zlib');
  for (const [p, body] of disk) {
    const text = p.endsWith('.gz') ? zlib.gunzipSync(Buffer.from(body, 'latin1')).toString('utf8') : body;
    assert.ok(!/fake-(access|refresh)-42|account\.session|backup\.account/.test(text), `${p} carries no account data`);
  }
});
