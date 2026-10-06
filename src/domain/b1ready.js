/* B1 trainer: readiness, due counts and the forecast. Pure.
   Readiness is defined on a set that does not depend on the exam date: every item in the B1 pool (mistakes from
   corrections excluded by the caller; the B2 layer's items, layer 'b2', are never counted: domain/levels.js). recall = Σ w·R(day) / Σ w, where day is the exam day while the exam is ahead
   and today otherwise, and R of an item never seen is 0: "the chance of recalling each exam item on that day if
   you stopped reviewing now". coverage = Σ w·seen / Σ w; w = 2 for ★ and trap items. Moving the date changes the
   day recall is measured on, never the set, so the percentage cannot jump because the set shrank. Area bars are
   rescaled to the areas that have items. */
import * as D8 from './days.js';
import * as FS from './fsrs.js';
const AREAS = ['speaking', 'grammar', 'reading', 'words', 'writing'];
// writing: the Schreiben phrases (a quarter of the exam); weights are rescaled to the areas a pool has
const WEIGHTS = { speaking: 0.40, grammar: 0.30, reading: 0.15, words: 0.15, writing: 0.25 };
const w = it => (it.star || it.trap ? 2 : 1);
const seenRec = rec => !!(rec && rec.reps);
// The due date a card has while the exam is ahead: its stored due, capped at exam−1 (spread over exam−3 … exam−1 and
// never before the day after its last review) unless it will still be recalled on the exam day (R ≥ 0.95), the rule
// the scheduler applies to new intervals (fsrs.dueFor). The cap is applied on READ, so moving the exam date never
// rewrites a card: move it 9 → 5 → 9 and every due count is what it was. cap = the clock context {today, exam, phase}.
const AHEAD = new Set(['week', 'lastNew', 'eve']);
function dueOn(rec, cap = null) {
  if (!rec || !rec.due || !cap || !cap.exam || !AHEAD.has(cap.phase)) return rec ? rec.due : undefined;
  const capDay = D8.add(cap.exam, -1);
  if (rec.due <= capDay) return rec.due;
  const last = rec.last || cap.today;
  if (FS.R(D8.diff(last, cap.exam), rec.S) >= 0.95) return rec.due;
  const earliest = D8.add(last, 1);
  if (earliest > capDay) return rec.due;
  const d = D8.add(capDay, -(Math.abs(Math.round((rec.S || 0) * 1000)) % 3));   // stable per record
  return d < earliest ? earliest : d;
}
// due today: due ≤ today, or still learning / relearning, and not already answered today unless it's in a step
function isDue(rec, today, cap = null) {
  if (!seenRec(rec)) return false;
  if (rec.learn != null || rec.relearn) return true;
  return dueOn(rec, cap) <= today && rec.last !== today;
}
function bucket() { return { sw: 0, rw: 0, cw: 0, n: 0, seen: 0, due: 0, fast: 0 }; }
function add(b, it, rec, day, today, cap) {
  const ww = w(it), seen = seenRec(rec);
  b.sw += ww; b.n++;
  if (seen) { b.cw += ww; b.seen++; b.rw += ww * FS.Ron(rec, day); if ((rec.stage || 0) >= 2) b.fast++; }
  if (isDue(rec, today, cap)) b.due++;
}
const fin = b => ({ recall: b.sw ? b.rw / b.sw : 0, coverage: b.sw ? b.cw / b.sw : 0, n: b.n, seen: b.seen, due: b.due, speed: b.seen ? b.fast / b.seen : 0, empty: !b.n });
/** The day readiness is measured on: the exam day while it is ahead (or today), else today. @param {{today: string, exam?: string|null, phase: string}} c */
const recallDay = c => (c.exam && (AHEAD.has(c.phase) || c.phase === 'day') ? c.exam : c.today);
// ctx: {pool: [items], store, today, exam, phase, weights?}
function compute(ctx) {
  const { pool, store, today } = ctx;
  const day = recallDay(ctx);
  const weights = ctx.weights || WEIGHTS;
  const areas = {}, groups = {};
  let dueAll = 0;
  for (const it of pool) {
    if (it.layer === 'b2') continue;   // B1 readiness is the B1 pool's (PLAN-REVIEW B7)
    const rec = store[it.id];
    if (isDue(rec, today, ctx)) dueAll++;
    const a = areas[it.area] || (areas[it.area] = bucket());
    add(a, it, rec, day, today, ctx);
    const gk = it.area + '/' + it.group;
    add(groups[gk] || (groups[gk] = bucket()), it, rec, day, today, ctx);
  }
  const out = { areas: {}, groups: {}, overall: null, dueToday: dueAll, day };
  let tw = 0, r = 0, c = 0, n = 0, seen = 0;
  for (const a of AREAS) {
    if (!areas[a]) continue;
    const f = fin(areas[a]); out.areas[a] = f;
    tw += weights[a]; r += weights[a] * f.recall; c += weights[a] * f.coverage; n += f.n; seen += f.seen;
  }
  for (const [k, b] of Object.entries(groups)) out.groups[k] = fin(b);
  out.overall = { recall: tw ? r / tw : 0, coverage: tw ? c / tw : 0, n, seen, without: AREAS.filter(a => !areas[a]) };
  return out;
}
// due counts for the next n days (today first), from the due dates as capped for the exam (cap: the clock context)
function forecast(store, today, n = 7, cap = null) {
  const out = Array.from({ length: n }, (_, i) => ({ day: D8.add(today, i), n: 0 }));
  for (const rec of Object.values(store)) {
    if (!seenRec(rec)) continue;
    const d = isDue(rec, today, cap) ? today : dueOn(rec, cap);
    const i = D8.diff(today, d);
    if (i >= 0 && i < n) out[i].n++;
  }
  return out;
}

const api = { compute, forecast, isDue, dueOn, recallDay, WEIGHTS, AREAS, weightOf: w };
export default api;
export { compute, forecast, isDue, dueOn, recallDay, WEIGHTS, AREAS };
