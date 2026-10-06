// Courses and deck namespacing (round 3, wave C, Arch #11-12): settings.courses with activeCourse, the idempotent
// migration that derives course 'de' from a profile made before courses, the mirror of the old fields with one writer
// (setCourse), per-field revs merged across devices, the clock reading the active course's date, the backup snapshot
// round trip, and the proof that no card is re-keyed: a full-store diff before and after the migration. All synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { openSession, migrateCourses } from '../../src/data/session.js';
import { Store } from '../../src/data/store.js';
import { createHlc } from '../../src/data/ids.js';
import { createClock } from '../../src/core/clock.js';
import { validate } from '../../src/core/schema.js';
import * as S from '../../src/data/settings.js';
import { LEGACY_DECK_LANG, LEGACY_DECKS, deckId, deckLang, deckName, decksOf, courseLang } from '../../src/domain/decks.js';
import { knowledgeDecks, DECKS } from '../../src/data/knowledge.js';
import { dayAllowance, dueTomorrow, firstWeek } from '../../src/domain/allowance.js';
import { snapshotOf, SNAPSHOT_SCHEMA } from '../../src/data/sync/backup.js';
import { planRestore, applyRestore } from '../../src/data/restore.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schema = name => JSON.parse(readFileSync(path.join(ROOT, 'schemas/records', `${name}.schema.json`), 'utf8'));
const SETTINGS_SCHEMA = schema('settings');
const EVENT_SCHEMA = schema('event');
const valid = (sch, v) => { const errs = validate(sch, v); assert.deepEqual(errs, [], JSON.stringify(errs)); };

const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000d1';
const DAY = '2026-10-05';
const T0 = Date.UTC(2026, 9, 5, 8, 0, 0);
const M = '1759500000000-0000-mac';    // the legacy import's stamp
const T1 = '1759600000000-0000-iph';   // a later exam-date change
const clock = { today: () => DAY };
const CTX = { exam: '2026-10-09', phase: 'week', tz: 'UTC' };

/** Settings as a profile made before courses holds them (the legacy import, then a date change on the phone). */
const preCourse = () => ({
  v: 1, language: 'german', level: 'B1', exam: { type: 'goethe-b1', date: '2026-10-09', modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] },
  minutesPerDay: 60, newPerDay: null, practice: { readAloud: true, claudeCheck: false, simpleInput: false }, onboarded: '2026-10-01T09:00:00.000+02:00',
  rev: { language: M, level: M, 'exam.type': M, 'exam.date': T1, onboarded: M, minutesPerDay: T1 },
});

const card = (day, reps, u) => ({ S: 4.2, D: 5.1, due: day, reps, lapses: 0, last: day, first: day, stage: 1, streak: 0, learn: null, relearn: false, u, hist: [[day, 3, 1200, 't', '']] });

/** A synthetic pre-migration IndexedDB: the profile, its settings from before courses, cards in every legacy deck
   (ids of every kind the app writes), an attempt and events. */
async function preMigrationAdapter() {
  const adapter = createMemoryAdapter();
  const device = { deviceId: 'iph', activeProfile: PID, seq: 3, createdAt: '2026-10-01T09:00:00.000+02:00' };
  await adapter.putDevice(device);
  await adapter.putProfile({ id: PID, name: '', kind: 'local', createdAt: '2026-10-01T09:00:00.000+02:00', remoteId: null });
  await adapter.putKV(PID, 'settings', preCourse());
  await adapter.putKV(PID, 'activity', { '2026-10-04': { minutes: 40, rounds: 2 } });
  await adapter.putKV(PID, 'mistakes', { 'F:a1-1': { id: 'F:a1-1', v: 1, wrong: 'ich habe gegangen', right: 'ich bin gegangen', rule: 'sein', source: { attemptId: 'a1' }, createdAt: '2026-10-04T08:00:00Z', deletedAt: null } });
  const decks = {
    b1: ['BP:sich-beschweren', 'BL:wegen-plus-gen', 'BG:weil-verb-ende', 'BT:urlaub', 'BR:termin', 'BS:a1-dank', 'K:ENG_CHUNK_0001', 'G:dass-1', 'W:haus.n', 'BW:migriert', 'F:a1-1'],
    speak: ['SS:greet-01'], script: ['SW:rahmen', 'SR:bike01-1'], clusters: ['W:gut.adj', 'CO:gut~schlecht', 'CF:arbeit.n', 'CP:gap-7'], build: ['PX:ab.see', 'PD:abfahren', 'PV:anrufen', 'PS:f1.pres', 'SX:ung', 'PW:freiheit'],
  };
  let u = T0 - 9e8;
  for (const [deck, ids] of Object.entries(decks)) await adapter.putCards(PID, deck, ids.map(id => [id, card('2026-10-04', 2, (u += 1000))]));
  await adapter.putAttempts(PID, [{ id: '0192a3b4-c5d6-7e8f-9a0b-0000000000a1', day: 3, module: 'lesen', started_at: '2026-10-04T08:00:00Z', score: 21, max_score: 30, responses: {}, synced: false }]);
  const ev = (n, type, payload) => ({ id: `0192a3b4-c5d6-7e8f-9a0b-0000000000e${n}`, v: 1, profileId: PID, deviceId: 'iph', seq: n, at: '2026-10-04T10:00:0' + n + '.000+02:00', day: '2026-10-04', type, payload, synced: false, path: null });
  await adapter.putEvents(PID, [
    ev(1, 'card.reviewed', { deck: 'b1', itemId: 'BP:sich-beschweren', g: 3, ms: 1200, flags: '', mode: 't', ctx: CTX, base: { u: null, reps: 0 }, post: card('2026-10-04', 1, T0 - 9e8) }),
    ev(2, 'settings.changed', { key: 'exam.date', value: '2026-10-09', rev: T1 }),
    ev(3, 'exam.attempt', { attemptId: '0192a3b4-c5d6-7e8f-9a0b-0000000000a1' }),
  ]);
  return adapter;
}

/** Everything the adapter holds, keyed as IndexedDB keys it ([profileId, deck, itemId] for cards). */
async function dump(adapter) {
  const p = await adapter.loadProfile(PID);
  const cards = {};
  for (const [deck, recs] of Object.entries(p.cards)) for (const [id, rec] of Object.entries(recs)) cards[JSON.stringify([PID, deck, id])] = rec;
  return {
    device: await adapter.getDevice(), profiles: await adapter.listProfiles(), cards,
    attempts: p.attempts, outbox: p.outbox, archive: await adapter.loadArchive(PID),
    kv: await adapter.loadScope(PID), deviceKv: await adapter.loadScope('device'),
  };
}

/* ---------------- decks ---------------- */

test('deck namespace: legacy decks are German through a fixed table; new decks are <lang>:<name>', () => {
  assert.deepEqual({ ...LEGACY_DECK_LANG }, { b1: 'de', speak: 'de', script: 'de', clusters: 'de', build: 'de' });
  assert.ok(Object.isFrozen(LEGACY_DECK_LANG));
  assert.deepEqual([...LEGACY_DECKS], DECKS, 'knowledge reads the same decks in the same order as before');
  for (const d of LEGACY_DECKS) { assert.equal(deckLang(d), 'de'); assert.equal(deckName(d), d); }
  assert.equal(deckId('fr', 'core'), 'fr:core');
  assert.equal(deckLang('fr:core'), 'fr');
  assert.equal(deckName('fr:core'), 'core');
  assert.equal(deckLang('mystery'), null);
  assert.throws(() => deckId('French', 'core'));
  assert.throws(() => deckId('fr', 'Core deck'));
  assert.deepEqual(decksOf(['b1', 'speak', 'fr:core'], { lang: 'fr' }), ['fr:core']);
  assert.deepEqual(decksOf(['b1', 'speak', 'fr:core'], { lang: 'de' }), ['b1', 'speak']);
  assert.deepEqual(decksOf(['b1', 'speak'], null), ['b1', 'speak'], 'no course: every deck, as before courses');
});

/* ---------------- the migration ---------------- */

test('migration: course de from language, level and exam, with the revs those fields had; the old fields unchanged', () => {
  const pre = preCourse();
  const n = S.normalizeSettings(pre);
  assert.deepEqual(n.courses, [{ id: 'de', lang: 'de', level: 'B1', goal: { exam: 'goethe-b1', date: '2026-10-09' }, decks: ['b1', 'speak', 'script', 'clusters', 'build'] }]);
  assert.equal(n.activeCourse, 'de');
  assert.equal(n.rev['courses.de.lang'], M);
  assert.equal(n.rev['courses.de.level'], M);
  assert.equal(n.rev['courses.de.goal.exam'], M);
  assert.equal(n.rev['courses.de.goal.date'], T1, 'each course field keeps the rev of the field it came from');
  assert.equal(n.rev.activeCourse, M);
  assert.equal(n.rev['courses.de.decks'], undefined, 'no new stamp: every device derives the same record');
  // the mirror: every field from before courses is byte-identical, revs included
  for (const k of Object.keys(pre)) if (k !== 'rev') assert.deepEqual(n[k], pre[k], k);
  for (const [k, v] of Object.entries(pre.rev)) assert.equal(n.rev[k], v, `rev ${k}`);
  // idempotent
  assert.deepEqual(S.normalizeSettings(n), n);
  assert.deepEqual(S.normalizeSettings(S.normalizeSettings(n)), n);
  valid(SETTINGS_SCHEMA, n);
  // a profile before onboarding has no course; a missing record is the defaults
  assert.deepEqual(S.normalizeSettings({ v: 1, language: null, level: null, exam: { type: null, date: null, modules: [] }, minutesPerDay: 60 }).courses, []);
  assert.equal(S.normalizeSettings(null).activeCourse, null);
});

test('migration on a pre-migration store: only settings change; no card, attempt or event is re-keyed or touched', async () => {
  const adapter = await preMigrationAdapter();
  const before = await dump(adapter);
  const s1 = await openSession({ adapter, legacyStorage: null, clock, now: () => new Date(T0) });
  await s1.store.flush();
  const after = await dump(adapter);
  // the full store diff
  assert.deepEqual(Object.keys(after.cards).sort(), Object.keys(before.cards).sort(), 'the same IDB keys [profileId, deck, itemId]');
  assert.deepEqual(after.cards, before.cards, 'every card record byte-identical');
  assert.equal(Object.keys(after.cards).length, 24);
  assert.deepEqual(after.attempts, before.attempts);
  assert.deepEqual(after.outbox, before.outbox, 'no event written or changed (the migration stamps nothing new)');
  assert.deepEqual(after.archive, before.archive);
  assert.deepEqual(after.profiles, before.profiles);
  assert.deepEqual(after.device, before.device);
  assert.deepEqual(after.deviceKv, before.deviceKv);
  const changed = Object.keys({ ...before.kv, ...after.kv }).filter(k => JSON.stringify(before.kv[k]) !== JSON.stringify(after.kv[k]));
  assert.deepEqual(changed, ['settings'], 'settings is the only record the migration writes');
  const st = after.kv.settings;
  assert.deepEqual(st.courses.map(c => c.id), ['de']);
  for (const k of Object.keys(before.kv.settings)) if (k !== 'rev') assert.deepEqual(st[k], before.kv.settings[k], `mirror ${k}`);
  for (const [k, v] of Object.entries(before.kv.settings.rev)) assert.equal(st.rev[k], v, `rev ${k}`);
  // idempotent: a second start writes nothing
  const s2 = await openSession({ adapter, legacyStorage: null, clock, now: () => new Date(T0) });
  assert.equal(migrateCourses(s2.store), false);
  await s2.store.flush();
  assert.deepEqual(await dump(adapter), after, 'a second boot changes nothing');
});

test('every card id in the ledger keeps its deck and its language: the legacy decks are never renamed', async () => {
  const ledger = readFileSync(path.join(ROOT, 'tests/fixtures/shipped-ids.txt'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  assert.ok(ledger.length > 1000, 'the shipped-ids ledger is read');
  // every shipped id lives in a legacy deck, which maps to German and keeps its name: card keys stay [p, deck, id]
  for (const d of LEGACY_DECKS) { assert.equal(deckName(d), d); assert.equal(deckLang(d), 'de'); }
  const adapter = await preMigrationAdapter();
  const sample = ledger.filter((_, i) => i % 97 === 0).slice(0, 40);
  await adapter.putCards(PID, 'b1', sample.map(id => [id, card('2026-10-04', 1, T0)]));
  const before = await dump(adapter);
  const s = await openSession({ adapter, legacyStorage: null, clock, now: () => new Date(T0) });
  await s.store.flush();
  const after = await dump(adapter);
  for (const id of sample) assert.deepEqual(after.cards[JSON.stringify([PID, 'b1', id])], before.cards[JSON.stringify([PID, 'b1', id])], id);
  assert.deepEqual(after.cards, before.cards);
});

test('events gain an additive lang from their deck; other events are as before', async () => {
  const adapter = await preMigrationAdapter();
  const { store } = await openSession({ adapter, legacyStorage: null, clock, now: () => new Date(T0) });
  const r = store.append('card.reviewed', { deck: 'speak', itemId: 'SS:greet-01', g: 3, ms: 900, flags: '', mode: 's', ctx: CTX, base: { u: null, reps: 0 }, post: card(DAY, 1, T0) });
  assert.equal(r.lang, 'de');
  valid(EVENT_SCHEMA, r);
  const k = store.append('card.marked_known', { deck: 'fr:core', by: 'self', items: [], ctx: CTX });
  assert.equal(k.lang, 'fr');
  const a = store.append('exam.attempt', { attemptId: 'x' });
  assert.equal('lang' in a, false, 'an event with no deck has no lang');
  // the event's other fields are exactly what they were: lang is only added
  assert.deepEqual(Object.keys(r), ['id', 'v', 'profileId', 'deviceId', 'seq', 'at', 'day', 'type', 'payload', 'synced', 'path', 'lang']);
});

/* ---------------- one writer, the mirror, the clock ---------------- */

async function session(settings = preCourse()) {
  const adapter = createMemoryAdapter();
  const store = await Store.open({ adapter, profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'iph', seq: 0 }, clock });
  if (settings) store.set('settings', settings);
  let t = T0;
  const hlc = createHlc('iph', () => (t += 1000));
  const events = [];
  const bus = { emit: (n, x) => events.push([n, x]) };
  return { store, hlc, bus, events, clock, app: { store, hlc, bus, clock } };
}

test('setCourse is the one writer: the active course and its mirror get the same rev, one event each', async () => {
  const { store, app, events } = await session();
  migrateCourses(store);
  const r = S.setExamDate(app, '2026-10-16');
  assert.deepEqual(r, { ok: true, prev: '2026-10-09' });
  const s = store.get('settings');
  assert.equal(s.exam.date, '2026-10-16');
  assert.equal(s.courses[0].goal.date, '2026-10-16');
  assert.equal(s.rev['exam.date'], s.rev['courses.de.goal.date']);
  assert.ok(s.rev['exam.date'] > T1);
  const ev = store.pending().filter(e => e.type === 'settings.changed').map(e => e.payload.key);
  assert.deepEqual(ev, ['exam.date', 'courses.de.goal.date'], 'the old key first, as sync and older devices read it');
  assert.ok(events.some(([n, x]) => n === 'settings:changed' && x.key === 'exam.date'), 'listeners of exam.date hear it');
  valid(SETTINGS_SCHEMA, s);
  // setSetting on a mirrored path goes through the course
  S.setSetting(app, 'level', 'B2');
  assert.equal(store.get('settings').courses[0].level, 'B2');
  assert.equal(store.get('settings').level, 'B2');
  assert.equal(store.get('settings').rev.level, store.get('settings').rev['courses.de.level']);
  // a field that is not mirrored is written as before
  S.setSetting(app, 'minutesPerDay', 45);
  assert.equal(store.get('settings').minutesPerDay, 45);
  // a past date is refused, a bad one throws in the writer
  assert.equal(S.setExamDate(app, '2026-10-01').error, 'goal.date.past');
  assert.throws(() => S.setCourse(app, 'de', { 'goal.date': 'soon' }));
  assert.throws(() => S.setCourse(app, 'de', { colour: 'blue' }));
});

test('the clock reads the active course\'s goal.date; switching course switches it, and back', async () => {
  const { store, app } = await session();
  const clk = createClock({ exam: () => S.examDate(store.get('settings')), now: () => new Date(T0), forcedToday: DAY });
  assert.equal(clk.ctx().exam, '2026-10-09');
  assert.equal(clk.ctx().phase, 'week');
  S.setCourse(app, 'fr', { lang: 'fr', level: 'A2' });
  assert.equal(store.get('settings').activeCourse, 'de', 'adding a field to another course does not switch');
  assert.equal(clk.ctx().exam, '2026-10-09');
  S.setActiveCourse(app, 'fr');
  let s = store.get('settings');
  assert.equal(s.language, 'french');
  assert.equal(s.level, 'A2');
  assert.equal(s.exam.type, null);
  assert.equal(s.exam.date, null);
  assert.equal(clk.ctx().exam, null);
  assert.equal(clk.ctx().phase, 'none');
  assert.equal(s.courses.find(c => c.id === 'de').goal.date, '2026-10-09', 'German keeps its goal');
  S.setActiveCourse(app, 'de');
  s = store.get('settings');
  assert.equal(clk.ctx().exam, '2026-10-09');
  assert.deepEqual([s.language, s.level, s.exam.type, s.exam.date], ['german', 'B1', 'goethe-b1', '2026-10-09']);
  valid(SETTINGS_SCHEMA, s);
  assert.throws(() => S.setActiveCourse(app, 'xx'));
});

test('onboarding: addCourse makes the first course and the mirror; setSetting("language") does too', async () => {
  const a = await session(null);
  const id = S.addCourse(a.app, { lang: 'de', level: 'A2', goal: { exam: 'goethe-b1', date: '2026-11-20' } });
  assert.equal(id, 'de');
  let s = a.store.get('settings');
  assert.deepEqual([s.language, s.level, s.exam.type, s.exam.date, s.activeCourse], ['german', 'A2', 'goethe-b1', '2026-11-20', 'de']);
  assert.deepEqual(s.courses[0].decks, [...LEGACY_DECKS], 'a German course reads the decks from before courses');
  for (const f of S.BASE_FIELDS) assert.ok(s.rev[`courses.de.${f}`], `stamped: ${f}`);
  for (const f of S.OPTIONAL_FIELDS) assert.equal(s.rev[`courses.de.${f}`], undefined, `optional, not stamped: ${f}`);
  assert.ok(a.events.some(([, x]) => x.key === 'language'), 'main.js hears the language');
  valid(SETTINGS_SCHEMA, s);
  // the e2e fixture's way: field by field through setSetting
  const b = await session(null);
  S.setSetting(b.app, 'language', 'german');
  S.setSetting(b.app, 'level', 'B1');
  S.setSetting(b.app, 'exam.type', 'goethe-b1');
  S.setSetting(b.app, 'exam.date', '2026-10-09');
  s = b.store.get('settings');
  assert.deepEqual(s.courses, [{ id: 'de', lang: 'de', level: 'B1', goal: { exam: 'goethe-b1', date: '2026-10-09' }, decks: [...LEGACY_DECKS] }]);
  assert.equal(S.examDate(s), '2026-10-09');
  valid(SETTINGS_SCHEMA, s);
});

/* ---------------- merge across devices ---------------- */

test('cross-device merge: per field by HLC, courses united by id, the mirror follows the merged active course', async () => {
  const iph = await session();
  migrateCourses(iph.store);
  const mac = await session();
  migrateCourses(mac.store);
  let tm = T0 + 50_000;
  mac.app.hlc = createHlc('mac', () => (tm += 1000));
  // the phone moves the German exam; later the Mac adds French and switches to it
  S.setExamDate(iph.app, '2026-10-23');
  S.setCourse(mac.app, 'fr', { lang: 'fr', level: 'A1' });
  S.setActiveCourse(mac.app, 'fr');
  const a = S.mergeSettings(iph.store.get('settings'), mac.store.get('settings'));
  const b = S.mergeSettings(mac.store.get('settings'), iph.store.get('settings'));
  assert.deepEqual(a, b, 'order-independent');
  assert.equal(a.activeCourse, 'fr');
  assert.equal(a.language, 'french');
  assert.equal(a.exam.date, null, 'the mirror shows French');
  assert.equal(a.courses.find(c => c.id === 'de').goal.date, '2026-10-23', 'the phone\'s German date is kept');
  assert.deepEqual(S.mergeSettings(a, a), a, 'idempotent');
  valid(SETTINGS_SCHEMA, a);
  // an older device that knows only the old fields writes the exam date later: it lands in the active German course
  const old = { ...preCourse(), exam: { ...preCourse().exam, date: '2026-10-30' }, rev: { ...preCourse().rev, 'exam.date': '1799900000000-0000-old' } };
  const c = S.mergeSettings(iph.store.get('settings'), old);
  assert.equal(c.courses.find(x => x.id === 'de').goal.date, '2026-10-30');
  assert.equal(S.examDate(c), '2026-10-30');
  // and a stale old record changes nothing
  const stale = S.mergeSettings(iph.store.get('settings'), preCourse());
  assert.equal(S.examDate(stale), '2026-10-23');
});

test('restore merges a single settings.changed event of a course field (restore.js builds it with setPath)', () => {
  const cur = S.normalizeSettings(preCourse());
  const partial = { rev: { 'courses.de.goal.date': '1799999999999-0000-mac' }, courses: { de: { goal: { date: '2026-11-02' } } } };
  const m = S.mergeSettings(cur, partial);
  assert.equal(m.courses.length, 1);
  assert.equal(m.courses[0].goal.date, '2026-11-02');
  assert.equal(m.exam.date, '2026-11-02');
  assert.equal(m.courses[0].level, 'B1', 'other fields untouched');
});

/* ---------------- backup and restore ---------------- */

test('backup snapshot round trip: fluentish-snapshot@1 from before courses restores with course de; one with courses keeps them', async () => {
  // a snapshot written before courses (no courses in kv.settings) is still read
  const old = await session();
  old.store.putCards('b1', [['BP:a', card('2026-10-04', 2, T0)]]);
  old.store.putCards('clusters', [['W:gut.adj', card('2026-10-04', 1, T0)]]);
  const snapOld = JSON.parse(JSON.stringify(snapshotOf(old.store, { now: T0 })));
  assert.equal(snapOld.schema, SNAPSHOT_SCHEMA);
  assert.equal(snapOld.kv.settings.courses, undefined, 'the fixture is from before courses');
  const fresh = await session(null);
  const plan = planRestore(fresh.store, { snapshots: [snapOld], events: [] });
  await applyRestore(fresh.store, plan, { now: () => T0 });
  const s = S.normalizeSettings(fresh.store.get('settings'));
  assert.equal(S.examDate(s), '2026-10-09');
  assert.deepEqual(s.courses.map(c => c.id), ['de']);
  for (const k of ['language', 'level', 'exam', 'minutesPerDay']) assert.deepEqual(s[k], preCourse()[k], k);
  assert.deepEqual(fresh.store.cards('b1'), old.store.cards('b1'));
  assert.deepEqual(fresh.store.cards('clusters'), old.store.cards('clusters'));
  // a snapshot with courses: the courses come back, and the old fields are still there for a reader from before
  migrateCourses(old.store);
  S.setCourse(old.app, 'fr', { lang: 'fr', level: 'A1' });
  const snapNew = JSON.parse(JSON.stringify(snapshotOf(old.store, { now: T0 })));
  assert.equal(snapNew.schema, SNAPSHOT_SCHEMA, 'the same format: additive only');
  for (const k of ['language', 'level', 'exam', 'minutesPerDay', 'rev']) assert.ok(k in snapNew.kv.settings, `old field ${k} still written`);
  const other = await session(null);
  await applyRestore(other.store, planRestore(other.store, { snapshots: [snapNew], events: [] }), { now: () => T0 });
  const t = S.normalizeSettings(other.store.get('settings'));
  assert.deepEqual(t.courses.map(c => c.id), ['de', 'fr']);
  assert.equal(t.activeCourse, 'de');
  assert.equal(S.examDate(t), '2026-10-09');
  // restoring again changes nothing
  assert.equal(Object.keys(planRestore(other.store, { snapshots: [snapNew], events: [] }).kv).length, 0);
});

/* ---------------- scope: knowledge, the allowance, Where you stand ---------------- */

test('knowledge, the allowance and dueTomorrow read the active course: German exactly as before, another language only its own decks', async () => {
  const { store, app } = await session();
  store.putCards('b1', [['BP:a', card('2026-10-04', 2, T0)], ['W:haus.n', card('2026-10-05', 3, T0)]]);
  store.putCards('speak', [['SS:greet-01', card('2026-10-05', 1, T0)]]);
  store.putCards('fr:core', [['K:ENG_CHUNK_0001', card('2026-10-04', 1, T0)]]);
  const c = { today: DAY, exam: '2026-10-09', phase: 'week', daysLeft: 4, lastNewDay: '2026-10-07', capDay: '2026-10-08', newItems: true, mocks: true };
  // German: the settings from before courses and the migrated ones give the same numbers, byte for byte
  const before = dayAllowance({ store, c, settings: preCourse() });
  migrateCourses(store);
  const after = dayAllowance({ store, c, settings: S.normalizeSettings(store.get('settings')) });
  assert.equal(JSON.stringify(after), JSON.stringify(before));
  assert.equal(dueTomorrow({ store, c, settings: S.normalizeSettings(store.get('settings')) }), dueTomorrow({ store, c, settings: null }));
  assert.deepEqual(knowledgeDecks(store), DECKS, 'German: the legacy decks, in their order');
  assert.equal(courseLang(S.normalizeSettings(store.get('settings'))), 'de');
  // French active: no German deck counts, its own deck fr:core does (C3a: its due card, in the daily round's share)
  S.setCourse(app, 'fr', { lang: 'fr' });
  S.setActiveCourse(app, 'fr');
  const fs = S.normalizeSettings(store.get('settings'));
  assert.deepEqual(knowledgeDecks(store), ['fr:core']);
  const fa = dayAllowance({ store, c: { ...c, exam: null, phase: 'none', daysLeft: null, lastNewDay: null, capDay: null }, settings: fs });
  assert.equal(fa.reviews.due, 1);
  assert.equal(fa.decks.b1.due, 1);
  for (const [k, d] of Object.entries(fa.decks)) if (k !== 'b1') assert.equal(d.due, 0, k);
  assert.equal(dueTomorrow({ store, c, settings: fs }), 1);
  assert.deepEqual(firstWeek(store, DAY, fs), { day: 1 }, 'a new course\'s first week (its first card was yesterday)');
  S.setActiveCourse(app, 'de');
  assert.deepEqual(knowledgeDecks(store), DECKS);
});
