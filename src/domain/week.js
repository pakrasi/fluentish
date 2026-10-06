/* The day's plan from the week the learner sets (round 4, MAINTENANCE-PLAN §1.3): each weekday has minutes and a kind,
   and the kind decides Today's one practice slot. Pure, no storage or clock reads (the day comes from the clock
   context it is handed).

   Kinds (settings course.week.kind, Monday first):
     n      Normal: reviews, new items, the rotation rows (script step, Word building, situations, clusters)
     light  reviews only, no new items (the minutes he set, 20 by default)
     read   reviews, new items, one text (slot 'read', a third of the day)
     write  reviews, new items, a short text corrected (slot 'write', a third of the day)
     talk   reviews, new items, a conversation (slot 'talk', a third of the day)
     off    no plan; reviews wait. A day of 0 minutes is an Off day whatever its kind.

   No week (course.week missing, the default): dayPlan() is a Normal day of settings.minutesPerDay with no slot and
   planned false, and domain/budget.js allowance() then gives exactly the numbers it gave before weeks existed.
   With a week, planned is true and the allowance reads the day's minutes and kind (budget.js header).

   The slot's minutes here are the plan's (a third of the day, SLOT_SHARE); domain/allowance.js todayPlan() fits them
   to the day after its reviews. A slot whose feature has not shipped (not in LIVE_SLOTS) falls back to a Normal day,
   and `asked` keeps the kind the week asked for, so the editor can say "coming later".
   "Study anyway" on an Off day (anyway: true) builds a Normal day of settings.minutesPerDay. */

import * as D8 from './days.js';

/** The clock phases of an exam window (core/clock.js planPhase): the exam's rules plan those days. */
const WINDOW_PHASES = new Set(['week', 'lastNew', 'eve', 'day']);

/** The kinds of day, in the order the week editor lists them. */
export const DAY_KINDS = /** @type {const} */ (['n', 'light', 'read', 'write', 'talk', 'off']);
/** @typedef {typeof DAY_KINDS[number]} DayKind */

/**
 * @typedef {object} DayPlan
 * @property {DayKind} kind                          the kind of day
 * @property {number} minutes                        the day's planned minutes
 * @property {'read' | 'write' | 'talk' | null} slot the day's one practice slot, null for none
 * @property {number} slotMin                        the slot's minutes (0 without a slot)
 * @property {boolean} [planned]                     the day comes from a week the learner set (false or missing:
 *                                                   the round 3 day, and the allowance ignores the plan)
 * @property {'read' | 'write' | 'talk'} [asked]     the slot the week asked for when its feature has not shipped
 */

/** A course's week as settings hold it: minutes and a kind per weekday, Monday first. @typedef {{min: number[], kind: DayKind[]}} Week */

/**
 * Whether a value is a valid week (data/settings.js checks writes with it): seven whole minutes 0 to 240 and seven
 * kinds. @param {any} w @returns {w is Week}
 */
export function isWeek(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return false;
  const { min, kind } = w;
  return Array.isArray(min) && min.length === 7 && min.every(m => Number.isInteger(m) && m >= 0 && m <= 240)
    && Array.isArray(kind) && kind.length === 7 && kind.every(k => /** @type {readonly string[]} */ (DAY_KINDS).includes(k));
}

/** A third of the day goes to its practice slot (MAINTENANCE-PLAN §1.1). */
export const SLOT_SHARE = 1 / 3;
/**
 * The slots whose feature has shipped. A lane adds its kind here in the commit that ships its Today row (L2b 'read',
 * L4 'talk', the free-write corrections 'write'); until then that kind of day is a Normal day.
 * @type {readonly ('read' | 'write' | 'talk')[]}
 */
export const LIVE_SLOTS = Object.freeze(/** @type {const} */ (['read', 'talk']));

/**
 * The week the editor proposes (MAINTENANCE-PLAN §1.3): 4 h 05 a week, Monday first. It is never applied by itself:
 * a course without a week keeps the round 3 day.
 * @returns {Week} a fresh copy
 */
export const defaultWeek = () => ({ min: [45, 45, 20, 45, 30, 60, 0], kind: ['n', 'read', 'light', 'write', 'n', 'talk', 'off'] });

/** Minutes of a whole week. @param {Week} w */
export const weekMinutes = w => w.min.reduce((n, m, i) => n + (w.kind[i] === 'off' ? 0 : m), 0);

/** Monday 0 … Sunday 6 of a day ('YYYY-MM-DD', read at local noon as domain/days.js does). @param {string} day */
export const weekday = day => (D8.parse(day).getDay() + 6) % 7;

/**
 * The active course's week, or null without one (or with a malformed one). @param {any} settings normalised settings
 * @returns {Week | null}
 */
export function courseWeek(settings) {
  const list = settings && Array.isArray(settings.courses) ? settings.courses : [];
  const c = list.find((/** @type {any} */ x) => x && x.id === settings.activeCourse);
  return c && isWeek(c.week) ? c.week : null;
}

/**
 * Today's plan from the week (see the header).
 * @param {any} settings normalised settings
 * @param {{today: string, phase?: string}} c the clock context (phase: inside an exam window an Off day keeps its minutes)
 * @param {{anyway?: boolean, live?: readonly string[]}} [o]  anyway: "Study anyway" was chosen on today's Off day;
 *   live: the slots that have a feature (LIVE_SLOTS)
 * @returns {DayPlan}
 */
export function dayPlan(settings, c, { anyway = false, live = LIVE_SLOTS } = {}) {
  const base = settings?.minutesPerDay || 60;
  const week = courseWeek(settings);
  if (!week) return { kind: 'n', minutes: base, slot: null, slotMin: 0, planned: false };
  const i = weekday(c.today);
  /** @type {DayKind} */ let kind = week.kind[i];
  let minutes = week.min[i];
  if (minutes === 0 || kind === 'off') { kind = 'off'; minutes = 0; }
  if (kind === 'off' && anyway) { kind = 'n'; minutes = base; }
  // inside the exam window the exam plans the day (code audit P0-1): an Off day keeps the day's minutes for its
  // reviews (budget.js gives it fewer new items, never none for that reason); "Study anyway" makes it a Normal day
  else if (kind === 'off' && c.phase && WINDOW_PHASES.has(c.phase)) minutes = base;
  /** @type {DayPlan} */ const out = { kind, minutes, slot: null, slotMin: 0, planned: true };
  if (kind === 'read' || kind === 'write' || kind === 'talk') {
    if (live.includes(kind)) { out.slot = kind; out.slotMin = Math.round(minutes * SLOT_SHARE); } else { out.kind = 'n'; out.asked = kind; }
  }
  return out;
}

/**
 * The plan of each of n days from today (the forecast cap's planned minutes, Today's "This week").
 * @param {any} settings @param {string} today @param {number} n
 * @returns {(DayPlan & {day: string})[]}
 */
export function daysAhead(settings, today, n) {
  return Array.from({ length: n }, (_, k) => { const day = D8.add(today, k); return { day, ...dayPlan(settings, { today: day }) }; });
}
