// core/keyboard.js (round 6): the one helper for the on-screen keyboard. The pure parts (measure, isOpen,
// revealDelta, isTextField) are tested as functions; startKeyboard, fitToKeyboard, keepFocus and enterMovesTo run
// against a small fake of the browser (a visualViewport whose height and offsetTop the test sets, as the e2e
// harness does). The browser behaviour itself is tests/e2e/keyboard.spec.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- a fake browser, enough for the module ----------
class FakeTarget {
  constructor() { /** @type {Map<string, Function[]>} */ this.l = new Map(); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { this.l.set(t, [...(this.l.get(t) || []), f]); }
  removeEventListener(/** @type {string} */ t, /** @type {Function} */ f) { this.l.set(t, (this.l.get(t) || []).filter(x => x !== f)); }
  dispatch(/** @type {string} */ t, /** @type {any} */ e = {}) { for (const f of this.l.get(t) || []) f({ type: t, preventDefault() { e.prevented = true; }, ...e }); return e; }
}
const classList = () => {
  const s = new Set();
  return { add: (/** @type {string} */ c) => s.add(c), remove: (/** @type {string} */ c) => s.delete(c), contains: (/** @type {string} */ c) => s.has(c),
    toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => { if (on ?? !s.has(c)) s.add(c); else s.delete(c); return s.has(c); } };
};
const vars = new Map();
const docTarget = new FakeTarget();
const winTarget = new FakeTarget();
const vv = Object.assign(new FakeTarget(), { height: 874, offsetTop: 0, scale: 1 });
/** @type {any} */ const doc = {
  documentElement: { classList: classList(), dataset: { motion: 'reduce' }, style: { setProperty: (/** @type {string} */ k, /** @type {string} */ v) => vars.set(k, v) } },
  body: { classList: classList() },
  activeElement: null,
  addEventListener: docTarget.addEventListener.bind(docTarget),
  removeEventListener: docTarget.removeEventListener.bind(docTarget),
  querySelectorAll: () => [],
  scrollingElement: null,
};
Object.assign(globalThis, {
  document: doc,
  window: globalThis,
  visualViewport: vv,
  innerHeight: 874,
  innerWidth: 402,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '', overflowY: 'visible', position: 'static' }),
  requestAnimationFrame: (/** @type {Function} */ f) => { f(); return 0; },   // at once (0: no frame left pending)
  addEventListener: winTarget.addEventListener.bind(winTarget),
  removeEventListener: winTarget.removeEventListener.bind(winTarget),
});
const K = await import('../../src/core/keyboard.js');

/** A fake element. @param {string} tagName @param {Record<string, any>} [o] */
const el = (tagName, o = {}) => Object.assign(new FakeTarget(), { tagName, getAttribute: (/** @type {string} */ k) => (o.attrs || {})[k] ?? null, setAttribute(/** @type {string} */ k, /** @type {string} */ v) { (o.attrs ||= {})[k] = v; }, classList: classList(), ...o });

// ---------- pure parts ----------
test('measure: the iOS keyboard shrinks only the visual viewport', () => {
  assert.deepEqual(K.measure({ innerHeight: 874, base: 874, vv: { height: 460, offsetTop: 0 } }), { h: 460, top: 0, kb: 414, screen: 414 });
  // iOS panned the page 200 px to show the caret: the keyboard is still 414 px on screen, 214 px of the layout viewport
  assert.deepEqual(K.measure({ innerHeight: 874, base: 874, vv: { height: 460, offsetTop: 200 } }), { h: 460, top: 200, kb: 214, screen: 414 });
  // no keyboard
  assert.deepEqual(K.measure({ innerHeight: 874, base: 874, vv: { height: 874, offsetTop: 0 } }), { h: 874, top: 0, kb: 0, screen: 0 });
});

test('measure: a browser that shrinks the layout viewport, a pinch zoom, no visualViewport', () => {
  // the layout viewport itself shrank to 460: the drop from the tallest height seen is the keyboard
  assert.equal(K.measure({ innerHeight: 460, base: 874, vv: { height: 460, offsetTop: 0 } }).screen, 414);
  // a pinch zoom shrinks the visual viewport too, but it is not a keyboard
  assert.equal(K.measure({ innerHeight: 874, base: 874, vv: { height: 437, offsetTop: 100, scale: 2 } }).screen, 0);
  // an old engine without visualViewport: the page height
  assert.deepEqual(K.measure({ innerHeight: 700, base: 700, vv: null }), { h: 700, top: 0, kb: 0, screen: 0 });
});

test('isOpen: a focused text field and a keyboard taller than 120 px (never a hardware keyboard bar)', () => {
  assert.equal(K.isOpen(true, 414), true);
  assert.equal(K.isOpen(true, 120), false);
  assert.equal(K.isOpen(true, 55), false);   // the iPad's shortcut bar with a hardware keyboard
  assert.equal(K.isOpen(false, 414), false);  // the keyboard is closing
  assert.equal(K.MIN_KB, 120);
});

test('revealDelta: nearest, start and end; a box taller than the room shows its start', () => {
  assert.equal(K.revealDelta({ top: 100, bottom: 150 }, 0, 400), 0);
  assert.equal(K.revealDelta({ top: 380, bottom: 450 }, 0, 400), 50);
  assert.equal(K.revealDelta({ top: -30, bottom: 20 }, 0, 400), -30);
  assert.equal(K.revealDelta({ top: 100, bottom: 700 }, 0, 400), 100);
  assert.equal(K.revealDelta({ top: 100, bottom: 150 }, 0, 400, 'start'), 100);
  assert.equal(K.revealDelta({ top: 100, bottom: 150 }, 0, 400, 'end'), -250);
});

test('isTextField: text inputs and textareas open the keyboard; dates, checkboxes, buttons do not', () => {
  assert.equal(K.isTextField(el('TEXTAREA')), true);
  assert.equal(K.isTextField(el('TEXTAREA', { disabled: true })), false);
  for (const type of ['text', 'search', 'email', 'number', 'password', 'tel', 'url']) assert.equal(K.isTextField(el('INPUT', { attrs: { type } })), true, type);
  assert.equal(K.isTextField(el('INPUT')), true);   // no type is text
  for (const type of ['date', 'month', 'checkbox', 'file', 'range']) assert.equal(K.isTextField(el('INPUT', { attrs: { type } })), false, type);
  assert.equal(K.isTextField(el('BUTTON')), false);
  assert.equal(K.isTextField(el('DIV', { isContentEditable: true })), true);
  assert.equal(K.isTextField(null), false);
});

// ---------- the running helper ----------
test('startKeyboard: the variables follow the visual viewport; body.kb only while typing over a real keyboard', () => {
  /** @type {any[]} */ const events = [];
  K.startKeyboard({ bus: { emit: (/** @type {string} */ n, /** @type {any} */ d) => events.push([n, d]) } });
  assert.equal(vars.get('--vv-h'), '874px');
  assert.equal(vars.get('--kb'), '0px');
  assert.equal(doc.body.classList.contains('kb'), false);

  // he taps the answer field: focus, then the keyboard rises
  doc.activeElement = el('TEXTAREA');
  docTarget.dispatch('focusin');
  vv.height = 460; vv.dispatch('resize');
  assert.equal(vars.get('--vv-h'), '460px');
  assert.equal(vars.get('--vv-top'), '0px');
  assert.equal(vars.get('--kb'), '414px');
  assert.equal(vars.get('--kb-screen'), '414px');
  assert.equal(doc.body.classList.contains('kb'), true);
  assert.deepEqual(events.at(-1), ['kb', { open: true, h: 460, top: 0 }]);
  assert.equal(K.keyboardOpen(), true);

  // iOS pans: the variables follow, keyboard mode stays
  vv.offsetTop = 120; vv.dispatch('scroll');
  assert.equal(vars.get('--vv-top'), '120px');
  assert.equal(vars.get('--kb'), '294px');
  assert.equal(doc.body.classList.contains('kb'), true);

  // the field blurs, the keyboard goes down
  doc.activeElement = doc.body;
  docTarget.dispatch('focusout');
  vv.height = 874; vv.offsetTop = 0; vv.dispatch('resize');
  assert.equal(doc.body.classList.contains('kb'), false);
  assert.equal(vars.get('--kb-screen'), '0px');
  // keyboard mode ends with the blur (the keyboard is on its way down), once
  assert.equal(events.at(-1)[1].open, false);
  assert.equal(events.filter(e => e[1].open === false).length, 1);

  // a hardware keyboard: a field has the focus, the visual viewport loses only a 55 px bar
  doc.activeElement = el('INPUT', { attrs: { type: 'search' } });
  docTarget.dispatch('focusin');
  vv.height = 874 - 55; vv.dispatch('resize');
  assert.equal(doc.body.classList.contains('kb'), false);
  vv.height = 874; vv.dispatch('resize');
  doc.activeElement = null;
});

test('fitToKeyboard: the box takes the class that sizes it to --vv-h and follows --vv-top; undo removes it', () => {
  const box = el('DIV');
  const undo = K.fitToKeyboard(/** @type {any} */ (box));
  assert.equal(box.classList.contains('kb-fit'), true);
  undo();
  assert.equal(box.classList.contains('kb-fit'), false);
});

test('keepFocus and keep: a pointerdown on the button never takes the focus from the field', () => {
  const b = el('BUTTON');
  assert.equal(K.keepFocus(/** @type {any} */ (b)), b);
  const e = b.dispatch('pointerdown', {});
  assert.equal(e.prevented, true);
  const e2 = /** @type {any} */ ({ prevented: false, preventDefault() { this.prevented = true; } });
  K.keep(e2);
  assert.equal(e2.prevented, true);
});

test('enterMovesTo: Return in a title moves to the next field, with enterkeyhint "next"', () => {
  const next = el('TEXTAREA', { focused: false, focus() { this.focused = true; } });
  const title = el('INPUT');
  K.enterMovesTo(/** @type {any} */ (title), () => /** @type {any} */ (next));
  assert.equal(title.getAttribute('enterkeyhint'), 'next');
  const e = title.dispatch('keydown', { key: 'Enter', isComposing: false, shiftKey: false });
  assert.equal(e.prevented, true);
  assert.equal(next.focused, true);
  const e2 = title.dispatch('keydown', { key: 'a', isComposing: false, shiftKey: false });
  assert.equal(e2.prevented, undefined);
});

test('fitPrompt: a prompt up to 64 characters is short (it may grow over the empty band); a longer one keeps the clamp', () => {
  const p = el('P', { textContent: 'I suggest that we buy the present together.' });
  K.fitPrompt(/** @type {any} */ (p));
  assert.equal(p.classList.contains('kb-short'), true);
  p.textContent = 'shut (colloquial: die Tür ist ...); closed, as in a shop that has closed for the day';
  K.fitPrompt(/** @type {any} */ (p));
  assert.equal(p.classList.contains('kb-short'), false);
  p.textContent = `  ${'x'.repeat(K.SHORT_PROMPT)}  `;
  K.fitPrompt(/** @type {any} */ (p));
  assert.equal(p.classList.contains('kb-short'), true, 'spaces around it do not count');
  K.fitPrompt(null);   // no prompt on the card: nothing happens
});
