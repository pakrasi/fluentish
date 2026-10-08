// motion.js easing(): springs are linear() curves, which the Web Animations API in WebKit rejects with a TypeError
// (CSS takes them). Every easing passed to element.animate() goes through pickEasing, which falls back to ease-out.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = /** @type {any} */ ({ documentElement: { classList: { add() {} }, dataset: {} } });
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
const { pickEasing, EASE_OUT } = await import('../../src/core/motion.js');

const webkit = (/** @type {string} */ v) => !/^linear\(/.test(v);   // WebKit's WAAPI: no linear() curves
const chrome = () => true;
const spring = 'linear(0, 0.114, 0.37, 1)';

test('a spring falls back to ease-out where WAAPI rejects linear()', () => {
  assert.equal(pickEasing(spring, webkit), EASE_OUT);
  assert.equal(pickEasing(spring, chrome), spring);
});
test('plain curves and keywords pass; an empty token falls back', () => {
  assert.equal(pickEasing('cubic-bezier(0.65, 0, 0.35, 1)', webkit), 'cubic-bezier(0.65, 0, 0.35, 1)');
  assert.equal(pickEasing('ease-in', webkit), 'ease-in');
  assert.equal(pickEasing('', chrome), EASE_OUT);
  assert.equal(pickEasing(null, chrome, 'ease-out'), 'ease-out');
});
