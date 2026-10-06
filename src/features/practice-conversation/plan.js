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
  // without a Claude key the row says so and leads to Connections, not to a setup that says it (UX review P2-10)
  const key = !!(store.get('secrets', {}) || {}).anthropicKey;
  return [{ id: 'conversation.talk', source: 'practice-conversation', kind: 'speak', title: t('conv.plan.title'), detail: key ? t('conv.plan.detail') : t('conv.plan.noKey'),
    minutes: min, href: key ? '#/practice/conversation?from=today' : '#/profile/connections', priority: 50, done, action: key ? t('conv.plan.action', { min }) : t('conv.plan.addKey') }];
}
