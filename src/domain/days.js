/* Calendar-day arithmetic on 'YYYY-MM-DD' strings. Pure, no time zone surprises: every day is parsed at local noon,
   so adding days across a DST change never lands on the wrong date. Used by the scheduler (fsrs.js), readiness and
   core/clock.js. Keep it free of settings and storage. */

/** @typedef {string} Day  'YYYY-MM-DD' */

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** @param {Date} d @returns {Day} */
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** @param {Day} s @returns {Date} local noon of that day */
export const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12); };

/** @param {unknown} s @returns {s is Day} */
export const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;

/** @param {Day} d @param {number} n @returns {Day} */
export const add = (d, n) => { const x = parse(d); x.setDate(x.getDate() + n); return iso(x); };

/** Days from a to b (b − a). @param {Day} a @param {Day} b */
export const diff = (a, b) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400e3);

/** @param {Day} a @param {Day} b */
export const min = (a, b) => (a <= b ? a : b);
/** @param {Day} a @param {Day} b */
export const max = (a, b) => (a >= b ? a : b);

/**
 * The exam window (round 4): exam behaviour (the countdown, review caps, mocks first, side decks paused, the last day
 * for new items) starts this many days before the exam date. Further out, the day is planned as if there were no
 * exam, so a date months away never turns today into exam weeks.
 */
export const EXAM_WINDOW = 14;

/**
 * The phase the day is planned by (core/clock.js context().phase): phase() inside the exam window, 'none' before it,
 * even though a date is set. The first day of the window is exam − window. phase() stays as it was: a script's
 * delivery date (domain/script/plan.js) has no window.
 * @param {Day} t today @param {Day | null | undefined} exam @param {number} [window] days
 * @returns {'none' | 'week' | 'lastNew' | 'eve' | 'day' | 'after'}
 */
export function planPhase(t, exam, window = EXAM_WINDOW) {
  if (exam && diff(t, exam) > window) return 'none';
  return phase(t, exam);
}

/** The first day of an exam's window (exam − window). @param {Day} exam @param {number} [window] */
export const windowStart = (exam, window = EXAM_WINDOW) => add(exam, -window);

/**
 * The study phase of a day against the exam date, with no window (planPhase adds it; the script plan reads this).
 * @param {Day} t today @param {Day | null | undefined} exam
 * @returns {'none' | 'week' | 'lastNew' | 'eve' | 'day' | 'after'}
 */
export function phase(t, exam) {
  if (!exam) return 'none';
  const d = diff(t, exam);
  return d >= 3 ? 'week' : d === 2 ? 'lastNew' : d === 1 ? 'eve' : d === 0 ? 'day' : 'after';
}
