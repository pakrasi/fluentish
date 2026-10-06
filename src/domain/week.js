/* The day's plan from the week the learner sets (round 4, MAINTENANCE-PLAN §1.3): each weekday has minutes and a kind,
   and the kind decides Today's one practice slot. Pure, no storage or clock reads.

   Kinds (settings course.week.kind, Monday first):
     n      Normal: reviews, new items, the rotation slot
     light  reviews only, no new items, about 20 min
     read   reviews, fewer new items, one text (slot 'read')
     write  reviews, a short text corrected (slot 'write')
     talk   reviews, a conversation (slot 'talk')
     off    no plan; reviews wait

   Contract seam (C0): dayPlan() is a stub. It returns a Normal day of settings.minutesPerDay with no slot, whatever the
   week says, so nothing that reads it changes behaviour. Lane L1b fills it in (week kinds, slot minutes); every reader
   (features/day.js PlanCtx.day, domain/budget.js allowance({day})) already receives its result. */

/** The kinds of day, in the order the week editor lists them. */
export const DAY_KINDS = /** @type {const} */ (['n', 'light', 'read', 'write', 'talk', 'off']);
/** @typedef {typeof DAY_KINDS[number]} DayKind */

/**
 * @typedef {object} DayPlan
 * @property {DayKind} kind                          the kind of day
 * @property {number} minutes                        the day's planned minutes
 * @property {'read' | 'write' | 'talk' | null} slot the day's one practice slot, null for none
 * @property {number} slotMin                        the slot's minutes (0 without a slot)
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

/**
 * Today's plan. Stub (C0): a Normal day of settings.minutesPerDay, no slot.
 * @param {any} settings normalised settings
 * @param {{today: string}} c the clock context
 * @returns {DayPlan}
 */
export function dayPlan(settings, c) {
  return { kind: 'n', minutes: settings?.minutesPerDay || 60, slot: null, slotMin: 0 };
}
