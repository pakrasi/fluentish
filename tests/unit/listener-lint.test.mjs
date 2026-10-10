// Guard (round 8, arch F2): a view's global listeners stop with the view. The router aborts ctx.signal before a view's
// unmount (core/router.js), so a listener on document or window in src/features passes { signal } (or goes through
// core/scope.js, whose on() adds it). Stops hung on hashchange {once} miss replace navigations and fire when canLeave()
// keeps the view, and a hand-written removeEventListener is easy to forget.
//
// ALLOWED lists the sites from before the rule, per file, as "<target> <event>". It only shrinks: migrating a view
// (plan lane R1) removes its lines here, and the test fails while a listed site is gone but still listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const DIR = 'src/features';

/** @type {Record<string, string[]>} paths under src/features */
const ALLOWED = {
  'build/chain.js': ['window resize'],
  'build/game.js': ['document keydown'],
  'build/round.js': ['document keydown'],
  'build/today.js': ['document keydown'],
  'exam/parts.js': ['window pagehide'],
  'exam/speaking.js': ['window beforeunload', 'window pagehide', 'document visibilitychange'],
  'exam/writing.js': ['window pagehide', 'document visibilitychange'],
  'explore/index.js': ['document keydown', 'document pointerdown'],
  'practice-clusters/check.js': ['window hashchange', 'window hashchange'],
  'practice-clusters/sort.js': ['window hashchange', 'document keydown'],
  'practice-clusters/view.js': ['document keydown'],
  'practice-conversation/chat.js': ['window online'],
  'practice-conversation/setup.js': ['window online', 'window offline'],
  'practice-read/reader.js': ['document visibilitychange'],
  'practice-round/round.js': ['document visibilitychange', 'document keydown', 'document keydown'],
  'practice-script/rehearse.js': ['document keydown'],
  'practice-script/run.js': ['document keydown'],
  'practice-script/ui.js': ['window hashchange'],
  'practice-speak/sim-view.js': ['document keydown', 'window hashchange'],
  'practice-write/write.js': ['document keydown', 'window pagehide'],
  'shared/cluster-layout.js': ['window hashchange'],
  'shared/textview.js': ['window hashchange', 'window scroll', 'window resize'],
};

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(join(root, dir)).flatMap(f => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

/** Code without comments, so a comment may still name the API. @param {string} s */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** The text between the parenthesis at `open` and its partner. @param {string} s @param {number} open */
function args(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return s.slice(open + 1, i);
  }
  return s.slice(open + 1);
}

// document.addEventListener(, window.addEventListener(, globalThis./self. and a bare addEventListener( (the window)
const CALL = /(?:\b(document|window|globalThis|self)\s*\.\s*|(?<!\.\s*)(?<![\w$]))addEventListener\s*\(/g;
// document.onkeydown = …, window.onresize = … (a handler property never stops by itself)
const PROP = /\b(document|window)\s*\.\s*on([a-z]+)\s*=(?!=)/g;

/** Global listeners without a signal in one source, as "<target> <event>". @param {string} src */
function unsignalled(src) {
  const s = code(src);
  /** @type {string[]} */
  const out = [];
  for (const m of s.matchAll(CALL)) {
    const a = args(s, /** @type {number} */ (m.index) + m[0].length - 1);
    if (/\bsignal\b/.test(a)) continue;
    const target = !m[1] || m[1] === 'globalThis' || m[1] === 'self' ? 'window' : m[1];
    const type = /^\s*(['"`])([\w:-]+)\1/.exec(a)?.[2] ?? a.split(',')[0].trim();
    out.push(`${target} ${type}`);
  }
  for (const m of s.matchAll(PROP)) out.push(`${m[1]} ${m[2]}`);
  return out.sort();
}

test('the matcher: what counts as a global listener without a signal', () => {
  assert.deepEqual(unsignalled(`document.addEventListener('keydown', onKey);`), ['document keydown']);
  assert.deepEqual(unsignalled(`addEventListener('hashchange', stop, { once: true });`), ['window hashchange']);
  assert.deepEqual(unsignalled(`window.addEventListener(\n  'resize',\n  fit,\n);`), ['window resize']);
  assert.deepEqual(unsignalled(`globalThis.addEventListener("online", f)`), ['window online']);
  assert.deepEqual(unsignalled(`if (a) return addEventListener('pagehide', f);`), ['window pagehide']);
  assert.deepEqual(unsignalled(`el\n  .addEventListener('click', f);`), []);
  assert.deepEqual(unsignalled(`window.onkeydown = e => go(e);`), ['window keydown']);
  assert.deepEqual(unsignalled(`document.addEventListener('keydown', onKey, { signal: ctx.signal });`), []);
  assert.deepEqual(unsignalled(`addEventListener('scroll', f, { passive: true, signal });`), []);
  assert.deepEqual(unsignalled(`document.addEventListener('keydown', e => { if (x(e, y)) z(); }, { signal });`), []);
  // element listeners stop with their element, and scope.on passes the signal itself
  assert.deepEqual(unsignalled(`btn.addEventListener('click', f); el.parentElement.addEventListener('x', f);`), []);
  assert.deepEqual(unsignalled(`s.on(document, 'keydown', onKey);`), []);
  assert.deepEqual(unsignalled(`// document.addEventListener('keydown', f)\n/* addEventListener('x', f) */`), []);
  assert.deepEqual(unsignalled(`if (window.onkeydown == null) {}`), []);
});

test('no new global listener in src/features without { signal } (allow-list of the sites from before round 8)', () => {
  /** @type {string[]} */
  const problems = [];
  const files = walk(DIR);
  for (const p of files) {
    const rel = p.slice(DIR.length + 1);
    const found = unsignalled(readFileSync(join(root, p), 'utf8'));
    const allowed = [...(ALLOWED[rel] || [])].sort();
    const extra = [...found], gone = [...allowed];
    for (const x of found) { const i = gone.indexOf(x); if (i >= 0) { gone.splice(i, 1); extra.splice(extra.indexOf(x), 1); } }
    for (const x of extra) problems.push(`${p}: new global listener "${x}" without a signal: pass { signal: ctx.signal } or use scope(ctx.signal).on() from core/scope.js`);
    for (const x of gone) problems.push(`${p}: "${x}" is no longer there: take it off ALLOWED in tests/unit/listener-lint.test.mjs`);
  }
  for (const rel of Object.keys(ALLOWED)) {
    if (!existsSync(join(root, DIR, rel))) problems.push(`${DIR}/${rel} is gone: take it off ALLOWED`);
  }
  assert.deepEqual(problems, []);
});
