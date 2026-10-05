// The round size picker (domain/roundsize.js, features/shared/sizes.js and the runners): Recommended, a custom
// number and "all"; new items beyond today's allowance are scheduled like any new item, and Today's plan reads the
// real load afterwards. Public B1 content; every learner record is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context, add } from '../../src/core/clock.js';
import * as RS from '../../src/domain/roundsize.js';
import { allowance } from '../../src/domain/budget.js';
import { buildPool } from '../../src/features/shared/pool.js';
import * as C from '../../src/features/shared/compose.js';
import * as S from '../../src/features/shared/session.js';
import { stateFor } from '../../src/features/shared/data.js';
import { planItems, todayBudget } from './practice-rows.mjs';
import { listOf, sizedHref } from '../../src/features/shared/sizes.js';
import * as CI from '../../src/features/shared/cluster-items.js';
import * as SM from '../../src/domain/sim.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const data = buildPool({ items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'), nouns: J('content/b1/nouns.json') });
const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
const TODAY = '2026-10-04', EXAM = '2026-10-09';
const seen = (due, o = {}) => ({ S: 6, D: 5, reps: 3, lapses: 0, last: add(due, -4), first: add(due, -12), due, stage: 1, streak: 0, learn: null, relearn: false, u: 1, hist: [[add(due, -4), 3, 3000, 't', '']], ...o });

const B = (due, fresh, rest, newLeft = 4) => ({ due, fresh, rest, newLeft, daily: true });
const ids = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);

test('sizes: parse, clamp, the order a custom round takes', () => {
  assert.equal(RS.parseSize('rec'), 'rec'); assert.equal(RS.parseSize('all'), 'all'); assert.equal(RS.parseSize('7'), 7);
  for (const bad of ['0', '-3', '2.5', 'x', '', null]) assert.equal(RS.parseSize(bad), null, String(bad));
  assert.equal(RS.clamp(0, 19), 1); assert.equal(RS.clamp(25, 19), 19); assert.equal(RS.clamp(7, 19), 7);
  const b = B(ids('d', 3), ids('n', 12), ids('r', 4), 4);   // 19 in the list
  assert.equal(RS.total(b), 19);
  // due first, then new within today's 4, then seen items early, then new beyond the allowance
  const p5 = RS.pick(b, 5);
  assert.deepEqual([p5.due, p5.fresh, p5.early, p5.over], [3, 2, 0, 0]);
  const p11 = RS.pick(b, 11);
  assert.deepEqual([p11.due, p11.fresh, p11.early, p11.over], [3, 4, 4, 0], 'seen items before new ones beyond the allowance');
  const all = RS.pick(b, 'all');
  assert.equal(all.ids.length, 19); assert.equal(new Set(all.ids).size, 19);
  assert.deepEqual([all.due, all.fresh, all.early, all.over], [3, 4, 4, 8]);
  assert.equal(all.ids.slice(0, 3).filter(id => id.startsWith('n')).length, 1, 'new items between reviews');
  // no daily cap (mistakes): every new item is within it
  assert.equal(RS.pick({ ...b, newLeft: Infinity }, 'all').over, 0);
  // the eve: no new items allowed, every one is beyond
  assert.equal(RS.pick({ ...b, newLeft: 0 }, 'all').over, 12);
  // the sheet opens on the last choice of the list type, clamped to this list
  assert.deepEqual(RS.initial(null, 19, 12), { mode: 'rec', n: 12 });
  assert.deepEqual(RS.initial({ mode: 'custom', n: 40 }, 19, 12), { mode: 'custom', n: 19 });
  assert.deepEqual(RS.initial({ mode: 'all', n: 5 }, 19, 12), { mode: 'all', n: 5 });
  assert.deepEqual(RS.initial(null, 19, 0), { mode: 'custom', n: 12 }, 'nothing recommended: the sheet starts on Custom');
  const o = RS.options(b, ['d1', 'n1', 'd2']);
  assert.deepEqual([o.N, o.rec.n, o.rec.due, o.rec.fresh], [19, 3, 2, 1]);
});

test('which links get the picker, and the address a choice starts', () => {
  for (const href of ['#/practice/round?kind=area:grammar', '#/practice/round?kind=topic:verb-final', '#/practice/round?kind=write', '#/practice/round?kind=write:W2',
    '#/practice/round?kind=missed', '#/practice/round?kind=mistakes', '#/practice/round?kind=area:words', '#/practice/round?kind=cluster%3Adue',
    '#/practice/round?kind=cluster:family:sicht', '#/practice/situations/round?pick=fn:decline', '#/practice/situations/round?pick=mixed', '#/practice/round?kind=script:abc'])
    assert.ok(listOf(href), href);
  // the daily round and the warm-up stay one tap; picked items, Quick sort and a chosen size have no sheet
  for (const href of ['#/practice/round', '#/practice/round?kind=warmup', '#/practice/round?kind=pick:BP:x', '#/practice/round?kind=cluster%3Apick&ids=gut.adj',
    '#/practice/sort?level=A1', '#/practice/round?kind=area:grammar&size=rec', '#/practice/round?kind=script:words', '#/today'])
    assert.equal(listOf(href), null, href);
  assert.equal(listOf('#/practice/round?kind=area:words').type, 'words');
  assert.equal(sizedHref('#/practice/round?kind=area:grammar', 7), '#/practice/round?kind=area:grammar&size=7');
  assert.equal(sizedHref('#/practice/situations/round?pick=mixed', 'all'), '#/practice/situations/round?pick=mixed&size=all');
});

test('B1 lists: Recommended is the composer round, all takes the whole list', () => {
  const c = context({ today: TODAY, exam: EXAM });
  const grammar = data.pool.filter(it => it.area === 'grammar' && it.group === 'verb-final');
  const cards = Object.fromEntries(grammar.slice(0, 3).map(it => [it.id, seen(TODAY)]));
  const st = { data, cards, day: C.newDay(TODAY), c, newPerDay: 8 };
  const spec = C.parseKind('topic:verb-final');
  const b = C.buckets(st, spec);
  assert.equal(b.due.length, 3);
  assert.equal(RS.total(b), new Set([...b.due, ...b.fresh, ...b.rest]).size);
  assert.equal(b.newLeft, C.newLeftOf(st, 'g'));
  const rec = C.compose(st, spec);
  const o = RS.options(b, rec);
  assert.equal(o.rec.due, 3); assert.ok(o.rec.fresh <= b.newLeft);
  const all = RS.pick(b, 'all');
  assert.equal(all.ids.length, RS.total(b));
  assert.equal(all.over, Math.max(0, b.fresh.length - b.newLeft));
  // missed: nothing new; mistakes: changed in round 3, they have their share of the one allowance (journey #1), so
  // the picker counts them against the day like every other list
  assert.equal(C.buckets(st, C.parseKind('missed')).newLeft, 0);
  const mb = C.buckets({ ...st, mistakesNew: 2 }, C.parseKind('mistakes'));
  assert.equal(mb.daily, true); assert.equal(mb.newLeft, 2);
});

/** A store over plain objects (the kv and the decks), enough for stateFor, planItems and todayBudget. */
function memStore(cards) {
  const kv = { 'b1.session': {} }, decks = { b1: cards };
  return { kv, decks, cards: d => decks[d] || {}, putCards: (d, list) => { for (const [id, r] of list) (decks[d] ||= {})[id] = r; }, get: (n, f) => (n in kv ? kv[n] : f),
    set: (n, v) => { kv[n] = v; }, update: (n, fn, f) => { kv[n] = fn(n in kv ? kv[n] : f); }, append: () => {}, attempts: () => [] };
}

test('new items beyond today\'s allowance are scheduled, and Today\'s plan reads the real load afterwards', () => {
  const c = context({ today: TODAY, exam: EXAM });
  const settings = { language: 'german', minutesPerDay: 60, newPerDay: 4, rev: { newPerDay: 'x' }, exam: { type: 'goethe-b1', date: EXAM, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] }, practice: {} };
  const store = memStore({});
  const ctx = { clock: { ctx: () => c }, store, settings: () => settings };
  let st = stateFor(ctx, data);
  assert.equal(st.budget.newPerDay, 4);
  assert.ok(st.budget.newLeft > 0, 'new items left before the round');
  // a grammar topic, all of it: more new items than today's allowance
  const spec = C.parseKind('topic:verb-final');
  const b = C.buckets(st, spec);
  const p = RS.pick(b, 'all');
  assert.ok(p.over > 0, `the round adds ${p.over} new items beyond today's ${b.newLeft}`);
  // answer every first showing right; the scheduler takes each card as it takes any new one
  const round = S.startRound(p.ids, spec, c.today, 1);
  round.size = 'all';
  const day = st.day;
  let now = 1000;
  while (round.i < round.queue.length) {
    const entry = S.current(round, data.byId, store.cards('b1'));
    if (!entry) break;
    const res = S.answer({ round, entry, o: { ok: true, ms: 3000 }, cards: store.cards('b1'), day, c, now: now += 1000 });
    if (res.rec) store.putCards('b1', [[entry.item.id, res.rec]]);
    S.advance(round);
  }
  store.set('b1.session', { ...store.get('b1.session', {}), day });
  // every item of the round has its card, the new ones with a first review today
  for (const id of p.ids) assert.ok(store.cards('b1')[id]?.reps, `${id} is scheduled`);
  assert.equal(day.newShown, p.fresh + p.over, 'every new item counts as shown today');
  // Today: no new items left (never a negative number), and the plan offers no new ones
  st = stateFor(ctx, data);
  assert.equal(st.budget.newLeft, 0);
  assert.equal(C.newLeft(st), 0);
  assert.ok(!C.compose(st, { kind: 'today' }).some(id => !store.cards('b1')[id]?.reps), 'the next daily round brings nothing new');
  const tb = todayBudget({ store, c, settings, t, exam: null });
  assert.equal(tb.newLeft, 0);
  const row = planItems({ store, c, settings, t, exam: null }).find(r => r.id === 'practice.round');
  assert.ok(!row || !/plan\.(new|review)\.detailNew/.test(row.detail), 'the review row promises no new items');
  // the load is real: the cards learnt today come back within days, so the coming days' forecast holds them
  const soon = Object.values(store.cards('b1')).filter(r => r.due <= add(TODAY, 3)).length;
  assert.ok(soon >= p.over, `${soon} of the round's cards are due within 3 days`);
  // the day's budget, read again from the same numbers, agrees
  // (round 3: the one allowance replaces dayBudget; same check)
  assert.equal(allowance({ c, settings, decks: { b1: { due: 0, shown: day.newShown } } }).newLeft, 0);
});

test('clusters and situations: their own buckets and allowances', () => {
  const c = context({ today: TODAY, exam: EXAM });
  const cb = CI.buckets({ ids: ['W:a', 'W:b', 'W:c', 'W:d'], cards: { 'W:a': seen(TODAY), 'W:b': seen(add(TODAY, 5)) }, c, isDue: r => r.due <= TODAY, recall: () => 0.5,
    zipf: id => ({ 'W:c': 3, 'W:d': 5 })[id] });
  assert.deepEqual([cb.due, cb.rest, cb.fresh], [['W:a'], ['W:b'], ['W:d', 'W:c']], 'new cards most common first');
  // changed in round 3: a cluster list is part of the day's allowance (its share, at most a round's NEW_PER_ROUND)
  assert.equal(cb.newLeft, CI.NEW_PER_ROUND); assert.equal(cb.daily, true);
  assert.equal(CI.buckets({ ids: ['W:c'], cards: {}, c, isDue: () => false, recall: () => 0, newLeft: 2 }).newLeft, 2);
  assert.equal(CI.buckets({ ids: ['W:c'], cards: {}, c, isDue: () => false, recall: () => 0, newLeft: 0 }).newLeft, 0, 'paused in exam week');
  const items = [{ id: 'SS:a', lv: 'A1', fn: 'agree', freq: 1 }, { id: 'SS:b', lv: 'A1', fn: 'agree', freq: 2 }, { id: 'SS:c', lv: 'A1', fn: 'decline', freq: 1 }];
  const sb = SM.buckets({ items, cards: { 'SS:a': seen(TODAY) }, c, pick: { kind: 'fn', fn: 'agree' }, start: 'A1', newLeft: 3 });
  assert.deepEqual([sb.due, sb.fresh], [['SS:a'], ['SS:b']]);
  assert.equal(sb.newLeft, SM.PICK_NEW); assert.equal(sb.daily, false);
  assert.equal(SM.buckets({ items, cards: {}, c, pick: { kind: 'mixed' }, start: 'A1', newLeft: 3 }).newLeft, 3);
});
