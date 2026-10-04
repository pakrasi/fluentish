/* The exam clock as pure functions over a small state, so it survives reloads, tabs and a phone that sleeps:
     { start: ms, pause: { pausedAt: ms | null, total: ms, count: n, auto?: true }, seen: ms }
   `seen` is the last tick. If the page was closed without pausing, the gap since the last tick counts as a pause, so
   an exam left open overnight never reports 37 hours (the B1 exam app's rule). Leaving the runner pauses the clock.
   Tested in node (tests/unit/exam-timer.test.mjs). */

export const STALE_MS = 3 * 3600e3;
export const GAP_MS = 60e3;

/** @typedef {{ pausedAt: number | null, total: number, count: number, auto?: boolean }} Pause */
/** @typedef {{ start: number, pause: Pause, seen: number | null }} Clock */

/** @param {number} now @returns {Clock} */
export const begin = now => ({ start: now, pause: { pausedAt: null, total: 0, count: 0 }, seen: now });

/** A stored clock with defaults filled in (drafts moved from the old app may lack fields). @param {any} st @returns {Clock | null} */
export function normalize(st) {
  if (!st || !Number.isFinite(st.start)) return null;
  const p = st.pause || {};
  return { start: st.start, pause: { pausedAt: Number.isFinite(p.pausedAt) ? p.pausedAt : null, total: p.total || 0, count: p.count || 0, ...(p.auto ? { auto: true } : {}) }, seen: Number.isFinite(st.seen) ? st.seen : null };
}

/** Milliseconds on the clock (pauses excluded). @param {Clock} st @param {number} now */
export const elapsed = (st, now) => Math.max(0, now - st.start - st.pause.total - (st.pause.pausedAt != null ? now - st.pause.pausedAt : 0));

/** @param {Clock} st */
export const paused = st => st.pause.pausedAt != null;

/** Time left for a module of `minutes` (negative when over). @param {Clock} st @param {number} now @param {number} minutes */
export const left = (st, now, minutes) => minutes * 60e3 - elapsed(st, now);

/** On opening: a gap of more than a minute since the last tick becomes a pause. @param {Clock} st @param {number} now @returns {Clock} */
export function reopen(st, now) {
  if (st.pause.pausedAt == null && st.seen != null && now - st.seen > GAP_MS) return { ...st, pause: { ...st.pause, pausedAt: st.seen, count: st.pause.count + 1, auto: true } };
  return st;
}

/** @param {Clock} st @param {number} now @param {boolean} [auto] @returns {Clock} */
export function pause(st, now, auto = false) {
  if (st.pause.pausedAt != null) return st;
  return { ...st, pause: { ...st.pause, pausedAt: now, count: st.pause.count + 1, ...(auto ? { auto: true } : {}) }, seen: now };
}

/** @param {Clock} st @param {number} now @returns {Clock} */
export function resume(st, now) {
  if (st.pause.pausedAt == null) return st;
  const { auto, ...p } = st.pause;
  return { ...st, pause: { ...p, total: p.total + (now - /** @type {number} */ (p.pausedAt)), pausedAt: null }, seen: now };
}

/** @param {Clock} st @param {number} now @returns {Clock} */
export const tick = (st, now) => (st.pause.pausedAt == null ? { ...st, seen: now } : st);

/** Nothing has happened for 3 hours: ask "continue or start over" before showing the task. @param {Clock} st @param {number} now */
export function stale(st, now) {
  const last = Math.max(st.pause.pausedAt || 0, st.seen || 0, st.start);
  return now - last > STALE_MS;
}

/** "Continue" on a stale clock: the time since the last tick is a pause (capped at the module time when unknown). @param {Clock} st @param {number} now @param {number} minutes */
export function continueStale(st, now, minutes) {
  let s = st;
  if (s.pause.pausedAt == null) {
    const guess = s.seen || Math.min(now, s.start + minutes * 60e3);
    s = { ...s, pause: { ...s.pause, pausedAt: Math.min(now, guess), count: s.pause.count + 1, auto: true } };
  }
  return resume(s, now);
}

/** Pause count and paused seconds, stored with the attempt (meta.pauses). @param {Clock} st @param {number} now */
export const pauses = (st, now) => ({ count: st.pause.count, seconds: Math.round((st.pause.total + (st.pause.pausedAt != null ? now - st.pause.pausedAt : 0)) / 1000) });

/** "4:05" / "65:00". @param {number} sec */
export const fmt = sec => { const s = Math.max(0, Math.floor(Math.abs(sec))); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
