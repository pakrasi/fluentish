// Progress backup (src/data/sync/backup.js) through the results sync: one NDJSON file per device per study day under
// data/events/, today's snapshot under data/snapshots/, events marked synced, the consent and backoff rules of the
// results sync, files rewritten with their sha and never losing a line, and nothing private in any uploaded file.
// Everything runs against a mock GitHub with a synthetic token; all data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { syncResults, resetThrottle, createGithubB1Exam } from '../../src/data/sync/github-b1exam.js';
import * as B from '../../src/data/sync/backup.js';
import { openSession, deleteProfile } from '../../src/data/session.js';
import * as St from '../../src/data/scripts.js';
import * as P from '../../src/domain/script/parse.js';
import * as Lad from '../../src/domain/script/ladder.js';
import { mockGithubFor } from './sync-harness.mjs';

const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000b1';
const REPO = 'someone/results';
const TOKEN = 'test-token-not-real-0001';
const D1 = '2026-10-03', D2 = '2026-10-04';
const T0 = Date.UTC(2026, 9, 3, 15, 0, 0);

/** A store on a memory adapter with a synthetic token. */
async function fresh({ today = D2, deviceId = 'dev1', secrets = { githubToken: TOKEN } } = {}) {
  const adapter = createMemoryAdapter();
  let day = today;
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId, seq: 0 }, clock: { today: () => day } });
  store.set('secrets', secrets);
  await store.flush();
  return { adapter, store, setDay: (/** @type {string} */ d) => { day = d; } };
}

/** A card answer: the card and its card.reviewed event (base → post), as Practice saves it. */
function review(store, { deck = 'b1', id, g = 3, day, at, prev = store.cards(deck)[id] || null }) {
  const post = { S: 2 + (prev?.reps || 0), D: 5, due: day, reps: (prev?.reps || 0) + 1, lapses: 0, last: day, first: prev?.first || day, stage: 1, streak: 1, learn: null, relearn: false, u: at, hist: [...(prev?.hist || []), [day, g, 1200, 't', '']] };
  store.putCards(deck, [[id, post]]);
  return store.append('card.reviewed', { deck, itemId: id, g, ms: 1200, flags: '', mode: 't', ctx: { exam: null, phase: 'none', tz: 'UTC' }, base: { u: prev?.u ?? null, reps: prev?.reps ?? 0 }, post }, { day, at: new Date(at) });
}

const sync = (store, gh, o = {}) => { resetThrottle(); return syncResults(store, { repo: REPO, fetch: gh.fetch, force: true, pull: false, ...o }); };
const lines = (gh, p) => gh.text(p).trim().split('\n').map(l => JSON.parse(l));
async function body(gh, p) { const raw = Buffer.from(gh.files.get(p), 'base64'); return p.endsWith('.gz') ? B.gunzip(new Uint8Array(raw)) : raw.toString('utf8'); }

test('learning events go up as one NDJSON file per device per study day, by seq, and are marked synced', async () => {
  const { store } = await fresh();
  const a = review(store, { id: 'BP:a', day: D1, at: T0 });
  const b = review(store, { id: 'BP:b', day: D1, at: T0 + 1000 });
  const c = review(store, { id: 'BP:a', day: D2, at: T0 + 86400e3 });
  store.append('settings.changed', { key: 'minutesPerDay', value: 30, rev: '0001790000000000-0000-dev1' }, { day: D2, at: new Date(T0 + 86400e3 + 5) });
  store.append('legacy.imported', { summary: { cards: 1 } }, { day: D1 });   // not a learning event
  const gh = mockGithubFor(REPO);
  const r = await sync(store, gh);
  assert.equal(r.error, null);
  assert.deepEqual(r.backup, { ok: 4, files: 2, snapshot: true, error: null });
  assert.deepEqual(lines(gh, `data/events/dev1/${D1}.ndjson`).map(e => e.id), [a.id, b.id]);
  const d2 = lines(gh, `data/events/dev1/${D2}.ndjson`);
  assert.deepEqual(d2.map(e => e.type), ['card.reviewed', 'settings.changed']);
  assert.equal(d2[0].id, c.id);
  assert.deepEqual(Object.keys(d2[0]), ['id', 'v', 'profileId', 'deviceId', 'seq', 'at', 'day', 'type', 'payload'], 'event@1 without the outbox fields');
  assert.deepEqual(d2[0].payload.base, { u: T0, reps: 1 }, 'base and post travel (B4)');
  assert.equal(B.waiting(store), 0);
  assert.ok([a, b, c].every(e => store.events.get(e.id).synced === true));
  assert.equal(store.pending().filter(e => e.type === 'legacy.imported').length, 1, 'other events are left alone');
  // nothing new: a second flush writes nothing
  const puts = gh.calls.filter(x => x.method === 'PUT').length;
  await sync(store, gh);
  assert.equal(gh.calls.filter(x => x.method === 'PUT').length, puts);
});

test('a day file is rewritten with its sha and only ever gains lines; a stale sha reads again', async () => {
  const { store } = await fresh();
  review(store, { id: 'BP:a', day: D2, at: T0 });
  const gh = mockGithubFor(REPO);
  await sync(store, gh);
  const p = `data/events/dev1/${D2}.ndjson`;
  // a line that is in the file but no longer on this device (another tab wrote it, or the outbox moved it away)
  const foreign = { id: '0192a3b4-c5d6-7e8f-9a0b-0000000000ff', v: 1, profileId: PID, deviceId: 'dev1', seq: 99, at: '2026-10-04T12:00:00.000+00:00', day: D2, type: 'card.reviewed', payload: { deck: 'b1', itemId: 'BP:z' } };
  gh.files.set(p, Buffer.from(gh.text(p) + JSON.stringify(foreign) + '\n').toString('base64'));
  const e2 = review(store, { id: 'BP:b', day: D2, at: T0 + 5000 });
  // the first PUT finds the file changed under it once (409): it reads again and merges
  let once = true;
  gh.beforePut = path => { if (path === p && once) { once = false; gh.files.set(p, Buffer.from(gh.text(p) + '\n').toString('base64')); } };
  const r = await sync(store, gh, { backupNow: true });
  assert.equal(r.backup.error, null);
  const ids = lines(gh, p).map(e => e.id);
  assert.ok(ids.includes(foreign.id) && ids.includes(e2.id) && ids.length === 3, ids.join(','));
  const shaPuts = gh.calls.filter(x => x.method === 'PUT' && x.path === p);
  assert.ok(shaPuts.length >= 3, 'created, then a conflict, then written with the fresh sha');
});

test('a file over 1 MB is read raw', async () => {
  const { store } = await fresh();
  review(store, { id: 'BP:a', day: D2, at: T0 });
  const gh = mockGithubFor(REPO);
  gh.big = 10;   // every file counts as big
  await sync(store, gh);
  review(store, { id: 'BP:b', day: D2, at: T0 + 1 });
  const r = await sync(store, gh, { backupNow: true });
  assert.equal(r.backup.error, null);
  assert.equal(lines(gh, `data/events/dev1/${D2}.ndjson`).length, 2);
  assert.ok(gh.calls.some(c => /raw/.test(c.headers?.Accept || '')));
});

test("today's snapshot: gzip JSON with the shared decks and the learning collections, rewritten in place when due", async () => {
  const { store, setDay } = await fresh();
  review(store, { id: 'BP:a', day: D2, at: T0 });
  store.putCards('speak', [['SS:x-01', { reps: 1, u: T0, S: 1 }]]);
  store.putCards('script', [['SW:rahmen', { reps: 1, u: T0, origin: ['script:bike01'] }]]);
  store.set('mistakes', { 'F:a-1': { id: 'F:a-1', v: 1, wrong: 'ich komme gern', right: 'ich komme gerne', rule: '', source: { attemptId: 'a' }, createdAt: 'x', deletedAt: null } });
  store.set('settings', { v: 1, minutesPerDay: 30, rev: { minutesPerDay: '0001790000000000-0000-dev1' } });
  store.set('ui', { importSeen: true });
  const gh = mockGithubFor(REPO);
  let now = T0 + 3600e3;
  await sync(store, gh, { now: () => now });
  const p = `data/snapshots/dev1/${D2}.json.gz`;
  const snap = JSON.parse(await body(gh, p));
  assert.equal(snap.schema, 'fluentish-snapshot@1');
  assert.deepEqual(Object.keys(snap.cards).sort(), ['b1', 'speak'], 'the script deck stays on the device');
  assert.equal(snap.counts.cards, 2);
  assert.deepEqual(Object.keys(snap.kv).sort(), ['mistakes', 'settings']);
  assert.equal(snap.deviceId, 'dev1'); assert.equal(snap.profileId, PID); assert.equal(snap.day, D2);
  // changed an hour later: not due yet; asked for: written in place with its sha
  review(store, { id: 'BP:b', day: D2, at: now });
  now += 3600e3;
  await sync(store, gh, { now: () => now });
  assert.equal(JSON.parse(await body(gh, p)).counts.cards, 2);
  await sync(store, gh, { now: () => now, backupNow: true });
  assert.equal(JSON.parse(await body(gh, p)).counts.cards, 3);
  // six hours on and changed: due by itself; a new study day: a new file
  review(store, { id: 'BP:c', day: D2, at: now });
  now += B.SNAPSHOT_EVERY_MS;
  await sync(store, gh, { now: () => now });
  assert.equal(JSON.parse(await body(gh, p)).counts.cards, 4);
  setDay('2026-10-05');
  await sync(store, gh, { now: () => now + 60e3 });
  assert.ok(gh.files.has('data/snapshots/dev1/2026-10-05.json.gz'));
  assert.ok(gh.files.has(p), 'the day before stays');
});

test('a profile without cards writes no snapshot (a fresh start never covers a real one)', async () => {
  const { store } = await fresh();
  store.append('settings.changed', { key: 'minutesPerDay', value: 30, rev: 'r' }, { day: D2 });
  const gh = mockGithubFor(REPO);
  await sync(store, gh);
  assert.ok(![...gh.files.keys()].some(k => k.startsWith('data/snapshots/')));
});

test('consent and backoff: not linked, before the import notice, offline, a bad token, or turned off: nothing goes', async () => {
  // not linked
  const nl = await fresh({ secrets: {} });
  review(nl.store, { id: 'BP:a', day: D2, at: T0 });
  const gh = mockGithubFor(REPO);
  assert.equal((await sync(nl.store, gh)).skipped, true);
  assert.equal(gh.calls.length, 0);
  // a migration whose notice has not been seen
  const { store } = await fresh();
  store.set('meta', { summary: { cards: 1 }, migratedAt: 'x' });
  review(store, { id: 'BP:a', day: D2, at: T0 });
  await sync(store, gh);
  assert.equal(gh.calls.filter(c => c.method === 'PUT').length, 0, 'uploads wait for the notice');
  assert.equal(B.waiting(store), 1);
  store.set('ui', { importSeen: true });
  // offline: nothing is marked, and the next flush sends it
  gh.mode = 'offline';
  let r = await sync(store, gh);
  assert.match(r.error, /connection/i);
  assert.equal(B.waiting(store), 1);
  assert.match(B.state(store).error.message, /connection/i, 'shown in Profile › Data');
  gh.mode = 'auth';
  r = await sync(store, gh);
  assert.match(r.error, /token/);
  assert.equal(gh.calls.filter(c => c.method === 'PUT').length, 0);
  gh.mode = 'ok';
  r = await sync(store, gh);
  assert.equal(r.backup.ok, 1);
  assert.equal(B.state(store).error, null);
  // turned off
  B.setState(store, { on: false });
  review(store, { id: 'BP:b', day: D2, at: T0 + 1 });
  const n = gh.calls.length;
  r = await sync(store, gh, { backupNow: true });
  assert.equal(gh.calls.length, n);
  assert.equal(B.waiting(store), 1);
  // a preview profile never syncs at all
  const shadow = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'shadow' }, device: { deviceId: 'dev9', seq: 0 }, clock: { today: () => D2 } });
  shadow.set('secrets', { githubToken: TOKEN });
  review(shadow, { id: 'BP:a', day: D2, at: T0 });
  assert.equal((await sync(shadow, gh)).skipped, true);
});

test('privacy: scripts, the script deck, local reviews and secrets never reach any uploaded file', async () => {
  const secrets = { githubToken: TOKEN, anthropicKey: 'test-key-not-real-0002' };
  const { store } = await fresh({ secrets });
  // a script with text, marks, rehearsals and a list word reviewed in it (practice/script/store.js)
  const md = fs.readFileSync(new URL('../fixtures/script-bicycle.md', import.meta.url), 'utf8');
  const parsed = P.parseScript(md, { id: P.counterIds('s') });
  const script = { id: 'bike01', v: 1, title: 'Bike talk', register: 'both', deliverOn: null, status: 'active', sections: parsed.sections, flagged: [], createdAt: 'x', marks: [] };
  St.put(store, script);
  St.updateProgress(store, script.id, p => ({ ...p, runs: [{ day: D2, ms: 60000 }] }));
  store.set('scripts.words', { 'SW:rahmen': { lemma: 'Rahmen', head: 'der Rahmen', gloss: 'frame' } });
  const ctx = { today: D2, exam: null, phase: 'none' };
  St.saveReview(store, { id: Lad.srId(script.id, script.sections[0].id), rec: Lad.rate(null, 3, ctx).rec, prev: null, deck: St.DECK, g: 3, mode: 's', ctx, scriptId: script.id });
  St.saveReview(store, { id: 'SW:rahmen', rec: Lad.rate(null, 3, ctx).rec, prev: null, deck: St.DECK, g: 3, ctx, scriptId: script.id });
  St.saveReview(store, { id: 'W:der_Rahmen', rec: { reps: 1, u: T0, S: 2 }, prev: null, deck: 'b1', g: 3, ctx, scriptId: script.id });   // a list word met in the script
  // a marked-known word in the script deck (its event is a learning type, but of a private deck)
  store.append('card.marked_known', { deck: 'script', by: 'self', items: [{ itemId: 'SW:kette', base: null, post: { reps: 1 } }], ctx: { exam: null, phase: 'none', tz: 'UTC' } }, { day: D2 });
  // and ordinary learning that does go up
  review(store, { id: 'BP:a', day: D2, at: T0 });
  store.set('prefs', { theme: 'dark' });
  const gh = mockGithubFor(REPO);
  const r = await sync(store, gh, { backupNow: true });
  assert.equal(r.backup.error, null);
  assert.equal(r.backup.ok, 1, 'only the ordinary review');
  const sentences = parsed.sections.flatMap(s => s.sentences.map(x => x.de)).filter(s => s.length > 12);
  assert.ok(sentences.length > 3);
  const uploaded = [...gh.files.keys()];
  assert.ok(uploaded.length >= 2);
  for (const p of uploaded) {
    const text = await body(gh, p);
    for (const sentence of sentences) assert.ok(!text.includes(sentence), `${p}: a script sentence`);
    for (const word of ['Fahrrad', 'Bike talk', 'bike01', '"SR:', '"SW:', 'script:', '"deck":"script"', '"local":true']) assert.ok(!text.includes(word), `${p}: ${word}`);
    for (const v of Object.values(secrets)) assert.ok(!text.includes(v), `${p}: a secret`);
    assert.ok(!/"(prefs|secrets|scripts|scripts\.progress|scripts\.words|backup)"/.test(text), `${p}: a device or script collection`);
  }
  // the local and private-deck events are not marked sent: they never leave (and the outbox archive keeps them)
  assert.equal(store.pending().filter(e => e.payload.local || e.payload.deck === 'script').length, 4);
});

test('privacy: an upload that would carry a key or token is blocked, and nothing is written', async () => {
  const { store } = await fresh();
  const tokenShaped = ['github', 'pat', 'A'.repeat(36)].join('_');
  review(store, { id: 'BP:a', day: D2, at: T0 });
  store.set('mistakes', { 'F:a-1': { id: 'F:a-1', wrong: `my key is ${tokenShaped}`, right: 'x', source: { attemptId: 'a' }, createdAt: 'x', deletedAt: null } });
  const gh = mockGithubFor(REPO);
  const r = await sync(store, gh, { backupNow: true });
  assert.match(r.backup.error, /blocked/);
  assert.ok(![...gh.files.keys()].some(k => k.startsWith('data/snapshots/')));
  for (const p of gh.files.keys()) assert.ok(!gh.text(p).includes(tokenShaped));
  assert.equal(B.leakIn(`x ${TOKEN} y`, { githubToken: TOKEN }), 'a key or token of this device');
  assert.equal(B.leakIn('{"deck":"b1","itemId":"BP:a"}', { githubToken: TOKEN }), null);
  assert.equal(B.leakIn(`sk-ant-${'b'.repeat(30)}`), 'something shaped like a key or token');
});

test('the GitHub files API: read with sha, write with sha (conflict on a stale one), list folders', async () => {
  const gh = mockGithubFor(REPO);
  const files = createGithubB1Exam({ token: () => TOKEN, repo: REPO, fetch: gh.fetch }).files;
  assert.equal(await files.read('data/events/x/a.ndjson'), null);
  const sha = await files.write('data/events/x/a.ndjson', 'one\n', 'm');
  const got = await files.read('data/events/x/a.ndjson');
  assert.equal(got.sha, sha);
  assert.equal(new TextDecoder().decode(got.bytes), 'one\n');
  await assert.rejects(files.write('data/events/x/a.ndjson', 'two\n', 'm', 'stale'), e => e.conflict === true);
  await assert.rejects(files.write('data/events/x/a.ndjson', 'two\n', 'm'), e => e.conflict === true);
  await files.write('data/events/x/a.ndjson', 'one\ntwo\n', 'm', sha);
  await files.write('data/events/y/b.ndjson', 'b\n', 'm');
  assert.deepEqual((await files.list('data/events')).map(e => [e.name, e.type]).sort(), [['x', 'dir'], ['y', 'dir']]);
  assert.deepEqual((await files.list('data/events/x')).map(e => e.name), ['a.ndjson']);
  assert.deepEqual(await files.list('data/nothing'), []);
  const bytes = new Uint8Array([0x1f, 0x8b, 0, 255, 1]);
  await files.write('data/snapshots/x/a.json.gz', bytes, 'm');
  assert.deepEqual([...(await files.read('data/snapshots/x/a.json.gz')).bytes], [...bytes]);
});

test('Delete all gives the device a new id, so a fresh start never writes into the old backup folders', async () => {
  const adapter = createMemoryAdapter();
  const clock = { today: () => D2 };
  const a = await openSession({ adapter, legacyStorage: null, clock });
  const old = a.device.deviceId;
  a.store.set('backup', { on: true, snapshot: { day: D2 } });
  await a.store.flush();
  await deleteProfile(adapter, a.device, a.profile);
  const b = await openSession({ adapter, legacyStorage: null, clock });
  assert.notEqual(b.device.deviceId, old);
  assert.deepEqual(b.device.previousDeviceIds, [old]);
  assert.equal(b.store.get('backup'), undefined, 'the backup state starts over');
});

test('NDJSON: torn lines are skipped on read and kept on rewrite; lines sort by seq', () => {
  const t = B.mergeLines('{"id":"b","seq":2}\n{"id":"a","se', [{ id: 'c', v: 1, seq: 1, type: 'card.reviewed', payload: {} }]);
  assert.deepEqual(t.split('\n').filter(Boolean), ['{"id":"a","se', '{"id":"c","v":1,"seq":1,"type":"card.reviewed","payload":{}}', '{"id":"b","seq":2}']);
  assert.deepEqual(B.parseLines(t).map(e => e.id), ['c', 'b']);
  assert.equal(B.eventsPath('ab/../c', '2026-10-04'), 'data/events/ab-c/2026-10-04.ndjson');
});
