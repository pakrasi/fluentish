// The French course's round (C3b): where it lives (deck fr:core, session fr.session, counts in deck.stats), its pool
// (the reviewed course phrases and the word list, in level order, two phrases to a word), the allowance it gets before
// its first card, and that adding or studying it leaves every German number as it was. All data synthetic, except
// the shipped French content the pool is built from.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryAdapter } from '../../src/data/adapters/memory.js';
import { migrateCourses } from '../../src/data/session.js';
import { Store } from '../../src/data/store.js';
import { createHlc } from '../../src/data/ids.js';
import * as S from '../../src/data/settings.js';
import { DECK_STATS_KV } from '../../src/domain/decks.js';
import { todayBudget, dayAllowance } from '../../src/domain/allowance.js';
import { courseRound, buildCoursePool } from '../../src/features/shared/course.js';
import { stateFor, session as sessionOf, saveAnswer } from '../../src/features/shared/data.js';
import { setLanguage } from '../../src/core/lang.js';
import * as SS from '../../src/features/shared/session.js';
import * as CO from '../../src/features/shared/compose.js';
import fr from '../../src/lang/fr/index.js';
import * as D8 from '../../src/domain/days.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const PID = '0192a3b4-c5d6-7e8f-9a0b-0000000000f1';
const DAY = '2026-10-20';
const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);
const clock = { today: () => DAY };
const C = { today: DAY, exam: null, phase: 'none', daysLeft: null, lastNewDay: null, capDay: null, newItems: true, mocks: false };
const card = (/** @type {string} */ due, reps = 2, last = D8.add(due, -3)) => ({ S: 4.2, D: 5.1, due, reps, lapses: 0, last, first: last, stage: 1, streak: 0, learn: null, relearn: false, u: T0, hist: [[last, 3, 1200, 't', '']] });

after(() => setLanguage('german'));

async function profile() {
  const store = await Store.open({ adapter: createMemoryAdapter(), profile: { id: PID, name: '', kind: 'local' }, device: { deviceId: 'dev', seq: 0 }, clock });
  store.set('settings', { v: 1, language: 'german', level: 'B1', exam: { type: 'goethe-b1', date: null, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] },
    minutesPerDay: 60, newPerDay: null, practice: { readAloud: true }, onboarded: '2026-10-01T09:00:00.000+02:00', rev: {} });
  let t = T0;
  const app = { store, hlc: createHlc('dev', () => (t += 1000)), bus: { emit: () => {} }, clock };
  migrateCourses(store);
  store.putCards('b1', [['K:ENG_CHUNK_0001', card('2026-10-18')], ['G:dass.01', card('2026-10-20')]]);
  store.set('activity', { '2026-09-15': { minutes: 30, rounds: 2 } });
  return { store, app };
}
const settingsOf = (/** @type {any} */ store) => S.normalizeSettings(store.get('settings'));
const pool = () => {
  setLanguage('french');
  return buildCoursePool({ course: J('content/course/fr.json'), words: J('content/igloo/words/fr.json'), pack: fr, t: k => k, lang: 'fr' });
};

test('where a course\'s round lives: German is the B1 trainer\'s deck and session; French its own', () => {
  assert.deepEqual(courseRound('de'), { lang: 'de', deck: 'b1', kv: 'b1.session', trainer: true });
  assert.deepEqual(courseRound(null), { lang: 'de', deck: 'b1', kv: 'b1.session', trainer: true });
  assert.deepEqual(courseRound('fr'), { lang: 'fr', deck: 'fr:core', kv: 'fr.session', trainer: false });
});

test('the French pool: reviewed phrases and words, level order, two phrases to a word, graded through the pack', () => {
  const d = /** @type {any} */ (pool());
  const course = J('content/course/fr.json');
  assert.equal(course.reviewedBy, 'fr-native-review');
  assert.ok(d.pool.length > 600, `${d.pool.length} items`);
  assert.ok(d.pool.every((/** @type {any} */ it) => it.course === 'fr' && /^(K:ENG_CHUNK_\d{4}|W:.+)$/.test(it.id)));
  assert.deepEqual(d.pool.slice(0, 3).map((/** @type {any} */ it) => it.kind), ['phrase', 'phrase', 'word']);
  const lv = ['A1', 'A2', 'B1'];
  for (let i = 1; i < d.pool.length; i++) assert.ok(lv.indexOf(d.pool[i].level) >= lv.indexOf(d.pool[i - 1].level), 'level order');
  const word = d.byId.get("W:école.noun");
  assert.deepEqual(word.accept, ["l'école", 'une école']);
  assert.equal(word.card.forms, "l'école (f) · une école");
  const verb = d.pool.find((/** @type {any} */ it) => it.id === 'W:aller.verb');
  assert.match(verb.card.forms, /^aller · il va · il est allé · il allait · il ira$/);
  assert.match(verb.card.conf, /elle est allée/);
  assert.ok(d.lexicon.has('mange') || d.lexicon.has('parle'), 'present forms are words of the lexicon');
});

test('a new French course gets new items before its first card, and German\'s numbers do not move', async () => {
  const { store, app } = await profile();
  const deBefore = JSON.stringify(todayBudget({ store, c: C, settings: settingsOf(store) }));
  S.addCourse(app, { lang: 'fr', level: 'A2' });
  setLanguage('french');
  const data = pool();
  const ctx = { clock: { ctx: () => C }, store, settings: () => settingsOf(store), t: (/** @type {string} */ k) => k };
  const st = /** @type {any} */ (stateFor(ctx, data));
  // the course's numbers: its own deck, its own stats; the German trainer's session untouched
  assert.deepEqual(Object.keys(st.cards), []);
  const stats = store.get(DECK_STATS_KV, {})['fr:core'];
  assert.equal(stats.day, DAY); assert.equal(stats.open, data.pool.length); assert.ok(stats.next > 0, 'a first round');
  assert.ok(st.newPerDay > 0, 'new items allowed');
  // the first round mixes phrases and words (two phrases to a word, level order)
  const first = CO.compose(st);
  assert.ok(first.some(id => id.startsWith('K:')) && first.some(id => id.startsWith('W:')), first.join(' '));
  const b = todayBudget({ store, c: C, settings: settingsOf(store) });
  assert.equal(b.next, stats.next, 'Today and Practice say the same round size');
  assert.equal(b.decks.writing.due + b.decks.speak.due + b.decks.clusters.due, 0, 'no German deck counts for French');
  // a French answer goes to fr:core and fr.session only
  const ids = SS.startRound([data.pool[0].id], { kind: 'today' }, DAY, T0).queue.map((/** @type {any} */ q) => q.id);
  const round = { ...SS.startRound(ids, { kind: 'today' }, DAY, T0), deck: 'fr:core' };
  const entry = SS.current(round, data.byId, store.cards('fr:core'));
  const day = st.day;
  const res = SS.answer({ round, entry, o: { ok: true, ms: 3000 }, cards: store.cards('fr:core'), day, c: C, now: T0 + 5000 });
  saveAnswer(store, entry.item.id, res.rec, res.event, { round, slot: 'today', day }, 'fr:core', 'fr.session');
  assert.equal(res.event.deck, 'fr:core');
  assert.equal(Object.keys(store.cards('fr:core')).length, 1);
  assert.equal(sessionOf(store, 'fr.session').day.newShown, 1, 'the French day log counts its new item');
  assert.equal(sessionOf(store).day, undefined, 'the German session has no day log from French');
  // back to German: the same numbers as before French
  S.setActiveCourse(app, 'de');
  setLanguage('german');
  assert.equal(JSON.stringify(todayBudget({ store, c: C, settings: settingsOf(store) })), deBefore);
  assert.equal(dayAllowance({ store, c: C, settings: settingsOf(store) }).decks.b1.due, 2);
});
