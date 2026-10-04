/* B1 trainer: FSRS-4.5 scheduler with an exam-date cap. Pure; an ES module, tested in node.
   Record (doors.b1.fsrs.v1[id]): {S, D, due, reps, lapses, last, first, stage, streak, learn, relearn, u, hist}
   - learn: in-session learning step (0/1, null = graduated). 2 correct answers graduate a new item to tomorrow.
   - relearn: a lapse today; one correct reinsertion → due tomorrow.
   - stage 0..3 picks the timer multiplier (1.5 new · 1.2 young · 1.0 review · 0.8 automatic). Capped at 2 until the exam.
   - hist: [[date, rating 1-4, ms, mode 't'|'s', flags]] (last 12). flags: l log-only, r self-repair, c capitals,
     y typo, u umlaut, o over time, p phrase right but the rest of the sentence not, a Claude verdict, d<cls> detector class.
   Only the first attempt of the day changes S/D/due (P12); later ones only log. On the exam day nothing is written. */
import * as D8 from './days.js';
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const F = 19 / 81, C = -0.5;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const R = (t, S) => Math.pow(1 + F * Math.max(0, t) / S, C);
const interval = (S, r) => Math.max(1, Math.round(S / F * (Math.pow(r, 1 / C) - 1)));
const D0 = g => W[4] - (g - 3) * W[5];
const init = g => ({ S: W[g - 1], D: clamp(D0(g), 1, 10) });
// FSRS-4.5: mean reversion toward D0(3)
function next(rec, g, t) {
  const r = R(t, rec.S);
  const D = clamp(W[7] * D0(3) + (1 - W[7]) * (rec.D - W[6] * (g - 3)), 1, 10);
  let S;
  if (g > 1) S = rec.S * (1 + Math.exp(W[8]) * (11 - D) * Math.pow(rec.S, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
  else S = Math.min(rec.S, W[11] * Math.pow(D, -W[12]) * (Math.pow(rec.S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
  return { S: Math.max(0.1, S), D };
}
// 1 Again · 2 Hard · 3 Good · 4 Easy. limit null = untimed (new items).
function rate(o) {
  if (!o.ok || o.revealed) return 1;
  if (o.limit && o.ms > 2 * o.limit * 1000) return 1;
  // Hard: late, self-repaired, a capital or umlaut slip, or the phrase right but the rest of its sentence not (partial)
  if ((o.limit && o.ms > o.limit * 1000) || o.selfRepair || o.capSlip || o.umlaut || o.claudeMinor || o.partial) return 2;
  if (o.limit && o.stage >= 2 && o.ms <= 0.5 * o.limit * 1000 && o.prevRating === 3) return 4;
  return 3;
}
// no exam date ('none') follows the 'after' rules: normal retention, no cap
const open = phase => phase === 'after' || phase === 'none';
const retention = phase => open(phase) ? 0.90 : 0.92;
// due date for a review with stability S, capped at exam−1 (load-balanced over exam−3 … exam−1) unless R(exam) ≥ 0.95
function dueFor(S, ctx) {
  const t = ctx.today;
  let ivl = interval(S, retention(ctx.phase));
  if (open(ctx.phase) || !ctx.exam) return D8.add(t, Math.min(ivl, 365));
  const due = D8.add(t, ivl), cap = D8.add(ctx.exam, -1);
  if (due <= cap) return due;
  if (R(D8.diff(t, ctx.exam), S) >= 0.95) return due;
  if (D8.add(t, 1) > cap) return D8.add(t, 1);
  let lo = D8.add(ctx.exam, -3); if (lo < D8.add(t, 1)) lo = D8.add(t, 1);
  let best = cap, bestN = Infinity;
  for (let d = cap; d >= lo; d = D8.add(d, -1)) {   // later days win ties
    const n = ctx.forecast ? ctx.forecast(d) : 0;
    if (n < bestN) { bestN = n; best = d; }
  }
  return best;
}
function staircase(rec, g, onTime, phase) {
  if (g >= 3 && onTime) { rec.streak = (rec.streak || 0) + 1; if (rec.streak >= 3) { rec.stage = Math.min(open(phase) ? 3 : 2, (rec.stage || 0) + 1); rec.streak = 0; } }
  else if (g <= 2) { rec.stage = Math.max(0, (rec.stage || 0) - 1); rec.streak = 0; }
  if (rec.S < 3) rec.stage = Math.min(rec.stage, 1);
}
// One answer. o = {g, ms, onTime, mode, flags}. ctx = {today, exam, phase, forecast(day)}, now (ms, for u).
// Returns {rec, reinsert: null | 'learn' | 'lapse', wrote: bool}
function schedule(rec0, o, ctx, now = Date.now()) {
  const t = ctx.today, g = o.g;
  const entry = [t, g, Math.round(o.ms || 0), o.mode || 't', o.flags || ''];
  const log = rec => { rec.hist = [...(rec.hist || []), entry].slice(-12); rec.u = now; };
  if (ctx.phase === 'day' || o.logOnly) {
    if (!rec0) return { rec: null, reinsert: null, wrote: false };
    const rec = { ...rec0 }; entry[4] += 'l'; log(rec);
    return { rec, reinsert: null, wrote: false };
  }
  let rec, reinsert = null, wrote = true;
  if (!rec0 || !rec0.reps) {
    rec = { ...init(g), reps: 1, lapses: 0, last: t, first: t, stage: 0, streak: 0, learn: g >= 3 ? 1 : 0, relearn: false, due: t, hist: rec0?.hist || [] };
    reinsert = 'learn';
  } else if (rec0.learn != null) {
    rec = { ...rec0 };
    if (rec.last === t) entry[4] += 'l'; else rec.last = t;
    if (g >= 3) rec.learn++;
    if (rec.learn >= 2) { rec.learn = null; rec.due = D8.add(t, 1); rec.stage = Math.max(rec.stage || 0, 0); }
    else { rec.due = t; reinsert = 'learn'; }
    wrote = !entry[4].includes('l');
  } else if (rec0.last !== t) {
    rec = { ...rec0 };
    const s = next(rec, g, D8.diff(rec.last || t, t));
    rec.S = s.S; rec.D = s.D; rec.reps++; rec.last = t;
    if (g === 1) { rec.lapses++; rec.relearn = true; rec.due = t; reinsert = 'lapse'; }
    else { rec.relearn = false; rec.due = dueFor(rec.S, ctx); }
    staircase(rec, g, o.onTime, ctx.phase);
  } else {
    rec = { ...rec0 }; entry[4] += 'l'; wrote = false;
    if (rec.relearn) { if (g >= 3) { rec.relearn = false; rec.due = D8.add(t, 1); } else reinsert = 'lapse'; }
  }
  log(rec);
  return { rec, reinsert, wrote };
}
// retrievability on a given day (unseen = 0); learning items count with their initial S from their last answer
const Ron = (rec, day) => rec && rec.reps ? R(D8.diff(rec.last, day), rec.S) : 0;

/**
 * The exam moved EARLIER: every card due after the new cap (exam−1) would miss its pre-exam review, so clamp it.
 * Clamped cards are spread over cap−2 … cap by count (fewest first, later days win ties), never before tomorrow.
 * Moving the date later changes nothing. Returns {id: newDue} for the cards that move; the caller writes them.
 * @param {Record<string, {due?: string, reps?: number}>} store
 * @param {{today: string, exam: string|null, phase: string}} ctx  the context for the NEW date
 * @returns {Record<string, string>}
 */
function recap(store, ctx) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!ctx.exam || open(ctx.phase) || ctx.phase === 'day') return out;
  const cap = D8.add(ctx.exam, -1), tomorrow = D8.add(ctx.today, 1);
  if (cap < tomorrow) return out;
  /** @type {string[]} */ const days = [];
  for (let d = cap; d >= D8.add(cap, -2) && d >= tomorrow; d = D8.add(d, -1)) days.push(d);
  /** @type {Record<string, number>} */ const load = Object.fromEntries(days.map(d => [d, 0]));
  for (const rec of Object.values(store)) if (rec && rec.reps && rec.due && load[rec.due] != null) load[rec.due]++;
  const ids = Object.keys(store).filter(id => { const r = store[id]; return r && r.reps && r.due && r.due > cap; }).sort();
  for (const id of ids) {
    let best = days[0];
    for (const d of days) if (load[d] < load[best]) best = d;
    out[id] = best; load[best]++;
  }
  return out;
}
const api = { W, R, Ron, interval, init, next, rate, schedule, dueFor, D0, recap };
export default api;
export { W, R, Ron, interval, init, next, rate, schedule, dueFor, D0, recap };
