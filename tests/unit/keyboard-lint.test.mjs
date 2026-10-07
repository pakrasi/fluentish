// Guard (round 6): the on-screen keyboard has one owner, src/core/keyboard.js. Before it there were five copies of a
// visualViewport fit() (only one of them right) and seven copies of a keep-focus handler, and six typing screens had
// neither. These static checks keep it that way:
//   - no module but core/keyboard.js reads visualViewport (pages size themselves from --vv-h, --vv-top, --kb);
//   - no module defines its own keep-focus handler (a pointerdown that only calls preventDefault): import keep or
//     keepFocus from core/keyboard.js;
//   - every full-screen typing screen sizes itself with fitToKeyboard().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');
/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(join(root, dir)).flatMap(f => {
    const p = `${dir}/${f}`;
    if (p === 'src/vendor') return [];
    return statSync(join(root, p)).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}
const OWNER = 'src/core/keyboard.js';
const sources = walk('src').filter(p => p !== OWNER).map(p => ({ p, s: read(p) }));
/** Code without comments, so a comment may still name the API. @param {string} s */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('only core/keyboard.js reads visualViewport', () => {
  const bad = sources.filter(x => /\bvisualViewport\b/.test(code(x.s))).map(x => x.p);
  assert.deepEqual(bad, [], `use core/keyboard.js (fitToKeyboard, reveal, the --vv-h/--vv-top/--kb variables) instead: ${bad.join(', ')}`);
  assert.match(read(OWNER), /window\.visualViewport/);
});

test('no ad-hoc keep-focus handler: buttons use keep / keepFocus from core/keyboard.js', () => {
  const patterns = [
    // const keep = e => e.preventDefault();   (the seven old copies)
    /(?:const|let|var)\s+\w*keep\w*\s*=\s*\(?[^=;]*?\)?\s*=>\s*\{?\s*\w+\.preventDefault\(\)/i,
    // onpointerdown: e => e.preventDefault()   /   addEventListener('pointerdown', e => e.preventDefault())
    /pointerdown['"]?\s*[:,]\s*\(?[^=;()]*\)?\s*=>\s*\{?\s*\w+\.preventDefault\(\)\s*;?\s*\}?\s*[),]/,
    // onmousedown / ontouchstart doing the same
    /(?:mousedown|touchstart)['"]?\s*[:,]\s*\(?[^=;()]*\)?\s*=>\s*\{?\s*\w+\.preventDefault\(\)\s*;?\s*\}?\s*[),]/,
  ];
  const bad = sources.filter(x => patterns.some(re => re.test(code(x.s)))).map(x => x.p);
  assert.deepEqual(bad, [], `import { keep } (or keepFocus) from core/keyboard.js: ${bad.join(', ')}`);
  const users = sources.filter(x => /import \{[^}]*\bkeep(Focus)?\b[^}]*\} from '[./]*core\/keyboard\.js'/.test(x.s)).map(x => x.p);
  for (const want of ['practice-round/round.js', 'practice-clusters/sort.js', 'practice-clusters/check.js', 'practice-read/round.js', 'practice-script/words.js',
    'shared/typecheck.js', 'shared/iknow.js', 'build/round.js', 'practice-conversation/chat.js', 'practice-write/write.js', 'practice-speak/sim-view.js']) {
    assert.ok(users.some(p => p.endsWith(want)), `${want} keeps the focus through core/keyboard.js`);
  }
});

test('every full-screen typing screen follows the keyboard through fitToKeyboard()', () => {
  for (const p of ['practice-round/round.js', 'practice-clusters/sort.js', 'practice-clusters/check.js', 'practice-clusters/view.js', 'practice-speak/sim-view.js',
    'build/round.js', 'practice-read/round.js', 'practice-script/words.js', 'practice-conversation/chat.js']) {
    const s = read(`src/features/${p}`);
    assert.match(s, /fitToKeyboard\(/, `${p} sizes its box with fitToKeyboard()`);
  }
  // the round shells no longer stretch to 100dvh with nothing following the keyboard: .kb-fit wins over their height
  assert.match(read('styles/app.css'), /:root \.kb-fit \{ height: var\(--vv-h, 100dvh\); transform: translateY\(var\(--vv-top, 0px\)\); \}/);
});

test('motion: only the keyboard class toggle animates, through core/motion.js kbShift (instant when reduced)', () => {
  const k = read(OWNER);
  assert.match(k, /import \{[^}]*kbShift[^}]*\} from '\.\/motion\.js'/);
  assert.match(k, /kbShift\(\(\) => \{ document\.body\.classList\.toggle\('kb', open\); \}\)/);
  const m = read('src/core/motion.js');
  const fn = /export async function kbShift\(apply\) \{([\s\S]*?)\n\}/.exec(m);
  assert.ok(fn, 'motion.js exports kbShift()');
  assert.match(fn[1], /if \(reduced\(\)[^)]*\) \{ apply\(\); return; \}/);
  assert.match(fn[1], /duration: 200/);
  assert.match(fn[1], /--spring-snappy/);
});
