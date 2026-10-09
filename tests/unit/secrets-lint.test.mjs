// One credentials seam (arch F4, src/data/credentials.js). Outside src/data/ and Profile › Connections
// (src/features/profile/, which edits the secrets), no module reads or writes kv 'secrets' or names the Claude key
// field: features ask claude(store), canAskClaude(store) or github(store) and pass the credential to the service. Only
// services/claude.js puts a key into a request header. Accounts (src/data/account/) and a Claude proxy then change
// data/ alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
/** Where the secrets may be read: the data layer and the screen that edits them. */
const ALLOWED = ['data/', 'features/profile/'];
/** Single files that name a secret's field without reading it, and why. */
const EXEMPT = new Map([['core/log.js', 'the log scrubber names the fields it redacts']]);

/** @param {string} dir @returns {string[]} paths relative to src/, with / */
function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'vendor' ? [] : walk(p);
    return p.endsWith('.js') ? [path.relative(SRC, p).split(path.sep).join('/')] : [];
  });
}

/** Code without its comments, so a comment may still say where a secret lives. @param {string} src */
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const RULES = [
  { what: "store.get('secrets')", re: /\bget\(\s*['"`]secrets['"`]/ },
  { what: "store.set('secrets')", re: /\bset\(\s*['"`]secrets['"`]/ },
  { what: 'the anthropicKey field', re: /\banthropicKey\b/ },
];

test('kv secrets are read and written only in src/data/ and Profile', () => {
  const hits = [];
  for (const rel of walk(SRC)) {
    if (ALLOWED.some(a => rel.startsWith(a)) || EXEMPT.has(rel)) continue;
    const src = code(readFileSync(path.join(SRC, rel), 'utf8'));
    for (const r of RULES) if (r.re.test(src)) hits.push(`${rel}: ${r.what} (use data/credentials.js)`);
  }
  assert.deepEqual(hits, []);
});

test('only services/claude.js puts a key into a request', () => {
  const hits = walk(SRC).filter(rel => rel !== 'services/claude.js' && !EXEMPT.has(rel) && /x-api-key/i.test(code(readFileSync(path.join(SRC, rel), 'utf8'))));
  assert.deepEqual(hits, []);
});

test('the lint catches what it bans', () => {
  const bad = ["const k = store.get('secrets', {}).anthropicKey;", 'store.set("secrets", {})', 'x.anthropicKey'];
  for (const s of bad) assert.ok(RULES.some(r => r.re.test(code(s))), s);
  assert.ok(!RULES.some(r => r.re.test(code("/* kv 'secrets'.anthropicKey */ const c = claude(store);"))), 'a comment is fine');
  assert.ok(!RULES.some(r => r.re.test(code("// store.get('secrets')"))), 'a line comment is fine');
});
