/* The 3D map (Explore › 3D, the "Type city"): the pure rules behind it. Tested in node (tests/unit/palace.test.mjs);
   used by src/features/explore/palace/. Nothing here touches the DOM, WebGL or the clock.

   Every word is a building on the Atlas floor plan: its footprint is the word's box on its own line, at exactly the
   place content/atlas puts it (domain/atlas.js positions()), so the plan view is the Atlas and the palace never
   rearranges. Height carries one fact, how long he will remember the word:
     known      3 to 8 floors, one floor per doubling of the FSRS stability: round(log2(S + 1)), clamped
     shaky      1 or 2 floors
     not known  an open scaffold one floor high (edges only)
     not seen   no building: the type is printed on the plinth
   World units are the Atlas's (16 per em, 26 per line); y is up, the Atlas's y is the world's z. */

import { FS } from './atlas.js';

export const PLINTH = 10;        // height of a district's plinth
export const FLOOR = 7;          // height of one floor
export const DEPTH_UP = 15;      // a building's footprint above the baseline (the line is 26 units)
export const DEPTH_DN = 6;       // and below it
export const INSET = 3;          // footprint margin left and right of the word
export const MAX_FLOORS = 8;
/** Vertical exaggeration: from EXAG_FROM units away heights scale up smoothly, to EXAG_MAX at EXAG_MAX × EXAG_FROM. */
export const EXAG_FROM = 1200, EXAG_MAX = 5;
/** On-screen type size (px) of the bars-to-type crossfade, as in the Atlas (in 3D the bar is a roof marking). */
export const TYPE_FROM = 5, TYPE_TO = 8.5;
/** A floor's hairline shows from this on-screen floor height (px). */
export const FLOOR_PX = 3;
/** Type smaller than this is not tappable; a tap there opens the district. */
export const TAP_MIN_PX = 7;

/**
 * Floors of an item. state: 0 not seen, 1 not known, 2 shaky, 3 known (atlas STATE_CODE); S: FSRS stability in days.
 * @param {number} state @param {number} S
 */
export function floorsOf(state, S) {
  if (state <= 0) return 0;
  if (state === 1) return 1;
  const f = Math.round(Math.log2(Math.max(0, Number.isFinite(S) ? S : 0) + 1));
  return state === 2 ? Math.max(1, Math.min(2, f)) : Math.max(3, Math.min(MAX_FLOORS, f));
}

/** The exaggeration factor at camera distance d. @param {number} d */
export const exagOf = d => Math.min(EXAG_MAX, Math.max(1, d / EXAG_FROM));

/** @param {number} a @param {number} b @param {number} x */
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How strongly the type is drawn at an on-screen type size (px): 0 under 5 px, 1 from 8.5 px. @param {number} px */
export const typeAlpha = px => smoothstep(TYPE_FROM, TYPE_TO, px);

/**
 * The level of detail at a place on screen (DESIGN.md, Explore › 3D): 'words' once type reaches 5 px (crossfading to
 * type only at 8.5 px), else 'floors' when a floor is at least 3 px tall, else 'buildings' while type is at least 1 px,
 * else 'districts' (massing, plinths, rings and names).
 * @param {number} typePx on-screen size of the base font @param {number} floorPx on-screen height of one floor
 * @returns {'districts' | 'buildings' | 'floors' | 'words'}
 */
export function lodOf(typePx, floorPx) {
  if (typePx >= TYPE_FROM) return 'words';
  if (floorPx >= FLOOR_PX) return 'floors';
  if (typePx >= 1) return 'buildings';
  return 'districts';
}

/** On-screen size (px) of a world length L seen from distance dist, for pixels-per-unit-at-distance-1 ppu. @param {number} L @param {number} ppu @param {number} dist */
export const screenPx = (L, ppu, dist) => (L * ppu) / Math.max(1, dist);
/** On-screen type size at a distance (the base font is FS units). @param {number} ppu @param {number} dist */
export const typePx = (ppu, dist) => screenPx(FS, ppu, dist);

/* ---------------------------------------------------------------- the item-state texture

   One RGBA32F texture holds everything that changes per item, four texels per item, 64 items per row, so a learned
   word is one 64-byte write and every animation (rise, colour, letters, bob, glow) is evaluated on the GPU from one
   time uniform:
     A = (state from, state to, time of the state change, today)
     B = (floors from, floors to, time of the height change, time learned or -99)
     C = (rise delay, group, footprint centre x, footprint centre z)
     D = (left x, baseline z, width, 1 when the item is in this layout) */
export const TEX_W = 256;          // texels per row
export const NONE = -99;           // "no event" time
/** Texture size for n items. @param {number} n */
export const texSize = n => ({ w: TEX_W, h: Math.max(1, Math.ceil((n * 4) / TEX_W)) });
/** Offset (in floats) of item i's texel k (0 A, 1 B, 2 C, 3 D). @param {number} i @param {number} k */
export const texOffset = (i, k) => (i * 4 + k) * 4;

/**
 * The texture's data for a layout and scores, everything settled (no animation pending).
 * @param {{n: number, W: Float32Array}} A loadAtlas() @param {{X: Float32Array, Y: Float32Array, G: Int32Array, groups: {x: number, y: number, r: number}[], bounds: any}} L layout
 * @param {Uint8Array} st state codes @param {Uint8Array} today @param {Float32Array} S stability (days)
 */
export function packItems(A, L, st, today, S) {
  const { w, h } = texSize(A.n), data = new Float32Array(w * h * 4);
  const delays = riseDelays(A, L);
  for (let i = 0; i < A.n; i++) {
    const f = floorsOf(st[i], S[i]);
    data.set([st[i], st[i], NONE, today[i]], texOffset(i, 0));
    data.set([f, f, NONE, NONE], texOffset(i, 1));
    writePlace(data, A, L, i, delays[i]);
  }
  return data;
}

/** Write item i's place (texels C and D) for a layout. @param {Float32Array} data @param {any} A @param {any} L @param {number} i @param {number} delay */
export function writePlace(data, A, L, i, delay) {
  const x = L.X[i], y = L.Y[i], on = !Number.isNaN(x);
  const w = A.W[i];
  data.set([delay, L.G[i], on ? x + w / 2 : 0, on ? y - (DEPTH_UP - DEPTH_DN) / 2 : 0], texOffset(i, 2));
  data.set([on ? x : 0, on ? y : 0, w, on ? 1 : 0], texOffset(i, 3));
}

/**
 * When each building starts to rise in the Map → 3D tilt, as a share of the tilt: districts from the middle of the
 * map outwards (0.55 × distance from the centre over the farthest), then line by line inside each (0.25 × row).
 * @param {{n: number}} A @param {{Y: Float32Array, G: Int32Array, groups: {x: number, y: number, r: number}[]}} L
 */
export function riseDelays(A, L) {
  const out = new Float32Array(A.n);
  if (!L.groups.length) return out;
  let cx = 0, cy = 0;
  { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const g of L.groups) { x0 = Math.min(x0, g.x - g.r); x1 = Math.max(x1, g.x + g.r); y0 = Math.min(y0, g.y - g.r); y1 = Math.max(y1, g.y + g.r); } cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; }
  const far = Math.max(1, ...L.groups.map(g => Math.hypot(g.x - cx, g.y - cy)));
  for (let i = 0; i < A.n; i++) {
    const g = L.groups[L.G[i]]; if (!g) continue;
    const stag = Math.hypot(g.x - cx, g.y - cy) / far, row = Math.min(1, Math.max(0, (L.Y[i] - (g.y - g.r)) / (2 * g.r)));
    out[i] = stag * 0.55 + row * 0.25;
  }
  return out;
}

/* ---------------------------------------------------------------- glyphs

   Every glyph is one instanced quad: item index, its glyph in the regular and the italic table, and its x offset from
   the item's left edge in both styles (tenths of a unit), from the map font's advance table, the same table the Atlas
   was laid out with. The article is set at ART size, the word starts at the item's article width (A.AW), exactly as
   the 2D map draws it. 12 bytes a glyph: Uint16 item, glyph R, glyph I, char index | article flag << 15; Int16 xR, xI. */

/**
 * @param {{n: number, text: string[], art: string[], AW: Float32Array}} A loadAtlas()
 * @param {{styles: {regular: {unitsPerEm: number, advance: Record<string, number>}, italic: {advance: Record<string, number>}}}} metrics the map font's metrics.json
 * @param {(ch: string, italic: boolean) => number} glyphIndex index of a character in the glyph table (-1: none)
 * @param {number} ART article scale
 */
export function packGlyphs(A, metrics, glyphIndex, ART) {
  const reg = metrics.styles.regular, ita = metrics.styles.italic, upm = reg.unitsPerEm;
  const advR = (/** @type {string} */ ch) => (reg.advance[ch] ?? 0) / upm, advI = (/** @type {string} */ ch) => (ita.advance[ch] ?? reg.advance[ch] ?? 0) / upm;
  /** @type {number[]} */ const u = [], s = [];
  for (let i = 0; i < A.n; i++) {
    let ci = 0;
    /** @type {[string, number, number, number][]} */ const pieces = [];
    if (A.art[i]) pieces.push([A.art[i], FS * ART, 0, 1]);
    pieces.push([A.text[i], FS, A.AW[i], 0]);
    for (const [txt, size, x0, isArt] of pieces) {
      let xr = x0, xi = x0;
      for (const ch of txt) {
        const gr = glyphIndex(ch, false), gi = glyphIndex(ch, true);
        if (!/\s/.test(ch) && gr >= 0) {
          u.push(i, gr, gi >= 0 ? gi : gr, Math.min(ci, 0x7fff) | (isArt << 15));
          s.push(Math.round(xr * 10), Math.round(xi * 10));
        }
        xr += advR(ch) * size; xi += advI(ch) * size; ci++;
      }
    }
  }
  const n = u.length / 4, buf = new ArrayBuffer(n * 12), dv = new DataView(buf);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < 4; j++) dv.setUint16(k * 12 + j * 2, u[k * 4 + j], true);
    dv.setInt16(k * 12 + 8, s[k * 2], true); dv.setInt16(k * 12 + 10, s[k * 2 + 1], true);
  }
  return { buffer: buf, count: n };
}

/* ---------------------------------------------------------------- the learned moment: what plays, once

   The 3D view keeps, per device, the state it last showed each item (a string of state codes, one per atlas item, in
   the kv 'palace') and the items whose moment already played today. On opening 3D (or when scores change while it is
   open) every item that is known now and was not known in that record plays the learned moment, once: on return from
   a study round, or on the next 3D open if he missed it. The record is then brought up to date. Without a record (the
   first 3D open on this device) the items known and practised today play, so the first open is not a flood. */

/** A short stable hash of the atlas's item ids, so a record from another map version is not compared. @param {string[]} ids */
export function idsKey(ids) {
  let h = 2166136261;
  for (const id of ids) { for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= 10; h = Math.imul(h, 16777619); }
  return `${ids.length}:${(h >>> 0).toString(36)}`;
}
/** @param {Uint8Array} st */
export const encodeStates = st => String.fromCharCode(...st.map(c => 48 + c));
/** @param {string} s @param {number} n @returns {Uint8Array | null} */
export function decodeStates(s, n) {
  if (typeof s !== 'string' || s.length !== n) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const c = s.charCodeAt(i) - 48; if (c < 0 || c > 3) return null; out[i] = c; }
  return out;
}

/**
 * The items whose learned moment should play now, in reading order (district, line, left to right), at most `cap`.
 * @param {{ver?: string, st?: string, day?: string, played?: string[]} | null} rec the device's record (kv 'palace')
 * @param {{ids: string[], key: string, st: Uint8Array, today: Uint8Array, day: string, order?: (i: number) => number, cap?: number}} now
 * @returns {{play: number[], settle: number[]}} play: indices to animate; settle: further newly known items shown in their final state
 */
export function momentQueue(rec, { ids, key, st, today, day, order = i => i, cap = 24 }) {
  const n = ids.length;
  const prev = rec && rec.ver === key && rec.st ? decodeStates(rec.st, n) : null;
  const played = new Set(rec && rec.day === day ? rec.played || [] : []);
  /** @type {number[]} */ const all = [];
  for (let i = 0; i < n; i++) {
    if (st[i] !== 3 || played.has(ids[i])) continue;
    if (prev ? prev[i] < 3 : !!today[i]) all.push(i);
  }
  all.sort((a, b) => order(a) - order(b) || a - b);
  return { play: all.slice(0, cap), settle: all.slice(cap) };
}

/**
 * The device's record after the 3D view showed the current scores and played `played`.
 * @param {{ver?: string, st?: string, day?: string, played?: string[]} | null} rec @param {{ids: string[], key: string, st: Uint8Array, day: string}} now @param {number[]} played
 */
export function nextRecord(rec, { ids, key, st, day }, played) {
  const before = rec && rec.day === day && rec.ver === key ? rec.played || [] : [];
  return { ver: key, st: encodeStates(st), day, played: [...new Set([...before, ...played.map(i => ids[i])])] };
}

/* ---------------------------------------------------------------- resolution stepping

   The canvas renders at the device pixel ratio capped at 2. While something moves, if the 90th percentile of the frame
   interval over the last 30 frames exceeds 18 ms, the render scale steps down (2 → 1.5 → 1.25 of a CSS pixel); after
   240 frames on time (p90 under 17.5 ms, the 60 Hz frame) it steps back up one level. When motion stops, one frame is drawn at the full
   ratio, so the still picture is always sharp. */
export const RES_WINDOW = 30, RES_SLOW_MS = 18, RES_FAST_MS = 17.5, RES_RECOVER = 240;

/** @param {number} dpr devicePixelRatio */
export function createResolution(dpr) {
  const top = Math.min(2, Math.max(1, dpr || 1));
  const levels = [top, ...[1.5, 1.25].filter(x => x < top)];
  let level = 0, fast = 0;
  /** @type {number[]} */ let win = [];
  const p90 = () => { const s = [...win].sort((a, b) => a - b); return s[Math.floor(s.length * 0.9)]; };
  return {
    /** The ratio to render the next moving frame at, after a frame interval of ms. @param {number} ms */
    moving(ms) {
      if (!(ms > 0 && ms < 250)) return levels[level];       // a gap (tab hidden, first frame) says nothing
      win.push(ms); if (win.length > RES_WINDOW) win.shift();
      if (win.length >= RES_WINDOW) {
        const p = p90();
        if (p > RES_SLOW_MS && level < levels.length - 1) { level++; win = []; fast = 0; }
        else if (p < RES_FAST_MS) { if (level > 0 && ++fast >= RES_RECOVER) { level--; win = []; fast = 0; } }
        else fast = 0;
      }
      return levels[level];
    },
    /** Motion stopped: the ratio for the still frame. */
    still() { win = []; return top; },
    get level() { return level; },
    get ratio() { return levels[level]; },
    levels,
  };
}
