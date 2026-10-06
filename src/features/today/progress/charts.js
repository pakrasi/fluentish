/* The charts of Today › Progress, drawn as SVG with DOM calls (no markup strings) and sized from their container, so
   axis text stays 11 px at any width. The rules are the dataviz method's and DESIGN.md's:
     - one measure per chart, one y axis, starting at 0; no legend box for a single series (the title names it)
     - lines 2 px, columns at most 24 px wide with a 4 px rounded top, hairline solid grid, recessive axes
     - ink is the data; the accent marks you, now (today's point, this week's column); never green
     - estimated days are a dotted ink-3 line (the plan's documented deviation: dots mean "not measured")
     - every chart has a hover and keyboard readout (arrow keys move it) and a table twin under it; the readout only
       repeats what the table holds
   Motion: a chart can draw in once (play()); under reduced motion it appears drawn. Colours come from classes in
   styles/features/progress.css, so light and dark are the tokens'. */
import { h } from '../../../core/dom.js';
import { reduced } from '../../../core/motion.js';
import * as D8 from '../../../domain/days.js';

const NS = 'http://www.w3.org/2000/svg';
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * An SVG element. @param {string} tag @param {Record<string, string | number | null | undefined>} [attrs] @param {string} [text]
 * @returns {SVGElement}
 */
export function s(tag, attrs = {}, text) {
  const el = /** @type {SVGElement} */ (document.createElementNS(NS, tag));
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

const f1 = (/** @type {number} */ x) => (Math.round(x * 10) / 10).toString();

/* ---------- the readout (one per page) ---------- */

/** @typedef {{value: string, label?: string}} TipLine */
/** @typedef {{show: (x: number, y: number, lines: TipLine[]) => void, hide: () => void, el: HTMLElement}} Tip */

/** The page's readout: a small card that follows the pointer or the keyboard. Visual only (aria-hidden): the table
 * twin carries the same values for screen readers. @returns {Tip} */
export function makeTip() {
  // placed in screen pixels from the left edge (a physical position, set here so the stylesheets stay logical)
  const el = h('div', { class: 'pg-tip', 'aria-hidden': 'true', style: { left: '0px' } });
  return {
    el,
    show(x, y, lines) {
      el.replaceChildren(...lines.map(l => h('div', { class: 'pg-tip-line' }, h('b', { class: 'tnum' }, l.value), l.label ? h('span', null, l.label) : null)));
      el.classList.add('on');
      const w = el.offsetWidth || 160, vw = document.documentElement.clientWidth;
      const left = Math.max(8, Math.min(vw - w - 8, x - w / 2));
      const top = y - (el.offsetHeight || 40) - 12;
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top < 8 ? y + 16 : top)}px)`;
    },
    hide() { el.classList.remove('on'); },
  };
}

/* ---------- scales and axes ---------- */

/** A round axis top and step for values up to v (at most 4 steps of 1, 2, 2.5 or 5 × 10^k). @param {number} v @returns {{max: number, step: number}} */
export function niceAxis(v) {
  if (!(v > 0)) return { max: 1, step: 1 };
  const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= raw) || 10 * p;
  return { max: Math.ceil(v / step) * step, step };
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * Ticks on a time axis: months (the 1st of each), or Mondays over a span under 10 weeks, thinned to fit.
 * @param {string} from @param {string} to @param {number} width the plot's width in px
 * @returns {{day: string, text: string}[]}
 */
export function timeTicks(from, to, width) {
  const span = D8.diff(from, to);
  /** @type {{day: string, text: string}[]} */ let out = [];
  if (span < 70) {
    for (let d = from; d <= to; d = D8.add(d, 1)) if (D8.parse(d).getDay() === 1) out.push({ day: d, text: DAY_MONTH.format(D8.parse(d)) });
  } else {
    const years = from.slice(0, 4) !== to.slice(0, 4);
    const long = span > 300;   // over most of a year, every month label carries its year
    for (let d = `${from.slice(0, 7)}-01`; d <= to; d = D8.add(d, 32).slice(0, 7) + '-01') {
      if (d < from) continue;
      const date = D8.parse(d);
      out.push({ day: d, text: long || (years && d.slice(5, 7) === '01') ? MONTH_YEAR.format(date) : MONTH.format(date) });
    }
  }
  const room = Math.max(1, Math.floor(width / (span < 70 || span > 300 ? 52 : 40)));
  if (out.length > room) { const k = Math.ceil(out.length / room); out = out.filter((_, i) => i % k === 0); }
  return out;
}

/* ---------- a chart's frame: width from the container, redrawn on resize ---------- */

/**
 * Mount a chart that is drawn for a width, and drawn again when its container's width changes.
 * @param {(width: number) => SVGElement} draw @param {{min?: number}} [o]
 * @returns {{el: HTMLElement, svg: () => SVGElement | null, stop: () => void}}
 */
export function frame(draw, { min = 240 } = {}) {
  const el = h('div', { class: 'pg-frame' });
  /** @type {SVGElement | null} */ let cur = null;
  let w = 0;
  const paint = () => {
    const next = Math.max(min, Math.floor(el.clientWidth || 358));
    if (next === w && cur) return;
    w = next;
    const svg = draw(w);
    if (cur) cur.replaceWith(svg); else el.append(svg);
    cur = svg;
  };
  /** @type {ResizeObserver | null} */ let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => paint()); ro.observe(el); }
  queueMicrotask(paint);
  return { el, svg: () => (paint(), cur), stop: () => ro?.disconnect() };
}

/**
 * Keyboard and pointer readout over n positions of a chart.
 * @param {SVGElement} svg @param {Tip} tip @param {number} n
 * @param {(i: number) => {x: number, y: number, lines: TipLine[]}} at  position i in the svg's own units
 * @param {(i: number | null) => void} [mark] draw or clear the chart's own marker
 * @param {(px: number, py: number) => number | null} [pick] the position under a pointer (svg units)
 * @param {(key: string, i: number) => number | undefined} [keys] where an arrow key goes (default: left and right step)
 */
function readout(svg, tip, n, at, mark = () => {}, pick, keys) {
  let i = /** @type {number | null} */ (null);
  const place = (/** @type {number | null} */ k) => {
    i = k;
    mark(k);
    if (k == null) { tip.hide(); return; }
    const b = svg.getBoundingClientRect(), vb = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (svg)).viewBox.baseVal;
    const p = at(k), sx = b.width / (vb.width || b.width), sy = b.height / (vb.height || b.height);
    tip.show(b.left + p.x * sx, b.top + p.y * sy, p.lines);
  };
  const toSvg = (/** @type {PointerEvent} */ e) => {
    const b = svg.getBoundingClientRect(), vb = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (svg)).viewBox.baseVal;
    return [(e.clientX - b.left) * ((vb.width || b.width) / b.width), (e.clientY - b.top) * ((vb.height || b.height) / b.height)];
  };
  svg.addEventListener('pointermove', e => { if (!pick) return; const [x, y] = toSvg(/** @type {PointerEvent} */ (e)); place(pick(x, y)); });
  svg.addEventListener('pointerleave', () => place(null));
  svg.addEventListener('blur', () => place(null));
  svg.addEventListener('focus', () => place(i ?? n - 1));
  svg.addEventListener('keydown', e => {
    const k = /** @type {KeyboardEvent} */ (e).key;
    const cur = i ?? n - 1;
    const own = keys ? keys(k, cur) : undefined;
    const step = /** @type {Record<string, number>} */ ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: 0, ArrowDown: 0, Home: -n, End: n })[k];
    if (own == null && step == null) { if (k === 'Escape') place(null); return; }
    e.preventDefault();
    place(Math.max(0, Math.min(n - 1, own ?? cur + step)));
  });
  return { place };
}

/** Draw a path in once (stroke from start to end); nothing under reduced motion. @param {SVGElement | null} path */
export function drawIn(path) {
  if (!path || reduced() || typeof (/** @type {any} */ (path)).getTotalLength !== 'function') return;
  const L = /** @type {SVGPathElement} */ (/** @type {unknown} */ (path)).getTotalLength();
  if (!(L > 0)) return;
  path.animate([{ strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 }], { duration: 900, easing: EASE_OUT });
}

/** Columns rise once from the baseline, 28 ms apart for the last 8; nothing under reduced motion. @param {SVGElement | null} svg */
export function riseIn(svg) {
  if (!svg || reduced()) return;
  const bars = [...svg.querySelectorAll('.pg-bar')];
  bars.forEach((b, k) => b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 640, easing: EASE_OUT, delay: Math.max(0, k - (bars.length - 8)) * 28, fill: 'backwards' }));
}

/* ---------- line over time ---------- */

/**
 * @typedef {{day: string, v: number, est?: boolean}} LinePoint
 * @typedef {{day: string, kind: 'milestone' | 'jump' | 'pool', text: string}} LineMark
 */

/**
 * A line over time from `from` to `to`, y from 0. Estimated points are dotted; the last point is the accent.
 * @param {object} o
 * @param {LinePoint[]} o.points  in day order, at least one
 * @param {string} o.from @param {string} o.to
 * @param {number} [o.yMax]  a fixed top (1 for shares); else a round one above the data
 * @param {(v: number) => string} o.yFormat
 * @param {number} [o.height] @param {boolean} [o.compact] a small multiple: no axes, grid at half and full
 * @param {LineMark[]} [o.marks]
 * @param {(p: LinePoint) => TipLine[]} o.tip
 * @param {Tip} o.tipEl @param {string} o.aria
 * @returns {(width: number) => SVGElement}
 */
export function lineChart(o) {
  return W => {
    const H = o.height || (o.compact ? 64 : 200);
    const top = o.yMax ?? niceAxis(Math.max(1, ...o.points.map(p => p.v))).max;
    const step = o.yMax ? o.yMax / 2 : niceAxis(top).step;
    const ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    const yLabelW = o.compact ? 0 : Math.max(...ticks.map(v => o.yFormat(v).length)) * 6.6 + 8;
    const L = yLabelW, R = o.compact ? 6 : 10, T = o.compact ? 6 : (o.marks || []).some(m => m.kind !== 'milestone') ? 22 : 10, B = o.compact ? 4 : 24;
    const span = Math.max(1, D8.diff(o.from, o.to));
    const X = (/** @type {string} */ d) => L + (D8.diff(o.from, d) / span) * (W - L - R);
    const Y = (/** @type {number} */ v) => T + (1 - v / top) * (H - T - B);
    const svg = s('svg', { class: ['pg-chart', o.compact ? 'pg-compact' : ''].join(' '), viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.aria, tabindex: 0, focusable: 'true' });
    for (const v of ticks) {
      svg.append(s('line', { class: v ? 'pg-grid' : 'pg-base', x1: L, x2: W - R + (o.compact ? 6 : 0), y1: f1(Y(v)), y2: f1(Y(v)) }));
      if (!o.compact) svg.append(s('text', { class: 'pg-axis', x: L - 8, y: f1(Y(v) + 3.5), 'text-anchor': 'end' }, o.yFormat(v)));
    }
    if (!o.compact) for (const t of timeTicks(o.from, o.to, W - L - R)) svg.append(s('text', { class: 'pg-axis', x: f1(X(t.day)), y: H - 6, 'text-anchor': 'middle' }, t.text));
    const pts = o.points.filter(p => p.day >= o.from && p.day <= o.to);
    // vertical markers: Igloo's import and map releases, labelled at the top
    for (const m of (o.marks || []).filter(m => m.kind !== 'milestone' && m.day >= o.from && m.day <= o.to)) {
      const x = X(m.day);
      svg.append(s('line', { class: 'pg-marker', x1: f1(x), x2: f1(x), y1: T - 4, y2: H - B }));
      const end = x > W - 120;
      svg.append(s('text', { class: 'pg-axis pg-marker-label', x: f1(end ? x - 4 : x + 4), y: T - 8, 'text-anchor': end ? 'end' : 'start' }, m.text));
    }
    const path = (/** @type {LinePoint[]} */ list) => list.map((p, k) => `${k ? 'L' : 'M'}${f1(X(p.day))},${f1(Y(p.v))}`).join('');
    if (o.compact && pts.length > 1) svg.append(s('path', { class: 'pg-wash', d: `${path(pts)}L${f1(X(pts[pts.length - 1].day))},${f1(Y(0))}L${f1(X(pts[0].day))},${f1(Y(0))}Z` }));
    // runs: exact solid, estimated dotted; the dotted run carries on to the first exact point so the line is unbroken
    /** @type {SVGElement | null} */ let first = null;
    let k = 0;
    while (k < pts.length) {
      const est = !!pts[k].est;
      let j = k; while (j < pts.length && !!pts[j].est === est) j++;
      const run = pts.slice(k, est ? Math.min(j + 1, pts.length) : j);
      if (run.length > 1 || (run.length === 1 && pts.length === 1)) {
        const p = s('path', { class: est ? 'pg-line pg-est' : 'pg-line', d: run.length > 1 ? path(run) : `M${f1(X(run[0].day))},${f1(Y(run[0].v))}h0.1` });
        svg.append(p);
        if (!est && !first) first = p;
      }
      k = j;
    }
    svg.dataset.drawn = '';
    /** @type {any} */ (svg).line = first;
    for (const m of (o.marks || []).filter(m => m.kind === 'milestone')) {
      const p = pts.find(x => x.day === m.day); if (!p) continue;
      const x = X(p.day), y = Y(p.v);
      svg.append(s('rect', { class: 'pg-diamond', x: f1(x - 4.5), y: f1(y - 4.5), width: 9, height: 9, transform: `rotate(45 ${f1(x)} ${f1(y)})` }));
    }
    const last = pts[pts.length - 1];
    if (last) svg.append(s('circle', { class: 'pg-now', cx: f1(X(last.day)), cy: f1(Y(last.v)), r: o.compact ? 3.5 : 4.5 }));
    // the readout: a crosshair that snaps to the nearest recorded day
    const cross = s('line', { class: 'pg-cross', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden' });
    const dot = s('circle', { class: 'pg-hot', r: 4, visibility: 'hidden' });
    svg.append(cross, dot);
    if (pts.length) {
      readout(svg, o.tipEl, pts.length,
        i => ({ x: X(pts[i].day), y: Y(pts[i].v), lines: o.tip(pts[i]) }),
        i => {
          for (const el of [cross, dot]) el.setAttribute('visibility', i == null ? 'hidden' : 'visible');
          if (i == null) return;
          const x = f1(X(pts[i].day));
          cross.setAttribute('x1', x); cross.setAttribute('x2', x); dot.setAttribute('cx', x); dot.setAttribute('cy', f1(Y(pts[i].v)));
        },
        px => {
          let best = 0, bd = Infinity;
          pts.forEach((p, i) => { const d = Math.abs(X(p.day) - px); if (d < bd) { bd = d; best = i; } });
          return best;
        });
    }
    return svg;
  };
}

/* ---------- columns by week ---------- */

/** @typedef {{key: string, v: number, partial?: boolean, label: string}} Column */

/**
 * Columns, one per week (or any ordered slot), y from 0; the week of today is the accent.
 * @param {object} o
 * @param {Column[]} o.cols @param {(v: number) => string} o.yFormat @param {number} [o.yMax] a shared top (small multiples)
 * @param {number} [o.height] @param {boolean} [o.compact]
 * @param {{v: number, text: string} | null} [o.ref]   a reference line (the week plan), labelled at its end
 * @param {(c: Column) => TipLine[]} o.tip @param {Tip} o.tipEl @param {string} o.aria
 * @param {(c: Column, i: number) => string | null} [o.xLabel]  the label under a column (months), or null
 * @returns {(width: number) => SVGElement}
 */
export function columns(o) {
  return W => {
    const H = o.height || (o.compact ? 72 : 170);
    const ax = niceAxis(Math.max(o.yMax || 0, ...o.cols.map(c => c.v), o.ref ? o.ref.v : 0));
    const ticks = []; for (let v = 0; v <= ax.max + 1e-9; v += ax.step) ticks.push(v);
    const L = o.compact ? 0 : Math.max(...ticks.map(v => o.yFormat(v).length)) * 6.6 + 8, R = 4, T = o.ref && !o.compact ? 18 : 8, B = o.compact ? 4 : 24;
    const n = Math.max(1, o.cols.length), slot = (W - L - R) / n, bw = Math.max(1, Math.min(24, slot - 2));
    const X = (/** @type {number} */ i) => L + i * slot + (slot - bw) / 2;
    const Y = (/** @type {number} */ v) => T + (1 - v / ax.max) * (H - T - B);
    const svg = s('svg', { class: ['pg-chart', o.compact ? 'pg-compact' : ''].join(' '), viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.aria, tabindex: 0, focusable: 'true' });
    for (const v of o.compact ? [0, ax.max] : ticks) {
      svg.append(s('line', { class: v ? 'pg-grid' : 'pg-base', x1: L, x2: W - R, y1: f1(Y(v)), y2: f1(Y(v)) }));
      if (!o.compact) svg.append(s('text', { class: 'pg-axis', x: L - 8, y: f1(Y(v) + 3.5), 'text-anchor': 'end' }, o.yFormat(v)));
    }
    let lastLabelX = -Infinity;
    o.cols.forEach((c, i) => {
      if (c.v > 0) {
        const y = Y(c.v), hgt = Y(0) - y, r = Math.min(4, bw / 2, hgt);
        svg.append(s('path', { class: c.partial ? 'pg-bar pg-bar-now' : 'pg-bar', 'data-i': i, d: `M${f1(X(i))},${f1(Y(0))}V${f1(y + r)}q0,${f1(-r)} ${f1(r)},${f1(-r)}h${f1(bw - 2 * r)}q${f1(r)},0 ${f1(r)},${f1(r)}V${f1(Y(0))}Z` }));
      }
      const text = !o.compact && o.xLabel ? o.xLabel(c, i) : null;
      if (text && X(i) - lastLabelX >= 34) { svg.append(s('text', { class: 'pg-axis', x: f1(X(i) + bw / 2), y: H - 6, 'text-anchor': 'middle' }, text)); lastLabelX = X(i); }
    });
    if (o.ref && o.ref.v > 0) {
      const y = f1(Y(o.ref.v));
      svg.append(s('line', { class: 'pg-ref', x1: L, x2: W - R, y1: y, y2: y }));
      if (!o.compact) svg.append(s('text', { class: 'pg-axis', x: W - R, y: f1(Y(o.ref.v) - 5), 'text-anchor': 'end' }, o.ref.text));
    }
    const hot = s('rect', { class: 'pg-slot', x: 0, y: T, width: f1(slot), height: f1(H - T - B), visibility: 'hidden' });
    svg.insertBefore(hot, svg.firstChild);
    readout(svg, o.tipEl, o.cols.length,
      i => ({ x: X(i) + bw / 2, y: Y(o.cols[i].v), lines: o.tip(o.cols[i]) }),
      i => {
        hot.setAttribute('visibility', i == null ? 'hidden' : 'visible');
        for (const b of svg.querySelectorAll('.pg-bar.is-hot')) b.classList.remove('is-hot');
        if (i == null) return;
        hot.setAttribute('x', f1(L + i * slot));
        svg.querySelector(`.pg-bar[data-i="${i}"]`)?.classList.add('is-hot');
      },
      px => (px < L ? null : Math.max(0, Math.min(o.cols.length - 1, Math.floor((px - L) / slot)))));
    return svg;
  };
}

/* ---------- study days: a calendar field ---------- */

/**
 * One cell per day, a column per week (Monday on top), shaded by minutes in three ink steps; today outlined in accent.
 * Days before the log began have no cell.
 * @param {object} o
 * @param {{day: string, step: number, min: number, studied: boolean, before: boolean}[]} o.days  from a Monday, in order
 * @param {string} o.today @param {(d: {day: string, step: number, min: number, studied: boolean}) => TipLine[]} o.tip
 * @param {Tip} o.tipEl @param {string} o.aria @param {string[]} o.weekdays  Monday … Sunday, one letter
 * @returns {(width: number) => SVGElement}
 */
export function calendarChart(o) {
  return W => {
    const cols = Math.ceil(o.days.length / 7), lab = 16, topPad = 16;
    const pitch = Math.max(6, Math.min(16, Math.floor((W - lab) / Math.max(1, cols))));
    const cell = pitch - 2;
    const Wd = Math.max(W, lab + cols * pitch), H = topPad + 7 * pitch;
    const svg = s('svg', { class: 'pg-chart pg-cal', viewBox: `0 0 ${Wd} ${H}`, width: Wd, height: H, role: 'img', 'aria-label': o.aria, tabindex: 0, focusable: 'true' });
    for (const r of [0, 2, 4]) svg.append(s('text', { class: 'pg-axis', x: 0, y: f1(topPad + r * pitch + cell - 1) }, o.weekdays[r]));
    let lastMonthX = -Infinity;
    /** @type {{x: number, y: number}[]} */ const pos = [];
    o.days.forEach((d, i) => {
      const c = Math.floor(i / 7), r = i % 7, x = lab + c * pitch, y = topPad + r * pitch;
      pos.push({ x: x + cell / 2, y });
      if (r === 0) {
        const firstOfMonth = Array.from({ length: 7 }, (_, k) => D8.add(d.day, k)).find(x2 => x2.endsWith('-01'));
        if ((firstOfMonth || c === 0) && x - lastMonthX >= 30) { svg.append(s('text', { class: 'pg-axis', x, y: 11 }, MONTH.format(D8.parse(firstOfMonth || d.day)))); lastMonthX = x; }
      }
      if (d.before || d.day > o.today) return;
      svg.append(s('rect', { class: `pg-cell pg-k${d.step}${d.day === o.today ? ' pg-cell-today' : ''}`, 'data-i': i, x, y, width: cell, height: cell, rx: Math.min(2, cell / 3) }));
    });
    const live = o.days.map((d, i) => [d, i]).filter(([d]) => !/** @type {any} */ (d).before && /** @type {any} */ (d).day <= o.today).map(([, i]) => /** @type {number} */ (i));
    const ring = s('rect', { class: 'pg-cell-hot', width: cell + 3, height: cell + 3, rx: 2.5, visibility: 'hidden' });
    svg.append(ring);
    readout(svg, o.tipEl, live.length,
      k => ({ x: pos[live[k]].x, y: pos[live[k]].y, lines: o.tip(o.days[live[k]]) }),
      k => {
        ring.setAttribute('visibility', k == null ? 'hidden' : 'visible');
        if (k == null) return;
        ring.setAttribute('x', f1(pos[live[k]].x - cell / 2 - 1.5)); ring.setAttribute('y', f1(pos[live[k]].y - 1.5));
      },
      (px, py) => {
        const c = Math.floor((px - lab) / pitch), row = Math.floor((py - topPad) / pitch);
        if (c < 0 || row < 0 || row > 6) return null;
        const k = live.indexOf(c * 7 + row);
        return k < 0 ? null : k;
      },
      // up and down move a day, left and right a week
      (key, cur) => {
        const by = /** @type {Record<string, number>} */ ({ ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 })[key];
        if (by == null) return undefined;
        const k = live.indexOf(live[cur] + by);
        return k >= 0 ? k : by < 0 ? Math.max(0, cur - 1) : Math.min(live.length - 1, cur + 1);
      });
    return svg;
  };
}

/* ---------- the level goal's range ---------- */

/**
 * A time strip from today: the 10th to 90th percentile range as a band, the middle as a tick, his month as a line.
 * @param {object} o @param {string} o.today @param {string} o.from @param {string} o.mid @param {string | null} o.to
 * @param {string | null} o.by the last day of his goal month, or null @param {{today: string, by: string}} o.text
 * @param {string} o.aria
 * @returns {(width: number) => SVGElement}
 */
export function rangeStrip(o) {
  return W => {
    const H = 58, L = 2, R = 2, end = [o.to || D8.add(o.from, Math.max(28, D8.diff(o.today, o.from))), o.by || o.today].sort().pop() || o.today;
    const last = D8.add(end, Math.max(14, Math.round(D8.diff(o.today, end) * 0.08)));
    const X = (/** @type {string} */ d) => L + (D8.diff(o.today, d) / Math.max(1, D8.diff(o.today, last))) * (W - L - R);
    const svg = s('svg', { class: 'pg-chart pg-strip', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.aria });
    const y = 24;
    svg.append(s('line', { class: 'pg-base', x1: L, x2: W - R, y1: y + 6, y2: y + 6 }));
    const a = X(o.from), b = o.to ? X(o.to) : W - R;
    svg.append(s('rect', { class: o.to ? 'pg-band' : 'pg-band pg-band-open', x: f1(a), y: y - 1, width: f1(Math.max(3, b - a)), height: 14, rx: 2 }));
    svg.append(s('line', { class: 'pg-mid', x1: f1(X(o.mid)), x2: f1(X(o.mid)), y1: y - 4, y2: y + 16 }));
    svg.append(s('circle', { class: 'pg-now', cx: L + 4, cy: y + 6, r: 4 }));
    svg.append(s('text', { class: 'pg-axis', x: L, y: H - 4 }, o.text.today));
    for (const t of timeTicks(o.today, last, W - 60)) if (X(t.day) > 56 && X(t.day) < W - 20) svg.append(s('text', { class: 'pg-axis', x: f1(X(t.day)), y: H - 4, 'text-anchor': 'middle' }, t.text));
    if (o.by) {
      const x = X(o.by);
      svg.append(s('line', { class: 'pg-ref', x1: f1(x), x2: f1(x), y1: 4, y2: y + 16 }));
      svg.append(s('text', { class: 'pg-axis', x: f1(x > W - 90 ? x - 4 : x + 4), y: 11, 'text-anchor': x > W - 90 ? 'end' : 'start' }, o.text.by));
    }
    return svg;
  };
}

/* ---------- table twins ---------- */

/**
 * A chart's table twin, closed under "Show as a table".
 * @param {string} summary @param {string} caption @param {string[]} head @param {(string | number)[][]} rows
 * @param {{numeric?: number[]}} [o] the columns of numbers (right-aligned, tabular)
 */
export function tableTwin(summary, caption, head, rows, { numeric = [] } = {}) {
  const num = new Set(numeric);
  return h('details', { class: 'pg-table' },
    h('summary', { class: 'pressable' }, summary),
    h('div', { class: 'pg-table-scroll', tabindex: 0, role: 'region', 'aria-label': caption },
      h('table', null,
        h('caption', { class: 'sr-only' }, caption),
        h('thead', null, h('tr', null, head.map((x, i) => h('th', { scope: 'col', class: num.has(i) ? 'num' : null }, x)))),
        h('tbody', null, rows.map(r => h('tr', null, r.map((x, i) => (i === 0 ? h('th', { scope: 'row' }, String(x)) : h('td', { class: num.has(i) ? 'num tnum' : null }, String(x))))))))));
}
