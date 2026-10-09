// Meter family (round 8, design C §2): mountRing and mountBar, plus the round's segments re-exported from core/motion.js
// so a feature imports every meter from one file. Same drawing rules everywhere (domain/meter.js meterParts): ink is
// what was done before today, accent is today's gain continuing from the ink's end, the track is surface-2, and a second
// lap past the goal is 40 % ink on an inner ring (never accent).
//
// Motion: update() moves the arcs (stroke-dasharray) or the bar (scaleX) over --dur-fill on --spring-soft from what is
// drawn, never from 0. The first draw is still: the meter stands at its value at once, unless the caller passes `from`
// (the value it showed last time, which the caller keeps: components hold no storage), and then it fills from there.
// Reaching the goal in an update (or from `from`) pops the ring once per mount: 1 → 1.06 → 1, 520 ms spring-pop, as the
// arc closes. Reduced motion: values at once, no pop.
//
// Accessibility: the root is role="meter" with aria-valuemin/max/now and aria-valuetext from the caller ("22 of 60
// minutes today"); where the browser does not reflect ARIA (an older WebKit, a proxy for meter support) it is role="img"
// with "name: value text" as its label. The SVG and the centre label are aria-hidden. `name` is the meter's accessible
// name (required by role meter); `label` is the optional text in the ring's centre.
import { play, reduced, segments } from '../core/motion.js';
import { dash, meterParts, ringGeometry, spread } from '../domain/meter.js';

export { segments };

const NS = 'http://www.w3.org/2000/svg';
/** Ring sizes of the spec (px): 28 inline in a row, 44 plan row, 72 hero and done, 120 Progress. */
export const RING_SIZES = /** @type {const} */ ([28, 44, 72, 120]);

/**
 * @typedef {{ value: number, max: number, today?: number, name?: string, valueText?: string, from?: number,
 *   signal?: AbortSignal }} MeterBase
 * @typedef {MeterBase & { size?: number, segments?: number, label?: string, stroke?: number }} RingOpts
 * @typedef {MeterBase & { height?: number }} BarOpts
 */

/** Whether role="meter" can be relied on here (ARIA reflection arrived with it in WebKit 17). */
const meterRole = () => typeof Element !== 'undefined' && 'ariaValueNow' in Element.prototype;

/** Role and values on the root. @param {HTMLElement} el @param {MeterBase} o */
function setAria(el, o) {
  const max = o.max > 0 ? o.max : 1, now = Math.max(0, Math.min(max, Number(o.value) || 0));
  const text = o.valueText ?? `${o.value} / ${o.max}`;
  if (meterRole()) {
    el.setAttribute('role', 'meter');
    el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(max)); el.setAttribute('aria-valuenow', String(now));
    el.setAttribute('aria-valuetext', text);
    if (o.name) el.setAttribute('aria-label', o.name); else el.removeAttribute('aria-label');
  } else {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', o.name ? `${o.name}: ${text}` : text);
  }
}

/** Run set() with the element's transitions off, so a first draw does not animate. @param {Element[]} els @param {() => void} set */
function still(els, set) {
  const all = /** @type {(HTMLElement | SVGElement)[]} */ (els);
  all.forEach(e => { e.style.transition = 'none'; });
  set();
  void all[0]?.getBoundingClientRect();
  all.forEach(e => { e.style.transition = ''; });
}

/**
 * A ring meter in `el` (the caller's element; it gets the class ui-ring and its size).
 * @param {HTMLElement} el @param {RingOpts} opts @returns {import('./index.js').UiHandle<RingOpts>}
 */
export function mountRing(el, opts) {
  /** @type {RingOpts} */ let o = { today: 0, size: 72, segments: 1, stroke: 5.5, ...opts };
  const n = Math.max(1, Math.floor(o.segments || 1));
  const g = ringGeometry({ stroke: o.stroke, arcs: n });
  // the second lap: one stroke and a 1-unit hairline inside the first, one arc, no gaps
  const g2 = ringGeometry({ stroke: o.stroke, r: g.r - (o.stroke ?? 5.5) - 1 });
  el.classList.add('ui-ring');
  el.style.setProperty('--size', `${o.size}px`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ui-ring-svg');
  /** @param {string} cls @param {ReturnType<typeof ringGeometry>} geo @param {number} i */
  const circle = (cls, geo, i) => {
    const c = document.createElementNS(NS, 'circle');
    for (const [k, v] of [['cx', '50'], ['cy', '50'], ['r', String(geo.r)], ['fill', 'none'], ['stroke-width', String(o.stroke)], ['stroke-linecap', 'butt'], ['class', cls]]) c.setAttribute(k, v);
    c.style.strokeDashoffset = String(geo.offset(i));
    c.style.strokeDasharray = dash(cls === 'ui-ring-track' ? 1 : 0, geo.seg, geo.C);
    return c;
  };
  const arcs = Array.from({ length: n }, (_, i) => {
    const track = circle('ui-ring-track', g, i), gain = circle('ui-ring-arc ui-ring-today', g, i), base = circle('ui-ring-arc ui-ring-base', g, i);
    svg.append(track, gain, base);
    return { gain, base };
  });
  const over = circle('ui-ring-arc ui-ring-over', g2, 0);
  svg.append(over);
  const center = document.createElement('span');
  center.className = 'ui-ring-label'; center.setAttribute('aria-hidden', 'true');
  el.prepend(svg);
  el.append(center);

  let popped = false, alive = true;
  /** @type {string} */ let shownState = 'empty';
  /** @type {number[]} */ const frames = [];
  const moving = () => [...arcs.flatMap(a => [a.gain, a.base]), over];

  /** Draw a value (no motion of its own: the CSS transition moves it). @param {{ value: number, max: number, today?: number }} m */
  const draw = m => {
    const p = meterParts(m);
    const totals = spread(p.total, n), bases = spread(p.base, n);
    arcs.forEach((a, i) => {
      a.gain.style.strokeDasharray = dash(totals[i], g.seg, g.C);
      a.base.style.strokeDasharray = dash(bases[i], g.seg, g.C);
    });
    over.style.strokeDasharray = dash(p.over, g2.seg, g2.C);
    el.dataset.state = p.state;
    return p;
  };
  const label = () => {
    center.textContent = o.label ?? '';
    center.hidden = !o.label;
  };
  /**
   * still: stand at the value. from: stand at `from`, then fill to the value. move: fill from what is drawn now (an
   * update; the CSS transition carries on from wherever a running fill is).
   * @param {'still' | 'from' | 'move'} mode @param {number} [fromValue]
   */
  const show = (mode, fromValue) => {
    setAria(el, o);
    label();
    const target = { value: o.value, max: o.max, today: o.today };
    if (mode === 'still' || reduced()) { still(moving(), () => draw(target)); shownState = meterParts(target).state; return; }
    if (mode === 'from' && fromValue != null) {
      still(moving(), () => draw({ value: fromValue, max: o.max, today: Math.max(0, fromValue - (o.value - (o.today || 0))) }));
      shownState = meterParts({ value: fromValue, max: o.max }).state;
    }
    const before = shownState;
    frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(() => {
      if (!alive) return;
      const p = draw(target);
      shownState = p.state;
      if (!popped && (p.state === 'goal' || p.state === 'over') && before !== 'goal' && before !== 'over') {
        popped = true;
        // the arc reaches its end about 300 ms into the 640 ms soft spring: the pop lands as it closes
        play(svg, [{ transform: 'rotate(-90deg) scale(1)' }, { transform: 'rotate(-90deg) scale(1.06)' }, { transform: 'rotate(-90deg) scale(1)' }],
          { duration: 520, delay: 300, easing: '--spring-pop', fill: 'none' });
      }
    }))));
  };
  show(o.from == null ? 'still' : 'from', o.from);

  const destroy = () => {
    if (!alive) return;
    alive = false;
    frames.forEach(cancelAnimationFrame);
    svg.getAnimations?.().forEach(a => a.cancel());
    o.signal?.removeEventListener('abort', destroy);
  };
  o.signal?.addEventListener('abort', destroy, { once: true });
  return {
    update(next) {
      if (!alive) return;
      o = { ...o, ...next };
      if (next.size != null) el.style.setProperty('--size', `${o.size}px`);
      const moved = 'value' in next || 'max' in next || 'today' in next;
      show(next.from != null ? 'from' : moved ? 'move' : 'still', next.from);
    },
    destroy,
  };
}

/**
 * A bar meter in `el` (the caller's element; it gets the class ui-bar). Same colour logic as the ring; past the goal the
 * bar stays full and the value text says how far over (a bar has no second lap).
 * @param {HTMLElement} el @param {BarOpts} opts @returns {import('./index.js').UiHandle<BarOpts>}
 */
export function mountBar(el, opts) {
  /** @type {BarOpts} */ let o = { today: 0, height: 4, ...opts };
  el.classList.add('ui-bar');
  el.style.setProperty('--h', `${o.height}px`);
  const gain = document.createElement('i'), base = document.createElement('i');
  gain.className = 'ui-bar-today'; base.className = 'ui-bar-base';
  gain.setAttribute('aria-hidden', 'true'); base.setAttribute('aria-hidden', 'true');
  el.append(gain, base);
  let alive = true;
  /** @type {number[]} */ const frames = [];
  /** @param {{ value: number, max: number, today?: number }} m */
  const draw = m => {
    const p = meterParts(m);
    gain.style.setProperty('--p', String(p.total));
    base.style.setProperty('--p', String(p.base));
    el.dataset.state = p.state;
  };
  /** @param {'still' | 'from' | 'move'} mode @param {number} [fromValue] (as mountRing's show) */
  const show = (mode, fromValue) => {
    setAria(el, o);
    const target = { value: o.value, max: o.max, today: o.today };
    if (mode === 'still' || reduced()) { still([gain, base], () => draw(target)); return; }
    if (mode === 'from' && fromValue != null) still([gain, base], () => draw({ value: fromValue, max: o.max, today: Math.max(0, fromValue - (o.value - (o.today || 0))) }));
    frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(() => { if (alive) draw(target); }))));
  };
  show(o.from == null ? 'still' : 'from', o.from);
  const destroy = () => {
    if (!alive) return;
    alive = false;
    frames.forEach(cancelAnimationFrame);
    o.signal?.removeEventListener('abort', destroy);
  };
  o.signal?.addEventListener('abort', destroy, { once: true });
  return {
    update(next) {
      if (!alive) return;
      o = { ...o, ...next };
      if (next.height != null) el.style.setProperty('--h', `${o.height}px`);
      const moved = 'value' in next || 'max' in next || 'today' in next;
      show(next.from != null ? 'from' : moved ? 'move' : 'still', next.from);
    },
    destroy,
  };
}
