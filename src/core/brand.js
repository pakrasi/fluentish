// Fluentish brand graphics. ES module, no build. The atmosphere lazily imports the vendored
// @paper-design/shaders (src/vendor/paper-shaders, same origin, no CDN); everything else is plain DOM / 2D canvas.
// Copied from the design kit with its API kept. Changes: the vendored shader path, markNode() (the mark built with
// DOM calls, for pages that never parse markup), and runway's `examLabel` option for i18n.
import { reduced, haptic } from './motion.js';
import { runwayDays, midnight, daysBetween } from '../domain/runway.js';

const root = document.documentElement;
const css = name => getComputedStyle(root).getPropertyValue(name).trim();

/* ------------------------------------------------------------------ */
/* Mark                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The mark: a sentence of word tiles, three set and one still open.
 * Uses currentColor; the open tile is outlined. 32x32 grid, crisp at 20-32px.
 */
export function markNode({ title = 'Fluentish' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('fill', 'currentColor');
  if (title) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', title); } else svg.setAttribute('aria-hidden', 'true');
  const rects = [[2, 7, 16, 7.5, 2], [20.5, 7, 9.5, 7.5, 2], [2, 17.5, 9, 7.5, 2]];
  for (const [x, y, w, h, r] of rects) {
    const e = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, rx: r })) e.setAttribute(k, String(v));
    svg.append(e);
  }
  const open = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ x: 14.25, y: 18.25, width: 15, height: 6, rx: 1.6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 })) open.setAttribute(k, String(v));
  svg.append(open);
  return svg;
}

/** The mark as an SVG string (kit API; for static pages and icons). In the app use markNode(). */
export function markSVG({ title = 'Fluentish' } = {}) {
  return `<svg viewBox="0 0 32 32" role="img" aria-label="${title}" fill="currentColor">
  <rect x="2" y="7" width="16" height="7.5" rx="2"/>
  <rect x="20.5" y="7" width="9.5" height="7.5" rx="2"/>
  <rect x="2" y="17.5" width="9" height="7.5" rx="2"/>
  <rect x="14.25" y="18.25" width="15" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Readiness field                                                      */
/* ------------------------------------------------------------------ */

const STATE = { empty: 0, learning: 1, known: 2, new: 3 };

/**
 * One square per item in the exam pool. 0 empty, 1 learning, 2 known, 3 known today (accent).
 * The canvas only animates during intro() and ripple(); otherwise it is a still drawing.
 *   const f = new Field(canvas, states, { label: '412 of 640 items known' });
 *   f.intro();               // once, when it first scrolls into view
 *   f.ripple(i);             // after a correct answer for item i: cell turns accent, wave spreads
 *   f.set(i, 2);             // silent state change
 */
export class Field {
  // App changes: `label: null` leaves the canvas aria-hidden (the page carries the numbers in text), destroy() drops
  // the observers when a view re-renders, and cells not started get a hairline outline so the field's extent shows.
  constructor(canvas, states, { cell, gap, label } = {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.s = Uint8Array.from(states);
    this.opts = { cell, gap };
    this.anim = new Map(); // index -> {t0, kind}
    this.waves = [];       // {i, t0}
    this.introT0 = null;
    this.raf = 0;
    if (label) { canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label); } else canvas.setAttribute('aria-hidden', 'true');
    this.readColors();
    this.layout();
    this.ro = new ResizeObserver(() => { this.layout(); this.draw(performance.now()); });
    this.ro.observe(canvas);
    this.onTheme = () => { this.readColors(); this.draw(performance.now()); };
    this.scheme = matchMedia('(prefers-color-scheme: dark)');
    this.scheme.addEventListener('change', this.onTheme);
    this.mo = new MutationObserver(this.onTheme);
    this.mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    this.hidden = false;
    this.draw(performance.now());
  }

  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.mo.disconnect(); this.scheme.removeEventListener('change', this.onTheme); }

  readColors() {
    this.col = [css('--cell-empty'), css('--cell-learning'), css('--cell-known'), css('--accent')];
    this.edge = css('--hairline-strong');
  }

  layout() {
    const w = this.c.clientWidth || this.c.parentElement.clientWidth;
    const phone = w < 520;
    this.cell = this.opts.cell ?? (phone ? 7 : 9);
    this.gap = this.opts.gap ?? 2;
    const p = this.cell + this.gap;
    this.cols = Math.max(1, Math.floor((w + this.gap) / p));
    this.rows = Math.ceil(this.s.length / this.cols);
    const h = this.rows * p - this.gap;
    const dpr = Math.min(3, devicePixelRatio || 1);
    this.dpr = dpr; this.w = w; this.h = h;
    this.c.style.height = h + 'px';
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
  }

  xy(i) { const p = this.cell + this.gap; return [(i % this.cols) * p, Math.floor(i / this.cols) * p]; }

  set(i, state) { this.s[i] = state; this.draw(performance.now()); }

  /** Diagonal fill sweep, ~700 ms. Skipped under reduced motion. */
  intro() {
    if (reduced()) { this.draw(performance.now()); return; }
    this.introT0 = performance.now(); this.loop();
  }

  /** Correct answer on item i: the cell lands in accent, a soft wave crosses its neighbours. */
  ripple(i, { state = STATE.new } = {}) {
    this.s[i] = state;
    if (reduced()) { this.draw(performance.now()); return; }
    const t0 = performance.now();
    this.anim.set(i, t0);
    this.waves.push({ i, t0 });
    this.loop();
  }

  loop() { if (!this.raf) this.raf = requestAnimationFrame(t => { this.raf = 0; this.frame(t); }); }

  frame(now) {
    const busy = this.draw(now);
    if (busy) this.loop();
  }

  draw(now) {
    const { ctx, cell, dpr, cols } = this;
    const p = cell + this.gap;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    let busy = false;

    // intro sweep: cell appears when (col+row) passes the front
    let front = Infinity;
    if (this.introT0 != null) {
      const k = (now - this.introT0) / 700;
      if (k >= 1.4) this.introT0 = null; else { front = k * (cols + this.rows); busy = true; }
    }
    // waves: radius grows ~0.06 cells/ms, band 2.5 cells, fades by 720 ms
    this.waves = this.waves.filter(w => now - w.t0 < 720);
    if (this.waves.length) busy = true;
    const wavesXY = this.waves.map(w => ({ x: w.i % cols, y: Math.floor(w.i / cols), r: (now - w.t0) * 0.03, a: 1 - (now - w.t0) / 720 }));

    const r = Math.min(2, cell * 0.25);
    for (let i = 0; i < this.s.length; i++) {
      const cx = i % cols, cy = Math.floor(i / cols);
      let x = cx * p, y = cy * p, size = cell, alpha = 1;
      if (front !== Infinity) {
        const d = front - (cx + cy * 1.4) * 0.9;
        if (d <= 0) continue;
        const e = Math.min(1, d / 3);
        alpha = e; size = cell * (0.4 + 0.6 * e);
      }
      let color = this.col[this.s[i]];
      // wave highlight
      let lift = 0;
      for (const w of wavesXY) {
        const dist = Math.hypot(cx - w.x, cy - w.y);
        const band = Math.abs(dist - w.r);
        if (band < 2 && dist > 0) lift = Math.max(lift, (1 - band / 2) * w.a);
      }
      // landing cell: pop from 1.7x with a damped overshoot
      const t0 = this.anim.get(i);
      if (t0 != null) {
        const k = (now - t0) / 520;
        if (k >= 1) this.anim.delete(i);
        else { busy = true; size = cell * (1 + 0.7 * Math.exp(-6 * k) * Math.cos(9 * k)); }
      }
      const off = (cell - size) / 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      roundRect(ctx, x + off, y + off, size, size, r);
      if (this.s[i] === 0 && this.edge) { ctx.strokeStyle = this.edge; ctx.lineWidth = 1; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x + off + 0.5, y + off + 0.5, size - 1, size - 1, r); else ctx.rect(x + off + 0.5, y + off + 0.5, size - 1, size - 1); ctx.stroke(); }
      if (lift > 0) {
        ctx.globalAlpha = lift * 0.4;
        ctx.fillStyle = this.col[3];
        roundRect(ctx, x, y, cell, cell, r);
      }
    }
    ctx.globalAlpha = 1;
    return busy;
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* Exam countdown runway                                                */
/* ------------------------------------------------------------------ */

// Days are built from year/month/date (domain/runway.js), never by adding 24 h: across a DST change that drifts.

/**
 * One column per day from `from` to the exam. Bar height = planned minutes,
 * fill = minutes done. Today is accent; the exam day is a diamond.
 *   runway(el, { exam: settingsExamDate, today: new Date(), plan: day => 45, done: day => 20, past: 2 })
 * plan/done are functions of a Date (minutes). Over 35 days it switches to weeks.
 * Returns the number of days left (calendar days until the exam).
 */
export function runway(el, { exam, today = new Date(), plan = () => 40, done = () => 0, past = 0, locale, examLabel = 'Exam', minLabel = (d, p) => `${d} of ${p} min` } = {}) {
  const t = midnight(today), e = midnight(exam);
  const left = daysBetween(t, e);
  const days = runwayDays(t, e, past);
  const weekly = days.length > 35;
  const items = weekly ? chunk(days, 7) : days.map(d => [d]);
  const maxPlan = Math.max(1, ...items.map(g => g.reduce((s, d) => s + plan(d), 0)));
  const fmtDay = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const fmtNum = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  el.className = 'runway'; el.style.setProperty('--n', items.length);
  el.style.setProperty('--gap', items.length > 20 ? '3px' : '6px');
  el.setAttribute('role', 'list');
  el.textContent = '';
  items.forEach((g, i) => {
    const isExam = g.some(d => +d === +e), isToday = g.some(d => +d === +t), isPast = g[g.length - 1] < t;
    const p = g.reduce((s, d) => s + plan(d), 0), dn = g.reduce((s, d) => s + done(d), 0);
    const col = document.createElement('div');
    col.className = 'runway-day' + (isExam && !weekly ? ' is-exam' : '') + (isToday ? ' is-today' : '') + (isPast ? ' is-past' : '');
    col.setAttribute('role', 'listitem');
    col.style.setProperty('--i', i);
    const bar = document.createElement('div'); bar.className = 'runway-bar';
    bar.style.setProperty('--h', isExam && !weekly ? '64px' : `${Math.round(22 + 42 * (p / maxPlan))}px`);
    const fillEl = document.createElement('span');
    fillEl.style.setProperty('--p', 0);
    bar.append(fillEl);
    const lab = document.createElement('abbr');
    const d0 = g[0];
    lab.textContent = weekly ? (i % 2 ? '' : fmtNum.format(d0)) : (isExam ? examLabel : items.length > 14 ? (i % 3 ? '' : d0.getDate()) : fmtDay.format(d0).slice(0, 2));
    lab.title = fmtNum.format(d0);
    col.setAttribute('aria-label', isExam ? `${examLabel}, ${fmtNum.format(e)}` : `${fmtNum.format(d0)}: ${minLabel(Math.round(dn), Math.round(p))}`);
    col.append(bar, lab);
    el.append(col);
    const ratio = isExam && !weekly ? 0 : Math.min(1, dn / (p || 1));
    if (reduced()) fillEl.style.setProperty('--p', ratio);
    else requestAnimationFrame(() => requestAnimationFrame(() => fillEl.style.setProperty('--p', ratio)));
  });
  return left;
}
function chunk(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

/* ------------------------------------------------------------------ */
/* This week's strip (Today in maintenance, round 4)                    */
/* ------------------------------------------------------------------ */

/**
 * Seven columns, Monday first, drawn like the runway: bar height = planned minutes, fill = minutes done, today in
 * accent, an Off day a baseline (a bar of its minutes when he studied anyway). Each column fills once from `from`
 * (the share shown last time, so coming back from a round fills only what the round added); under reduced motion the
 * fills are set at once.
 *   weekStrip(el, [{ label: 'Mo', sub: 'Light', plan: 20, done: 12, today: false, aria: 'Mon 5 Oct, …' }, …], { from })
 * @param {HTMLElement} el
 * @param {{label: string, sub: string, plan: number, done: number, today: boolean, aria: string}[]} cols
 * @param {{from?: (number | null)[]}} [o] each column's share shown before (null: from empty)
 */
export function weekStrip(el, cols, { from = [] } = {}) {
  const maxPlan = Math.max(1, ...cols.map(c => Math.max(c.plan, c.done)));
  el.className = 'runway wk-strip'; el.style.setProperty('--n', String(cols.length));
  el.setAttribute('role', 'list');
  el.textContent = '';
  const fills = cols.map((c, i) => {
    const col = document.createElement('div');
    const off = !c.plan;
    col.className = 'runway-day' + (c.today ? ' is-today' : '') + (off ? ' is-off' : '') + (off && c.done ? ' is-extra' : '');
    col.setAttribute('role', 'listitem');
    col.setAttribute('aria-label', c.aria);
    col.title = c.aria;
    col.style.setProperty('--i', String(i));
    const bar = document.createElement('div'); bar.className = 'runway-bar';
    const h = off && !c.done ? 0 : Math.round(22 + 42 * ((off ? c.done : c.plan) / maxPlan));
    bar.style.setProperty('--h', `${h}px`);
    const fillEl = document.createElement('span');
    bar.append(fillEl);
    const lab = document.createElement('abbr'); lab.textContent = c.label; lab.setAttribute('aria-hidden', 'true');
    const sub = document.createElement('small'); sub.textContent = c.sub; sub.setAttribute('aria-hidden', 'true');
    col.append(bar, lab, sub);
    el.append(col);
    const ratio = off ? (c.done ? 1 : 0) : Math.min(1, c.done / c.plan);
    const start = reduced() ? ratio : Math.max(0, Math.min(1, from[i] ?? 0));
    fillEl.style.setProperty('--p', String(start));
    return { fillEl, ratio, start };
  });
  if (!reduced()) requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(f => { if (f.ratio !== f.start) f.fillEl.style.setProperty('--p', String(f.ratio)); })));
  return fills.map(f => f.ratio);
}

/* ------------------------------------------------------------------ */
/* Study days strip                                                     */
/* ------------------------------------------------------------------ */

/**
 * Last N days as squares, oldest first; the final one is today.
 * history: array of booleans. markToday(el) lands today's square when the day's goal is met.
 */
export function studyDays(el, history) {
  el.className = 'days'; el.style.setProperty('--n', history.length);
  el.textContent = '';
  history.forEach((on, i) => {
    const s = document.createElement('i');
    if (on) s.classList.add('on');
    if (i === history.length - 1) s.classList.add('today');
    el.append(s);
  });
  let run = 0; for (let i = history.length - 1; i >= 0 && history[i]; i--) run++;
  if (!history[history.length - 1]) { run = 0; for (let i = history.length - 2; i >= 0 && history[i]; i--) run++; }
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `Studied ${history.filter(Boolean).length} of the last ${history.length} days`);
  return run;
}
export function markToday(el) {
  const s = el.lastElementChild; if (!s || s.classList.contains('on')) return;
  s.classList.add('on'); if (!reduced()) { s.classList.add('land'); s.addEventListener('animationend', () => s.classList.remove('land'), { once: true }); }
}

/* ------------------------------------------------------------------ */
/* Atmosphere (Paper Shaders mesh gradient)                             */
/* ------------------------------------------------------------------ */

const PAPER = new URL('../vendor/paper-shaders/', import.meta.url).href;   // vendored 0.0.81, see VENDOR.md
let paper = null;

/**
 * A slow mesh gradient behind the Today hero only. The CSS gradient in .atmo is the
 * fallback and the reduced-transparency / forced-colors look. The shader is still
 * (speed 0) except during breathe(), so it costs nothing at rest.
 *   const atmo = await atmosphere(el);   // el = .atmo
 *   atmo.breathe();                      // after a finished round
 *   atmo.setColors(['#..', ...]);        // e.g. warmer as readiness rises
 */
export async function atmosphere(el, { colors } = {}) {
  const api = { breathe() {}, setColors() {}, destroy() {} };
  if (matchMedia('(forced-colors: active), (prefers-reduced-transparency: reduce)').matches) return api;
  try { if (!document.createElement('canvas').getContext('webgl2')) return api; } catch { return api; }
  await idle();
  try {
    paper ??= Object.assign({}, ...(await Promise.all([
      import(`${PAPER}shader-mount.js`),
      import(`${PAPER}get-shader-color-from-string.js`),
      import(`${PAPER}shader-sizing.js`),
      import(`${PAPER}shaders/mesh-gradient.js`),
    ])));
  } catch (err) { console.info('Atmosphere: Paper Shaders unavailable, keeping CSS gradient.', err); return api; }
  const P = paper;
  // The vendored parser takes only #hex, comma rgb() and hsl() strings and logs "Unsupported color format" for
  // anything else (an empty token read during a theme switch, a colour a browser serialises as color(srgb …), a
  // named colour). Colours are resolved to [r, g, b, a] here, so it only ever sees arrays.
  const pick = () => (colors || ['--atmo-1', '--atmo-2', '--atmo-3', '--atmo-4'].map(css)).map(toShaderColor);
  let m;
  try {
    const c = pick();
    m = new P.ShaderMount(el, P.meshGradientFragmentShader, {
      u_colors: c, u_colorsCount: c.length, u_distortion: 0.7, u_swirl: 0.25, u_grainMixer: 0, u_grainOverlay: 0,
      u_fit: P.ShaderFitOptions.cover, u_scale: 1, u_rotation: 0, u_offsetX: 0, u_offsetY: 0,
      u_originX: 0.5, u_originY: 0.5, u_worldWidth: 0, u_worldHeight: 0,
    }, { antialias: false, powerPreference: 'low-power' }, 0, 6400, 1, 900 * 900);
  } catch (err) { console.info('Atmosphere mount failed', err); return api; }
  requestAnimationFrame(() => el.classList.add('is-live'));
  let live = true;
  // iOS drops WebGL contexts under memory pressure: fall back to the CSS gradient underneath instead of a blank canvas
  el.querySelector('canvas')?.addEventListener('webglcontextlost', e => { e.preventDefault(); api.destroy(); }, { once: true });
  // After destroy() the mount is disposed: a late theme change must not reach it (the vendored mount would warn
  // "Uniform location for u_colors not found"), so both listeners go and recolor checks `live`.
  const recolor = () => { if (live && !colors) { const c = pick(); m.setUniforms({ u_colors: c, u_colorsCount: c.length }); } };
  const later = () => setTimeout(recolor);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', later);
  const mo = new MutationObserver(later); mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  let ramp = 0;
  api.breathe = (peak = 0.9, holdMs = 1600) => {
    if (reduced()) return;
    cancelAnimationFrame(ramp);
    const t0 = performance.now(), up = 350, down = 1400, total = up + holdMs + down;
    const tick = now => {
      const k = now - t0; let s;
      if (k < up) s = peak * (k / up); else if (k < up + holdMs) s = peak;
      else if (k < total) { const q = (k - up - holdMs) / down; s = peak * (1 - q) * (1 - q); }
      else { m.setSpeed(0); return; }
      m.setSpeed(s); ramp = requestAnimationFrame(tick);
    };
    ramp = requestAnimationFrame(tick);
  };
  api.setColors = list => { if (!live) return; colors = list; const c = list.map(toShaderColor); m.setUniforms({ u_colors: c, u_colorsCount: c.length }); };
  api.destroy = () => { if (!live) return; live = false; cancelAnimationFrame(ramp); scheme.removeEventListener('change', later); mo.disconnect(); try { m.dispose(); } catch {} el.classList.remove('is-live'); };
  return api;
}
/* The atmosphere's fallback colours when a token cannot be read: the light and dark --atmo-1..4 values. */
const ATMO_FALLBACK = { light: ['#f4f4f1', '#e4e7f3', '#f1f1ec', '#dfe3f1'], dark: ['#0d0e11', '#141a33', '#0b0c0f', '#1b2244'] };
let probe = null;
/**
 * Any CSS colour → [r, g, b, a] in 0..1 for the shader. #hex is read directly; anything else is painted on a
 * 1×1 canvas and read back, so the result never depends on how a browser serialises colours. '' (a token that
 * is not there) becomes the theme's fallback for that slot.
 */
function toShaderColor(value, i = 0) {
  let v = String(value || '').trim();
  if (!v) v = ATMO_FALLBACK[root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'][i % 4];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    let x = hex[1];
    if (x.length <= 4) x = [...x].map(ch => ch + ch).join('');
    if (x.length === 6) x += 'ff';
    return [0, 2, 4, 6].map(k => parseInt(x.slice(k, k + 2), 16) / 255);
  }
  try {
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000'; probe.fillStyle = v;   // an invalid colour leaves the black in place
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  } catch { return [0.5, 0.5, 0.5, 1]; }
}

const idle = () => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1200 }) : setTimeout(r, 150)));

export { STATE, haptic };
