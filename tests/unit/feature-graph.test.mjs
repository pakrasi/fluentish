// The import graph of src/ (ARCHITECTURE §2, docs/CONTRIBUTING-FEATURES.md rule 2): features never import each other.
// Every relative import is resolved, static, dynamic (import('…')) and JSDoc types alike, and checked by layer:
//   features/<id>/**   may import core, data, domain, services, i18n, vendor, the kernel files features/*.js and the
//                      practice runtime features/shared/**; never another features/<id>/
//   features/shared/** a library for the Practice features: never imports a feature
//   features/*.js      the kernel (registry, contract, day): only registry.js names feature modules, lazily
//   domain/**          pure: imports domain/ and the language packs lang/ only (a JSDoc type such as core/clock.js
//                      ClockCtx loads nothing)
//   lang/**            the language packs (Wave C2), pure: import lang/ only
//   core, data, services, i18n   never import a feature; main.js imports only features/registry.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'vendor' ? [] : walk(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

/** Every relative import of every module: [from, to, type] with paths under src/; type: a JSDoc type reference
 * (import('…').Name), which loads nothing. */
export function importGraph() {
  /** @type {[string, string, boolean][]} */ const edges = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1(\s*\)\.)?/g)) {
      edges.push([path.relative(SRC, file).split(path.sep).join('/'), path.relative(SRC, path.resolve(path.dirname(file), m[2])).split(path.sep).join('/'), !!m[3]]);
    }
  }
  return edges;
}

/** The layer of a module under src/: 'feature:<id>', 'shared', 'kernel', 'domain', 'main', or its top folder. @param {string} p */
export function layer(p) {
  const s = p.split('/');
  if (s[0] === 'features') return s.length === 2 ? 'kernel' : s[1] === 'shared' ? 'shared' : `feature:${s[1]}`;
  if (s.length === 1) return 'main';
  return s[0];
}

/** @param {string} from @param {string} to @param {boolean} [type] a JSDoc type reference @returns {string | null} why the edge breaks a rule */
export function violation(from, to, type = false) {
  const a = layer(from), b = layer(to);
  if (a.startsWith('feature:') && b.startsWith('feature:') && a !== b) return 'features never import each other';
  if (a === 'shared' && b.startsWith('feature:')) return 'features/shared is a library and never imports a feature';
  if (a === 'kernel' && b.startsWith('feature:') && from !== 'features/registry.js') return 'only the registry names feature modules';
  if (a === 'domain' && b !== 'domain' && b !== 'lang' && !type) return 'domain is pure: it imports domain and lang only';
  if (a === 'lang' && b !== 'lang' && !type) return 'a language pack is pure: it imports lang only';
  if (['core', 'data', 'services', 'i18n'].includes(a) && (b.startsWith('feature:') || b === 'shared' || b === 'kernel')) return `${a} never imports a feature`;
  if (a === 'main' && b !== 'main' && (b.startsWith('feature:') || b === 'shared' || (b === 'kernel' && to !== 'features/registry.js'))) return 'main.js reaches features through the registry only';
  return null;
}

test('the import graph keeps the layers: features never import each other', () => {
  const bad = importGraph().map(([f, t, ty]) => ({ f, t, why: violation(f, t, ty) })).filter(x => x.why);
  assert.deepEqual(bad.map(x => `${x.f} → ${x.t}: ${x.why}`), []);
});

test('the rule catches what it is meant to catch', () => {
  assert.ok(violation('features/today/index.js', 'features/practice-round/plan.js'));
  assert.ok(violation('features/practice-write/write.js', 'features/practice-round/round.js'));
  assert.ok(violation('features/shared/data.js', 'features/practice/hub.js'));
  assert.ok(violation('features/day.js', 'features/exam/data.js'));
  assert.ok(violation('main.js', 'features/exam/data.js'));
  assert.ok(violation('domain/allowance.js', 'data/scripts.js'));
  assert.equal(violation('domain/budget.js', 'core/clock.js', true), null);
  assert.equal(violation('domain/match.js', 'lang/registry.js'), null);
  assert.ok(violation('lang/de/index.js', 'domain/match.js'));
  assert.ok(violation('lang/registry.js', 'core/lang.js'));
  assert.ok(violation('data/knowledge.js', 'features/shared/data.js'));
  assert.equal(violation('features/registry.js', 'features/exam/index.js'), null);
  assert.equal(violation('features/practice-speak/sim-view.js', 'features/shared/done-hero.js'), null);
  assert.equal(violation('features/today/index.js', 'domain/allowance.js'), null);
  assert.equal(violation('main.js', 'features/registry.js'), null);
  assert.equal(violation('features/build/plan.js', 'features/contract.js'), null);
});

test('the graph is read: dynamic imports and JSDoc type imports count', () => {
  const edges = importGraph();
  assert.ok(edges.length > 500, `${edges.length} edges`);
  assert.ok(edges.some(([f, t]) => f === 'features/registry.js' && t === 'features/exam/index.js'), 'a lazy view import');
  assert.ok(edges.some(([f, t, ty]) => f.startsWith('features/practice-round/') && t === 'features/contract.js' && ty), 'a JSDoc type import');
});
