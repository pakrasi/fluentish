// Progress charts: a count axis gets whole ticks (design B14: an empty chart read 0, 0.25, 0.5, 0.75, 1 for words).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// charts.js imports core/motion.js, which reads the document root at load
globalThis.document ??= /** @type {any} */ ({ documentElement: { classList: { add() {} }, dataset: {} } });
globalThis.matchMedia ??= /** @type {any} */ (() => ({ matches: false, addEventListener() {} }));
const { niceAxis, allWhole } = await import('../../src/features/today/progress/charts.js');

const ticks = (/** @type {{max: number, step: number}} */ a) => { const out = []; for (let v = 0; v <= a.max + 1e-9; v += a.step) out.push(+v.toFixed(6)); return out; };

test('an empty or tiny count axis is 0 and 1, never quarters', () => {
  assert.deepEqual(ticks(niceAxis(0, { integer: true })), [0, 1]);
  assert.deepEqual(ticks(niceAxis(1, { integer: true })), [0, 1]);
  assert.deepEqual(ticks(niceAxis(3, { integer: true })), [0, 1, 2, 3]);
  // without the flag the old fractional steps stay (hours are fractional on purpose)
  assert.deepEqual(ticks(niceAxis(1)), [0, 0.25, 0.5, 0.75, 1]);
});

test('every tick of a count axis is a whole number, up to large values', () => {
  for (let v = 0; v <= 5000; v += v < 50 ? 1 : 37) {
    const a = niceAxis(v, { integer: true });
    assert.ok(a.step >= 1 && Number.isInteger(a.step), `step ${a.step} for ${v}`);
    assert.ok(a.max >= v, `max ${a.max} covers ${v}`);
    assert.ok(ticks(a).every(Number.isInteger), `ticks for ${v}`);
    assert.ok(ticks(a).length <= 6, `at most 5 steps for ${v}`);
  }
  // 10 words: steps of 2.5 would give 2.5 and 7.5; a count steps by 5
  assert.deepEqual(ticks(niceAxis(10, { integer: true })), [0, 5, 10]);
});

test('allWhole tells counts from hours', () => {
  assert.equal(allWhole([0, 0, 0]), true);
  assert.equal(allWhole([12, 40]), true);
  assert.equal(allWhole([0.5, 2]), false);
  assert.equal(allWhole([]), true);
});
