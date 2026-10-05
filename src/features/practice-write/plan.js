/* Schreiben's offer for Today's plan: while Schreiben is the weakest module (domain/modules.js writingFocus) a task
   written from memory before everything else (features/day.js puts a correction waiting right after it), and the
   Schreiben phrases' own rounds. Numbers from the one daily allowance (domain/allowance.js). */
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
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  const task = b.task;
  // Schreiben first while it is the weakest module: a task from memory (features/day.js puts a correction after it)
  if (task) {
    out.push(task.done
      ? { id: 'practice.schreiben', source: 'practice-write', kind: 'write', title: t('plan.schreiben'), detail: t('plan.schreiben.done', { n: task.a.slice(1) }), minutes: 0, href: '#/practice/write', priority: 18, done: true }
      : { id: 'practice.schreiben', source: 'practice-write', kind: 'write', title: t('plan.schreiben'), detail: t('plan.schreiben.detail', { n: task.a.slice(1), title: task.title }),
        minutes: task.min, href: `#/practice/write/build/${task.id}/free`, priority: 18, action: t('plan.schreiben.action', { min: task.min }) });
  }
  // Schreiben phrases: their own rounds; right after the review round while Schreiben is the weakest module
  const w = b.writing;
  if (w.due + w.newLeft > 0) {
    const n = Math.min(ROUND, w.due + w.newLeft);
    out.push({ id: 'practice.writing', source: 'practice-write', kind: 'write', introducesNew: w.due === 0, reviews: w.due, title: t('plan.writing'),
      detail: w.due && w.newLeft ? t('plan.review.detailNew', { due: w.due, fresh: w.newLeft }) : w.due ? t('plan.review.detail', { n: w.due, due: w.due }) : t('plan.new.detail', { n: w.newLeft }),
      minutes: w.minutes, href: '#/practice/round?kind=write', priority: w.focus ? 22 : 50, rounds: w.rounds,
      action: t('plan.writing.action', { n, min: roundMinutes(n) }) });
  } else if (w.focus && b.writeRounds > 0) {
    out.push({ id: 'practice.writing', source: 'practice-write', kind: 'write', title: t('plan.writing'), detail: t('plan.writing.done'), minutes: 0, href: '#/practice/write', priority: 22, done: true });
  }
  return out;
}
