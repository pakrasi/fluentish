// Script mode: the document title never carries script text (audit round 2 P1-3), and register "Both" (the other form
// of address made with Claude) is parsed and checked against the forms of address (script/register.js helpers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { docTitle } from '../../src/core/title.js';

test('title: a view with data-title names itself; private h1 text never reaches the title', () => {
  assert.equal(docTitle({ h1: 'Mein Garten im Frühling', custom: 'Scripts', path: '/practice/scripts/x', name: 'Fluentish' }), 'Scripts · Fluentish');
  assert.equal(docTitle({ h1: 'Practice', path: '/practice', name: 'Fluentish' }), 'Practice · Fluentish');
  assert.equal(docTitle({ h1: 'Today', path: '/today', name: 'Fluentish' }), 'Fluentish');
  // every script view whose h1 shows the script's own text sets a generic data-title on its root
  for (const f of ['overview.js', 'mark.js', 'rehearse.js', 'words.js']) {
    const src = fs.readFileSync(new URL(`../../src/features/practice-script/${f}`, import.meta.url), 'utf8');
    assert.match(src, /'data-title': t\('practice\.script\.title'\)/, f);
  }
  const main = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /\[data-title\]/, 'main.js reads data-title');
  // no script view writes document.title or puts text into the URL
  for (const f of fs.readdirSync(new URL('../../src/features/practice-script/', import.meta.url))) {
    const src = fs.readFileSync(new URL(`../../src/features/practice-script/${f}`, import.meta.url), 'utf8');
    assert.ok(!/document\.title/.test(src), f);
    assert.ok(!/replaceState\([^)]*(title|\.de\b|lemma)/.test(src), f);
  }
});
