/* Conversation's offer for Today's plan: on a Talk day of his week (ctx.day.slot 'talk', domain/week.js, lane L1b) one
   row of the slot's minutes, "Conversation". Done once a conversation of today has ended. No row on other days, so
   Today is as it was for a learner without a Talk day. The allowance already counts the slot's minutes. */

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t, day }) {
  if (!day || day.slot !== 'talk' || c.phase === 'day' || c.phase === 'eve') return [];
  const lang = settings && settings.language;
  if (lang && lang !== 'german') return [];   // the content pack is German's (other packs: when they ship conversation)
  const sessions = Object.values(store.get('conv.sessions', {}) || {});
  const done = sessions.some((/** @type {any} */ s) => s && !s.deletedAt && s.day === c.today && s.status !== 'open' && s.turns > 0);
  const min = day.slotMin > 0 ? day.slotMin : 10;
  return [{ id: 'conversation.talk', source: 'practice-conversation', kind: 'speak', title: t('conv.plan.title'), detail: t('conv.plan.detail'),
    minutes: min, href: '#/practice/conversation?from=today', priority: 50, done, action: t('conv.plan.action', { min }) }];
}
