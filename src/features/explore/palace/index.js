/* Explore › 3D, the "Type city" (DESIGN.md, Explore › 3D). Loaded only when the 3D segment opens (import()).

   The Atlas floor plan, raised: every word is a building whose footprint is the word itself, at the place the 2D map
   puts it (the same layout object, domain/atlas.js positions()), and its height is how long he will remember it
   (domain/palace.js floorsOf). Hand-written WebGL2 (gl.js), nine instanced draws at most, everything animated on the
   GPU from one time uniform and one item-state texture. The loop runs only while something moves; at rest, no frames.

   createPalace(canvas, o) → api. The view (explore/index.js) owns the sheets, the List and the copy; this module draws,
   moves the camera and reports taps, exactly like the 2D map (map.js), so both share one set of callbacks. */
import { FS, ART } from '../../../domain/atlas.js';
import {
  PLINTH, FLOOR, DEPTH_UP, DEPTH_DN, NONE, TEX_W, TAP_MIN_PX, texSize, texOffset, packItems, writePlace, riseDelays, packGlyphs, floorsOf, exagOf, createResolution,
} from '../../../domain/palace.js';
import { matrices, ground, frame, project, PLAN_PITCH } from './camera.js';
import { createGL, boxGeometry, cylinderGeometry } from './gl.js';
import * as SH from './shaders.js';

/** The 3D pose: 42° pitch, turned −24°; a word is read from 56°, a district from 45°. On a portrait stage the
    overview looks down at 52°, so the round map, limited by the stage's width, also uses its height. */
export const POSE = { pitch: 0.74, yaw: -0.42, word: 0.98, group: 0.78, portrait: 0.9 };
const RISE_S = 1.7;                  // Map → 3D
const NM = 720, NR = 12, NT = 12;    // pools: motes, rings, study tiles
const easeInOut = (/** @type {number} */ t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (/** @type {number} */ x, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, x));

/* ---------------------------------------------------------------- the text atlas (vendored, src/vendor/palace-sdf) */
/** @type {Promise<{meta: any, img: HTMLImageElement, metrics: any}> | null} */ let sdf = null;
/** The SDF atlas and the map font's metrics (fetched once a session, cached by the service worker with the code). */
export function loadSdf() {
  if (!sdf) {
    const url = (/** @type {string} */ p) => new URL(`../../../vendor/${p}`, import.meta.url).href;
    const img = new Image();
    img.decoding = 'async';
    img.src = url('palace-sdf/atlas.png');
    sdf = Promise.all([fetch(url('palace-sdf/atlas.json')).then(r => { if (!r.ok) throw new Error(`atlas.json ${r.status}`); return r.json(); }),
      img.decode().then(() => img), fetch(url('newsreader-map/metrics.json')).then(r => r.json())]).then(([meta, im, metrics]) => ({ meta, img: im, metrics }));
    sdf.catch(() => { sdf = null; });
  }
  return sdf;
}

/** True when this browser can draw the 3D map (WebGL2 with float textures in the vertex stage). */
export function supported() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    const ok = !!gl && gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) >= 2;
    /** @type {any} */ (gl)?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch { return false; }
}

/**
 * @typedef {{x: number, z: number, ty: number, d: number, yaw: number, pitch: number}} Rig
 * @param {HTMLCanvasElement} canvas
 * @param {{A: any, layout: any, st: Uint8Array, today: Uint8Array, S: Float32Array, reduced: () => boolean, labels: HTMLElement,
 *   labelOf: (g: any) => string, countText: (gi: number) => string, countOf: (gi: number) => {n: number, known: number, shaky: number, unknown: number, unseen: number},
 *   insets: () => {top: number, bottom: number}, onWord: (i: number) => void, onGroup: (gi: number) => void, onEmpty: () => void,
 *   onHere: (gi: number) => void, onKbGroup?: (gi: number) => void, onLost: () => void, onRestored?: () => void}} o
 */
export async function createPalace(canvas, o) {
  const { meta, img, metrics } = await loadSdf();
  const A = o.A, n = A.n;
  let L = o.layout;
  const st = new Uint8Array(o.st), today = new Uint8Array(o.today), S = new Float32Array(o.S);
  const ctxOpts = { antialias: true, alpha: false, depth: true, powerPreference: /** @type {const} */ ('low-power'), preserveDrawingBuffer: false };
  const gl0 = canvas.getContext('webgl2', ctxOpts);
  if (!gl0) throw Object.assign(new Error('WebGL2 is not available'), { code: 'nowebgl2' });
  const gl = /** @type {WebGL2RenderingContext} */ (gl0);

  /* ---------- state */
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  /** @type {Rig} */ const s = { x: 0, z: 0, ty: PLINTH, d: 2000, yaw: 0, pitch: PLAN_PITCH };
  let W = 0, H = 0;
  const res = createResolution(devicePixelRatio);
  let ratio = res.ratio, alive = true, lost = false;
  let rise = 0;                                   // 0 plan, 1 raised
  let tiltNo = 0;                                 // the latest Map ↔ 3D change (an older one stops moving)
  let sel = -1, selG = -1, focus = -1, focusK = 0;
  const lens = [0, 0, 0, 0];
  const pulses = new Float32Array(32).fill(0); for (let k = 0; k < 8; k++) pulses[k * 4 + 2] = NONE;
  let pulseK = 0;
  /** @type {Set<{cam: boolean, step: (t: number) => void, cancel: () => void}>} */ const tweens = new Set();
  let busyUntil = 0, raf = 0, lastFrame = 0, wasMoving = false;
  let C = readColors();

  /* ---------- the item texture and its CPU mirror */
  const ts = texSize(n);
  let data = packItems(A, L, st, today, S);
  /** @type {Set<number>} */ const dirty = new Set();
  const touch = (/** @type {number} */ i) => dirty.add(Math.floor((i * 4) / TEX_W));
  // floors drawn now (target of any animation), for picking and the camera
  const floorsNow = (/** @type {number} */ i) => data[texOffset(i, 1) + 1];

  /* ---------- glyph table */
  /** @type {Map<string, number>} */ const gIndex = new Map();
  const gl32 = [];
  for (const style of ['r', 'i']) for (const [ch, v] of Object.entries(meta.glyphs[style])) {
    const [x, y, w, h, l, b, r, tp] = /** @type {number[]} */ (v);
    gIndex.set(style + ch, gIndex.size);
    gl32.push(l, b, r, tp, x / meta.width, y / meta.height, (x + w) / meta.width, (y + h) / meta.height);
  }
  const glyphIndex = (/** @type {string} */ ch, /** @type {boolean} */ it) => gIndex.get((it ? 'i' : 'r') + ch) ?? (it ? gIndex.get(`r${ch}`) ?? -1 : -1);
  const glyphRows = Math.ceil((gl32.length / 4) / 256);
  const glyphData = new Float32Array(256 * glyphRows * 4); glyphData.set(gl32);
  const glyphs = packGlyphs(A, metrics, glyphIndex, ART);

  /* ---------- GPU resources (built again after a lost context) */
  /** @type {any} */ let R = null;
  function build() {
    const G = createGL(gl);
    const P = {
      plinth: G.program(SH.PLINTH_VS, SH.PLINTH_FS), block: G.program(SH.BLOCK_VS, SH.BLOCK_FS), shadow: G.program(SH.SHADOW_VS, SH.SHADOW_FS),
      text: G.program(SH.TEXT_VS, SH.TEXT_FS), mote: G.program(SH.MOTE_VS, SH.MOTE_FS), ring: G.program(SH.RING_VS, SH.RING_FS), tile: G.program(SH.TILE_VS, SH.TILE_FS),
    };
    const itemsTex = G.texture('f32', ts.w, ts.h, data);
    const glyphTex = G.texture('f32', 256, glyphRows, glyphData);
    const sdfTex = G.texture('r8', meta.width, meta.height, img);
    const box = G.buffer(boxGeometry()), cyl = G.buffer(cylinderGeometry(128));
    const quad = G.buffer(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1]));     // xz unit square (2 triangles)
    const quadXY = G.buffer(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]));                     // xy unit square
    const quadC = G.buffer(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]));  // centred, xz
    const quadT = G.buffer(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]));  // centred, xy
    const idx = new Uint16Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    const items = G.buffer(idx);
    const glyphBuf = G.buffer(glyphs.buffer);
    const plinthBuf = G.buffer(new Float32Array(Math.max(1, L.groups.length) * 8), gl.DYNAMIC_DRAW);
    const motes = { p: new Float32Array(NM * 4).fill(0), v: new Float32Array(NM * 4) };
    for (let i = 0; i < NM; i++) motes.p[i * 4 + 3] = NONE;
    const moteP = G.buffer(motes.p, gl.DYNAMIC_DRAW), moteV = G.buffer(motes.v, gl.DYNAMIC_DRAW);
    const ringP = G.buffer(new Float32Array(NR * 8).map((_, k) => (k % 8 === 3 ? NONE : 0)), gl.DYNAMIC_DRAW);
    const tileP = G.buffer(new Float32Array(NT * 8).map((_, k) => (k % 8 === 3 ? NONE : 0)), gl.DYNAMIC_DRAW);
    const F = gl.FLOAT, US = gl.UNSIGNED_SHORT, SS = gl.SHORT;
    const V = {
      plinth: G.vao(P.plinth, [{ name: 'aPos', buf: cyl, size: 3, stride: 24 }, { name: 'aNor', buf: cyl, size: 3, stride: 24, offset: 12 },
        { name: 'aG', buf: plinthBuf, size: 4, stride: 32, divisor: 1 }, { name: 'aF', buf: plinthBuf, size: 4, stride: 32, offset: 16, divisor: 1 }]),
      block: G.vao(P.block, [{ name: 'aPos', buf: box, size: 3, stride: 24 }, { name: 'aNor', buf: box, size: 3, stride: 24, offset: 12 }, { name: 'aI', buf: items, size: 1, type: US, divisor: 1 }]),
      shadow: G.vao(P.shadow, [{ name: 'aPos', buf: quad, size: 3 }, { name: 'aI', buf: items, size: 1, type: US, divisor: 1 }]),
      text: G.vao(P.text, [{ name: 'aPos', buf: quadXY, size: 2 }, { name: 'aU', buf: glyphBuf, size: 4, type: US, stride: 12, divisor: 1 }, { name: 'aS', buf: glyphBuf, size: 2, type: SS, stride: 12, offset: 8, divisor: 1 }]),
      mote: G.vao(P.mote, [{ name: 'aP', buf: moteP, size: 4 }, { name: 'aV', buf: moteV, size: 4 }]),
      ring: G.vao(P.ring, [{ name: 'aPos', buf: quadC, size: 3 }, { name: 'aP', buf: ringP, size: 4, stride: 32, divisor: 1 }, { name: 'aR', buf: ringP, size: 4, stride: 32, offset: 16, divisor: 1 }]),
      tile: G.vao(P.tile, [{ name: 'aPos', buf: quadT, size: 3 }, { name: 'aP', buf: tileP, size: 4, stride: 32, divisor: 1 }, { name: 'aT', buf: tileP, size: 4, stride: 32, offset: 16, divisor: 1 }]),
    };
    void F;
    const bytes = data.byteLength + glyphData.byteLength + meta.width * meta.height * 1.34 + boxGeometry().byteLength + cylinderGeometry(128).byteLength + idx.byteLength + glyphs.buffer.byteLength + NM * 32 + NR * 32 + NT * 32;
    R = { G, P, V, itemsTex, glyphTex, sdfTex, plinthBuf, moteP, moteV, motes, ringP, tileP, cylN: 128 * 9, bytes, rings: new Float32Array(NR * 8).map((_, k) => (k % 8 === 3 ? NONE : 0)), tiles: new Float32Array(NT * 8).map((_, k) => (k % 8 === 3 ? NONE : 0)) };
    writePlinths();
    dirty.clear();
  }
  build();

  /* ---------- colours from the app's tokens (any CSS colour, through a 1 px canvas) */
  function readColors() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
    const probe = document.createElement('i'); (canvas.parentElement || document.body).append(probe);
    /** @type {Record<string, number[]>} */ const out = {};
    for (const k of ['canvas', 'surface', 'surface-2', 'ink', 'ink-3', 'accent', 'x-known', 'x-shaky', 'x-unknown', 'x-box', 'x-new', 'x-bar-new', 'x-glow']) {
      probe.style.color = `var(--${k})`;
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = getComputedStyle(probe).color; cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data, a = d[3] / 255;
      out[k] = a > 0 ? [d[0] / 255 / a, d[1] / 255 / a, d[2] / 255 / a, a] : [0, 0, 0, 0];
    }
    probe.remove();
    const lum = (/** @type {number[]} */ c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return { ...out, dark: lum(out.canvas) < 0.35 };
  }

  /* ---------- plinths: one instance per group, with the shares known / shaky / not known for the ring */
  function writePlinths() {
    const arr = new Float32Array(Math.max(1, L.groups.length) * 8);
    L.groups.forEach((/** @type {any} */ g, /** @type {number} */ gi) => {
      const c = o.countOf(gi), t = Math.max(1, c.n);
      arr.set([g.x, g.y, g.r, gi, c.known / t, (c.known + c.shaky) / t, (c.known + c.shaky + c.unknown) / t, 1], gi * 8);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, R.plinthBuf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
  }

  /* ---------- size and the loop */
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    W = r.width; H = r.height;
    setRatio(ratio);
    labelsDirty = true;
    kick();
    return true;
  }
  /** @param {number} q */
  function setRatio(q) {
    ratio = q;
    const w = Math.round(W * q), h = Math.round(H * q);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function kick() { if (!raf && alive && !lost) raf = requestAnimationFrame(tick); }
  /** Keep drawing for sec seconds. @param {number} sec */
  const busy = sec => { busyUntil = Math.max(busyUntil, now() + sec); kick(); };
  /**
   * A tween on the one clock (seconds). Reduced motion or dur 0: the end state at once. A camera tween (cam) is dropped
   * by the next gesture or flight without finishing; any other tween jumps to its end when cancelled. Both resolve.
   * @param {number} dur @param {(e: number, u: number) => void} fn @param {(u: number) => number} [ez] @param {boolean} [cam]
   */
  function tween(dur, fn, ez = easeInOut, cam = false) {
    return new Promise(res => {
      if (dur <= 0) { fn(1, 1); kick(); res(null); return; }
      const ta = now();
      const tw = { cam, step: (/** @type {number} */ t) => { const u = Math.min(1, (t - ta) / dur); fn(ez(u), u); if (u >= 1) { tweens.delete(tw); res(null); } },
        cancel: () => { tweens.delete(tw); if (!cam) fn(1, 1); res(null); } };
      tweens.add(tw); kick();
    });
  }
  /** Stop camera motion (flights, inertia); other tweens finish. */
  function stopCamera() { for (const tw of [...tweens]) if (tw.cam) tw.cancel(); vel = { x: 0, z: 0 }; }
  let interrupted = false;

  /** @type {number[]} */ let frames = [], cpu = [];
  let benchFrame = /** @type {null | ((t: number) => void)} */ (null);
  /** @param {number} ts */
  function tick(ts) {
    raf = 0;
    if (!alive || lost || !W) return;
    const interval = lastFrame ? ts - lastFrame : 0; lastFrame = ts;
    const t = now();
    for (const tw of [...tweens]) tw.step(t);
    inertiaStep(Math.min(0.05, interval / 1000 || 0.016));
    benchFrame?.(ts);
    const moving = tweens.size > 0 || t < busyUntil || inertiaOn() || pointers.size > 0 || !!benchFrame;
    // resolution: step down while moving if frames run long; one sharp frame when motion stops
    const want = moving ? res.moving(interval) : res.still();
    if (want !== ratio) setRatio(want);
    const c0 = performance.now();
    draw(t);
    updateLabels();
    here();
    cpu.push(performance.now() - c0); if (cpu.length > 600) cpu.shift();
    if (interval) { frames.push(interval); if (frames.length > 600) frames.shift(); }
    if (moving) { wasMoving = true; kick(); }
    else if (wasMoving) { wasMoving = false; if (ratio !== res.still()) { setRatio(res.still()); } kick(); lastFrame = 0; }
    else lastFrame = 0;
  }

  /* ---------- drawing */
  function upload() {
    if (!dirty.size) return;
    const rows = [...dirty].sort((a, b) => a - b); dirty.clear();
    for (let k = 0; k < rows.length;) {
      let j = k; while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
      R.G.updateRows(R.itemsTex, TEX_W, rows[k], rows[j] - rows[k] + 1, data);
      k = j + 1;
    }
  }
  /** @param {number} t */
  function draw(t) {
    upload();
    const M = matrices(s, W, H);
    lastM = M;
    const exag = exagOf(s.d);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(C.canvas[0], C.canvas[1], C.canvas[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.itemsTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.glyphTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.sdfTex);
    const L3 = [-0.62, 0.72, 0.42], ln = Math.hypot(...L3), Ld = L3.map(v => v / ln);
    const fog = [s.d * 1.1, s.d * 3.6];
    const dark = C.dark;
    /** common uniforms @param {any} p */
    const common = p => p.use().i('uItems', 0).f('uTime', t).m4('uVP', M.vp).v3('uEye', M.eye).f('uPx', M.ppu).f('uRise', rise).f('uExag', exag)
      .v4('uPulse', pulses).v4('uLens', lens).v2('uFog', fog).v3('uCanvas', C.canvas.slice(0, 3)).f('uFocus', focus).f('uFocusK', focusK).v3('uL', Ld);
    const ng = L.groups.length;
    // plinths
    gl.disable(gl.BLEND); gl.depthMask(true);
    common(R.P.plinth).v3('uTop', C.surface.slice(0, 3)).v3('uSide', dark ? [0.1, 0.105, 0.12] : [0.86, 0.865, 0.855]).v3('uInk', C['x-known'].slice(0, 3))
      .v3('uInk3', C['x-shaky'].slice(0, 3)).v3('uBox', mixC(C['x-box'], C.surface)).v3('uAcc', C.accent.slice(0, 3)).f('uSelG', selG);
    gl.bindVertexArray(R.V.plinth); gl.drawArraysInstanced(gl.TRIANGLES, 0, R.cylN, ng);
    // blocks
    common(R.P.block).v3('uRoof', (dark ? C['surface-2'] : C.surface).slice(0, 3)).v3('uPl', C.surface.slice(0, 3))
      .v3('uLit', dark ? [0.16, 0.17, 0.19] : [0.93, 0.93, 0.915]).v3('uDark', dark ? [0.075, 0.08, 0.095] : [0.70, 0.71, 0.71])
      .v3('uInk', C['x-known'].slice(0, 3)).v3('uInk3', C['x-shaky'].slice(0, 3)).v3('uBox', C['x-box'].slice(0, 3)).f('uBoxA', C['x-box'][3])
      .v3('uNew', C['x-bar-new'].slice(0, 3)).f('uNewA', C['x-bar-new'][3]).v3('uAcc', C.accent.slice(0, 3)).v3('uGlow', C['x-glow'].slice(0, 3)).f('uSel', sel).f('uNight', dark ? 1 : 0);
    gl.bindVertexArray(R.V.block); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, n);
    // shadows, rings: blended, no depth writes (premultiplied)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    if (rise > 0.01) {
      common(R.P.shadow).v3('uShadow', dark ? [0, 0, 0] : [0.12, 0.13, 0.17]).f('uStr', dark ? 0.6 : 0.3);
      gl.bindVertexArray(R.V.shadow); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    }
    if (ringsLive(t)) { R.P.ring.use().m4('uVP', M.vp).f('uTime', t).v3('uAcc', C.accent.slice(0, 3)); gl.bindVertexArray(R.V.ring); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, NR); }
    // type
    common(R.P.text).i('uGlyphs', 1).i('uSdf', 2).f('uSel', sel).f('uArt', ART)
      .v3('uInk', [...C['x-new'].slice(0, 3), ...C['x-unknown'].slice(0, 3), ...C['x-shaky'].slice(0, 3), ...C['x-known'].slice(0, 3), ...C.accent.slice(0, 3), 0, 0, 0]);
    gl.bindVertexArray(R.V.text); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, glyphs.count);
    // the sparkle and the study tiles
    if (motesUntil > t) { R.P.mote.use().m4('uVP', M.vp).f('uTime', t).f('uPx', M.ppu).v3('uEye', M.eye).f('uDpr', ratio).v3('uAcc', C.accent.slice(0, 3)).v3('uInkC', C['x-known'].slice(0, 3)); gl.bindVertexArray(R.V.mote); gl.drawArrays(gl.POINTS, 0, NM); }
    if (tilesOn) { gl.disable(gl.DEPTH_TEST); R.P.tile.use().m4('uVP', M.vp).f('uTime', t).v2('uRes', [W, H]).v3('uAcc', C.accent.slice(0, 3)).v3('uSurf', C.surface.slice(0, 3)); gl.bindVertexArray(R.V.tile); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, NT); gl.enable(gl.DEPTH_TEST); }
    gl.bindVertexArray(null); gl.depthMask(true);
  }
  /** A translucent token flattened over a background. @param {number[]} c @param {number[]} bg */
  const mixC = (c, bg) => [0, 1, 2].map(k => c[k] * c[3] + bg[k] * (1 - c[3]));
  /** @type {ReturnType<typeof matrices> | null} */ let lastM = null;
  const M = () => lastM || matrices(s, W || 1, H || 1);
  let motesUntil = 0, ringsUntil = 0, tilesOn = false;
  const ringsLive = (/** @type {number} */ t) => t < ringsUntil;

  /* ---------- labels: district names in the DOM, constant size, larger groups win, never half off screen */
  let labelsDirty = true;
  /** @type {{el: HTMLElement, w: number, h: number, on: boolean}[]} */ let labels = [];
  function buildLabels() {
    o.labels.replaceChildren();
    labels = L.groups.map((/** @type {any} */ g, /** @type {number} */ gi) => {
      const el = document.createElement('div'); el.className = 'pl-label';
      const b = document.createElement('b'); b.textContent = o.labelOf(g);
      const sp = document.createElement('span'); sp.textContent = o.countText(gi);
      el.append(b, sp); o.labels.append(el);
      return { el, w: 0, h: 0, on: false };
    });
    requestAnimationFrame(() => { for (const l of labels) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; } labelsDirty = true; kick(); });
  }
  const order = () => L.groups.map((/** @type {any} */ _, /** @type {number} */ i) => i).sort((/** @type {number} */ a, /** @type {number} */ b) => L.groups[b].items.length - L.groups[a].items.length);
  let labelOrder = order();
  function updateLabels() {
    if (!labels.length) return;
    const m = M(), placed = /** @type {number[][]} */ ([]);
    const ins = o.insets();
    for (const gi of labelOrder) {
      const g = L.groups[gi], l = labels[gi];
      let show = focus < 0 && l.w > 0;
      let x = 0, y = 0;
      if (show) {
        const p = project(m.vp, g.x, PLINTH + 40 * rise, g.y, W, H);
        const dist = Math.hypot(m.eye[0] - g.x, m.eye[1] - PLINTH, m.eye[2] - g.y);
        const rpx = (g.r * m.ppu) / Math.max(1, dist);
        const inside = Math.hypot(s.x - g.x, s.z - g.y) < g.r && s.d < g.r * 3.2;
        x = p.x; y = p.y;
        if (!(p.w > 0) || inside || rpx < 22) show = false;
        else {
          const r = [x - l.w / 2, y - l.h / 2, x + l.w / 2, y + l.h / 2];
          if (r[0] < 4 || r[2] > W - 4 || r[1] < ins.top + 2 || r[3] > H - ins.bottom - 2 || placed.some(q => r[0] < q[2] + 6 && r[2] > q[0] - 6 && r[1] < q[3] + 2 && r[3] > q[1] - 2)) show = false;
          else placed.push(r);
        }
      }
      if (show) l.el.style.transform = `translate3d(${Math.round(x - l.w / 2)}px, ${Math.round(y - l.h / 2)}px, 0)`;
      if (show !== l.on) { l.on = show; l.el.classList.toggle('is-on', show); }
    }
    labelsDirty = false;
  }

  /* ---------- where you are */
  let hereGi = -2;
  function here() {
    let gi = -1;
    for (let k = 0; k < L.groups.length; k++) { const g = L.groups[k]; if (Math.hypot(s.x - g.x, s.z - g.y) < g.r * 0.9 && s.d < g.r * 3.2) { gi = k; break; } }
    if (gi !== hereGi) { hereGi = gi; o.onHere(gi); }
  }

  /* ---------- camera */
  /** Points that outline the whole map (each disc's rim, at plinth and roof height). @param {number} [only] a group */
  function mapPoints(only = -1) {
    const out = [];
    const gs = only >= 0 ? [L.groups[only]] : L.groups;
    for (const g of gs) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; out.push([g.x + Math.sin(a) * g.r, 0, g.y + Math.cos(a) * g.r], [g.x + Math.sin(a) * g.r * 0.7, PLINTH + 30, g.y + Math.cos(a) * g.r * 0.7]); }
    return out;
  }
  /** The whole map in the free stage, at a pitch. @param {number} pitch @param {number} yaw */
  const overview = (/** @type {number} */ pitch, /** @type {number} */ yaw) => frame(mapPoints(), { pitch, yaw, ty: PLINTH }, W, H, { top: o.insets().top + 4, bottom: o.insets().bottom + 4, left: 8, right: 8 }, { fill: 0.96 });
  const dMax = () => overview(PLAN_PITCH, 0).d * 1.8;
  /** The overview's pitch for this stage. */
  const overPitch = () => (W < H ? POSE.portrait : POSE.pitch);
  const LIM = { dMin: 90, pMin: 0.42, pMax: PLAN_PITCH };
  const clampS = () => { s.d = clamp(s.d, LIM.dMin, dMax()); s.pitch = clamp(s.pitch, rise > 0.5 ? LIM.pMin : PLAN_PITCH - 0.6, LIM.pMax); };
  /**
   * Fly the camera: log-distance zoom, cubic in-out, rising on long hops so the way is seen; 0.55 to 1.5 s by
   * distance. Reduced motion: a jump. @param {Partial<Rig>} to @param {{ms?: number}} [opt]
   */
  function flyTo(to, { ms } = {}) {
    const from = { ...s }, dest = { ...from, ...to };
    let dy = dest.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); dest.yaw = from.yaw + dy;
    const dist = Math.hypot(dest.x - from.x, dest.z - from.z);
    const dur = o.reduced() ? 0 : ms ?? Math.min(1.5, Math.max(0.55, 0.45 + dist / 3000 + Math.abs(Math.log(dest.d / from.d)) * 0.18));
    const bump = Math.max(0, dist * 0.55 - Math.max(from.d, dest.d) * 0.25);
    stopCamera();
    return tween(dur, (e, u) => {
      s.x = from.x + (dest.x - from.x) * e; s.z = from.z + (dest.z - from.z) * e; s.ty = from.ty + (dest.ty - from.ty) * e;
      s.d = Math.exp(Math.log(from.d) + (Math.log(dest.d) - Math.log(from.d)) * e) + bump * Math.sin(Math.PI * u);
      s.yaw = from.yaw + (dest.yaw - from.yaw) * e; s.pitch = from.pitch + (dest.pitch - from.pitch) * e;
    }, easeInOut, true);
  }
  /** Distance at which the base font is px pixels. @param {number} px */
  const dForType = px => (FS * M().ppu) / px;
  /** An item's roof height now (CPU mirror of the shader, without the bob). @param {number} i @param {number} [d] */
  const roof = (i, d = s.d) => PLINTH + floorsNow(i) * FLOOR * rise * exagOf(d);
  /** @param {number} i */
  const box = i => { const x = L.X[i], z = L.Y[i], w = A.W[i]; return [[x, roof(i), z - DEPTH_UP], [x + w, roof(i), z - DEPTH_UP], [x, roof(i), z + DEPTH_DN], [x + w, roof(i), z + DEPTH_DN]]; };
  const isPhone = () => W < 720;

  /* ---------- the street opening: buildings between the eye and the word sink */
  let lensHold = 0;
  /** @param {number} i @param {number} [hold] seconds, then it closes by itself */
  function setLens(i, hold = 0) {
    clearTimeout(lensHold);
    const on = i >= 0, z0 = lens[2];
    if (on) { lens[0] = L.X[i] + A.W[i] / 2; lens[1] = L.Y[i] - (DEPTH_UP - DEPTH_DN) / 2; }
    if (o.reduced()) { lens[2] = on ? 1 : 0; kick(); }
    else tween(on ? 0.45 : 0.35, e => { lens[2] = z0 + ((on ? 1 : 0) - z0) * e; });
    if (on && hold) lensHold = window.setTimeout(() => { if (sel < 0) setLens(-1); }, hold * 1000);
  }

  /* ---------- gestures: one finger pans (the ground stays under it), two pinch, twist and tilt; right drag orbits */
  /** @type {Map<number, {x: number, y: number, b: number}>} */ const pointers = new Map();
  let vel = { x: 0, z: 0 }, lastMove = 0, moved = 0, downAt = { x: 0, y: 0, t: 0 }, lastTap = 0;
  /** @type {null | 'tilt' | 'pinch'} */ let gest = null;
  const inertiaOn = () => Math.hypot(vel.x, vel.z) > 2 && pointers.size === 0;
  /** @param {number} dt */
  function inertiaStep(dt) { if (!inertiaOn()) return; s.x += vel.x * dt; s.z += vel.z * dt; const k = Math.exp(-dt * 4.2); vel.x *= k; vel.z *= k; }
  const local = (/** @type {PointerEvent | MouseEvent} */ e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onGround = (/** @type {number} */ x, /** @type {number} */ y) => ground(s, x, y, W, H, s.ty);
  /** @param {PointerEvent} e */
  function down(e) {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e); pointers.set(e.pointerId, { ...p, b: e.button });
    moved = 0; downAt = { ...p, t: performance.now() }; gest = null;
    stopCamera(); interrupted = true; kbGroup = -1;
  }
  /** @param {PointerEvent} e */
  function move(e) {
    const p = pointers.get(e.pointerId); if (!p) return;
    const c = local(e), pts = [...pointers.values()];
    if (pts.length === 1) {
      const dx = c.x - p.x, dy = c.y - p.y; moved += Math.abs(dx) + Math.abs(dy);
      if (p.b === 2 || e.shiftKey || e.altKey) { s.yaw -= dx * 0.006; s.pitch += dy * 0.004; clampS(); }
      else {
        const a = onGround(p.x, p.y), b = onGround(c.x, c.y);
        if (a && b) {
          const t = performance.now(), ddt = Math.max(1, t - lastMove) / 1000; lastMove = t;
          s.x += a.x - b.x; s.z += a.z - b.z;
          vel = o.reduced() ? { x: 0, z: 0 } : { x: ((a.x - b.x) / ddt) * 0.7 + vel.x * 0.3, z: ((a.z - b.z) / ddt) * 0.7 + vel.z * 0.3 };
        }
      }
    } else if (pts.length === 2) {
      const q = /** @type {{x: number, y: number}} */ (pts.find(x => x !== p));
      const before = { cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, d: Math.hypot(p.x - q.x, p.y - q.y), a: Math.atan2(p.y - q.y, p.x - q.x) };
      const after = { cx: (c.x + q.x) / 2, cy: (c.y + q.y) / 2, d: Math.hypot(c.x - q.x, c.y - q.y), a: Math.atan2(c.y - q.y, c.x - q.x) };
      moved += 10;
      const dyc = after.cy - before.cy, dd = after.d - before.d;
      if (!gest) gest = Math.abs(dyc) > Math.abs(dd) * 1.2 && Math.abs(dyc) > 1.5 ? 'tilt' : 'pinch';
      if (gest === 'tilt') s.pitch += dyc * 0.006;
      else {
        const g0 = onGround(before.cx, before.cy);
        s.d *= before.d / Math.max(1, after.d);
        let da = after.a - before.a; da = Math.atan2(Math.sin(da), Math.cos(da)); if (rise > 0.5) s.yaw += da;
        clampS();
        const g1 = onGround(after.cx, after.cy);
        if (g0 && g1) { s.x += g0.x - g1.x; s.z += g0.z - g1.z; }
      }
      clampS();
    }
    p.x = c.x; p.y = c.y; kick();
  }
  /** @param {PointerEvent} e */
  function up(e) {
    const p = pointers.get(e.pointerId); pointers.delete(e.pointerId);
    if (!p) return;
    if (pointers.size === 0 && moved < 8 && performance.now() - downAt.t < 450) tap(p.x, p.y);
    if (performance.now() - lastMove > 80) vel = { x: 0, z: 0 };
    kick();
  }
  /** @param {WheelEvent} e */
  function wheel(e) {
    e.preventDefault(); stopCamera(); interrupted = true;
    const c = local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      const g0 = onGround(c.x, c.y);
      s.d *= Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0016) * (e.deltaMode === 1 ? 16 : 1)); clampS();
      const g1 = onGround(c.x, c.y);
      if (g0 && g1) { s.x += g0.x - g1.x; s.z += g0.z - g1.z; }
    } else if (rise > 0.5) s.yaw -= e.deltaX * 0.004;
    kick();
  }
  /** @param {number} x @param {number} y */
  function tap(x, y) {
    const tnow = performance.now();
    if (tnow - lastTap < 300) { lastTap = 0; const g = onGround(x, y); if (g) flyTo({ x: g.x, z: g.z, d: Math.max(LIM.dMin, s.d / 2.2) }, { ms: 0.5 }); return; }
    lastTap = tnow;
    const i = pickItem(x, y);
    if (i >= 0) { o.onWord(i); return; }
    const gi = pickGroup(x, y);
    if (gi >= 0) { o.onGroup(gi); return; }
    o.onEmpty();
  }
  /** The item under a screen point: each visible roof's centre projected, nearest within its own box + 6 px. @param {number} x @param {number} y */
  function pickItem(x, y) {
    const m = M(); let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(L.X[i])) continue;
      const cx = L.X[i] + A.W[i] / 2, cz = L.Y[i] - 5, cy = roof(i);
      const dist = Math.hypot(m.eye[0] - cx, m.eye[1] - cy, m.eye[2] - cz), k = m.ppu / Math.max(1, dist);
      if (FS * k < TAP_MIN_PX) continue;
      const p = project(m.vp, cx, cy, cz, W, H);
      if (!(p.w > 0)) continue;
      const hw = (A.W[i] * k) / 2 + 6, hh = 13 * k + 6, dx = Math.abs(p.x - x), dy = Math.abs(p.y - y);
      if (dx < hw && dy < hh) { const dd = dx / hw + dy / hh - cy * 1e-4; if (dd < bd) { bd = dd; best = i; } }
    }
    return best;
  }
  /** @param {number} x @param {number} y */
  function pickGroup(x, y) { const g = ground(s, x, y, W, H, PLINTH); if (!g) return -1; return L.groups.findIndex((/** @type {any} */ q) => Math.hypot(g.x - q.x, g.z - q.y) < q.r + 6); }

  /* ---------- keys: arrows pan, + and − zoom, Q/E turn, Page Up/Down tilt, Tab steps through the districts */
  let kbGroup = -1;
  const tabOrder = () => { const b = L.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; return L.groups.map((/** @type {any} */ g, /** @type {number} */ i) => [Math.hypot(g.x - cx, g.y - cy), i]).sort((/** @type {number[]} */ a, /** @type {number[]} */ b2) => a[0] - b2[0]).map((/** @type {number[]} */ x) => x[1]); };
  /** @param {KeyboardEvent} e */
  function key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = s.d * 0.12, cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), k = e.key;
    if (k === 'Tab') {
      const ord = tabOrder(), at = ord.indexOf(kbGroup), nx = at + (e.shiftKey ? -1 : 1);
      if ((e.shiftKey && at < 0) || nx < 0 || nx >= ord.length) { kbGroup = -1; selG = -1; kick(); return; }
      e.preventDefault(); kbGroup = ord[nx]; selG = kbGroup;
      api.flyToGroup(kbGroup); o.onKbGroup?.(kbGroup);
      return;
    }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); const gi = kbGroup >= 0 ? kbGroup : nearestGroup(); if (gi >= 0) o.onGroup(gi); return; }
    let used = true;
    if (k === 'ArrowLeft') { s.x -= cy * step; s.z += sy * step; } else if (k === 'ArrowRight') { s.x += cy * step; s.z -= sy * step; }
    else if (k === 'ArrowUp') { s.x -= sy * step; s.z -= cy * step; } else if (k === 'ArrowDown') { s.x += sy * step; s.z += cy * step; }
    else if (k === '+' || k === '=') s.d /= 1.3; else if (k === '-') s.d *= 1.3;
    else if (k === 'q' || k === 'Q' || k === '[') s.yaw += 0.15; else if (k === 'e' || k === 'E' || k === ']') s.yaw -= 0.15;
    else if (k === 'PageUp') s.pitch += 0.1; else if (k === 'PageDown') s.pitch -= 0.1;
    else used = false;
    if (used) { e.preventDefault(); clampS(); kick(); }
  }
  function nearestGroup() { let gi = -1, bd = Infinity; L.groups.forEach((/** @type {any} */ g, /** @type {number} */ i) => { const d = Math.hypot(g.x - s.x, g.y - s.z) - g.r; if (d < bd) { bd = d; gi = i; } }); return gi; }
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', key);
  const noMenu = (/** @type {Event} */ e) => e.preventDefault();
  canvas.addEventListener('contextmenu', noMenu);
  canvas.addEventListener('blur', () => { kbGroup = -1; });

  /* ---------- a lost context: the view falls back to the 2D map; on restore everything is built again */
  /** @param {Event} e */
  const onLost = e => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; o.onLost(); };
  const onRestored = () => { try { build(); lost = false; dirty.clear(); kick(); o.onRestored?.(); } catch (err) { console.error(err); } };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  /* ---------- colours follow the theme */
  const recolor = () => requestAnimationFrame(() => { C = readColors(); kick(); });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', recolor);
  const mo = new MutationObserver(recolor);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const ro = new ResizeObserver(() => { const had = W; if (resize() && !had) kick(); });
  ro.observe(canvas);
  resize();
  buildLabels();

  /* ---------- effects */
  /** A cobalt ring across the plinth. @param {number} x @param {number} z @param {number} r @param {number} dur @param {number} ta */
  function ring(x, z, r, dur, ta) {
    const k = (ringK++ % NR) * 8; R.rings.set([x, PLINTH + 0.2, z, ta, r, dur, 0, 0], k);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.ringP); gl.bufferData(gl.ARRAY_BUFFER, R.rings, gl.DYNAMIC_DRAW);
    ringsUntil = Math.max(ringsUntil, ta + dur);
  }
  let ringK = 0, moteK = 0;
  /** About 70 fine ink and cobalt motes rise from a building's base and fall (the learned moment only; DESIGN.md). @param {number} i @param {number} ta */
  function burst(i, ta) {
    const x = L.X[i], z = L.Y[i] - 4, w = A.W[i], N = 70;
    let seed = (i * 2654435761) >>> 0;
    const rnd = () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < N; j++) {
      const k = (moteK++ % NM) * 4, a = rnd() * Math.PI * 2, r = rnd();
      R.motes.p.set([x + (rnd() - 0.1) * w, PLINTH + 1 + rnd() * 6, z + (rnd() - 0.5) * 16, ta + rnd() * 0.12], k);
      R.motes.v.set([Math.cos(a) * (20 + 60 * r), 60 + 110 * rnd(), Math.sin(a) * (20 + 60 * r), 0.9 + rnd() * 0.9], k);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, R.moteP); gl.bufferData(gl.ARRAY_BUFFER, R.motes.p, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.moteV); gl.bufferData(gl.ARRAY_BUFFER, R.motes.v, gl.DYNAMIC_DRAW);
    motesUntil = Math.max(motesUntil, ta + 2);
  }
  /** Study tiles over the "Study next" words, dropping in 60 ms apart from ta. @param {number[]} idx @param {number} ta */
  function tiles(idx, ta) {
    for (let k = 0; k < NT; k++) {
      const i = idx[k];
      if (i == null || Number.isNaN(L.X[i])) R.tiles.set([0, 0, 0, NONE, 0, 0, 0, 0], k * 8);
      else R.tiles.set([L.X[i] + A.W[i] / 2, roof(i, s.d), L.Y[i] - 5, ta + k * 0.06, k + 1, 0, 0, 0], k * 8);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, R.tileP); gl.bufferData(gl.ARRAY_BUFFER, R.tiles, gl.DYNAMIC_DRAW);
    tilesOn = idx.length > 0; busy(1.4);
  }
  function hideTiles() {
    if (!tilesOn) return;
    const t = now(); for (let k = 0; k < NT; k++) if (R.tiles[k * 8 + 3] > -50 && R.tiles[k * 8 + 5] === 0) R.tiles[k * 8 + 5] = t;
    gl.bindBuffer(gl.ARRAY_BUFFER, R.tileP); gl.bufferData(gl.ARRAY_BUFFER, R.tiles, gl.DYNAMIC_DRAW);
    busy(0.3); setTimeout(() => { if (alive && focus < 0) tilesOn = false; }, 320);
  }

  /* ---------- writing item state */
  /** @param {number} i @param {number[]} a @param {number[]} b */
  function writeItem(i, a, b) { data.set(a, texOffset(i, 0)); data.set(b, texOffset(i, 1)); touch(i); }

  /**
   * The learned moment for one item at time ta (seconds on the palace clock): the scaffold turns cobalt, a ring runs out,
   * the building rises from its old floors to its new ones on spring-pop with a cobalt line riding up, the letters
   * lift off and settle on the new roof in cobalt, ~70 motes rise and fall, the neighbours bob once.
   * A word he marked known himself (select mode, Quick sort) gets the softer version: the rise, the cobalt and the
   * letters, without the ring and the motes, since no round earned it.
   * @param {number} i @param {number} from previous state code @param {number} ta @param {boolean} [soft]
   */
  function learn(i, from, ta, soft = false) {
    const f0 = floorsOf(from, 0), f1 = floorsOf(3, S[i]);
    writeItem(i, [from, 3, ta, today[i]], [f0, f1, ta + 0.08, ta]);
    const x = L.X[i] + A.W[i] / 2, z = L.Y[i] - 5;
    pulses.set([x, z, ta, 0], (pulseK++ % 8) * 4);
    if (!soft) { ring(x, z, 46 + A.W[i] * 0.4, 1.0, ta + 0.05); burst(i, ta + 0.08); }
    busy(ta - now() + 2.6);
  }

  /* ---------------------------------------------------------------- the API */
  const api = {
    /** @param {any} next a layout (explore/data.js layoutOf) */
    setLayout(next) {
      L = next;
      const del = riseDelays(A, L);
      for (let i = 0; i < n; i++) writePlace(data, A, L, i, del[i]);
      for (let r = 0; r < ts.h; r++) dirty.add(r);
      sel = -1; selG = -1; focus = -1; focusK = 0; tilesOn = false;
      labelOrder = order(); writePlinths(); buildLabels(); kick();
    },
    /**
     * New scores. hold: items whose learned moment is still to play keep their previous look until learn() runs.
     * @param {Uint8Array} st2 @param {Uint8Array} td @param {Float32Array} S2 @param {{hold?: Map<number, number>}} [opt] hold: item → previous state
     */
    setScores(st2, td, S2, { hold = new Map() } = {}) {
      st.set(st2); today.set(td); S.set(S2);
      for (let i = 0; i < n; i++) {
        const h0 = hold.get(i);
        const code = h0 ?? st[i], f = h0 != null ? floorsOf(h0, 0) : floorsOf(st[i], S[i]);
        const a = texOffset(i, 0), b = texOffset(i, 1);
        if (data[a + 1] === code && data[b + 1] === f && data[a + 3] === today[i]) continue;
        // an animation in flight towards this state keeps running
        if (data[a + 1] === code && now() - data[a + 2] < 0.6 && data[b + 1] === f) continue;
        writeItem(i, [code, code, NONE, today[i]], [f, f, NONE, NONE]);
      }
      writePlinths();
      labels.forEach((l, gi) => { const sp = l.el.lastElementChild; if (sp) sp.textContent = o.countText(gi); });
      kick();
    },
    /**
     * Play the learned moments for items, framing them first: the camera tours the words in stops it can show with the
     * type at least 22 px (26 on a desktop), 340 ms apart within a stop. Items the tour cannot reach settle at once.
     * Reduced motion: the final state at once. Resolves when the last moment has played.
     * @param {number[]} items in reading order @param {Map<number, number>} prev item → previous state
     * @param {Set<number>} [soft] items he marked known himself (no ring, no motes)
     */
    async playMoments(items, prev, soft = new Set()) {
      if (!items.length) return [];
      if (o.reduced() || rise < 0.99) { for (const i of items) writeItem(i, [3, 3, NONE, today[i]], [floorsOf(3, S[i]), floorsOf(3, S[i]), NONE, NONE]); kick(); return items; }
      const minPx = isPhone() ? 22 : 26, ins = o.insets();
      const stops = /** @type {number[][]} */ ([]);
      const fits = (/** @type {number[]} */ g) => {
        const f = frame(g.flatMap(box), { pitch: POSE.word, yaw: s.yaw, ty: PLINTH }, W, H, { top: ins.top + 40, bottom: ins.bottom + 40, left: 24, right: 24 }, { fill: 0.86 });
        return { f, ok: (FS * M().ppu) / f.d >= minPx };
      };
      for (const i of items) {
        const last = stops[stops.length - 1];
        if (last && fits([...last, i]).ok) last.push(i);
        else if (stops.length < 4) stops.push([i]);
        else break;
      }
      const shown = stops.flat();
      for (const i of items) if (!shown.includes(i)) writeItem(i, [3, 3, NONE, today[i]], [floorsOf(3, S[i]), floorsOf(3, S[i]), NONE, NONE]);
      interrupted = false;
      for (const g of stops) {
        if (!alive) break;
        if (!interrupted) {
          const { f } = fits(g);
          f.d = Math.max(f.d, dForType(isPhone() ? 34 : 40));
          await flyTo({ x: f.x, z: f.z, d: f.d, pitch: POSE.word, ty: PLINTH });
          if (!interrupted) await new Promise(r => setTimeout(r, 160));
        }
        if (g.length === 1 && sel < 0) setLens(g[0], 2.4);
        const ta = now();
        g.forEach((i, k) => learn(i, prev.get(i) ?? 1, ta + k * 0.34, soft.has(i)));
        await new Promise(r => setTimeout(r, interrupted ? 0 : (g.length - 1) * 340 + 1250));
      }
      return shown;
    },
    /** @param {number} i */
    select(i) { sel = i; selG = -1; if (i >= 0) setLens(i); else setLens(-1); unfocus(); hideTiles(); kick(); },
    /** District entry: the others dim to 38 % and lose their names. @param {number} gi */
    selectGroup(gi) {
      sel = -1; selG = gi; if (lens[2] > 0) setLens(-1);
      const was = focusK; focus = gi;
      if (o.reduced()) focusK = 1; else tween(0.45, e => { focusK = was + (1 - was) * e; });
      kick();
    },
    clear() { sel = -1; selG = -1; if (lens[2] > 0) setLens(-1); unfocus(); hideTiles(); kick(); },
    /** The open tiles over the words to study next, dropping in from 0.55 s. @param {number[]} idx */
    studyTiles(idx) { tiles(idx, now() + (o.reduced() ? -1 : 0.55)); },
    /** Fly to a word: about 30 px type (34 on a desktop), at 56°, clear of the sheet. @param {number} i @param {{below?: number, right?: number}} [opt] */
    flyToItem(i, { below = 0, right = 0 } = {}) {
      if (Number.isNaN(L.X[i])) return Promise.resolve(null);
      const d = dForType(isPhone() ? 30 : 34), ins = o.insets();
      const f = frame(box(i).map(p => [p[0], PLINTH + floorsOf(st[i], S[i]) * FLOOR * exagOf(d), p[2]]), { pitch: POSE.word, yaw: s.yaw, ty: PLINTH }, W, H,
        { top: ins.top + 8, bottom: (below || ins.bottom) + 8, left: 8, right: right + 8 }, { dMin: d, dMax: d });
      return flyTo({ x: f.x, z: f.z, d, pitch: POSE.word, ty: PLINTH });
    },
    /** Fly to frame a district (oblique 45°), clear of the sheet. @param {number} gi @param {{below?: number, right?: number}} [opt] */
    flyToGroup(gi, { below = 0, right = 0 } = {}) {
      const ins = o.insets();
      const f = frame(mapPoints(gi), { pitch: POSE.group, yaw: s.yaw, ty: PLINTH }, W, H, { top: ins.top + 8, bottom: (below || ins.bottom) + 8, left: 8, right: right + 8 }, { fill: 0.96 });
      return flyTo({ x: f.x, z: f.z, d: f.d, pitch: POSE.group, ty: PLINTH });
    },
    fit() { const f = overview(rise > 0.5 ? overPitch() : PLAN_PITCH, rise > 0.5 ? s.yaw : 0); return flyTo({ ...f }, { ms: 0.6 }); },
    /** @param {number} k */
    zoomBy(k) { return flyTo({ d: clamp(s.d / k, LIM.dMin, dMax()) }, { ms: 0.4 }); },
    /**
     * Map → 3D: start exactly where the 2D map is (plan view at the same place and scale), then tilt to 42° and turn
     * −24° while the buildings rise district by district from the middle out. From an overview the end frame is the
     * whole raised map in the free stage. Reduced motion: the raised view at once (the view crossfades).
     * @param {{x: number, y: number, k: number}} cam2d the 2D map's camera @param {{overview?: boolean, animate?: boolean}} [opt]
     */
    async enter(cam2d, { overview: whole = false, animate = true } = {}) {
      Object.assign(s, { x: cam2d.x, z: cam2d.y, ty: PLINTH, yaw: 0, pitch: PLAN_PITCH });
      s.d = M().ppu / Math.max(1e-4, cam2d.k);
      kick();
      const end = whole ? overview(overPitch(), POSE.yaw) : { ...s, pitch: POSE.pitch, yaw: POSE.yaw, d: s.d * 0.92 };
      const my = ++tiltNo;
      if (!animate || o.reduced()) { Object.assign(s, end); rise = 1; kick(); return; }
      const from = { ...s };
      busy(RISE_S + 0.2);
      await tween(RISE_S, (e, u) => {
        if (my !== tiltNo) return;     // a newer tilt or settle took over
        const pe = easeInOut(Math.min(1, u * 1.15));
        s.x = from.x + (end.x - from.x) * pe; s.z = from.z + (end.z - from.z) * pe;
        s.pitch = from.pitch + (end.pitch - from.pitch) * pe; s.yaw = from.yaw + (end.yaw - from.yaw) * pe;
        s.d = Math.exp(Math.log(from.d) + (Math.log(end.d) - Math.log(from.d)) * pe);
        rise = u;
      }, x => x);
      if (my === tiltNo) rise = 1;
    },
    /** Is the camera at an overview (about the whole map in view)? */
    atOverview() { return s.d >= overview(overPitch(), s.yaw).d * 0.8; },
    /**
     * 3D → Map: the reverse; resolves with the 2D camera that shows the same place. to: settle exactly onto this 2D
     * camera (the whole map, when leaving from an overview). @param {{animate?: boolean, to?: {x: number, y: number, k: number} | null}} [opt]
     */
    async leave({ animate = true, to = null } = {}) {
      stopCamera(); sel = -1; setLens(-1);
      const from = { ...s }, r0 = rise;
      // straight down over the point in the middle of the screen
      const c = to ? { x: to.x, z: to.y } : ground(s, W / 2, H / 2, W, H, PLINTH) || { x: s.x, z: s.z };
      const end = { x: c.x, z: c.z, pitch: PLAN_PITCH, yaw: Math.round(from.yaw / (Math.PI * 2)) * Math.PI * 2, d: to ? M().ppu / to.k : from.d / 0.92 };
      const my = ++tiltNo;
      if (animate && !o.reduced()) {
        busy(RISE_S + 0.2);
        await tween(RISE_S * 0.8, (e, u) => {
          if (my !== tiltNo) return;
          s.x = from.x + (end.x - from.x) * e; s.z = from.z + (end.z - from.z) * e;
          s.pitch = from.pitch + (end.pitch - from.pitch) * e; s.yaw = from.yaw + (end.yaw - from.yaw) * e;
          s.d = Math.exp(Math.log(from.d) + (Math.log(end.d) - Math.log(from.d)) * e);
          rise = r0 * (1 - easeInOut(u));
        }, x => x);
      }
      if (my === tiltNo) { Object.assign(s, end); rise = 0; kick(); }
      return { x: end.x, y: end.z, k: M().ppu / end.d };
    },
    has(/** @type {number} */ i) { return !Number.isNaN(L.X[i]); },
    get layout() { return L; },
    get camera() { return { ...s }; },
    get raised() { return rise > 0.99; },
    get lost() { return lost; },
    resize,
    redraw() { C = readColors(); kick(); },
    /** Frame statistics since the last call: interval percentiles, CPU time per frame, render scale. */
    stats() {
      const q = (/** @type {number[]} */ a, /** @type {number} */ p) => { const x = [...a].sort((u, v) => u - v); return +(x[Math.min(x.length - 1, Math.floor(x.length * p))] || 0).toFixed(2); };
      const fr = frames.slice(1);
      const out = fr.length ? { frames: fr.length, fps: +(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)).toFixed(1), p50: q(fr, 0.5), p95: q(fr, 0.95), p99: q(fr, 0.99), cpuP95: q(cpu, 0.95), ratio, levels: res.levels } : null;
      frames = []; cpu = []; return out;
    },
    /** GPU memory this view holds (bytes, estimated from what it uploaded) and its draw count. */
    memory() { return { gpuBytes: Math.round(R.bytes + canvas.width * canvas.height * 4 * 3), glyphs: glyphs.count, glyphBytes: glyphs.buffer.byteLength, items: n, objects: R.G.count }; },
    /** Scripted motion for the performance report: step(u) is called every frame for ms. @param {number} ms @param {(u: number) => void} step */
    run(ms, step) {
      return new Promise(res => {
        frames = []; cpu = []; lastFrame = 0;
        const ta = performance.now();
        benchFrame = tsx => { const u = (tsx - ta) / ms; step(Math.min(1, u)); if (u >= 1) { benchFrame = null; res(api.stats()); } };
        kick();
      });
    },
    rig: s, now, kick, learn: (/** @type {number} */ i, /** @type {number} */ from, soft = false) => learn(i, from, now(), soft),
    destroy() {
      alive = false; cancelAnimationFrame(raf); clearTimeout(lensHold);
      ro.disconnect(); mo.disconnect(); mq.removeEventListener('change', recolor);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      o.labels.replaceChildren();
      try { R.G.release(); } catch { /* lost */ }
      // give the context back now (WebKit counts live contexts per page)
      /** @type {any} */ (gl.getExtension('WEBGL_lose_context'))?.loseContext();
      canvas.width = 0; canvas.height = 0;
    },
  };
  function unfocus() {
    if (focus < 0 && focusK === 0) return;
    const was = focusK, g = focus;
    if (o.reduced()) { focusK = 0; focus = -1; kick(); return; }
    tween(0.45, e => { focusK = was * (1 - e); }).then(() => { if (focus === g && focusK === 0) focus = -1; kick(); });
  }
  return api;
}
