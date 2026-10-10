// core/scope.js: listeners, timers and frames tied to a view's ctx.signal (arch F2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scope } from '../../src/core/scope.js';

const g = /** @type {any} */ (globalThis);
/** @type {Map<number, FrameRequestCallback>} */
const frames = new Map();
let nextFrame = 1;
g.requestAnimationFrame = (/** @type {FrameRequestCallback} */ fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
g.cancelAnimationFrame = (/** @type {number} */ id) => { frames.delete(id); };
const flushFrames = () => { const fns = [...frames.values()]; frames.clear(); fns.forEach(f => f(16)); };
const wait = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

test('on: the listener runs until the signal aborts', () => {
  const ac = new AbortController();
  const s = scope(ac.signal);
  const t = new EventTarget();
  let n = 0;
  s.on(t, 'ping', () => { n++; });
  t.dispatchEvent(new Event('ping'));
  ac.abort();
  t.dispatchEvent(new Event('ping'));
  assert.equal(n, 1);
});

test('on: the returned stop removes it early, also for a capture listener', () => {
  const ac = new AbortController();
  const s = scope(ac.signal);
  const t = new EventTarget();
  let n = 0;
  const off = s.on(t, 'ping', () => { n++; }, true);
  off();
  t.dispatchEvent(new Event('ping'));
  assert.equal(n, 0);
});

test('on: options pass through (once), and a signal of its own is refused', () => {
  const ac = new AbortController();
  const s = scope(ac.signal);
  const t = new EventTarget();
  let n = 0;
  s.on(t, 'ping', () => { n++; }, { once: true });
  t.dispatchEvent(new Event('ping'));
  t.dispatchEvent(new Event('ping'));
  assert.equal(n, 1);
  assert.throws(() => s.on(t, 'ping', () => {}, /** @type {any} */ ({ signal: new AbortController().signal })), TypeError);
});

test('nothing starts on a signal that is already aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  const s = scope(ac.signal);
  const t = new EventTarget();
  let n = 0;
  s.on(t, 'ping', () => { n++; });
  s.timeout(() => { n++; }, 0);
  s.interval(() => { n++; }, 1);
  s.raf(() => { n++; });
  t.dispatchEvent(new Event('ping'));
  flushFrames();
  await wait(10);
  assert.equal(n, 0);
  assert.equal(frames.size, 0);
});

test('timeout: runs once; abort before it fires cancels it; stop() cancels it', async () => {
  const ac = new AbortController();
  const s = scope(ac.signal);
  let ran = 0, cancelled = 0, stopped = 0;
  s.timeout(() => { ran++; }, 1);
  const stop = s.timeout(() => { stopped++; }, 1);
  stop();
  await wait(5);              // a later timer: the 1 ms ones have had their turn
  s.timeout(() => { cancelled++; }, 0);
  ac.abort();                 // in the same task, before it can fire
  await wait(5);
  assert.deepEqual([ran, cancelled, stopped], [1, 0, 0]);
});

test('interval: ticks until the signal aborts', async () => {
  const ac = new AbortController();
  const s = scope(ac.signal);
  let n = 0;
  s.interval(() => { n++; if (n === 2) ac.abort(); }, 1);
  await wait(30);
  assert.equal(n, 2);
});

test('raf: one frame; abort cancels a pending frame; a loop stops on abort', () => {
  const ac = new AbortController();
  const s = scope(ac.signal);
  let once = 0, loop = 0;
  s.raf(() => { once++; });
  const draw = () => { loop++; s.raf(draw); };
  s.raf(draw);
  flushFrames(); flushFrames(); flushFrames();
  assert.equal(once, 1);
  assert.equal(loop, 3);
  ac.abort();
  flushFrames();
  assert.equal(loop, 3);
  assert.equal(frames.size, 0);
});

test('stops do not pile up abort listeners on the signal', async () => {
  const ac = new AbortController();
  const s = scope(ac.signal);
  let removed = 0;
  const add = ac.signal.addEventListener.bind(ac.signal), remove = ac.signal.removeEventListener.bind(ac.signal);
  /** @type {any} */ (ac.signal).addEventListener = add;
  /** @type {any} */ (ac.signal).removeEventListener = (/** @type {any[]} */ ...a) => { removed++; return remove(...a); };
  for (let i = 0; i < 5; i++) s.timeout(() => {}, 0);
  for (let i = 0; i < 5; i++) s.raf(() => {})();
  await wait(5);
  assert.equal(removed, 10, 'each finished timer or frame takes its abort listener off');
});
