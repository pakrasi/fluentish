/* The days of the countdown runway, as local-midnight Dates from `past` days before today to the exam. Pure, so the
   DST rule is tested in node: each day is built from year, month and date, never by adding 24 hours, because a day
   with a clock change is 23 or 25 hours long and "+24 h" would drift to 23:00 or 01:00 and lose the exam column. */

/** Local midnight of a date. @param {Date} d */
export const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * @param {Date} today @param {Date} exam @param {number} [past] days before today to show
 * @returns {Date[]}
 */
export function runwayDays(today, exam, past = 0) {
  const t = midnight(today), e = midnight(exam);
  /** @type {Date[]} */ const days = [];
  for (let d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - past); d <= e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
  return days;
}

/** Calendar days from today to the exam (DST-safe). @param {Date} today @param {Date} exam */
export const daysBetween = (today, exam) => Math.round((Date.UTC(exam.getFullYear(), exam.getMonth(), exam.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
