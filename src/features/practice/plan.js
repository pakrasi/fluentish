/* Practice's offer for Today's plan (docs/CONTRIBUTING-FEATURES.md). planItems is pure over ctx: no DOM, no fetches,
   no content. The pool-wide numbers it needs (★ and trap items not seen yet, unseen items) come from
   'b1.session'.stats, which Practice writes whenever it builds the pool; prepare() builds it before Today composes,
   so Today and Practice read the same day budget (domain/budget.js) from the same inputs.

   Rows: the warm-up on the exam day; the review round (due + new, about N rounds); mistakes from corrections; the
   Sprechen frames on the eve; the Teil 2 talk while the exam is ahead. When today's rounds are done and nothing is
   due, the round row shows done. */
import { isDue, dueOn } from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { dayBudget, ROUND } from '../../domain/budget.js';
import { add } from '../../core/clock.js';
import { scriptPlanItems, scriptNewShown } from './script/today.js';

/**
 * Refresh the pool stats Today reads (loads the content once; cached for the session). Never throws.
 * @param {any} ctx a view ctx (content, clock, store, settings)
 */
export async function prepare(ctx) {
  try {
    const { loadData, stateFor } = await import('./data.js');
    if (!ctx.settings().language) return;
    stateFor(ctx, await loadData(ctx));
  } catch { /* offline: Today plans from the last stats */ }
}

/**
 * Today's budget from the store and the cached stats: the numbers the plan row, the hub and the round agree on.
 * @param {import('../contract.js').PlanCtx} ctx
 */
export function todayBudget({ store, c, settings }) {
  const cards = store.cards('b1');
  const mistakeIds = new Set(Object.values(store.get('mistakes', {}) || {}).filter((/** @type {any} */ m) => m && !m.deletedAt).map((/** @type {any} */ m) => m.id));
  const due = Object.entries(cards).filter(([id, r]) => !mistakeIds.has(id) && isDue(r, c.today, c)).length;
  const sess = store.get('b1.session', {}) || {};
  const stats = sess.stats && sess.stats.day === c.today ? sess.stats : null;
  const day = sess.day && sess.day.day === c.today ? sess.day : null;
  const poolLeft = stats ? (stats.unseen ?? Math.max(0, stats.pool - Object.keys(cards).length)) : Infinity;
  // new script words shown today count as new items shown, so scripts never add to the day's new load
  const budget = dayBudget({ c, settings, dueN: due, priorityLeft: stats ? stats.priorityLeft : null, newShown: (day ? day.newShown || 0 : 0) + scriptNewShown(store, c.today), poolLeft });
  const act = (store.get('activity', {}) || {})[c.today];
  const roundsToday = Math.max(act ? act.rounds || 0 : 0, day ? day.rounds || 0 : 0);
  return { ...budget, due, roundsToday };
}

/**
 * The label of the button that starts the next review round, shared by Today's dock and Practice's hub. It counts the
 * rounds the plan row shows ("about 6 rounds" → "Start round 1 of 6"), so the button and the row say the same.
 * @param {{rounds: number, roundsToday: number}} b @param {number} n questions in the next round @param {(k: string, v?: any) => string} t
 */
export function roundAction(b, n, t) {
  return b.rounds > 1 ? t('plan.round.actionOf', { k: 1, total: b.rounds, n }) : t('plan.round.action', { n, min: roundMinutes(n) });
}

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t, exam }) {
  if (settings.language !== 'german') return [];   // phase 1: the practice content is German; never German for another language
  if (c.phase === 'day') {
    return [{ id: 'practice.warmup', source: 'practice', kind: 'warmup', title: t('plan.warmup'), detail: t('plan.warmup.detail'),
      minutes: 3, href: '#/practice/round?kind=warmup', priority: 10, action: t('plan.warmup.action') }];
  }
  const cards = store.cards('b1');
  const recs = Object.entries(cards);
  const mistakes = Object.values(store.get('mistakes', {}) || {}).filter((/** @type {any} */ m) => m && !m.deletedAt);
  const b = todayBudget({ store, c, settings, t, exam });
  const due = b.due, fresh = b.newLeft;
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  if (due > 0 || fresh > 0) {
    const n = Math.min(ROUND, due + fresh);
    const what = due > 0 ? (fresh > 0 ? t('plan.review.detailNew', { due, fresh }) : t('plan.review.detail', { n: due, due })) : t('plan.new.detail', { n: fresh });
    out.push({
      id: 'practice.round', source: 'practice', kind: due > 0 ? 'review' : 'new', introducesNew: due === 0,
      title: recs.length ? t('plan.review') : t('plan.firstRound'),
      detail: b.rounds > 1 ? `${what} · ${t('plan.rounds', { n: b.rounds })}` : what,
      minutes: b.minutes, href: '#/practice/round', priority: 20, rounds: b.rounds,
      action: roundAction(b, n, t),
    });
  } else if (b.roundsToday > 0) {
    out.push({ id: 'practice.round', source: 'practice', kind: 'review', title: t('plan.review'), detail: t('plan.review.none'), minutes: 0, href: '#/practice', priority: 20, done: true });
  }
  // mistakes from corrections: due ones and ones not practised yet
  const mDue = mistakes.filter((/** @type {any} */ m) => isDue(cards[m.id], c.today, c)).length;
  const mNew = c.newItems ? mistakes.filter((/** @type {any} */ m) => !cards[m.id]?.reps).length : 0;
  if (mDue + mNew > 0) {
    const n = Math.min(ROUND, mDue + mNew);
    out.push({ id: 'practice.mistakes', source: 'practice', kind: 'mistakes', introducesNew: mDue === 0, title: t('practice.plan.mistakes'),
      detail: t('practice.plan.mistakes.detail', { n: mDue + mNew }), minutes: roundMinutes(n), href: '#/practice/round?kind=mistakes', priority: 25,
      action: t('practice.plan.mistakes.action', { n, min: roundMinutes(n) }) });
  }
  if (c.phase === 'eve') {
    out.push({ id: 'practice.frames', source: 'practice', kind: 'read', title: t('plan.frames'), detail: t('plan.frames.detail'), minutes: 5, href: '#/lookup/frames', priority: 45 });
  }
  const goalSpeaking = settings.exam.type && settings.exam.modules.includes('sprechen');
  if (goalSpeaking && (c.phase === 'week' || c.phase === 'lastNew')) {
    out.push({ id: 'practice.teil2', source: 'practice', kind: 'speak', title: t('plan.teil2'), detail: t('plan.teil2.detail'), minutes: 6, href: '#/practice/speak/teil2', priority: 50 });
  }
  out.push(...scriptPlanItems({ store, c, settings, t }));
  return out;
}

/** Cards due tomorrow, for "Done for today. Tomorrow: about N due." @param {import('../contract.js').PlanCtx} ctx */
export function dueTomorrow({ store, c }) {
  const tomorrow = add(c.today, 1);
  return Object.values(store.cards('b1')).filter(r => r && r.reps && ((dueOn(r, c) || '') <= tomorrow || r.learn != null || r.relearn)).length;
}
