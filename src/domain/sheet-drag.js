/* The maths of a bottom sheet under the finger (src/ui/sheet.js; spec: round 8 design C "### 6"). Pure, tested in
   node (tests/unit/sheet-drag.test.mjs).

   Positions are the panel's offset down from its full height, in px: 0 is full, the panel's height is closed. A peek
   detent sits at height - peek. While dragging the panel follows the finger 1:1, and past the top detent it moves a
   quarter of the finger's way (a rubber band). On release the velocity of the last 80 ms decides: faster than
   0.6 px/ms carries it to the next stop in that direction (the next lower detent, or closed); slower, it settles on
   the nearest detent, and closes only when dragged more than a third of the lowest detent's visible height. */

/** Samples older than this do not count towards the release velocity (ms). */
export const WINDOW_MS = 80;
/** A release faster than this (px/ms) is a flick: it moves on to the next stop in its direction. */
export const FLING = 0.6;
/** Dragged further than this share of the visible height below the lowest detent, a slow release closes. */
export const CLOSE_SHARE = 0.33;
/** Past the top detent the panel moves this share of the finger's way. */
export const RUBBER = 0.25;

/** @typedef {{t: number, y: number}} Sample  t in ms (event.timeStamp), y the pointer's clientY */
/** @typedef {'full' | 'peek'} Detent */
/** @typedef {{name: Detent, y: number}} Stop */

/**
 * Add a pointer sample and drop the ones that can no longer count (keeps one older than the window, so a slow
 * last stretch still has a start). Returns a new array.
 * @param {Sample[]} samples @param {number} t @param {number} y
 */
export function addSample(samples, t, y) {
  const out = [...samples, { t, y }];
  let i = 0;
  while (out.length - i > 2 && t - out[i + 1].t > WINDOW_MS) i++;
  return out.slice(i);
}

/**
 * The pointer's velocity over the last WINDOW_MS before `now` (px/ms, positive downward). 0 when the finger rested
 * at the end, or with fewer than two samples.
 * @param {Sample[]} samples @param {number} [now] the release time (default: the last sample's)
 */
export function velocity(samples, now) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const end = now ?? last.t;
  if (end - last.t > WINDOW_MS) return 0;   // held still before letting go
  let first = samples[0];
  for (const s of samples) { if (end - s.t <= WINDOW_MS) { first = s; break; } }
  if (first === last) first = samples[samples.length - 2];
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

/**
 * Where the panel is for a finger that moved it to `y`: 1:1 at or below the top stop, RUBBER above it.
 * @param {number} y @param {number} [top] the top detent's offset (0)
 */
export function follow(y, top = 0) {
  return y >= top ? y : top + (y - top) * RUBBER;
}

/**
 * The open detents as offsets, top first. peek is a share of the height (0 to 1) or px; a peek as tall as the panel
 * (or taller) is the full height.
 * @param {number} height the panel's full height @param {readonly Detent[]} detents @param {number} [peek]
 * @returns {Stop[]}
 */
export function stops(height, detents, peek = 0.5) {
  const px = peek <= 1 ? height * peek : peek;
  /** @type {Stop[]} */ const out = [];
  for (const d of detents) out.push({ name: d, y: d === 'peek' ? Math.max(0, Math.round(height - Math.min(px, height))) : 0 });
  out.sort((a, b) => a.y - b.y);
  return out.length ? out : [{ name: 'full', y: 0 }];
}

/**
 * Where a release at offset y with velocity v (px/ms, down positive) settles.
 * @param {{y: number, v: number, height: number, stops: Stop[]}} o
 * @returns {{to: Detent | 'closed', y: number}}
 */
export function settle({ y, v, height, stops: list }) {
  const lowest = list[list.length - 1];
  if (v > FLING) {
    const next = list.find(s => s.y > y + 1);
    return next ? { to: next.name, y: next.y } : { to: 'closed', y: height };
  }
  if (v < -FLING) {
    const above = [...list].reverse().find(s => s.y < y - 1) || list[0];
    return { to: above.name, y: above.y };
  }
  if (y > lowest.y + CLOSE_SHARE * (height - lowest.y)) return { to: 'closed', y: height };
  let best = list[0];
  for (const s of list) if (Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
  return { to: best.name, y: best.y };
}

/**
 * How long the panel takes to leave from offset y after a release at v: the speed of the flick carries it (an
 * ease-out starts about twice its average speed), between 120 and 280 ms. A slow close takes 160 ms (DESIGN: exits).
 * @param {number} distance px still to go @param {number} v px/ms
 */
export function closeMs(distance, v) {
  if (v <= FLING) return 160;
  return Math.round(Math.min(280, Math.max(120, (2 * Math.max(0, distance)) / v)));
}

/** The scrim's opacity at offset y: 1 at full, 0 closed. @param {number} y @param {number} height */
export const scrimAt = (y, height) => (height > 0 ? Math.min(1, Math.max(0, 1 - y / height)) : 1);
