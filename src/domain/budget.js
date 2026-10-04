/* How much practice fits in a day: new items, minutes and rounds. Pure, no storage or clock reads; tested in node and
   portable to iOS as is.

   This is the ONE place that answers "how much today". Today's plan row (features/practice/plan.js), Practice's hub
   (new items left, the Start button, the pace line) and the round's composer quota all read dayBudget(), so the three
   screens can never disagree.

   New items a day:
     - none on the eve or the exam day (clock ctx.newItems)
     - a number the learner set in this app (settings.newPerDay with a rev stamp) is used as is. A number carried over
       from Igloo has no rev stamp and counts as Auto: the old app's 30 a day would switch the date-driven pacing off.
     - Auto: what fits in the daily minutes after today's reviews (half the minutes while mock modules are planned,
       the other half is theirs), and with an exam ahead no more than what keeps pace with the ★ and trap items left
       before the last new-item day (exam−2). At least 4 (one round's worth), at most 60; 20 without a date.
   Minutes and rounds: a round is 12 questions, about 4 minutes; a new item costs about 0.75 min inside rounds (shown,
   learnt, seen again). Rounds are whole, and the minutes shown are rounds × 4, so "4 rounds, 16 min" always adds up. */
import * as D8 from './days.js';

export const ROUND = 12;
export const ROUND_MIN = 4;
export const NEW_ITEM_MIN = 0.75;
/** Phrases, situations and words ('p') against grammar ('g'). */
export const SPLIT = /** @type {Record<'p'|'g', number>} */ ({ p: 40 / 55, g: 15 / 55 });

/** Review minutes for n due items. @param {number} n */
const reviewMin = n => (n / ROUND) * ROUND_MIN;

/** Whether the learner chose a number of new items in this app (not Auto, not a value carried over). @param {any} settings */
export const newPerDayChosen = settings => Number.isInteger(settings?.newPerDay) && !!settings?.rev?.newPerDay;

/**
 * @typedef {object} Budget
 * @property {number} newPerDay    new items for the whole day
 * @property {number} newLeft      new items still to show today
 * @property {number} rounds       rounds that today's due and new items take (0 when there is nothing)
 * @property {number} minutes      rounds × 4
 * @property {{lastNew: string, left: number, needed: number, reach: number, fits: boolean} | null} pace
 *           with an exam ahead and new days left: ★/trap items left, the daily number that meets them all by the last
 *           new day, and how many the budget meets
 */

/**
 * @param {object} o
 * @param {import('../core/clock.js').ClockCtx} o.c
 * @param {any} o.settings          normalised profile settings
 * @param {number} o.dueN           reviews due today (mistakes from corrections excluded)
 * @param {number | null} [o.priorityLeft]  starred and trap items not seen yet; null before the pool was ever loaded
 * @param {number} [o.newShown]     new items already shown today
 * @param {number} [o.poolLeft]     unseen items left in the pool
 * @returns {Budget}
 */
export function dayBudget({ c, settings, dueN, priorityLeft = null, newShown = 0, poolLeft = Infinity }) {
  const newPerDay = dailyNew({ c, settings, dueN, priorityLeft });
  const newLeft = c.newItems ? Math.max(0, Math.min(newPerDay - newShown, poolLeft)) : 0;
  const raw = reviewMin(dueN) + newLeft * NEW_ITEM_MIN;
  const rounds = dueN + newLeft > 0 ? Math.max(1, Math.ceil(raw / ROUND_MIN - 1e-9)) : 0;
  let pace = null;
  if ((c.phase === 'week' || c.phase === 'lastNew') && c.lastNewDay && priorityLeft != null) {
    const days = Math.max(1, D8.diff(c.today, c.lastNewDay) + 1);
    const needed = Math.ceil(priorityLeft / days);
    pace = { lastNew: c.lastNewDay, left: priorityLeft, needed, reach: Math.min(priorityLeft, newPerDay * days), fits: newPerDay >= needed };
  }
  return { newPerDay, newLeft, rounds, minutes: rounds * ROUND_MIN, pace };
}

/**
 * New items for the day (see the header).
 * @param {{c: import('../core/clock.js').ClockCtx, settings: any, dueN: number, priorityLeft: number | null}} o
 */
export function dailyNew({ c, settings, dueN, priorityLeft }) {
  if (!c.newItems) return 0;
  if (newPerDayChosen(settings)) return Math.max(0, settings.newPerDay);
  const minutes = settings.minutesPerDay || 60;
  const share = settings.exam?.type && c.mocks ? 0.5 : 1;
  const fit = Math.max(0, Math.floor((minutes * share - reviewMin(dueN)) / NEW_ITEM_MIN));
  if (c.phase === 'week' || c.phase === 'lastNew') {
    const newDays = Math.max(1, D8.diff(c.today, /** @type {string} */ (c.lastNewDay)) + 1);
    const pace = priorityLeft == null ? fit : Math.ceil(priorityLeft / newDays);
    return Math.max(4, Math.min(fit, pace, 60));
  }
  return Math.max(4, Math.min(fit, 20));
}

/** A stream's share of n new items; the two shares always add up to n. @param {number} n @param {'p'|'g'} st */
export const streamQuota = (n, st) => (st === 'p' ? Math.round(n * SPLIT.p) : n - Math.round(n * SPLIT.p));
