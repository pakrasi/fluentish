// Guard (round 8): the component layer src/ui/ keeps its rules (the README block in src/ui/index.js).
//   - a component imports src/ui, src/core, src/domain and src/lang only (never data, services, features, i18n),
//     and never core/i18n.js: strings come from the caller;
//   - nothing under core, data, domain, services, lang or i18n imports src/ui;
//   - no t() call, no storage or network, no element.animate() (motion goes through core/motion.js);
//   - every component file exports mountX(el, opts) or createX(opts);
//   - every file is on the strict type-check list;
//   - class names in styles/ui.css start with ui- or is-, and its sections are opened and closed in pairs.
// The rules are pure functions over (path, source), so the last tests check that each one catches what it should.
// Separate from listener-lint (src/features).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');

/** @param {string} dir @returns {string[]} paths relative to src/ */
function walk(dir) {
  return readdirSync(path.join(SRC, dir)).flatMap(n => {
    const p = dir ? `${dir}/${n}` : n;
    if (statSync(path.join(SRC, p)).isDirectory()) return p === 'vendor' ? [] : walk(p);
    return p.endsWith('.js') ? [p] : [];
  });
}
/** Code without comments, so a comment may still name what is banned. @param {string} s */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Relative imports of a module (static, dynamic, JSDoc types), resolved to paths under src/. @param {string} file @param {string} src */
export function importsOf(file, src) {
  return [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g)]
    .map(m => path.posix.normalize(path.posix.join(path.posix.dirname(file), m[2])));
}

const UI_MAY_IMPORT = ['ui', 'core', 'domain', 'lang'];
const BELOW_UI = ['core', 'data', 'domain', 'services', 'lang', 'i18n'];

/** Why a module breaks the ui rules, as a list of reasons (empty: fine). @param {string} file under src/ @param {string} src */
export function uiViolations(file, src) {
  /** @type {string[]} */ const bad = [];
  const top = file.split('/')[0];
  const imports = importsOf(file, src);
  if (top !== 'ui') {
    // one exception (C5, design C §9): core/motion.js re-exports the toast that moved to ui/toast.js, so every
    // motion.toast() call keeps working; nothing else under core may reach into src/ui
    const reach = imports.filter(p => p.startsWith('ui/') && !(file === 'core/motion.js' && p === 'ui/toast.js'));
    if (file.split('/').length > 1 && BELOW_UI.includes(top) && reach.length) bad.push(`${top} never imports src/ui`);
    return bad;
  }
  for (const p of imports) {
    if (!UI_MAY_IMPORT.includes(p.split('/')[0])) bad.push(`imports ${p}: src/ui imports ui, core, domain and lang only`);
    if (p === 'core/i18n.js') bad.push('imports core/i18n.js: strings come from the caller');
  }
  const c = code(src);
  if (/(^|[^\w.$])t\s*\(/m.test(c)) bad.push('calls t(): strings come from the caller');
  if (/\b(localStorage|sessionStorage|indexedDB)\b|(^|[^\w.$])fetch\s*\(/m.test(c)) bad.push('uses storage or the network');
  if (/\.animate\s*\(/.test(c)) bad.push('calls element.animate(): use play()/animate() from core/motion.js');
  if (file !== 'ui/index.js' && !/export\s+(?:async\s+)?function\s+(?:mount|create)[A-Z]\w*\s*\(/.test(c)) bad.push('exports no mountX(el, opts) or createX(opts)');
  return bad;
}

/** Class selectors in a stylesheet that are not ui- or is-, and section markers that are not paired. @param {string} css */
export function uiCssViolations(css) {
  /** @type {string[]} */ const bad = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '{}').replace(/url\([^)]*\)/g, '');
  for (const m of body.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) if (!/^(ui|is)-/.test(m[1])) bad.push(`.${m[1]}: classes in ui.css start with ui- or is-`);
  const open = [...css.matchAll(/\/\* ---- ((?:ui|core)\/[\w-]+)[^*]*? ---- \*\//g)].map(m => m[1]);
  const close = [...css.matchAll(/\/\* ---- end ((?:ui|core)\/[\w-]+) ---- \*\//g)].map(m => m[1]);
  if (open.join() !== close.join()) bad.push(`sections ${open.join(', ')} do not match their ends ${close.join(', ')}`);
  return bad;
}

test('src/ui keeps its layer: imports, strings, storage, motion and the mount API', () => {
  assert.ok(existsSync(path.join(SRC, 'ui/index.js')), 'src/ui/index.js holds the rules');
  const bad = walk('').flatMap(f => uiViolations(f, readFileSync(path.join(SRC, f), 'utf8')).map(w => `${f}: ${w}`));
  assert.deepEqual(bad, []);
});

test('every src/ui file is type-checked strict', () => {
  const include = JSON.parse(readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8')).include;
  assert.ok(include.includes('src/ui/**/*.js'), 'tsconfig.json lists src/ui/**/*.js');
});

test('styles/ui.css: ui- and is- classes only, sections in pairs, loaded after components.css', () => {
  assert.deepEqual(uiCssViolations(readFileSync(path.join(ROOT, 'styles/ui.css'), 'utf8')), []);
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const at = (/** @type {string} */ f) => html.indexOf(`href="styles/${f}"`);
  assert.ok(at('ui.css') > at('components.css') && at('components.css') > 0, 'ui.css is linked right after components.css');
});

test('the rules catch what they are meant to catch', () => {
  const ok = "import { play } from '../core/motion.js';\nimport { letterDiff } from '../domain/letterdiff.js';\nexport function mountMeter(el, opts) { return { update() {}, destroy() {} }; }";
  assert.deepEqual(uiViolations('ui/meter.js', ok), []);
  // a comment may name what the rules ban
  assert.deepEqual(uiViolations('ui/meter.js', ok + "\n// no t(), no fetch(), no el.animate() here"), []);
  assert.deepEqual(uiViolations('ui/sheet.js', "export function createSheet(o) { const set = () => 1; return set(); }"), []);
  const one = (/** @type {string} */ src, file = 'ui/x.js') => uiViolations(file, src + '\nexport function mountX(el) {}');
  assert.equal(one("import { store } from '../data/store.js';").length, 1);
  assert.equal(one("import { tap } from '../services/haptics.js';").length, 1);
  assert.equal(one("import { x } from '../features/shared/picker.js';").length, 1);
  assert.equal(one("const m = await import('../features/today/index.js');").length, 1);
  assert.equal(one("import en from '../i18n/en.js';").length, 1);
  assert.equal(one("import { t } from '../core/i18n.js';").length, 1);
  assert.ok(one("el.textContent = t('round.check');").some(w => /t\(\)/.test(w)));
  assert.ok(one("localStorage.setItem('a', 'b');").length);
  assert.ok(one("const r = await fetch('x');").length);
  assert.ok(one("el.animate([{ opacity: 0 }], 200);").length);
  assert.deepEqual(uiViolations('ui/x.js', 'export const x = 1;'), ['exports no mountX(el, opts) or createX(opts)']);
  assert.deepEqual(uiViolations('ui/index.js', 'export {};'), []);
  // below the features: no src/ui
  assert.equal(uiViolations('core/router.js', "import { mountSheet } from '../ui/sheet.js';").length, 1);
  assert.equal(uiViolations('domain/x.js', "import { mountSheet } from '../ui/sheet.js';").length, 1);
  assert.deepEqual(uiViolations('core/motion.js', "export { toast } from '../ui/toast.js';"), []);
  assert.equal(uiViolations('core/motion.js', "import { mountSheet } from '../ui/sheet.js';").length, 1);
  assert.equal(uiViolations('core/dom.js', "export { toast } from '../ui/toast.js';").length, 1);
  assert.deepEqual(uiViolations('features/shared/picker.js', "import { mountSheet } from '../../ui/sheet.js';"), []);
  // the stylesheet
  assert.deepEqual(uiCssViolations('/* ---- ui/tile ---- */\n.ui-tile.is-picked > .ui-tile-face { background: url(a.b); }\n/* ---- end ui/tile ---- */'), []);
  assert.equal(uiCssViolations('.tile { color: red; }').length, 1);
  assert.equal(uiCssViolations('/* ---- ui/tile ---- */\n.ui-tile {}').length, 1);
  assert.deepEqual(uiCssViolations('.ui-a { width: 1.5px; opacity: .5; }'), []);
});
