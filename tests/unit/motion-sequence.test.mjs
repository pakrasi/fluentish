// motion.js choreography (round 8, design A13): sequence() with fake timers: the position parameter, order, finish()
// (Enter to skip), cancel and the view's signal (unmount), the reduced-motion path, a throwing step.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const dataset = /** @type {Record<string, string>} */ ({});
globalThis.document = /** @type {any} */ ({ documentElement: { classList: { add() {} }, dataset } });
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
const { sequence, seqTimes } = await import('../../src/core/motion.js');

/** A recorder: steps that write `name` or `name!` (instant) into log. @param {string[]} log */
const rec = log => (/** @type {string} */ name) => (/** @type {boolean} */ instant) => { log.push(instant ? `${name}!` : name); };
/** A fake Animation that records finish(). */
const fakeAnim = () => ({ finished: false, finish() { this.finished = true; } });

test('seqTimes: absolute, <, >, +=n, -=n and the default', () => {
  assert.deepEqual(seqTimes([{ at: 0, dur: 300 }, { at: '<' }, { at: '>' }]), [0, 0, 0], "'>' after a step with no dur is its start");
  assert.deepEqual(seqTimes([{ at: 0, dur: 300 }, { at: '>' }, { dur: 100 }, { at: '<' }]), [0, 300, 300, 300]);
  assert.deepEqual(seqTimes([{ at: 120, dur: 640 }, { at: '<' }, { at: 500 }, { at: '+=90', dur: 10 }, { at: '-=50' }]), [120, 120, 500, 590, 550]);
  assert.deepEqual(seqTimes([{ at: '-=40' }]), [0], 'never before the start');
  assert.deepEqual(seqTimes([]), []);
  assert.throws(() => seqTimes([{ at: /** @type {any} */ ('soon') }]), TypeError);
  assert.throws(() => seqTimes([{ at: /** @type {any} */ (NaN) }]), TypeError);
});

test('steps run at their times, in order; steps at 0 run inside the call; done resolves true', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    /** @type {string[]} */ const log = [];
    const s = rec(log);
    const seq = sequence([
      { at: 0, dur: 300, run: s('swap') }, { at: '<', run: s('bars') }, { at: 120, run: s('odometer') },
      { at: '<', run: s('breathe') }, { at: 500, run: s('ripple') }, { at: '+=90', run: s('ripple2') },
    ]);
    assert.deepEqual(log, ['swap', 'bars']);
    mock.timers.tick(119); assert.deepEqual(log, ['swap', 'bars']);
    mock.timers.tick(1); assert.deepEqual(log, ['swap', 'bars', 'odometer', 'breathe']);
    mock.timers.tick(380); assert.deepEqual(log.slice(4), ['ripple']);
    mock.timers.tick(90); assert.deepEqual(log.slice(4), ['ripple', 'ripple2']);
    assert.equal(await seq.done, true);
    seq.finish(); seq.cancel();
    assert.equal(log.length, 6, 'finish and cancel do nothing once the sequence is over');
  } finally { mock.timers.reset(); }
});

test('finish(): the rest runs at once with instant = true, in time order, and handed-back animations jump to the end', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    /** @type {string[]} */ const log = [];
    const s = rec(log);
    const a = fakeAnim(), b = fakeAnim();
    const seq = sequence([
      { at: 0, run: i => { s('a')(i); return /** @type {any} */ (a); } },
      { at: 400, run: s('late') },
      { at: 200, run: i => { s('mid')(i); return /** @type {any} */ ([b, null]); } },
    ]);
    mock.timers.tick(100);
    seq.finish();
    assert.deepEqual(log, ['a', 'mid!', 'late!']);
    assert.ok(a.finished && b.finished);
    assert.equal(await seq.done, true);
    mock.timers.tick(1000);
    assert.equal(log.length, 3, 'no timer fires after finish()');
    seq.finish();
    assert.equal(log.length, 3, 'finish() twice runs nothing twice');
  } finally { mock.timers.reset(); }
});

test('cancel() and an aborted signal stop what is still to come; done resolves false', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    /** @type {string[]} */ const log = [];
    const s = rec(log);
    const steps = [{ at: 0, run: s('now') }, { at: 100, run: s('later') }, { at: 200, run: s('last') }];
    const seq = sequence(steps);
    mock.timers.tick(150);
    seq.cancel();
    mock.timers.tick(500);
    assert.deepEqual(log, ['now', 'later']);
    assert.equal(await seq.done, false);

    log.length = 0;
    const ac = new AbortController();
    const viewSeq = sequence(steps, { signal: ac.signal });
    ac.abort();                          // the view unmounts
    mock.timers.tick(500);
    assert.deepEqual(log, ['now']);
    assert.equal(await viewSeq.done, false);
    viewSeq.finish();
    assert.deepEqual(log, ['now'], 'finish() after a cancel runs nothing');

    log.length = 0;
    const gone = sequence(steps, { signal: AbortSignal.abort() });
    mock.timers.tick(500);
    assert.deepEqual(log, [], 'an already aborted signal runs no step');
    assert.equal(await gone.done, false);

    // a step at 0 that aborts the signal (it navigates away) stops the rest
    log.length = 0;
    const ac2 = new AbortController();
    sequence([{ at: 0, run: () => ac2.abort() }, { at: 0, run: s('same') }, { at: 50, run: s('after') }], { signal: ac2.signal });
    mock.timers.tick(500);
    assert.deepEqual(log, []);
  } finally { mock.timers.reset(); }
});

test('reduced motion: every step runs at once with instant = true, in time order', async () => {
  dataset.motion = 'reduce';
  try {
    /** @type {string[]} */ const log = [];
    const s = rec(log);
    const seq = sequence([{ at: 300, run: s('c') }, { at: 0, run: s('a') }, { at: '<', run: s('b') }, { at: 0, run: s('a2') }]);
    assert.deepEqual(log, ['a!', 'b!', 'a2!', 'c!']);
    assert.equal(await seq.done, true);
  } finally { delete dataset.motion; }
});

test('a step that throws is logged and the others still run; an empty sequence is done at once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const quiet = mock.method(console, 'error', () => {});
  try {
    /** @type {string[]} */ const log = [];
    const s = rec(log);
    const seq = sequence([{ at: 0, run: () => { throw new Error('boom'); } }, { at: 10, run: s('next') }]);
    mock.timers.tick(10);
    assert.deepEqual(log, ['next']);
    assert.equal(await seq.done, true);
    assert.equal(quiet.mock.callCount(), 1);
    assert.equal(await sequence([]).done, true);
  } finally { quiet.mock.restore(); mock.timers.reset(); }
});
