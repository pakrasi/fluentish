/* Today's plan, composed from what the features offer. Pure: no DOM, no storage, no clock reads; tested in node and
   portable to iOS as is.

   Features return plan items (see docs/CONTRIBUTING-FEATURES.md). This module applies the rules that follow from the
   exam date (UX §3.4) and the daily minutes, so no feature has to know them:
     - no mock module on the eve or the day of the exam; no new items from exam−1
     - on the exam day only a short warm-up (and things to read)
     - rows are taken in priority order while they fit the day's minutes (the first always fits), at most four;
       one mock module may run over, because a timed module cannot be split
     - setup rows (set an exam date, …) are added after the work and cost no minutes */

/**
 * @typedef {object} PlanItem
 * @property {string} id            stable within the day, e.g. 'practice.review'
 * @property {string} source        feature id
 * @property {'review'|'new'|'mock'|'mistakes'|'speak'|'write'|'read'|'warmup'|'setup'} kind
 * @property {string} title         'Review round'
 * @property {string} [detail]      '38 due · 8 new'
 * @property {number} minutes       estimate; 0 for setup rows
 * @property {string} href          '#/practice/round'
 * @property {number} priority      lower comes first; see the bands in CONTRIBUTING-FEATURES.md
 * @property {boolean} [done]       finished today
 * @property {boolean} [introducesNew]  shows items never seen before
 * @property {boolean} [mock]       a timed mock exam module
 * @property {string} [action]      label for the sticky button: 'Start round · 12 questions · 4 min'
 */
/**
 * @typedef {object} FeedbackRow
 * @property {string} id @property {string} title @property {string} status @property {string} href @property {string} [action]
 */
/**
 * @typedef {object} ModuleBar
 * @property {string} id @property {string} name @property {number|null} score @property {number} max @property {number} pass
 * @property {string} [href]
 */

export const MAX_ROWS = 4;
export const MAX_FEEDBACK = 3;
const DAY_KINDS = new Set(['warmup', 'read', 'setup']);

/**
 * @param {object} o
 * @param {{phase: string, newItems: boolean, mocks: boolean}} o.ctx   the clock context
 * @param {number} o.budget          minutes a day from the profile
 * @param {PlanItem[]} o.items       from every feature
 * @param {FeedbackRow[]} [o.feedback]
 * @param {ModuleBar[]} [o.modules]
 * @param {number} [o.doneMinutes]   minutes already studied today
 */
export function composeToday({ ctx, budget, items, feedback = [], modules = [], doneMinutes = 0 }) {
  const allowed = items.filter(it => {
    if (it.mock && !ctx.mocks) return false;
    if (it.introducesNew && !ctx.newItems) return false;
    if (ctx.phase === 'day' && !DAY_KINDS.has(it.kind)) return false;
    return true;
  });
  const work = allowed.filter(it => it.kind !== 'setup').sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const setup = allowed.filter(it => it.kind === 'setup').sort((a, b) => a.priority - b.priority).slice(0, 1);

  /** @type {PlanItem[]} */ const rows = [];
  let planned = 0, skipped = 0;
  let overrun = false;
  for (const it of work) {
    const fits = planned + it.minutes <= budget;
    const mockOverrun = !fits && it.mock && !overrun && planned < budget;
    if (rows.length < MAX_ROWS && (rows.length === 0 || fits || mockOverrun)) {
      rows.push(it); planned += it.minutes;
      if (mockOverrun) overrun = true;
    } else skipped++;
  }
  const primary = rows.find(r => !r.done) || null;
  return {
    phase: ctx.phase,
    rows: [...rows, ...setup],
    more: skipped,
    minutes: { planned, budget, done: doneMinutes },
    primary,
    state: rows.length === 0 ? 'empty' : primary ? 'todo' : 'done',
    feedback: feedback.slice(0, MAX_FEEDBACK),
    feedbackMore: Math.max(0, feedback.length - MAX_FEEDBACK),
    modules,
  };
}

/**
 * Minutes for a review round of n items (12 items ≈ 4 minutes, as the B1 trainer measured), at least one round.
 * @param {number} n
 */
export const roundMinutes = n => Math.max(4, Math.round((n / 12) * 4));
