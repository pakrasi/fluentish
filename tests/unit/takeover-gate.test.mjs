// The takeover gate (services/sw.js takeoverGate, main.js onMounted; integration a01ed7c, round 8 fix pass code S7):
// a new version takes over only from Today, and only once Today has settled ('today:settled'), with a fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeoverGate } from '../../src/services/sw.js';
import { createBus } from '../../src/core/bus.js';

function rig() {
  const bus = createBus();
  /** @type {boolean[]} */ const rest = [];
  /** @type {Map<number, () => void>} */ const timers = new Map();
  let ids = 0;
  const gate = takeoverGate({ bus, sw: { atRest: v => rest.push(v) }, ms: 10_000,
    later: f => { const id = ++ids; timers.set(id, f); return id; }, cancel: id => { timers.delete(id); } });
  const fire = () => { const fs = [...timers.values()]; timers.clear(); fs.forEach(f => f()); };
  return { bus, rest, gate, fire, timers };
}

test('off Today the window is shut; on Today it opens only when Today settles', () => {
  const { bus, rest, gate } = rig();
  gate('/practice');
  assert.deepEqual(rest, [false]);
  gate('/today');
  assert.deepEqual(rest, [false, false], 'not while Today prepares');
  bus.emit('today:settled');
  assert.deepEqual(rest, [false, false, true]);
  bus.emit('today:settled');
  assert.deepEqual(rest, [false, false, true], 'once');
});

test('the fallback opens it when Today never settles, and is cancelled once it has', () => {
  const r = rig();
  r.gate('/today');
  r.fire();
  assert.deepEqual(r.rest, [false, true]);
  const s = rig();
  s.gate('/today');
  s.bus.emit('today:settled');
  assert.equal(s.timers.size, 0, 'no fallback left behind');
});

test('a settle or a fallback from an earlier mount does nothing; leaving Today cancels the wait', () => {
  const { bus, rest, gate, fire, timers } = rig();
  gate('/today');
  gate('/practice/round');   // left before it settled
  assert.equal(timers.size, 0);
  bus.emit('today:settled');   // the old Today finishing late
  fire();
  assert.deepEqual(rest, [false, false]);
  gate('/today');
  gate('/today');   // mounted again (Today tapped twice): only the newest counts
  bus.emit('today:settled');
  assert.deepEqual(rest, [false, false, false, false, true]);
});
