// Lane P2 (progress-io): the progress log's writer reads less (catchUp works out the missing days before it reads the
// event archive or any content; recordToday and the backfill load content only once a day is counted; the IndexedDB
// adapter reads a key range with getAll + getAllKeys). None of that may change what is written. For random synthetic
// histories (gaps, two courses, events from another device, an archive and an outbox, unmarks and deleted cards,
// malformed answer dates, the Igloo placement, evidence without a card, logs with missing, live and final days),
// the writer now and the frozen writer from before the lane (reference/progress-e969b13.mjs) write the same log and
// the same device record, op by op, with the new writer over the IndexedDB adapter (fake-indexeddb) and the old one
// over the memory adapter. npm run test:tz runs it in three time zones. All data is synthetic.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { createIdbAdapter } from '../../src/data/adapters/idb.js';
import * as NEW from '../../src/data/progress.js';
import * as REF from './reference/progress-e969b13.mjs';
import * as P from '../../src/domain/progress.js';
import * as FS from '../../src/domain/fsrs.js';
import * as D8 from '../../src/domain/days.js';
import { markRec, unmarkRec } from '../../src/domain/known.js';
import { addActivity } from '../../src/data/activity.js';
import { canon } from '../../src/domain/cardmerge.js';

// isoNow() stamps every record: one frozen clock, so both writers stamp the same time and the logs compare whole
mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-15T10:00:00Z') });

const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000e1';
const CTX = { exam: null, phase: 'none', tz: 'UTC' };

const DE_WORDS = Array.from({ length: 22 }, (_, i) => `W:eq${i}.n`);
const DE_PHRASES = Array.from({ length: 10 }, (_, i) => `K:ENG_CHUNK_${String(9101 + i).padStart(4, '0')}`);
const ATLAS = { items: {
  id: [...DE_WORDS, ...DE_PHRASES, 'GC:perfekt'],
  k: [...DE_WORDS.map(() => 0), ...DE_PHRASES.map(() => 1), 2],
  L: [...DE_WORDS.map((_, i) => (i >= 20 ? 9 : i % 4)), ...DE_PHRASES.map((_, i) => i % 4), 2],
  t: [...DE_WORDS, ...DE_PHRASES, ''].map(() => ''),
} };
const FR_PHRASES = Array.from({ length: 6 }, (_, i) => 1201 + i);
const FILES = {
  'atlas.de': ATLAS,
  'course.fr': { lang: 'fr', phrases: Object.fromEntries(FR_PHRASES.map((n, i) => [`ENG_CHUNK_${n}`, { level: ['A1', 'A2'][i % 2] }])) },
  'igloo.words.fr': [{ id: 'homme.noun', w: 'homme', level: 'A1' }, { id: 'chat.noun', w: 'chat', level: 'A2' }],
};
/** Content that counts what it was asked for. */
function contentLog() {
  const calls = { manifest: 0, load: 0 };
  return { calls, content: {
    manifest: async () => { calls.manifest++; return { files: Object.keys(FILES).map(id => ({ id, path: id, sha256: `${id.length}0f1e2d3c4b5a6978` })) }; },
    load: async (/** @type {string} */ id) => { calls.load++; if (/** @type {any} */ (FILES)[id]) return structuredClone(/** @type {any} */ (FILES)[id]); throw new Error(`no ${id}`); },
  } };
}

const SETTINGS = { v: 1, language: 'german', level: 'B1', exam: { type: null, date: null, modules: [] }, minutesPerDay: 30, onboarded: true, rev: {} };
const course = (/** @type {string} */ id, /** @type {string} */ level) => ({ id, lang: id, level, goal: { exam: null, date: null }, decks: [] });
const SETTINGS_TWO = { ...SETTINGS, courses: [course('de', 'B1'), course('fr', 'A1')], activeCourse: 'de' };
const SETTINGS_FR = { ...SETTINGS, language: 'french', courses: [course('fr', 'A1')], activeCourse: 'fr' };

/** A small seeded generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (/** @type {number} */ n) => Math.floor(next() * n), pick: (/** @type {any[]} */ l) => l[Math.floor(next() * l.length)], chance: (/** @type {number} */ p) => next() < p };
}

/** A time on a day: any hour, so in some time zones `at` falls on the day before or after `day`. */
const stamp = (/** @type {string} */ d, /** @type {number} */ h, /** @type {number} */ n) => Date.parse(`${d}T00:00:00Z`) + h * 3600e3 + n * 1000;

/**
 * Build one random history on a memory adapter (the old writer runs live during it, as the app did), then return the
 * adapter's contents to copy into fresh storages.
 */
async function world(seed) {
  const r = rng(seed);
  const adapter = createMemoryAdapter();
  const clock = { today: () => clock.day, day: D8.add('2026-01-05', r.int(330)) };
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'iph', seq: 0 }, clock });
  const settings = r.pick([SETTINGS, SETTINGS, SETTINGS, SETTINGS_TWO, SETTINGS_FR]);
  store.set('settings', settings);
  const { content } = contentLog();
  const ctx = { store, clock, content };
  const decks = settings === SETTINGS_FR ? ['fr:core'] : settings === SETTINGS_TWO ? ['b1', 'de:core', 'fr:core'] : ['b1', 'b1', 'de:core'];
  const itemsOf = (/** @type {string} */ deck) => (deck.startsWith('fr:') ? [...FR_PHRASES.map(n => `K:ENG_CHUNK_${n}`), 'W:homme.noun', 'W:chat.noun'] : [...DE_WORDS, ...DE_PHRASES]);
  const span = 40 + r.int(110);
  const foreign = [];   // events from another device of the same profile (an import or a restore put them here)
  let fseq = 0, n = 0;
  const answer = (/** @type {string} */ deck, /** @type {string} */ id, /** @type {string} */ d, /** @type {number} */ g, /** @type {number} */ h) => {
    const prev = store.cards(deck)[id] || null;
    const { rec } = FS.schedule(prev, { g, ms: 1100, mode: 't', flags: '' }, { today: d, exam: null, phase: 'none' }, stamp(d, h, n));
    store.putCards(deck, [[id, rec]]);
    const payload = { deck, itemId: id, g, ms: 1100, flags: '', mode: 't', ctx: CTX, base: { u: prev?.u ?? null, reps: prev?.reps ?? 0 }, post: rec };
    if (r.chance(0.08)) {
      // answered on the other device: its event is here, its card too (a restore merged it)
      fseq++;
      foreign.push({ id: `0192ffff-${String(fseq).padStart(4, '0')}-7000-8000-${String(seed).padStart(12, '0')}`, v: 1, profileId: PID, deviceId: 'mac', seq: fseq,
        at: new Date(stamp(d, h, n++)).toISOString(), day: d, type: 'card.reviewed', payload, synced: true, path: null });
    } else store.append('card.reviewed', payload, { day: d, at: new Date(stamp(d, h, n++)) });
  };
  let off = 0;
  for (let i = 0; i < span; i++) {
    const d = D8.add(clock.day, 1);
    clock.day = d;
    if (off > 0) { off--; continue; }
    if (r.chance(0.06)) { off = 3 + r.int(18); continue; }   // a gap of days off
    if (!r.chance(0.7)) continue;
    // the app opens: the old writer catches up (not every day: some opens happen offline in another tab, or not at all)
    if (r.chance(0.5)) await REF.catchUp(ctx);
    const deck = r.pick(decks), items = itemsOf(deck);
    const h = r.pick([0, 1, 7, 12, 18, 22, 23]);
    for (let k = 1 + r.int(5); k > 0; k--) answer(deck, r.pick(items), d, r.pick([1, 2, 3, 3, 3, 4]), h);
    if (r.chance(0.12)) {
      const id = r.pick(items);
      const prev = store.cards(deck)[id] || null;
      const post = markRec(prev, { today: d, by: 'self', now: stamp(d, h, n) });
      if (post) {
        store.putCards(deck, [[id, post]]);
        store.append('card.marked_known', { deck, by: 'self', items: [{ itemId: id, base: prev, post }], ctx: CTX }, { day: d, at: new Date(stamp(d, h, n++)) });
        if (r.chance(0.4)) {
          // undone the same day: the card goes back (deleted when it had no record)
          const back = /** @type {{rec: any}} */ (unmarkRec(post));
          store.putCards(deck, [[id, back.rec]]);
          store.append('card.unmarked_known', { deck, by: 'self', items: [{ itemId: id, base: post, post: back.rec }], ctx: CTX }, { day: d, at: new Date(stamp(d, h, n++)) });
        }
      }
    }
    if (r.chance(0.04)) {
      // a card with malformed answer dates (an old import): never a study day, never a crash
      store.putCards(deck, [[`W:odd${i}.n`, { S: 2, D: 5, due: d, reps: 2, lapses: 0, last: d, first: d, stage: 0, streak: 0, learn: null, relearn: false, u: stamp(d, h, n),
        hist: [[D8.add(d, -1).slice(0, 8) + '31', 3, 900, 't', ''], [Number(d.slice(0, 4)), 3, 900, 't', ''], [d.slice(0, 7) + '-1', 3, 900, 't', '']], known: { by: 'self', on: 'soon' } }]]);
    }
    if (r.chance(0.03)) { const id = r.pick(Object.keys(store.cards(deck))); if (id) store.putCards(deck, [[id, null]]); }   // a card reset
    for (let k = r.int(3); k > 0; k--) addActivity(store, d, { minutes: 1 + r.int(25), rounds: 1, kind: r.pick(['review', 'new', 'write', 'speak', 'read']) });
    if (r.chance(0.08)) store.update('activity', (/** @type {any} */ a) => ({ ...a, [D8.add(d, -r.int(3))]: { minutes: 5 + r.int(9), rounds: 1 } }), {});   // the old shape
    if (r.chance(0.1)) store.update('lookup.seen', (/** @type {any} */ m) => ({ ...m, [r.pick(DE_WORDS)]: { first: d, last: d, n: 1 } }), {});
    if (r.chance(0.03) && settings !== SETTINGS_FR && !store.get('meta', null)) {
      store.set('meta', { migratedAt: `${d}T08:00:00Z` });
      if (r.chance(0.5)) store.set('known', { placement: d, placed: 1 });
      const id = r.pick(DE_WORDS), prev = store.cards('b1')[id] || null;
      const post = markRec(prev, { today: d, by: 'igloo', now: stamp(d, 6, n) });
      if (post) store.putCards('b1', [[id, post]]);
    }
    // the live writer at the end of the day, unless the app was closed first
    if (r.chance(0.75)) await REF.recordToday(ctx);
  }
  // the log as other devices and older versions left it: a final day made live again, a day gone, an estimate
  for (const name of Object.keys(store.kv).filter(P.isMonthKey)) {
    const month = structuredClone(store.get(name));
    for (const d of Object.keys(month)) {
      const x = r.next();
      if (x < 0.06) delete month[d];
      else if (x < 0.12) delete month[d].fin;
      else if (x < 0.15) { month[d].estimated = true; month[d].src = 'estimate'; }
    }
    store.set(name, month);
  }
  // the backfill ran (or ran part-way, or never)
  const dk = r.next();
  if (dk < 0.4) store.set(NEW.DEVICE_KV, { profileId: PID, at: '2026-01-01T00:00:00.000Z', exactFrom: null, jumpDay: null, withBackup: false, from: null, days: 0, estimated: 0 });
  else if (dk < 0.55) store.set(NEW.DEVICE_KV, { profileId: PID, at: '2026-01-01T00:00:00.000Z', partial: true, startedAt: '2026-01-01T00:00:00.000Z', cursor: {}, exactFrom: null, jumpDay: null, withBackup: false, from: null, days: 0, estimated: 0 });
  await store.flush();
  const dump = { device: await adapter.getDevice(), scope: await adapter.loadScope(PID), devScope: await adapter.loadScope('device'), ...(await adapter.loadProfile(PID)), archive: await adapter.loadArchive(PID) };
  store.close?.();
  return { dump, foreign, end: clock.day, r };
}

/** A fresh storage holding the world, with events older than `cut` in the archive and the rest in the outbox. */
async function storage(/** @type {any} */ adapter, /** @type {any} */ w, /** @type {string} */ cut, /** @type {boolean} */ dupes) {
  const { dump, foreign } = w;
  await adapter.putDevice(dump.device);
  await adapter.putProfile({ id: PID, name: '', kind: 'local' });
  for (const [k, v] of Object.entries(dump.devScope)) await adapter.putKV('device', k, v);
  for (const [k, v] of Object.entries(dump.scope)) await adapter.putKV(PID, k, v);
  for (const [deck, cards] of Object.entries(dump.cards)) await adapter.putCards(PID, deck, Object.entries(/** @type {any} */ (cards)));
  const all = [...dump.outbox, ...foreign];
  await adapter.putEvents(PID, all);
  const old = all.filter(e => e.day < cut);
  await adapter.archiveEvents(PID, old);
  if (dupes && old.length) await adapter.putEvents(PID, old.filter((_, i) => i % 7 === 0));   // the same event in both stores
  return adapter;
}

async function open(/** @type {any} */ adapter, /** @type {string} */ day) {
  const clock = { today: () => clock.day, day };
  const device = await adapter.getDevice();
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device, clock });
  return { store, clock };
}

/** Everything the writer may write: the whole profile kv (the log, the device record) and the device kv. */
const written = (/** @type {any} */ store) => canon(store.kv);

/**
 * The app's opens after the history: today, again the same day, and on later days, each one the start sequence
 * (startProgress: backfill once, the missed days, today). Both writers, step by step.
 */
async function compareOpens(seed) {
  const w = await world(seed);
  const r = w.r;
  const cut = D8.add(w.end, -(20 + r.int(40)));
  const dupes = r.chance(0.3);
  const a = await open(await storage(createMemoryAdapter(), w, cut, dupes), w.end);
  const b = await open(await storage(await createIdbAdapter(new IDBFactory()), w, cut, dupes), w.end);
  const ca = contentLog(), cb = contentLog();
  const ref = { store: a.store, clock: a.clock, content: ca.content }, now = { store: b.store, clock: b.clock, content: cb.content };
  assert.equal(written(a.store), written(b.store), `seed ${seed}: the same start`);
  const days = [w.end, w.end, D8.add(w.end, 1), D8.add(w.end, 2 + r.int(3)), D8.add(w.end, 30 + r.int(40))];
  for (const [i, day] of days.entries()) {
    a.clock.day = b.clock.day = day;
    const where = `seed ${seed}, open ${i} on ${day}`;
    // study on the open's day that only the minutes or only a mark show (Read, Conversation, I know this)
    const study = r.next(), item = r.pick(DE_WORDS);
    for (const s of [a.store, b.store]) {
      if (study < 0.3) addActivity(s, day, { minutes: 6, rounds: 1, kind: 'read' });
      else if (study < 0.5) { const post = markRec(s.cards('b1')[item] || null, { today: day, by: 'self', now: stamp(day, 9, 0) }); if (post) s.putCards('b1', [[item, post]]); }
    }
    const x1 = await REF.backfill(ref, { files: null }), y1 = await NEW.backfill(now, { files: null });
    assert.deepEqual(y1, x1, `${where}: backfill result`);
    assert.equal(await NEW.catchUp(now), await REF.catchUp(ref), `${where}: catchUp result`);
    assert.equal(written(b.store), written(a.store), `${where}: the log after catchUp`);
    assert.equal(await NEW.recordToday(now), await REF.recordToday(ref), `${where}: recordToday result`);
    assert.equal(written(b.store), written(a.store), `${where}: the log after recordToday`);
  }
  // and a forced backfill over all of it (Profile › Diagnostics can run it again)
  assert.deepEqual(await NEW.backfill(now, { files: null, force: true }), await REF.backfill(ref, { files: null, force: true }), `seed ${seed}: forced backfill`);
  assert.equal(written(b.store), written(a.store), `seed ${seed}: the log after a forced backfill`);
  await a.store.flush(); await b.store.flush();
  return { recorded: P.records(b.store.kv, 'de').length + P.records(b.store.kv, 'fr').length };
}

test('equivalence: the writer now and the writer before lane P2 write the same log for random histories', async () => {
  let total = 0;
  for (let seed = 1; seed <= 36; seed++) total += (await compareOpens(seed)).recorded;
  assert.ok(total > 36 * 15, `the histories have days to compare (${total})`);
});

test('studyDaysIn and cardOn agree with P.studyDays on any window, malformed dates included', () => {
  const r = rng(77);
  for (let k = 0; k < 200; k++) {
    /** @type {Record<string, Record<string, any>>} */ const decks = {};
    /** @type {Record<string, any>} */ const activity = {};
    const base = D8.add('2026-01-01', r.int(400));
    const anyDay = () => r.pick([D8.add(base, r.int(120) - 60), D8.add(base, r.int(120) - 60), '2026-02-30', '2026-13-01', '2026-1-05', 'soon', 20260105, null, `${D8.add(base, r.int(10))}T08:00`]);
    for (let c = r.int(30); c > 0; c--) {
      const deck = r.pick(['b1', 'de:core', 'fr:core']);
      (decks[deck] ||= {})[`W:x${c}`] = r.chance(0.05) ? null : { hist: Array.from({ length: r.int(6) }, () => [anyDay(), 3]), ...(r.chance(0.3) ? { known: { on: anyDay() } } : {}) };
    }
    for (let a = r.int(15); a > 0; a--) activity[/** @type {any} */ (anyDay())] = r.pick([{ minutes: r.int(3), rounds: 0 }, { minutes: 0, rounds: r.int(2) }, null, { minutes: 'x' }]);
    const from = D8.add(base, -r.int(70)), to = D8.add(from, r.int(90));
    const want = P.studyDays(activity, decks).filter(d => d >= from && d < to);
    const got = NEW.studyDaysIn(activity, decks, from, to);
    assert.deepEqual(got.all, want, `case ${k}`);
    assert.deepEqual([...got.cards].sort(), P.studyDays({}, decks).filter(d => d >= from && d < to), `case ${k}: card days`);
    for (const day of [from, to, base, D8.add(base, 3), '2026-02-30', 'soon']) assert.equal(NEW.cardOn(decks, day), P.studyDays({}, decks).includes(day), `case ${k}: cardOn ${day}`);
  }
});

test('reads: an open with no missing day reads no event archive and no content; a profile with nothing to count loads no content', async () => {
  const w = await world(5);
  const s = await open(await storage(createMemoryAdapter(), w, D8.add(w.end, -30), false), w.end);
  const c = contentLog();
  const ctx = { store: s.store, clock: s.clock, content: c.content };
  await NEW.backfill(ctx, { files: null }); await NEW.catchUp(ctx); await NEW.recordToday(ctx);
  // the same day again: everything is recorded
  let archived = 0;
  const orig = s.store.archived.bind(s.store);
  s.store.archived = () => { archived++; return orig(); };
  const before = { ...c.calls };
  assert.equal(await NEW.catchUp(ctx), 0);
  assert.equal(archived, 0, 'the archive is not read');
  assert.deepEqual(c.calls, before, 'no content is loaded');
  // a new visitor on Welcome: no cards, no activity, nothing in the log
  const fresh = await open(await (async () => { const ad = createMemoryAdapter(); await ad.putDevice({ deviceId: 'new', seq: 0 }); return ad; })(), '2026-10-10');
  fresh.store.set('settings', { ...SETTINGS, onboarded: false });
  const f = contentLog();
  const fctx = { store: fresh.store, clock: fresh.clock, content: f.content };
  await NEW.backfill(fctx, { files: null }); await NEW.catchUp(fctx); await NEW.recordToday(fctx);
  assert.deepEqual(f.calls, { manifest: 0, load: 0 }, 'no content for a profile with nothing to count');
});

test('exact, not sliced by time: a card answered before the catch-up window and again today keeps its state from the archived event', async () => {
  // why catchUp reads the whole archive once a day is missing: the walk replays every earlier event, and a card that
  // changed after the day being counted is known on that day only through its events, however old they are
  const day = async (/** @type {boolean} */ keepArchive) => {
    const adapter = createMemoryAdapter();
    const clock = { today: () => clock.day, day: '2026-06-01' };
    const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'iph', seq: 0 }, clock });
    store.set('settings', SETTINGS);
    const put = (/** @type {string} */ id, /** @type {string} */ d, /** @type {number} */ g, /** @type {number} */ k) => {
      const prev = store.cards('b1')[id] || null;
      const { rec } = FS.schedule(prev, { g, ms: 1000, mode: 't', flags: '' }, { today: d, exam: null, phase: 'none' }, stamp(d, 9, k));
      store.putCards('b1', [[id, rec]]);
      store.append('card.reviewed', { deck: 'b1', itemId: id, g, ms: 1000, flags: '', mode: 't', ctx: CTX, base: { u: prev?.u ?? null, reps: prev?.reps ?? 0 }, post: rec }, { day: d, at: new Date(stamp(d, 9, k)) });
    };
    put(DE_WORDS[0], '2026-06-01', 3, 0); put(DE_WORDS[0], '2026-06-01', 3, 1);   // learnt 1 June
    put(DE_WORDS[1], '2026-09-09', 3, 0);                                         // studied 9 Sep, the app closed before it wrote
    clock.day = '2026-09-10';
    put(DE_WORDS[0], '2026-09-10', 1, 0);                                         // missed today: its card changed after 9 Sep
    await store.flush();
    const old = [...store.events.values()].filter(e => e.day < '2026-07-01');
    await store.archive(old);
    if (!keepArchive) store.archived = async () => [];                            // what a read of the last 60 days would see
    const ctx = { store, clock, content: contentLog().content };
    assert.equal(await NEW.catchUp(ctx), 1);
    return (store.get(P.monthKey('de', '2026-09-09')) || {})['2026-09-09'];
  };
  const exact = await day(true), sliced = await day(false);
  assert.equal(exact.estimated, undefined, 'exact: the June answers come from the archive');
  assert.equal(sliced.estimated, true, 'without them the June word would be an estimate');
});
