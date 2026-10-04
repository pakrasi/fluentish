/* Practice's offer for Today's plan (docs/CONTRIBUTING-FEATURES.md). Pure over ctx: no DOM, no fetches, no content.
   The pool-wide numbers it needs (★ and trap items not seen yet) come from 'b1.session'.stats, which Practice writes
   whenever it builds the pool; before the first visit the review round assumes the Auto rule with no pace limit.

   Rows: the warm-up on the exam day; the review round (due + new, the composer's quota); mistakes from corrections;
   the Sprechen frames on the eve; the Teil 2 talk while the exam is ahead. When today's round is done and nothing is
   due, the round row shows done with "Another round" if new items are left. */
import { isDue } from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { add } from '../../core/clock.js';
import { dailyNew, ROUND } from './compose.js';

/** New items a day before Practice has computed the pace (kept for Today's tests and old callers). */
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
  const recs = Object.entries(cards);
  const mistakes = Object.values(store.get('mistakes', {}) || {}).filter((/** @type {any} */ m) => m && !m.deletedAt);
  const mistakeIds = new Set(mistakes.map((/** @type {any} */ m) => m.id));
  const due = recs.filter(([id, r]) => !mistakeIds.has(id) && isDue(r, c.today)).length;
  const sess = store.get('b1.session', {}) || {};
  const stats = sess.stats && sess.stats.day === c.today ? sess.stats : null;
  const perDay = stats ? stats.newPerDay : dailyNew({ c, settings, dueN: due, priorityLeft: null });
  const day = sess.day && sess.day.day === c.today ? sess.day : null;
  const shown = day ? day.newShown || 0 : 0;
  const poolLeft = stats ? Math.max(0, stats.pool - recs.length) : Infinity;
  const fresh = c.newItems ? Math.max(0, Math.min(perDay - shown, poolLeft)) : 0;
  const act = (store.get('activity', {}) || {})[c.today];
  const roundsToday = Math.max(act ? act.rounds || 0 : 0, day ? day.rounds || 0 : 0);
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  if (due > 0 || fresh > 0) {
    const n = Math.min(ROUND, due + fresh);
    out.push({
      id: 'practice.round', source: 'practice', kind: due > 0 ? 'review' : 'new', introducesNew: due === 0,
      title: recs.length ? t('plan.review') : t('plan.firstRound'),
      detail: due > 0 ? (fresh > 0 ? t('plan.review.detailNew', { due, fresh }) : t('plan.review.detail', { n: due, due })) : t('plan.new.detail', { n: fresh }),
      minutes: roundMinutes(due + Math.min(fresh, 24)), href: '#/practice/round', priority: 20,
      action: t('plan.round.action', { n, min: roundMinutes(n) }),
    });
  } else if (roundsToday > 0) {
    out.push({ id: 'practice.round', source: 'practice', kind: 'review', title: t('plan.review'), detail: t('plan.review.none'), minutes: 0, href: '#/practice', priority: 20, done: true });
  }
  // mistakes from corrections: due ones and ones not practised yet
  const mDue = mistakes.filter((/** @type {any} */ m) => isDue(cards[m.id], c.today)).length;
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
  return out;
}

/** Cards due tomorrow, for "Done for today. Tomorrow: about N due." @param {import('../contract.js').PlanCtx} ctx */
export function dueTomorrow({ store, c }) {
  const tomorrow = add(c.today, 1);
  return Object.values(store.cards('b1')).filter(r => r && r.reps && (r.due <= tomorrow || r.learn != null || r.relearn)).length;
}
