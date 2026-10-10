// The progress log (round 4, phase 0): src/domain/progress.js, src/domain/activity.js, src/data/progress.js, and the
// log in the backup (src/data/sync/backup.js, src/data/restore.js). Day-end counts, missed-day catch-up, the backfill
// (idempotent, exact where snapshots exist, estimated before), two devices' minutes added up, the snapshot round trip,
// old snapshots, and the size of a year. All data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { resetThrottle } from '../../src/data/sync/github-b1exam.js';
import { sync, restore, backupFiles } from '../../src/data/sync/index.js';
import * as R from '../../src/data/restore.js';
import * as B from '../../src/data/sync/backup.js';
import * as P from '../../src/domain/progress.js';
import * as A from '../../src/domain/activity.js';
import * as FS from '../../src/domain/fsrs.js';
import * as D8 from '../../src/domain/days.js';
import { markRec } from '../../src/domain/known.js';
import { canon } from '../../src/domain/cardmerge.js';
import { recordToday, catchUp, backfill, summary, DEVICE_KV, writeDay } from '../../src/data/progress.js';
import { addActivity } from '../../src/data/activity.js';
import { exportBundle, importFile } from '../../src/data/transfer.js';
import { config } from '../../src/core/config.js';
import { mockGithubFor, OWNER_REPO, ownerConnect } from './sync-harness.mjs';
import { readFileSync } from 'node:fs';
import { recordErrors } from '../../src/data/records.js';
import { validate, unsupported } from '../../src/core/schema.js';

const PROGRESS_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/records/progress.schema.json', import.meta.url), 'utf8'));
/** Every month key of a store matches schemas/records/progress.schema.json. */
const checkMonths = store => { for (const [k, v] of Object.entries(store.kv)) if (P.isMonthKey(k)) assert.deepEqual(recordErrors({ progress: PROGRESS_SCHEMA }, 'kv', k, v), [], k); };

const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000d1';
const TOKEN = 'test-token-not-real-0004';
const CTX = { exam: null, phase: 'none', tz: 'UTC' };
const D1 = '2026-09-28', D2 = '2026-09-29', D3 = '2026-09-30';
const at = (day, h = 9) => Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`);

// a tiny synthetic map (atlas.de): two A1 words, one A2 phrase, one B1 grammar concept, one unlevelled word
const ATLAS = { items: { id: ['W:haus.n', 'W:gut.adj', 'K:ENG_CHUNK_0001', 'GC:perfekt', 'W:extra.n'], k: [0, 0, 1, 2, 0], L: [0, 0, 1, 2, 9], t: ['', '', '', '', ''] } };
// a tiny French course
const COURSE_FR = { lang: 'fr', phrases: { ENG_CHUNK_1201: { level: 'A1' }, ENG_CHUNK_1202: { level: 'A2' } } };
const WORDS_FR = [{ id: 'homme.noun', w: 'homme', level: 'A1' }];
const FILES = { 'atlas.de': ATLAS, 'course.fr': COURSE_FR, 'igloo.words.fr': WORDS_FR };
const content = {
  manifest: async () => ({ files: Object.keys(FILES).map(id => ({ id, path: id, sha256: `${id.length}abcdef0123456789` })) }),
  load: async id => { if (FILES[id]) return structuredClone(FILES[id]); throw new Error(`no ${id}`); },
};
const SETTINGS_DE = { v: 1, language: 'german', level: 'B1', exam: { type: null, date: null, modules: [] }, minutesPerDay: 30, onboarded: true, rev: {} };

async function device(deviceId, { adapter = createMemoryAdapter(), day = D1, settings = SETTINGS_DE } = {}) {
  const clock = { today: () => clock.day, day };
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId, seq: 0 }, clock });
  store.set('secrets', { githubToken: TOKEN });
  ownerConnect(store);
  store.set('settings', settings);
  ownerConnect(store);
  await store.flush();
  return { store, clock, content, ctx: { store, clock, content } };
}
const day = (d, x) => { x.clock.day = d; };

/** One answer through the real scheduler, saved as Practice saves it (card + card.reviewed with base and post). */
function answer(store, id, d, { deck = 'b1', g = 3, h = 9 } = {}) {
  const prev = store.cards(deck)[id] || null;
  const { rec } = FS.schedule(prev, { g, ms: 1000, mode: 't', flags: '' }, { today: d, exam: null, phase: 'none' }, at(d, h));
  store.putCards(deck, [[id, rec]]);
  store.append('card.reviewed', { deck, itemId: id, g, ms: 1000, flags: '', mode: 't', ctx: CTX, base: { u: prev?.u ?? null, reps: prev?.reps ?? 0 }, post: rec }, { day: d, at: new Date(at(d, h)) });
  return rec;
}
/** A new word learnt: two right answers the same day graduate it. */
const learn = (store, id, d, o = {}) => { answer(store, id, d, o); return answer(store, id, d, { ...o, h: (o.h || 9) + 1 }); };

const mock = () => mockGithubFor(OWNER_REPO);
const backUp = async (store, m) => { resetThrottle(); const r = await sync(store, { fetch: m.fetch, pull: false, backupNow: true }); assert.equal(r.backup?.error ?? r.error, null); return r; };
const rec = (store, d, course = 'de') => (store.get(P.monthKey(course, d)) || {})[d];

/* ---------- activity: minutes per device and kind ---------- */

test('activity: minutes per device and kind; the kinds are a fixed list; totals stay the sums Today reads', () => {
  let a = A.addStudy({}, D1, { minutes: 10, rounds: 1, kind: 'review', lang: 'de', deviceId: 'iph' });
  a = A.addStudy(a, D1, { minutes: 6, rounds: 1, split: { review: 2, new: 1 }, lang: 'de', deviceId: 'iph' });
  a = A.addStudy(a, D1, { minutes: 5, kind: 'clusters', lang: 'de', deviceId: 'iph' });   // not a kind: counted, no kind
  assert.deepEqual(A.KINDS, ['review', 'new', 'write', 'speak', 'read', 'talk', 'build', 'script', 'exam']);
  assert.equal(a[D1].minutes, 21); assert.equal(a[D1].rounds, 2);
  assert.deepEqual(a[D1].by, { review: 14, new: 2 });
  assert.deepEqual(a[D1].dev.iph, { minutes: 21, rounds: 2, by: { review: 14, new: 2 }, lang: { de: 21 } });
  // a day from before devices keeps its minutes, under the legacy part, and keeps its old shape until a device adds
  const old = { [D1]: { minutes: 25, rounds: 2 } };
  assert.deepEqual(A.joinActivity(old, old), old, 'a legacy day merged with itself is unchanged');
  const b = A.addStudy(old, D1, { minutes: 5, kind: 'exam', deviceId: 'mac' });
  assert.equal(b[D1].minutes, 30);
  assert.deepEqual(b[D1].dev, { _: { minutes: 25, rounds: 2 }, mac: { minutes: 5, rounds: 0, by: { exam: 5 } } });
});

test('joinActivity: two devices on the same day add up (the restore.js bug: it took the larger); legacy days keep max', () => {
  const iph = A.addStudy({}, D1, { minutes: 20, rounds: 1, kind: 'review', deviceId: 'iph' });
  const mac = A.addStudy({}, D1, { minutes: 35, rounds: 3, kind: 'write', deviceId: 'mac' });
  const m = A.joinActivity(iph, mac);
  assert.equal(m[D1].minutes, 55); assert.equal(m[D1].rounds, 4);
  assert.deepEqual(m[D1].by, { review: 20, write: 35 });
  assert.equal(canon(A.joinActivity(mac, iph)), canon(m), 'commutative');
  assert.equal(canon(A.joinActivity(m, iph)), canon(m), 'idempotent: merging a device again adds nothing');
  // the same device seen twice (an older and a newer copy) takes its larger numbers, never their sum
  const later = A.addStudy(iph, D1, { minutes: 10, kind: 'review', deviceId: 'iph' });
  assert.equal(A.joinActivity(later, m)[D1].minutes, 65);
  // days from before devices: the old rule (the larger)
  assert.deepEqual(A.joinActivity({ [D1]: { minutes: 20, rounds: 1 } }, { [D1]: { minutes: 35, rounds: 3 } })[D1], { minutes: 35, rounds: 3 });
});

test('two devices on one day through the backup: the restore sums their minutes per device', async () => {
  const m = mock();
  const iph = await device('iph'), mac = await device('mac');
  answer(iph.store, 'W:haus.n', D1); answer(mac.store, 'W:gut.adj', D1);
  addActivity(iph.store, D1, { minutes: 20, rounds: 1, kind: 'review' });
  addActivity(mac.store, D1, { minutes: 15, rounds: 2, kind: 'write' });
  await backUp(iph.store, m); await backUp(mac.store, m);
  for (const s of [iph.store, mac.store]) { R.setAutoMerge(s, true); await restore(s, { fetch: m.fetch }).merge({ force: true }); }
  for (const s of [iph.store, mac.store]) {
    const d = s.get('activity')[D1];
    assert.equal(d.minutes, 35, `${s.device.deviceId}: 20 + 15`);
    assert.deepEqual(Object.keys(d.dev).sort(), ['iph', 'mac']);
    assert.deepEqual(d.by, { review: 20, write: 15 });
  }
});

/* ---------- the day record ---------- */

test('day end: counts by state, kind and level against the pool, from the same knowledge score as the map', async () => {
  const x = await device('iph');
  learn(x.store, 'W:haus.n', D1);
  answer(x.store, 'K:ENG_CHUNK_0001', D1, { g: 1 });   // seen, not known
  addActivity(x.store, D1, { minutes: 12, rounds: 1, kind: 'review' });
  assert.equal(await recordToday(x.ctx), 1);
  let r = rec(x.store, D1);
  assert.equal(r.v, 1); assert.equal(r.src, 'live'); assert.equal(r.estimated, undefined); assert.equal(r.dev, 'iph');
  assert.match(r.atlas, /^[0-9a-f]{2}/);
  assert.deepEqual(r.of, { w: [2, 0, 0, 0, 0, 0, 1], p: [0, 1], g: [0, 0, 1] }, 'denominators by level, unlevelled last');
  assert.deepEqual(r.seen, { w: [1], p: [0, 1], g: [] });
  assert.deepEqual(r.known, { w: [1], p: [], g: [] }, 'graduated today: recall 1, known (Where you stand counts it too)');
  assert.deepEqual(r.day, { new: 2, learnt: 1, missed: 0, reviews: 0, again: 1 });
  assert.deepEqual(r.min, { total: 12, rounds: 1, dev: { iph: { m: 12, by: { review: 12 } } }, by: { review: 12 } });
  // running again with nothing new writes nothing
  assert.equal(await recordToday(x.ctx), 0);
  // the next day a miss on it: shaky from the next study day (a lapse counts from the day after, domain/knowledge.js)
  day(D2, x);
  answer(x.store, 'W:haus.n', D2, { g: 1 });
  await recordToday(x.ctx);
  r = rec(x.store, D2);
  assert.deepEqual(r.known.w, [1], 'studying never lowers the day\'s numbers: the miss counts from tomorrow');
  assert.deepEqual(r.day, { new: 0, learnt: 0, missed: 1, reviews: 1, again: 1 });
  // a day without study has no record; the day after the miss the word is shaky
  day(D3, x);
  answer(x.store, 'W:gut.adj', D3);
  await recordToday(x.ctx);
  assert.deepEqual(rec(x.store, D3).shaky.w, [1]);
  day('2026-10-01', x);
  assert.equal(await recordToday(x.ctx), 0);
  assert.equal(rec(x.store, '2026-10-01'), undefined);
});

test('course-scoped: a French course has its own log over its own pool', async () => {
  const fr = { ...SETTINGS_DE, language: 'french', courses: [{ id: 'fr', lang: 'fr', level: 'A1', goal: { exam: null, date: null }, decks: [] }], activeCourse: 'fr' };
  const x = await device('iph', { settings: fr });
  learn(x.store, 'K:ENG_CHUNK_1201', D1, { deck: 'fr:core' });
  addActivity(x.store, D1, { minutes: 8, rounds: 1, kind: 'review' });
  await recordToday(x.ctx);
  const r = rec(x.store, D1, 'fr');
  assert.ok(r, 'progress.fr.<month>');
  assert.deepEqual(r.of, { w: [1], p: [1, 1], g: [] });
  assert.deepEqual(r.seen, { w: [], p: [1], g: [] });
  assert.equal(r.min.total, 8);
  assert.equal(rec(x.store, D1, 'de'), undefined, 'no German record');
  assert.deepEqual(summary(x.store, 'fr'), { days: 1, estimated: 0 });
});

test('missed days: on the next open, study days with no record are computed exactly from the cards and events', async () => {
  const x = await device('iph');
  learn(x.store, 'W:haus.n', D1);
  addActivity(x.store, D1, { minutes: 10, rounds: 1, kind: 'new' });
  // the app was closed before it wrote D1; it opens again on D3 and he studies before anything runs
  day(D3, x);
  answer(x.store, 'W:haus.n', D3); answer(x.store, 'W:gut.adj', D3);
  assert.equal(await catchUp(x.ctx), 1);
  const r = rec(x.store, D1);
  assert.equal(r.fin, true); assert.equal(r.estimated, undefined, 'exact: the D3 answers are undone through the events');
  assert.deepEqual(r.seen.w, [1]); assert.deepEqual(r.day, { new: 1, learnt: 1, missed: 0, reviews: 0, again: 0 });
  assert.equal(r.min.total, 10);
  assert.equal(await catchUp(x.ctx), 0, 'idempotent');
  // the same as a live record written at the end of D1 (counts; not when or where)
  const y = await device('iph');
  learn(y.store, 'W:haus.n', D1); addActivity(y.store, D1, { minutes: 10, rounds: 1, kind: 'new' });
  await recordToday(y.ctx);
  const live = rec(y.store, D1);
  for (const k of ['known', 'shaky', 'seen', 'of', 'day', 'min']) assert.deepEqual(r[k], live[k], k);
});

test('estimateCard: replaying a complete history gives the scheduler\'s own card', () => {
  /** @type {any} */ let c = null;
  const days = ['2026-09-23', '2026-09-23', '2026-09-24', '2026-09-27', '2026-10-02'];
  const g = [3, 3, 3, 1, 3];
  /** @type {any[]} */ const states = [];
  days.forEach((d, i) => { c = FS.schedule(c, { g: g[i], ms: 1000, mode: 't', flags: '' }, { today: d, exam: null, phase: 'none' }, at(d, 9 + i)).rec; states.push(structuredClone(c)); });
  const e = P.estimateCard(c, '2026-09-27');
  const want = states[3];
  for (const k of ['S', 'D', 'reps', 'lapses', 'last', 'first', 'learn', 'relearn']) assert.deepEqual(e[k], want[k], k);
  assert.equal(P.estimateCard(c, '2026-09-22'), null, 'not yet made');
  assert.equal(P.estimateCard(c, '2026-10-03'), c, 'unchanged since');
});

/* ---------- backfill ---------- */

/** Two weeks of synthetic study: before the backup (estimates) and after its first snapshot (exact). */
async function history() {
  const m = mock();
  const x = await device('iph', { day: '2026-09-23' });
  const s = x.store;
  const study = (d, f) => { day(d, x); f(); addActivity(s, d, { minutes: 15, rounds: 1, kind: 'review' }); };
  // before the cutover: cards from the old app (no events), then the Igloo placement on 4 Oct
  s.putCards('b1', [['W:gut.adj', { S: 3, D: 5, due: '2026-09-26', reps: 2, lapses: 0, last: '2026-09-23', first: '2026-09-23', stage: 0, streak: 0, learn: null, relearn: false, u: at('2026-09-23'),
    hist: [['2026-09-23', 3, 900, 't', ''], ['2026-09-23', 3, 900, 't', 'l']] }]]);
  s.set('activity', { '2026-09-23': { minutes: 9, rounds: 1 } });
  s.append('settings.changed', { key: 'minutesPerDay', value: 30, rev: '0001790000000001-0000-iph' }, { day: '2026-09-23', at: new Date(at('2026-09-23')) });   // no deck
  day('2026-10-02', x);
  // reviewed later without an event (the old app), so 23 Sep–1 Oct are estimated for it
  s.putCards('b1', [['W:gut.adj', { ...s.cards('b1')['W:gut.adj'], S: 9, reps: 3, last: '2026-10-02', u: at('2026-10-02'), hist: [...s.cards('b1')['W:gut.adj'].hist, ['2026-10-02', 3, 800, 't', '']] }]]);
  study('2026-10-04', () => {
    learn(s, 'K:ENG_CHUNK_0001', '2026-10-04');
    const rec0 = s.cards('b1')['W:extra.n'] || null;
    const marked = markRec(rec0, { today: '2026-10-04', by: 'igloo', now: at('2026-10-04', 12) });
    s.putCards('b1', [['W:extra.n', marked]]);
    s.append('card.marked_known', { deck: 'b1', by: 'igloo', items: [{ itemId: 'W:extra.n', base: null, post: marked }], ctx: CTX }, { day: '2026-10-04', at: new Date(at('2026-10-04', 12)) });
    s.set('meta', { migratedAt: '2026-10-04T08:00:00Z' });
    s.set('known', { placement: '2026-10-04', placed: 1 });
  });
  study('2026-10-05', () => { learn(s, 'W:haus.n', '2026-10-05'); });
  await backUp(s, m);   // the first snapshot (5 Oct)
  study('2026-10-06', () => { answer(s, 'W:haus.n', '2026-10-06'); answer(s, 'W:gut.adj', '2026-10-06'); });
  await backUp(s, m);
  study('2026-10-07', () => { answer(s, 'K:ENG_CHUNK_0001', '2026-10-07', { g: 1 }); });
  day('2026-10-08', x);
  return { x, m };
}

test('backfill: exact from the first snapshot, estimated before, the Igloo placement a labelled jump; runs once, idempotent', async () => {
  const { x, m } = await history();
  const s = x.store;
  const files = backupFiles(s, { fetch: m.fetch });
  const res = await backfill(x.ctx, { files });
  assert.equal(res.withBackup, true); assert.equal(res.exactFrom, '2026-10-05'); assert.equal(res.from, '2026-09-23');
  assert.equal(res.jumpDay, '2026-10-04');
  const days = P.records(s.kv, 'de').map(([d]) => d);
  assert.deepEqual(days, ['2026-09-23', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'], 'one record per study day, today excluded');
  const r = d => rec(s, d);
  for (const d of ['2026-09-23', '2026-10-02', '2026-10-04']) assert.equal(r(d).estimated, true, `${d} estimated`);
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) { assert.equal(r(d).estimated, undefined, `${d} exact`); assert.equal(r(d).fin, true); }
  assert.deepEqual(r('2026-10-04').jump, { from: 'igloo', known: 1 }, 'the placement: one item, on its day');
  assert.equal(r('2026-10-02').jump, undefined);
  assert.deepEqual(r('2026-09-23').seen.w, [1], 'the old card, as it was');
  assert.deepEqual(r('2026-10-04').min.dev.iph, { m: 15, by: { review: 15 } });
  assert.equal(r('2026-09-23').min.total, 9, 'minutes from before devices count for the first course');
  // the replayed days equal what a live writer saw at the time: 7 Oct's miss shows the phrase seen and not known
  assert.deepEqual(r('2026-10-07').day, { new: 0, learnt: 0, missed: 1, reviews: 1, again: 1 });
  assert.equal(s.get(DEVICE_KV).profileId, PID);
  // once per device: a second start does nothing, and forcing it writes nothing new
  assert.equal(await backfill(x.ctx, { files }), null);
  const before = canon(Object.fromEntries(Object.entries(s.kv).filter(([k]) => P.isMonthKey(k))));
  const writes = [];
  const set = s.set.bind(s);
  s.set = (k, v) => { if (P.isMonthKey(k)) writes.push(k); return set(k, v); };
  await backfill(x.ctx, { files, force: true });
  assert.deepEqual(writes, [], 'idempotent');
  assert.equal(canon(Object.fromEntries(Object.entries(s.kv).filter(([k]) => P.isMonthKey(k)))), before);
  assert.deepEqual(summary(s, 'de'), { days: 6, estimated: 3 });
  checkMonths(s);
});

test('backfill without the backup: this device\'s events only; it runs again once the backup can be read', async () => {
  const { x, m } = await history();
  const s = x.store;
  const res = await backfill(x.ctx, { files: null });
  assert.equal(res.withBackup, false); assert.equal(res.exactFrom, null);
  assert.equal(rec(s, '2026-10-06').estimated, undefined, 'exact from this device\'s events where every later change has one');
  assert.equal(await backfill(x.ctx, { files: null }), null, 'once');
  const again = await backfill(x.ctx, { files: backupFiles(s, { fetch: m.fetch }) });
  assert.equal(again.withBackup, true, 'and once more with the backup');
});

/* ---------- the log in the backup ---------- */

test('snapshot round trip: the log is backed up and restored; two devices\' logs merge per day', async () => {
  const m = mock();
  const iph = await device('iph'), mac = await device('mac');
  learn(iph.store, 'W:haus.n', D1); addActivity(iph.store, D1, { minutes: 20, rounds: 1, kind: 'new' });
  answer(mac.store, 'W:gut.adj', D1); addActivity(mac.store, D1, { minutes: 15, rounds: 1, kind: 'review' });
  await recordToday(iph.ctx); await recordToday(mac.ctx);
  await backUp(iph.store, m); await backUp(mac.store, m);
  const snap = B.snapshotOf(iph.store);
  assert.equal(snap.schema, 'fluentish-snapshot@1');
  assert.ok(snap.kv[P.monthKey('de', D1)], 'the month is in the snapshot');
  assert.equal(snap.kv[DEVICE_KV], undefined, 'the device record is not');
  // a new phone restores both devices
  const fresh = await device('new');
  await restore(fresh.store, { fetch: m.fetch }).apply((await restore(fresh.store, { fetch: m.fetch }).find()).data);
  const r = rec(fresh.store, D1);
  assert.equal(r.min.total, 35, 'both devices\' minutes');
  assert.deepEqual(Object.keys(r.min.dev), ['iph', 'mac']);
  assert.equal(r.day.new, 1, 'the counts of the more complete record (more of the day\'s study)');
  // order does not matter, and merging again changes nothing
  const a = rec(iph.store, D1), b = rec(mac.store, D1);
  assert.equal(canon(P.mergeDay(a, b)), canon(P.mergeDay(b, a)));
  assert.equal(canon(P.mergeDay(P.mergeDay(a, b), b)), canon(P.mergeDay(a, b)));
  const plan = R.planRestore(fresh.store, (await restore(fresh.store, { fetch: m.fetch }).find()).data);
  assert.equal(plan.empty, true);
  // export and import keep it too
  const bundle = JSON.parse(JSON.stringify(exportBundle(fresh.store, { profile: fresh.store.profile })));
  const other = await device('other');
  await importFile(JSON.stringify(bundle), { store: other.store });
  assert.equal(canon(rec(other.store, D1)), canon(r));
  checkMonths(fresh.store);
});

test('old snapshots: one from before the log restores as before; a new one is still fluentish-snapshot@1 for old readers', async () => {
  const m = mock();
  const x = await device('iph');
  learn(x.store, 'W:haus.n', D1);
  x.store.set('activity', { [D1]: { minutes: 25, rounds: 2 } });
  // a snapshot from before round 4: no progress keys, activity without devices
  const old = { ...B.snapshotOf(x.store), kv: { activity: { [D1]: { minutes: 25, rounds: 2 } }, settings: SETTINGS_DE } };
  assert.equal(Object.keys(old.kv).some(P.isMonthKey), false);
  const fresh = await device('new');
  const plan = R.planRestore(fresh.store, { snapshots: [old], events: [] });
  assert.deepEqual(plan.kv.activity, { [D1]: { minutes: 25, rounds: 2 } }, 'unchanged shape');
  assert.equal(Object.keys(plan.kv).some(P.isMonthKey), false);
  // the new snapshot, read the way the code before round 4 reads it: the schema and cards check, then only the fixed
  // SNAPSHOT_KV names, each value in the shape it had (activity's minutes and rounds are the day's totals)
  addActivity(x.store, D1, { minutes: 5, kind: 'review' });
  await recordToday(x.ctx);
  await backUp(x.store, m);
  const devices = await R.listBackups(backupFiles(x.store, { fetch: m.fetch }));
  const data = await R.readBackups(backupFiles(x.store, { fetch: m.fetch }), devices);
  const snap = data.snapshots[0];
  assert.equal(snap.schema, B.SNAPSHOT_SCHEMA); assert.equal(typeof snap.cards, 'object');
  const PRE_R4 = ['settings', 'activity', 'mistakes', 'lookup.seen', 'known', 'b1.session', 'speak.sim', 'clusters', 'practice.write', 'exams.feedbackLocal', 'exams.seen', 'exams.learnerNotes', 'vocab.local', 'vocab.events', 'fr.session'];
  for (const k of PRE_R4) assert.ok(k in B.SNAPSHOT_KV, `${k} kept`);
  assert.deepEqual(Object.keys(snap.kv).filter(k => !(k in B.SNAPSHOT_KV)), [P.monthKey('de', D1)], 'the only extra key is the month');
  const oldMax = (a, b) => ({ ...b, ...a, minutes: Math.max(+a.minutes || 0, +b.minutes || 0), rounds: Math.max(+a.rounds || 0, +b.rounds || 0) });
  assert.equal(oldMax({ minutes: 0 }, snap.kv.activity[D1]).minutes, 30, 'the old max rule still reads the day total');
});

test('schema: progress@1 uses only supported keywords and rejects a malformed day', () => {
  assert.deepEqual(unsupported(PROGRESS_SCHEMA), []);
  assert.notDeepEqual(validate(PROGRESS_SCHEMA, { '2026-10-05': { v: 1 } }), []);
  assert.notDeepEqual(validate(PROGRESS_SCHEMA, { 'oct 5': {} }), []);
});

test('prefix rule: only month logs match; a future progress.* collection does not inherit the per-day merge', () => {
  for (const k of ['progress.de.2026-10', 'progress.fr.2027-01', 'progress.de-ch.2026-12']) assert.equal(B.prefixRule(k), 'progressDays', k);
  for (const k of ['progress.de.frames.2026', 'progress.device', 'progress.de.2026-10.x', 'progress.de.2026-1', 'xprogress.de.2026-10']) assert.equal(B.prefixRule(k), null, k);
});

test('writeDay: an estimate never replaces an exact record; a final one replaces a live one', async () => {
  const x = await device('iph');
  learn(x.store, 'W:haus.n', D1); addActivity(x.store, D1, { minutes: 4, kind: 'new' });
  await recordToday(x.ctx);
  const live = rec(x.store, D1);
  assert.equal(writeDay(x.store, 'de', D1, { ...live, src: 'estimate', estimated: true, seen: { w: [2] }, at: '2099-01-01T00:00:00Z' }), false);
  assert.equal(writeDay(x.store, 'de', D1, { ...live, fin: true, src: 'replay' }), true);
  assert.equal(rec(x.store, D1).fin, true);
});

/* ---------- size ---------- */

test('size: a year of daily records stays small (raw and in the gzip snapshot)', () => {
  /** @type {Record<string, any>} */ const kv = {};
  let d = '2026-01-01';
  for (let i = 0; i < 365; i++, d = D8.add(d, 1)) {
    const n = i * 9;
    const r = { v: 1, at: `${d}T21:14:05.123Z`, dev: 'k3j9x2ab', src: 'live', fin: true, atlas: '2bfbda09',
      known: { w: [n, n >> 1, n >> 2, 40], p: [n >> 2, n >> 3, 90], g: [12, 30, 21] }, shaky: { w: [41, 60, 33, 8], p: [20, 31, 12], g: [3, 5, 2] },
      seen: { w: [n + 300, 900, 700, 120], p: [400, 380, 220], g: [20, 40, 30] }, of: { w: [1104, 1310, 1350, 900, 0, 0, 12], p: [520, 610, 540], g: [24, 52, 40] },
      day: { new: 23, learnt: 19, missed: 4, reviews: 141, again: 11 },
      min: { total: 47.5, rounds: 4, dev: { k3j9x2ab: { m: 35.2, by: { review: 20.1, new: 9.6, write: 5.5 } }, p8q2m1zz: { m: 12.3, by: { review: 12.3 } } }, by: { review: 32.4, new: 9.6, write: 5.5 } } };
    (kv[P.monthKey('de', d)] ||= {})[d] = r;
  }
  const raw = Buffer.byteLength(JSON.stringify(kv)), gz = gzipSync(JSON.stringify(kv)).length;
  console.log(`progress log, a year of daily records: ${raw} bytes raw, ${gz} bytes gzipped`);
  assert.ok(raw < 250_000, `raw ${raw}`);
  assert.ok(gz < 40_000, `gzip ${gz}`);
});

// round 8 integration: startProgress loads after the first screen (P1), so a reload while it still fetches content
// cancels that fetch. Its failure is logged a moment later, which a leaving page never reaches, and never at once.
test('startProgress logs a failure only after LOG_DELAY_MS (a page that reloads in between logs nothing)', async t => {
  const { startProgress, LOG_DELAY_MS } = await import('../../src/data/progress.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any[]} */ const logged = [];
  const ctx = {
    store: { profile: { kind: 'local' }, deleted: false },
    clock: { today: () => { throw new TypeError('Load failed'); } },
    bus: { on: () => {} },
    log: (/** @type {string} */ where, /** @type {any} */ e) => logged.push([where, e.message]),
  };
  await startProgress(/** @type {any} */ (ctx));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(logged, [], 'not logged at once');
  t.mock.timers.tick(LOG_DELAY_MS - 1);
  assert.deepEqual(logged, []);
  t.mock.timers.tick(1);
  assert.deepEqual(logged, [['progress', 'Load failed']]);
});
