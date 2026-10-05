/* Scripts' offer for Today's plan: their rows (domain/script/plan.js); their new words are the script deck's share of
   the day's allowance, and after the exam (maintenance) they are one of his goals. */
import { scriptPlanItems } from '../../domain/script/today.js';
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
  // scripts: their words are the script deck's share of the day; after the exam they are one of his goals (priority 30)
  out.push(...scriptPlanItems({ store, c: { ...c, dayNewLeft: b.decks.script.newLeft }, settings, t }).map(r => (maint && !r.done && r.priority > 30 ? { ...r, priority: 30 } : r)));
  return out;
}
