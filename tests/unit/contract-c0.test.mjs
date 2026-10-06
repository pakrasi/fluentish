// The round 4 contract commit (C0): the shared seams five lanes build on, each behaviour-neutral today. Settings keep
// fields they do not know; the 'read' allowance deck exists and counts nothing new; the day plan is a Normal day;
// knowledge takes evidence by origin; claude.js passes a structured-output format through. All data synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { migrateCourses } from '../../src/data/session.js';
import { Store } from '../../src/data/store.js';
import { createHlc } from '../../src/data/ids.js';
import * as S from '../../src/data/settings.js';
import { validate } from '../../src/core/schema.js';
import { allowanceDeck } from '../../src/domain/decks.js';
import { allowance, DECKS, SIDE, REVIEW_COST, NEW_COST, ROUND_MIN, ROUND, NEW_ITEM_MIN } from '../../src/domain/budget.js';
import { todayBudget, dueTomorrow } from '../../src/domain/allowance.js';
import { dayPlan, isWeek, DAY_KINDS } from '../../src/domain/week.js';
import { TAGS, tagOf, origin, ORIGINS } from '../../src/domain/itemids.js';
import { knowledge } from '../../src/domain/knowledge.js';
import { EVIDENCE_KV, evidenceOf } from '../../src/data/knowledge.js';
import { SOURCE_GROUPS } from '../../src/domain/atlas.js';
import { ask } from '../../src/services/claude.js';
import * as D8 from '../../src/domain/days.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = JSON.parse(readFileSync(path.join(ROOT, 'schemas/records/settings.schema.json'), 'utf8'));
const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000c0';
const DAY = '2026-10-20';
const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);
const clock = { today: () => DAY };
const card = (/** @type {string} */ due, reps = 2, last = D8.add(due, -3), first = last) => ({ S: 4.2, D: 5.1, due, reps, lapses: 0, last, first, stage: 1, streak: 0, learn: null, relearn: false, u: T0, hist: reps ? [[last, 3, 1200, 't', '']] : [] });
const MAINT = { today: DAY, exam: null, phase: 'none', daysLeft: null, lastNewDay: null, capDay: null, newItems: true, mocks: false };
const EXAM = { today: DAY, exam: '2026-10-28', phase: 'week', daysLeft: 8, lastNewDay: '2026-10-26', capDay: '2026-10-27', newItems: true, mocks: true };
const german = () => ({
  v: 1, language: 'german', level: 'B1', exam: { type: 'goethe-b1', date: null, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] },
  minutesPerDay: 60, newPerDay: null, practice: { readAloud: true }, onboarded: '2026-10-01T09:00:00.000+02:00', rev: {},
});
async function session() {
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev', seq: 0 }, clock });
  store.set('settings', german());
  let t = T0;
  const app = { store, hlc: createHlc('dev', () => (t += 1000)), bus: { emit: () => {} }, clock };
  migrateCourses(store);
  return { store, app };
}
/** A German store: a review round's worth due in b1, situations, clusters, a first study day a month ago. */
function germanCards(/** @type {any} */ store) {
  store.putCards('b1', [['K:ENG_CHUNK_0001', card('2026-10-18')], ['BP:termin', card('2026-10-19')], ['W:haus.n', card('2026-11-02')], ['G:dass.01', card('2026-10-20')]]);
  store.putCards('speak', [['SS:greet-01', card('2026-10-19')]]);
  store.putCards('clusters', [['W:tisch.n', card('2026-10-19')]]);
  store.set('activity', { '2026-09-15': { minutes: 30, rounds: 2 } });
}

/* ---------------- 1. settings: forward compatibility (B4) ---------------- */

const R = (/** @type {number} */ n) => `${String(1790000000000 + n).padStart(13, '0')}-0000-dev`;
/** A record a NEWER build wrote: the round 4 fields, plus fields no build knows yet, each with its rev. */
const fromNewer = () => {
  const s = S.normalizeSettings(german());
  const de = s.courses[0];
  de.goal = { ...de.goal, level: 'B2', by: '2027-06', someday: 'x' };
  de.week = { min: [45, 45, 20, 45, 30, 60, 0], kind: ['n', 'read', 'light', 'write', 'n', 'talk', 'off'] };
  de.future = { a: 1 };
  s.rev = { ...s.rev, 'courses.de.goal.level': R(1), 'courses.de.goal.by': R(1), 'courses.de.goal.someday': R(1), 'courses.de.week': R(1), 'courses.de.future': R(2), 'future.top': R(2) };
  s.future = { top: true };
  return s;
};

test('settings: a course keeps the fields this build does not know, through normalizeSettings and mergeSettings', () => {
  const newer = fromNewer();
  const n = S.normalizeSettings(newer);
  const de = n.courses[0];
  assert.deepEqual(de.goal, { exam: 'goethe-b1', date: null, level: 'B2', by: '2027-06', someday: 'x' });
  assert.deepEqual(de.week, newer.courses[0].week);
  assert.deepEqual(de.future, { a: 1 });
  assert.deepEqual(n.future, { top: true });
  assert.deepEqual(S.normalizeSettings(n), n, 'idempotent');
  // an older record merged with the newer one, both ways: nothing is dropped, the revs come along
  const old = S.normalizeSettings(german());
  for (const m of [S.mergeSettings(old, newer), S.mergeSettings(newer, old)]) {
    assert.deepEqual(m.courses[0].goal, de.goal);
    assert.deepEqual(m.courses[0].week, de.week);
    assert.deepEqual(m.courses[0].future, { a: 1 });
    assert.deepEqual(m.future, { top: true });
    assert.equal(m.rev['courses.de.future'], R(2));
  }
  // a later write of a known field on the older device keeps the unknown ones
  const later = { ...S.normalizeSettings(newer), rev: { ...newer.rev, 'courses.de.level': R(9) } };
  later.courses = later.courses.map((/** @type {any} */ c) => ({ ...c, level: 'B2' }));
  const m = S.mergeSettings(newer, later);
  assert.equal(m.courses[0].level, 'B2');
  assert.deepEqual(m.courses[0].future, { a: 1 });
});

test('settings: a record without the round 4 fields is exactly what it was (same keys, same order)', () => {
  const n = S.normalizeSettings(german());
  assert.deepEqual(Object.keys(n.courses[0]), ['id', 'lang', 'level', 'goal', 'decks']);
  assert.deepEqual(Object.keys(n.courses[0].goal), ['exam', 'date']);
  assert.deepEqual(validate(SCHEMA, n), []);
});

test('settings: setCourse writes goal.level, goal.by and week, checks them, and the schema takes them', async () => {
  const { store, app } = await session();
  const changed = S.setCourse(app, 'de', { goal: { level: 'B2', by: '2027-06' }, week: { min: [45, 45, 20, 45, 30, 60, 0], kind: ['n', 'read', 'light', 'write', 'n', 'talk', 'off'] } });
  assert.deepEqual(changed.sort(), ['courses.de.goal.by', 'courses.de.goal.level', 'courses.de.week']);
  const s = store.get('settings');
  assert.equal(s.courses[0].goal.level, 'B2');
  assert.deepEqual(validate(SCHEMA, s), []);
  assert.throws(() => S.setCourse(app, 'de', { 'goal.level': 'C3' }), /bad level/);
  assert.throws(() => S.setCourse(app, 'de', { 'goal.by': '2027-13' }), /bad month/);
  assert.throws(() => S.setCourse(app, 'de', { week: { min: [1, 2, 3], kind: [] } }), /bad week/);
  assert.throws(() => S.setCourse(app, 'de', { dates: [] }), /unknown field dates/);
  S.setCourse(app, 'de', { week: null, 'goal.level': null });
  assert.equal(store.get('settings').courses[0].week, null);
  assert.deepEqual(validate(SCHEMA, store.get('settings')), []);
  // the other round 4 settings fields validate
  assert.deepEqual(validate(SCHEMA, { ...store.get('settings'), practice: { readAloud: true, readNew: 6, readMin: 10 },
    conversation: { interests: ['Musik'], perWeek: 2, readAloud: true, showRecasts: true, input: 'typing', backupDefault: false, keepDays: 30, monthlyCapUsd: 3 },
    connections: { hours: { repo: 'someone/some-repo', path: 'data/hours.json', lang: 'de' } } }), []);
  assert.ok(validate(SCHEMA, { ...store.get('settings'), connections: { hours: { repo: 'no slash', path: 'x' } } }).length);
});

/* ---------------- 2. the read allowance deck (B1, B2) ---------------- */

test('decks: <lang>:read counts in the read allowance deck, a side deck that costs like a round card', () => {
  assert.equal(allowanceDeck('de:read'), 'read');
  assert.equal(allowanceDeck('fr:read'), 'read');
  assert.equal(allowanceDeck('fr:core'), 'b1');
  assert.ok(DECKS.includes('read') && SIDE.includes('read'));
  assert.equal(REVIEW_COST.read, ROUND_MIN / ROUND);
  assert.equal(NEW_COST.read, NEW_ITEM_MIN);
  const settings = S.normalizeSettings(german());
  const without = allowance({ c: MAINT, settings, decks: { b1: { due: 10, open: 50 } } });
  const withRead = allowance({ c: MAINT, settings, decks: { b1: { due: 10, open: 50 }, read: { due: 0, open: 40, shown: 0 } } });
  assert.deepEqual(without.decks.read, { want: 0, newPerDay: 0, newLeft: 0, shown: 0, due: 0, rounds: 0, minutes: 0, paused: false });
  // L1b: in maintenance the read deck wants practice.readNew (6 by default) of its open items, shared like the others
  assert.equal(withRead.decks.read.want, 6);
  // hotfix: the day's number is the sustainable rate, which the decks share by their wants (read 3 of its 6)
  assert.equal(withRead.decks.read.newPerDay, 3);
  assert.equal(withRead.newPerDay, withRead.decks.b1.newPerDay + 3);
  assert.equal(allowance({ c: MAINT, settings: { ...settings, practice: { ...settings.practice, readNew: 2 } }, decks: { b1: { due: 10, open: 50 }, read: { open: 40 } } }).decks.read.want, 2);
  assert.equal(allowance({ c: EXAM, settings, decks: { b1: { due: 10, open: 50 }, read: { open: 40 } } }).decks.read.newPerDay, 0, 'none in exam week');
  const due = allowance({ c: MAINT, settings, decks: { b1: { due: 10, open: 50 }, read: { due: 6, open: 40 } } });
  assert.equal(due.reviews.due, 16, 'its reviews are counted, never hidden');
  assert.equal(due.decks.read.due, 6);
  assert.equal(allowance({ c: EXAM, settings, decks: {} }).decks.read.paused, true, 'paused in exam week like the other side decks');
});

test('decks: a German store with a de:read card gives the same b1 numbers as before (todayBudget reads deck b1)', async () => {
  const a = await session(), b = await session();
  germanCards(a.store); germanCards(b.store);
  // a reading card answered last week, not due today
  b.store.putCards('de:read', [['RW:nachhaltig', card('2026-10-25', 2, '2026-10-13', '2026-10-13')]]);
  const settings = S.normalizeSettings(a.store.get('settings'));
  const x = todayBudget({ store: a.store, c: MAINT, settings }), y = todayBudget({ store: b.store, c: MAINT, settings });
  assert.deepEqual(y, x, 'every number the same');
  // due today: it counts in read only; b1's due, rounds and next round are untouched
  b.store.putCards('de:read', [['RW:nachhaltig', card('2026-10-19', 2, '2026-10-13', '2026-10-13')]]);
  const z = todayBudget({ store: b.store, c: MAINT, settings });
  assert.deepEqual([z.due, z.rounds, z.next, z.b1.due], [x.due, x.rounds, x.next, x.b1.due]);
  assert.equal(z.decks.read.due, 1);
  assert.equal(z.reviews.due, x.reviews.due + 1);
  assert.equal(dueTomorrow({ store: b.store, c: MAINT, settings }), dueTomorrow({ store: a.store, c: MAINT, settings }) + 1);
  // a German store with only a reading card has never had a b1 round: its first round is still the first-ever one
  const c = await session();
  c.store.putCards('de:read', [['RW:nachhaltig', card('2026-10-19', 2, '2026-10-13', '2026-10-13')]]);
  const d = await session();
  assert.equal(todayBudget({ store: c.store, c: MAINT, settings }).next, todayBudget({ store: d.store, c: MAINT, settings }).next);
});

/* ---------------- 3. the day plan (C0 stub; the week itself since L1b, tests/unit/week-allowance.test.mjs) ---------------- */

test('day plan: without a week, a Normal day of minutesPerDay with no slot; a plan not from a week gives the same numbers', () => {
  const s = S.normalizeSettings(german());
  assert.deepEqual(dayPlan(s, MAINT), { kind: 'n', minutes: 60, slot: null, slotMin: 0, planned: false });
  assert.deepEqual(dayPlan({ ...s, minutesPerDay: 25 }, MAINT).minutes, 25);
  const withWeek = { ...s, courses: s.courses.map((/** @type {any} */ c) => ({ ...c, week: { min: [0, 0, 0, 0, 0, 0, 0], kind: ['off', 'off', 'off', 'off', 'off', 'off', 'off'] } })) };
  assert.deepEqual(dayPlan(withWeek, MAINT), { kind: 'off', minutes: 0, slot: null, slotMin: 0, planned: true }, 'L1b: the week is read');
  assert.deepEqual(DAY_KINDS, ['n', 'light', 'read', 'write', 'talk', 'off']);
  assert.ok(isWeek({ min: [0, 0, 0, 0, 0, 0, 240], kind: ['off', 'off', 'off', 'off', 'off', 'off', 'n'] }));
  assert.ok(!isWeek({ min: [0, 0, 0, 0, 0, 0, 241], kind: ['off', 'off', 'off', 'off', 'off', 'off', 'n'] }));
  assert.ok(!isWeek({ min: [0, 0, 0, 0, 0, 0, 0], kind: ['off', 'off', 'off', 'off', 'off', 'off', 'normal'] }));
  const decks = { b1: { due: 30, open: 80 }, speak: { due: 3, open: 10 }, script: { due: 2, open: 8 } };
  assert.deepEqual(allowance({ c: MAINT, settings: s, decks, day: { kind: 'off', minutes: 0, slot: null, slotMin: 0 } }), allowance({ c: MAINT, settings: s, decks }));
});

/* ---------------- 4. knowledge: RW/RP, origin read, evidence ---------------- */

test('knowledge: RW and RP are item tags; a card in a read deck comes from reading', () => {
  assert.deepEqual(TAGS.RW, { kind: 'word', area: 'words' });
  assert.deepEqual(TAGS.RP, { kind: 'phrase', area: 'speaking' });
  assert.equal(tagOf('RW:nachhaltig'), 'RW');
  assert.equal(origin('RW:nachhaltig', 'read'), 'read');
  assert.equal(origin('W:haus.n', 'read'), 'read');
  assert.equal(origin('W:haus.n', 'clusters'), 'practice', 'other decks as before');
  assert.ok(ORIGINS.includes('read') && ORIGINS.includes('conversation'));
  for (const o of ['read', 'conversation']) assert.ok(SOURCE_GROUPS.includes(o));
  const k = knowledge({ today: DAY, decks: { 'de:read': { 'W:haus.n': card('2026-10-25', 2, '2026-10-13') } } });
  assert.deepEqual(k.get('W:haus.n').sources, ['read']);
});

test('knowledge: evidence by origin; seen is evidence.lookup, with the same result', () => {
  const decks = { b1: { 'W:haus.n': card('2026-10-25') } };
  const seen = { 'W:tisch.n': { first: '2026-10-01', last: '2026-10-02', n: 2 }, 'W:haus.n': { first: '2026-10-01', last: '2026-10-01', n: 1 } };
  const a = knowledge({ today: DAY, decks, seen });
  const b = knowledge({ today: DAY, decks, evidence: { lookup: seen } });
  assert.deepEqual([...b.items.entries()], [...a.items.entries()]);
  const c = knowledge({ today: DAY, decks, seen, evidence: { conversation: { 'W:tisch.n': { first: DAY, last: DAY, n: 1 } }, read: { 'W:baum.n': { n: 0 } } } });
  assert.deepEqual(c.get('W:tisch.n').sources, ['conversation', 'lookup']);
  assert.equal(c.get('W:tisch.n').state, 'unknown', 'evidence never makes an item known');
  assert.equal(c.get('W:baum.n').state, 'unseen', 'an entry without n or last is not evidence');
  assert.deepEqual(EVIDENCE_KV, { lookup: 'lookup.seen', read: 'read.words', conversation: 'conv.used' });
  const kv = { 'lookup.seen': seen };
  assert.deepEqual(evidenceOf({ get: (/** @type {string} */ n, /** @type {any} */ d) => kv[n] ?? d }), { lookup: seen, read: {}, conversation: {} });
});

/* ---------------- 6. claude.js: structured output ---------------- */

test('ask: format goes to output_config.format beside effort; without it the request is as before', async () => {
  /** @type {any} */ let body = null;
  const f = /** @type {any} */ (async (/** @type {string} */ _u, /** @type {any} */ init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] }), { status: 200 }); });
  await ask({ key: 'k', user: 'u', fetch: f });
  assert.deepEqual(body.output_config, { effort: 'medium' });
  const format = { type: /** @type {const} */ ('json_schema'), schema: { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false } };
  const r = await ask({ key: 'k', user: 'u', format, fetch: f });
  assert.deepEqual(body.output_config, { effort: 'medium', format });
  assert.equal(r.text, '{"a":1}');
  await ask({ key: 'k', user: 'u', effort: null, fallback: false, format, fetch: f });
  assert.deepEqual(body.output_config, { format }, 'the small model: format without effort');
});
