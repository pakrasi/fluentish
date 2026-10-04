// The exam clock (src/features/exam/timer.js) and the feedback Markdown parser (src/features/exam/md.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../src/features/exam/timer.js';
import { parse, inline } from '../../src/features/exam/md.js';

const M = 60e3;

test('clock: pauses do not count; leaving and coming back within a minute keeps running', () => {
  let c = T.begin(0);
  c = T.tick(c, 10 * M);
  assert.equal(T.elapsed(c, 10 * M), 10 * M);
  c = T.pause(c, 10 * M);
  assert.equal(T.paused(c), true);
  assert.equal(T.elapsed(c, 25 * M), 10 * M, 'paused for 15 minutes');
  c = T.resume(c, 25 * M);
  assert.equal(T.elapsed(c, 30 * M), 15 * M);
  assert.equal(T.left(c, 30 * M, 65), 50 * M);
  assert.deepEqual(T.pauses(c, 30 * M), { count: 1, seconds: 900 });
  c = T.tick(c, 30 * M);
  assert.equal(T.reopen(c, 30 * M + 30e3), c, 'a 30 s gap is not a pause');
});

test('clock: a page closed without pausing counts the gap as a pause', () => {
  let c = T.tick(T.begin(0), 20 * M);
  c = T.reopen(c, 8 * 60 * M);                  // came back 8 hours later
  assert.equal(T.paused(c), true);
  assert.equal(c.pause.auto, true);
  assert.equal(T.elapsed(c, 8 * 60 * M), 20 * M);
  c = T.resume(c, 8 * 60 * M);
  assert.equal(c.pause.auto, undefined);
  assert.equal(T.elapsed(c, 8 * 60 * M + M), 21 * M);
});

test('clock: stale after 3 hours; continue keeps the clock, the gap is a pause', () => {
  const c = T.tick(T.begin(0), 30 * M);
  assert.equal(T.stale(c, 30 * M + 2 * 60 * M), false);
  assert.equal(T.stale(c, 30 * M + 4 * 60 * M), true);
  const k = T.continueStale(c, 30 * M + 4 * 60 * M, 65);
  assert.equal(T.paused(k), false);
  assert.equal(T.elapsed(k, 30 * M + 4 * 60 * M), 30 * M);
  // an old clock without a last tick is capped at the module time
  const old = T.normalize({ start: 0 });
  assert.equal(T.elapsed(T.continueStale(old, 10 * 60 * M, 65), 10 * 60 * M), 65 * M);
  assert.equal(T.normalize(null), null);
  assert.equal(T.fmt(65 * 60), '65:00'); assert.equal(T.fmt(-125), '2:05');
});

test('feedback markdown: blocks, inline marks, correction blocks, and text stays text', () => {
  const b = parse('! circa 58 / 100 · knapp unter 60\nGesamteindruck **gut**.\n## Aufgabe 1\n~~weil ich habe~~ → ==weil ich … habe==\n_Verb am Ende._\n- **Wortstellung:** Satz\n- zwei\n→ Gut: Anrede\n> Zitat');
  assert.deepEqual(b.map(x => x.k), ['score', 'p', 'h3', 'corr', 'ul', 'tip', 'quote']);
  assert.equal(b[0].tone, 'bad');
  assert.equal(b[3].lines.length, 2);
  assert.equal(b[4].items.length, 2);
  assert.deepEqual(inline('a **b** ~~c~~ ==d== !!e!! _f_'), [
    { t: 'text', v: 'a ' }, { t: 'b', v: 'b' }, { t: 'text', v: ' ' }, { t: 'del', v: 'c' }, { t: 'text', v: ' ' }, { t: 'mark', v: 'd' },
    { t: 'text', v: ' ' }, { t: 'bad', v: 'e' }, { t: 'text', v: ' ' }, { t: 'em', v: 'f' },
  ]);
  assert.deepEqual(inline('<img src=x onerror=alert(1)>'), [{ t: 'text', v: '<img src=x onerror=alert(1)>' }]);
  assert.deepEqual(inline('snake_case_word'), [{ t: 'text', v: 'snake_case_word' }]);
});
