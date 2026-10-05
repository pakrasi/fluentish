// Explore › 3D (src/domain/palace.js, src/features/explore/palace/camera.js): heights, level of detail, the item-state
// packing, glyph positions identical to the 2D Atlas, the learned-moment queue, resolution stepping, the camera and
// the vendored text atlas. Synthetic data and the shipped public map only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as P from '../../src/domain/palace.js';
import * as AT from '../../src/domain/atlas.js';
import * as CAM from '../../src/features/explore/palace/camera.js';
import * as SH from '../../src/features/explore/palace/shaders.js';

const ROOT = new URL('../../', import.meta.url);
const read = (/** @type {string} */ p) => readFileSync(new URL(p, ROOT));
const metrics = JSON.parse(read('src/vendor/newsreader-map/metrics.json').toString());
const sdfMeta = JSON.parse(read('src/vendor/palace-sdf/atlas.json').toString());

/** The map as the app loads it (src/features/explore/data.js loadAtlas), without the DOM. */
function loadAtlas() {
  const m = AT.decode(JSON.parse(read('content/atlas/de.json').toString())), I = m.items, n = I.id.length;
  const W = new Float32Array(n), AW = new Float32Array(n);
  for (let i = 0; i < n; i++) { W[i] = I.w[i] / 10; AW[i] = I.aw[i] / 10; }
  return { n, ids: I.id, text: I.t.map((/** @type {string} */ x) => x.replace(/\[[^\]]*\]/g, '…')), art: I.a.map((/** @type {number} */ a) => AT.ARTICLES[a]), W, AW, modes: m.modes };
}
const A = loadAtlas();
const layoutOf = (/** @type {string} */ mode) => { const groups = A.modes[mode]; return { mode, groups, ...AT.positions(groups, A.n), bounds: AT.bounds(groups) }; };
/** @type {Map<string, number>} */ const gIndex = new Map();
for (const st of ['r', 'i']) for (const ch of Object.keys(sdfMeta.glyphs[st])) gIndex.set(st + ch, gIndex.size);
const glyphIndex = (/** @type {string} */ ch, /** @type {boolean} */ it) => gIndex.get((it ? 'i' : 'r') + ch) ?? (it ? gIndex.get(`r${ch}`) ?? -1 : -1);

/* ---------------------------------------------------------------- height */

test('floors: not seen 0, not known a 1-floor scaffold, shaky 1-2, known 3-8 by doublings of stability', () => {
  assert.equal(P.floorsOf(0, 400), 0);
  assert.equal(P.floorsOf(1, 400), 1);
  assert.deepEqual([0, 1, 3, 30, 400].map(S => P.floorsOf(2, S)), [1, 1, 2, 2, 2]);
  assert.deepEqual([0, 2, 7, 15, 31, 63, 127, 255, 1e5].map(S => P.floorsOf(3, S)), [3, 3, 3, 4, 5, 6, 7, 8, 8]);
  assert.equal(P.floorsOf(3, NaN), 3);
  assert.equal(P.floorsOf(3, -5), 3);
  // monotonic: remembering longer never makes a building lower
  let last = 0;
  for (let S = 0; S < 2000; S += 0.5) { const f = P.floorsOf(3, S); assert.ok(f >= last); last = f; }
  // the state always shows in the height class too: a known word is taller than any shaky one
  assert.ok(P.floorsOf(3, 0) > P.floorsOf(2, 1e6));
});

test('exaggeration: true height near, smoothly up to 5x at the overview', () => {
  assert.equal(P.exagOf(0), 1);
  assert.equal(P.exagOf(P.EXAG_FROM), 1);
  assert.equal(P.exagOf(P.EXAG_FROM * 2), 2);
  assert.equal(P.exagOf(1e6), P.EXAG_MAX);
});

/* ---------------------------------------------------------------- level of detail */

test('LOD: districts, buildings, floors, words by on-screen sizes; type fades in between 5 and 8.5 px', () => {
  assert.equal(P.lodOf(0.5, 0.2), 'districts');
  assert.equal(P.lodOf(2, 1), 'buildings');
  assert.equal(P.lodOf(4, 3), 'floors');
  assert.equal(P.lodOf(5, 0), 'words');
  assert.equal(P.typeAlpha(4.99), 0);
  assert.equal(P.typeAlpha(8.5), 1);
  assert.ok(P.typeAlpha(6) > 0 && P.typeAlpha(6) < 1);
  // the on-screen type size halves as the distance doubles
  assert.equal(P.typePx(1000, 100), 160);
  assert.equal(P.typePx(1000, 200), 80);
  // the shaders use the same thresholds (one source of truth)
  assert.ok(SH.TEXT_VS.includes(`smoothstep(${P.TYPE_FROM}.0, ${P.TYPE_TO}`));
  assert.ok(SH.BLOCK_FS.includes(`smoothstep(${P.TYPE_FROM}.0, ${P.TYPE_TO}`));
});

/* ---------------------------------------------------------------- packing and positions */

test('item texture: four texels an item; every 3D footprint is exactly the Atlas position, in every mode', () => {
  const st = new Uint8Array(A.n).map((_, i) => i % 4), today = new Uint8Array(A.n), S = new Float32Array(A.n).fill(20);
  for (const mode of AT.BUILT_MODES) {
    const L = layoutOf(mode), data = P.packItems(A, L, st, today, S);
    assert.equal(data.length, P.TEX_W * P.texSize(A.n).h * 4);
    for (let i = 0; i < A.n; i++) {
      const a = P.texOffset(i, 0), b = P.texOffset(i, 1), c = P.texOffset(i, 2), d = P.texOffset(i, 3);
      assert.equal(data[a + 1], st[i]);
      assert.equal(data[b + 1], P.floorsOf(st[i], 20));
      if (Number.isNaN(L.X[i])) { assert.equal(data[d + 3], 0, `${mode} ${A.ids[i]} not in this mode`); continue; }
      assert.equal(data[d], L.X[i]); assert.equal(data[d + 1], L.Y[i]); assert.equal(data[d + 2], A.W[i]); assert.equal(data[d + 3], 1);
      assert.equal(data[c + 1], L.G[i]);
      assert.ok(data[c] >= 0 && data[c] <= 0.8 + 1e-6, 'the rise ends by the end of the tilt');
    }
  }
});

test('positions take no knowledge: the 3D layout is the same before and after every word is learnt', () => {
  const L = layoutOf('topic'), n = A.n;
  const before = P.packItems(A, L, new Uint8Array(n), new Uint8Array(n), new Float32Array(n));
  const after = P.packItems(A, L, new Uint8Array(n).fill(3), new Uint8Array(n).fill(1), new Float32Array(n).fill(500));
  for (let i = 0; i < n; i++) for (const k of [2, 3]) {
    const o = P.texOffset(i, k);
    assert.deepEqual([...after.subarray(o, o + 4)], [...before.subarray(o, o + 4)]);
  }
});

test('glyphs: every glyph sits where the Atlas sets the letter; each word ends at its Atlas width', () => {
  const g = P.packGlyphs(A, metrics, glyphIndex, AT.ART), dv = new DataView(g.buffer);
  assert.equal(g.buffer.byteLength, g.count * 12);
  const reg = metrics.styles.regular, upm = reg.unitsPerEm;
  /** @type {Map<number, number>} */ const end = new Map();
  for (let k = 0; k < g.count; k++) {
    const i = dv.getUint16(k * 12, true), w = dv.getUint16(k * 12 + 6, true), art = w >> 15, xr = dv.getInt16(k * 12 + 8, true) / 10;
    // where the last glyph of the word ends: its x plus its own advance
    const chars = [...(art ? A.art[i] : A.text[i])], ci = (w & 0x7fff) - (art ? 0 : [...(A.art[i] || '')].length);
    const adv = ((reg.advance[chars[ci]] ?? 0) / upm) * AT.FS * (art ? AT.ART : 1);
    if (!art) end.set(i, xr + adv);
    assert.ok(dv.getUint16(k * 12 + 2, true) < gIndex.size);
  }
  let worst = 0;
  for (const [i, x] of end) {
    const lastSpace = /\s$/.test(A.text[i]);
    if (!lastSpace) worst = Math.max(worst, Math.abs(x - A.W[i]));
  }
  assert.ok(worst <= 0.15, `a word's glyphs end ${worst} units off its Atlas width`);
  // deterministic: the same content packs to the same bytes
  assert.deepEqual(new Uint8Array(P.packGlyphs(A, metrics, glyphIndex, AT.ART).buffer), new Uint8Array(g.buffer));
});

test('text atlas: covers every character of the map font, and VENDOR.md lists the shipped files\' hashes', () => {
  for (const st of ['regular', 'italic']) for (const ch of Object.keys(metrics.styles[st].advance)) {
    if (/\s/.test(ch)) continue;
    assert.ok(sdfMeta.glyphs[st === 'regular' ? 'r' : 'i'][ch], `${st} ${JSON.stringify(ch)} missing from the SDF atlas`);
  }
  for (const t of A.text) for (const ch of t) if (!/\s/.test(ch)) assert.ok(glyphIndex(ch, false) >= 0, `no glyph for ${ch}`);
  const vendor = read('src/vendor/palace-sdf/VENDOR.md').toString();
  for (const f of ['atlas.png', 'atlas.json']) {
    const h = createHash('sha256').update(read(`src/vendor/palace-sdf/${f}`)).digest('hex');
    assert.ok(vendor.includes(h), `VENDOR.md does not list ${f} ${h}`);
  }
});

/* ---------------------------------------------------------------- the learned moment */

test('moment queue: plays what became known since the last 3D view, once, in reading order', () => {
  const ids = ['W:a', 'W:b', 'W:c', 'W:d', 'W:e'], key = P.idsKey(ids), day = 'D1';
  const st = Uint8Array.from([3, 3, 2, 3, 0]), today = Uint8Array.from([1, 0, 1, 1, 0]);
  // no record on this device yet: the items known and practised today play
  assert.deepEqual(P.momentQueue(null, { ids, key, st, today, day }).play, [0, 3]);
  // a record: items that are known now and were not known then play
  const rec = { ver: key, st: P.encodeStates(Uint8Array.from([1, 3, 2, 2, 0])), day, played: [] };
  assert.deepEqual(P.momentQueue(rec, { ids, key, st, today, day }).play, [0, 3]);
  // after it played, the record is current and nothing replays, the same day or the next
  const next = P.nextRecord(rec, { ids, key, st, day }, [0, 3]);
  assert.deepEqual(next.played, ['W:a', 'W:d']);
  assert.deepEqual(P.momentQueue(next, { ids, key, st, today, day }).play, []);
  assert.deepEqual(P.momentQueue(next, { ids, key, st, today, day: 'D2' }).play, []);
  // a moment that played today does not play again today even if the record is old (two tabs)
  assert.deepEqual(P.momentQueue({ ...rec, played: ['W:a'] }, { ids, key, st, today, day }).play, [3]);
  // a word that drops and becomes known again on a later day plays again
  const dropped = P.nextRecord(next, { ids, key, st: Uint8Array.from([2, 3, 2, 3, 0]), day: 'D2' }, []);
  assert.deepEqual(P.momentQueue(dropped, { ids, key, st, today, day: 'D3' }).play, [0]);
  // a record from another map version is not compared
  assert.deepEqual(P.momentQueue({ ...rec, ver: 'other' }, { ids, key, st, today, day }).play, [0, 3]);
  // order and cap
  const q = P.momentQueue(null, { ids, key, st, today, day, order: i => -i, cap: 1 });
  assert.deepEqual(q.play, [3]); assert.deepEqual(q.settle, [0]);
});

test('state record: encodes one digit per item and refuses anything else', () => {
  const st = Uint8Array.from([0, 1, 2, 3, 3]);
  assert.equal(P.encodeStates(st), '01233');
  assert.deepEqual([...(/** @type {Uint8Array} */ (P.decodeStates('01233', 5)))], [...st]);
  assert.equal(P.decodeStates('0123', 5), null);
  assert.equal(P.decodeStates('01294', 5), null);
  assert.notEqual(P.idsKey(['W:a', 'W:b']), P.idsKey(['W:ab']));
});

/* ---------------------------------------------------------------- resolution stepping */

test('resolution: steps 2 → 1.5 → 1.25 when frames run long while moving, back up when on time, sharp at rest', () => {
  const r = P.createResolution(3);
  assert.deepEqual(r.levels, [2, 1.5, 1.25]);
  for (let k = 0; k < 29; k++) assert.equal(r.moving(25), 2);
  assert.equal(r.moving(25), 1.5);
  for (let k = 0; k < 30; k++) r.moving(25);
  assert.equal(r.ratio, 1.25);
  for (let k = 0; k < 60; k++) r.moving(25);
  assert.equal(r.ratio, 1.25, 'never below 1.25');
  assert.equal(r.still(), 2, 'one full-resolution frame when motion stops');
  for (let k = 0; k < P.RES_WINDOW + P.RES_RECOVER; k++) r.moving(16.7);
  assert.equal(r.ratio, 1.5, 'steps back up after frames on time');
  // gaps (a hidden tab, the first frame) say nothing
  const q = P.createResolution(2); for (let k = 0; k < 40; k++) q.moving(500); assert.equal(q.ratio, 2);
  assert.deepEqual(P.createResolution(1).levels, [1]);
  assert.deepEqual(P.createResolution(1.5).levels, [1.5, 1.25]);
});

/* ---------------------------------------------------------------- the camera */

test('camera: the plan view at d = ppu / k is the 2D map at scale k, north up', () => {
  const w = 390, h = 480, k = 0.37;
  const s = { x: 100, z: 200, ty: P.PLINTH, d: 0, yaw: 0, pitch: CAM.PLAN_PITCH };
  s.d = CAM.matrices(s, w, h).ppu / k;
  const { vp } = CAM.matrices(s, w, h);
  const c = CAM.project(vp, 100, P.PLINTH, 200, w, h), e = CAM.project(vp, 200, P.PLINTH, 200, w, h), n = CAM.project(vp, 100, P.PLINTH, 100, w, h);
  assert.ok(Math.abs(c.x - w / 2) < 0.01 && Math.abs(c.y - h / 2) < 0.01);
  assert.ok(Math.abs(e.x - c.x - 100 * k) < 0.05, `east is ${e.x - c.x} px, wanted ${100 * k}`);
  assert.ok(Math.abs(c.y - n.y - 100 * k) < 0.05, 'north is up');
  // the ground under a screen point projects back to it
  const g = /** @type {{x: number, z: number}} */ (CAM.ground({ ...s, pitch: 0.74, yaw: -0.42 }, 80, 300, w, h, P.PLINTH));
  const back = CAM.project(CAM.matrices({ ...s, pitch: 0.74, yaw: -0.42 }, w, h).vp, g.x, P.PLINTH, g.z, w, h);
  assert.ok(Math.abs(back.x - 80) < 0.01 && Math.abs(back.y - 300) < 0.01);
});

test('camera: the whole map framed at the 3D pose fits the free stage on a phone (no cut edge)', () => {
  const L = layoutOf('topic');
  const pts = L.groups.flatMap((/** @type {any} */ g) => Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * Math.PI * 2; return [[g.x + Math.sin(a) * g.r, 0, g.y + Math.cos(a) * g.r], [g.x, P.PLINTH + 30, g.y]]; }).flat());
  for (const [w, h, ins] of [[390, 480, { top: 8, bottom: 60, left: 8, right: 8 }], [1440, 730, { top: 8, bottom: 60, left: 8, right: 8 }]]) {
    const s = CAM.frame(pts, { pitch: 0.74, yaw: -0.42, ty: P.PLINTH }, w, h, ins, { fill: 0.96 });
    const { vp } = CAM.matrices(s, w, h);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const q = CAM.project(vp, p[0], p[1], p[2], w, h); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    assert.ok(x0 >= ins.left - 1 && x1 <= w - ins.right + 1, `${w}px: x ${x0.toFixed(1)}..${x1.toFixed(1)}`);
    assert.ok(y0 >= ins.top - 1 && y1 <= h - ins.bottom + 1, `${w}px: y ${y0.toFixed(1)}..${y1.toFixed(1)}`);
    // and it uses the room: the limiting side fills most of it
    assert.ok(Math.max((x1 - x0) / (w - ins.left - ins.right), (y1 - y0) / (h - ins.top - ins.bottom)) > 0.9);
  }
});
