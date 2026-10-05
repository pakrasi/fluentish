/* Practice round's offer for Today's plan (docs/CONTRIBUTING-FEATURES.md): the warm-up on the exam day, the review
   round (due + its share of new items, about N rounds) and mistakes from corrections. Pure over ctx: every number comes
   from the one daily allowance (domain/allowance.js); the pool-wide counts it needs come from 'b1.session'.stats,
   which prepare() refreshes before Today composes, so Today and Practice read the same numbers. When today's rounds
   are done and nothing is due, the round row shows done. */
import { roundMinutes } from '../../domain/today.js';
import { ROUND } from '../../domain/budget.js';
import { todayBudget, roundAction } from '../../domain/allowance.js';

/**
 * Refresh the pool stats Today reads (loads the content once; cached for the session). Never throws.
 * @param {any} ctx a view ctx (content, clock, store, settings)
 */
export async function prepare(ctx) {
  try {
    const { loadData, stateFor } = await import('../shared/data.js');
    if (!ctx.settings().language) return;
    stateFor(ctx, await loadData(ctx));
  } catch { /* offline: Today plans from the last stats */ }
}

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t }) {
  if (settings.language !== 'german') return [];   // phase 1: the practice content is German; never German for another language
  if (c.phase === 'day') {
    return [{ id: 'practice.warmup', source: 'practice-round', kind: 'warmup', title: t('plan.warmup'), detail: t('plan.warmup.detail'),
      minutes: 3, href: '#/practice/round?kind=warmup', priority: 10, action: t('plan.warmup.action') }];
  }
  const recs = Object.keys(store.cards('b1'));
  const b = todayBudget({ store, c, settings });
  const due = b.due, fresh = b.b1.newLeft;
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  if (due > 0 || fresh > 0) {
    const n = b.next || Math.min(ROUND, due + fresh);
    const what = due > 0 ? (fresh > 0 ? t('plan.review.detailNew', { due, fresh }) : t('plan.review.detail', { n: due, due })) : t('plan.new.detail', { n: fresh });
    out.push({
      id: 'practice.round', source: 'practice-round', kind: due > 0 ? 'review' : 'new', introducesNew: due === 0, reviews: due,
      title: recs.length ? t('plan.review') : t('plan.firstRound'),
      detail: b.rounds > 1 ? `${what} · ${t('plan.rounds', { n: b.rounds })}` : what,
      minutes: b.minutes, href: '#/practice/round', priority: 20, rounds: b.rounds,
      action: roundAction(b, n, t), actionFor: rounds => roundAction({ rounds }, n, t),
    });
  } else if (b.roundsToday > 0) {
    out.push({ id: 'practice.round', source: 'practice-round', kind: 'review', title: t('plan.review'), detail: t('plan.review.none'), minutes: 0, href: '#/practice', priority: 20, done: true });
  }
  // mistakes from corrections: due ones and ones not practised yet (their share of the day's new items comes first);
  // while Schreiben is the focus they come right after the writing and its correction
  const m = b.decks.mistakes;
  if (m.due + m.newLeft > 0) {
    const n = Math.min(ROUND, m.due + m.newLeft);
    out.push({ id: 'practice.mistakes', source: 'practice-round', kind: 'mistakes', introducesNew: m.due === 0, reviews: m.due, title: t('practice.plan.mistakes'),
      detail: t('practice.plan.mistakes.detail', { n: m.due + m.newLeft }), minutes: roundMinutes(n), href: '#/practice/round?kind=mistakes', priority: b.focus ? 19.5 : 25,
      action: t('practice.plan.mistakes.action', { n, min: roundMinutes(n) }) });
  }
  return out;
}
