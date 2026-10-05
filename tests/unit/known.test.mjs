// "I know this": domain/known.js and its writer data/known.js. Scheduling, the check (a pass, and a miss that returns
// the card to normal reviews), the new-item budget, idempotency, undo, batches and Igloo's placement results.
// Synthetic ids and records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../../src/domain/known.js';
import * as FS from '../../src/domain/fsrs.js';
import * as D8 from '../../src/domain/days.js';
import * as RD from '../../src/domain/b1ready.js';
import { knowledge, resolver } from '../../src/domain/knowledge.js';
import { context } from '../../src/core/clock.js';
import { dayBudget } from '../../src/domain/budget.js';
import * as C from '../../src/features/practice/compose.js';
import { compose as composeCluster } from '../../src/features/practice/clusters/items.js';
import * as KD from '../../src/data/known.js';

const today = '2026-10-05';
const EXAM = '2026-10-09';
const ctxOf = (day = today, exam = EXAM) => context({ today: day, exam });
const learning = () => ({ S: 2.3, D: 5, reps: 1, lapses: 0, last: today, first: today, due: today, learn: 1, relearn: false, stage: 0, streak: 0, hist: [[today, 3, 4000, 't', '']] });
const review = (S = 4, last = D8.add(today, -3)) => ({ S, D: 5, reps: 3, lapses: 0, last, first: D8.add(today, -20), due: today, learn: null, relearn: false, stage: 1, streak: 0, hist: [[last, 3, 3000, 't', '']] });

/** A tiny in-memory store with the parts data/known.js uses. */
function memStore() {
  /** @type {Record<string, Record<string, any>>} */ const decks = {};
  /** @type {any[]} */ const events = [];
  /** @type {Record<string, any>} */ const kv = {};
  return {
    events, kv,
    cards: (/** @type {string} */ d) => (decks[d] ||= {}),
    putCards(/** @type {string} */ d, /** @type {[string, any][]} */ entries) { const c = (decks[d] ||= {}); for (const [id, r] of entries) { if (r == null) delete c[id]; else c[id] = r; } },
    append(/** @type {string} */ type, /** @type {any} */ payload) { events.push({ type, payload }); },
    get: (/** @type {string} */ n, /** @type {any} */ f) => (n in kv ? kv[n] : f),
    set: (/** @type {string} */ n, /** @type {any} */ v) => { kv[n] = v; },
  };
}
const ctxFor = (store, day = today) => ({ store, clock: { ctx: () => ({ ...ctxOf(day), today: day }) } });

test('a mark schedules the card as long-known: S 60, due 60 days out, graduated, by self', () => {
  const rec = K.markRec(null, { today, by: 'self', now: 1 });
  assert.equal(rec.S, K.KNOWN_S);
  assert.equal(rec.due, D8.add(today, 60));
  assert.equal(rec.learn, null);
  assert.equal(rec.relearn, false);
  assert.equal(rec.reps, 1);
  assert.equal(rec.last, today);
  assert.deepEqual(rec.hist, []);
  assert.deepEqual(rec.known, { by: 'self', on: today, prev: null });
  assert.ok(K.isMarked(rec));
  // not due before its check, and recalled at once (knowledge reads it as known)
  assert.equal(RD.isDue(rec, today, ctxOf()), false);
  assert.equal(RD.isDue(rec, D8.add(today, 59), ctxOf(D8.add(today, 59), null)), false);
  assert.equal(RD.isDue(rec, D8.add(today, 60), ctxOf(D8.add(today, 60), null)), true);
  // the exam cap leaves it alone: it will still be recalled on the exam day
  assert.equal(RD.dueOn(rec, ctxOf()), rec.due);
});

test('marking is idempotent: a marked card and a long-known card are left as they are', () => {
  const rec = K.markRec(null, { today, by: 'self' });
  assert.equal(K.markRec(rec, { today, by: 'self' }), null);
  assert.equal(K.markRec(rec, { today: D8.add(today, 3), by: 'igloo' }), null);
  assert.equal(K.markRec(review(90), { today }), null);
  // a card in its learning steps or with a short S is marked, and keeps its history and first day
  const l = K.markRec(learning(), { today });
  assert.equal(l.learn, null);
  assert.equal(l.first, today);
  assert.equal(l.hist.length, 1);
  const store = memStore(), ctx = ctxFor(store);
  const a = KD.markCards(ctx, [{ deck: 'b1', id: 'K:alpha' }], { spread: false });
  const b = KD.markCards(ctx, [{ deck: 'b1', id: 'K:alpha' }], { spread: false });
  assert.equal(a.n, 1);
  assert.equal(b.n, 0);
  assert.equal(store.events.length, 1, 'a second mark writes nothing');
});

test('undo puts back the record it replaced, or deletes a card that did not exist', () => {
  const before = review(4);
  const rec = K.markRec(before, { today });
  assert.deepEqual(K.unmarkRec(rec), { rec: before });
  assert.deepEqual(K.unmarkRec(K.markRec(null, { today })), { rec: null });
  assert.equal(K.unmarkRec(before), null, 'nothing to undo on a card that is not marked');
  const store = memStore(), ctx = ctxFor(store);
  store.putCards('b1', [['G:beta', before]]);
  const res = KD.markCards(ctx, [{ deck: 'b1', id: 'G:beta' }, { deck: 'clusters', id: 'W:gamma.adj' }]);
  assert.equal(res.n, 2);
  assert.equal(res.undo(), 2);
  assert.deepEqual(store.cards('b1')['G:beta'], before);
  assert.equal(store.cards('clusters')['W:gamma.adj'], undefined);
  assert.deepEqual(store.events.map(e => e.type), ['card.marked_known', 'card.marked_known', 'card.unmarked_known', 'card.unmarked_known']);
  const ev = store.events[0].payload;
  assert.equal(ev.by, 'self');
  assert.deepEqual(Object.keys(ev.ctx).sort(), ['exam', 'phase', 'tz']);
  assert.ok(ev.items[0].post.known, 'the event carries the card after the mark');
});

test('the check: a pass closes the mark and grows S; a miss returns the card to normal reviews', () => {
  const rec = K.markRec(null, { today, by: 'self' });
  const day = rec.due, c = { today: day, exam: null, phase: 'none' };
  const pass = FS.schedule(rec, { g: 3, ms: 3000, onTime: true }, c);
  assert.equal(pass.rec.known.checked, day);
  assert.equal(pass.rec.known.ok, true);
  assert.ok(!('prev' in pass.rec.known), 'the record before the mark is dropped once checked');
  assert.ok(pass.rec.S > K.KNOWN_S);
  assert.equal(K.isMarked(pass.rec), false);
  assert.equal(K.unmarkRec(pass.rec), null, 'a checked mark cannot be undone');
  const miss = FS.schedule(rec, { g: 1, ms: 9000 }, c);
  assert.equal(miss.reinsert, 'lapse');
  assert.equal(miss.rec.relearn, true);
  assert.equal(miss.rec.lapses, 1);
  assert.ok(miss.rec.S < 15, `a short stability after the miss (${miss.rec.S})`);
  assert.equal(miss.rec.known.ok, false);
  assert.equal(K.isMarked(miss.rec), false);
  // back in normal reviews: due again in the same round, then on its new schedule
  assert.equal(RD.isDue(miss.rec, day, c), true);
  const fixed = FS.schedule(miss.rec, { g: 3, ms: 3000 }, c);
  assert.equal(fixed.rec.relearn, false);
  assert.equal(fixed.rec.due, D8.add(day, 1));
  const next = FS.schedule(fixed.rec, { g: 3, ms: 3000, onTime: true }, { ...c, today: D8.add(day, 1) });
  assert.equal(next.rec.known.checked, day, 'later reviews leave the closed mark as it is');
});

test('answers on the day of the mark only log, and the exam day writes nothing', () => {
  const rec = K.markRec(null, { today });
  const same = FS.schedule(rec, { g: 1, ms: 3000 }, { today, exam: EXAM, phase: 'week' });
  assert.equal(same.wrote, false);
  assert.ok(K.isMarked(same.rec), 'a log-only answer is not the check');
  const examDay = FS.schedule(rec, { g: 1, ms: 3000 }, { today: EXAM, exam: EXAM, phase: 'day' });
  assert.ok(K.isMarked(examDay.rec));
});

test('a mark never uses the day\'s new-item budget, and marked items are not introduced as new', () => {
  const c = ctxOf();
  const pool = ['K:a', 'K:b', 'K:c', 'K:d', 'K:e', 'K:f'].map((id, i) => ({ id, kind: 'phrase', area: 'speaking', group: 'S2', star: true, trap: null, rank: i }));
  const data = { pool, byId: new Map(pool.map(it => [it.id, it])), topics: new Map(), plan: { topics: [], traps: [], functions: [] } };
  const day = C.newDay(today);
  const cards = {};
  const s0 = /** @type {any} */ ({ data, cards, day, c, newPerDay: 8, marked: new Set() });
  const left0 = C.newLeft(s0);
  const store = memStore(), ctx = ctxFor(store);
  KD.markCards(ctx, [{ deck: 'b1', id: 'K:a' }, { deck: 'clusters', id: 'CF:bwort' }]);
  const s1 = /** @type {any} */ ({ ...s0, cards: store.cards('b1'), marked: KD.marked(store) });
  assert.equal(C.newLeft(s1), left0, 'new items left today are unchanged');
  assert.equal(day.newShown, 0);
  assert.ok(!C.nextNew(s1, pool, 6).some(it => it.id === 'K:a'), 'a marked item is not new');
  assert.deepEqual([...KD.marked(store)].sort(), ['K:a', 'W:bwort']);
  // a twin B1 phrase (BP: with chunk x) is left out when its chunk K:x is marked
  const twin = { id: 'BP:twin', kind: 'phrase', area: 'speaking', group: 'S2', star: true, trap: null, chunk: 'tw' };
  assert.equal(K.skipsNew(new Set(['K:tw']), twin.id, twin.chunk), true);
  // the day budget reads the same shown count: unchanged
  const b = dayBudget({ c, settings: { minutesPerDay: 60, exam: { type: 'goethe-b1' } }, dueN: 0, priorityLeft: 20, newShown: day.newShown });
  assert.equal(b.newLeft, dayBudget({ c, settings: { minutesPerDay: 60, exam: { type: 'goethe-b1' } }, dueN: 0, priorityLeft: 20, newShown: 0 }).newLeft);
  // clusters: a family card whose word is marked is not introduced; the marked card is not practised ahead
  const mk = KD.marked(store);
  const cl = composeCluster({ ids: ['CF:bwort', 'CF:cwort', 'W:dwort'], cards: store.cards('clusters'), c, isDue: () => false, recall: () => 0, skip: id => K.skipsNew(mk, id) });
  assert.deepEqual(cl.ids.sort(), ['CF:cwort', 'W:dwort']);
  const extra = composeCluster({ ids: ['CF:bwort'], cards: store.cards('clusters'), c: { ...c, today: D8.add(today, 1) }, isDue: () => false, recall: () => 0 });
  assert.deepEqual(extra.ids, []);
});

test('knowledge, Explore and readiness read a mark at once', () => {
  const store = memStore(), ctx = ctxFor(store);
  KD.markWords(ctx, ['gut.adj']);
  const k = knowledge({ today, decks: { clusters: store.cards('clusters') }, resolve: resolver() });
  const s = k.get('W:gut.adj');
  assert.equal(s.state, 'known');
  assert.equal(s.marked, 'self');
  assert.equal(s.today, false, 'a mark is not practice: no "practised today" accent');
  assert.deepEqual(s.sources, ['self']);
  const pool = [{ id: 'W:gut.adj', area: 'words', group: 'w' }, { id: 'W:sehr.adv', area: 'words', group: 'w' }];
  const r0 = RD.compute({ pool, store: {}, today, exam: EXAM, phase: 'week' }).overall;
  const r1 = RD.compute({ pool, store: { 'W:gut.adj': store.cards('clusters')['W:gut.adj'] }, today, exam: EXAM, phase: 'week' }).overall;
  assert.ok(r1.recall > r0.recall + 0.4);
  // undo: the item is unseen again
  KD.unmarkItems(ctx, ['W:gut.adj']);
  assert.equal(knowledge({ today, decks: { clusters: store.cards('clusters') }, resolve: resolver() }).get('W:gut.adj').state, 'unseen');
});

test('a word goes on the card he already has for it, else a new deck-clusters card', () => {
  const store = memStore();
  assert.deepEqual(KD.wordEntry(store, 'x.adj'), { deck: 'clusters', id: 'W:x.adj' });
  store.putCards('b1', [['W:x.adj', review()]]);
  assert.deepEqual(KD.wordEntry(store, 'x.adj'), { deck: 'b1', id: 'W:x.adj' });
  store.putCards('clusters', [['CF:y', review()]]);
  assert.deepEqual(KD.wordEntry(store, 'y'), { deck: 'clusters', id: 'CF:y' });
});

test('a batch spreads its checks: no more than about 20 a day, all from day 60', () => {
  const ids = Array.from({ length: 700 }, (_, i) => `W:w${i}`);
  /** @type {Record<number, number>} */ const per = {};
  for (const id of ids) { const o = K.checkOffset(id, ids.length); per[o] = (per[o] || 0) + 1; }
  const offs = Object.keys(per).map(Number);
  assert.equal(Math.min(...offs), 60);
  assert.ok(Math.max(...offs) <= 60 + 35);
  assert.ok(Math.max(...Object.values(per)) <= 40, `at most ${Math.max(...Object.values(per))} on one day`);
  assert.equal(K.checkOffset('W:one', 1), 60);
  assert.equal(K.checkOffset('W:a', 700), K.checkOffset('W:a', 700), 'stable');
});

test('moving the exam earlier never clamps a marked card before the exam', () => {
  const marked = K.markRec(null, { today });
  const plain = { ...review(60), due: D8.add(today, 30) };
  const out = FS.recap({ 'W:m': marked, 'W:p': plain }, { today, exam: '2026-10-20', phase: 'week' });
  assert.ok(!('W:m' in out));
  assert.ok('W:p' in out);
});

test('Igloo placement results flow through the same path, once, never over a card he has', () => {
  const store = memStore(), ctx = ctxFor(store);
  store.putCards('b1', [['G:seen', review()]]);
  const know = { 'german|W:a.adj': { s: 'known', last: 1 }, 'german|G:seen': { s: 'known' }, 'german|K:c': { s: 'shaky' }, 'english|W:b': { s: 'known' }, 'german|K:tw': { s: 'known' }, 'german|X:none': { s: 'known' } };
  const place = id => id === 'K:tw' ? { deck: 'b1', id: 'BP:twin' } : id.startsWith('W:') ? { deck: 'clusters', id } : id.startsWith('G:') ? { deck: 'b1', id } : null;
  assert.equal(KD.importPlacement(ctx, know, place), 2);
  assert.equal(store.cards('clusters')['W:a.adj'].known.by, 'igloo');
  assert.equal(store.cards('b1')['BP:twin'].known.by, 'igloo');
  assert.equal(store.cards('b1')['G:seen'].known, undefined, 'a card with reviews keeps its schedule');
  assert.equal(KD.importPlacement(ctx, know, place), 0, 'once a profile');
  const k = knowledge({ today, decks: { clusters: store.cards('clusters') }, resolve: resolver() });
  assert.deepEqual(k.get('W:a.adj').sources, ['test']);
  assert.equal(k.get('W:a.adj').marked, 'igloo');
});
