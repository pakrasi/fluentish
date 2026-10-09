// Meter and count-up maths (round 8, design C §2 and §3). Pure: no DOM, no clock. Used by src/ui/meter.js (mountRing,
// mountBar), src/ui/count.js (mountCount), core/motion.js (ring(), countTo()) and Look up's map art.
//
// Ring drawing rules (DESIGN.md components.ring): a circle of radius 50 - stroke / 2 in a 100-unit viewBox, butt caps,
// `gapDeg` between arcs when the ring has more than one, arcs start at 12 o'clock (the SVG is turned -90deg in CSS).
// Ink = before today, accent = today's gain continuing from the ink arc's end, a second lap (over the goal) in 40 % ink.

/** Clamp to 0..1; NaN and undefined are 0. @param {number | undefined | null} v */
export const clamp01 = v => (typeof v === 'number' && v > 0 ? (v < 1 ? v : 1) : 0);

/**
 * The geometry of a ring of `arcs` equal arcs. seg = length of one arc, gap = length of one gap (none for one arc),
 * C = circumference. offset(i) is the stroke-dashoffset that starts arc i in its place.
 * @param {{ stroke?: number, arcs?: number, gapDeg?: number, r?: number }} [o]
 */
export function ringGeometry({ stroke = 5.5, arcs = 1, gapDeg = 5, r } = {}) {
  const n = Math.max(1, Math.floor(arcs));
  const radius = r ?? 50 - stroke / 2;
  const C = 2 * Math.PI * radius;
  const gap = n > 1 ? (gapDeg / 360) * C : 0;
  const seg = C / n - gap;
  return { r: radius, C, n, gap, seg, stroke, offset: (/** @type {number} */ i) => -(i * (seg + gap)) };
}

/** stroke-dasharray for an arc of `fraction` (0..1, clamped) of `length`, on a circle of circumference C. @param {number} fraction @param {number} length @param {number} C */
export const dash = (fraction, length, C) => `${round3(clamp01(fraction) * length)} ${round3(C)}`;
/** @param {number} n */
const round3 = n => Math.round(n * 1000) / 1000;

/**
 * Where a meter stands. value and today are in the meter's unit (minutes, items); max > 0.
 *   base  share of the goal reached before today (ink), 0..1
 *   total share reached with today (base + today's gain in accent), 0..1
 *   over  the second lap, share of the goal beyond it (40 % ink), 0..1
 *   state 'empty' | 'partial' | 'goal' | 'over'
 * A max of 0 or less is a meter with nothing to meet: empty when nothing is done, goal otherwise.
 * @param {{ value: number, max: number, today?: number }} m
 * @returns {{ base: number, total: number, over: number, state: 'empty' | 'partial' | 'goal' | 'over' }}
 */
export function meterParts({ value, max, today = 0 }) {
  const v = Math.max(0, Number(value) || 0), g = Math.max(0, Math.min(v, Number(today) || 0));
  if (!(max > 0)) return v > 0 ? { base: 1, total: 1, over: 0, state: 'goal' } : { base: 0, total: 0, over: 0, state: 'empty' };
  const total = clamp01(v / max), base = Math.min(total, clamp01((v - g) / max));
  const over = clamp01((v - max) / max);
  const state = v <= 0 ? 'empty' : v < max ? 'partial' : v > max ? 'over' : 'goal';
  return { base, total, over, state };
}

/**
 * One value spread over `n` arcs (a segmented ring of one quantity): arc i holds clamp(f * n - i).
 * @param {number} fraction 0..1 @param {number} n @returns {number[]}
 */
export const spread = (fraction, n) => Array.from({ length: Math.max(1, Math.floor(n)) }, (_, i) => clamp01(clamp01(fraction) * Math.max(1, Math.floor(n)) - i));

/** Ease-out quart, the count-up curve: 0 at 0, 1 at 1, clamped outside. @param {number} k */
export const easeOutQuart = k => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(1 - k, 4));

/**
 * The number a count-up shows at progress k (0..1) from `from` to `to`, rounded to `decimals`. Exactly `to` at k >= 1
 * and exactly `from` at k <= 0, so the last frame never shows 41.99 for 42.
 * @param {number} from @param {number} to @param {number} k @param {number} [decimals]
 */
export function countAt(from, to, k, decimals = 0) {
  if (k >= 1) return to;
  if (k <= 0) return from;
  const p = Math.pow(10, Math.max(0, Math.floor(decimals)));
  return Math.round((from + (to - from) * easeOutQuart(k)) * p) / p;
}
