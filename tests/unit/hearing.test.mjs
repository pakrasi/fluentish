// How far a recogniser's result can be trusted, and the mic level (domain/hearing.js). All data synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../../src/domain/hearing.js';

test('level: RMS, dBFS with a floor, and the meter scale', () => {
  assert.equal(H.rms([]), 0);
  assert.equal(H.rms([0.5, -0.5, 0.5, -0.5]), 0.5);
  assert.equal(Math.round(H.toDb(0.5)), -6);
  assert.equal(H.toDb(0), -100);
  assert.equal(H.meter(-100), 0);
  assert.equal(H.meter(-10), 1);
  assert.ok(H.meter(-40) > 0.4 && H.meter(-40) < 0.6);
});

test('noise check: a quiet room, a street, wind gusts, and no verdict without frames', () => {
  const quiet = H.ambient(Array(20).fill(-62));
  assert.deepEqual([quiet.loud, quiet.gusty, quiet.noisy], [false, false, false]);
  const street = H.ambient(Array.from({ length: 20 }, (_, i) => -38 + (i % 3)));
  assert.equal(street.loud, true); assert.equal(street.noisy, true);
  // mostly quiet with bursts: wind on the mic
  const wind = H.ambient([...Array(16).fill(-55), -22, -20, -18, -21]);
  assert.equal(wind.loud, false); assert.equal(wind.gusty, true); assert.equal(wind.noisy, true);
  // the edges of the thresholds
  assert.equal(H.ambient(Array(10).fill(H.NOISE.loudDb)).loud, true);
  assert.equal(H.ambient(Array(10).fill(H.NOISE.loudDb - 1)).loud, false);
  assert.equal(H.ambient([-60, -60]), null, 'too few frames');
  assert.equal(H.ambient([-60, NaN, -60, -60, -60, -60]).db, -60, 'non-numbers are dropped');
  assert.equal(H.floor([-30, -60, -58, -31, -29, -59, -28, -27, -26, -25]), -58);
});

test('restart: a tap retries a session that ended with nothing, hold keeps listening, refusals never restart', () => {
  const base = { stopped: false, error: null, text: '', restarts: 0, elapsedMs: 800 };
  assert.equal(H.shouldRestart(base), true, 'ended early with nothing heard');
  assert.equal(H.shouldRestart({ ...base, error: 'no-speech' }), true);
  assert.equal(H.shouldRestart({ ...base, text: 'ich glaube' }), false, 'a tap ends with what it heard');
  assert.equal(H.shouldRestart({ ...base, stopped: true }), false, 'he tapped stop');
  assert.equal(H.shouldRestart({ ...base, restarts: H.RESTART.tap }), false, 'a few times only');
  assert.equal(H.shouldRestart({ ...base, elapsedMs: H.RESTART.windowMs }), false, 'inside the window only');
  for (const e of ['not-allowed', 'service-not-allowed', 'audio-capture']) assert.equal(H.shouldRestart({ ...base, error: e }), false, e);
  assert.equal(H.shouldRestart({ ...base, hold: true, text: 'ich glaube', elapsedMs: 30000 }), true, 'hold: until he lets go');
  assert.equal(H.shouldRestart({ ...base, hold: true, restarts: H.RESTART.hold }), false);
});

test('alternatives: the best guess first, then each result with another alternative swapped in', () => {
  const a = (text, confidence = 0.8) => ({ text, confidence });
  const c = H.candidates([{ alts: [a('ich habe Angst'), a('ich hab Angst', 0.4)] }, { alts: [a('für der Prüfung'), a('vor der Prüfung', 0.3)] }]);
  assert.deepEqual(c.map(x => x.text), ['ich habe Angst für der Prüfung', 'ich hab Angst für der Prüfung', 'ich habe Angst vor der Prüfung']);
  assert.equal(c[0].confidence, 0.8); assert.equal(c[2].confidence, 0.3, 'the weakest part');
  assert.equal(H.candidates([{ alts: [{ text: 'hallo', confidence: null }] }])[0].confidence, null);
  assert.deepEqual(H.candidates([]), []);
  assert.equal(H.candidates([{ alts: Array.from({ length: 30 }, (_, i) => a(`w${i}`)) }]).length, 12, 'capped');
  // the scorer sees every candidate; the highest wins, ties keep the order
  const seen = [];
  const b = H.best(c, t => { seen.push(t); return { score: /vor/.test(t) ? 2 : 0, value: t.length }; });
  assert.equal(seen.length, 3);
  assert.equal(b.index, 2); assert.equal(b.alt.text, 'ich habe Angst vor der Prüfung'); assert.equal(b.value, 30);
  assert.equal(H.best(c, () => ({ score: 1, value: 0 })).index, 0);
  assert.equal(H.best([], () => ({ score: 1, value: 0 })), null);
});

test('trust: low confidence, garbled text and a loud room make a result unsure; a clean wrong answer stays gradable', () => {
  const expected = 'Wie wäre es mit Donnerstag um drei?';
  assert.deepEqual(H.trust({ text: 'wie wäre es mit Donnerstag um drei', confidence: 0.9, expected }), { unsure: false, why: [] });
  assert.deepEqual(H.trust({ text: 'wie wäre es mit Donnerstag', confidence: 0.3, expected }).why, ['confidence']);
  assert.equal(H.trust({ text: 'x', confidence: 0, expected }).unsure, true, 'one letter is garbled; confidence 0 is "not given"');
  assert.equal(H.trust({ text: 'ja', expected }).why.includes('garbled'), true, 'a word where a sentence was expected');
  assert.equal(H.trust({ text: 'a b c d', expected }).why.includes('garbled'), true);
  assert.equal(H.trust({ text: 'ich habe keine Zeit morgen leider', confidence: 0.9, expected }).unsure, false, 'quiet, confident and wrong: gradable');
  const loud = H.ambient(Array(10).fill(-35));
  assert.deepEqual(H.trust({ text: 'ich habe keine Zeit morgen leider', confidence: 0.9, expected, ambient: loud }).why, ['noise']);
  assert.equal(H.trust({ text: 'wie wäre es mit Donnerstag um drei', confidence: 0.9, expected, ambient: loud }).unsure, false, 'heard right in the noise');
  assert.deepEqual(H.trust({ text: 'ich habe keine Zeit morgen', expected, restarts: 1 }).why, ['noise'], 'a restart counts as noise');
  assert.equal(H.trust({ text: 'hallo zusammen' }).unsure, false, 'nothing expected: only confidence and garble count');
});
