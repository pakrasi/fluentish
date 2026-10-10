// ui/toast.js (round 8, design C §9, F8): the queue in node with a fake clock (one visible, replace after MIN_SHOW,
// dedupe, the timing, pause and resume, close), and the swipe rule. The DOM part runs in tests/e2e/toast.spec.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// core/motion.js (imported by ui/toast.js) reads <html> and the motion query when it loads
globalThis.document = /** @type {any} */ ({ documentElement: { classList: { add() {} }, dataset: {} } });
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
const { createToastQueue, swipeOut, toastMs, MIN_SHOW, MAX_PENDING, TOAST_MS, TOAST_ACTION_MS, SWIPE_PX } = await import('../../src/ui/toast.js');

/** A fake clock and the queue's drawing, recorded. */
function rig() {
  let t = 0, ids = 0;
  /** @type {Map<number, {at: number, f: () => void}>} */ const timers = new Map();
  /** @type {string[]} */ const log = [];
  const q = createToastQueue({
    now: () => t,
    setTimer: (f, ms) => { const id = ++ids; timers.set(id, { at: t + ms, f }); return id; },
    clearTimer: id => { timers.delete(id); },
    show: it => log.push(`show ${it.text}`),
    hide: (it, how) => log.push(`hide ${it.text} ${how}`),
  });
  /** Move the clock on, firing due timers in time order. @param {number} ms */
  const tick = ms => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); t = due[1].at; due[1].f();
    }
    t = end;
  };
  return { q, log, tick, visible: () => q.state().shown?.text ?? null };
}

test('toastMs: 4 s, 6 s with an action, the caller\'s ms wins', () => {
  assert.equal(toastMs(), TOAST_MS);
  assert.equal(toastMs({ action: 'Undo' }), TOAST_ACTION_MS);
  assert.equal(toastMs({ ms: 10000 }), 10000);
  assert.equal(toastMs({ ms: 0, action: 'Undo' }), TOAST_ACTION_MS, 'a zero or bad ms falls back');
});

test('one visible: it closes itself after its time', () => {
  const { q, log, tick, visible } = rig();
  q.push('Saved.');
  assert.equal(visible(), 'Saved.');
  tick(TOAST_MS - 1);
  assert.equal(visible(), 'Saved.');
  tick(1);
  assert.equal(visible(), null);
  assert.deepEqual(log, ['show Saved.', 'hide Saved. timeout']);
});

test('a second toast waits until the first has had MIN_SHOW, then replaces it (never two at once)', () => {
  const { q, log, tick, visible } = rig();
  q.push('Marked as known.', { action: 'Undo' });
  tick(300);
  q.push('Saved.');
  assert.equal(visible(), 'Marked as known.');
  assert.equal(q.state().waiting, 1);
  tick(MIN_SHOW - 300);
  assert.equal(visible(), 'Saved.');
  assert.deepEqual(log, ['show Marked as known.', 'hide Marked as known. replace', 'show Saved.']);
  // once the first has been up long enough, the next replaces it at once
  tick(2000);
  q.push('Back to new.');
  assert.equal(visible(), 'Back to new.');
});

test('Undo, then Undone: the action closes its toast and the next shows at once, alone', () => {
  const { q, log, tick, visible } = rig();
  /** @type {() => void} */ let close = () => {};
  close = q.push('Marked as known.', { action: 'Undo' });
  tick(200);
  // what the pill does on a tap of Undo: onAction (which toasts again), then close
  q.push('Back to new.');
  close();
  assert.equal(visible(), 'Back to new.');
  assert.deepEqual(log, ['show Marked as known.', 'hide Marked as known. close', 'show Back to new.']);
});

test('dedupe: the same text restarts the visible one, no second pill; a waiting duplicate is not queued twice', () => {
  const { q, log, tick, visible } = rig();
  q.push('Saved.');
  tick(3000);
  q.push('Saved.');
  tick(3000);
  assert.equal(visible(), 'Saved.', 'the timer restarted at 3 s');
  tick(1000);
  assert.equal(visible(), null);
  assert.deepEqual(log, ['show Saved.', 'hide Saved. timeout']);
  q.push('A'); q.push('B'); q.push('B');
  assert.equal(q.state().waiting, 1);
  // the same text with another action is another toast
  q.push('A', { action: 'Undo' });
  assert.equal(q.state().waiting, 2);
});

test('at most MAX_PENDING wait; the oldest waiting is dropped', () => {
  const { q, tick, visible } = rig();
  q.push('first');
  for (const s of ['a', 'b', 'c', 'd', 'e']) q.push(s);
  assert.equal(q.state().waiting, MAX_PENDING);
  const seen = [];
  for (let k = 0; k < 5; k++) { tick(MIN_SHOW); seen.push(visible()); }
  assert.deepEqual(seen.slice(0, 3), ['c', 'd', 'e']);
});

test('pause (hover, focus, a drag) holds the clock and holds back the next; resume runs what was left', () => {
  const { q, tick, visible } = rig();
  q.push('Marked as known.', { action: 'Undo' });
  const id = /** @type {any} */ (q.state().shown).id;
  tick(2000);
  q.pause(id);
  q.push('Saved.');
  tick(20000);
  assert.equal(visible(), 'Marked as known.', 'paused: neither its time nor the next toast moves it');
  q.resume(id);
  assert.equal(visible(), 'Saved.', 'it has had MIN_SHOW: the waiting one replaces it now');
  const { q: q2, tick: tick2, visible: vis2 } = rig();
  q2.push('x', { action: 'Undo' });
  const id2 = /** @type {any} */ (q2.state().shown).id;
  tick2(5500); q2.pause(id2); tick2(9999); q2.resume(id2);
  tick2(999);
  assert.equal(vis2(), 'x', 'at least a second after resume');
  tick2(1);
  assert.equal(vis2(), null);
});

test('close: a visible one goes and the next shows; a waiting one is dropped; twice is harmless', () => {
  const { q, log, visible } = rig();
  const c1 = q.push('one');
  const c2 = q.push('two');
  const c3 = q.push('three');
  c2();
  c1();
  assert.equal(visible(), 'three');
  c1(); c2();
  assert.equal(visible(), 'three');
  assert.deepEqual(log, ['show one', 'hide one close', 'show three']);
});

test('swipeOut: down or sideways past 40 px or fast; up and short drags spring back', () => {
  assert.equal(swipeOut(0, SWIPE_PX + 1, 400), 'down');
  assert.equal(swipeOut(-(SWIPE_PX + 1), 5, 400), 'left');
  assert.equal(swipeOut(SWIPE_PX + 1, 5, 400), 'right');
  assert.equal(swipeOut(20, 4, 400), null, 'slow and short');
  assert.equal(swipeOut(30, 0, 40), 'right', 'a flick: 0.75 px/ms');
  assert.equal(swipeOut(4, 3, 1), null, 'a tap that wobbled');
  assert.equal(swipeOut(0, -120, 100), null, 'never upward');
});

// Round 8 fix pass (code review S5, design review S4)
test('the same text again is spoken again (again()), and a signal closes its toast, visible or waiting', () => {
  let t = 0;
  /** @type {string[]} */ const log = [];
  const q = createToastQueue({
    now: () => t, setTimer: () => 0, clearTimer: () => {},
    show: it => log.push(`show ${it.text}`), hide: (it, how) => log.push(`hide ${it.text} ${how}`), again: it => log.push(`again ${it.text}`),
  });
  q.push('Saved.');
  q.push('Saved.');
  assert.deepEqual(log, ['show Saved.', 'again Saved.']);
  const ac = new AbortController();
  q.push('Marked as known.', { action: 'Undo', signal: ac.signal });
  assert.equal(q.state().waiting, 1);
  ac.abort();   // the page is left before it shows
  assert.equal(q.state().waiting, 0);
  q.clear(); log.length = 0;
  const ac2 = new AbortController();
  q.push('Marked as known.', { action: 'Undo', signal: ac2.signal });
  ac2.abort();
  assert.deepEqual(log, ['show Marked as known.', 'hide Marked as known. close']);
  // an aborted signal: nothing shows
  q.push('Late.', { signal: ac2.signal });
  assert.equal(q.state().shown, null);
});
