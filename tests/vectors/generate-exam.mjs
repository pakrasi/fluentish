// Golden vectors for the mock-exam grader (round 3, lane C2b): every output of domain/grade.js that a Goethe B1
// result depends on, over all 14 tests, both objective modules and a fixed set of synthetic answer sheets. They were
// written from the Goethe-only grader BEFORE grade.js became generic over exam definitions (exam-def@1), so the
// generic engine can be checked byte for byte against it.
//
//   node tests/vectors/generate-exam.mjs           write tests/vectors/exam.goethe-b1.json
//   node tests/vectors/generate-exam.mjs --check   compare (what tests/unit/exam-vectors.test.mjs does)
//
// The answer sheets are INPUTS stored in the file; the check grades exactly those sheets again.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'exam.goethe-b1.json');
const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
const test = (/** @type {number} */ n) => JSON.parse(readFileSync(path.join(ROOT, `content/exams/goethe-b1/day${pad2(n)}.json`), 'utf8'));
export const def = () => JSON.parse(readFileSync(path.join(ROOT, 'content/exams/goethe-b1/exam.json'), 'utf8'));

/** The grader's API as the vectors call it. */
async function api() {
  const G = await import(pathToFileURL(path.join(ROOT, 'src/domain/grade.js')).href);
  // the definition is passed to every call; the Goethe-only grader the vectors were captured from ignored it
  const d = existsSync(path.join(ROOT, 'content/exams/goethe-b1/exam.json')) ? def() : { scoring: {} };
  return {
    G,
    answerKey: (/** @type {any} */ ex) => G.answerKey(ex, d),
    grade: (/** @type {any} */ key, /** @type {string} */ m, /** @type {any} */ a) => G.grade(key, m, a, d),
    teilIds: (/** @type {any} */ ex, /** @type {string} */ m) => G.teilIds(ex, m, d),
    itemInfo: (/** @type {any} */ ex) => G.itemInfo(ex, d),
    passes: (/** @type {number | null} */ s, /** @type {number} */ max) => G.passes(s, max, d.scoring.passShare),
  };
}

/** A small seeded generator (mulberry32), so the sheets are the same on every run. @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The values an item can be given in the runner, from its Teil and correct value (Goethe B1 only; inputs only). @param {string} teil @param {string} correct */
function choices(teil, correct) {
  if (teil === 'L1' || teil === 'H3') return ['r', 'f'];
  if (teil === 'L4') return ['ja', 'nein'];
  if (teil === 'H4') return ['mod', 'a', 'b'];
  if (teil === 'L3') return ['0', ...'ABCDEFGHIJ'];
  if (teil === 'H1') return /^[rf]$/.test(correct) ? ['r', 'f'] : ['a', 'b', 'c'];
  return ['a', 'b', 'c'];
}

/** The synthetic answer sheets for one test and module. @param {Record<string, [string, string, string]>} key @param {string} prefix @param {number} n */
function sheets(key, prefix, n) {
  const ids = Object.keys(key).filter(id => id.startsWith(prefix));
  const r = rng(1000 * n + prefix.charCodeAt(0));
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(r() * xs.length)];
  /** @type {Record<string, Record<string, any>>} */ const out = {};
  out.right = Object.fromEntries(ids.map(id => [id, key[id][0]]));
  out.blank = {};
  out.wrong = Object.fromEntries(ids.map(id => { const [c, t] = key[id]; return [id, choices(t, c).find(v => v.toLowerCase() !== c.toLowerCase())]; }));
  out.first = Object.fromEntries(ids.map(id => [id, choices(key[id][1], key[id][0])[0]]));
  out.last = Object.fromEntries(ids.map(id => { const cs = choices(key[id][1], key[id][0]); return [id, cs[cs.length - 1]]; }));
  out.partial = Object.fromEntries(ids.filter((_, i) => i % 3 === 0).map(id => [id, key[id][0]]));
  // runner values with case and space noise, junk, empty strings, null and a stray id from the other module
  out.noisy = Object.fromEntries(ids.map(id => {
    const [c, t] = key[id];
    const v = pick([...choices(t, c), c, c, '', null, 'x', 'JA', ' R ', ' Mod', 'b ', '0']);
    return [id, typeof v === 'string' && r() < 0.3 ? (r() < 0.5 ? ` ${v.toUpperCase()} ` : v.toUpperCase()) : v];
  }));
  out.noisy[prefix === 'L' ? 'H1-1' : 'L1-1'] = 'r';
  for (let k = 0; k < 3; k++) out[`random${k}`] = Object.fromEntries(ids.filter(() => r() < 0.85).map(id => [id, pick(choices(key[id][1], key[id][0]))]));
  return out;
}

/** @param {boolean} [check] use the sheets stored in the file */
export async function make(check = false) {
  const A = await api();
  const stored = check ? JSON.parse(readFileSync(OUT, 'utf8')).vectors : null;
  const sheetOf = (/** @type {number} */ n, /** @type {string} */ m, /** @type {string} */ s) => stored.find((/** @type {any} */ v) => v.fn === 'grade' && v.in.test === n && v.in.module === m && v.in.sheet === s).in.answers;
  const rows = [];
  rows.push({ fn: 'constants', out: { MODULES: A.G.MODULES, OBJECTIVE: A.G.OBJECTIVE } });
  for (let n = 1; n <= 14; n++) {
    const ex = test(n);
    const key = A.answerKey(ex);
    rows.push({ fn: 'answerKey', in: { test: n }, out: key });
    rows.push({ fn: 'itemInfo', in: { test: n }, out: A.itemInfo(ex) });
    for (const m of ['lesen', 'hoeren']) {
      rows.push({ fn: 'teilIds', in: { test: n, module: m }, out: A.teilIds(ex, m) });
      const sh = sheets(key, m === 'lesen' ? 'L' : 'H', n);
      for (const s of Object.keys(sh)) {
        const answers = check ? sheetOf(n, m, s) : sh[s];
        const g = A.grade(key, m, answers);
        rows.push({ fn: 'grade', in: { test: n, module: m, sheet: s, answers }, out: g,
          derived: { passes: A.passes(g.score, g.max_score), weakSkills: A.G.weakSkills(g.results), byTeil: A.G.byTeil(g.results) } });
      }
    }
  }
  for (const [s, max] of [[18, 30], [17, 30], [0, 30], [30, 30], [null, 30], [60, 100], [59, 100], [5, 0]]) rows.push({ fn: 'passes', in: { score: s, max }, out: A.passes(/** @type {any} */ (s), /** @type {number} */ (max)) });
  return `{"name": "exam.goethe-b1", "about": "domain/grade.js over the 14 Goethe B1 tests: answer keys, item numbers, Teil ids, and grade() with passes/weakSkills/byTeil over synthetic answer sheets (inputs stored). Captured from the Goethe-only grader before exam-def@1.", "regenerate": "node tests/vectors/generate-exam.mjs",\n"vectors": [\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const text = await make(check);
  if (check) {
    const want = readFileSync(OUT, 'utf8');
    if (text !== want) { console.error('exam.goethe-b1.json differs'); process.exit(1); }
    console.log('exam vectors: unchanged');
  } else { writeFileSync(OUT, text); console.log(`wrote ${path.relative(ROOT, OUT)}`); }
}
