/* Word clusters' offer for Today's plan: due cards always (they are reviews like any other), and outside the exam
   their share of new cards from the cluster he studied last. */
import { roundMinutes } from '../../domain/today.js';
import { ROUND } from '../../domain/budget.js';
import { todayBudget } from '../../domain/allowance.js';

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t }) {
  if (settings.language !== 'german' || c.phase === 'day') return [];   // German content only; the exam day is the round's warm-up
  const b = todayBudget({ store, c, settings });
  const maint = b.mode === 'maintenance' || b.mode === 'start';
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  // word clusters: due cards always (they are reviews like any other), and outside the exam their share of new cards
  // from the cluster he studied last
  const cl = b.decks.clusters;
  const last = (store.get('clusters', {}) || {}).last;
  if (cl.due > 0) {
    const n = Math.min(ROUND, cl.due);
    out.push({ id: 'practice.clusters', source: 'practice-clusters', kind: 'review', reviews: cl.due, title: t('plan.clusters'), detail: t('plan.clusters.detail', { n: cl.due }),
      minutes: roundMinutes(n), href: '#/practice/round?kind=cluster%3Adue', priority: maint ? 38 : 55, noCut: true, action: t('plan.clusters.action', { n, min: roundMinutes(n) }) });
  } else if (cl.newLeft > 0 && last) {
    const n = Math.min(ROUND, cl.newLeft);
    out.push({ id: 'practice.clusters', source: 'practice-clusters', kind: 'new', introducesNew: true, title: t('plan.clusters'), detail: t('plan.clusters.new', { n }),
      minutes: roundMinutes(n), href: `#/practice/round?kind=${encodeURIComponent(`cluster:${last}`)}&from=today`, priority: 38, noCut: true, optional: true,
      action: t('plan.clusters.action', { n, min: roundMinutes(n) }) });
  }
  return out;
}
