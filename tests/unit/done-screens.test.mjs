// Guard: a done screen never traps him. A round hides the app's bars and locks the page to the round box
// (body.pr-in-round); every done screen goes through the shared done hero, whose start() brings the bars back and
// lets the page scroll (done-hero.js leaveRound), and keeps its actions right after the hero, on screen above the tab
// bar. A cluster round's done screen shows the round's words and a compact field, never the whole cluster as type.
// Static checks over the source (the views need a browser); the e2e pass is in the round's review notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const read = p => readFileSync(join(root, p), 'utf8');
function walk(dir) {
  return readdirSync(join(root, dir)).flatMap(f => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}
const sources = walk('src/features').map(p => ({ p, s: read(p) }));

test('the shared done hero brings the bars back and unlocks the page unless it is a step in a flow', () => {
  const s = read('src/features/shared/done-hero.js');
  const leave = /export function leaveRound\(\) \{([\s\S]*?)\n\}/.exec(s);
  assert.ok(leave, 'done-hero.js exports leaveRound()');
  assert.match(leave[1], /dataset\.chrome = 'on'/);
  assert.match(leave[1], /classList\.remove\([^)]*'pr-in-round'/);
  assert.match(s, /start\(\) \{\s*if \(!inFlow\) leaveRound\(\);/);
});

test('every done screen starts its hero, and only a step inside a full-screen flow keeps the bars hidden', () => {
  const users = sources.filter(x => /doneHero\(\{/.test(x.s) && !x.p.endsWith('done-hero.js'));
  assert.ok(users.length >= 6, `done screens found: ${users.map(x => x.p).join(', ')}`);
  for (const { p, s } of users) {
    const heroes = s.match(/doneHero\(\{/g).length;
    const starts = (s.match(/hero\.start\(\)/g) || []).length;
    assert.ok(starts >= heroes, `${p}: every doneHero() is started (${starts} of ${heroes})`);
    if (/inFlow: true/.test(s)) assert.ok(p.endsWith('practice-script/rehearse.js'), `${p}: only a rehearsal step stays in its flow`);
  }
  for (const want of ['practice-round/round.js', 'shared/cluster-layout.js', 'practice-speak/sim-view.js', 'practice-write/write.js', 'practice-script/words.js', 'practice-clusters/sort.js', 'practice-clusters/check.js']) {
    assert.ok(users.some(x => x.p.endsWith(want)), `${want} draws its done screen with the shared hero`);
  }
});

test('a done screen\'s actions come right after the hero, before any list', () => {
  for (const { p, s } of sources) {
    if (!/doneHero\(\{/.test(s) || p.endsWith('done-hero.js') || p.endsWith('practice-script/rehearse.js')) continue;
    // (the B1 round has one short "Next: …" line between them)
    const re = /hero\.el,\s*(?:h\('p', \{ class: 'pr-next' \}[^\n]*\n\s*)?h\('div', \{ class: 'pr-done-actions'/g;
    assert.ok(re.test(s), `${p}: the actions row follows hero.el`);
  }
});

test('the actions stay on screen above the tab bar while a done page scrolls', () => {
  const css = read('styles/features/practice.css');
  const rule = /\.pr-done \.pr-done-actions, \.wr-done \.pr-done-actions \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'a sticky rule for done actions');
  assert.match(rule[1], /position: sticky/);
  assert.match(rule[1], /bottom: calc\(57px \+ env\(safe-area-inset-bottom\)\)/);
});

test('a cluster done screen shows the round\'s words and a compact field, not the whole cluster as type', () => {
  const s = read('src/features/shared/cluster-layout.js');
  const fn = /export async function drawClusterDone[\s\S]*?\n\}\n/.exec(s)[0];
  assert.match(fn, /roundWords\(prev, cl, data\.c\)/);
  assert.match(fn, /partOf\(cl, words\)/);
  assert.match(fn, /class: 'field cl-done-field'/);
  assert.doesNotMatch(fn, /clusterLayout\(cl,/, 'the whole cluster is never laid out as type on the done screen');
  assert.match(fn, /t\('practice\.clusters\.another'\)[\s\S]*t\('practice\.done'\)/, 'Another round and Done');
});

test('every round that hides the bars gives them back when it is left', () => {
  for (const { p, s } of sources) {
    if (!/dataset\.chrome = 'off'/.test(s)) continue;
    assert.match(s, /dataset\.chrome = 'on'/, `${p} restores the chrome`);
    if (/classList\.add\('pr-in-round'\)/.test(s)) assert.match(s, /classList\.remove\('pr-in-round'\)/, `${p} unlocks the page`);
  }
});
