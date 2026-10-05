// Right to left and logical CSS (round 3, C3a; Arch #16). Two lints that keep RTL possible:
//   - every node marked as study-language text (lang: langAttr()) also carries its direction (dir: dirAttr()), so an
//     Arabic course's text runs right to left inside the English chrome;
//   - styles/ uses logical properties (margin-inline-start, inset-inline-end, text-align: start …); the few physical
//     ones left are listed here with the reason, and a new one fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const walk = (/** @type {string} */ d) => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('every study-language lang attribute carries dir', () => {
  const bad = [];
  for (const f of walk(path.join(ROOT, 'src')).filter(f => f.endsWith('.js') && !f.includes(`${path.sep}vendor${path.sep}`))) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      const n = (l.match(/lang: langAttr\(\)/g) || []).length, d = (l.match(/lang: langAttr\(\), dir: dirAttr\(\)/g) || []).length;
      if (n !== d) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      if (/lang: 'en' \}/.test(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1} (an English island needs dir: 'ltr')`);
    });
  }
  assert.deepEqual(bad, []);
});

/** Physical left/right kept on purpose: centred with left: 50% and a translate or negative margin, or placed by JS
 * from measured (physical) coordinates. selector → properties. */
const PHYSICAL_OK = {
  '.switch::after': ['left'], '.seg-thumb': ['left'], '.toast': ['left'], '.wb-word.is-sep .wb-joint': ['left'],
  '.wb-dot': ['left', 'margin-left'], '.wb-syll .wb-dot': ['margin-left'], '.wb-flyer': ['left'], '.wb-core': ['left'],
  '.wb-cell.is-O::after': ['left'], '.wb-cell.is-none::after': ['left'], '.ex-here': ['left'], '.pl-label': ['left'],
  '.wr-answer .wr-fly': ['left'],
};

test('styles use logical inline properties (physical left/right only where listed)', () => {
  const PROP = /(?<=[{;\s])((?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?|left|right|border-(?:top|bottom)-(?:left|right)-radius)\s*:|(?<=[{;\s])text-align\s*:\s*(left|right)\b/g;
  const bad = [];
  for (const f of walk(path.join(ROOT, 'styles')).filter(f => f.endsWith('.css') && !f.endsWith('paper-shaders.css'))) {
    let sel = '';
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (l.includes('{')) sel = l.split('{')[0].trim();
      for (const m of l.matchAll(PROP)) {
        const p = m[1] || `text-align: ${m[2]}`;
        if (!(PHYSICAL_OK[/** @type {keyof typeof PHYSICAL_OK} */ (sel)] || []).includes(p)) bad.push(`${path.relative(ROOT, f)}:${i + 1} ${sel} ${p}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});
