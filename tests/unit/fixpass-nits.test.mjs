// Round 8 fix pass: the cheap nits from the four reviews, checked in the source (their behaviour is in the e2e specs
// named next to each). Each assertion failed before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('code N5: a meter update cancels the last one\'s pending frames, so the ids never pile up', () => {
  const s = read('src/ui/meter.js');
  assert.equal((s.match(/frames\.forEach\(cancelAnimationFrame\); frames\.length = 0;/g) || []).length, 2);
});

test('code N6: a new again tick lands with motion on only', () => {
  assert.match(read('src/features/shared/progress.js'), /k >= had && !reduced\(\) \? 'land' : ''/);
});

test('UX N4: the retype locus is the one underline on its word', () => {
  assert.match(read('styles/ui.css'), /\.ui-ad-w\[data-pulse="locus"\] \.ui-ad-m::after \{ opacity: 0; \}/);
});

test('UX N8: on a tablet the dock keeps the content width', () => {
  assert.match(read('styles/app.css'), /@media \(min-width: 600px\) \{ \.dock \{ padding-inline: max\(var\(--gutter\), calc\(\(100% - 560px\) \/ 2\)\); \} \}/);
});

test('design N1: the tile press uses the press token; N3: no focus ring after a tap opens a sheet; N7: the next card waits 70 ms', () => {
  assert.match(read('styles/ui.css'), /\.ui-tile\.is-pressed > \.ui-tile-face \{[^}]*transition-duration: var\(--dur-press\)/);
  assert.match(read('src/ui/sheet.js'), /focusVisible: opts\.focus && matchMedia\('\(pointer: coarse\)'\)\.matches \? false : undefined/);
  const m = read('styles/motion.css');
  assert.match(m, /vt-in-right var\(--dur-card\) var\(--spring-snappy\) 70ms both/);
  assert.match(m, /vt-in-left var\(--dur-card\) var\(--spring-snappy\) 70ms both/);
});
