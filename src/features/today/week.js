/* Today in maintenance (round 4, L1c): the numbers the hero's week strip, its kind-of-day line and "Later this week"
   show, read from the week plan (domain/week.js) and the activity log. Pure: no DOM, no storage; tested in node
   (tests/unit/today-week.test.mjs). Every minute here is the week's or the log's; nothing is estimated. */
import { dayPlan, courseWeek, weekday } from '../../domain/week.js';
import { add, diff } from '../../domain/days.js';

/** @typedef {(k: string, v?: any) => string} T */

/**
 * Minutes as he reads them: "45 min", "4 h", "4 h 05". @param {T} t @param {number} n
 */
export function fmtMin(t, n) {
  const m = Math.max(0, Math.round(n));
  if (m < 60) return t('unit.min', { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  return r ? t('unit.hm', { h, m: String(r).padStart(2, '0') }) : t('unit.h', { h });
}

/**
 * This week, Monday first: each day's planned minutes (the week plan, or minutes a day without one), the minutes done
 * (activity), its kind as he set it and as it is planned (`as`: a kind whose feature has not shipped is a Normal day),
 * and whether it is today. "Study anyway" makes today a Normal day of minutes a day.
 * @param {{settings: any, today: string, activity: Record<string, any>, anyway?: boolean}} o
 */
export function weekDays({ settings, today, activity, anyway = false }) {
  const week = courseWeek(settings);
  const monday = add(today, -weekday(today));
  return Array.from({ length: 7 }, (_, i) => {
    const day = add(monday, i);
    const p = dayPlan(settings, { today: day }, { anyway: anyway && day === today });
    const set = week ? week.kind[i] : 'n';
    const kind = week && (week.min[i] === 0 || set === 'off') ? 'off' : set;
    return { day, as: p.kind, plan: p.kind === 'off' ? 0 : p.minutes, done: Math.round((activity && activity[day] && activity[day].minutes) || 0), kind, today: day === today, past: day < today };
  });
}

/**
 * The week's totals for "52 min of 4 h 05 this week". @param {ReturnType<typeof weekDays>} days
 */
export const weekTotals = days => ({ plan: days.reduce((n, d) => n + d.plan, 0), done: days.reduce((n, d) => n + d.done, 0) });

/**
 * The days after today in this week, for "Later this week" (Things' short list): only with a week plan.
 * @param {ReturnType<typeof weekDays>} days
 */
export const laterThisWeek = days => days.filter(d => !d.today && !d.past);

/**
 * The line under the hero that names the kind of day, or null without a week plan (a day of minutes a day has no kind
 * he chose). @param {any} plan dayAllowance().plan (with `asked` for a kind whose feature has not shipped)
 * @param {{anyway?: boolean}} [o]
 * @returns {{key: string, vars?: Record<string, any>} | null}
 */
export function kindLine(plan, { anyway = false } = {}) {
  if (!plan) return null;
  if (anyway && plan.kind === 'n') return { key: 'week.day.anyway' };
  if (plan.asked) return { key: 'week.day.asked', vars: { kind: plan.asked } };
  return { key: `week.day.${plan.kind}` };
}

/**
 * The plan's note on why new items are fewer or none today (the day kind line already says Light and Off).
 * @param {any} plan dayAllowance().plan
 * @returns {{key: string, vars?: Record<string, any>} | null}
 */
export function whyLine(plan, reviewsDue = 0) {
  if (!plan || !plan.why) return null;
  // the days away are the hero's ("Welcome back", after 3 days or more): the plan says what today takes
  if (plan.why === 'break') return { key: 'week.why.breakDue', vars: { n: reviewsDue, k: plan.reviewsToday } };
  if (plan.why === 'reviewsHigh') return { key: 'today.why.reviewsHigh' };
  if (plan.why === 'reviewsDue') return { key: 'week.why.reviewsDue' };
  return null;
}

/** The days after an exam its mock rows stay open on Today (MAINTENANCE-PLAN §3). */
export const EXAM_ROWS_AFTER = 14;

/**
 * Where you stand's exam module rows: 'open' while an exam is ahead in its window, on its day and, with a score, for 14 days after;
 * 'folded' (behind "Goethe B1 mock results") when there are scores to show otherwise; 'none' when there is nothing.
 * @param {{phase: string, exam: string | null, today: string}} c the clock context @param {boolean} scored any module has a score
 * @returns {'open' | 'folded' | 'none'}
 */
export function examRows(c, scored) {
  if (c.exam && (c.phase === 'week' || c.phase === 'lastNew' || c.phase === 'eve' || c.phase === 'day')) return 'open';
  // after the exam its rows stay open for 14 days only when there is a score to show; otherwise Where you stand
  // follows the goal (UX review round 4, #10)
  if (c.exam && c.phase === 'after' && diff(c.exam, c.today) <= EXAM_ROWS_AFTER && scored) return 'open';
  return scored ? 'folded' : 'none';
}
