/* The one date source. Everything that depends on "today" or on the exam date reads it here.

   A study day is the local date with a 04:00 cutoff: an answer at 01:30 counts for the day before. The exam date is
   a user setting: the active course's goal.date ('YYYY-MM-DD' or null), read through data/settings.js examDate(), which
   main.js passes to createClock(); nothing in src hard-codes one.

   The functions at the top are pure (now, exam date and cutoff are passed in) and tested in node. createClock()
   wraps them for the app: it reads the setting through a getter and memoises the context per day + date.

   The exam window (round 4): a date is a goal that can sit months ahead. Exam behaviour starts EXAM_WINDOW (14) days
   before it; until then context().phase is 'none', as with no date, while exam, daysLeft, lastNewDay and capDay are
   still there for the countdown line and Profile. Everything that plans the day (budget.js mode(), fsrs.js, Today
   and the feature plans) reads that one phase. */
import { iso, parse, add, diff, isDay, phase, planPhase, windowStart, EXAM_WINDOW } from '../domain/days.js';

export { iso, parse, add, diff, isDay, phase, planPhase, windowStart, EXAM_WINDOW };

export const DEFAULT_CUTOFF = 4;

/** @typedef {'none'|'week'|'lastNew'|'eve'|'day'|'after'} Phase */
/**
 * @typedef {object} ClockCtx
 * @property {string} today         study day, 'YYYY-MM-DD'
 * @property {string|null} exam     exam date or null
 * @property {Phase} phase          the phase the day is planned by (planPhase): 'none' before the exam window too
 * @property {number|null} daysLeft calendar days from today to the exam (negative after it), null without a date
 * @property {string|null} lastNewDay  exam−2: the last day new items are introduced
 * @property {string|null} capDay      exam−1: no review is scheduled later than this before the exam
 * @property {boolean} newItems     whether new items may be introduced today
 * @property {boolean} mocks        whether a timed mock module belongs in today's plan
 */

/** Study day for a moment in time. @param {Date} [now] @param {number} [cutoff] hours after midnight */
export function today(now = new Date(), cutoff = DEFAULT_CUTOFF) {
  return iso(new Date(now.getTime() - cutoff * 3600e3));
}

/** UTC epoch day, the unit Igloo's SM-2 deck stores (doors.srs.v1 due/last). Never reinterpret those integers. */
export const epochDay = (now = new Date()) => Math.floor(now.getTime() / 864e5);


/**
 * Everything derived from today and the exam date.
 * @param {{now?: Date, exam?: string|null, cutoff?: number, today?: string|null, examWindow?: number}} [o]  `today`
 *   forces the study day; examWindow: days before the exam that exam behaviour starts (EXAM_WINDOW)
 * @returns {ClockCtx}
 */
export function context({ now = new Date(), exam = null, cutoff = DEFAULT_CUTOFF, today: forced = null, examWindow = EXAM_WINDOW } = {}) {
  const t = forced && isDay(forced) ? forced : today(now, cutoff);
  const ex = exam && isDay(exam) ? exam : null;
  const ph = planPhase(t, ex, examWindow);
  return {
    today: t,
    exam: ex,
    phase: ph,
    daysLeft: ex ? diff(t, ex) : null,
    lastNewDay: ex ? add(ex, -2) : null,
    capDay: ex ? add(ex, -1) : null,
    newItems: ph !== 'eve' && ph !== 'day',
    mocks: ph === 'none' || ph === 'week' || ph === 'lastNew' || ph === 'after',
  };
}

/* ---------- labels (Intl, so other locales work; parts are assembled so every engine prints the same) ---------- */

/** @param {string} locale @param {Intl.DateTimeFormatOptions} o */
const fmt = (locale, o) => new Intl.DateTimeFormat(locale, o);
/** @param {Intl.DateTimeFormat} f @param {Date} d */
const parts = (f, d) => Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
const tidyMonth = (/** @type {string} */ m) => m.replace(/^Sept$/, 'Sep').replace(/\.$/, '');

/** "Fri 9 Oct" (en) · "Fr., 9. Okt." (de). @param {string} d @param {string} [locale] */
export function label(d, locale = 'en') {
  const x = parse(d);
  if (locale.startsWith('de')) return fmt('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }).format(x);
  const p = parts(fmt('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), x);
  return `${p.weekday} ${p.day} ${tidyMonth(p.month)}`;
}

/** "Fri 9 Oct 2026". @param {string} d @param {string} [locale] */
export function labelLong(d, locale = 'en') {
  const x = parse(d);
  if (locale.startsWith('de')) return fmt('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(x);
  const p = parts(fmt('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), x);
  return `${p.weekday} ${p.day} ${tidyMonth(p.month)} ${p.year}`;
}

/** "9. Okt." for German exam screens. @param {string} d */
export const labelDe = d => fmt('de-DE', { day: 'numeric', month: 'short' }).format(parse(d));

/** "Fr" / "Mo": two letters for runway columns. @param {string} d @param {string} [locale] */
export const weekdayShort = (d, locale = 'en') => fmt(locale.startsWith('de') ? 'de-DE' : 'en-GB', { weekday: 'short' }).format(parse(d)).slice(0, 2);

/** "today", "tomorrow", "in 3 days", "2 days ago". @param {string} d @param {string} from @param {string} [locale] */
export function rel(d, from, locale = 'en') {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff(from, d), 'day');
}

/* ---------- the app's clock ---------- */

/**
 * @param {{ exam: () => string|null|undefined, cutoff?: () => number, now?: () => Date, forcedToday?: string|null }} o
 *   forcedToday: a study day to pretend it is (the app passes ?today= on localhost only; a link on a phone must never fake the date)
 */
export function createClock({ exam, cutoff = () => DEFAULT_CUTOFF, now = () => new Date(), forcedToday = null }) {
  /** @type {{key: string, ctx: ClockCtx}|null} */
  let memo = null;
  const api = {
    now,
    exam: () => { const e = exam(); return e && isDay(e) ? e : null; },
    today: () => (forcedToday && isDay(forcedToday) ? forcedToday : today(now(), cutoff())),
    /** @returns {ClockCtx} */
    ctx() {
      const t = api.today(), e = api.exam(), key = `${t}|${e}`;
      if (!memo || memo.key !== key) memo = { key, ctx: context({ exam: e, today: t }) };
      return memo.ctx;
    },
    epochDay: () => epochDay(now()),
    /** days before the exam that exam behaviour starts */
    examWindow: EXAM_WINDOW,
  };
  return api;
}
