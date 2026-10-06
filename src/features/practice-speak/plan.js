/* Sprechen's offer for Today's plan: speaking situations (a short self-graded round after the reviews, from the
   allowance's speak share), the Sprechen frames to read on the eve, and the Teil 2 talk while the exam is ahead. */
import { ROUND_SIZE as SIM_ROUND } from '../../domain/sim.js';
import { simToday } from '../../domain/allowance.js';
import { hasMockExam } from '../../domain/modules.js';

/** Refresh the situations' stats Today reads (loads their bank once). Never throws. @param {any} ctx a view ctx */
export async function prepare(ctx) {
  try {
    if (!ctx.settings().language) return;
    const { refreshSimStats } = await import('../shared/sim-data.js');
    await refreshSimStats(ctx);
  } catch { /* offline: Today plans from the last stats */ }
}

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t }) {
  if (settings.language !== 'german' || c.phase === 'day') return [];   // German content only; the exam day is the round's warm-up
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  // speaking situations: a short self-graded round after the reviews
  const sim = simToday({ store, c, settings });
  if (sim.cards > 0) {
    const n = Math.min(SIM_ROUND, sim.cards);
    out.push({ id: 'practice.situations', source: 'practice-speak', kind: 'speak', introducesNew: sim.due === 0, reviews: sim.due, title: t('plan.sim'),
      detail: sim.due ? (sim.newLeft ? t('plan.sim.detailNew', { due: sim.due, fresh: sim.newLeft }) : t('plan.sim.detail', { n: sim.due })) : t('plan.sim.detailFresh', { n: sim.newLeft }),
      minutes: sim.minutes, href: '#/practice/situations/round?from=today', priority: 48, action: t('plan.sim.action', { n, min: Math.max(1, Math.ceil(n * 0.2)) }) });
  } else if (sim.roundsToday > 0) {
    out.push({ id: 'practice.situations', source: 'practice-speak', kind: 'speak', title: t('plan.sim'), detail: t('plan.sim.none'), minutes: 0, href: '#/practice/situations', priority: 48, done: true });
  }
  if (c.phase === 'eve') {
    out.push({ id: 'practice.frames', source: 'practice-speak', kind: 'read', title: t('plan.frames'), detail: t('plan.frames.detail'), minutes: 5, href: '#/lookup/frames', priority: 45 });
  }
  const goalSpeaking = hasMockExam(settings) && settings.exam.modules.includes('sprechen');
  if (goalSpeaking && (c.phase === 'week' || c.phase === 'lastNew')) {
    out.push({ id: 'practice.teil2', source: 'practice-speak', kind: 'speak', title: t('plan.teil2'), detail: t('plan.teil2.detail'), minutes: 6, href: '#/practice/speak/teil2', priority: 50 });
  }
  return out;
}
