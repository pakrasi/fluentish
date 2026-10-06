// Decks per course in the allowance and knowledge (round 3, C3a). A course in another language has '<lang>:<name>'
// decks; the budget, the allowance, Today's count and Where you stand count them, and its items are scoped to its
// language ('fr:K:…'), so the chunk bank's language-independent ids never collide with German's. German reads its
// legacy decks exactly as before, and its item ids are never re-keyed. All data synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { migrateCourses } from '../../src/data/session.js';
import { Store } from '../../src/data/store.js';
import { createHlc } from '../../src/data/ids.js';
import * as S from '../../src/data/settings.js';
import { allowanceDeck, namedDecks, DECK_STATS_KV } from '../../src/domain/decks.js';
import { steadyFor } from '../../src/domain/budget.js';
import { scopeItem, splitItem } from '../../src/domain/itemids.js';
import { knowledgeDecks } from '../../src/data/knowledge.js';
import { dayAllowance, todayBudget, dueTomorrow, firstWeek } from '../../src/domain/allowance.js';
import { knowledge, resolver } from '../../src/domain/knowledge.js';
import { week } from '../../src/domain/standing.js';
import * as D8 from '../../src/domain/days.js';

const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000c3';
const DAY = '2026-10-20';
const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);
const clock = { today: () => DAY };
/** A card answered on `last`, due `due` (reps 0: never answered). */
const card = (/** @type {string} */ due, reps = 2, last = D8.add(due, -3), first = last) => ({ S: 4.2, D: 5.1, due, reps, lapses: 0, last, first, stage: 1, streak: 0, learn: null, relearn: false, u: T0, hist: reps ? [[last, 3, 1200, 't', '']] : [] });
// after his exam, no new date: maintenance (the allowance's general case)
const C = { today: DAY, exam: null, phase: 'none', daysLeft: null, lastNewDay: null, capDay: null, newItems: true, mocks: false };

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

/** His German decks: a review round's worth due, situations, clusters, plus a first-ever study day a month ago. */
function germanCards(/** @type {any} */ store) {
  store.putCards('b1', [['K:ENG_CHUNK_0001', card('2026-10-18')], ['BP:termin', card('2026-10-19')], ['W:haus.n', card('2026-11-02')], ['G:dass.01', card('2026-10-20')]]);
  store.putCards('speak', [['SS:greet-01', card('2026-10-19')]]);
  store.putCards('clusters', [['W:tisch.n', card('2026-10-19')]]);
  store.set('activity', { '2026-09-15': { minutes: 30, rounds: 2 } });
}

/** A synthetic French course: the same chunk id as German in fr:core, plus fr:speak, one new card today, its open count. */
function frenchCards(/** @type {any} */ store) {
  store.putCards('fr:core', [
    ['K:ENG_CHUNK_0001', card('2026-10-17')], ['K:ENG_CHUNK_0002', card('2026-10-19')], ['W:maison.n', card('2026-10-20')],
    ['K:ENG_CHUNK_0003', card('2026-10-25')], ['K:ENG_CHUNK_0004', card('2026-10-21', 1, DAY, DAY)],
  ]);
  store.putCards('fr:speak', [['SS:saluer-01', card('2026-10-18', 2, '2026-10-01', '2026-10-01')]]);
  store.set(DECK_STATS_KV, { 'fr:core': { day: DAY, open: 40 }, 'fr:speak': { day: DAY, open: 12 } });
}

test('item ids per language: German unscoped for ever, another language <lang>:<id>', () => {
  assert.equal(scopeItem('de', 'K:ENG_CHUNK_0001'), 'K:ENG_CHUNK_0001');
  assert.equal(scopeItem(null, 'W:haus.n'), 'W:haus.n');
  assert.equal(scopeItem('fr', 'K:ENG_CHUNK_0001'), 'fr:K:ENG_CHUNK_0001');
  assert.equal(scopeItem('fr', 'fr:K:ENG_CHUNK_0001'), 'fr:K:ENG_CHUNK_0001', 'idempotent');
  assert.deepEqual(splitItem('fr:K:ENG_CHUNK_0001'), { lang: 'fr', id: 'K:ENG_CHUNK_0001' });
  assert.deepEqual(splitItem('K:ENG_CHUNK_0001'), { lang: 'de', id: 'K:ENG_CHUNK_0001' });
  assert.deepEqual(splitItem('GC:dass'), { lang: 'de', id: 'GC:dass' });
  assert.equal(allowanceDeck('fr:core'), 'b1');
  assert.equal(allowanceDeck('fr:words'), 'b1');
  assert.equal(allowanceDeck('fr:speak'), 'speak');
  assert.equal(allowanceDeck('ar:clusters'), 'clusters');
  assert.deepEqual(namedDecks(['b1', 'fr:speak', 'fr:core', 'ar:core', 'speak'], 'fr'), ['fr:core', 'fr:speak']);
  assert.deepEqual(namedDecks(['b1', 'speak'], 'de'), [], 'German: its decks are the legacy ones');
});

test('a French course with cards gets a real allowance: its decks counted, Today and the week too', async () => {
  const { store, app } = await session();
  germanCards(store);
  frenchCards(store);
  S.setCourse(app, 'fr', { lang: 'fr', level: 'A2' });
  S.setActiveCourse(app, 'fr');
  const fs = S.normalizeSettings(store.get('settings'));
  const a = dayAllowance({ store, c: C, settings: fs });
  // reviews: fr:core's three due (not the one due on the 25th, not the one first answered today), fr:speak's one
  assert.equal(a.decks.b1.due, 3);
  assert.equal(a.decks.speak.due, 1);
  assert.equal(a.reviews.due, 4, 'Today\'s "reviews due today" counts the French decks, and no German one');
  for (const k of ['mistakes', 'writing', 'script', 'build', 'clusters']) assert.equal(/** @type {any} */ (a.decks)[k].due, 0, k);
  // new items: a real share for the round and the situations, one already shown today
  assert.equal(a.mode, 'maintenance');
  // hotfix: Auto is at most the sustainable rate of his minutes (budget.js steadyFor)
  assert.ok(a.newPerDay >= 8 && a.newPerDay <= steadyFor(fs), `newPerDay ${a.newPerDay}`);
  assert.ok(a.decks.b1.newPerDay > 0 && a.decks.speak.newPerDay > 0);
  assert.equal(a.decks.b1.shown, 1);
  assert.equal(a.shown, 1);
  assert.equal(a.newLeft, a.newPerDay - 1);
  assert.ok(a.decks.b1.minutes > 0 && a.decks.b1.rounds >= 1);
  // the German trainer's stats never leak into a French course
  assert.equal(a.stats, null);
  assert.equal(a.pace, null);
  const tb = todayBudget({ store, c: C, settings: fs });
  assert.equal(tb.due, 3);
  // tomorrow: everything due now plus the card due on the 21st
  assert.equal(dueTomorrow({ store, c: C, settings: fs }), 5);
  // his first French study day was the 1st (fr:speak), so his first week is over
  assert.equal(firstWeek(store, DAY, fs), null);
  // Where you stand's week reads the course's decks (knowledgeDecks): the French ones only
  assert.deepEqual(knowledgeDecks(store), ['fr:core', 'fr:speak']);
  const decks = Object.fromEntries(knowledgeDecks(store).map(d => [d, store.cards(d)]));
  assert.deepEqual(week(decks, DAY, D8.diff), { learnt: 4, lapsed: 0 }, 'four French cards first answered this week, the German ones not counted');
  // a deck's open count is the one its feature recorded today; without a record any number
  store.set(DECK_STATS_KV, { 'fr:core': { day: DAY, open: 0 }, 'fr:speak': { day: '2026-10-19', open: 0 } });
  const b = dayAllowance({ store, c: C, settings: fs });
  assert.equal(b.decks.b1.newLeft, 0, 'nothing open in fr:core');
  assert.ok(b.decks.speak.newLeft > 0, 'yesterday\'s record does not count');
});

test('German is unchanged by French decks in the store: allowance, Today and tomorrow byte for byte', async () => {
  const plain = await session(), mixed = await session();
  germanCards(plain.store);
  germanCards(mixed.store);
  frenchCards(mixed.store);
  for (const c of [C, { ...C, exam: '2026-10-24', phase: 'week', daysLeft: 4, lastNewDay: '2026-10-22', capDay: '2026-10-23', mocks: true }]) {
    const sp = S.normalizeSettings(plain.store.get('settings')), sm = S.normalizeSettings(mixed.store.get('settings'));
    assert.equal(JSON.stringify(dayAllowance({ store: mixed.store, c, settings: sm })), JSON.stringify(dayAllowance({ store: plain.store, c, settings: sp })));
    assert.equal(JSON.stringify(todayBudget({ store: mixed.store, c, settings: sm })), JSON.stringify(todayBudget({ store: plain.store, c, settings: sp })));
    assert.equal(dueTomorrow({ store: mixed.store, c, settings: sm }), dueTomorrow({ store: plain.store, c, settings: sp }));
    assert.deepEqual(firstWeek(mixed.store, DAY, sm), firstWeek(plain.store, DAY, sp));
  }
  assert.deepEqual(knowledgeDecks(mixed.store), knowledgeDecks(plain.store));
  const a = dayAllowance({ store: plain.store, c: C, settings: S.normalizeSettings(plain.store.get('settings')) });
  assert.equal(a.decks.b1.due, 3);
  assert.equal(a.reviews.due, 5);
});

test('knowledge: the same chunk id in German and French is two items; German\'s ids and scores are what they were', () => {
  const resolve = resolver({ words: [{ id: 'haus.n', w: 'Haus' }] });
  const de = { b1: { 'K:ENG_CHUNK_0001': card('2026-10-30', 3, '2026-10-19'), 'W:haus.n': card('2026-10-30') } };
  const fr = { 'fr:core': { 'K:ENG_CHUNK_0001': { ...card('2026-10-18', 1, '2026-10-17'), hist: [['2026-10-17', 1, 900, 't', '']] }, 'W:maison.n': card('2026-10-30') } };
  const only = knowledge({ today: DAY, decks: de, resolve });
  const both = knowledge({ today: DAY, decks: { ...de, ...fr }, resolve });
  assert.deepEqual([...both.items.keys()].sort(), ['K:ENG_CHUNK_0001', 'W:haus.n', 'fr:K:ENG_CHUNK_0001', 'fr:W:maison.n']);
  assert.deepEqual(both.get('K:ENG_CHUNK_0001'), only.get('K:ENG_CHUNK_0001'), 'a French lapse never touches the German item');
  assert.deepEqual(both.get('W:haus.n'), only.get('W:haus.n'));
  assert.deepEqual(both.get('fr:K:ENG_CHUNK_0001').cards, ['fr:core/K:ENG_CHUNK_0001']);
  assert.notEqual(both.get('fr:K:ENG_CHUNK_0001').state, both.get('K:ENG_CHUNK_0001').state);
  // Igloo's legacy data for a French course is French: scoped to it, never read into German items
  const igloo = knowledge({ today: DAY, epoch: 20746, decks: {}, resolve, lang: 'french', itemLang: 'fr', srs: { 'french|K:ENG_CHUNK_0009': { reps: 3, ivl: 20, last: 20740 }, 'german|K:ENG_CHUNK_0009': { reps: 3, ivl: 20, last: 20740 } } });
  assert.deepEqual([...igloo.items.keys()], ['fr:K:ENG_CHUNK_0009']);
  const iglooDe = knowledge({ today: DAY, epoch: 20746, decks: {}, resolve, srs: { 'german|K:ENG_CHUNK_0009': { reps: 3, ivl: 20, last: 20740 } } });
  assert.deepEqual([...iglooDe.items.keys()], ['K:ENG_CHUNK_0009'], 'German as before');
});
