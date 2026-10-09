// The sheet's drag maths (src/domain/sheet-drag.js): samples, release velocity, the rubber band, detents and where a
// release settles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSample, velocity, follow, stops, settle, closeMs, scrimAt, WINDOW_MS, FLING } from '../../src/domain/sheet-drag.js';

/** Samples every 16 ms moving `step` px each. @param {number} n @param {number} step @param {number} [t0] */
const run = (n, step, t0 = 0) => {
  let s = /** @type {import('../../src/domain/sheet-drag.js').Sample[]} */ ([]);
  for (let i = 0; i < n; i++) s = addSample(s, t0 + i * 16, 100 + i * step);
  return s;
};

test('addSample keeps the window and one sample before it', () => {
  const s = run(30, 5);
  const last = s[s.length - 1].t;
  assert.ok(s.length >= 2);
  assert.ok(last - s[1].t <= WINDOW_MS, 'the second sample is inside the window');
  assert.ok(s.length <= Math.ceil(WINDOW_MS / 16) + 2);
});

test('velocity: px/ms over the last 80 ms, positive downward', () => {
  assert.equal(velocity(run(10, 16)), 1);
  assert.equal(velocity(run(10, -8)), -0.5);
  assert.equal(velocity([]), 0);
  assert.equal(velocity([{ t: 0, y: 0 }]), 0);
});

test('velocity counts only the end of the gesture: slow then fast reads fast', () => {
  let s = run(20, 1);                      // 1 px a frame
  const t = s[s.length - 1].t, y = s[s.length - 1].y;
  for (let i = 1; i <= 5; i++) s = addSample(s, t + i * 16, y + i * 24);   // then 1.5 px/ms
  assert.ok(Math.abs(velocity(s) - 1.5) < 0.2, `got ${velocity(s)}`);
});

test('velocity is 0 when the finger rested before letting go', () => {
  const s = run(10, 16);
  assert.equal(velocity(s, s[s.length - 1].t + WINDOW_MS + 1), 0);
  assert.equal(velocity(s, s[s.length - 1].t + 10), 1);
});

test('follow: 1:1 below the top stop, a quarter of the way above it', () => {
  assert.equal(follow(120), 120);
  assert.equal(follow(0), 0);
  assert.equal(follow(-40), -10);
  assert.equal(follow(200, 300), 275);
});

test('stops: full at 0, peek as a share or in px, sorted top first', () => {
  assert.deepEqual(stops(600, ['full']), [{ name: 'full', y: 0 }]);
  assert.deepEqual(stops(600, ['peek', 'full'], 0.5), [{ name: 'full', y: 0 }, { name: 'peek', y: 300 }]);
  assert.deepEqual(stops(600, ['peek', 'full'], 240), [{ name: 'full', y: 0 }, { name: 'peek', y: 360 }]);
  assert.deepEqual(stops(200, ['peek'], 400), [{ name: 'peek', y: 0 }], 'a peek taller than the panel is the full height');
  assert.deepEqual(stops(600, []), [{ name: 'full', y: 0 }]);
});

test('settle, one detent: a third of the height closes, less springs back; a flick closes from anywhere', () => {
  const list = stops(600, ['full']);
  assert.deepEqual(settle({ y: 150, v: 0.2, height: 600, stops: list }), { to: 'full', y: 0 });
  assert.deepEqual(settle({ y: 210, v: 0.2, height: 600, stops: list }), { to: 'closed', y: 600 });
  assert.deepEqual(settle({ y: 30, v: FLING + 0.1, height: 600, stops: list }), { to: 'closed', y: 600 });
  assert.deepEqual(settle({ y: 400, v: -1, height: 600, stops: list }), { to: 'full', y: 0 }, 'a flick up keeps it open');
  assert.deepEqual(settle({ y: -20, v: 0, height: 600, stops: list }), { to: 'full', y: 0 }, 'released in the rubber band');
});

test('settle, peek and full: flicks step one detent; slow releases take the nearest', () => {
  const list = stops(600, ['peek', 'full'], 0.5);   // full 0, peek 300
  assert.deepEqual(settle({ y: 40, v: 1, height: 600, stops: list }), { to: 'peek', y: 300 }, 'from full, a flick down drops to peek');
  assert.deepEqual(settle({ y: 320, v: 1, height: 600, stops: list }), { to: 'closed', y: 600 }, 'from peek it closes');
  assert.deepEqual(settle({ y: 280, v: -1, height: 600, stops: list }), { to: 'full', y: 0 }, 'a flick up from peek opens it full');
  assert.deepEqual(settle({ y: 120, v: 0, height: 600, stops: list }), { to: 'full', y: 0 });
  assert.deepEqual(settle({ y: 200, v: 0, height: 600, stops: list }), { to: 'peek', y: 300 });
  assert.deepEqual(settle({ y: 380, v: 0, height: 600, stops: list }), { to: 'peek', y: 300 }, 'under a third of the peek: back to peek');
  assert.deepEqual(settle({ y: 410, v: 0, height: 600, stops: list }), { to: 'closed', y: 600 });
});

test('closeMs: a flick carries the panel faster, within 120 to 280 ms; a slow close is 160 ms', () => {
  assert.equal(closeMs(500, 0.3), 160);
  assert.equal(closeMs(500, 4), 250);
  assert.equal(closeMs(100, 4), 120);
  assert.equal(closeMs(600, 1), 280);
});

test('scrimAt: the backdrop follows the panel', () => {
  assert.equal(scrimAt(0, 600), 1);
  assert.equal(scrimAt(300, 600), 0.5);
  assert.equal(scrimAt(700, 600), 0);
  assert.equal(scrimAt(-20, 600), 1);
  assert.equal(scrimAt(10, 0), 1);
});
