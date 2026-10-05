// Golden vectors for the exam result files (round 3, lane C2b): for a fixed set of synthetic attempts, recordings and
// corrections, the exact file names and bytes the results target writes for sync.py (attemptFile, the repository
// path and filesFor's bodies and commit messages). Captured from data/sync/github-b1exam.js BEFORE the result-file
// adapter (exam-def@1 `results.adapter`) existed; the adapter must write the same bytes.
//
//   node tests/vectors/generate-exam-results.mjs           write tests/vectors/exam-results.b1-exam.json
//   node tests/vectors/generate-exam-results.mjs --check   compare (tests/unit/exam-vectors.test.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'exam-results.b1-exam.json');
const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** Synthetic attempts in the shapes the app stores: new ones (submitAttempt), ones moved from the old app, odd ones. */
export function attempts() {
  const G = JSON.parse(readFileSync(path.join(HERE, 'exam.goethe-b1.json'), 'utf8')).vectors;
  const graded = (/** @type {number} */ n, /** @type {string} */ m, /** @type {string} */ s) => G.find((/** @type {any} */ v) => v.fn === 'grade' && v.in.test === n && v.in.module === m && v.in.sheet === s).out;
  const base = (/** @type {number} */ i, /** @type {Record<string, any>} */ over) => ({
    id: `0192a3b4-c5d6-7e8f-9a0b-0000000000${pad2(i)}`, profileId: '0192a3b4-c5d6-7e8f-9a0b-000000000001', deviceId: 'dev1',
    createdAt: '2026-10-03T14:04:05.000-04:00', examId: 'goethe-b1', contentVersion: 'f812b3c8eb46', day: 1, module: 'lesen',
    started_at: '2026-10-03T13:00:00.000-04:00', submitted_at: '2026-10-03T14:04:05.000-04:00', duration_s: 3845, score: null, max_score: 30,
    meta: { pauses: { count: 0, seconds: 0 } }, responses: [], writings: [], synced: false, ...over,
  });
  const out = [];
  let i = 0;
  for (const [n, m, s] of /** @type {[number, string, string][]} */ ([[1, 'lesen', 'right'], [3, 'lesen', 'noisy'], [7, 'hoeren', 'random1'], [14, 'hoeren', 'blank'], [9, 'lesen', 'partial']])) {
    const g = graded(n, m, s);
    out.push(base(++i, { day: n, module: m, score: g.score, max_score: g.max_score, responses: g.results, meta: { pauses: { count: i % 3, seconds: 17 * i } } }));
  }
  out.push(base(++i, { day: 2, module: 'schreiben', max_score: 100, writings: [
    { aufgabe: 'aufgabe1', text: 'Liebe Anna,\n\nvielen Dank für deine Einladung. Leider kann ich nicht kommen, weil ich arbeiten muss.\n\nViele Grüße', word_count: 18 },
    { aufgabe: 'aufgabe2', text: 'Ich finde, dass „Homeoffice“ Vorteile hat – aber auch Nachteile.', word_count: 10 },
    { aufgabe: 'aufgabe3', text: '', word_count: 0 }] }));
  out.push(base(++i, { day: 12, module: 'sprechen', max_score: 100, meta: { topic: 'Thema A: Wohnen in der Stadt', recorded: { teil1: true, teil2: true }, pauses: { count: 1, seconds: 42 } },
    writings: [{ aufgabe: 'sprechen-notizen', text: 'Teil 1:\nSamstag? Bahnhof 10 Uhr\n\nFolie 1: …', word_count: 8 }] }));
  // moved from the old app: no started_at or duration, a legacy id and path, given values with no correct flag type
  out.push({ id: 'legacy-17', day: 4, module: 'lesen', submitted_at: '2026-09-28T19:00:00', score: 21, max_score: 30, legacy: { id: 17, path: 'data/attempts/20260928T230000-day04-lesen.json' },
    responses: [{ item_id: 'L1-1', teil: 'L1', skill: 'detail', given: 'r', correct: 'r', is_correct: true }, { item_id: 'L1-2', teil: 'L1', skill: 'negation', correct: 'f', is_correct: false }] });
  // missing pieces: no meta, no writings text, no word counts
  out.push({ id: 'odd-1', day: 10, module: 'schreiben', submitted_at: '2026-10-01T08:00:00Z', max_score: 100, writings: [{ aufgabe: 'aufgabe1' }, { aufgabe: 'aufgabe2', text: 'Hallo' }] });
  return out;
}

/** Recordings and corrections, as the payloads the exam feature records. */
export function events() {
  return [
    { type: 'exam.voice', at: '2026-10-03T18:04:05.000Z', payload: { day: 12, module: 'sprechen', part: 'teil1', label: 'Sie möchten mit einem Freund einen Ausflug planen.', mime: 'audio/mp4', bytes: 31337, created_at: '2026-10-03T14:04:05.000-04:00', blobRef: 'b1', ext: 'm4a' } },
    { type: 'exam.voice', at: '2026-10-03T18:14:59.000Z', payload: { day: 3, module: 'sprechen', part: 'teil3', label: '', mime: 'audio/webm;codecs=opus', bytes: 2048, created_at: '2026-10-03T14:14:59.000-04:00', blobRef: 'b2', ext: 'webm' } },
    { type: 'feedback.created', at: '2026-10-03T19:00:00.000Z', payload: { day: 2, module: 'schreiben', attempt_id: 17, attempt_file: 'data/attempts/20261003T180405-day02-schreiben.json', body: '! circa 62 / 100 · bestanden\n~~weil ich habe~~ → ==weil ich … habe==\n_Verb am Ende._', created_at: '2026-10-03T15:00:00.000-04:00', model: 'claude-x', author: 'ai', promptVersion: 'schreiben-3' } },
    { type: 'feedback.created', at: '2026-10-03T19:00:01.000Z', payload: { day: 11, module: 'schreiben', attempt_id: 'u9', attempt_file: null, body: 'kurz', created_at: '2026-10-03T15:00:01.000-04:00', model: null } },
  ];
}

/** @param {any} gh the result-file functions: { attemptFile, pathFor, filesFor } */
export async function rowsWith(gh) {
  const rows = [];
  const at = Date.UTC(2026, 9, 3, 18, 4, 5);
  for (const [k, a] of attempts().entries()) {
    const file = gh.attemptFile(a);
    const p = gh.pathFor('exam.attempt', { attemptId: a.id, file }, at + k * 1000);
    const files = gh.filesFor({ type: 'exam.attempt', payload: { attemptId: a.id, file }, path: p });
    rows.push({ kind: 'attempt', id: a.id, path: p, files: files.map((/** @type {any} */ f) => ({ path: f.path, message: f.message, body: f.body })) });
  }
  for (const e of events()) {
    const p = gh.pathFor(e.type, e.payload, Date.parse(e.at));
    const blob = e.type === 'exam.voice' ? new Blob([new Uint8Array(e.payload.bytes)], { type: e.payload.mime }) : null;
    const files = gh.filesFor({ type: e.type, payload: e.payload, path: p }, blob);
    rows.push({ kind: e.type, path: p, files: files.map((/** @type {any} */ f) => ({ path: f.path, message: f.message, body: typeof f.body === 'string' ? f.body : { blob: f.body.size, type: f.body.type } })) });
  }
  return rows;
}

const serialise = (/** @type {any[]} */ rows) => `{"name": "exam-results.b1-exam", "about": "The result files (paths, bodies, commit messages) for synthetic attempts, recordings and corrections, as sync.py imports them. Captured from data/sync/github-b1exam.js before the exam-def result-file adapter.", "regenerate": "node tests/vectors/generate-exam-results.mjs",\n"vectors": [\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]}\n`;

/** Through the sync target's exports (what the app calls). */
export async function make() {
  const gh = await import(pathToFileURL(path.join(ROOT, 'src/data/sync/github-b1exam.js')).href);
  return serialise(await rowsWith(gh));
}
/**
 * Through the adapter the Goethe B1 definition names (exam-def@1 results.adapter): its attempt shape, with the target's
 * paths and bodies. Must give the same bytes as make().
 */
export async function makeViaDef() {
  const gh = await import(pathToFileURL(path.join(ROOT, 'src/data/sync/github-b1exam.js')).href);
  const { adapterFor } = await import(pathToFileURL(path.join(ROOT, 'src/domain/exam-results.js')).href);
  const def = JSON.parse(readFileSync(path.join(ROOT, 'content/exams/goethe-b1/exam.json'), 'utf8'));
  const ad = adapterFor(def);
  return serialise(await rowsWith({ attemptFile: ad.attemptFile, pathFor: gh.pathFor, filesFor: gh.filesFor }));
}
export { serialise, OUT };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = await make();
  if (process.argv.includes('--check')) {
    if (text !== readFileSync(OUT, 'utf8')) { console.error('exam-results.b1-exam.json differs'); process.exit(1); }
    console.log('exam result vectors: unchanged');
  } else { writeFileSync(OUT, text); console.log(`wrote ${path.relative(ROOT, OUT)}`); }
}
