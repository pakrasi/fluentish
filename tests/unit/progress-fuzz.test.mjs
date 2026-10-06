// The progress log's backfill against its live writer (round 4, lane L5 gate): for random synthetic study histories, a
// day rebuilt by the backfill (src/data/progress.js backfill: cards + learning events + snapshots) is the record the
// live writer (recordToday at the end of that day) wrote, in every count and minute. Only when and where it was
// computed (at, dev), the source (live / replay) and the final flag may differ. All data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { resetThrottle } from '../../src/data/sync/github-b1exam.js';
import { sync, backupFiles } from '../../src/data/sync/index.js';
import * as P from '../../src/domain/progress.js';
import * as FS from '../../src/domain/fsrs.js';
import * as D8 from '../../src/domain/days.js';
import { markRec } from '../../src/domain/known.js';
import { recordToday, backfill, DEVICE_KV } from '../../src/data/progress.js';
import { addActivity } from '../../src/data/activity.js';
import { config } from '../../src/core/config.js';
import { mockGithubFor, OWNER_REPO, ownerConnect } from './sync-harness.mjs';

const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000f1';
const TOKEN = 'test-token-not-real-0005';
const CTX = { exam: null, phase: 'none', tz: 'UTC' };
const START = '2026-10-05';

// a synthetic map: 24 words and 12 phrases over the levels A1 to B2, plus two unlevelled words
const WORDS = Array.from({ length: 26 }, (_, i) => `W:fz${i}.n`);
const PHRASES = Array.from({ length: 12 }, (_, i) => `K:ENG_CHUNK_${String(9001 + i).padStart(4, '0')}`);
const ATLAS = { items: {
  id: [...WORDS, ...PHRASES],
  k: [...WORDS.map(() => 0), ...PHRASES.map(() => 1)],
  L: [...WORDS.map((_, i) => (i >= 24 ? 9 : i % 4)), ...PHRASES.map((_, i) => i % 4)],
  t: [...WORDS, ...PHRASES].map(() => ''),
} };
const content = {
  manifest: async () => ({ files: [{ id: 'atlas.de', path: 'atlas.de', sha256: 'f0a1b2c3d4e5f60718293a4b' }] }),
  load: async id => { if (id === 'atlas.de') return structuredClone(ATLAS); throw new Error(`no ${id}`); },
};
const SETTINGS = { v: 1, language: 'german', level: 'B1', exam: { type: null, date: null, modules: [] }, minutesPerDay: 30, onboarded: true, rev: {} };
const KINDS = ['review', 'new', 'write', 'speak', 'read', 'talk', 'build', 'script', 'exam'];
const COUNTS = ['known', 'shaky', 'seen', 'of', 'day', 'min', 'atlas', 'jump', 'estimated'];

/** A small seeded generator (mulberry32), so a failing seed can be run again. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: n => Math.floor(next() * n), pick: list => list[Math.floor(next() * list.length)], chance: p => next() < p };
}

async function device(deviceId, adapter = createMemoryAdapter()) {
  const clock = { today: () => clock.day, day: START };
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId, seq: 0 }, clock });
  store.set('secrets', { githubToken: TOKEN });
  ownerConnect(store);
  store.set('settings', SETTINGS);
  ownerConnect(store);
  await store.flush();
  return { store, clock, ctx: { store, clock, content } };
}

const stamp = (d, n) => Date.parse(`${d}T08:00:00Z`) + n * 60e3;

/** One answer through the real scheduler, saved as Practice saves it (the card and its card.reviewed event). */
function answer(store, id, d, g, n) {
  const prev = store.cards('b1')[id] || null;
  const { rec } = FS.schedule(prev, { g, ms: 1200, mode: 't', flags: '' }, { today: d, exam: null, phase: 'none' }, stamp(d, n));
  store.putCards('b1', [[id, rec]]);
  store.append('card.reviewed', { deck: 'b1', itemId: id, g, ms: 1200, flags: '', mode: 't', ctx: CTX, base: { u: prev?.u ?? null, reps: prev?.reps ?? 0 }, post: rec }, { day: d, at: new Date(stamp(d, n)) });
}

/** "I know this" on an item not seen yet (a self mark), with its event. */
function mark(store, id, d, n) {
  const prev = store.cards('b1')[id] || null;
  if (prev) return false;
  const post = markRec(prev, { today: d, by: 'self', now: stamp(d, n) });
  store.putCards('b1', [[id, post]]);
  store.append('card.marked_known', { deck: 'b1', by: 'self', items: [{ itemId: id, base: null, post }], ctx: CTX }, { day: d, at: new Date(stamp(d, n)) });
  return true;
}

/**
 * A random history of `days` calendar days: study on about two days in three, each with answers (new items and
 * reviews of earlier ones, misses among them), sometimes a mark, and minutes of random kinds. The live writer runs at
 * the end of every study day, as the app does 20 s after the last answer. Returns the live records by day.
 */
async function simulate(x, seed, days, { backupOn = null } = {}) {
  const r = rng(seed), s = x.store;
  /** @type {Map<string, any>} */ const live = new Map();
  const pool = [...WORDS, ...PHRASES];
  for (let i = 0; i < days; i++) {
    const d = D8.add(START, i);
    x.clock.day = d;
    if (!r.chance(0.68)) continue;   // a day off
    let n = 0;
    const seen = Object.keys(s.cards('b1'));
    const fresh = pool.filter(id => !seen.includes(id));
    for (let k = r.int(4); k > 0 && fresh.length; k--) {
      const id = fresh.splice(r.int(fresh.length), 1)[0];
      answer(s, id, d, r.chance(0.2) ? 1 : 3, n++);
      if (r.chance(0.7)) answer(s, id, d, 3, n++);   // a second right answer the same day graduates it
    }
    for (let k = r.int(6); k > 0 && seen.length; k--) {
      const id = r.pick(seen);
      if (s.cards('b1')[id]?.known && !s.cards('b1')[id]?.reps) continue;
      answer(s, id, d, r.pick([1, 2, 3, 3, 3, 4]), n++);
    }
    if (r.chance(0.15) && fresh.length) mark(s, fresh[r.int(fresh.length)], d, n++);
    for (let k = 1 + r.int(2); k > 0; k--) addActivity(s, d, { minutes: 1 + r.int(30), rounds: 1, kind: r.pick(KINDS) });
    if (r.chance(0.2)) addActivity(s, d, { minutes: 4 + r.int(10), rounds: 1, split: { review: 1 + r.int(8), new: r.int(5) } });
    await recordToday(x.ctx);
    const rec = (s.get(P.monthKey('de', d)) || {})[d];
    if (rec) live.set(d, structuredClone(rec));
    if (backupOn && backupOn(d)) { resetThrottle(); const res = await sync(s, { fetch: x.mock.fetch, pull: false, backupNow: true }); assert.equal(res.backup?.error ?? res.error, null); }
  }
  return live;
}

/** Wipe the log (every month key and the backfill's own record), as on a device that never recorded. */
function wipe(store) {
  for (const k of Object.keys(store.kv)) if (P.isMonthKey(k)) store.set(k, {});
  store.set(DEVICE_KV, null);
}

/** The counts of a record, without when, where and how it was computed. */
const counts = rec => Object.fromEntries(COUNTS.filter(k => rec[k] !== undefined).map(k => [k, rec[k]]));

function compare(store, live, seed) {
  const rebuilt = new Map(P.records(store.kv, 'de'));
  assert.deepEqual([...rebuilt.keys()], [...live.keys()], `seed ${seed}: the same study days`);
  for (const [d, want] of live) {
    const got = rebuilt.get(d);
    assert.deepEqual(counts(got), counts(want), `seed ${seed}, ${d}: a backfilled day equals the live day`);
    assert.equal(got.src, 'replay', `seed ${seed}, ${d}: rebuilt`);
    assert.equal(got.fin, true);
  }
}

test('fuzz: a backfilled day equals the live day record (one device, its own events)', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const x = await device('iph');
    const live = await simulate(x, seed, 28);
    assert.ok(live.size >= 8, `seed ${seed}: enough study days (${live.size})`);
    x.clock.day = D8.add(START, 28);
    wipe(x.store);
    const res = await backfill(x.ctx, { files: null, force: true });
    assert.equal(res.estimated, 0, `seed ${seed}: every day exact from the events`);
    compare(x.store, live, seed);
  }
});

test('fuzz: a backfilled day equals the live day record (from the backup: snapshots and event files)', async () => {
  for (let seed = 101; seed <= 106; seed++) {
    const mock = mockGithubFor(OWNER_REPO);
    const x = await device('mac');
    x.mock = mock;
    const r = rng(seed * 7);
    const live = await simulate(x, seed, 24, { backupOn: () => r.chance(0.6) });
    x.clock.day = D8.add(START, 24);
    resetThrottle();
    await sync(x.store, { fetch: mock.fetch, pull: false, backupNow: true });
    // a second device of the same profile: no cards, no events here, only the backup
    const y = await device('iph');
    for (const [deck, cards] of Object.entries(x.store.cardsByDeck)) y.store.putCards(deck, Object.entries(cards));
    y.store.set('activity', structuredClone(x.store.get('activity')));
    y.clock.day = x.clock.day;
    const res = await backfill(y.ctx, { files: backupFiles(y.store, { fetch: mock.fetch }) });
    assert.equal(res.withBackup, true, `seed ${seed}: read the backup`);
    // the rebuilt days on the other device equal what the live writer saw on this one (minutes per device included)
    const rebuilt = new Map(P.records(y.store.kv, 'de'));
    assert.deepEqual([...rebuilt.keys()], [...live.keys()], `seed ${seed}: the same study days`);
    for (const [d, want] of live) {
      const got = rebuilt.get(d);
      if (got.estimated) continue;   // a day before the first snapshot whose cards changed later without an event file read
      assert.deepEqual(counts(got), counts(want), `seed ${seed}, ${d}: equal from the backup`);
    }
    assert.ok([...rebuilt.values()].filter(v => !v.estimated).length >= live.size / 2, `seed ${seed}: most days exact`);
  }
});

test('resumable: a backfill cut off mid-way goes on from its checkpoint; the days equal an uninterrupted run', async () => {
  for (let seed = 201; seed <= 204; seed++) {
    const x = await device('iph');
    const live = await simulate(x, seed, 28);
    x.clock.day = D8.add(START, 28);
    wipe(x.store);
    const days = [...live.keys()];
    const cut = days[Math.floor(days.length / 2)];
    // the tab closes right after the checkpoint of `cut`
    const set = x.store.set.bind(x.store);
    x.store.set = (k, v) => { const out = set(k, v); if (k === DEVICE_KV && v && v.partial && v.cursor.de === cut) throw new Error('tab closed'); return out; };
    await assert.rejects(backfill(x.ctx, { files: null }), /tab closed/);
    x.store.set = set;
    const mid = x.store.get(DEVICE_KV);
    assert.equal(mid.partial, true, `seed ${seed}: a checkpoint is kept`);
    assert.equal(mid.cursor.de, cut);
    assert.equal(mid.days, days.indexOf(cut) + 1, 'the days done so far');
    // a day already done is not computed again: take one away, it stays away
    const gone = days[0];
    const key = P.monthKey('de', gone);
    const { [gone]: _, ...rest } = x.store.get(key);
    x.store.set(key, rest);
    const res = await backfill(x.ctx, { files: null });
    assert.equal(res.partial, undefined, 'finished');
    assert.equal(res.days, days.length, 'the days of both runs');
    assert.equal(res.from, days[0]);
    const rebuilt = new Map(P.records(x.store.kv, 'de'));
    assert.equal(rebuilt.has(gone), false, `seed ${seed}: the resumed run started after ${cut}`);
    for (const [d, want] of live) if (d !== gone) assert.deepEqual(counts(rebuilt.get(d)), counts(want), `seed ${seed}, ${d}: equals the live day`);
    assert.equal(await backfill(x.ctx, { files: null }), null, 'and it does not run again');
  }
});

test('resumable with the backup: snapshots are read one at a time as the walk reaches them, never all at once', async () => {
  const mock = mockGithubFor(OWNER_REPO);
  const x = await device('mac');
  x.mock = mock;
  const live = await simulate(x, 301, 24, { backupOn: () => true });
  x.clock.day = D8.add(START, 24);
  resetThrottle();
  await sync(x.store, { fetch: mock.fetch, pull: false, backupNow: true });
  const y = await device('iph');
  for (const [deck, cards] of Object.entries(x.store.cardsByDeck)) y.store.putCards(deck, Object.entries(cards));
  y.store.set('activity', structuredClone(x.store.get('activity')));
  y.clock.day = x.clock.day;
  // the order of reads: every event file first, then each snapshot interleaved with the days written
  const order = [];
  const files = backupFiles(y.store, { fetch: mock.fetch });
  const read = files.read.bind(files);
  files.read = async p => { if (p.includes('/snapshots/')) order.push(`snap ${p.split('/').pop().slice(0, 10)}`); return read(p); };
  const set = y.store.set.bind(y.store);
  y.store.set = (k, v) => { if (k === DEVICE_KV && v && v.partial) order.push(`day ${v.cursor.de}`); return set(k, v); };
  const res = await backfill(y.ctx, { files });
  assert.equal(res.withBackup, true);
  const snaps = order.filter(o => o.startsWith('snap'));
  assert.ok(snaps.length >= 5, 'several snapshots');
  // each snapshot is read just before the first day on or after it, not all before the first day
  const firstDay = order.findIndex(o => o.startsWith('day'));
  assert.ok(order.slice(0, firstDay).filter(o => o.startsWith('snap')).length < snaps.length, 'not every snapshot before the first day');
  for (let i = 0; i < order.length; i++) {
    if (!order[i].startsWith('snap')) continue;
    const sday = order[i].slice(5);
    const next = order.slice(i + 1).find(o => o.startsWith('day'));
    if (next) assert.ok(next.slice(4) >= sday, `${order[i]} is read for ${next}`);
  }
  const rebuilt = new Map(P.records(y.store.kv, 'de'));
  for (const [d, want] of live) { const got = rebuilt.get(d); if (!got.estimated) assert.deepEqual(counts(got), counts(want), `${d}: equal from the backup`); }
});
