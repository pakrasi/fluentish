/* Reading's offer for Today's plan.
     Saved words   due reading cards, and new ones within today's share (the allowance's deck read): a review round
                   row, like Word clusters'.
     Reading       a text: the one he is in the middle of, else the library. On a Read day (ctx.day.slot 'read', the
                   week plan, lane L1b) it is the day's slot with the slot's minutes; otherwise, once he has a text, an
                   optional row of practice.readMin minutes (10). Done when today's reading minutes reach it.
   No row at all for a learner who never pasted a text and has no Read day, so Today is as it was. */
import { roundMinutes } from '../../domain/today.js';
import { todayBudget } from '../../domain/allowance.js';
import * as R from '../shared/read-data.js';

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t, day }) {
  if (settings.language !== 'german' || c.phase === 'day') return [];   // German content only; the exam day is the round's warm-up
  const deck = R.readDeck('de');
  /** @type {import('../../domain/today.js').PlanItem[]} */ const out = [];
  let b = null;
  try { b = todayBudget({ store, c, settings }); } catch { b = null; }
  const maint = !b || b.mode === 'maintenance' || b.mode === 'start';
  const bk = R.readBuckets(store, c, deck, R.readNewLeft(/** @type {any} */ (b), settings, c, R.shownToday(store, deck, c.today)));
  const fresh = Math.min(bk.fresh.length, bk.newLeft);
  const due = bk.due.length;
  if (due + fresh > 0) {
    const n = Math.min(R.ROUND, due + fresh);
    out.push({ id: 'read.review', source: 'practice-read', kind: due ? 'review' : 'new', reviews: due, introducesNew: !due && fresh > 0, title: t('read.plan.review'),
      detail: t('read.round.detail', { due, fresh }), minutes: roundMinutes(n), href: '#/practice/round?kind=read', priority: maint ? 39 : 55, noCut: true, optional: !due,
      action: t('read.plan.reviewAction', { n, min: roundMinutes(n) }) });
  }
  const texts = R.listReads(store);
  const slot = day && day.slot === 'read';
  if (!texts.length && !slot) return out;
  const min = slot && day.slotMin > 0 ? day.slotMin : Number.isFinite(settings?.practice?.readMin) ? settings.practice.readMin : R.READ_MIN;
  const act = (store.get('activity', {}) || {})[c.today];
  const readMin = act && act.by && Number(act.by.read) || 0;
  const open = texts.find(r => !r.progress?.done && (r.progress?.share || 0) > 0) || null;
  out.push({ id: 'read.text', source: 'practice-read', kind: 'read', title: t('read.plan.title'),
    detail: open ? t('read.plan.continue', { pct: Math.round((open.progress?.share || 0) * 100) }) : texts.length ? t('read.plan.pick') : t('read.plan.paste'),
    minutes: min, href: open ? `#/practice/read/${open.id}` : texts.length ? '#/practice/read' : '#/practice/read/new', priority: 45, noCut: true, optional: !slot,
    done: readMin >= min, action: t('read.plan.action', { min }) });
  return out;
}
