// Safe to share (docs/SHARING.md): no repository or study hours file is a default any more; the owner's devices keep
// theirs through a one-time additive migration (src/data/connection.js); a profile without a repository sends and reads
// nothing; the GitHub token is checked for its scope and expiry (src/data/sync/token-check.js); a device link can
// carry a repository and an expiry (src/core/link.js). All tokens and data here are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { createHlc } from '../../src/data/ids.js';
import { normalizeSettings } from '../../src/data/settings.js';
import { config } from '../../src/core/config.js';
import * as Cn from '../../src/data/connection.js';
import { checkToken, recheck, lastCheck, tokenKind, fingerprint } from '../../src/data/sync/token-check.js';
import { results, sync as seamSync, backup, restore, backupFiles } from '../../src/data/sync/index.js';
import { syncResults, resetThrottle } from '../../src/data/sync/github-b1exam.js';
import { exportBundle } from '../../src/data/transfer.js';
import { splitLinkHash, takeLink, LINK_MAX_S } from '../../src/core/link.js';
import { hoursSource } from '../../src/features/today/progress/hours.js';
import { mockGithubFor } from './sync-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000c1';
const TOKEN = 'github_pat_synthetic_not_real_0123456789';
const AT = new Date(Date.UTC(2026, 9, 3, 18, 4, 5));
const DAY = '2026-10-04';

async function fresh({ deviceId = 'dev1', kind = 'local' } = {}) {
  const adapter = createMemoryAdapter();
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind }, device: { deviceId, seq: 0 }, clock: { today: () => DAY } });
  return { store, app: { store, hlc: createHlc(deviceId, () => AT.getTime()) } };
}

/**
 * The owner's device as it is before this change (the shape of every collection the migration looks at): a token,
 * what the last sync read and wrote, the backup's state, settings from before connections, and the import record.
 */
async function ownerDevice(over = {}) {
  const f = await fresh();
  const { store } = f;
  store.set('secrets', { anthropicKey: null, githubToken: TOKEN });
  store.set('meta', { migratedAt: '2026-10-04T10:12:00.000+02:00', summary: { cards: 3, attempts: 1, keys: ['github'] } });
  store.set('ui', { importSeen: true });
  store.set('settings', { v: 1, language: 'german', level: 'B1', exam: { type: 'goethe-b1', date: '2026-10-30', modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] }, minutesPerDay: 60, rev: { language: '0001790000000001-0000-dev1' }, ...over });
  store.set('exams.remote', { feedback: [], results: [], cursor: { feedback: 'W/"etag-1"' }, fetchedAt: '2026-10-05T08:00:00.000Z' });
  store.set('exams.syncStatus', { at: '2026-10-05T08:00:00.000Z', ok: 2, fail: 0, error: null, pending: 0 });
  store.set('backup', { at: '2026-10-05T08:00:00.000Z', snapshot: { day: '2026-10-05', at: '2026-10-05T08:00:00.000Z', cards: 3 } });
  await store.flush();
  return f;
}

/* ---------- no owner defaults ---------- */

test('config names no repository and no study hours file; only data/connection.js names the owner\'s', () => {
  assert.equal(/** @type {any} */ (config).resultsRepo, undefined);
  assert.equal(/** @type {any} */ (config).hoursDefault, undefined);
  const hits = [];
  const walk = (/** @type {string} */ d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'vendor') walk(p); continue; }
      if (!/\.js$/.test(n)) continue;
      const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/['"`]pakrasi\/|language-stack|b1-exam['"`]/.test(src)) hits.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(hits, ['src/data/connection.js']);
});

test('a new profile has no repository and no study hours file', async () => {
  const { store } = await fresh();
  assert.equal(Cn.resultsRepo(store), null);
  assert.equal(Cn.connectionState(store), 'none');
  assert.equal(hoursSource(normalizeSettings(store.get('settings'))), null);
  assert.equal(backup(store).repo, null);
  assert.equal(backup(store).linked(), false);
});

/* ---------- the owner migration ---------- */

test('owner migration: a device with his current state gets his repository and hours file, once', async () => {
  const { store, app } = await ownerDevice();
  const before = JSON.stringify(store.get('settings'));
  const r = Cn.migrateConnections(app);
  assert.equal(r.ran, true); assert.equal(r.signal, 'token');
  const s = normalizeSettings(store.get('settings'));
  assert.equal(s.connections.results, 'pakrasi/b1-exam');
  assert.deepEqual(s.connections.hours, { repo: 'pakrasi/language-stack', path: 'data/toggl.json', lang: 'german' });
  assert.equal(Cn.resultsRepo(store), 'pakrasi/b1-exam');
  assert.equal(Cn.connectionState(store), 'connected');
  assert.deepEqual(hoursSource(s), { repo: 'pakrasi/language-stack', path: 'data/toggl.json', lang: 'german' }, 'All tracked keeps its source');
  // additive: every other field and stamp is as it was
  const prev = JSON.parse(before), now = store.get('settings');
  for (const k of Object.keys(prev)) if (k !== 'rev') assert.deepEqual(now[k], prev[k], k);
  for (const [k, v] of Object.entries(prev.rev)) assert.equal(now.rev[k], v, `rev ${k}`);
  // the import record is kept and the upload consent with it
  const meta = store.get('meta');
  assert.equal(meta.migratedAt, '2026-10-04T10:12:00.000+02:00');
  assert.equal(meta.summary.cards, 3);
  assert.equal(meta.connections.owner, true);

  // idempotent: a second run (the next start) changes nothing, byte for byte
  const settingsAfter = JSON.stringify(store.get('settings')), metaAfter = JSON.stringify(store.get('meta'));
  const n = store.pending().length;
  assert.equal(Cn.migrateConnections(app).ran, false);
  assert.equal(JSON.stringify(store.get('settings')), settingsAfter);
  assert.equal(JSON.stringify(store.get('meta')), metaAfter);
  assert.equal(store.pending().length, n, 'no new event');
});

test('owner migration: each sync trace alone is enough; a value he chose is never overwritten', async () => {
  for (const drop of ['secrets', 'exams.remote', 'exams.syncStatus']) {
    const { store, app } = await ownerDevice();
    store.set('secrets', { anthropicKey: null, githubToken: null });
    for (const k of ['exams.remote', 'exams.syncStatus', 'backup']) if (k !== drop && drop !== 'secrets') store.set(k, null);
    const r = Cn.migrateConnections(app);
    assert.ok(r.signal, `signal without the token (${drop})`);
    assert.equal(Cn.resultsRepo(store), 'pakrasi/b1-exam');
  }
  // his own hours file stays his; a null (he had picked the old default) becomes the old default's file
  {
    const { store, app } = await ownerDevice({ connections: { hours: { repo: 'someone/other', path: 'h.json', lang: 'de' } } });
    Cn.migrateConnections(app);
    assert.deepEqual(normalizeSettings(store.get('settings')).connections.hours, { repo: 'someone/other', path: 'h.json', lang: 'de' });
  }
  {
    const { store, app } = await ownerDevice({ connections: { hours: null } });
    Cn.migrateConnections(app);
    assert.equal(normalizeSettings(store.get('settings')).connections.hours.repo, 'pakrasi/language-stack');
  }
  // a preview (shadow) profile is never touched
  {
    const { store } = await fresh({ kind: 'shadow' });
    store.set('secrets', { githubToken: TOKEN });
    assert.equal(Cn.migrateConnections({ store, hlc: createHlc('d') }).ran, false);
    assert.equal(Cn.resultsRepo(store), null);
  }
});

test('visitor: no token and no sync state: nothing is set, and a token added later does not make it the owner\'s', async () => {
  const { store, app } = await fresh();
  store.set('settings', { v: 1, language: 'german', level: 'A2', exam: { type: null, date: null, modules: [] }, minutesPerDay: 30, rev: {} });
  // a visitor who took a mock exam: results waiting in the outbox are not sync state
  results(store).record('exam.attempt', { attemptId: 'a', file: { day: 1, module: 'lesen' } }, AT);
  const r = Cn.migrateConnections(app);
  assert.equal(r.ran, true); assert.equal(r.signal, null); assert.deepEqual(r.writes, []);
  assert.equal(Cn.resultsRepo(store), null);
  assert.equal(store.get('meta').connections.owner, false);
  store.set('secrets', { githubToken: TOKEN });
  assert.equal(Cn.migrateConnections(app).ran, false);
  assert.equal(Cn.resultsRepo(store), null, 'the migration ran once for this profile');
  assert.equal(Cn.githubToken(store), null, 'a token without a repository is never used');
});

/* ---------- a profile without a repository sends and reads nothing ---------- */

test('visitor: sync, backup, restore and the merge make no request at all, even with a token on the device', async () => {
  resetThrottle();
  const { store } = await fresh();
  store.set('secrets', { githubToken: TOKEN });
  store.set('ui', { importSeen: true });
  results(store).record('exam.attempt', { attemptId: 'a', file: { day: 1, module: 'lesen' } }, AT);
  /** @type {string[]} */ const calls = [];
  const fetch = async (/** @type {any} */ url) => { calls.push(String(url)); return new Response('{}', { status: 500 }); };
  const out = await seamSync(store, { fetch, force: true, backupNow: true });
  assert.equal(out.skipped, true);
  assert.equal(await restore(store, { fetch }).merge({ force: true }), null);
  await assert.rejects(() => backupFiles(store, { fetch }).list('data/events'));
  assert.deepEqual(calls, []);
  assert.equal(results(store).notSent(), 1, 'the result stays on the device');
});

test('owner: after the migration the sync writes exactly what it wrote before (results byte for byte, backup paths)', async () => {
  /** A device with an exam attempt, a correction and a review waiting. @param {any} store */
  const fill = store => {
    const r = results(store);
    r.record('exam.attempt', { attemptId: 'a1', file: { id: 'a1', day: 3, module: 'lesen', started_at: 's', submitted_at: 'u', duration_s: 60, score: 1, max_score: 2, meta: {}, responses: [], writings: [] } }, AT);
    r.record('feedback.created', { day: 3, module: 'schreiben', attempt_id: 'a1', attempt_file: null, body: '! x', created_at: 'c' }, new Date(AT.getTime() + 1000));
    r.record('vocab.captured', { word: 'Nachbarschaft', day: 3 }, new Date(AT.getTime() + 2000));
    const post = { S: 2, D: 5, due: DAY, reps: 1, lapses: 0, last: DAY, first: DAY, stage: 1, streak: 1, learn: null, relearn: false, u: AT.getTime(), hist: [[DAY, 3, 1200, 't', '']] };
    store.putCards('b1', [['BP:a', post]]);
    store.append('card.reviewed', { deck: 'b1', itemId: 'BP:a', g: 3, ms: 1200, flags: '', mode: 't', ctx: { exam: null, phase: 'none', tz: 'UTC' }, base: { u: null, reps: 0 }, post }, { day: DAY, at: AT });
  };
  // before: the sync as it was, straight to the owner's repository
  resetThrottle();
  const before = await ownerDevice();
  fill(before.store);
  const ghBefore = mockGithubFor('pakrasi/b1-exam');
  await syncResults(before.store, { repo: 'pakrasi/b1-exam', api: config.github.api, fetch: ghBefore.fetch, force: true, pull: false });
  // after: the migration at boot, then the seam
  resetThrottle();
  const after = await ownerDevice();
  fill(after.store);
  Cn.migrateConnections(after.app);
  const ghAfter = mockGithubFor('pakrasi/b1-exam');
  const out = await seamSync(after.store, { fetch: ghAfter.fetch, force: true, pull: false });
  assert.equal(out.ok, 3);
  const resultFiles = (/** @type {Map<string, string>} */ m) => new Map([...m].filter(([p]) => !/^data\/(events|snapshots|logs)\//.test(p)));
  assert.deepEqual([...resultFiles(ghAfter.files).keys()].sort(), [...resultFiles(ghBefore.files).keys()].sort());
  for (const [p, b64] of resultFiles(ghBefore.files)) assert.equal(ghAfter.files.get(p), b64, p);
  assert.ok([...resultFiles(ghAfter.files).keys()].includes('data/attempts/20261003T180405-day03-lesen.json'));
  // the backup goes to the same folders as before
  const backupPaths = (/** @type {Map<string, string>} */ m) => [...m.keys()].filter(p => /^data\/(events|snapshots)\//.test(p)).sort();
  assert.deepEqual(backupPaths(ghAfter.files), backupPaths(ghBefore.files));
  assert.ok(backupPaths(ghAfter.files).includes(`data/events/dev1/${DAY}.ndjson`));
  // the one difference: the events file also carries the migration's two settings changes (additive)
  const lines = (/** @type {any} */ gh) => Buffer.from(gh.files.get(`data/events/dev1/${DAY}.ndjson`), 'base64').toString('utf8').trim().split('\n').map(l => JSON.parse(l));
  const extra = lines(ghAfter).filter(e => e.type !== 'card.reviewed');
  assert.deepEqual(lines(ghBefore).map(e => e.type), ['card.reviewed']);
  assert.deepEqual(extra.map(e => e.type), ['settings.changed', 'settings.changed']);
  // every request went to the owner's repository
  assert.ok(ghAfter.calls.length > 0);
});

test('the export carries no token and no token check; the repository setting is the profile\'s own', async () => {
  const { store, app } = await ownerDevice();
  Cn.migrateConnections(app);
  store.set(Cn.CHECK_KV, { status: 'ok', key: await fingerprint(TOKEN), repo: 'pakrasi/b1-exam' });
  const b = JSON.stringify(exportBundle(store, { profile: store.profile, includeScripts: true, archived: [] }));
  assert.ok(!b.includes(TOKEN));
  assert.ok(!b.includes(Cn.CHECK_KV));
});

test('disconnect this device: the token and its check go, the profile keeps its repository; forget removes that too', async () => {
  const { store, app } = await ownerDevice();
  Cn.migrateConnections(app);
  store.set(Cn.CHECK_KV, { status: 'ok', repo: 'pakrasi/b1-exam' });
  Cn.disconnectDevice(store);
  assert.equal(Cn.deviceToken(store), null);
  assert.equal(store.get(Cn.CHECK_KV), null);
  assert.equal(Cn.connectionState(store), 'device');
  Cn.forgetRepo(app);
  assert.equal(Cn.connectionState(store), 'none');
});

/* ---------- token checks ---------- */

/**
 * A GitHub that answers /repos/<repo> and /user/repos as a token of the given shape would.
 * @param {{status?: number, scopes?: string | null, expiry?: string | null, others?: string[], push?: boolean, offline?: boolean}} o
 */
function ghToken({ status = 200, scopes = null, expiry = '2026-12-31 00:00:00 UTC', others = [], push = true, offline = false } = {}) {
  /** @type {{url: string, auth: string}[]} */ const calls = [];
  const fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (offline) throw new TypeError('Failed to fetch');
    const headers = new Headers({ 'content-type': 'application/json' });
    if (scopes != null) headers.set('x-oauth-scopes', scopes);
    if (expiry) headers.set('github-authentication-token-expiration', expiry);
    if (url.includes('/user/repos')) return new Response(JSON.stringify([{ full_name: 'someone/results', private: true }, ...others.map(full_name => ({ full_name, private: true }))]), { status: 200, headers });
    if (status !== 200) return new Response('{"message":"Not Found"}', { status, headers });
    return new Response(JSON.stringify({ full_name: 'someone/results', private: true, permissions: { push } }), { status: 200, headers });
  };
  return { fetch, calls };
}
const check = (/** @type {string} */ token, /** @type {any} */ o) => { const g = ghToken(o); return checkToken({ token, repo: 'someone/results', api: 'https://api.github.com', fetch: g.fetch }).then(c => ({ c, calls: g.calls })); };

test('token check: a fine-grained token for one repository with an expiry is fine', async () => {
  const { c, calls } = await check(TOKEN, {});
  assert.equal(c.status, 'ok'); assert.equal(c.kind, 'fine-grained'); assert.equal(c.expires, '2026-12-31'); assert.deepEqual(c.warnings, []);
  assert.deepEqual(calls.map(x => new URL(x.url).pathname), ['/repos/someone/results', '/user/repos']);
  assert.ok(!JSON.stringify(c).includes(TOKEN), 'the result never holds the token');
});

test('token check: broad and never-expiring tokens are warned about; a read-only one too', async () => {
  assert.deepEqual((await check(TOKEN, { others: ['someone/diary'] })).c.warnings, ['broad']);
  assert.deepEqual((await check(TOKEN, { expiry: null })).c.warnings, ['noExpiry']);
  assert.deepEqual((await check(TOKEN, { push: false })).c.warnings, ['readOnly']);
  // a classic token without the repo scope (it can reach only public repositories) is broad by nature
  const pub = (await check('ghp_synthetic_classic_not_real_000000000', { scopes: 'public_repo' })).c;
  assert.equal(pub.status, 'ok'); assert.equal(pub.kind, 'classic'); assert.ok(pub.warnings.includes('broad'));
});

test('token check: a classic token with the full repo scope is refused, by prefix or by its scopes header', async () => {
  for (const scopes of ['repo', 'repo, workflow', 'gist, repo']) {
    const { c } = await check('ghp_synthetic_classic_not_real_000000000', { scopes });
    assert.equal(c.status, 'refused', scopes);
  }
  // an OAuth or unknown-prefix token that GitHub reports with the repo scope
  assert.equal((await check('gho_synthetic_oauth_not_real_0000000000', { scopes: 'repo' })).c.status, 'refused');
  assert.equal((await check('synthetic_other_token_not_real_00000', { scopes: 'repo' })).c.status, 'refused');
  // ghp_ without a scopes header that still reached a private repository: classic all the same
  assert.equal((await check('ghp_synthetic_classic_not_real_000000000', { scopes: null })).c.status, 'refused');
  assert.equal(tokenKind('ghp_x'), 'classic'); assert.equal(tokenKind('github_pat_x'), 'fine-grained'); assert.equal(tokenKind('x'), 'other');
});

test('token check: denied and offline', async () => {
  assert.equal((await check(TOKEN, { status: 401 })).c.status, 'denied');
  assert.equal((await check(TOKEN, { status: 404 })).c.status, 'denied');
  assert.equal((await check(TOKEN, { status: 403 })).c.status, 'denied');
  assert.equal((await check(TOKEN, { offline: true })).c.status, 'offline');
});

test('recheck: once a study day per token; a new token is checked again; a refused token is removed from the device', async () => {
  const { store, app } = await fresh();
  Cn.connect(app, 'someone/results', TOKEN);
  const g = ghToken({});
  const o = { api: 'https://api.github.com', today: DAY, fetch: g.fetch };
  const c1 = await recheck(store, o);
  assert.equal(c1?.status, 'ok');
  assert.equal(lastCheck(store)?.expires, '2026-12-31');
  assert.equal(await recheck(store, o), null, 'checked today already');
  assert.equal(g.calls.length, 2);
  assert.ok(!JSON.stringify(store.get(Cn.CHECK_KV)).includes(TOKEN), 'the stored check never holds the token');
  // a replaced token is checked again at once
  Cn.connect(app, 'someone/results', 'ghp_synthetic_classic_not_real_000000000');
  const r = await recheck(store, { ...o, fetch: ghToken({ scopes: 'repo' }).fetch });
  assert.equal(r?.status, 'refused');
  assert.equal(Cn.deviceToken(store), null, 'removed');
  assert.equal(Cn.connectionState(store), 'device');
  // nothing to check without a repository or a token
  const v = await fresh();
  assert.equal(await recheck(v.store, o), null);
});

/* ---------- the device link ---------- */

test('device link: repo and exp are read and scrubbed with the token; an expired or far-future link is refused', () => {
  const TOK = 'synthetic_link_token_0123456789abcdef';
  assert.deepEqual(splitLinkHash(`#/profile?token=${TOK}&repo=someone/results&exp=1700000000`), { token: TOK, hash: '#/profile', repo: 'someone/results', exp: 1700000000 });
  const nav = (/** @type {string} */ hash) => {
    const loc = { pathname: '/fluentish/', search: '', hash };
    const hist = { state: null, replaceState(/** @type {any} */ _s, /** @type {string} */ _u, /** @type {string} */ url) { loc.hash = url.slice(url.indexOf('#')); } };
    return { loc, hist };
  };
  const now = () => 1_800_000_000;
  let n = nav(`#/profile?token=${TOK}&exp=${now() + 600}`);
  assert.deepEqual(takeLink(n.loc, n.hist, now), { token: TOK, repo: null, expired: false });
  assert.equal(n.loc.hash, '#/profile');
  n = nav(`#/profile?token=${TOK}&exp=${now() - 1}`);
  assert.equal(takeLink(n.loc, n.hist, now)?.expired, true);
  assert.ok(!n.loc.hash.includes(TOK));
  n = nav(`#/profile?token=${TOK}&exp=${now() + LINK_MAX_S + 60}`);
  assert.equal(takeLink(n.loc, n.hist, now)?.expired, true, 'a link meant to live for days is refused');
  n = nav(`#/profile?token=${TOK}&exp=soon`);
  assert.equal(takeLink(n.loc, n.hist, now)?.expired, true);
  n = nav(`#token=${TOK}`);
  assert.deepEqual(takeLink(n.loc, n.hist, now), { token: TOK, repo: null, expired: false }, 'a link without exp (b1-token.py today) still links');
});

test('no feature makes a link or a QR code out of the token, and nothing logs it', () => {
  const hits = [];
  const walk = (/** @type {string} */ d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'vendor') walk(p); continue; }
      if (!/\.js$/.test(n)) continue;
      const src = readFileSync(p, 'utf8');
      if (/token=\$\{|['"`]#token=|['"`]token=|qrcode/i.test(src) && !p.endsWith(path.join('core', 'link.js'))) hits.push(path.relative(ROOT, p));
      if (/log\([^)]*(githubToken|deviceToken|linkToken)/.test(src)) hits.push(`${path.relative(ROOT, p)} (log)`);
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(hits, []);
});
