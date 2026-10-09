// motion.js swap(): two route transitions that overlap. The first one finishing late must not take data-vt off the
// second (which would drop the second to the browser's default crossfade), the first is skipped when the second
// starts, and a skipped transition's rejected `ready` is handled (no unhandled rejection).
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** A fake ViewTransition whose promises the test settles by hand. */
function fakeTransition(update) {
  /** @type {any} */ const t = { skipped: false };
  t.ready = new Promise((res, rej) => { t.readyRes = res; t.readyRej = rej; });
  t.finished = new Promise(res => { t.finish = () => { t.done = true; res(undefined); }; });
  t.updateCallbackDone = Promise.resolve().then(update);
  t.skipTransition = () => {
    t.skipped = true;
    t.readyRej(Object.assign(new Error('Transition was skipped'), { name: 'AbortError' }));
    // like the browser: a skipped transition finishes on a later task, i.e. after the new one has set data-vt
    setTimeout(() => t.finish(), 0);
  };
  return t;
}

/** @type {any[]} */ const started = [];
const dataset = /** @type {Record<string, string>} */ ({});
globalThis.document = /** @type {any} */ ({
  documentElement: { classList: { add() {} }, dataset },
  // like the browser: starting a transition skips the one still running
  startViewTransition(/** @type {() => any} */ update) {
    const prev = started.at(-1);
    if (prev && !prev.done && !prev.skipped) prev.skipTransition();
    const t = fakeTransition(update); started.push(t); return t;
  },
});
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
const { swap } = await import('../../src/core/motion.js');

/** @type {unknown[]} */ const unhandled = [];
process.on('unhandledRejection', e => { unhandled.push(e); });
const tick = () => new Promise(r => setTimeout(r, 5));

test('an older transition finishing late keeps the newer one\'s data-vt', async () => {
  await swap(() => {}, { kind: 'view' });
  const first = started.at(-1);
  assert.equal(dataset.vt, 'view');
  await swap(() => {}, { kind: 'view' });
  const second = started.at(-1);
  assert.ok(first.skipped, 'the first transition is skipped when the second starts');
  first.finish();                      // late, as on a phone: a tap right after arriving
  await tick();
  assert.equal(dataset.vt, 'view', 'the second transition still has its data-vt');
  second.finish();
  await tick();
  assert.equal(dataset.vt, undefined, 'the newest transition clears data-vt when it ends');
});

test('a card swap started during a route transition keeps its own kind', async () => {
  await swap(() => {}, { kind: 'view' });
  const view = started.at(-1);
  await swap(() => {}, { kind: 'forward' });
  const card = started.at(-1);
  view.finish();
  await tick();
  assert.equal(dataset.vt, 'forward');
  card.finish();
  await tick();
  assert.equal(dataset.vt, undefined);
});

test('a skipped transition leaves no unhandled rejection', async () => {
  await swap(() => {}, { kind: 'view' });
  await swap(() => {}, { kind: 'view' });
  started.at(-1).finish();
  await tick(); await tick();
  assert.deepEqual(unhandled, []);
});
