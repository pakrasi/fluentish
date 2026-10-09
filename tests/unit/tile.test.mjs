// src/ui/tile.js flipTo() (design C §5, finding F6), in node with a fake element whose animations finish when the test
// says so: the new state is set at the midpoint (after the turn away, before the turn back), the turn back starts
// edge-on, a flip cut short by finishAll() ends at once with the state set, flipAll staggers, reduced motion swaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const dataset = /** @type {Record<string, string>} */ ({});
globalThis.document = /** @type {any} */ ({
  documentElement: { classList: { add() {} }, dataset },
  // waapiTakes() probes an easing on a fresh element: every easing is taken here
  createElement: () => ({ animate: () => ({ cancel() {} }) }),
});
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
globalThis.getComputedStyle = /** @type {any} */ (() => ({ getPropertyValue: () => '' }));
globalThis.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ f) => setTimeout(f, 0));

/** A fake Animation: finished when the test calls end() (or finish(), what finishAll() calls). */
class FakeAnim {
  /** @param {Keyframe[]} frames @param {any} opts @param {string[]} log */
  constructor(frames, opts, log) {
    this.frames = frames; this.opts = opts; this.log = log;
    /** @type {(v?: any) => void} */ let res = () => {};
    this.finished = new Promise(r => { res = r; });
    this.done = res;
    this.state = 'running';
  }
  end() { this.state = 'finished'; this.log.push(`end ${this.frames.map(f => f.transform ?? `o${f.opacity}`).join(' > ')}`); this.done(this); }
  finish() { this.end(); }
  cancel() { this.state = 'idle'; this.done(this); }
}
class FakeEl {
  constructor() { /** @type {string[]} */ this.log = []; /** @type {FakeAnim[]} */ this.anims = []; }
  /** @param {Keyframe[]} frames @param {any} opts */
  animate(frames, opts) {
    const a = new FakeAnim(frames, opts, this.log);
    this.anims.push(a);
    this.log.push(`start ${frames.map(f => f.transform ?? `o${f.opacity}`).join(' > ')}`);
    return a;
  }
}
const tick = () => new Promise(r => setTimeout(r, 0));
let clock = 0;
globalThis.performance = /** @type {any} */ ({ now: () => clock });

const { flipTo, flipAll, FLIP_OUT } = await import('../../src/ui/tile.js');
const { finishAll } = await import('../../src/core/motion.js');

test('flipTo: the state is set at the midpoint, between the turn away and the turn back', async () => {
  dataset.motion = 'full';
  const el = new FakeEl();
  clock = 0;
  const done = flipTo(/** @type {any} */ (el), () => el.log.push('APPLY'), { delay: 110 });
  await tick();
  assert.deepEqual(el.log, ['start perspective(600px) rotateX(0deg) > perspective(600px) rotateX(90deg)']);
  assert.equal(el.anims[0].opts.delay, 110);
  assert.equal(el.anims[0].opts.duration, FLIP_OUT);
  clock = 110 + FLIP_OUT;   // the first half ran its course
  el.anims[0].end();
  await tick();
  assert.deepEqual(el.log.slice(1), ['end perspective(600px) rotateX(0deg) > perspective(600px) rotateX(90deg)', 'APPLY',
    'start perspective(600px) rotateX(-90deg) > perspective(600px) rotateX(0deg)'], 'apply() before the turn back, which starts edge-on');
  el.anims[1].end();
  await done;
  assert.equal(el.log.filter(x => x === 'APPLY').length, 1);
});

test('flipTo: cut short by finishAll() (a new tap), the state is set and nothing turns back', async () => {
  dataset.motion = 'full';
  const el = new FakeEl();
  clock = 0;
  const done = flipTo(/** @type {any} */ (el), () => el.log.push('APPLY'));
  await tick();
  clock = 40;
  finishAll();
  await done;
  assert.deepEqual(el.log.slice(-1), ['APPLY']);
  assert.equal(el.anims.length, 1, 'no second half');
});

test('flipAll: one after another, stagger apart; every state set', async () => {
  dataset.motion = 'full';
  const els = [new FakeEl(), new FakeEl(), new FakeEl()];
  /** @type {number[]} */ const applied = [];
  clock = 0;
  const done = flipAll(els.map((el, i) => ({ el: /** @type {any} */ (el), apply: () => applied.push(i) })), { stagger: 110 });
  await tick();
  assert.deepEqual(els.map(e => e.anims[0].opts.delay), [0, 110, 220]);
  clock = 1000;
  for (const e of els) e.anims[0].end();
  await tick();
  for (const e of els) e.anims[1].end();
  await done;
  assert.deepEqual(applied, [0, 1, 2]);
});

test('flipTo under reduced motion: the state at once and a short crossfade, no turn', async () => {
  dataset.motion = 'reduce';
  const el = new FakeEl();
  let set = false;
  await flipTo(/** @type {any} */ (el), () => { set = true; });
  assert.equal(set, true);
  assert.deepEqual(el.log, ['start o0.4 > o1']);
  assert.equal(el.anims[0].opts.duration, 140);
  dataset.motion = 'full';
});
