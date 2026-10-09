// motion.js primitives of round 8 (design A13), in node with fake timers and a small fake DOM:
//   sequence(): the position parameter, order, finish() (Enter to skip), cancel and the view's signal (unmount), the
//               reduced-motion path, a throwing step;
//   pulse():    the attribute on and off, animationend, the fallback timer, a restart, the signal, no animation;
//   odometer({from}): the columns stand at `from` before they roll, digits from the right, reduced motion.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const dataset = /** @type {Record<string, string>} */ ({});
/** Just enough of an element for pulse() and odometer(). */
class FakeEl {
  constructor(tag = 'span') {
    this.tag = tag;
    /** @type {FakeEl[]} */ this.children = [];
    /** @type {Record<string, string>} */ this.dataset = {};
    /** @type {Record<string, string>} */ this.attrs = {};
    /** @type {Record<string, any>} */ this.style = { transition: '', transform: '', setProperty(/** @type {string} */ k, /** @type {string} */ v) { this[k] = v; } };
    this.cls = new Set();
    this.classList = { add: (/** @type {string} */ c) => this.cls.add(c), contains: (/** @type {string} */ c) => this.cls.has(c) };
    /** @type {Map<string, Set<Function>>} */ this.on = new Map();
    this.reflows = 0;
    this.text = '';
  }
  set className(v) { this.cls = new Set(String(v).split(' ').filter(Boolean)); }
  get className() { return [...this.cls].join(' '); }
  set textContent(v) { this.children = []; this.text = String(v); }
  get textContent() { return this.text; }
  get offsetWidth() { this.reflows++; return 100; }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = v; }
  /** @param {...FakeEl} c */ append(...c) { this.children.push(...c); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { if (!this.on.has(t)) this.on.set(t, new Set()); this.on.get(t)?.add(f); }
  removeEventListener(/** @type {string} */ t, /** @type {Function} */ f) { this.on.get(t)?.delete(f); }
  /** @param {string} t @param {Record<string, any>} e */ fire(t, e) { for (const f of [...(this.on.get(t) || [])]) f({ target: this, ...e }); }
}
/** @type {Function[]} */ let frames = [];
const flushFrames = () => { for (let k = 0; k < 4; k++) { const f = frames; frames = []; f.forEach(x => x(0)); } };
globalThis.document = /** @type {any} */ ({ documentElement: { classList: { add() {} }, dataset }, createElement: (/** @type {string} */ t) => new FakeEl(t) });
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
globalThis.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ f) => { frames.push(f); return frames.length; });
/** The pulse's computed animation: what styles/ui.css gives [data-pulse] here. @type {Record<string, string>} */
const pulseStyle = { animationName: 'pulse-locus', animationDuration: '1.44s', animationDelay: '0s', animationIterationCount: '1' };
globalThis.getComputedStyle = /** @type {any} */ ((/** @type {FakeEl} */ el) => (el.dataset?.pulse
  ? pulseStyle : { animationName: 'none', animationDuration: '0s', animationDelay: '0s', animationIterationCount: '1', getPropertyValue: () => '' }));
const { sequence, seqTimes, pulse, odometer } = await import('../../src/core/motion.js');

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

test('pulse(): on until its animation ends, then off; other animations do not end it', async () => {
  const el = new FakeEl();
  let over = false;
  const p = pulse(/** @type {any} */ (el), 'locus').then(() => { over = true; });
  assert.equal(el.dataset.pulse, 'locus');
  el.fire('animationend', { animationName: 'nudge' });
  el.fire('animationend', { animationName: 'pulse-locus', target: new FakeEl() });   // a child's animation bubbling up
  await Promise.resolve();
  assert.equal(over, false);
  assert.equal(el.dataset.pulse, 'locus');
  el.fire('animationend', { animationName: 'pulse-locus' });
  await p;
  assert.equal(el.dataset.pulse, undefined);
  assert.equal(el.on.get('animationend')?.size, 0, 'the listener is gone');
});

test('pulse(): the fallback timer ends it when animationend never comes; the same pulse again restarts it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const el = new FakeEl();
    let first = false;
    pulse(/** @type {any} */ (el), 'locus').then(() => { first = true; });
    const reflows = el.reflows;
    const second = pulse(/** @type {any} */ (el), 'locus');
    await Promise.resolve();
    assert.equal(first, true, 'a new pulse ends the running one');
    assert.ok(el.reflows > reflows, 'the attribute comes off with a reflow in between, so the animation restarts');
    assert.equal(el.dataset.pulse, 'locus');
    mock.timers.tick(1539);
    assert.equal(el.dataset.pulse, 'locus');
    mock.timers.tick(1);
    await second;
    assert.equal(el.dataset.pulse, undefined);
  } finally { mock.timers.reset(); }
});

test('pulse(): the signal ends it; a style with no animation (or no element) ends at once', async () => {
  const el = new FakeEl();
  const ac = new AbortController();
  const p = pulse(/** @type {any} */ (el), 'look', { signal: ac.signal });
  assert.equal(el.dataset.pulse, 'look');
  ac.abort();
  await p;
  assert.equal(el.dataset.pulse, undefined);
  await pulse(/** @type {any} */ (el), 'look', { signal: AbortSignal.abort() });
  assert.equal(el.dataset.pulse, undefined, 'an aborted signal sets nothing');
  const keep = pulseStyle.animationName;
  pulseStyle.animationName = 'none';
  try {
    await pulse(/** @type {any} */ (el), 'look');
    assert.equal(el.dataset.pulse, undefined);
  } finally { pulseStyle.animationName = keep; }
  await pulse(null, 'look');
});

/** The columns' transforms. @param {FakeEl} el */
const cols = el => el.children.filter(c => c.classList.contains('odo-col')).map(c => c.style.transform);

test('odometer({from}): the columns stand at from, then roll to the value; digits line up from the right', () => {
  const el = new FakeEl();
  odometer(/** @type {any} */ (el), 41, { from: 42, label: '41 days' });
  assert.deepEqual(cols(el), ['translateY(-4em)', 'translateY(-2em)'], 'at from before the roll');
  assert.ok(el.reflows >= 1, 'a reflow sets from before the transition comes back');
  assert.ok(el.children.every(c => c.style.transition === ''), 'the transition is back for the roll');
  assert.equal(el.attrs['aria-label'], '41 days');
  flushFrames();
  assert.deepEqual(cols(el), ['translateY(-4em)', 'translateY(-1em)']);

  const ten = new FakeEl();
  odometer(/** @type {any} */ (ten), 10, { from: 9 });
  assert.deepEqual(cols(ten), ['translateY(0em)', 'translateY(-9em)'], 'a column from has no digit for starts at 0');
  flushFrames();
  assert.deepEqual(cols(ten), ['translateY(-1em)', 'translateY(0em)']);

  const nine = new FakeEl();
  odometer(/** @type {any} */ (nine), 9, { from: 10 });
  assert.deepEqual(cols(nine), ['translateY(0em)']);
  flushFrames();
  assert.deepEqual(cols(nine), ['translateY(-9em)']);
});

test('odometer(): without from it rolls from where the columns are; reduced motion writes the value at once', () => {
  const el = new FakeEl();
  odometer(/** @type {any} */ (el), 7);
  assert.deepEqual(cols(el), ['translateY(0)'], 'a new column starts at 0');
  flushFrames();
  assert.deepEqual(cols(el), ['translateY(-7em)']);
  odometer(/** @type {any} */ (el), 3);
  assert.deepEqual(cols(el), ['translateY(-7em)'], 'an existing column rolls from where it is');
  flushFrames();
  assert.deepEqual(cols(el), ['translateY(-3em)']);

  dataset.motion = 'reduce';
  try {
    const r = new FakeEl();
    odometer(/** @type {any} */ (r), 12, { from: 13 });
    assert.deepEqual(cols(r), ['translateY(-1em)', 'translateY(-2em)']);
    assert.ok(r.children.every(c => c.style.transition === 'none'));
    assert.equal(frames.length, 0, 'nothing waits for a frame');
  } finally { delete dataset.motion; }
});
