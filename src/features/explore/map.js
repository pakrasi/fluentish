/* Explore: the map renderer. One Canvas 2D, drawn only while something moves (a gesture, a camera flight, a mode
   change, the daily reveal, a word just learned); at rest nothing runs.

   Semantic zoom (DESIGN.md, Explore): far out every word is a bar of its exact width; between 6.5 and 9.5 px the bars
   crossfade into type; from 9.5 px it is type, culled to the screen and drawn state by state (one font and one colour
   per batch). Below 9.5 px each group is drawn from a bitmap cached per zoom tier (half-octave steps), one layer of
   bars and one of type, so the crossfade band costs a few drawImage calls instead of a thousand small text draws (the
   prototype's 47 fps dip on a throttled CPU). Bitmaps are rebuilt when knowledge, the gaps filter or the theme change,
   at most a few milliseconds of building per frame, inside a pixel budget.

   Encodings come from domain/atlas.js encode(): known ink, shaky ink-3, not known in an open box, not seen pale
   italic, practised today in the accent with a hairline under it. Text is set in the vendored map font, whose widths
   the layout was built with. */
import { FS, LH, ART, STATE_ORDER } from '../../domain/atlas.js';

const FONT = '"Fluentish Map"';
const KMAX = 4;
const TEXT_FROM = 6.5, TEXT_TO = 9.5;     // drawn font size (px) of the bars-to-type crossfade
const BITMAP_BUDGET = 24e6;               // device pixels kept in group bitmaps
const BUILD_MS = 6;                       // bitmap building per frame
const STATE_KEY = ['unseen', 'unknown', 'shaky', 'known'];

/** FNV-1a, 0..1. @param {string} s @param {number} salt */
function hash(s, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const clamp01 = (/** @type {number} */ x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** A damped spring's position at time s (seconds), from 0 to 1. Same parameters as the motion tokens. @param {number} k @param {number} c */
function spring(k, c) {
  const w0 = Math.sqrt(k), z = c / (2 * w0), wd = w0 * Math.sqrt(1 - z * z);
  return (/** @type {number} */ s) => (s <= 0 ? 0 : 1 - Math.exp(-z * w0 * s) * (Math.cos(wd * s) + (z * w0 / wd) * Math.sin(wd * s)));
}
const springSoft = spring(170, 20), springPop = spring(380, 18);
const easeInOut = (/** @type {number} */ t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * @typedef {object} Layout
 * @property {string} mode
 * @property {any[]} groups   {key, label, x, y, r, items}
 * @property {Float32Array} X
 * @property {Float32Array} Y
 * @property {Int32Array} G
 * @property {Int32Array} P
 * @property {{x0: number, y0: number, x1: number, y1: number}} bounds
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{A: any, reduced: () => boolean, labelOf: (g: any) => string, countOf: (gi: number) => {n: number, known: number, shaky: number, unknown: number, unseen: number},
 *   insets: () => {top: number, bottom: number}, onWord: (i: number) => void, onGroup: (gi: number, far: boolean) => void, onEmpty: () => void, onHere: (gi: number) => void}} o
 */
export function createMap(canvas, o) {
  const A = o.A, n = A.n;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { alpha: false }));
  const jitter = new Float32Array(n);
  for (let i = 0; i < n; i++) jitter[i] = hash(A.ids[i], 9);
  const PX = new Float32Array(n), PY = new Float32Array(n), PA = new Float32Array(n);
  const st = new Uint8Array(n), today = new Uint8Array(n);
  /** @type {Layout} */ let L = /** @type {any} */ (null);
  let cam = { x: 0, y: 0, k: 0.2 };
  let W = 0, H = 0, DPR = 1;
  let selected = -1, selGroup = -1, gaps = false;
  /** @type {any} */ let morph = null;
  /** @type {any} */ let flight = null;
  /** @type {any} */ let inertia = null;
  let introT0 = 0;
  /** @type {{i: number, t0: number}[]} */ let glow = [];
  /** @type {Record<string, string>} */ let C = {};
  let version = 0;                 // bumps when what bitmaps show changes
  let raf = 0, alive = true;
  /** @type {number[]} */ let frames = [], drawMs = [];
  let lastT = 0, bench = false;

  /* ---------- colours ---------- */
  function readColors() {
    const forced = matchMedia('(forced-colors: active)').matches;
    const cs = getComputedStyle(canvas);
    const v = (/** @type {string} */ k) => cs.getPropertyValue(`--${k}`).trim();
    C = { canvas: v('canvas'), surface: v('surface'), ink: v('ink'), 'ink-2': v('ink-2'), 'ink-3': v('ink-3'), hairline: v('hairline'), 'hairline-strong': v('hairline-strong'),
      accent: v('accent'), 'x-known': v('x-known'), 'x-shaky': v('x-shaky'), 'x-unknown': v('x-unknown'), 'x-box': v('x-box'), 'x-new': v('x-new'), 'x-bar-new': v('x-bar-new'), 'x-today': v('x-today'), 'x-glow': v('x-glow') };
    if (forced) Object.assign(C, { canvas: 'Canvas', surface: 'Canvas', ink: 'CanvasText', 'ink-2': 'CanvasText', 'ink-3': 'GrayText', 'x-known': 'CanvasText', 'x-shaky': 'GrayText', 'x-unknown': 'CanvasText',
      'x-box': 'CanvasText', 'x-new': 'GrayText', 'x-bar-new': 'GrayText', 'x-today': 'Highlight', accent: 'Highlight', 'x-glow': 'Highlight', hairline: 'GrayText', 'hairline-strong': 'GrayText' });
    version++; labelCache.clear(); kick();
  }

  /* ---------- size and camera ---------- */
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height; DPR = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    kick();
  }
  const fitView = (/** @type {Layout} */ l = L) => {
    const b = l.bounds, ins = o.insets();
    const k = Math.min(W / (b.x1 - b.x0 + 60), (H - ins.top - ins.bottom) / (b.y1 - b.y0 + 60));
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 - (ins.top - ins.bottom) / 2 / k, k };
  };
  const kmin = () => fitView().k * 0.6;
  /** van Wijk and Nuij smooth zoom: on a long hop, zoom out a little so the way is visible. @param {{x: number, y: number, k: number}} to @param {{ms?: number}} [opt] */
  function flyTo(to, { ms } = {}) {
    to = { ...to, k: Math.max(Math.min(to.k, KMAX), 0.01) };
    if (o.reduced()) { cam = { ...to }; flight = null; kick(); return; }
    const rho = Math.SQRT2, w0 = W / cam.k, w1 = W / to.k;
    const x0 = cam.x, y0 = cam.y, dx = to.x - x0, dy = to.y - y0, d2 = dx * dx + dy * dy, d1 = Math.sqrt(d2);
    let S, at;
    if (d1 < 1e-3) { S = Math.log(w1 / w0) / rho; at = (/** @type {number} */ s) => ({ x: x0, y: y0, k: W / (w0 * Math.exp(rho * s)) }); }
    else {
      const b0 = (w1 * w1 - w0 * w0 + rho ** 4 * d2) / (2 * w0 * rho * rho * d1), b1 = (w1 * w1 - w0 * w0 - rho ** 4 * d2) / (2 * w1 * rho * rho * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (r1 - r0) / rho;
      at = (/** @type {number} */ s) => { const u = (w0 / (rho * rho * d1)) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0)); return { x: x0 + u * dx, y: y0 + u * dy, k: W / ((w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0)) }; };
    }
    if (!Number.isFinite(S) || Math.abs(S) < 1e-4) { cam = { ...to }; kick(); return; }
    flight = { t0: performance.now(), dur: ms || Math.max(380, Math.min(1100, Math.abs(S) * 520)), at, S, to };
    kick();
  }

  /* ---------- the loop ---------- */
  function kick() { if (!raf && alive) raf = requestAnimationFrame(frame); }
  /** @param {number} t */
  function frame(t) {
    raf = 0;
    if (!alive) return;
    if (lastT) { frames.push(t - lastT); if (frames.length > 600) frames.shift(); }
    lastT = t;
    let busy = false;
    if (flight) {
      const p = Math.min(1, (t - flight.t0) / flight.dur);
      cam = p >= 1 ? { ...flight.to } : flight.at(easeInOut(p) * flight.S);
      if (p >= 1) flight = null; else busy = true;
    }
    if (inertia) {
      inertia.vx *= 0.92; inertia.vy *= 0.92; cam.x -= inertia.vx / cam.k; cam.y -= inertia.vy / cam.k;
      if (Math.abs(inertia.vx) + Math.abs(inertia.vy) < 0.3) inertia = null; else busy = true;
    }
    if (morph) { if (t - morph.t0 > morph.end) { morph = null; } busy = true; }
    if (introT0) { if (t - introT0 > 1500) introT0 = 0; busy = true; }
    if (glow.length) { glow = glow.filter(g => t - g.t0 < 1400); busy = busy || glow.length > 0; }
    const d0 = performance.now();
    const pending = draw(t);
    drawMs.push(performance.now() - d0); if (drawMs.length > 600) drawMs.shift();
    here();
    if (busy || pending || bench) raf = requestAnimationFrame(frame); else lastT = 0;
  }

  /* ---------- positions (with a mode change, the reveal) ---------- */
  /** @param {number} t */
  function place(t) {
    const m = morph;
    if (!m) {
      for (let i = 0; i < n; i++) { PX[i] = L.X[i]; PY[i] = L.Y[i]; PA[i] = Number.isNaN(L.X[i]) ? 0 : 1; }
    } else if (m.fade) {
      const p = clamp01((t - m.t0) / m.dur);
      for (let i = 0; i < n; i++) {
        if (p < 0.5) { PX[i] = m.from.X[i]; PY[i] = m.from.Y[i]; PA[i] = Number.isNaN(m.from.X[i]) ? 0 : 1 - p * 2; }
        else { PX[i] = m.to.X[i]; PY[i] = m.to.Y[i]; PA[i] = Number.isNaN(m.to.X[i]) ? 0 : (p - 0.5) * 2; }
      }
    } else {
      for (let i = 0; i < n; i++) {
        const a = !Number.isNaN(m.from.X[i]), b = !Number.isNaN(m.to.X[i]);
        const p = clamp01((t - m.t0 - m.delay[i]) / m.dur);
        if (a && b) { const e = springSoft(p * 0.62); PX[i] = m.from.X[i] + (m.to.X[i] - m.from.X[i]) * e; PY[i] = m.from.Y[i] + (m.to.Y[i] - m.from.Y[i]) * e; PA[i] = 1; }
        else if (a) { PX[i] = m.from.X[i]; PY[i] = m.from.Y[i]; PA[i] = Math.max(0, 1 - p * 2.2); }
        else if (b) { PX[i] = m.to.X[i]; PY[i] = m.to.Y[i]; PA[i] = clamp01(p * 1.6 - 0.2); }
        else PA[i] = 0;
      }
    }
    if (introT0) {
      const dt = t - introT0;
      for (let i = 0; i < n; i++) { if (!PA[i]) continue; const g = L.G[i]; const d = (introOrder[g] || 0) * 28 + jitter[i] * 220; PA[i] *= clamp01((dt - d) / 420); }
    }
  }
  /** @type {Int32Array} */ let introOrder = new Int32Array(0);

  /* ---------- drawing ---------- */
  const font = (/** @type {number} */ px, italic = false) => `${italic ? 'italic ' : ''}400 ${px}px ${FONT}`;
  const q2 = (/** @type {number} */ x) => Math.max(1, Math.round(x * 2) / 2);
  const dimOf = (/** @type {number} */ i) => (gaps && st[i] >= 2 ? 0.16 : 1);

  /** @param {number} t @returns {boolean} true when bitmaps are still being built */
  function draw(t) {
    if (!W || !L) return false;
    place(t);
    const k = cam.k, ox = W / 2 - cam.x * k, oy = H / 2 - cam.y * k;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1; ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
    const fpx = FS * k, tText = smooth(TEXT_FROM, TEXT_TO, fpx);
    const still = !morph && !introT0;
    let pending = false;
    // glow plates sit under the words
    if (glow.length) drawGlowPlates(t, k, ox, oy);
    if (still && fpx < TEXT_TO) pending = drawBitmaps(k, ox, oy, tText);
    else drawVector(k, ox, oy, tText, null);
    if (glow.length && tText > 0) drawGlowWords(t, k, ox, oy, tText);
    if (selected >= 0 && PA[selected] > 0) {
      const x = PX[selected] * k + ox, y = PY[selected] * k + oy;
      ctx.globalAlpha = 1; ctx.fillStyle = C.accent;
      ctx.fillRect(x, y + Math.max(2, fpx * 0.2), A.W[selected] * k, Math.max(2, fpx * 0.09));
    }
    drawGroups(t, k, ox, oy, tText);
    ctx.globalAlpha = 1;
    return pending;
  }

  /** Items whose box meets the view. @param {number} k @param {number} ox @param {number} oy @param {Set<number> | null} only */
  function visible(k, ox, oy, only) {
    const vx0 = -ox / k - 20, vx1 = (W - ox) / k + 20, vy0 = -oy / k - LH, vy1 = (H - oy) / k + LH;
    /** @type {number[]} */ const vis = [];
    for (let i = 0; i < n; i++) {
      if (PA[i] <= 0.01) continue;
      if (only && !only.has(L.G[i])) continue;
      const x = PX[i], y = PY[i];
      if (y < vy0 || y > vy1 || x > vx1 || x + A.W[i] < vx0) continue;
      vis.push(i);
    }
    return vis;
  }

  /**
   * The words themselves, item by item (while things move, and at type zoom).
   * @param {number} k @param {number} ox @param {number} oy @param {number} tText @param {Set<number> | null} only groups to draw (null: all)
   */
  function drawVector(k, ox, oy, tText, only) {
    const vis = visible(k, ox, oy, only);
    drawItems(ctx, vis, k, ox, oy, tText, 1 - tText, true);
  }

  /**
   * Draw items (bars and/or type) into a 2D context. Shared by the screen and the bitmaps.
   * @param {CanvasRenderingContext2D} c @param {number[]} vis @param {number} k @param {number} ox @param {number} oy
   * @param {number} aText alpha of the type layer @param {number} aBars alpha of the bar layer @param {boolean} live use the animated alphas
   */
  function drawItems(c, vis, k, ox, oy, aText, aBars, live) {
    const fpx = FS * k;
    const alpha = (/** @type {number} */ i) => (live ? PA[i] : 1) * dimOf(i);
    const isGlow = live && glow.length ? new Set(glow.map(g => g.i)) : null;
    if (aBars > 0.01) {
      const bh = Math.max(1, LH * k * 0.42);
      for (let s = 0; s < 4; s++) {
        const key = STATE_KEY[s];
        if (key === 'unknown') { c.strokeStyle = C['x-box']; c.lineWidth = 1; } else c.fillStyle = key === 'known' ? C['x-known'] : key === 'shaky' ? C['x-shaky'] : C['x-bar-new'];
        for (const i of vis) {
          if (st[i] !== s || today[i]) continue;
          c.globalAlpha = alpha(i) * aBars;
          const x = PX[i] * k + ox, y = PY[i] * k + oy - fpx * 0.32 - bh / 2, w = Math.max(1, A.W[i] * k);
          if (key === 'unknown') c.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, bh - 1)); else c.fillRect(x, y, w, bh);
        }
      }
      c.fillStyle = C['x-today'];
      for (const i of vis) { if (!today[i]) continue; c.globalAlpha = alpha(i) * aBars; c.fillRect(PX[i] * k + ox, PY[i] * k + oy - fpx * 0.32 - bh / 2, Math.max(1, A.W[i] * k), bh); }
    }
    if (aText > 0.01) {
      const px = q2(fpx), pa = q2(fpx * ART);
      c.textBaseline = 'alphabetic';
      // articles first, all in ink-3 (pale for not seen)
      c.font = font(pa);
      for (const i of vis) {
        const a = A.art[i]; if (!a) continue;
        c.globalAlpha = alpha(i) * aText; c.fillStyle = st[i] === 0 && !today[i] ? C['x-new'] : C['ink-3'];
        c.fillText(a, PX[i] * k + ox, PY[i] * k + oy);
      }
      // the open box for not known
      c.strokeStyle = C['x-box']; c.lineWidth = 1;
      const pad = 3 * Math.min(1, k * 1.5), rr = Math.min(4, 3 * k);
      for (const i of vis) {
        if (st[i] !== 1 || today[i]) continue;
        c.globalAlpha = alpha(i) * aText;
        c.beginPath(); c.roundRect(PX[i] * k + ox - pad, PY[i] * k + oy - fpx * 0.86, A.W[i] * k + pad * 2, fpx * 1.2, rr); c.stroke();
      }
      for (const s of STATE_ORDER) {
        const code = s === 'unseen' ? 0 : s === 'unknown' ? 1 : s === 'shaky' ? 2 : 3;
        c.font = font(px, s === 'unseen');
        c.fillStyle = s === 'known' ? C['x-known'] : s === 'shaky' ? C['x-shaky'] : s === 'unknown' ? C['x-unknown'] : C['x-new'];
        for (const i of vis) {
          if (st[i] !== code || today[i] || (isGlow && isGlow.has(i))) continue;
          c.globalAlpha = alpha(i) * aText;
          c.fillText(A.text[i], (PX[i] + A.AW[i]) * k + ox, PY[i] * k + oy);
        }
      }
      // practised today: the accent, with a hairline under it (never the hue alone)
      c.font = font(px); c.fillStyle = C['x-today'];
      for (const i of vis) {
        if (!today[i] || (isGlow && isGlow.has(i))) continue;
        c.globalAlpha = alpha(i) * aText;
        const x = (PX[i] + A.AW[i]) * k + ox, y = PY[i] * k + oy;
        c.fillText(A.text[i], x, y);
        c.fillRect(x, y + Math.max(1.5, fpx * 0.16), (A.W[i] - A.AW[i]) * k, Math.max(1, fpx * 0.05));
      }
      // opposites: a hairline between the two words of a pair
      if (L.mode === 'opp') {
        c.strokeStyle = C['hairline-strong']; c.lineWidth = 1;
        for (const i of vis) {
          const j = L.P[i]; if (j < 0 || PX[i] > PX[j]) continue;
          c.globalAlpha = Math.min(alpha(i), live ? PA[j] : 1) * aText * (morph ? 0.3 : 1);
          const x0 = (PX[i] + A.W[i]) * k + ox + 5 * k, x1 = PX[j] * k + ox - 5 * k, y = PY[i] * k + oy - fpx * 0.32;
          if (x1 > x0) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
        }
      }
    }
    c.globalAlpha = 1;
  }

  /* ---------- group bitmaps ---------- */
  /** @type {Map<string, {cv: HTMLCanvasElement | OffscreenCanvas, x0: number, y0: number, kt: number, s: number, px: number, used: number, ver: number}>} */
  const bitmaps = new Map();
  let bitmapPx = 0, frameNo = 0;
  const BDPR = () => Math.min(DPR, 1.5);
  /** @param {number} k */
  const tierOf = k => Math.pow(2, Math.round(Math.log2(k) * 2) / 2);
  /**
   * @param {number} k @param {number} ox @param {number} oy @param {number} tText
   * @returns {boolean} true when some group still waits for its bitmap
   */
  function drawBitmaps(k, ox, oy, tText) {
    frameNo++;
    const kt = tierOf(k), t0 = performance.now();
    /** @type {Set<number>} */ const fallback = new Set();
    let pending = false;
    const layers = /** @type {('bars'|'text')[]} */ ([]);
    if (tText < 0.99) layers.push('bars');
    if (tText > 0.01) layers.push('text');
    L.groups.forEach((g, gi) => {
      const cx = g.x * k + ox, cy = g.y * k + oy, r = g.r * k;
      if (cx + r < 0 || cx - r > W || cy + r < 0 || cy - r > H) return;
      for (const layer of layers) {
        const key = `${L.mode}|${gi}|${kt}|${layer}`;
        let b = bitmaps.get(key);
        if (b && b.ver !== version) { bitmapPx -= b.px; bitmaps.delete(key); b = undefined; }
        if (!b) {
          if (performance.now() - t0 > BUILD_MS) { fallback.add(gi); pending = true; continue; }
          b = buildBitmap(g, gi, kt, layer);
          bitmaps.set(key, b); bitmapPx += b.px;
        }
        b.used = frameNo;
        const f = k / kt;
        ctx.globalAlpha = layer === 'bars' ? 1 - tText : tText;
        ctx.drawImage(/** @type {any} */ (b.cv), ox + b.x0 * k, oy + b.y0 * k, (b.cv.width / b.s) * f, (b.cv.height / b.s) * f);
      }
    });
    ctx.globalAlpha = 1;
    if (fallback.size) drawVector(k, ox, oy, tText, fallback);
    evict();
    return pending;
  }
  /** @param {any} g @param {number} gi @param {number} kt @param {'bars'|'text'} layer */
  function buildBitmap(g, gi, kt, layer) {
    const s = BDPR() * kt;        // device pixels per world unit
    const pad = 24;
    const x0 = g.x - g.r - pad, y0 = g.y - g.r - pad, size = Math.ceil((2 * g.r + 2 * pad) * s);
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    c.setTransform(BDPR(), 0, 0, BDPR(), 0, 0);
    const items = g.items.filter((/** @type {number} */ i) => i != null);
    const saved = { px: PX, py: PY };
    // positions at rest are the layout's
    for (const i of items) { PX[i] = L.X[i]; PY[i] = L.Y[i]; }
    drawItems(c, items, kt, -x0 * kt, -y0 * kt, layer === 'text' ? 1 : 0, layer === 'bars' ? 1 : 0, false);
    void saved; void gi;
    return { cv, x0, y0, kt, s: BDPR(), px: size * size, used: frameNo, ver: version };
  }
  function evict() {
    if (bitmapPx <= BITMAP_BUDGET) return;
    const old = [...bitmaps.entries()].filter(([, b]) => b.used !== frameNo).sort((a, b) => a[1].used - b[1].used);
    for (const [key, b] of old) { if (bitmapPx <= BITMAP_BUDGET * 0.8) break; bitmaps.delete(key); bitmapPx -= b.px; }
  }

  /* ---------- a word just learned: cobalt, settling ---------- */
  /** @param {number} t @param {number} k @param {number} ox @param {number} oy */
  function drawGlowPlates(t, k, ox, oy) {
    ctx.fillStyle = C['x-glow'];
    for (const g of glow) {
      const p = (t - g.t0) / 1000; if (p < 0 || PA[g.i] <= 0) continue;
      const a = Math.max(0, 1 - p / 1.3) ** 2;
      // in screen pixels at least a 14 px plate, so a word learned today shows at overview too
      const x = PX[g.i] * k + ox, w = A.W[g.i] * k, fpx = FS * k, cy = PY[g.i] * k + oy - fpx * 0.32;
      const grow = 1 + 0.7 * (1 - springPop(p));
      const pad = Math.max(6, 7 * k) * grow, hh = Math.max(14, fpx * 1.35) * grow;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.roundRect(x - pad, cy - hh / 2 - pad * 0.3, w + pad * 2, hh + pad * 0.6, Math.min(12, hh / 2 + pad * 0.3)); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  /** @param {number} t @param {number} k @param {number} ox @param {number} oy @param {number} tText */
  function drawGlowWords(t, k, ox, oy, tText) {
    const fpx = FS * k;
    ctx.fillStyle = C['x-today']; ctx.textBaseline = 'alphabetic';
    for (const g of glow) {
      const p = (t - g.t0) / 1000; if (PA[g.i] <= 0) continue;
      const sc = p < 0 ? 1 : 1 + 0.16 * (1 - springPop(p));
      const x = PX[g.i] * k + ox, y = PY[g.i] * k + oy, w = A.W[g.i] * k;
      ctx.save(); ctx.translate(x + w / 2, y - fpx * 0.3); ctx.scale(sc, sc); ctx.translate(-(x + w / 2), -(y - fpx * 0.3));
      ctx.globalAlpha = PA[g.i] * tText;
      ctx.font = font(q2(fpx));
      ctx.fillText(A.text[g.i], (PX[g.i] + A.AW[g.i]) * k + ox, y);
      ctx.fillRect((PX[g.i] + A.AW[g.i]) * k + ox, y + Math.max(1.5, fpx * 0.16), (A.W[g.i] - A.AW[g.i]) * k, Math.max(1, fpx * 0.05));
      ctx.restore();
    }
  }

  /* ---------- rings and names ---------- */
  /** @type {Map<string, {lines: string[], tw: number, f1: number}>} */ const labelCache = new Map();
  /** @param {string} text @param {number} f1 @param {number} maxw */
  function wrapLabel(text, f1, maxw) {
    const key = `${f1}|${Math.round(maxw / 8)}|${text}`;
    let v = labelCache.get(key);
    if (!v) {
      ctx.font = `600 ${f1}px Geist, system-ui, sans-serif`;
      /** @type {string[]} */ const lines = []; let cur = '';
      for (const w of text.split(' ')) { const nx = cur ? `${cur} ${w}` : w; if (cur && ctx.measureText(nx).width > maxw) { lines.push(cur); cur = w; } else cur = nx; }
      lines.push(cur);
      v = { lines: lines.slice(0, 3), tw: Math.max(...lines.slice(0, 3).map(l => ctx.measureText(l).width)), f1 };
      labelCache.set(key, v);
    }
    return v;
  }
  /** @param {number} t @param {number} k @param {number} ox @param {number} oy @param {number} tText */
  function drawGroups(t, k, ox, oy, tText) {
    let a = 1;
    if (morph) a = clamp01(((t - morph.t0) / morph.end - 0.55) / 0.45);
    if (introT0) a *= clamp01((t - introT0 - 300) / 600);
    if (!a) return;
    /** @type {number[][]} */ const placed = [];
    const order = L.groups.map((g, i) => i).sort((p, q) => L.groups[q].r - L.groups[p].r);
    for (const gi of order) {
      const g = L.groups[gi], cx = g.x * k + ox, cy = g.y * k + oy, r = g.r * k + 6;
      if (cx + r < -40 || cx - r > W + 40 || cy + r < -60 || cy - r > H + 40) continue;
      const dim = selGroup >= 0 && selGroup !== gi ? 0.35 : 1;
      const cnt = o.countOf(gi);
      const segs = /** @type {[number, string][]} */ ([[cnt.known, C['x-known']], [cnt.shaky, C['x-shaky']], [cnt.unknown, C['x-box']], [cnt.unseen, C['hairline-strong']]]);
      const lw = r > 120 ? 3 : 2, gap = Math.min(0.05, 2.5 / r);
      let ang = -Math.PI / 2;
      ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.globalAlpha = a * dim;
      for (const [v, col] of segs) {
        if (!v || !cnt.n) continue;
        const sweep = (v / cnt.n) * Math.PI * 2;
        ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, r, ang + gap / 2, ang + Math.max(gap / 2 + 0.002, sweep - gap / 2)); ctx.stroke();
        ang += sweep;
      }
      if (gi === selGroup) { ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r + lw + 3, 0, Math.PI * 2); ctx.stroke(); }
      // the name sits in its disc while the words are bars; the "where you are" pill takes over at type zoom
      const la = 1 - tText; if (la <= 0.02) continue;
      const label = o.labelOf(g), single = !label.includes(' ');
      if (r < (single ? 14 : 24)) continue;
      const f1 = r > 110 ? 16 : r > 45 ? 13 : 12;
      const lab = wrapLabel(label, f1, Math.max(60, r * 1.6));
      const sub = r >= 30 ? `${cnt.known} / ${cnt.n}` : '';
      const lh = f1 + 3, bw = Math.max(lab.tw, sub ? sub.length * 6.6 : 0), bh = lab.lines.length * lh + (sub ? 16 : 2);
      const bx = cx - bw / 2, by = cy - bh / 2;
      if (placed.some(l => bx < l[2] && bx + bw > l[0] && by < l[3] && by + bh > l[1])) continue;
      placed.push([bx - 2, by - 1, bx + bw + 2, by + bh + 1]);
      ctx.globalAlpha = a * dim * la * 0.78; ctx.fillStyle = C.canvas;
      ctx.beginPath(); ctx.roundRect(bx - 8, by - 5, bw + 16, bh + 10, 8); ctx.fill();
      ctx.globalAlpha = a * dim * la; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = C.ink; ctx.font = `600 ${f1}px Geist, system-ui, sans-serif`;
      lab.lines.forEach((l, j) => ctx.fillText(l, cx, by + f1 + j * lh - 1));
      if (sub) { ctx.fillStyle = C['ink-3']; ctx.font = '400 12px Geist, system-ui, sans-serif'; ctx.fillText(sub, cx, by + bh - 2); }
      ctx.textAlign = 'start';
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- where you are ---------- */
  let hereGi = -2;
  function here() {
    let gi = -1;
    if (FS * cam.k >= 9 && L) {
      let bd = Infinity;
      L.groups.forEach((g, i) => { const d = Math.hypot(g.x - cam.x, g.y - cam.y) - g.r; if (d < bd) { bd = d; gi = i; } });
      if (bd > 200 / cam.k) gi = -1;
    }
    if (gi !== hereGi) { hereGi = gi; o.onHere(gi); }
  }

  /* ---------- hit testing ---------- */
  /** @type {Map<number, number[]> | null} */ let grid = null;
  const CELL = 96, gkey = (/** @type {number} */ gx, /** @type {number} */ gy) => gx * 100003 + gy;
  function buildGrid() {
    grid = new Map();
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(L.X[i])) continue;
      const gy = Math.floor(L.Y[i] / CELL);
      for (let gx = Math.floor(L.X[i] / CELL); gx <= Math.floor((L.X[i] + A.W[i]) / CELL); gx++) { const key = gkey(gx, gy); let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(i); }
    }
  }
  /** @param {number} x @param {number} y @param {number} slop */
  function hit(x, y, slop) {
    if (!grid) buildGrid();
    let best = -1, bd = Infinity;
    for (let gy = Math.floor((y - LH) / CELL); gy <= Math.floor((y + LH) / CELL); gy++) {
      for (let gx = Math.floor((x - 60) / CELL); gx <= Math.floor((x + 60) / CELL); gx++) {
        for (const i of /** @type {Map<number, number[]>} */ (grid).get(gkey(gx, gy)) || []) {
          const dx = x < L.X[i] ? L.X[i] - x : x > L.X[i] + A.W[i] ? x - L.X[i] - A.W[i] : 0;
          const dy = Math.abs(y - (L.Y[i] - FS * 0.32));
          if (dx <= slop && dy <= LH / 2 + slop) { const d = dx + dy; if (d < bd) { bd = d; best = i; } }
        }
      }
    }
    return best;
  }

  /* ---------- input: pan, pinch, wheel, tap, double tap, keys ---------- */
  /** @type {Map<number, {x: number, y: number}>} */ const pts = new Map();
  /** @type {any} */ let gesture = null;
  /** @type {number[][]} */ let vel = [];
  let lastTap = 0;
  const toWorld = (/** @type {number} */ sx, /** @type {number} */ sy) => ({ x: (sx - W / 2) / cam.k + cam.x, y: (sy - H / 2) / cam.k + cam.y });
  /** @param {number} sx @param {number} sy @param {number} f */
  function zoomAt(sx, sy, f) {
    const k1 = Math.max(kmin(), Math.min(KMAX, cam.k * f)), w = toWorld(sx, sy);
    cam.k = k1; cam.x = w.x - (sx - W / 2) / k1; cam.y = w.y - (sy - H / 2) / k1;
  }
  const pos = (/** @type {PointerEvent} */ e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  /** @param {PointerEvent} e */
  function down(e) {
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e); pts.set(e.pointerId, p);
    flight = null; inertia = null; vel = [];
    if (pts.size === 1) gesture = { kind: 'pan', t: performance.now(), moved: 0 };
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: 99 }; }
  }
  /** @param {PointerEvent} e */
  function move(e) {
    if (!pts.has(e.pointerId) || !gesture) return;
    const prev = /** @type {{x: number, y: number}} */ (pts.get(e.pointerId)), cur = pos(e);
    pts.set(e.pointerId, cur);
    if (gesture.kind === 'pan' && pts.size === 1) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y; gesture.moved += Math.abs(dx) + Math.abs(dy);
      cam.x -= dx / cam.k; cam.y -= dy / cam.k; vel.push([performance.now(), dx, dy]); if (vel.length > 6) vel.shift();
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (gesture.kind !== 'pinch') gesture = { kind: 'pinch', d, mx, my, moved: 99 };
      cam.x -= (mx - gesture.mx) / cam.k; cam.y -= (my - gesture.my) / cam.k;
      zoomAt(mx, my, d / gesture.d); gesture.d = d; gesture.mx = mx; gesture.my = my;
    }
    kick();
  }
  /** @param {PointerEvent} e */
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    const p = pos(e); pts.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pan' && pts.size === 0) {
      if (gesture.moved < 8 && performance.now() - gesture.t < 400) tap(p.x, p.y);
      else if (!o.reduced() && vel.length > 2 && performance.now() - vel[vel.length - 1][0] < 60) {
        const span = vel[vel.length - 1][0] - vel[0][0] || 16; let vx = 0, vy = 0; for (const v of vel) { vx += v[1]; vy += v[2]; }
        inertia = { vx: (vx / span) * 16, vy: (vy / span) * 16 }; kick();
      }
      gesture = null;
    } else if (pts.size === 0) gesture = null;
    else if (pts.size === 1) gesture = { kind: 'pan', t: 0, moved: 99 };
  }
  /** @param {WheelEvent} e */
  function wheel(e) {
    e.preventDefault(); flight = null;
    const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    // pinch on a trackpad and the mouse wheel zoom; a two-finger trackpad swipe pans
    const mouse = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || mouse) zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022) * (e.deltaMode === 1 ? 16 : 1)));
    else { cam.x += e.deltaX / cam.k; cam.y += e.deltaY / cam.k; }
    kick();
  }
  /** @param {number} sx @param {number} sy */
  function tap(sx, sy) {
    const now = performance.now(), w = toWorld(sx, sy);
    if (now - lastTap < 300) { lastTap = 0; flyTo({ x: w.x, y: w.y, k: Math.min(KMAX, cam.k * 2.2) }); return; }
    lastTap = now;
    if (FS * cam.k >= 8) { const i = hit(w.x, w.y, 8 / cam.k + 2); if (i >= 0) { o.onWord(i); return; } }
    const gi = L.groups.findIndex(g => Math.hypot(g.x - w.x, g.y - w.y) < g.r + 10 / cam.k);
    if (gi >= 0) { o.onGroup(gi, FS * cam.k < 8); return; }
    o.onEmpty();
  }
  /** @param {KeyboardEvent} e */
  function key(e) {
    const step = 80 / cam.k;
    if (e.key === 'ArrowLeft') cam.x -= step; else if (e.key === 'ArrowRight') cam.x += step;
    else if (e.key === 'ArrowUp') cam.y -= step; else if (e.key === 'ArrowDown') cam.y += step;
    else if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.4); else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.4);
    else return;
    e.preventDefault(); kick();
  }
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', key);
  const ro = new ResizeObserver(() => { const had = W; resize(); if (!had && L) cam = fitView(); });
  ro.observe(canvas);
  const mq = matchMedia('(prefers-color-scheme: dark)'), fq = matchMedia('(forced-colors: active)');
  const recolor = () => requestAnimationFrame(readColors);
  mq.addEventListener('change', recolor); fq.addEventListener('change', recolor);
  const mo = new MutationObserver(recolor);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  readColors();
  resize();

  /* ---------- the API ---------- */
  return {
    /** Show a layout. animate: flow every word to its new place. @param {Layout} next @param {{animate?: boolean, follow?: number}} [opt] */
    setLayout(next, { animate = false, follow = -1 } = {}) {
      const from = L;
      L = next; grid = null; selGroup = -1;
      introOrder = groupOrder(next);
      if (!from || !animate) { if (!from) cam = fitView(); kick(); return; }
      const rm = o.reduced();
      const delay = new Float32Array(n), nG = Math.max(1, next.groups.length - 1);
      // groups assemble one after another, nearest the middle first: delay = order x 200 ms (scaled to the number of groups) + jitter
      for (let i = 0; i < n; i++) { const g = next.G[i] >= 0 ? next.G[i] : from.G[i]; delay[i] = (Math.min(1, (introOrder[g] || 0) / nG) * 200 + jitter[i] * 90); }
      const dur = rm ? 140 : 620;
      morph = { from, to: next, t0: performance.now(), dur, delay, fade: rm, end: rm ? dur : dur + 290 + 120 };
      if (follow >= 0 && !Number.isNaN(next.X[follow])) flyTo({ x: next.X[follow] + A.W[follow] / 2, y: next.Y[follow], k: cam.k }, { ms: 700 });
      else flyTo(fitView(next), { ms: 700 });
      kick();
    },
    /** New scores: state codes and today flags; glow: item indices that were just learned. @param {Uint8Array} s @param {Uint8Array} td @param {number[]} [newly] */
    setScores(s, td, newly = []) {
      st.set(s); today.set(td); version++;
      if (newly.length && !o.reduced()) {
        const t0 = performance.now() + (introT0 ? 1200 : 150);
        glow = newly.slice(0, 40).map((i, j) => ({ i, t0: t0 + j * 60 }));
      }
      kick();
    },
    /** @param {boolean} on */
    setGaps(on) { gaps = on; version++; kick(); },
    /** @param {number} i */
    select(i) { selected = i; selGroup = -1; kick(); },
    /** @param {number} gi */
    selectGroup(gi) { selGroup = gi; selected = -1; kick(); },
    clear() { selected = -1; selGroup = -1; kick(); },
    /** The daily reveal: the map inks in, group by group. */
    intro() { if (!o.reduced()) { introT0 = performance.now(); kick(); } },
    flyTo,
    fit() { flyTo(fitView(), { ms: 600 }); },
    /** @param {number} f */
    zoomBy(f) { flyTo({ ...cam, k: Math.max(kmin(), Math.min(KMAX, cam.k * f)) }, { ms: 380 }); },
    /**
     * Fly to an item, leaving it in the free part of the screen (above a sheet of height `below`).
     * @param {number} i @param {{k?: number, below?: number}} [opt]
     */
    flyToItem(i, { k, below = 0, right = 0 } = {}) {
      const kk = Math.max(k || cam.k, 1.05);
      const ins = o.insets(), free = H - below - ins.top;
      const sy = ins.top + free * 0.42;
      flyTo({ x: L.X[i] + A.W[i] / 2 + right / 2 / kk, y: L.Y[i] - (sy - H / 2) / kk, k: kk });
    },
    /** @param {number} gi @param {{below?: number, right?: number}} [opt] */
    flyToGroup(gi, { below = 0, right = 0 } = {}) {
      const g = L.groups[gi], ins = o.insets(), free = H - below - ins.top - (below ? 0 : ins.bottom);
      const kk = Math.min(KMAX, Math.min((W - right) / (2 * g.r + 60), free / (2 * g.r + 60)));
      flyTo({ x: g.x + right / 2 / kk, y: g.y - (ins.top + free / 2 - H / 2) / kk, k: Math.max(kk, cam.k * (FS * cam.k >= 8 ? 1 : 0)) });
    },
    /** Is item i drawn in this layout? @param {number} i */
    has(i) { return !!L && !Number.isNaN(L.X[i]); },
    get layout() { return L; },
    get camera() { return { ...cam }; },
    /** @param {{x: number, y: number, k: number}} c */
    set camera(c) { cam = { ...c }; kick(); },
    redraw() { version++; kick(); },
    /** Bitmap cache size, for the performance report. */
    debug() { return { bitmaps: bitmaps.size, megapixels: +(bitmapPx / 1e6).toFixed(1) }; },
    resize,
    /** Scripted pans, zooms and mode-free motion, for the performance report. */
    async bench() {
      bench = true;
      /** @type {Record<string, any>} */ const out = {};
      const stat = (/** @type {number[]} */ a, /** @type {number} */ q) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2); };
      /** @param {string} name @param {number} ms @param {(p: number) => void} step */
      const run = async (name, ms, step) => {
        await new Promise(r => setTimeout(r, 120));
        frames = []; drawMs = []; lastT = 0;
        const t0 = performance.now();
        await new Promise(res => { (function f() { const p = (performance.now() - t0) / ms; step(Math.min(1, p)); kick(); if (p < 1) requestAnimationFrame(f); else res(null); })(); });
        const fr = frames.slice(2);
        out[name] = { fps: +(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)).toFixed(1), frameP95: stat(fr, 0.95), drawP50: stat(drawMs, 0.5), drawP95: stat(drawMs, 0.95), frames: fr.length };
      };
      const home = fitView();
      cam = { ...home };
      await run('pan_far', 2000, p => { cam.x = home.x + Math.sin(p * 6.283) * 600; });
      await run('zoom_far_to_type', 2500, p => { cam.k = home.k * Math.pow(1.2 / home.k, p); });
      await run('pan_type', 2000, p => { cam.x = home.x + Math.sin(p * 6.283) * 300; });
      cam = { ...home, k: (TEXT_FROM + 1.5) / FS };
      await run('pan_crossfade_band', 2000, p => { cam.x = home.x + Math.sin(p * 6.283) * 500; cam.k = ((TEXT_FROM + 1.5 + Math.sin(p * 12.566) * 1.4) / FS); });
      cam = { ...home };
      bench = false;
      return out;
    },
    /** Frame statistics since the last call (for mode switches). */
    stats() {
      const fr = frames.slice(2), s = [...drawMs].sort((a, b) => a - b);
      const r = fr.length ? { fps: +(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)).toFixed(1), frameP95: +[...fr].sort((a, b) => a - b)[Math.floor(fr.length * 0.95)].toFixed(1), drawP95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2), frames: fr.length } : null;
      frames = []; drawMs = []; return r;
    },
    destroy() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect();
      mq.removeEventListener('change', recolor); fq.removeEventListener('change', recolor);
      bitmaps.clear();
    },
  };
}

/** The order groups ink in and assemble: nearest the middle of the map first. @param {Layout} l */
function groupOrder(l) {
  const b = l.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const order = l.groups.map((g, i) => ({ i, d: Math.hypot(g.x - cx, g.y - cy) })).sort((a, b2) => a.d - b2.d);
  const out = new Int32Array(l.groups.length);
  order.forEach((x, rank) => { out[x.i] = rank; });
  return out;
}
