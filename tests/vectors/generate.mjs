// Golden vectors: the exact outputs of the grader, the scheduler, the clock and the day budget for a fixed set of
// inputs, so a refactor (the language pack, a Swift or server port) can be checked byte for byte.
//
//   node tests/vectors/generate.mjs           write tests/vectors/*.json from the code in this checkout
//   node tests/vectors/generate.mjs --check   compare (what tests/unit/vectors.test.mjs does)
//
// match.de.*.json  every grading-corpus answer (right and wrong) with the full result object the round gets
//                (features/practice/grade.js gradeAnswer; Word building cards: domain/wordbuild-grade.js gradeTyped),
//                in three shards by card id (each under the privacy check's 5 MB): trainer (B1 trainer, Schreiben,
//                bank phrases, corrections), grammar (grammar items, exam and script words), clusters (word clusters
//                and Word building). The INPUTS are stored in the files: the check re-grades exactly those answers,
//                so new corpus generators do not change them until the files are written again.
// fsrs.json      domain/fsrs.js: rate() over its flags, schedule() over answer sequences in every phase, dueFor(),
//                R(), interval(), recap()
// clock.json     core/clock.js: phase(), context(), today() at local times around the 04:00 cutoff, the labels
// budget.json    domain/budget.js: allowance() over modes, settings and decks, mode, buildShare, streamQuota
//
// When a change alters results on purpose, write the vectors in a commit of their own and list every changed entry
// with its reason in the commit message (round 3, lane A2).
//
// Numbers that are not whole are written with 12 significant digits (a port need not match the last bits of exp/pow).
// Dates: every input is a study day or a local wall-clock time, so the vectors are the same in every time zone.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const imp = (/** @type {string} */ p) => import(pathToFileURL(path.join(ROOT, p)).href);

/** JSON with stable number formatting. */
const norm = (/** @type {any} */ v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'number' && !Number.isInteger(x) && Number.isFinite(x) ? Number(x.toPrecision(12)) : x)));
/** One entry per line: line-based diffs in git and in the test's failure message. @param {string} head @param {any[]} rows */
const lines = (head, rows) => `{${head},\n"vectors": [\n${rows.map(r => JSON.stringify(norm(r))).join(',\n')}\n]}\n`;
const header = (/** @type {string} */ name, /** @type {string} */ about) => `"name": ${JSON.stringify(name)}, "about": ${JSON.stringify(about)}, "regenerate": "node tests/vectors/generate.mjs"`;

/* ---------------- match.de ---------------- */

/** The answers to grade: [{id, move, text, want, cls}] from the corpus, or the inputs stored in the file. */
export const SHARDS = /** @type {Record<string, string[]>} */ ({
  trainer: ['BP', 'BT', 'BR', 'BG', 'BL', 'BS', 'BX', 'K', 'F'],
  grammar: ['G', 'W', 'SW'],
  clusters: ['CF', 'CO', 'CP', 'PV', 'PS', 'PW'],
});
const shardOf = (/** @type {string} */ id) => Object.keys(SHARDS).find(k => SHARDS[k].includes(id.split(':')[0])) || 'trainer';
/** @param {{fromFile?: boolean, shard: string}} o */
export async function matchInputs({ fromFile = false, shard }) {
  if (fromFile) return JSON.parse(readFileSync(path.join(HERE, `match.de.${shard}.json`), 'utf8')).vectors.map((/** @type {any} */ v) => ({ id: v.id, move: v.move, text: v.text, want: v.want, cls: v.cls }));
  const { buildCorpus } = await import('../corpus/grading-corpus.mjs');
  const { corpus } = await buildCorpus();
  return corpus.filter((/** @type {any} */ c) => shardOf(c.id) === shard).map((/** @type {any} */ c) => ({ id: c.id, move: c.move || null, text: c.text, want: c.want, cls: c.cls }));
}

/** @param {{id: string, move: string|null, text: string, want: string, cls: string}[]} inputs @param {string} shard */
export async function matchVectors(inputs, shard) {
  const { buildData } = await import('../corpus/grading-corpus.mjs');
  const data = await buildData();
  const { gradeAnswer } = await imp('src/features/practice/grade.js');
  const { gradeTyped } = await imp('src/domain/wordbuild-grade.js');
  const rows = inputs.map(c => {
    const it = data.byId.get(c.id);
    if (!it) return { ...c, result: 'MISSING ITEM' };
    const move = c.move ? it.moves.find((/** @type {any} */ m) => m.key === c.move) : null;
    const result = it.src === 'wordbuild' ? gradeTyped(c.text, { accept: it.accept, noun: !!it.noun, lexicon: data.wbLexicon }) : gradeAnswer(it, c.text, move, data);
    return { ...c, result };
  });
  return lines(header(`match.de.${shard}`, `Grading-corpus answers (cards ${SHARDS[shard].join(', ')}) and the full result the round gets (gradeAnswer; gradeTyped for Word building).`), rows);
}

/* ---------------- fsrs ---------------- */

/** A small deterministic PRNG (mulberry32). @param {number} a */
function rng(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export async function fsrsVectors() {
  const FS = (await imp('src/domain/fsrs.js')).default;
  const { context } = await imp('src/core/clock.js');
  const D8 = await imp('src/domain/days.js');
  const rows = [];
  // rate(): no flag and each flag alone, over ok, the time limit, the time taken, the stage and the last rating
  const flags = ['revealed', 'selfRepair', 'capSlip', 'umlaut', 'punct', 'claudeMinor', 'partial'];
  for (const ok of [true, false]) for (const limit of [null, 10]) for (const ms of [2000, 4000, 12000, 25000]) for (const stage of [0, 2]) for (const prevRating of [3, 4]) for (const flag of [null, ...flags]) {
    const o = { ok, limit, ms, stage, prevRating, ...Object.fromEntries(flags.map(k => [k, k === flag])) };
    rows.push({ fn: 'rate', in: o, out: FS.rate(o) });
  }
  // R and interval over a grid
  for (const S of [0.1, 0.4872, 1, 2.5, 7, 30, 120, 400]) {
    for (const t of [0, 1, 3, 10, 60]) rows.push({ fn: 'R', in: [t, S], out: FS.R(t, S) });
    for (const r of [0.9, 0.92]) rows.push({ fn: 'interval', in: [S, r], out: FS.interval(S, r) });
  }
  // dueFor in every phase, with and without a forecast
  const EXAM = '2026-10-09';
  const days = ['2026-09-01', '2026-09-28', '2026-10-04', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'];
  for (const today of days) for (const exam of [EXAM, null]) for (const S of [0.5, 2, 6, 15, 40, 200]) for (const fc of [false, true]) {
    const c = context({ today, exam });
    const ctx = { ...c, forecast: fc ? (/** @type {string} */ d) => (D8.diff(today, d) * 7) % 5 : undefined };
    rows.push({ fn: 'dueFor', in: { S, today, exam, phase: c.phase, forecast: fc ? '(diff*7)%5' : null }, out: FS.dueFor(S, ctx) });
  }
  // schedule(): answer sequences over days, in every phase; one record per step
  const rand = rng(2026);
  for (let seq = 0; seq < 60; seq++) {
    const exam = seq % 3 === 0 ? null : EXAM;
    let today = D8.add('2026-09-10', Math.floor(rand() * 30));
    /** @type {any} */ let rec = seq % 7 === 0 ? { src: 'exam' } : null;
    if (seq % 11 === 0) rec = { S: 40, D: 4, reps: 5, lapses: 0, last: '2026-09-01', first: '2026-08-01', due: '2026-09-20', stage: 2, streak: 1, learn: null, relearn: false, hist: [], known: { by: 'sort', on: '2026-09-01' } };
    for (let step = 0; step < 8; step++) {
      const g = 1 + Math.floor(rand() * 4), sameDay = rand() < 0.35;
      if (!sameDay) today = D8.add(today, 1 + Math.floor(rand() * 6));
      const c = context({ today, exam });
      const o = { g, ms: Math.floor(rand() * 20000), onTime: rand() < 0.7, mode: rand() < 0.8 ? 't' : 's', flags: rand() < 0.2 ? 'y' : '', logOnly: rand() < 0.05, src: step === 0 && seq % 5 === 0 ? 'practice' : undefined };
      const now = 1790000000000 + seq * 1e6 + step * 1e3;
      const r = FS.schedule(rec, o, { ...c, forecast: () => 0 }, now);
      rows.push({ fn: 'schedule', seq, step, in: { rec, o, today, exam, phase: c.phase, now }, out: r });
      if (r.rec) rec = r.rec;
    }
  }
  // recap: the exam moves earlier
  const store = /** @type {Record<string, any>} */ ({});
  for (let i = 0; i < 30; i++) store[`id${String(i).padStart(2, '0')}`] = { reps: i % 5 ? 2 : 0, due: D8.add('2026-10-01', i % 15), ...(i % 9 === 0 ? { known: { by: 'sort', on: '2026-09-01' } } : {}) };
  for (const [today, exam] of [['2026-10-01', '2026-10-06'], ['2026-10-01', '2026-10-09'], ['2026-10-05', '2026-10-06'], ['2026-10-01', null], ['2026-10-12', '2026-10-09']]) {
    const c = context({ today, exam });
    rows.push({ fn: 'recap', in: { today, exam, phase: c.phase }, out: FS.recap(store, c) });
  }
  return lines(header('fsrs', 'domain/fsrs.js outputs; recap() runs on a fixed 30-card store built in generate.mjs.'), rows);
}

/* ---------------- clock ---------------- */

export async function clockVectors() {
  const C = await imp('src/core/clock.js');
  const D8 = await imp('src/domain/days.js');
  const rows = [];
  const EXAMS = [null, '2026-10-09', '2026-03-29', '2026-10-25', 'not-a-day'];
  for (let i = -3; i <= 40; i++) {
    const today = D8.add('2026-09-29', i);
    for (const exam of EXAMS) rows.push({ fn: 'context', in: { today, exam }, out: C.context({ today, exam }) });
  }
  // today(): local wall-clock times around the cutoff, month and year ends and the DST changes in Europe and the US
  const times = [[2026, 9, 5, 0, 0], [2026, 9, 5, 1, 30], [2026, 9, 5, 3, 59], [2026, 9, 5, 4, 0], [2026, 9, 5, 23, 59], [2026, 0, 1, 2, 0],
    [2026, 2, 1, 3, 0], [2026, 2, 29, 12, 0], [2026, 9, 25, 12, 0], [2026, 10, 1, 12, 0], [2026, 2, 8, 12, 0], [2026, 11, 31, 23, 0]];
  for (const [y, m, d, h, min] of times) for (const cutoff of [0, 4, 6]) rows.push({ fn: 'today', in: { local: [y, m + 1, d, h, min], cutoff }, out: C.today(new Date(y, m, d, h, min), cutoff) });
  for (const [a, b] of [['2026-10-05', '2026-10-09'], ['2026-03-28', '2026-03-30'], ['2026-10-24', '2026-10-26'], ['2026-12-31', '2027-01-01'], ['2026-10-09', '2026-10-05']]) {
    rows.push({ fn: 'diff', in: [a, b], out: C.diff(a, b) });
    rows.push({ fn: 'add', in: [a, 3], out: C.add(a, 3) });
    rows.push({ fn: 'add', in: [a, -40], out: C.add(a, -40) });
  }
  for (const s of ['2026-10-09', '2026-02-30', '2026-13-01', '26-10-09', 20261009, null]) rows.push({ fn: 'isDay', in: s, out: C.isDay(s) });
  for (const d of ['2026-10-09', '2026-09-01', '2027-01-31']) {
    rows.push({ fn: 'label', in: [d, 'en'], out: C.label(d, 'en') });
    rows.push({ fn: 'labelLong', in: [d, 'en'], out: C.labelLong(d, 'en') });
    rows.push({ fn: 'weekdayShort', in: [d, 'en'], out: C.weekdayShort(d, 'en') });
  }
  return lines(header('clock', 'core/clock.js outputs. today() inputs are local wall-clock times [y, month 1-12, d, h, min].'), rows);
}

/* ---------------- budget ---------------- */

export async function budgetVectors() {
  const B = await imp('src/domain/budget.js');
  const { context } = await imp('src/core/clock.js');
  const rows = [];
  const EXAM = '2026-10-09';
  const ctxs = [['2026-09-20', EXAM], ['2026-10-05', EXAM], ['2026-10-06', EXAM], ['2026-10-07', EXAM], ['2026-10-08', EXAM], ['2026-10-09', EXAM], ['2026-10-12', EXAM], ['2026-10-05', null]];
  const settingsList = [
    { minutesPerDay: 60, newPerDay: null, exam: { type: 'goethe-b1' } },
    { minutesPerDay: 30, newPerDay: null, exam: { type: 'goethe-b1' } },
    { minutesPerDay: 90, newPerDay: null, exam: null },
    { minutesPerDay: 60, newPerDay: 15, rev: { newPerDay: 'x' }, exam: { type: 'goethe-b1' } },
    { minutesPerDay: 60, newPerDay: 30, exam: { type: 'goethe-b1' } },   // carried over from Igloo: counts as Auto
    { minutesPerDay: 45, newPerDay: null, practice: { buildNew: 12 } },
    { practice: { buildNew: 99 } },
  ];
  // deck inputs: none; a light day; a heavy day; decks with little open; new items already shown (a round over its share)
  const deckSets = [
    {},
    { b1: { due: 12 }, writing: { due: 3, open: 40 }, speak: { due: 4 }, mistakes: { due: 2, open: 3 } },
    { b1: { due: 160, open: 500 }, writing: { due: 30, open: 60 }, speak: { due: 40, open: 100 }, mistakes: { due: 10, open: 8 }, script: { due: 20, open: 30 }, build: { due: 15, open: 50 }, clusters: { due: 25, open: 80 } },
    { b1: { due: 5, open: 3 }, writing: { due: 0, open: 0 }, speak: { due: 1, open: 2 }, build: { due: 0, open: 4 }, clusters: { due: 0, open: 2 } },
    { b1: { due: 30, shown: 10 }, writing: { due: 6, open: 40, shown: 4 }, clusters: { due: 0, shown: 50 }, build: { due: 2, shown: 3 } },
  ];
  const extras = [
    {},
    { priorityLeft: 120, focus: true, fixedMin: 15 },
    { priorityLeft: 0, goals: { script: true, build: true, clusters: true }, scripts: 2, examDecks: { script: 1 } },
    { fresh: { day: 0 } },
    { fresh: { day: 4 }, goals: { clusters: true } },
  ];
  for (const [today, exam] of ctxs) {
    const c = context({ today, exam });
    for (const fresh of [null, { day: 2 }]) rows.push({ fn: 'mode', in: { today, exam, fresh }, out: B.mode(c, fresh) });
    for (const settings of settingsList) for (let a = 0; a < deckSets.length; a++) for (const x of extras) {
      const inp = { decks: deckSets[a], ...x };
      rows.push({ fn: 'allowance', in: { today, exam, settings, ...inp }, out: B.allowance({ c, settings, ...inp }) });
    }
  }
  for (const s of settingsList) rows.push({ fn: 'buildShare', in: s, out: B.buildShare(s) }, { fn: 'newPerDayChosen', in: s, out: B.newPerDayChosen(s) });
  for (const n of [0, 1, 4, 11, 20, 55]) for (const st of ['p', 'g']) rows.push({ fn: 'streamQuota', in: [n, st], out: B.streamQuota(n, st) });
  return lines(header('budget', 'domain/budget.js outputs (allowance, mode, buildShare, newPerDayChosen, streamQuota). Infinity is written as null.'), rows);
}

/* ---------------- CLI ---------------- */

export const FILES = {
  ...Object.fromEntries(Object.keys(SHARDS).map(shard => [`match.de.${shard}.json`, async (/** @type {boolean} */ fromFile) => matchVectors(await matchInputs({ fromFile, shard }), shard)])),
  'fsrs.json': fsrsVectors,
  'clock.json': clockVectors,
  'budget.json': budgetVectors,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  let bad = 0;
  for (const [name, make] of Object.entries(FILES)) {
    if (only.length && !only.includes(name)) continue;
    const file = path.join(HERE, name);
    // --check re-grades the stored inputs; writing match.de.*.json takes the current corpus (--keep-inputs: the stored ones)
    const text = await make(check || process.argv.includes('--keep-inputs'));
    if (check) {
      const same = readFileSync(file, 'utf8') === text;
      if (!same) bad++;
      console.log(`${name}: ${same ? 'same' : 'DIFFERS'}`);
    } else { writeFileSync(file, text); console.log(`wrote ${name} (${text.length} bytes)`); }
  }
  process.exit(bad ? 1 : 0);
}
