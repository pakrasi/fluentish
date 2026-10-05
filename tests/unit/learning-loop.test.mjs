// Round 3 learning loop (journey #3, #4, #6): "Show me" on a new item is a study step, free-write corrections become
// mistake cards, and Where you stand never drops because he studied. Synthetic records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { context } from '../../src/core/clock.js';
import * as FS from '../../src/domain/fsrs.js';
import * as D8 from '../../src/domain/days.js';
import RD from '../../src/domain/b1ready.js';
import { knowledge, resolver } from '../../src/domain/knowledge.js';
import { modulesStanding, weakest, knownOf, week } from '../../src/domain/standing.js';
import * as S from '../../src/features/practice/session.js';
import * as C from '../../src/features/practice/compose.js';
import { buildPool } from '../../src/features/practice/pool.js';
import { planMistakes, freeWriteMistakes } from '../../src/data/mistakes.js';
import { planItems } from '../../src/features/practice/plan.js';

const EXAM = '2026-10-09';
const TODAY = '2026-10-05';
const c = context({ today: TODAY, exam: EXAM });
const item = (id, o = {}) => ({ id, kind: 'phrase', area: 'speaking', group: 'S1', star: false, trap: null, level: 'B1', ...o });
const graduated = (o = {}) => ({ S: 20, D: 5, reps: 4, lapses: 0, first: '2026-09-10', last: '2026-10-01', due: '2026-10-05', stage: 1, streak: 0, learn: null, relearn: false, hist: [['2026-10-01', 3, 3000, 't', '']], ...o });

/** Answer the entry at the round's position; returns the new record (written to cards). */
function answer(round, byId, cards, day, o) {
  const entry = S.current(round, byId, cards);
  const res = S.answer({ round, entry, o, cards, day, c, now: Date.now() });
  if (res.rec) cards[entry.item.id] = res.rec;
  S.advance(round);
  return res;
}

test('Show me on a new item is a study step: not a miss, not a lapse, not a harder card', () => {
  const pool = [item('BP:new'), item('BP:typed'), item('BP:known')];
  const byId = new Map(pool.map(it => [it.id, it]));
  const cards = /** @type {Record<string, any>} */ ({ 'BP:known': graduated() });
  const day = C.newDay(TODAY);
  const round = S.startRound(['BP:new', 'BP:typed', 'BP:known'], { kind: 'today' }, TODAY, 1);
  // 1. Show me on a never-seen item (revealed before any answer)
  answer(round, byId, cards, day, { ok: false, ms: 2000, revealed: true });
  const shown = cards['BP:new'];
  assert.equal(shown.lapses, 0, 'no lapse');
  assert.equal(shown.learn, 0, 'its learning steps start');
  assert.match(shown.hist[0][4], /v/, 'logged as a study step');
  assert.deepEqual([shown.S, shown.D], [FS.init(3).S, FS.init(3).D], 'not made a harder card (Again would give D 7.6)');
  assert.equal(round.results[0].study, true);
  // 2. a wrong typed answer on a new item is still a miss (he tried and was wrong)
  answer(round, byId, cards, day, { ok: false, ms: 6000, revealed: false });
  assert.doesNotMatch(cards['BP:typed'].hist[0][4], /v/);
  // 3. a real lapse on a graduated card is still a lapse
  answer(round, byId, cards, day, { ok: false, ms: 6000, revealed: true });
  assert.equal(cards['BP:known'].lapses, 1); assert.equal(cards['BP:known'].relearn, true);
  // the segments: seen (ink), miss (red), miss
  assert.deepEqual(S.dots(round).slice(0, 3), ['seen', 'miss', 'miss']);
  // missed in the last 3 days: the typed miss and the lapse, never the study step
  const st = { data: { pool, byId, topics: new Map() }, cards, day, c, newPerDay: 10 };
  assert.deepEqual(C.missed(st).map(it => it.id).sort(), ['BP:known', 'BP:typed']);
  // the done screen: the study step is new, not back, and not counted as an answer
  const sum = S.summary(round, byId);
  assert.ok(sum.news.some(it => it.id === 'BP:new'));
  assert.ok(!sum.back.some(it => it.id === 'BP:new'));
  assert.equal(sum.total, 2);
  // the knowledge score never reads the study step as a lapse
  const k = knowledge({ today: D8.add(TODAY, 1), decks: { b1: cards } });
  const later = FS.schedule(cards['BP:new'], { g: 3, ms: 2000 }, { ...c, today: TODAY });
  assert.deepEqual([later.rec.S, later.rec.D], [FS.init(3).S, FS.init(3).D], 'the first real answer sets S and D');
  const kGrad = knowledge({ today: D8.add(TODAY, 1), decks: { b1: { 'BP:new': FS.schedule(later.rec, { g: 3, ms: 2000 }, { ...c, today: TODAY }).rec } } });
  assert.notEqual(kGrad.get('BP:new').state, 'shaky', 'no lapse from the study step');
  assert.equal(k.get('BP:known').state === 'known', false, 'the real lapse counts from the next day');
  // a study step graded later with Again sets D from that answer, as a first answer would
  const again = FS.schedule(shown, { g: 1, ms: 2000 }, { ...c, today: TODAY });
  assert.deepEqual([again.rec.S, again.rec.D], [FS.init(1).S, FS.init(1).D]);
});

test('free-write corrections become mistake cards (F:), once per correction, reviewed with the others', () => {
  const body = ['! circa 28 / 40', '_Erfüllung 8 · Kohärenz 7 · Wortschatz 7 · Strukturen 6_', 'Gut gemacht.',
    '~~Ich komme nicht, weil ich habe keine Zeit.~~ → ==Ich komme nicht, weil ich keine Zeit habe.==', '_Nach weil steht das Verb am Ende._',
    '~~Ich freue mich für das Treffen.~~ → ==Ich freue mich auf das Treffen.==', '_sich freuen auf_'].join('\n');
  const o = freeWriteMistakes({ taskId: 'a1-umzug', at: 1790000000000, label: 'Schreiben Aufgabe 1 · Umzug', body });
  assert.deepEqual([o.attemptId, o.module, o.items.length], ['W-a1-umzug-1790000000000', 'schreiben', 2]);
  const { next, added } = planMistakes({}, o, '2026-10-05T10:00:00Z');
  assert.deepEqual(added, ['F:W-a1-umzug-1790000000000-1', 'F:W-a1-umzug-1790000000000-2']);
  assert.equal(next[added[0]].rule, 'Nach weil steht das Verb am Ende.');
  // asking again for the same correction keeps the ids (and their schedules)
  assert.deepEqual(planMistakes(next, o, '2026-10-05T11:00:00Z').added, []);
  // the pool asks them as "rewrite this sentence", labelled with the task
  const data = buildPool({ items: [], grammar: [], bank: {}, plan: { topics: [], traps: [], functions: [] }, mistakes: Object.values(next) });
  const it = data.byId.get(added[0]);
  assert.equal(it.area, 'mistakes'); assert.equal(it.source, 'Schreiben Aufgabe 1 · Umzug'); assert.equal(it.model, 'Ich komme nicht, weil ich keine Zeit habe.');
  // Today's mistakes row picks them up (their share of the day's allowance comes first)
  const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
  const settings = { language: 'german', minutesPerDay: 60, newPerDay: null, practice: {}, exam: { type: 'goethe-b1', date: EXAM, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] } };
  const store = { cards: () => ({}), get: (n, f) => (n === 'mistakes' ? next : f), attempts: () => [] };
  const row = planItems({ store, c, settings, exam: null, t }).find(r => r.id === 'practice.mistakes');
  assert.ok(row); assert.match(row.detail, /"n":2/);
});

test('Where you stand never drops because he studied; a miss shows from the next day', () => {
  const resolve = resolver({});
  const pool = [item('BP:a'), item('BP:b'), item('BP:c'), item('BS:w1', { area: 'writing' }), item('BL:r1', { area: 'reading' }), item('BG:g1', { area: 'grammar' })];
  const byId = new Map(pool.map(it => [it.id, it]));
  const modules = [{ id: 'lesen', name: 'Lesen', score: 25, max: 30, pass: 18 }, { id: 'hoeren', name: 'Hören', score: 20, max: 30, pass: 18 },
    { id: 'schreiben', name: 'Schreiben', score: null, max: 100, pass: 60 }, { id: 'sprechen', name: 'Sprechen', score: null, max: 100, pass: 60 }];
  const cards = /** @type {Record<string, any>} */ ({
    'BP:a': graduated({ last: '2026-10-04', due: '2026-10-05' }),          // known, will lapse today
    'BP:b': graduated({ last: '2026-10-04', due: '2026-10-05' }),          // known, answered right today
    'BS:w1': graduated({ S: 2, last: '2026-09-28', due: '2026-10-01' }),   // shaky, answered right today
    'BL:r1': graduated({ last: '2026-10-04', due: '2026-10-20' }),         // known, not due
  });
  const counts = (/** @type {any} */ decks, /** @type {string} */ day) => {
    const k = knowledge({ today: day, decks, resolve });
    const get = (/** @type {string} */ id) => k.get(resolve(id, 'b1') || id);
    return { all: knownOf(pool.map(it => it.id), get).known, ms: modulesStanding({ modules, pool, get }).map(m => m.items.known) };
  };
  const before = counts({ b1: structuredClone(cards) }, TODAY);
  // a round: a lapse, a right answer, Show me on a new item then its retry, a shaky card answered right
  const day = C.newDay(TODAY);
  const round = S.startRound(['BP:a', 'BP:b', 'BP:c', 'BS:w1'], { kind: 'today' }, TODAY, 1);
  answer(round, byId, cards, day, { ok: false, ms: 9000 });
  answer(round, byId, cards, day, { ok: true, ms: 2000 });
  answer(round, byId, cards, day, { ok: false, ms: 1000, revealed: true });
  answer(round, byId, cards, day, { ok: true, ms: 2000 });
  while (round.i < round.queue.length) answer(round, byId, cards, day, { ok: true, ms: 2000 });
  const after = counts({ b1: cards }, TODAY);
  assert.ok(after.all >= before.all, `known ${before.all} → ${after.all}`);
  after.ms.forEach((n, i) => assert.ok(n >= before.ms[i], `module ${modules[i].id}: ${before.ms[i]} → ${n}`));
  assert.ok(after.all > before.all, 'the shaky card answered right today is known now');
  // the next morning the lapse shows: honest, and not caused by studying today
  const tomorrow = counts({ b1: cards }, D8.add(TODAY, 1));
  assert.ok(tomorrow.all < after.all, 'BP:a counts as missed from tomorrow');
  // the old readiness number, the B1 pool's expected recall on the exam day, did drop at once after the same round:
  // a lapse cuts the card's stability, so its recall on the exam day falls (the 7% → 6% case)
  const rd = (/** @type {any} */ cs) => RD.compute({ pool, store: cs, today: TODAY, exam: EXAM, phase: 'week' }).overall.recall;
  const pre = { 'BP:a': graduated({ last: '2026-10-04', due: '2026-10-05' }) };
  const post = { 'BP:a': FS.schedule(pre['BP:a'], { g: 1, ms: 9000 }, c).rec };
  assert.ok(rd(post) < rd(pre), `a miss alone lowered the old number: ${rd(pre).toFixed(4)} → ${rd(post).toFixed(4)}`);
  // under the one definition the item missed today stays known today (relearnt in the round), and is shaky tomorrow
  const k = (/** @type {string} */ d) => knowledge({ today: d, decks: { b1: post } }).get('BP:a').state;
  assert.deepEqual([k(TODAY), k(D8.add(TODAY, 1))], ['known', 'shaky']);
});

test('a concept is not lowered by starting a new item in it', () => {
  const day = TODAY;
  const known = graduated({ last: '2026-10-04', due: '2026-10-20' });
  const k1 = knowledge({ today: day, decks: { b1: { 'G:1': known, 'G:2': known } } });
  const c1 = k1.concept('c', ['G:1', 'G:2', 'G:3']);
  const fresh = FS.schedule(null, { g: 1, ms: 2000, study: true }, { ...c, today: day }).rec;
  const k2 = knowledge({ today: day, decks: { b1: { 'G:1': known, 'G:2': known, 'G:3': fresh } } });
  const c2 = k2.concept('c', ['G:1', 'G:2', 'G:3']);
  assert.equal(c1.state, 'known'); assert.equal(c2.state, 'known', 'a learning item counts for coverage only');
  assert.ok(c2.coverage > c1.coverage);
});

test('Where you stand: the weakest module, and this week for a learner with no exam ahead', () => {
  const ms = modulesStanding({ modules: [{ id: 'lesen', name: 'Lesen', score: 25, max: 30, pass: 18 }, { id: 'schreiben', name: 'Schreiben', score: null, max: 100, pass: 60 },
    { id: 'sprechen', name: 'Sprechen', score: 50, max: 100, pass: 60 }], pool: [], get: () => ({ state: 'unseen' }) });
  assert.deepEqual(ms.map(m => m.status), ['pass', 'none', 'below']);
  assert.equal(weakest(ms), 'schreiben', 'no score first, then under the pass line');
  assert.equal(weakest(ms.filter(m => m.id !== 'schreiben')), 'sprechen');
  const decks = { b1: { a: graduated({ first: '2026-10-02', learn: null, hist: [['2026-10-02', 3, 3000, 't', ''], ['2026-10-03', 3, 3000, 't', '']] }), imported: graduated({ first: '2026-10-03', hist: [] }), b: graduated({ hist: [['2026-10-03', 1, 3000, 't', '']] }), c: graduated({ first: TODAY, learn: 0, hist: [[TODAY, 1, 1000, 't', 'v']] }) } };
  assert.deepEqual(week(decks, TODAY, D8.diff), { learnt: 1, lapsed: 1 }, 'a study step is neither learnt nor lapsed');
});
