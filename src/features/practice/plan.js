/* Practice's offer for Today's plan. Stage A: the review round from the B1 cards in the store, Teil 2 speaking when
   the goal includes Sprechen, the frames read-through on the eve and the warm-up on the exam day. Stage B replaces
   the new-item estimate with the composer's real quota (priority items left ÷ new-days left, within the minutes).
   Pure over ctx: no DOM, no fetches. */
import { isDue } from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { add } from '../../core/clock.js';

/** New items per day when the profile says "Auto" and the composer has not been built yet. */
export const AUTO_NEW = 8;

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t }) {
  if (!settings.language) return [];
  if (c.phase === 'day') {
    return [{ id: 'practice.warmup', source: 'practice', kind: 'warmup', title: t('plan.warmup'), detail: t('plan.warmup.detail'),
      minutes: 3, href: '#/practice/round?kind=warmup', priority: 10, action: t('plan.warmup.action') }];
  }
  const cards = store.cards('b1');
  const recs = Object.values(cards);
  const due = recs.filter(r => isDue(r, c.today)).length;
  const fresh = c.newItems ? (settings.newPerDay ?? AUTO_NEW) : 0;
  const act = (store.get('activity', {}) || {})[c.today];
  const roundsToday = act ? act.rounds || 0 : 0;
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  if (due > 0 || fresh > 0) {
    const n = Math.min(12, due + fresh);
    out.push({
      id: 'practice.round', source: 'practice', kind: due > 0 ? 'review' : 'new', introducesNew: due === 0,
      title: recs.length ? t('plan.review') : t('plan.firstRound'),
      detail: due > 0 ? (fresh > 0 ? t('plan.review.detailNew', { due, fresh }) : t('plan.review.detail', { due })) : t('plan.new.detail', { n: fresh }),
      minutes: roundMinutes(due + fresh), href: '#/practice/round', priority: 20,
      action: t('plan.round.action', { n, min: roundMinutes(n) }),
    });
  } else if (roundsToday > 0) {
    out.push({ id: 'practice.round', source: 'practice', kind: 'review', title: t('plan.review'), detail: t('plan.review.none'), minutes: 0, href: '#/practice', priority: 20, done: true });
  }
  if (c.phase === 'eve') {
    out.push({ id: 'practice.frames', source: 'practice', kind: 'read', title: t('plan.frames'), detail: t('plan.frames.detail'), minutes: 5, href: '#/lookup/frames', priority: 45 });
  }
  const goalSpeaking = settings.exam.type && settings.exam.modules.includes('sprechen');
  if (goalSpeaking && (c.phase === 'week' || c.phase === 'lastNew')) {
    out.push({ id: 'practice.teil2', source: 'practice', kind: 'speak', title: t('plan.teil2'), detail: t('plan.teil2.detail'), minutes: 6, href: '#/practice/speak/teil2', priority: 50 });
  }
  return out;
}

/** Cards due tomorrow, for "Done for today. Tomorrow: about N due." @param {import('../contract.js').PlanCtx} ctx */
export function dueTomorrow({ store, c }) {
  const tomorrow = add(c.today, 1);
  return Object.values(store.cards('b1')).filter(r => r && r.reps && (r.due <= tomorrow || r.learn != null || r.relearn)).length;
}
