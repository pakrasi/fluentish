// The exam window (round 4, lane L1a; PLAN-REVIEW B3 and S9). An exam date is a goal that can sit months ahead:
// exam behaviour starts 14 days before it (core/clock.js planPhase), the reviews owed before the exam are pulled in
// once when the window opens (features/day.js examWindow), and setting, moving or removing a date never writes a card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { context, createClock, planPhase, phase, windowStart, EXAM_WINDOW, add, diff } from '../../src/core/clock.js';
import FS from '../../src/domain/fsrs.js';
import RD from '../../src/domain/b1ready.js';
import { mode, allowance } from '../../src/domain/budget.js';
import { hasMockExam, writingFocus } from '../../src/domain/modules.js';
import { windowStep, windowRecap, windowDecks, examWindow, setupRows, WINDOW_KV } from '../../src/features/day.js';
import { Store } from '../../src/data/store.js';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { createHlc } from '../../src/data/ids.js';
import { setExamDate, setCourse, normalizeSettings } from '../../src/data/settings.js';
import { createBus } from '../../src/core/bus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXAM = '2027-06-15';   // a B2 exam months ahead (synthetic)

/* ---------- the phase ---------- */

test('planPhase: none until exam − 14, then the phases as before; days.phase has no window', () => {
  assert.equal(EXAM_WINDOW, 14);
  assert.equal(windowStart(EXAM), '2027-06-01');
  const at = (/** @type {number} */ n) => planPhase(add(EXAM, -n), EXAM);
  assert.equal(at(200), 'none'); assert.equal(at(60), 'none'); assert.equal(at(15), 'none');
  assert.equal(at(14), 'week', 'the first day of the window'); assert.equal(at(3), 'week');
  assert.equal(at(2), 'lastNew'); assert.equal(at(1), 'eve'); assert.equal(at(0), 'day'); assert.equal(at(-1), 'after'); assert.equal(at(-90), 'after');
  assert.equal(planPhase('2027-01-01', null), 'none');
  assert.equal(phase(add(EXAM, -60), EXAM), 'week', 'days.phase() is unchanged (script delivery dates read it)');
  assert.equal(planPhase(add(EXAM, -60), EXAM, Infinity), 'week', 'no window: the old phase');
  // inside the window the plan phase is the old phase, day for day
  for (let n = -5; n <= 14; n++) assert.equal(at(n), phase(add(EXAM, -n), EXAM), `exam − ${n}`);
});

test('context: a far date keeps its countdown fields and plans like no date; inside the window nothing changed', () => {
  const far = context({ today: add(EXAM, -60), exam: EXAM });
  assert.deepEqual(far, { today: add(EXAM, -60), exam: EXAM, phase: 'none', daysLeft: 60, lastNewDay: add(EXAM, -2), capDay: add(EXAM, -1), newItems: true, mocks: true });
  for (let n = -3; n <= 14; n++) {
    const today = add(EXAM, -n);
    assert.deepEqual(context({ today, exam: EXAM }), context({ today, exam: EXAM, examWindow: Infinity }), `exam − ${n}: byte-identical to before`);
  }
  for (const n of [15, 30, 60, 300]) {
    const today = add(EXAM, -n), now = context({ today, exam: EXAM }), was = context({ today, exam: EXAM, examWindow: Infinity });
    assert.deepEqual({ ...now, phase: 'week' }, was, `exam − ${n}: only the phase differs`);
  }
  const clock = createClock({ exam: () => EXAM, forcedToday: add(EXAM, -15) });
  assert.equal(clock.examWindow, 14);
  assert.equal(clock.ctx().phase, 'none');
});

test('window boundaries at the 04:00 cutoff in New York, Berlin and Kolkata (and across the DST changes)', () => {
  // each case: [exam, local wall-clock time, the phase]. The study day is the local date 4 hours earlier (today()),
  // so on a day the clocks change the cutoff moves by the hour; the cases avoid that hour.
  const cases = [
    ['2026-10-25', [2026, 10, 11, 3, 59], 'none'],   // 10 Oct study day: exam − 15
    ['2026-10-25', [2026, 10, 11, 4, 0], 'week'],    // 11 Oct: exam − 14
    ['2026-11-15', [2026, 11, 1, 2, 30], 'none'],    // 31 Oct: exam − 15 (the US clocks go back on 1 Nov)
    ['2026-11-15', [2026, 11, 1, 12, 0], 'week'],    // 1 Nov: exam − 14
    ['2026-11-08', [2026, 10, 25, 1, 30], 'none'],   // 24 Oct: exam − 15 (Europe's clocks go back on 25 Oct)
    ['2026-11-08', [2026, 10, 25, 12, 0], 'week'],   // 25 Oct: exam − 14
    ['2027-04-11', [2027, 3, 28, 12, 0], 'week'],    // spring forward in Europe on exam − 14
    ['2027-04-11', [2027, 3, 28, 1, 0], 'none'],
    ['2027-01-14', [2026, 12, 31, 23, 59], 'week'],  // a window that starts at a year end
    ['2027-01-14', [2026, 12, 31, 3, 0], 'none'],
    ['2026-10-20', [2026, 10, 20, 3, 59], 'eve'],    // the cutoff on the exam morning: still the eve
    ['2026-10-20', [2026, 10, 20, 4, 0], 'day'],
  ];
  const script = `
    const { context } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/core/clock.js')).href)});
    const cases = ${JSON.stringify(cases)};
    console.log(JSON.stringify(cases.map(([exam, [y, m, d, h, min]]) => context({ now: new Date(y, m - 1, d, h, min), exam }).phase)));`;
  for (const tz of ['America/New_York', 'Europe/Berlin', 'Asia/Kolkata']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), cases.map(c => c[2]), tz);
  }
});

/* ---------- what reads the phase: mode, the scheduler, the allowance ---------- */

const s60 = { minutesPerDay: 60, newPerDay: null, exam: { type: 'goethe-b1' }, rev: {} };
const decks = { b1: { due: 12 }, writing: { due: 3, open: 40 }, speak: { due: 4 }, mistakes: { due: 2, open: 3 }, build: { due: 1, open: 10 }, clusters: { due: 0, open: 10 } };

test('a far exam (60 days): maintenance, side decks open, no pace; the same day as with no date', () => {
  const today = add(EXAM, -60);
  const far = context({ today, exam: EXAM }), none = context({ today, exam: null });
  assert.equal(mode(far), 'maintenance'); assert.equal(mode(far, { day: 2 }), 'start');
  const extra = { goals: { build: true, clusters: true }, priorityLeft: 100 };
  const a = allowance({ c: far, settings: s60, decks, ...extra }), b = allowance({ c: none, settings: s60, decks, ...extra });
  assert.deepEqual(a, b, 'the allowance is the one with no date');
  assert.equal(a.decks.build.paused, false); assert.equal(a.pace, null);
  // inside the window: exam mode, side decks pause
  const w = allowance({ c: context({ today: add(EXAM, -10), exam: EXAM }), settings: s60, decks, ...extra });
  assert.equal(w.mode, 'exam'); assert.equal(w.decks.build.paused, true);
});

test('the scheduler before the window: no cap and the no-date retention, the same record as with no date', () => {
  const rec0 = { S: 40, D: 4, reps: 5, lapses: 0, last: add(EXAM, -70), due: add(EXAM, -61), stage: 2, streak: 2, learn: null, hist: [] };
  const today = add(EXAM, -60);
  const far = FS.schedule(rec0, { g: 3, ms: 2000, onTime: true }, { ...context({ today, exam: EXAM }), forecast: () => 0 }, 1).rec;
  const none = FS.schedule(rec0, { g: 3, ms: 2000, onTime: true }, { ...context({ today, exam: null }), forecast: () => 0 }, 1).rec;
  assert.deepEqual(far, none);
  assert.ok(far.due > add(EXAM, -1), 'uncapped: due after the exam');
  assert.equal(far.stage, 3, 'stage may reach 3, as without a date');
  // the same answer inside the window is capped
  const near = FS.schedule({ ...rec0, last: add(EXAM, -20), due: add(EXAM, -11) }, { g: 3, ms: 2000, onTime: true }, { ...context({ today: add(EXAM, -10), exam: EXAM }), forecast: () => 0 }, 1).rec;
  assert.ok(near.due <= add(EXAM, -1) || FS.R(10, near.S) >= 0.95);
});

test('B1 in its window: allowance, mode and the scheduler are what they were before the window existed', () => {
  const B1 = '2026-10-13';
  for (let n = 0; n <= 14; n++) {
    const today = add(B1, -n), now = context({ today, exam: B1 }), was = context({ today, exam: B1, examWindow: Infinity });
    assert.equal(mode(now), mode(was));
    for (const settings of [s60, { ...s60, minutesPerDay: 30 }]) {
      assert.deepEqual(allowance({ c: now, settings, decks, priorityLeft: 120, focus: true }), allowance({ c: was, settings, decks, priorityLeft: 120, focus: true }), `exam − ${n}`);
    }
    const rec = { S: 12, D: 5, reps: 3, lapses: 0, last: add(today, -6), due: today, stage: 1, streak: 0, learn: null, hist: [] };
    assert.deepEqual(FS.schedule(rec, { g: 3, ms: 3000, onTime: true }, { ...now, forecast: () => 0 }, 1), FS.schedule(rec, { g: 3, ms: 3000, onTime: true }, { ...was, forecast: () => 0 }, 1));
  }
});

/* ---------- the recap when the window opens ---------- */

test('windowStep: a date seen outside its window recaps once when time brings the window; a moved date never does', () => {
  const at = (/** @type {number} */ n, exam = EXAM) => context({ today: add(EXAM, -n), exam });
  let st = windowStep(null, at(60));
  assert.equal(st.recap, false); assert.deepEqual(st.next, { exam: EXAM, outside: true, recapped: {} });
  const k = st.next;
  st = windowStep(k, at(30)); assert.equal(st.next, k, 'nothing to write while outside');
  st = windowStep(k, at(14)); assert.equal(st.recap, true, 'the window opens');
  st.next.recapped[EXAM] = { on: add(EXAM, -14), moved: 3 };
  const after = st.next;
  assert.equal(windowStep(after, at(14)).recap, false); assert.equal(windowStep(after, at(10)).next, after, 'once');
  // the device clock goes back and forward: still once
  const back = windowStep(after, at(20)).next; assert.equal(back.outside, true);
  assert.equal(windowStep(back, at(12)).recap, false);
  // first sight of a date already inside its window (set, moved there, or the first start of this build): no recap
  assert.equal(windowStep(null, at(8)).recap, false);
  assert.deepEqual(windowStep(null, at(8)).next, { exam: EXAM, outside: false, recapped: {} });
  // moved from far straight into the window: no recap (the read-time cap covers it, as before)
  const moved = windowStep(k, context({ today: add(EXAM, -60), exam: add(EXAM, -50) }));
  assert.equal(moved.recap, false); assert.equal(moved.next.outside, false);
  // removed
  const gone = windowStep(k, context({ today: add(EXAM, -60), exam: null }));
  assert.equal(gone.recap, false); assert.equal(gone.next.exam, null);
  // no date and no record: nothing written
  assert.equal(windowStep(null, context({ today: EXAM, exam: null })).next, null);
  // moved to a later date that is still far: that date's window recaps once more when it opens
  const later = add(EXAM, 60);
  let m = windowStep(after, context({ today: add(EXAM, -5), exam: later })).next;
  assert.equal(m.outside, true); assert.ok(m.recapped[EXAM], 'kept while that date is ahead');
  assert.equal(windowStep(m, context({ today: add(later, -14), exam: later })).recap, true);
  // the window entered on the eve or the day: nothing left to pull in
  assert.equal(windowStep(k, at(0)).recap, false); assert.equal(windowStep(k, at(-1)).recap, false);
  assert.equal(windowStep(k, at(1)).recap, true, 'eve: recap runs (and finds nothing, the cap is today)');
});

/** A memory store with a putCards spy. @param {string} today */
async function fresh(today) {
  const adapter = createMemoryAdapter(), bus = createBus();
  const clock = { today: () => today };
  const store = await Store.open({ adapter, profile: { id: '0192a3b4-c5d6-7e8f-9a0b-000000000002', name: '', kind: 'local' }, device: { deviceId: 'dev1', seq: 0 }, clock, bus });
  /** @type {[string, [string, any][]][]} */ const puts = [];
  const put = store.putCards.bind(store);
  store.putCards = (/** @type {string} */ deck, /** @type {[string, any][]} */ entries) => { puts.push([deck, structuredClone(entries)]); put(deck, entries); };
  return { store, bus, clock, puts, hlc: createHlc('dev1') };
}

/** Cards scheduled before the window: a spread of stabilities, last reviewed 60 … 20 days before the exam. */
function farCards() {
  /** @type {Record<string, any>} */ const out = {};
  const S = [1, 4, 9, 20, 45, 90, 200, 400];
  for (let i = 0; i < 40; i++) {
    const last = add(EXAM, -(20 + (i * 7) % 41)), s = S[i % S.length];
    const rec = { S: s, D: 5, reps: 3, lapses: 0, last, first: add(last, -30), stage: 1, streak: 0, learn: null, relearn: false, hist: [] };
    out[`W:w${String(i).padStart(2, '0')}`] = { ...rec, due: FS.dueFor(s, { ...context({ today: last, exam: EXAM }), forecast: () => 0 }) };
  }
  out['W:new'] = { src: 'practice' };   // never answered
  out['W:learning'] = { S: 1, D: 5, reps: 1, last: add(EXAM, -16), due: add(EXAM, -16), learn: 1, hist: [] };
  out['W:marked'] = { S: 400, D: 3, reps: 1, last: add(EXAM, -30), due: add(EXAM, 90), known: { by: 'sort', on: add(EXAM, -30) }, hist: [] };
  return out;
}

test('examWindow: the reviews owed before the exam are written once at window entry, every other card untouched', async () => {
  const settings = normalizeSettings({ language: 'german', exam: { type: 'goethe-b2', date: EXAM } });
  const { store, puts } = await fresh(add(EXAM, -60));
  const cards = farCards();
  store.putCards('b1', Object.entries(cards));
  store.putCards('speak', [['SS:x-01', { ...cards['W:w05'] }], ['SS:x-02', { ...cards['W:w03'] }]]);
  store.putCards('script', [['SW:x', { ...cards['W:w05'] }]]);
  puts.length = 0;
  const before = structuredClone(store.cardsByDeck);

  // 60 and 20 days out: nothing written to cards, the record notes the date
  assert.equal(examWindow({ store, c: context({ today: add(EXAM, -60), exam: EXAM }), settings }), 0);
  assert.equal(examWindow({ store, c: context({ today: add(EXAM, -20), exam: EXAM }), settings }), 0);
  assert.equal(puts.length, 0);
  assert.deepEqual(store.get(WINDOW_KV), { exam: EXAM, outside: true, recapped: {} });

  // the window opens (the app was not opened on exam − 14 itself: exam − 13)
  const c = context({ today: add(EXAM, -13), exam: EXAM }), cap = add(EXAM, -1);
  const owed = (/** @type {any} */ rec) => rec && rec.reps && rec.due > cap && RD.dueOn(rec, c) !== rec.due && !(rec.known && !rec.known.checked);
  const want = Object.fromEntries(Object.entries(before).map(([d, cs]) => [d, Object.keys(cs).filter(id => owed(cs[id])).sort()]));
  assert.ok(want.b1.length >= 5, 'the fixture has cards that owe a review');
  assert.ok(Object.values(before.b1).some(r => r.reps && r.due > cap && !owed(r)), 'and cards that will still be recalled on the day');
  const n = examWindow({ store, c, settings });
  assert.equal(n, want.b1.length + want.speak.length);
  assert.deepEqual(puts.map(([d, e]) => [d, e.map(x => x[0])]), [['b1', want.b1], ['speak', want.speak]], 'script cards follow their delivery date, never the exam');
  for (const [deck, entries] of puts) for (const [id, rec] of entries) {
    assert.ok(rec.due >= add(cap, -2) && rec.due <= cap && rec.due > c.today, `${id} lands on exam−3 … exam−1`);
    assert.deepEqual({ ...rec, due: null }, { ...before[deck][id], due: null }, 'only due changes (u kept: a recap never wins over an answer)');
  }
  for (const [deck, cs] of Object.entries(before)) for (const [id, rec] of Object.entries(cs)) {
    if (!want[deck]?.includes(id)) assert.deepEqual(store.cards(deck)[id], rec, `${deck} ${id} untouched`);
  }
  // every card now has its review by exam − 1 or will be recalled on the day
  for (const rec of Object.values(store.cards('b1'))) if (rec.reps && rec.learn == null) assert.ok(rec.due <= cap || FS.R(diff(rec.last, EXAM), rec.S) >= 0.95 || (rec.known && !rec.known.checked));
  assert.deepEqual(store.get(WINDOW_KV).recapped, { [EXAM]: { on: c.today, moved: n } });

  // exactly once: later days in the window write nothing
  puts.length = 0;
  for (const d of [12, 10, 3, 2, 1]) examWindow({ store, c: context({ today: add(EXAM, -d), exam: EXAM }), settings });
  assert.equal(puts.length, 0);
  // and running the recap itself again would move nothing either (idempotent)
  assert.deepEqual(windowRecap({ b1: store.cards('b1'), speak: store.cards('speak') }, c), {});
});

test('setting, moving and removing the date never write a card, nor does the next Today', async () => {
  const today = add(EXAM, -60);
  const { store, bus, clock, puts, hlc } = await fresh(today);
  const app = { store, hlc, bus, clock };
  setCourse(app, 'de', { lang: 'de', level: 'B2', goal: { exam: 'goethe-b2', date: null } });
  setExamDate(app, null);
  store.putCards('b1', Object.entries(farCards()));
  puts.length = 0;
  const before = structuredClone(store.cardsByDeck);
  const step = () => { const s = normalizeSettings(store.get('settings')); examWindow({ store, c: context({ today, exam: s.exam.date }), settings: s }); };
  for (const d of [EXAM, add(EXAM, -50), add(today, 10), add(today, 5), EXAM, add(today, 9), null, add(today, 1), null]) {
    assert.equal(setExamDate(app, d).ok, true, String(d));
    step();
  }
  assert.equal(puts.length, 0, 'no putCards');
  assert.deepEqual(store.cardsByDeck, before);
});

test('a date moved into the window keeps the read-time cap: due counts as before, nothing written', async () => {
  const today = add(EXAM, -60), near = add(today, 9);
  const rec = { S: 20, D: 5, reps: 3, lapses: 0, last: add(today, -5), due: add(today, 30), learn: null, hist: [] };
  const c = context({ today, exam: near });
  // dueOn caps on read, as it always has for a date moved earlier; windowStep saw this date first inside its window
  assert.ok(FS.R(diff(rec.last, near), rec.S) < 0.95);
  assert.ok(RD.dueOn(rec, c) <= add(near, -1) && RD.dueOn(rec, c) > today, 'the pre-exam review is there on read');
  assert.equal(RD.dueOn(rec, context({ today, exam: EXAM })), rec.due, 'the far date: its own due date');
  assert.equal(windowStep({ exam: EXAM, outside: true, recapped: {} }, c).recap, false);
});

test('windowDecks: the course decks without script; namespaced decks of the course language', () => {
  assert.deepEqual(windowDecks(['b1', 'script', 'fr:core', 'de:read', 'de:script'], 'de'), ['b1', 'speak', 'clusters', 'build', 'de:read']);
  assert.deepEqual(windowDecks(['b1', 'fr:core', 'fr:script', 'de:read'], 'fr'), ['fr:core']);
  assert.deepEqual(windowDecks([], null), ['b1', 'speak', 'clusters', 'build']);
});

/* ---------- Today's setup rows ---------- */

test('"Set an exam date": only for an exam goal with no date; never for a far date or with no exam goal', () => {
  const t = (/** @type {string} */ k) => k;
  const manifest = { exams: [{ id: 'goethe-b1', language: 'german' }] };
  const ids = (/** @type {any} */ s, /** @type {any} */ c) => setupRows(s, c, manifest, t).map(r => r.id);
  const de = (/** @type {any} */ exam) => ({ language: 'german', exam });
  assert.deepEqual(ids(de({ type: 'goethe-b1' }), context({ today: '2027-01-10', exam: null })), ['today.setDate']);
  assert.deepEqual(ids(de({ type: 'goethe-b2' }), context({ today: '2027-01-10', exam: null })), ['today.setDate'], 'a date-only goal asks for its date');
  assert.deepEqual(ids(de({ type: 'goethe-b2' }), context({ today: add(EXAM, -60), exam: EXAM })), [], 'a far date: no nag');
  assert.deepEqual(ids(de({ type: 'goethe-b1' }), context({ today: add(EXAM, -200), exam: EXAM })), []);
  assert.deepEqual(ids(de({ type: null }), context({ today: '2027-01-10', exam: null })), [], 'maintenance with no exam goal: no nag');
  assert.deepEqual(ids(de({ type: 'goethe-b1' }), context({ today: add(EXAM, -5), exam: EXAM })), []);
  assert.deepEqual(ids(de({ type: 'goethe-b1' }), context({ today: add(EXAM, 3), exam: EXAM })), ['today.nextExam']);
  assert.deepEqual(ids({ language: 'french', exam: { type: null } }, context({ today: '2027-01-10', exam: null })), []);
});

/* ---------- a date-only exam goal (S9) ---------- */

test('a date-only goal (goethe-b2, no definition): countdown and window work; no mocks, no module focus, no half day for a mock', () => {
  const b2 = { ...s60, exam: { type: 'goethe-b2', modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] } };
  assert.equal(hasMockExam(b2), false); assert.equal(hasMockExam(s60), true);
  assert.equal(hasMockExam({ exam: { type: 'other' } }), false); assert.equal(hasMockExam({ exam: { type: null } }), false);
  // the clock knows only the date: countdown and window as for B1
  const c = context({ today: add(EXAM, -10), exam: EXAM });
  assert.equal(c.phase, 'week'); assert.equal(c.daysLeft, 10);
  assert.equal(context({ today: add(EXAM, -40), exam: EXAM }).phase, 'none');
  // inside the window: exam mode (side decks pause), but the whole day is for study, with no Schreiben focus
  const store = { get: (/** @type {string} */ _k, /** @type {any} */ f) => f, attempts: () => [] };
  assert.equal(writingFocus({ store, c, settings: b2 }), false);
  assert.equal(writingFocus({ store, c, settings: s60 }), true, 'B1 with no Schreiben score: focus as before');
  const heavy = { b1: { due: 60, open: 500 }, writing: { due: 5, open: 40 }, speak: { due: 10, open: 50 } };
  const x = allowance({ c, settings: b2, decks: heavy, priorityLeft: 300 }), y = allowance({ c, settings: s60, decks: heavy, priorityLeft: 300 });
  assert.equal(x.mode, 'exam');
  assert.ok(x.newPerDay > y.newPerDay, 'no half day kept for a mock that does not exist');
});
