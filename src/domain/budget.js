/* How much practice fits in a day: ONE allowance of new items across every deck, the reviews every deck has due, and
   the minutes they take. Pure, no storage or clock reads; tested in node and portable to iOS as is.

   This is the one place that answers "how much today". domain/allowance.js reads the store into its inputs; Today's
   plan rows, Practice's hub, every feature's plan.js and every round's composer read the same result, so no screen
   can disagree and no deck keeps a cap of its own.

   Decks (one schedule, FSRS, many decks):
     mistakes   F: cards from corrections (exam and free writing, data/mistakes.js), in deck b1
     b1         the daily review round: B1 phrases, grammar, Lesen phrases, exam words (deck b1, Schreiben and
                mistakes left out)
     writing    the Schreiben phrases (BS: and the letter items Schreiben links; deck b1, their own rounds)
     speak      speaking situations (deck speak)
     script     words marked in his scripts (deck script)
     build      Word building (deck build)
     clusters   word clusters (deck clusters)
     read       words and phrases saved while reading (decks '<lang>:read', domain/decks.js allowanceDeck; round 4).
                A contract seam (C0): it is counted (due, shown) and paused in exam week like the other side decks,
                but wants no new items yet, so every number is what it was before the deck existed

   Mode, from the clock and the learner (mode()):
     exam         an exam date ahead with new days left (phases week, lastNew)
     eve, day     the day before the exam and the exam day: no new items at all
     maintenance  after the exam, or no date: his own goals get their share
     start        no exam ahead and his first study week (a new learner): level-fit items, a short list of decks

   Reviews are never limited. Every deck's due cards are counted (reviews.due, reviews.minutes); when they do not fit
   the day, Today says so and orders them by value (domain/today.js), it never drops them.

   New items for the whole day (newPerDay), one number:
     - none on the eve or the exam day (clock ctx.newItems)
     - a number the learner set in this app (settings.newPerDay with a rev stamp) is the whole day's, every deck
       included (met past the decks' wants, as far as they have items). A number carried over from Igloo has no rev
       stamp and counts as Auto.
     - Auto: what fits in the minutes after every deck's reviews and today's fixed rows (the writing task, script steps),
       half the minutes while a mock exam is planned (the other half is the mock's), at most the decks' wants
       together, and at most 60 (exam), 40 (maintenance) or 20 (first week). Never under the floor: 4, or in exam week
       his mistakes, the Schreiben phrases' want (about 8 minutes while Schreiben is the weakest module, else up to 4),
       4 B1 items and 4 situations.
     - Auto in maintenance and the first week: never more than the sustainable rate (steadyRate, below), floor
       included. A number he chose is not capped; Profile shows the rate next to it.
     - Auto in exam week: while the exam decks' reviews (every deck but the side decks) and today's fixed rows do not
       fit the day's room, no new items but his mistakes (why 'reviewsDue'). The side decks' reviews wait: Today
       lists them after the exam rows and leaves them out first.
   Each deck's want (what it would take on a free day):
     b1        exam: the pace that meets every ★ and trap item left by the last new day (exam−2), at least 4;
               maintenance 20; first week minutes ÷ 4 (6 to 15)
     writing   exam with Schreiben the weakest module: about 8 minutes of phrases less their due ones (at least 4);
               otherwise a trickle of up to 4; none in the first week
     speak     minutes ÷ 6 (4 to 10); first week from day 3, 4
     mistakes  all of them (his own errors come first)
     script    8 a script in use; in exam week only for a script delivered on or before the exam
     build     Word building's setting (Profile, default 5), maintenance only
     clusters  6 once he uses clusters, maintenance only (first week from day 5)
     read      words saved while reading: practice.readNew (default 6), maintenance only
   Side decks (script, build, clusters) pause in exam week: no new items until after the exam, reviews as always.
   A want never exceeds what the deck has open.

   Shares: in exam week and the first week the decks take their want in a fixed order (exam: mistakes, Schreiben
   when it is the focus, b1, situations, Schreiben otherwise, scripts), after a first pass that gives each its floor.
   In maintenance mistakes come first and the rest is split in proportion to the wants. A round that goes over its
   share (a map pick, "Practice all") uses up the day: what is left for the other decks shrinks with it, lowest
   value first, and never goes below 0.

   The week (round 4, lane L1b; domain/week.js dayPlan). Without a week the day is the round 3 day above, number for
   number (the plan is ignored and the output has no `plan`). With a week (day.planned):
     - the day's minutes are the week's for today (settings.minutesPerDay is the fallback only)
     - Light and Off days give no new items, a chosen number included; an Off day plans no reviews (they wait and
       stay counted in reviews.due). Inside the exam window the exam rules win (code audit P0-1): an Off day keeps
       settings.minutesPerDay (dayPlan) and plans every review, and Light and Off days give fewer new items (the exam
       floor at most), never none for that reason
     - the day's slot (Read, Write, Talk) is fixed time after the reviews: its minutes are the plan's third of the day,
       at most what the reviews leave, and none inside the exam window (the window plans the day)
     - back after a break (maintenance and first week): when the reviews due take more than BREAK_FACTOR (1.5) times
       the day's minutes, today takes the most urgent (plan.reviewsToday: at least a third of them, more when the day
       holds more; the composer orders by lowest recall), the rest spread over the next BREAK_SPREAD (3) days, no new
       items (a chosen number included), and the slot shrinks to BREAK_SLOT_MIN minutes
     - and while the reviews and today's fixed rows do not fit in the day's minutes, Auto gives no new items
     - the forecast cap (maintenance, Auto): the reviews forecast for the next FORECAST_DAYS (14) days, with the
       reviews today's new items will bring in that time (NEW_REVIEWS_14 each), may take at most FORECAST_LIMIT (55 %)
       of those days' planned minutes. Past it, each day's overflow comes off the new items (overflow minutes a day ÷
       0.75), down to 0, and plan.why says so ('reviewsHigh')
     - the output gains `plan`: {kind, minutes, slot, slotMin, why, reviewsToday, break, forecast}. why names the
       reason new items are fewer or none today: 'off', 'light', 'break', 'reviewsDue', 'reviewsHigh' or null.
   Reviews are never dropped by any of it: reviews.due and every deck's due stay what the decks have.

   Minutes: a review round is 12 questions, about 4 minutes; a new item costs about 0.75 min inside rounds (shown,
   learnt, seen again); a situation 0.2 min (a new one is shown twice); a Word building card 0.4 min. Rounds are whole,
   and a row's minutes are rounds × 4, so "4 rounds, 16 min" always adds up. */
import * as D8 from './days.js';
import { hasMockExam } from './modules.js';
import { courseWeek, weekMinutes } from './week.js';

export const ROUND = 12;
export const ROUND_MIN = 4;
export const NEW_ITEM_MIN = 0.75;
/** Phrases, situations and words ('p') against grammar ('g'), inside the b1 deck's share. */
export const SPLIT = /** @type {Record<'p'|'g', number>} */ ({ p: 40 / 55, g: 15 / 55 });

/** @typedef {'mistakes'|'b1'|'writing'|'speak'|'script'|'build'|'clusters'|'read'} DeckId */
/** Every deck of the allowance, highest value first (the order Today lists their reviews in). */
export const DECKS = /** @type {DeckId[]} */ (['mistakes', 'b1', 'writing', 'speak', 'script', 'build', 'clusters', 'read']);
/** Decks that pause their new items in exam week. */
export const SIDE = /** @type {DeckId[]} */ (['script', 'build', 'clusters', 'read']);

/** Minutes a due card takes. */
export const REVIEW_COST = /** @type {Record<DeckId, number>} */ ({ mistakes: ROUND_MIN / ROUND, b1: ROUND_MIN / ROUND, writing: ROUND_MIN / ROUND, speak: 0.2, script: ROUND_MIN / ROUND, build: 0.4, clusters: ROUND_MIN / ROUND, read: ROUND_MIN / ROUND });
/** Minutes a new item takes (a new situation is shown twice). */
export const NEW_COST = /** @type {Record<DeckId, number>} */ ({ mistakes: NEW_ITEM_MIN, b1: NEW_ITEM_MIN, writing: NEW_ITEM_MIN, speak: 0.4, script: NEW_ITEM_MIN, build: NEW_ITEM_MIN, clusters: NEW_ITEM_MIN, read: NEW_ITEM_MIN });

export const WRITE_SHARE = 0.3;
/** Minutes a day for Schreiben phrases while Schreiben is the focus (two rounds); the rest of its share is writing. */
export const PHRASE_MIN = 8;
export const SIM_NEW_MAX = 10;
export const SIM_CARD_MIN = 0.2;
export const SCRIPT_NEW = 8;
export const CLUSTER_NEW = 6;
export const BUILD_NEW_DEFAULT = 5;
export const BUILD_NEW_MAX = 20;
export const BUILD_CARD_MIN = 0.4;
export const READ_NEW_DEFAULT = 6;
export const READ_NEW_MAX = 20;
const CAP = { exam: 60, maintenance: 40, start: 20 };

/** The sustainable rate: the reviews forecast for the next FORECAST_DAYS days may take at most this share of their
 * planned minutes before Auto new items shrink (MAINTENANCE-PLAN §1.1). The one constant of the forecast cap. */
export const FORECAST_LIMIT = 0.55;
/** The forecast's horizon in days, today included. */
export const FORECAST_DAYS = 14;

/* The sustainable rate (round 4 hotfix, UX review P0-1). A new item costs NEW_ITEM_MIN when it is shown, then about
   NEW_REVIEWS_30 reviews in its first 30 days, at REVIEW_COST each: STEADY_ITEM_MIN = 0.75 + 6 × 1/3 = 2.75 minutes
   over its first month. Measured with fsrs.js (tests/unit/sched-hotfix.test.mjs re-runs it): an item reviewed when
   due by a learner who recalls 85 % of what FSRS predicts and is late on 40 % of right answers (the review's synthetic
   learner) gets 3.4 reviews in 14 days and 5.8 in 30 (an ideal learner 2.3 and 2.5). Held every day, N new items
   keep N × 2.75 minutes a day busy, so Auto takes at most
       steady = round(STEADY_SHARE × week minutes ÷ 7 ÷ STEADY_ITEM_MIN)
   new items a day: 9 on a 4 h 05 week, 11 at 45 min a day, 15 at 60, 23 at 90. The other 30 % of the day is for
   older cards' reviews (past 30 days) and the day's fixed rows. A number he chose is not capped (his number wins). */
/** Reviews a new item brings in its first 14 days (the forecast counts today's new items with it). */
export const NEW_REVIEWS_14 = 3.5;
/** Reviews a new item brings in its first 30 days. */
export const NEW_REVIEWS_30 = 6;
/** Minutes a new item takes over its first 30 days: shown once, then its reviews. */
export const STEADY_ITEM_MIN = NEW_ITEM_MIN + NEW_REVIEWS_30 * (ROUND_MIN / ROUND);
/** The share of the planned minutes new items and their first month of reviews may take. */
export const STEADY_SHARE = 0.7;
/** The exam window: the share of a day's minutes the exam decks' reviews may take (fsrs.recap spreads by it). */
export const WINDOW_REVIEW_SHARE = 0.4;
/** The eve: a lighter share (Sprechen frames and one round, not a backlog). */
export const EVE_REVIEW_SHARE = 0.2;

/** The new items a day a week of weekMin minutes sustains (see above). @param {number} weekMin */
export const steadyRate = weekMin => Math.max(0, Math.round((STEADY_SHARE * Math.max(0, weekMin || 0)) / 7 / STEADY_ITEM_MIN));

/** The planned minutes of a week: the course's week, else 7 × minutesPerDay (60 when unset). @param {any} settings */
export const plannedWeekMin = settings => { const w = courseWeek(settings); return w ? weekMinutes(w) : 7 * (settings?.minutesPerDay || 60); };

/** The sustainable rate for these settings (Profile shows it next to the number he chose). @param {any} settings */
export const steadyFor = settings => steadyRate(plannedWeekMin(settings));
/** Back after a break: the reviews due take more than this many times the day's minutes. */
export const BREAK_FACTOR = 1.5;
/** Back after a break: the reviews are spread over this many days, today first. */
export const BREAK_SPREAD = 3;
/** Back after a break: the day's slot shrinks to at most this many minutes (a short read). */
export const BREAK_SLOT_MIN = 5;

/** Reading's want: practice.readNew when it is a whole number (at most 20), else 6. @param {any} settings */
export function readShare(settings) {
  const n = settings?.practice?.readNew;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, READ_NEW_MAX) : READ_NEW_DEFAULT;
}

/** Whether the learner chose a number of new items in this app (not Auto, not a value carried over). @param {any} settings */
export const newPerDayChosen = settings => Number.isInteger(settings?.newPerDay) && !!settings?.rev?.newPerDay;

/** Word building's want: the setting (Profile › Practice) when it is a whole number, else 5. @param {any} settings */
export function buildShare(settings) {
  const n = settings?.practice?.buildNew;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, BUILD_NEW_MAX) : BUILD_NEW_DEFAULT;
}

/** A stream's share of n new items; the two shares always add up to n. @param {number} n @param {'p'|'g'} st */
export const streamQuota = (n, st) => (st === 'p' ? Math.round(n * SPLIT.p) : n - Math.round(n * SPLIT.p));

/** @typedef {'exam'|'eve'|'day'|'maintenance'|'start'} Mode */
/**
 * The day's mode. fresh: the learner is in his first study week (domain/allowance.js firstWeek).
 * @param {{phase: string}} c @param {{day: number} | null} [fresh] @returns {Mode}
 */
export function mode(c, fresh = null) {
  if (c.phase === 'day' || c.phase === 'eve') return /** @type {Mode} */ (c.phase);
  if (c.phase === 'week' || c.phase === 'lastNew') return 'exam';
  return fresh ? 'start' : 'maintenance';
}

/**
 * @typedef {object} DeckIn
 * @property {number} [due]     cards due today
 * @property {number} [open]    new items it could introduce now (Infinity when not given; a deck not given at all has none)
 * @property {number} [shown]   new items it introduced today
 */
/**
 * @typedef {object} DeckShare
 * @property {number} want       what the deck would take on a free day
 * @property {number} newPerDay  its share of the day's new items
 * @property {number} newLeft    new items it may still introduce today
 * @property {number} shown      introduced today
 * @property {number} due        reviews due
 * @property {number} rounds     its rounds today (12 questions; 0 when nothing)
 * @property {number} minutes    the minutes its due and new items take (rounds × 4 for the round decks)
 * @property {boolean} paused    side deck in exam week: no new items until after the exam
 */
/**
 * @typedef {object} Allowance
 * @property {Mode} mode
 * @property {number} newPerDay   new items for the whole day, every deck
 * @property {number} newLeft     still to introduce today, every deck
 * @property {number} shown       introduced today, every deck
 * @property {Record<DeckId, DeckShare>} decks
 * @property {{due: number, minutes: number}} reviews   every deck's due cards and their minutes
 * @property {{lastNew: string, left: number, needed: number, reach: number, fits: boolean} | null} pace
 *           with an exam ahead and new days left: ★/trap items left, the daily number that meets them all by the last
 *           new day, and how many the b1 share meets
 * @property {boolean} focus      Schreiben is the weakest module (exam ahead): it gets its share first
 * @property {{minutes: number, fixed: number, floor: number}} room  the minutes new items and reviews share (half the
 *           day while a mock is planned), today's fixed rows, and the floor of new items (Auto only; 0 otherwise)
 * @property {DayOut} [plan]      only for a day from a week (day.planned): what the week made of today
 * @property {Why} [why]          exam week without a week plan: 'reviewsDue' when the exam decks' reviews fill the day
 */
/** Why new items are fewer or none today (a day from a week): see the header. @typedef {'off'|'light'|'break'|'reviewsDue'|'reviewsHigh'|null} Why */
/**
 * @typedef {object} DayOut
 * @property {import('./week.js').DayKind} kind  the day's kind
 * @property {number} minutes       the day's planned minutes
 * @property {'read'|'write'|'talk'|null} slot  the day's practice slot
 * @property {number} slotMin       its minutes today, after the reviews (0 without a slot)
 * @property {Why} why              why new items are fewer or none (null: as Auto or his number gives)
 * @property {number} reviewsToday  the reviews today's plan takes (reviews.due, but 0 on an Off day and the most
 *                                  urgent share after a break)
 * @property {boolean} break        back after a break
 * @property {{reviewMin: number, plannedMin: number, ratio: number, cut: number, fromNew: number} | null} forecast  the
 *           forecast cap's inputs (fromNew: the reviews today's new items bring, in minutes) and the new items it took
 *           off (maintenance, Auto; null otherwise)
 * @property {number} steady        the sustainable rate (steadyRate of the week's minutes)
 */
/**
 * The reviews forecast over the next FORECAST_DAYS days and the minutes planned on them (domain/allowance.js
 * reviewForecast reads both from the store and the week).
 * @typedef {{reviewMin: number, plannedMin: number, days?: number}} Forecast
 */

/**
 * The one daily allowance (see the header).
 * @param {object} o
 * @param {import('../core/clock.js').ClockCtx} o.c
 * @param {any} o.settings                normalised profile settings
 * @param {Partial<Record<DeckId, DeckIn>>} o.decks
 * @param {number | null} [o.priorityLeft]  starred and trap items not seen yet; null before the pool was ever loaded
 * @param {boolean} [o.focus]              Schreiben is the weakest exam module
 * @param {number} [o.fixedMin]            minutes of today's rows that are not card rounds (the writing task, script steps)
 * @param {{day: number} | null} [o.fresh] his first study week: day 0 is his first day
 * @param {{script?: boolean, build?: boolean, clusters?: boolean}} [o.goals]  the decks he uses (maintenance shares)
 * @param {{script?: number}} [o.examDecks] exam week: scripts delivered on or before the exam (their number)
 * @param {number} [o.scripts]             scripts in use (each wants SCRIPT_NEW)
 * @param {import('./week.js').DayPlan | null} [o.day]  the day's plan (domain/week.js dayPlan). Read only when it comes
 *                                         from a week (planned); otherwise every number is the round 3 one
 * @param {Forecast | null} [o.forecast]   the reviews forecast (a planned day in maintenance; no cap without it)
 * @param {number | null} [o.weekMin]      the week's planned minutes (plannedWeekMin); 7 × the day's minutes when not given
 * @returns {Allowance}
 */
export function allowance({ c, settings, decks = {}, priorityLeft = null, focus = false, fixedMin = 0, fresh = null, goals = {}, examDecks = {}, scripts = 0, day = null, forecast = null, weekMin = null }) {
  const md = mode(c, fresh);
  const planned = !!(day && day.planned);
  const kind = planned && day ? day.kind : 'n';
  const minutes = planned && day ? Math.max(0, day.minutes) : settings?.minutesPerDay || 60;
  /** @type {Record<DeckId, Required<DeckIn>>} */
  const d = /** @type {any} */ (Object.fromEntries(DECKS.map(id => {
    // a deck not given has nothing open; a deck given without its open count may introduce any number
    const x = decks[id];
    if (!x) return [id, { due: 0, open: 0, shown: 0 }];
    return [id, { due: Math.max(0, x.due || 0), open: x.open == null ? Infinity : Math.max(0, x.open), shown: Math.max(0, x.shown || 0) }];
  })));
  const reviewMin = DECKS.reduce((n, id) => n + d[id].due * REVIEW_COST[id], 0);
  const examWeek = md === 'exam';
  const newDays = examWeek && c.lastNewDay ? Math.max(1, D8.diff(c.today, c.lastNewDay) + 1) : 1;

  // ---- each deck's want ----
  /** @type {Record<DeckId, number>} */ const want = { mistakes: 0, b1: 0, writing: 0, speak: 0, script: 0, build: 0, clusters: 0, read: 0 };
  const sim = Math.max(4, Math.min(SIM_NEW_MAX, Math.round(minutes / 6)));
  want.mistakes = Math.min(d.mistakes.open + d.mistakes.shown, CAP.exam);
  if (examWeek) {
    want.b1 = priorityLeft == null ? 20 : Math.min(CAP.exam, Math.max(4, Math.ceil(priorityLeft / newDays)));
    const wTotal = d.writing.open + d.writing.shown;
    const wPace = Math.ceil(wTotal / newDays);
    if (focus) {
      const phraseMin = Math.min(PHRASE_MIN, minutes * WRITE_SHARE);
      want.writing = Math.min(Math.max(4, Math.floor(Math.max(0, phraseMin - d.writing.due * REVIEW_COST.writing) / NEW_ITEM_MIN)), Math.max(4, wPace));
    } else want.writing = Math.min(4, Math.max(1, wPace));
    want.speak = sim;
    want.script = (examDecks.script || 0) * SCRIPT_NEW;
  } else if (md === 'maintenance') {
    want.b1 = 20;
    want.writing = 4;
    want.speak = sim;
    want.script = goals.script ? Math.max(1, scripts) * SCRIPT_NEW : 0;
    want.build = goals.build ? buildShare(settings) : 0;
    want.clusters = goals.clusters ? CLUSTER_NEW : 0;
    want.read = readShare(settings);
  } else if (md === 'start') {
    const day = fresh ? fresh.day : 0;
    want.b1 = Math.max(6, Math.min(15, Math.round(minutes / 4)));
    want.speak = day >= 2 ? 4 : 0;
    want.script = goals.script ? Math.max(1, scripts) * SCRIPT_NEW : 0;
    want.clusters = goals.clusters && day >= 4 ? 4 : 0;
  }
  for (const id of DECKS) want[id] = Math.max(0, Math.min(want[id], d[id].open + d[id].shown));
  const wantSum = DECKS.reduce((n, id) => n + want[id], 0);

  // ---- the week's day (planned only) ----
  const share0 = examWeek && hasMockExam(settings) ? 0.5 : 1;
  const calm = md === 'maintenance' || md === 'start';
  const fixed = Math.max(0, fixedMin);
  const dueAll = DECKS.reduce((n, id) => n + d[id].due, 0);
  const isBreak = planned && calm && kind !== 'off' && reviewMin > BREAK_FACTOR * minutes;
  const after = Math.max(0, Math.floor(minutes * share0 - reviewMin - fixed));
  const slotMin = planned && day && day.slot && calm ? Math.min(day.slotMin, isBreak ? BREAK_SLOT_MIN : after) : 0;
  /** @type {Why} */ let why = null;
  /** @type {DayOut['forecast']} */ let fc = null;

  // ---- the day's number ----
  let total = 0, floor = 0;
  // inside the exam window Light and Off do not block: the exam rules plan the day (code audit P0-1)
  const blocked = planned && calm ? (kind === 'off' ? 'off' : kind === 'light' ? 'light' : isBreak ? 'break' : null) : null;
  const sideSet = new Set(SIDE);
  const examReviewMin = DECKS.reduce((n, id) => n + (sideSet.has(id) ? 0 : d[id].due * REVIEW_COST[id]), 0);
  const steady = steadyRate(weekMin ?? 7 * minutes);
  if (c.newItems && md !== 'eve' && md !== 'day' && blocked) why = blocked;
  else if (c.newItems && md !== 'eve' && md !== 'day') {
    // exam week on a Light or Off day: fewer new items (the exam floor at most), a chosen number included
    const lightWin = examWeek && planned && (kind === 'off' || kind === 'light');
    const examFloor = want.writing + Math.min(4, want.b1) + Math.min(4, want.speak) + want.mistakes;
    if (newPerDayChosen(settings)) total = lightWin ? Math.min(Math.max(0, settings.newPerDay), examFloor) : Math.max(0, settings.newPerDay);
    else {
      const share = share0;
      const fit = Math.max(0, Math.floor((minutes * share - reviewMin - fixed - slotMin) / NEW_ITEM_MIN));
      floor = examWeek ? examFloor : Math.min(4, wantSum);
      const cap = examWeek ? CAP.exam + want.mistakes : md === 'start' ? CAP.start : CAP.maintenance;
      total = Math.min(wantSum, cap, Math.max(fit, floor));
      // the sustainable rate: what the week can hold every day (floor included)
      if (calm && total > steady) { total = steady; floor = Math.min(floor, steady); }
      if (examWeek && examReviewMin + fixed > minutes * share) { floor = want.mistakes; total = Math.min(total, floor); why = 'reviewsDue'; }
      else if (lightWin) total = Math.min(total, floor);
      if (planned && calm && reviewMin + fixed > minutes) { total = 0; floor = 0; why = 'reviewsDue'; }
      else if (planned && md === 'maintenance' && forecast && forecast.plannedMin > 0) {
        const days = forecast.days || FORECAST_DAYS;
        // today's new items bring their own reviews inside the horizon
        const fromNew = total * NEW_REVIEWS_14 * REVIEW_COST.b1;
        const over = forecast.reviewMin + fromNew - FORECAST_LIMIT * forecast.plannedMin;
        const cut = over > 0 ? Math.min(total, Math.ceil(over / days / NEW_ITEM_MIN - 1e-9)) : 0;
        fc = { reviewMin: round1(forecast.reviewMin), plannedMin: forecast.plannedMin, ratio: Math.round((forecast.reviewMin / forecast.plannedMin) * 1000) / 1000, cut, fromNew: round1(fromNew) };
        if (cut > 0) { total -= cut; why = 'reviewsHigh'; }
      }
    }
  }

  // ---- shares ----
  /** @type {Record<DeckId, number>} */ const share = { mistakes: 0, b1: 0, writing: 0, speak: 0, script: 0, build: 0, clusters: 0, read: 0 };
  let left = total;
  const take = (/** @type {DeckId} */ id, /** @type {number} */ n) => { const k = Math.max(0, Math.min(n, want[id] - share[id], left)); share[id] += k; left -= k; };
  /** @type {DeckId[]} */ let order;
  if (examWeek) {
    order = focus ? ['mistakes', 'writing', 'b1', 'speak', 'script'] : ['mistakes', 'b1', 'speak', 'writing', 'script'];
    const floors = /** @type {Record<DeckId, number>} */ ({ mistakes: want.mistakes, writing: want.writing, b1: 4, speak: 4, script: 0, build: 0, clusters: 0, read: 0 });
    for (const id of order) take(id, floors[id]);
    for (const id of order) take(id, Infinity);
  } else if (md === 'start') {
    order = ['mistakes', 'b1', 'speak', 'script', 'clusters'];
    for (const id of order) take(id, Infinity);
  } else {
    order = ['mistakes', 'b1', 'script', 'build', 'clusters', 'speak', 'writing', 'read'];
    take('mistakes', Infinity);
    proportional(order.slice(1), want, share, left);
    left = total - DECKS.reduce((n, id) => n + share[id], 0);
  }

  // a number he chose is met even past the wants: the rest goes to the decks in order, as far as they have items
  if (left > 0 && newPerDayChosen(settings)) {
    for (const id of order) { const k = Math.max(0, Math.min(left, d[id].open + d[id].shown - share[id])); share[id] += k; left -= k; }
  }
  total = DECKS.reduce((n, id) => n + share[id], 0);

  // ---- what is left today: a deck that went over its share uses up the day, lowest value first ----
  const shown = DECKS.reduce((n, id) => n + d[id].shown, 0);
  const totalLeft = Math.max(0, total - shown);
  /** @type {Record<DeckId, number>} */ const newLeft = /** @type {any} */ (Object.fromEntries(DECKS.map(id => [id, Math.max(0, Math.min(share[id] - d[id].shown, d[id].open))])));
  let over = DECKS.reduce((n, id) => n + newLeft[id], 0) - totalLeft;
  for (const id of [...order].reverse()) { if (over <= 0) break; const k = Math.min(newLeft[id], over); newLeft[id] -= k; over -= k; }

  /** @type {Record<DeckId, DeckShare>} */ const out = /** @type {any} */ ({});
  for (const id of DECKS) {
    const due = d[id].due, nl = newLeft[id];
    const raw = due * REVIEW_COST[id] + nl * NEW_COST[id];
    const round = id === 'speak' || id === 'build'
      ? { rounds: due + nl ? Math.ceil((due + nl) / ROUND) : 0, minutes: due + nl ? Math.max(1, Math.ceil(raw - 1e-9)) : 0 }
      : roundsOf(raw, due + nl);
    out[id] = { want: want[id], newPerDay: share[id], newLeft: nl, shown: d[id].shown, due, ...round, paused: (examWeek || md === 'eve' || md === 'day') && SIDE.includes(id) && !(id === 'script' && examDecks.script) };
  }
  let pace = null;
  if (examWeek && c.lastNewDay && priorityLeft != null) {
    const needed = Math.ceil(priorityLeft / newDays);
    pace = { lastNew: c.lastNewDay, left: priorityLeft, needed, reach: Math.min(priorityLeft, share.b1 * newDays), fits: share.b1 >= needed };
  }
  /** @type {Allowance} */
  const res = { mode: md, newPerDay: total, newLeft: DECKS.reduce((n, id) => n + newLeft[id], 0), shown, decks: out,
    reviews: { due: dueAll, minutes: Math.round(reviewMin * 10) / 10 }, pace, focus: examWeek && focus,
    room: { minutes: minutes * share0, fixed: Math.max(0, fixedMin), floor } };
  // exam week without a week plan: why new items are none today (Today's note in the countdown)
  if (!planned && examWeek && why) res.why = why;
  if (planned && day) {
    // after a break: the most urgent third at least, or as many as the day holds when that is more
    const fitCards = dueAll && reviewMin > 0 ? Math.floor(minutes / (reviewMin / dueAll)) : dueAll;
    const reviewsToday = kind === 'off' && calm ? 0 : isBreak ? Math.min(dueAll, Math.max(Math.ceil(dueAll / BREAK_SPREAD), fitCards)) : dueAll;
    res.plan = { kind, minutes, slot: calm ? day.slot : null, slotMin, why, reviewsToday, break: isBreak, forecast: fc, steady };
  }
  return res;
}

/** @param {number} x */
const round1 = x => Math.round(x * 10) / 10;

/** Whole rounds for raw minutes of n questions: at least one round when there is anything. @param {number} raw @param {number} n */
const roundsOf = (raw, n) => { const rounds = n > 0 ? Math.max(1, Math.ceil(raw / ROUND_MIN - 1e-9)) : 0; return { rounds, minutes: rounds * ROUND_MIN }; };

/**
 * Split n between decks in proportion to their wants (largest remainder; each capped at its want; every deck with a
 * want gets at least 1 while n allows). Mutates share.
 * @param {DeckId[]} ids @param {Record<DeckId, number>} want @param {Record<DeckId, number>} share @param {number} n
 */
function proportional(ids, want, share, n) {
  let left = n;
  let live = ids.filter(id => want[id] - share[id] > 0);
  while (left > 0 && live.length) {
    const W = live.reduce((s, id) => s + (want[id] - share[id]), 0);
    if (W <= left) { for (const id of live) { left -= want[id] - share[id]; share[id] = want[id]; } break; }
    const parts = live.map(id => { const x = (left * (want[id] - share[id])) / W; return { id, k: Math.floor(x), r: x - Math.floor(x) }; });
    // every deck with a want gets one before the remainders decide
    for (const p of parts) if (p.k === 0 && left > parts.reduce((s, q) => s + q.k, 0)) { p.k = 1; p.r = 0; }
    let given = parts.reduce((s, p) => s + p.k, 0);
    while (given > left) { const p = parts.filter(q => q.k > 1).sort((a, b) => a.r - b.r)[0] || parts.filter(q => q.k > 0).pop(); if (!p) break; p.k--; given--; }
    parts.sort((a, b) => b.r - a.r || ids.indexOf(a.id) - ids.indexOf(b.id));
    for (const p of parts) if (given < left && p.k < want[p.id] - share[p.id]) { p.k++; given++; }
    for (const p of parts) { share[p.id] += p.k; left -= p.k; }
    live = live.filter(id => want[id] - share[id] > 0);
    if (given === 0) break;
  }
}
