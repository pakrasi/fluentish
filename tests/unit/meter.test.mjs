// Meter and count-up maths (domain/meter.js, round 8 C2): ring arc lengths and gaps, clamping, the parts of a meter
// (ink before today, accent today, the second lap), a value spread over segments, and the count-up curve's endpoints
// and rounding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp01, ringGeometry, dash, meterParts, spread, easeOutQuart, countAt } from '../../src/domain/meter.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('clamp01 holds 0..1 and treats NaN, undefined and null as 0', () => {
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(1.7), 1);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(undefined), 0);
  assert.equal(clamp01(null), 0);
  assert.equal(clamp01(Infinity), 1);
});

test('one arc: the radius leaves room for the stroke, no gap, the arc is the whole circle', () => {
  const g = ringGeometry({ stroke: 5.5 });
  near(g.r, 47.25);
  near(g.C, 2 * Math.PI * 47.25);
  assert.equal(g.gap, 0);
  near(g.seg, g.C);
  assert.equal(g.offset(0), -0);
});

test('four arcs: four 5° gaps, arcs and gaps add up to the circumference, offsets step by arc + gap', () => {
  const g = ringGeometry({ stroke: 5.5, arcs: 4, gapDeg: 5 });
  near(g.gap, (5 / 360) * g.C);
  near(4 * g.seg + 4 * g.gap, g.C);
  near(g.offset(2), -2 * (g.seg + g.gap));
  // arcs below 1 are one arc
  assert.equal(ringGeometry({ arcs: 0 }).n, 1);
});

test('dash: the drawn length is the clamped fraction of the arc, then the circumference as the gap', () => {
  const g = ringGeometry();
  assert.equal(dash(0.5, g.seg, g.C), `${Math.round(g.seg * 500) / 1000} ${Math.round(g.C * 1000) / 1000}`);
  assert.match(dash(-1, g.seg, g.C), /^0 /);
  assert.equal(dash(2, g.seg, g.C).split(' ')[0], String(Math.round(g.seg * 1000) / 1000));
});

test('meterParts: ink before today, accent for today, the states', () => {
  assert.deepEqual(meterParts({ value: 0, max: 60 }), { base: 0, total: 0, over: 0, state: 'empty' });
  const p = meterParts({ value: 22, max: 60, today: 10 });
  near(p.base, 12 / 60); near(p.total, 22 / 60);
  assert.equal(p.over, 0); assert.equal(p.state, 'partial');
  assert.equal(meterParts({ value: 60, max: 60 }).state, 'goal');
  assert.equal(meterParts({ value: 60, max: 60 }).total, 1);
});

test('meterParts: over the goal closes the first lap and draws the rest as a second lap, at most one more lap', () => {
  const p = meterParts({ value: 75, max: 60, today: 30 });
  assert.equal(p.state, 'over');
  assert.equal(p.total, 1);
  near(p.base, 45 / 60);
  near(p.over, 15 / 60);
  assert.equal(meterParts({ value: 500, max: 60 }).over, 1);
});

test('meterParts clamps: today larger than value, negative value, no max', () => {
  const p = meterParts({ value: 10, max: 60, today: 25 });
  assert.equal(p.base, 0); near(p.total, 10 / 60);
  assert.deepEqual(meterParts({ value: -5, max: 60 }), { base: 0, total: 0, over: 0, state: 'empty' });
  assert.equal(meterParts({ value: 3, max: 0 }).state, 'goal');
  assert.equal(meterParts({ value: 0, max: 0 }).state, 'empty');
});

test('spread: one value over n arcs fills them in order', () => {
  assert.deepEqual(spread(0.5, 4), [1, 1, 0, 0]);
  assert.deepEqual(spread(0.625, 4), [1, 1, 0.5, 0]);
  assert.deepEqual(spread(1.5, 2), [1, 1]);
  assert.deepEqual(spread(0.3, 1), [0.3]);
});

test('easeOutQuart: 0 at 0, 1 at 1, clamped outside, rising, past halfway at a quarter of the time', () => {
  assert.equal(easeOutQuart(0), 0);
  assert.equal(easeOutQuart(1), 1);
  assert.equal(easeOutQuart(-1), 0);
  assert.equal(easeOutQuart(2), 1);
  let prev = 0;
  for (let k = 0.05; k < 1; k += 0.05) { const e = easeOutQuart(k); assert.ok(e > prev); prev = e; }
  assert.ok(easeOutQuart(0.25) > 0.6);
});

test('countAt: the endpoints are exact, the middle is rounded to the decimals, downward counts work', () => {
  assert.equal(countAt(0, 42, 0), 0);
  assert.equal(countAt(0, 42, 1), 42);
  assert.equal(countAt(0, 42, 1.3), 42);
  assert.equal(countAt(7, 42, -0.1), 7);
  assert.ok(Number.isInteger(countAt(0, 42, 0.37)));
  assert.equal(countAt(0, 1, 0.5, 2), Math.round(easeOutQuart(0.5) * 100) / 100);
  assert.ok(countAt(42, 41, 0.5) >= 41 && countAt(42, 41, 0.5) <= 42);
  assert.equal(countAt(0.1, 0.3, 1, 1), 0.3);
});

/* ---- countTo (core/motion.js) and mountCount (ui/count.js) in node, with fake frames and a small fake DOM ---- */
class FakeEl {
  constructor() {
    /** @type {Record<string, string>} */ this.dataset = {};
    /** @type {Record<string, string>} */ this.attrs = {};
    this.cls = new Set();
    this.classList = { add: (/** @type {string} */ c) => this.cls.add(c), remove: (/** @type {string} */ c) => this.cls.delete(c), contains: (/** @type {string} */ c) => this.cls.has(c) };
    this.textContent = '';
    this.className = '';
    /** @type {FakeEl[]} */ this.children = [];
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = v; }
  /** @param {...FakeEl} c */ replaceChildren(...c) { this.children = c; }
  getAnimations() { return []; }
}
/** @type {Map<number, Function>} */ const frames = new Map();
let nextId = 1, clockMs = 0;
/** Advance the fake clock by ms, one frame per 16 ms. @param {number} ms */
const runFrames = ms => {
  for (const end = clockMs + ms; clockMs < end;) {
    clockMs = Math.min(end, clockMs + 16);
    const due = [...frames]; frames.clear();
    for (const [, f] of due) f(clockMs);
  }
};
const reducedFlag = { on: false };
globalThis.document = /** @type {any} */ ({ documentElement: { classList: { add() {} }, dataset: {} }, createElement: () => new FakeEl() });
globalThis.matchMedia = /** @type {any} */ (() => ({ get matches() { return reducedFlag.on; } }));
globalThis.getComputedStyle = /** @type {any} */ (() => ({ getPropertyValue: () => '' }));
globalThis.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ f) => { const id = nextId++; frames.set(id, f); return id; });
globalThis.cancelAnimationFrame = /** @type {any} */ ((/** @type {number} */ id) => { frames.delete(id); });
globalThis.performance = /** @type {any} */ ({ now: () => clockMs });
const { countTo } = await import('../../src/core/motion.js');
const { mountCount } = await import('../../src/ui/count.js');
const el = () => /** @type {any} */ (new FakeEl());

test('countTo ticks from `from` to the exact target and resolves', async () => {
  const e = el();
  const p = countTo(e, 42, { from: 0, duration: 700 });
  runFrames(320);
  const mid = Number(e.textContent);
  assert.ok(mid > 21 && mid < 42, `past halfway at 320 ms on ease-out quart, got ${mid}`);
  runFrames(400);
  await p;
  assert.equal(e.textContent, '42');
  assert.equal(frames.size, 0, 'no frame left running');
});

test('countTo: the signal aborting stops the frames, resolves, and leaves the text where it was', async () => {
  const e = el(), ac = new AbortController();
  const p = countTo(e, 100, { from: 0, duration: 700, signal: ac.signal });
  runFrames(100);
  const at = e.textContent;
  ac.abort();
  await p;
  runFrames(800);
  assert.equal(e.textContent, at);
  assert.equal(frames.size, 0);
});

test('countTo: a second count on the element takes over; reduced motion writes the value at once', async () => {
  const e = el();
  countTo(e, 100, { from: 0, duration: 700 });
  runFrames(100);
  const q = countTo(e, 10, { duration: 300 });
  runFrames(400);
  await q;
  assert.equal(e.textContent, '10');
  assert.equal(frames.size, 0, 'the first count stopped');
  reducedFlag.on = true;
  try { await countTo(e, 77, { from: 0 }); assert.equal(e.textContent, '77'); } finally { reducedFlag.on = false; }
});

test('mountCount: the final text is in the hidden sibling from the start, the number ticks with tabular figures, prefix', async () => {
  const root = el();
  const c = mountCount(root, { value: 1407, from: 0, prefix: '+', format: n => String(Math.round(n)) });
  const [num, sr] = root.children;
  assert.equal(num.attrs['aria-hidden'], 'true');
  assert.equal(sr.textContent, '+1407');
  assert.ok(root.cls.has('is-ticking'));
  runFrames(800);
  await c.done();
  assert.equal(num.textContent, '+1407');
  assert.ok(!root.cls.has('is-ticking'));
});

test('mountCount: no from stands still; update ticks from the shown value; destroy stops it mid-count', async () => {
  const root = el();
  const c = mountCount(root, { value: 7, format: n => String(Math.round(n)) });
  assert.equal(root.children[0].textContent, '7');
  assert.equal(frames.size, 0, 'a number that did not change does not move');
  c.update({ value: 10 });
  runFrames(100);
  const mid = Number(root.children[0].textContent);
  assert.ok(mid >= 7 && mid < 10);
  c.destroy();
  c.destroy();
  runFrames(800);
  assert.equal(Number(root.children[0].textContent), mid, 'destroy leaves the number where it was');
  assert.equal(frames.size, 0);
  assert.ok(!root.cls.has('is-ticking'));
});
