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
   learnt, seen again). Rounds are whole, and the minutes shown are rounds × 4, so "4 rounds, 16 min" always adds up.

   Schreiben (writingBudget): while Schreiben is the weakest exam module (focus) it gets up to 30% of the daily
   minutes, spent on writing first: the Schreiben row on Today reads a correction, gets one, or writes a task from
   memory (taskMin, practice/plan.js). The Schreiben phrases have their own rounds, capped at about 8 minutes a day
   (PHRASE_MIN; due phrases always come); otherwise new phrases are a trickle of 4. Its minutes (phrases and the task)
   come off what the main rounds may fill with new items (dayBudget's writing.reserve).

   How the shares compose (one day, one number of minutes):
     1. the B1 review rounds' due items come first among the rounds; on a mock day that runs over, Today cuts the
        review row to what is left (at least one round) while the Schreiben share stays, because Schreiben is the
        weakest module (owner decision 8);
     2. Schreiben reserves its minutes (writing.reserve: the writing task, and phrases capped at about 8 minutes);
     3. the other rows reserve theirs (side): speaking situations (simBudget, a few minutes) and, with no exam ahead,
        the scripts (at most 25 % of the day, more only for a near delivery; features/practice/script/plan.js);
     4. the B1 new items fill what is left of their share (half the day while mocks are planned), at least 4;
     5. new script words shown today count as B1 new items shown, so scripts never add to the new load.
   Reserving only shrinks the B1 new items when the day is full; when the ★ pace is lower than what fits, nothing
   changes. Today's composer (domain/today.js) then keeps the rows inside the minutes. */
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
 * @property {WritingBudget | null} writing   the Schreiben phrases' share, when the pool has them
 */

/**
 * @param {object} o
 * @param {import('../core/clock.js').ClockCtx} o.c
 * @param {any} o.settings          normalised profile settings
 * @param {number} o.dueN           reviews due today (mistakes from corrections excluded)
 * @param {number | null} [o.priorityLeft]  starred and trap items not seen yet; null before the pool was ever loaded
 * @param {number} [o.newShown]     new items already shown today
 * @param {number} [o.poolLeft]     unseen items left in the pool
 * @param {{due?: number, left?: number, shown?: number, focus?: boolean, taskMin?: number} | null} [o.writing]  Schreiben (writingBudget)
 * @param {number} [o.side]         minutes today's other rows take: speaking situations and scripts (see the header)
 * @returns {Budget}
 */
export function dayBudget({ c, settings, dueN, priorityLeft = null, newShown = 0, poolLeft = Infinity, writing = null, side = 0 }) {
  const w = writing ? writingBudget({ c, settings, ...writing }) : null;
  const newPerDay = dailyNew({ c, settings, dueN, priorityLeft, reserved: (w ? w.reserve : 0) + Math.max(0, side || 0) });
  const newLeft = c.newItems ? Math.max(0, Math.min(newPerDay - newShown, poolLeft)) : 0;
  const raw = reviewMin(dueN) + newLeft * NEW_ITEM_MIN;
  const rounds = dueN + newLeft > 0 ? Math.max(1, Math.ceil(raw / ROUND_MIN - 1e-9)) : 0;
  let pace = null;
  if ((c.phase === 'week' || c.phase === 'lastNew') && c.lastNewDay && priorityLeft != null) {
    const days = Math.max(1, D8.diff(c.today, c.lastNewDay) + 1);
    const needed = Math.ceil(priorityLeft / days);
    pace = { lastNew: c.lastNewDay, left: priorityLeft, needed, reach: Math.min(priorityLeft, newPerDay * days), fits: newPerDay >= needed };
  }
  return { newPerDay, newLeft, rounds, minutes: rounds * ROUND_MIN, pace, writing: w };
}

export const WRITE_SHARE = 0.3;
/** Minutes a day for Schreiben phrases while Schreiben is the focus (two rounds); the rest of the share is writing. */
export const PHRASE_MIN = 8;

/**
 * @typedef {object} WritingBudget
 * @property {boolean} focus       Schreiben is the weakest module: it gets its share of the day
 * @property {number} newPerDay    new Schreiben phrases for the whole day
 * @property {number} newLeft      new Schreiben phrases still to show today
 * @property {number} due          Schreiben phrases due
 * @property {number} n            questions today (due + new left)
 * @property {number} rounds       Schreiben rounds that takes (0 when there is nothing)
 * @property {number} minutes      rounds × 4
 * @property {number} reserve      minutes the main rounds leave free for Schreiben (the phrases, due and new, and the task)
 */

/**
 * The Schreiben phrases' share of the day (see the header).
 * @param {{c: import('../core/clock.js').ClockCtx, settings: any, due?: number, left?: number, shown?: number, focus?: boolean, taskMin?: number}} o
 *   due: Schreiben phrases due; left: never seen; shown: new ones shown today; taskMin: minutes of today's writing task
 * @returns {WritingBudget}
 */
export function writingBudget({ c, settings, due = 0, left = 0, shown = 0, focus = false, taskMin = 0 }) {
  let newPerDay = 0;
  if (c.newItems && left + shown > 0) {
    const minutes = settings.minutesPerDay || 60;
    // focus: the phrases get about PHRASE_MIN minutes (never more than the 30% share), the rest of the share is writing
    const phraseMin = Math.min(PHRASE_MIN, minutes * WRITE_SHARE);
    const cap = focus ? Math.max(4, Math.floor(Math.max(0, phraseMin - reviewMin(due)) / NEW_ITEM_MIN)) : Math.max(4, Math.floor((minutes * 0.1) / NEW_ITEM_MIN));
    let pace = left + shown;
    if ((c.phase === 'week' || c.phase === 'lastNew') && c.lastNewDay) pace = Math.ceil((left + shown) / Math.max(1, D8.diff(c.today, c.lastNewDay) + 1));
    newPerDay = Math.min(left + shown, cap, focus ? Math.max(4, pace) : Math.min(4, Math.max(1, pace)));
  }
  const newLeft = Math.max(0, Math.min(newPerDay - shown, left));
  const n = due + newLeft;
  const rounds = n > 0 ? Math.max(1, Math.ceil((reviewMin(due) + newLeft * NEW_ITEM_MIN) / ROUND_MIN - 1e-9)) : 0;
  return { focus, newPerDay, newLeft, due, n, rounds, minutes: rounds * ROUND_MIN, reserve: Math.round((reviewMin(due) + newLeft * NEW_ITEM_MIN + (focus ? taskMin : 0)) * 10) / 10 };
}

/**
 * New items for the day (see the header). reserved: minutes kept free for Schreiben, situations and scripts.
 * @param {{c: import('../core/clock.js').ClockCtx, settings: any, dueN: number, priorityLeft: number | null, reserved?: number}} o
 */
export function dailyNew({ c, settings, dueN, priorityLeft, reserved = 0 }) {
  if (!c.newItems) return 0;
  if (newPerDayChosen(settings)) return Math.max(0, settings.newPerDay);
  const minutes = settings.minutesPerDay || 60;
  const share = settings.exam?.type && c.mocks ? 0.5 : 1;
  const fit = Math.max(0, Math.floor((minutes * share - reviewMin(dueN) - reserved) / NEW_ITEM_MIN));
  if (c.phase === 'week' || c.phase === 'lastNew') {
    const newDays = Math.max(1, D8.diff(c.today, /** @type {string} */ (c.lastNewDay)) + 1);
    const pace = priorityLeft == null ? fit : Math.ceil(priorityLeft / newDays);
    return Math.max(4, Math.min(fit, pace, 60));
  }
  return Math.max(4, Math.min(fit, 20));
}

/** A stream's share of n new items; the two shares always add up to n. @param {number} n @param {'p'|'g'} st */
export const streamQuota = (n, st) => (st === 'p' ? Math.round(n * SPLIT.p) : n - Math.round(n * SPLIT.p));

/* Speaking situations (Practice › Speaking situations, features/practice/sim.js) have their own small budget; its
   minutes are reserved off the B1 new items (dayBudget's side), so the day still fits. A card takes about 12 s
   (hear the line, say the answer, check, grade), a new one is shown about twice (its learning step). New
   situations a day scale with the daily minutes (60 min → 10, 30 → 5, at least 4) and follow the clock: none on
   the eve or the exam day. Today's row and the hub read this. */
export const SIM_CARD_MIN = 0.2;
export const SIM_NEW_MAX = 10;

/**
 * @param {object} o
 * @param {import('../core/clock.js').ClockCtx} o.c
 * @param {any} o.settings          normalised profile settings
 * @param {number} o.dueN           situations due today
 * @param {number} [o.newShown]     new situations already shown today
 * @param {number} [o.unseen]       situations not seen yet in the open levels
 * @returns {{newPerDay: number, newLeft: number, cards: number, minutes: number}}
 */
export function simBudget({ c, settings, dueN, newShown = 0, unseen = Infinity }) {
  const newPerDay = c.newItems ? Math.max(4, Math.min(SIM_NEW_MAX, Math.round((settings?.minutesPerDay || 60) / 6))) : 0;
  const newLeft = Math.max(0, Math.min(newPerDay - newShown, unseen));
  const cards = dueN + 2 * newLeft;
  return { newPerDay, newLeft, cards, minutes: cards ? Math.max(1, Math.ceil(cards * SIM_CARD_MIN - 1e-9)) : 0 };
}

/* Word building (Practice › Word building, src/features/build/) has its own small daily cap of new items (a setting,
   settings.practice.buildNew, default 5; none on the eve or the exam day). It is NOT reserved off the B1 new items
   (dayBudget's side): the B1 allowance stays what it is, and Today's composer decides whether the Word building row
   fits the day's minutes. A card takes about 0.4 min (predict and reveal, a tap, or a few words typed); a new one about
   NEW_ITEM_MIN, as everywhere. */
export const BUILD_NEW_DEFAULT = 5;
export const BUILD_NEW_MAX = 20;
export const BUILD_CARD_MIN = 0.4;

/** The deck's daily cap: the setting when it is a whole number, else the default. @param {any} settings */
export function buildNewPerDay(settings) {
  const n = settings?.practice?.buildNew;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, BUILD_NEW_MAX) : BUILD_NEW_DEFAULT;
}

/**
 * @param {object} o
 * @param {import('../core/clock.js').ClockCtx} o.c
 * @param {any} o.settings          normalised profile settings
 * @param {number} o.dueN           Word building cards due today
 * @param {number} [o.newShown]     new Word building cards shown today
 * @param {number} [o.unseen]       new cards open now (the unlock order decides which)
 * @returns {{newPerDay: number, newLeft: number, due: number, n: number, rounds: number, minutes: number}}
 */
export function buildBudget({ c, settings, dueN, newShown = 0, unseen = Infinity }) {
  const newPerDay = c.newItems ? buildNewPerDay(settings) : 0;
  const newLeft = Math.max(0, Math.min(newPerDay - newShown, unseen));
  const n = dueN + newLeft;
  const minutes = n ? Math.max(1, Math.ceil(dueN * BUILD_CARD_MIN + newLeft * NEW_ITEM_MIN - 1e-9)) : 0;
  return { newPerDay, newLeft, due: dueN, n, rounds: n ? Math.ceil(n / ROUND) : 0, minutes };
}
