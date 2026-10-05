// Practice's Today provider (src/features/practice/plan.js) over a synthetic store, and the composer rules it feeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { context } from '../../src/core/clock.js';
import { composeToday } from '../../src/domain/today.js';
import { planItems, dueTomorrow } from '../../src/features/practice/plan.js';
import { dots } from '../../src/features/practice/session.js';

const t = (k, v = {}) => `${k}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`;
const EXAM = '2026-10-09';
const settings = { language: 'german', exam: { type: 'goethe-b1', date: EXAM, modules: ['lesen', 'hoeren', 'schreiben', 'sprechen'] }, minutesPerDay: 60, newPerDay: null };
const card = (due, o = {}) => ({ S: 3, D: 5, reps: 2, lapses: 0, last: '2026-10-01', due, stage: 1, learn: null, relearn: false, hist: [], ...o });
// round 3: the store holds its cards in deck b1 only (the allowance and dueTomorrow read every deck; the old fake
// answered every deck with the same cards)
function store({ cards = {}, kv = {} } = {}) {
  return { cards: d => (d === 'b1' ? cards : {}), get: (n, f) => (n in kv ? kv[n] : f) };
}

test('plan: review round with the cached quota, mistakes row, Teil 2', () => {
  const c = context({ today: '2026-10-03', exam: EXAM });
  const s = store({ cards: { 'BP:a': card('2026-10-02'), 'BP:b': card('2026-10-05'), 'F:x-1': card('2026-10-03') },
    kv: { 'b1.session': { stats: { day: '2026-10-03', newPerDay: 20, priorityLeft: 100, pool: 900 }, day: { day: '2026-10-03', newShown: 5, rounds: 1 } },
      mistakes: { 'F:x-1': { id: 'F:x-1', deletedAt: null }, 'F:x-2': { id: 'F:x-2', deletedAt: null }, 'F:x-3': { id: 'F:x-3', deletedAt: '2026-10-02T00:00:00Z' } } } });
  const rows = planItems({ store: s, c, settings, exam: null, t });
  const round = rows.find(r => r.id === 'practice.round');
  assert.equal(round.kind, 'review');
  assert.match(round.detail, /"due":1,"fresh":15/, 'one due (mistakes count separately), 20 − 5 shown = 15 new');
  const m = rows.find(r => r.id === 'practice.mistakes');
  assert.match(m.detail, /"n":2/, 'one due + one unseen; deleted ones do not count');
  assert.ok(rows.some(r => r.id === 'practice.teil2'));
  // round 3 (journey #2): with no Schreiben score, Schreiben is the weakest module, so its mistakes come right after
  // the writing and before the review round (priority 19.5); without the focus they stay after it (25)
  assert.equal(m.priority, 19.5);
  const plan = composeToday({ ctx: c, budget: 60, items: rows });
  assert.deepEqual(plan.rows.map(r => r.id).slice(0, 2), ['practice.mistakes', 'practice.round']);
  const passed = { ...s, attempts: () => [{ module: 'schreiben', score: 80, max_score: 100, submitted_at: '2026-10-01T10:00:00Z' },
    { module: 'lesen', score: 15, max_score: 30, submitted_at: '2026-10-01T11:00:00Z' }] };
  assert.equal(planItems({ store: passed, c, settings, exam: null, t }).find(r => r.id === 'practice.mistakes').priority, 25);
});

test('plan: the eve has no new items and reads the frames; the exam day is a warm-up', () => {
  const s = store({ cards: { 'BP:a': card('2026-10-08') } });
  const eve = planItems({ store: s, c: context({ today: '2026-10-08', exam: EXAM }), settings, exam: null, t });
  assert.match(eve.find(r => r.id === 'practice.round').detail, /"due":1/);
  assert.ok(!eve.find(r => r.id === 'practice.round').introducesNew);
  assert.ok(eve.some(r => r.id === 'practice.frames'));
  assert.ok(!eve.some(r => r.id === 'practice.teil2'));
  const day = planItems({ store: s, c: context({ today: '2026-10-09', exam: EXAM }), settings, exam: null, t });
  assert.deepEqual(day.map(r => r.id), ['practice.warmup']);
});

test('plan: nothing due and no new left after a round shows the row done; no language, no rows', () => {
  const c = context({ today: '2026-10-03', exam: EXAM });
  const s = store({ cards: { 'BP:a': card('2026-10-06') }, kv: { 'b1.session': { stats: { day: '2026-10-03', newPerDay: 4, pool: 1 }, day: { day: '2026-10-03', newShown: 4, rounds: 2 } } } });
  const rows = planItems({ store: s, c, settings, exam: null, t });
  assert.equal(rows.find(r => r.id === 'practice.round').done, true);
  assert.deepEqual(planItems({ store: s, c, settings: { ...settings, language: null }, exam: null, t }), []);
  assert.equal(dueTomorrow({ store: store({ cards: { a: card('2026-10-04'), b: card('2026-10-09') } }), c }), 1);
});

test('segments show the current card\'s result once it is answered', () => {
  const round = { i: 1, queue: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], results: [{ id: 'a', ok: true }, { id: 'b', ok: false }] };
  assert.deepEqual(dots(round), ['done', 'now', '']);
  assert.deepEqual(dots(round, true), ['done', 'miss', '']);
});

test('Claude check: a neutral prompt and a strict verdict parser', async () => {
  const { checkPrompt, parseVerdict } = await import('../../src/services/claude.js');
  const p = checkPrompt({ kind: 'phrase', task: null, prompt: 'Deal!', model: 'Abgemacht!', accept: ['abgemacht'], hl: null, prefill: null }, 'Einverstanden!');
  assert.match(p, /The learner wrote: Einverstanden!/);
  assert.doesNotMatch(p, new RegExp(['Is' + 'haan', 'Fri' + 'tz', 'Produkt' + 'manager'].join('|')));
  assert.deepEqual(parseVerdict('Sure: {"verdict":"minor","note":"ok"}'), { verdict: 'minor', note: 'ok' });
  assert.deepEqual(parseVerdict('{"verdict":"maybe"}'), { verdict: 'wrong', note: '' });
  assert.deepEqual(parseVerdict('no json'), { verdict: 'wrong', note: '' });
});
