// Today draws before the content has loaded (R8 P3, perf finding 1): it composes the day without the features'
// prepare(), draws that when the stats are today's, then runs prepareDay and composes again. These tests hold the plan
// to what composeDay(ctx) gives in one call, over many synthetic states, with the real feature providers and the real
// content read from disk:
//   1. early compose → prepareDay → compose gives the same plan, allowance and store as composeDay(ctx) (prepare first);
//   2. once a day has been prepared (the stats are today's), the plan composed without prepare is that same plan, so
//      the early paint shows what the prepared one shows;
//   3. statsFresh is false on the day's first visit (Today waits behind its shell then) and true after prepareDay.
// Synthetic store only: generic ids and real item ids from the content, no personal text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { createHlc } from '../../src/data/ids.js';
import { createBus } from '../../src/core/bus.js';
import { createClock, add } from '../../src/core/clock.js';
import { createContent } from '../../src/data/content.js';
import { normalizeSettings, examDate, setSetting, setCourse } from '../../src/data/settings.js';
import { setLanguage } from '../../src/core/lang.js';
import { t } from '../../src/core/i18n.js';
import { composeDay, prepareDay, statsFresh, WINDOW_KV, WINDOW_V } from '../../src/features/day.js';
import { dayAllowance, ANYWAY_KV } from '../../src/domain/allowance.js';
import { defaultWeek } from '../../src/domain/week.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = pathToFileURL(path.join(ROOT, 'content') + '/').href;
/** fetch() over the content folder (createContent's injectable fetch). @param {string} url */
const diskFetch = async url => {
  try {
    const text = fs.readFileSync(fileURLToPath(url.split('?')[0]), 'utf8');
    return /** @type {any} */ ({ ok: true, status: 200, json: async () => JSON.parse(text) });
  } catch { return /** @type {any} */ ({ ok: false, status: 404, json: async () => null }); }
};
// one content loader for every store, as one app session has one: the features cache what they build per session
const content = createContent({ base: BASE, fetch: diskFetch });
after(() => setLanguage('german'));

const TODAY = '2026-10-09';   // a Friday
const PID = '0192a3b4-c5d6-7e8f-9a0b-000000000007';

/** The item ids of the B1 content (items.json), sorted, for cards with real ids. */
const ITEM_IDS = (() => {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/b1/items.json'), 'utf8'));
  const list = Array.isArray(items) ? items : items.items || [];
  return list.map((/** @type {any} */ it) => it.id).filter(Boolean).sort();
})();

/** A card answered `reps` times, last on `last`, due on `due`. */
const card = (/** @type {string} */ first, /** @type {string} */ last, /** @type {string} */ due, reps = 3) =>
  ({ S: 6, D: 5, reps, lapses: 0, first, last, due, stage: 1, streak: 1, learn: null, relearn: false, hist: [] });

/**
 * A memory store in one synthetic state.
 * @param {any} sc the scenario
 */
async function makeCtx(sc) {
  const today = sc.today || TODAY;
  const adapter = createMemoryAdapter(), bus = createBus();
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock: { today: () => today }, bus });
  const app = { store, hlc: createHlc('dev1'), bus };
  if (sc.language) {
    setSetting(app, 'language', sc.language);
    setSetting(app, 'level', sc.level || 'B1');
    if (sc.examIn !== undefined) {
      setSetting(app, 'exam.type', sc.examIn === null ? null : sc.examType || 'goethe-b1');
      setSetting(app, 'exam.modules', ['lesen', 'hoeren', 'schreiben', 'sprechen']);
      if (sc.examIn !== null) setSetting(app, 'exam.date', add(today, sc.examIn));
    }
    setSetting(app, 'minutesPerDay', sc.minutes || 60);
    if (sc.newPerDay != null) setSetting(app, 'newPerDay', sc.newPerDay);
    const course = normalizeSettings(store.get('settings')).activeCourse;
    if (sc.week || sc.goalLevel) setCourse(app, course, { ...(sc.week ? { week: sc.week } : {}), ...(sc.goalLevel ? { 'goal.level': sc.goalLevel } : {}) });
  }
  if (sc.veteran) store.set('activity', { [add(today, -30)]: { minutes: 30, rounds: 2 }, [add(today, -1)]: { minutes: 25, rounds: 1 } });
  if (sc.studied) store.update('activity', (/** @type {any} */ a) => ({ ...(a || {}), [today]: { minutes: sc.studied, rounds: 1 } }), {});
  if (sc.cards) {
    // real B1 item ids: every third due today or earlier, the rest later; `sc.cards` of them
    const entries = ITEM_IDS.slice(0, sc.cards).map((id, i) => [id, card(add(today, -40), add(today, -(3 + (i % 9))), add(today, (i % 3 === 0 ? -(i % 4) : 2 + (i % 50))))]);
    store.putCards('b1', /** @type {any} */ (entries));
  }
  if (sc.farDue) {
    // reviews owed before the exam that an older schedule put after it (the window recap moves them)
    const ex = add(today, sc.examIn);
    store.putCards('b1', ITEM_IDS.slice(400, 400 + sc.farDue).map((id, i) => [id, { ...card(add(today, -60), add(today, -(16 + (i % 5)))), S: 2 + (i % 4), due: add(ex, 5 + i) }]));
  }
  if (sc.window) store.set(WINDOW_KV, { exam: add(today, sc.examIn), outside: true, recapped: {}, v: WINDOW_V });
  if (sc.anyway) store.set(ANYWAY_KV, { day: today });
  if (sc.stale) store.set('b1.session', { stats: { day: add(today, -1), priorityLeft: 50, pool: 900, unseen: 700, next: 12 } });
  const settings = () => normalizeSettings(store.get('settings'));
  const clock = createClock({ exam: () => examDate(settings()), forcedToday: today });
  const ctx = /** @type {any} */ ({ store, clock, settings, content, bus, t, toast: () => {}, params: {}, query: new URLSearchParams(), app, route: '/today', go: () => {}, refreshShell: async () => {} });
  return ctx;
}

/** Everything the plan and Today's hero read: the plan, the allowance, and every record but the settings' stamps. @param {any} ctx @param {any} day */
function shape(ctx, day) {
  const { store } = ctx;
  const kv = Object.fromEntries(Object.entries(store.kv).filter(([k]) => k !== 'settings').sort(([a], [b]) => a.localeCompare(b)));
  // (a deck read once is an empty map in the store; it is not a record)
  const cards = Object.fromEntries(Object.keys(store.cardsByDeck || {}).sort().map(d => [d, store.cards(d)]).filter(([, m]) => Object.keys(m || {}).length));
  return {
    plan: JSON.parse(JSON.stringify(day.plan)),
    actions: day.plan.rows.map((/** @type {any} */ r) => (r.actionFor ? [1, 2, 3].map(n => r.actionFor(n)) : null)),
    allow: JSON.parse(JSON.stringify(dayAllowance({ store, c: day.c, settings: day.settings }))),
    c: day.c, kv, cards,
  };
}

/** The scenarios: exam window on and off (every phase), week plan day kinds, the B2 gate, the new-item rate, an empty
 *  profile, a French course, the first week, a day studied, minutes. */
const SCENARIOS = [
  { name: 'empty profile (no language)' },
  { name: 'German, new learner, no date', language: 'german', examIn: null },
  { name: 'German, exam far (60 days), veteran', language: 'german', examIn: 60, veteran: true, cards: 300 },
  { name: 'German, window: week (10 days)', language: 'german', examIn: 10, veteran: true, cards: 300 },
  { name: 'German, window opens today (recap)', language: 'german', examIn: 14, veteran: true, cards: 200, farDue: 30, window: true },
  { name: 'German, window: lastNew', language: 'german', examIn: 2, veteran: true, cards: 250 },
  { name: 'German, window: eve', language: 'german', examIn: 1, veteran: true, cards: 250 },
  { name: 'German, exam day', language: 'german', examIn: 0, veteran: true, cards: 250 },
  { name: 'German, after the exam', language: 'german', examIn: -1, veteran: true, cards: 250 },
  { name: 'German, B2 date-only goal far', language: 'german', examIn: 200, examType: 'goethe-b2', level: 'B1', goalLevel: 'B2', veteran: true, cards: 600 },
  { name: 'German, B2 gate open (many seen)', language: 'german', examIn: null, goalLevel: 'B2', veteran: true, cards: 1200 },
  { name: 'German, new items 0', language: 'german', examIn: 60, veteran: true, cards: 120, newPerDay: 0 },
  { name: 'German, new items 25', language: 'german', examIn: 60, veteran: true, cards: 120, newPerDay: 25 },
  { name: 'German, 20 minutes, studied 15', language: 'german', examIn: 30, veteran: true, cards: 200, minutes: 20, studied: 15 },
  { name: 'German, stats from yesterday', language: 'german', examIn: 30, veteran: true, cards: 200, stale: true },
  { name: 'French course', language: 'french', examIn: null },
  { name: 'French course, veteran', language: 'french', examIn: null, veteran: true },
  // the week plan: every day kind (defaultWeek: n, read, light, write, n, talk, off from Monday), by moving today
  ...['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'].map(today => ({
    name: `German, week plan, ${today}`, language: 'german', examIn: null, veteran: true, cards: 200, week: defaultWeek(), today })),
  { name: 'German, week plan Off day, study anyway', language: 'german', examIn: null, veteran: true, cards: 200, week: defaultWeek(), today: '2026-10-11', anyway: true },
  { name: 'German, week plan in the window (Off day)', language: 'german', examIn: 5, veteran: true, cards: 200, week: defaultWeek(), today: '2026-10-11' },
];

/** What the scenarios reached, for the coverage test at the end. */
const seen = { phases: new Set(), kinds: new Set(), recap: 0, french: false };

for (const sc of SCENARIOS) {
  test(`early paint, then prepare: the same day as composeDay(ctx) · ${sc.name}`, async () => {
    setLanguage(sc.language || 'german');
    // the old path: prepare, then compose (one call)
    const a = await makeCtx(sc);
    const oneDay = await composeDay(a);
    const one = shape(a, oneDay);
    seen.phases.add(oneDay.c.phase);
    if (one.allow.plan && one.allow.plan.kind) seen.kinds.add(one.allow.plan.kind);
    if (sc.window) seen.recap += a.store.get(WINDOW_KV, null)?.recapped?.[oneDay.c.exam]?.moved || 0;
    if (oneDay.settings.language === 'french') seen.french = true;
    // the new path: compose without content (drawn at once when the stats are today's), prepare, compose again
    const b = await makeCtx(sc);
    const early = await composeDay(b, { prepare: false });
    const fresh = statsFresh(b.store, early.c, early.settings);
    await prepareDay(b);
    const late = shape(b, await composeDay(b, { prepare: false }));
    assert.deepEqual(late, one, 'plan, allowance and records after prepare are the one-call ones');
    // a scenario with a language starts the day without today's stats: Today waits behind its shell
    if (sc.language) assert.equal(fresh, false, 'the first visit of the day waits for the content');
    assert.equal(statsFresh(b.store, late.c, b.settings()), true, 'after prepare the stats are today\'s');
    // the next visit (stats are today's): the plan drawn before prepare is the prepared one
    const again = shape(b, await composeDay(b, { prepare: false }));
    assert.deepEqual(again.plan, one.plan, 'the early paint on a later visit shows the prepared plan');
    assert.deepEqual(again.allow, one.allow);
    assert.deepEqual(again.actions, one.actions);
    // and preparing again changes nothing
    await prepareDay(b);
    assert.deepEqual(shape(b, await composeDay(b, { prepare: false })), late, 'prepare is idempotent on a prepared day');
  });
}

test('the scenarios cover what they say: every plan phase, every day kind, the recap', () => {
  for (const p of ['none', 'week', 'lastNew', 'eve', 'day', 'after']) assert.ok(seen.phases.has(p), `phase ${p}`);
  for (const k of ['n', 'read', 'light', 'write', 'talk', 'off']) assert.ok(seen.kinds.has(k), `day kind ${k}`);
  assert.ok(seen.recap > 0, 'the window recap moved cards');
  assert.ok(seen.french, 'a French course');
});
