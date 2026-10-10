// Back returns to where you were (core/scroll.js, round 8 lane U1): the memo of y per history entry, where an
// arrival lands, and restore() waiting for a view that draws its content after an async step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemo, landing, restore, newKey, budget } from '../../src/core/scroll.js';

test('memo: keeps y per key, rounds, never negative, ignores a missing key or a bad number', () => {
  const m = createMemo();
  m.save('a', 807.6);
  m.save('b', -20);
  m.save(null, 50);
  m.save('c', NaN);
  assert.equal(m.get('a'), 808);
  assert.equal(m.get('b'), 0);
  assert.equal(m.get('c'), undefined);
  assert.equal(m.get(null), undefined);
  assert.equal(m.size, 2);
});

test('memo: the oldest key goes past max; saving again makes a key the newest', () => {
  const m = createMemo(3);
  m.save('a', 1); m.save('b', 2); m.save('c', 3);
  m.save('a', 10);            // a is the newest now
  m.save('d', 4);             // b goes
  assert.equal(m.get('b'), undefined);
  assert.equal(m.get('a'), 10);
  assert.equal(m.size, 3);
});

test('landing: a new entry (no key) and the entry on screen start at the top', () => {
  const m = createMemo();
  m.save('a', 500);
  assert.equal(landing({ state: null, shownKey: 'a', memo: m }), null);
  assert.equal(landing({ state: {}, shownKey: 'a', memo: m }), null);
  assert.equal(landing({ state: { k: 'a', y: 500 }, shownKey: 'a', memo: m }), null, 'a refresh of the same entry');
});

test('landing: Back to a kept entry returns its y; memory wins over history.state', () => {
  const m = createMemo();
  m.save('list', 807);
  assert.equal(landing({ state: { k: 'list', y: 300 }, shownKey: 'item', memo: m }), 807);
  // after a reload the memory is empty: history.state has it
  assert.equal(landing({ state: { k: 'list', y: 300 }, shownKey: null, memo: createMemo() }), 300);
  // a key with no y anywhere, or y 0: the top
  assert.equal(landing({ state: { k: 'other' }, shownKey: 'item', memo: m }), null);
  assert.equal(landing({ state: { k: 'z', y: 0 }, shownKey: 'item', memo: createMemo() }), null);
  assert.equal(landing({ state: { k: 'z', y: 'x' }, shownKey: 'item', memo: createMemo() }), null);
});

test('newKey: short and different each time', () => {
  const ks = new Set(Array.from({ length: 200 }, newKey));
  assert.equal(ks.size, 200);
  for (const k of ks) assert.ok(k.length >= 4 && k.length <= 8);
});

/** A fake page: its height grows when grow() is called; input and timers by hand. */
function fakeEnv({ height = 0, viewport = 800 } = {}) {
  const page = { y: 0, height, typing: false, tos: /** @type {number[]} */ ([]) };
  /** @type {Set<() => void>} */ const grows = new Set();
  /** @type {Set<() => void>} */ const inputs = new Set();
  /** @type {Map<() => void, number>} */ const timers = new Map();
  const max = () => Math.max(0, page.height - viewport);
  const env = {
    y: () => page.y,
    to: (/** @type {number} */ y) => { page.y = Math.min(y, max()); page.tos.push(page.y); },
    max,
    onGrow: (/** @type {() => void} */ fn) => { grows.add(fn); return () => grows.delete(fn); },
    onInput: (/** @type {() => void} */ fn) => { inputs.add(fn); return () => inputs.delete(fn); },
    typing: () => page.typing,
    after: (/** @type {() => void} */ fn, /** @type {number} */ ms) => { timers.set(fn, ms); return () => timers.delete(fn); },
  };
  return {
    env, page,
    grow(/** @type {number} */ h) { page.height = h; for (const f of [...grows]) f(); },
    input() { for (const f of [...inputs]) f(); },
    /** the timers of that many ms (400: the still moment, 2500: the limit) @param {number} ms */
    fire(ms) { for (const [f, m] of [...timers]) if (m === ms) f(); },
    get listening() { return grows.size + inputs.size + timers.size; },
  };
}

test('restore: a page tall enough lands at once, and ends after a still moment', async () => {
  const f = fakeEnv({ height: 3000 });
  const p = restore(807, { env: f.env });
  assert.equal(f.page.y, 807);
  f.fire(400);
  assert.equal(await p, 'reached');
  assert.equal(f.listening, 0);
});

test('restore: a view that redraws after it was reached (the page shrinks, the browser clamps) is put back', async () => {
  const f = fakeEnv({ height: 3000 });
  const p = restore(807, { env: f.env });
  assert.equal(f.page.y, 807);
  f.grow(1074);                                 // the list replaced: the browser clamps the scroll to 274
  f.page.y = 274;
  f.grow(3000);                                 // the new list is in
  assert.equal(f.page.y, 807);
  f.fire(400);
  assert.equal(await p, 'reached');
});

test('restore: a view that draws its list later: scrolls as far as it can, then to y once the page is tall enough', async () => {
  const f = fakeEnv({ height: 900 });          // the skeleton: max 100
  const p = restore(807, { env: f.env });
  assert.equal(f.page.y, 100);
  f.grow(1200);                                 // part of the list
  assert.equal(f.page.y, 400);
  f.grow(2400);                                 // the rest
  f.fire(400);
  assert.equal(await p, 'reached');
  assert.equal(f.page.y, 807);
  assert.equal(f.listening, 0, 'stops listening once there');
});

test('restore: the person scrolling or tapping first wins', async () => {
  const f = fakeEnv({ height: 900 });
  const p = restore(807, { env: f.env });
  f.input();
  f.grow(3000);
  assert.equal(await p, 'input');
  assert.equal(f.page.y, 100, 'no jump after the person took over');
  assert.equal(f.listening, 0);
});

test('restore: a text field with the focus (keyboard mode) stops it, so it never fights core/keyboard.js', async () => {
  const f = fakeEnv({ height: 900 });
  const p = restore(807, { env: f.env });
  f.page.typing = true;
  f.grow(3000);
  assert.equal(await p, 'typing');
  assert.equal(f.page.y, 100);
  const g = fakeEnv({ height: 3000 });
  g.page.typing = true;
  assert.equal(await restore(807, { env: g.env }), 'typing');
  assert.equal(g.page.y, 0, 'never scrolls while typing');
});

test('restore: a newer navigation (the signal) and the time limit stop it', async () => {
  const f = fakeEnv({ height: 900 });
  const ctrl = new AbortController();
  const p = restore(807, { env: f.env, signal: ctrl.signal });
  ctrl.abort();
  f.grow(3000);
  assert.equal(await p, 'aborted');
  assert.equal(f.page.y, 100);
  assert.equal(f.listening, 0);

  const ab = new AbortController(); ab.abort();
  const g = fakeEnv({ height: 3000 });
  assert.equal(await restore(807, { env: g.env, signal: ab.signal }), 'aborted');
  assert.equal(g.page.y, 0);

  const h = fakeEnv({ height: 900 });
  const q = restore(807, { env: h.env });
  h.fire(2500);
  assert.equal(await q, 'timeout');
  assert.equal(h.listening, 0);
});

test('budget: at most n in any window; room again once the oldest is out of it', () => {
  let t = 0;
  const may = budget(3, 10_000, () => t);
  assert.deepEqual([may(), may(), may(), may()], [true, true, true, false]);
  t = 9_999;
  assert.equal(may(), false);
  t = 10_000;
  assert.deepEqual([may(), may(), may(), may()], [true, true, true, false]);
});
