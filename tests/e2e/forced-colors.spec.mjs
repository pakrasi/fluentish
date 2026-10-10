// Forced colours (Windows High Contrast), round 8 fix pass (code review S8): the picker's chosen option, the retype
// locus and the diff marks stay visible when the system colours replace shadows, fills and background images.
// Chromium only: it is the engine that emulates forced colours.
import { test, expect, seed, open } from './fixtures.mjs';

test('forced colours: the chosen option is outlined, the locus underlined, no diff mark keeps its green or red', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced colours are emulated in Chromium');
  await page.emulateMedia({ forcedColors: 'active' });
  await seed(page);
  await open(page, '#/today');
  const out = await page.evaluate(() => {
    // built node by node (the page enforces Trusted Types)
    const el = (/** @type {string} */ tag, /** @type {Record<string, string>} */ attrs, /** @type {(Node | string)[]} */ ...kids) => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      e.append(...kids);
      return e;
    };
    const host = el('div', {},
      el('button', { class: 'rs-opt', role: 'radio', 'aria-checked': 'true', id: 'fc-on' }, 'A'),
      el('button', { class: 'rs-opt', role: 'radio', 'aria-checked': 'false', id: 'fc-off' }, 'B'),
      el('span', { 'data-pulse': 'locus', id: 'fc-locus' }, 'Wort'),
      el('div', { class: 'ui-ad is-right-slip' }, el('span', { class: 'ui-ad-m is-miss', id: 'fc-miss' }, 'n'), el('span', { class: 'ui-ad-m is-extra', id: 'fc-extra' }, 's')),
      el('div', { class: 'ui-ad' }, el('span', { class: 'ui-ad-m is-wrong', id: 'fc-wrong' }, 'm')));
    document.querySelector('#view')?.append(host);
    const cs = (/** @type {string} */ id, /** @type {string | null} */ pseudo = null) => getComputedStyle(/** @type {Element} */ (document.getElementById(id)), pseudo);
    const after = (/** @type {string} */ id) => cs(id, '::after').backgroundColor;
    const text = (/** @type {string} */ id) => getComputedStyle(/** @type {Element} */ (document.getElementById(id))).color;
    return {
      on: cs('fc-on').outlineStyle + ' ' + cs('fc-on').outlineWidth, off: cs('fc-off').outlineStyle,
      locus: cs('fc-locus').textDecorationLine,
      marks: ['fc-miss', 'fc-extra', 'fc-wrong'].map(id => after(id) === text(id)),
    };
  });
  expect(out).toEqual({ on: 'solid 2px', off: 'none', locus: 'underline', marks: [true, true, true] });
});
