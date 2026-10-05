#!/usr/bin/env node
// A language's course content (round 3, C3b; French first): what the app's review round for that language asks.
//
//   node tools/build-course.mjs fr            build content/igloo/chunks/accept_french.json, content/igloo/words/fr.json
//                                             and content/course/fr.json from the authored parts
//   node tools/build-course.mjs fr --check    the same, in memory: fails when a file is out of date or a rule fails
//
// Sources (authoring/, reviewed by a native editor in a separate pass; the reviewer's handle and day are in
// authoring/chunks/accept/<lang>/REVIEW.json and stamped on every entry they reviewed):
//   authoring/chunks/accept/<lang>/p*.json    accepted typed answers per phrase (tools/validate_accept.py checks them)
//   authoring/words/<code>/*.json             the core word list (nouns with gender, verbs with their forms …)
//   content/igloo/chunks/<lang>.json          the phrase translations and model sentences (Igloo's)
//   content/igloo/chunks/en.json              the English sentences the cards show
// Output:
//   content/course/<code>.json (course@1): {lang, reviewedBy, reviewedAt, phrases: {id: {en, hl, ex, n, accept, level,
//     cat, fn}}}, the phrase cards in the course's order (level, then the bank's order)
//   content/igloo/words/<code>.json (lexicon@1): the word list, each entry stamped with its review
//   content/igloo/chunks/accept_<lang>.json (phrases-accept@1): the accepted answers, each entry stamped
// Rules checked with the app's own code and the language's pack (src/lang/<code>/): every model sentence matches one
// of its patterns, no pattern of a phrase is empty, no sticky-error detector fires on a model sentence or a word's
// example, the word list passes the pack's validateForms, and every word's example holds the word.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Match from '../src/domain/match.js';
import Det from '../src/domain/detect.js';
import { packFor } from '../src/lang/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * Build a course's files in memory. @param {string} code 'fr'
 * @returns {{files: Record<string, string>, errors: string[], counts: Record<string, number>}}
 */
export function buildCourse(code) {
  const pack = packFor(code);
  if (!pack) throw new Error(`no full language pack for ${code}`);
  const lang = pack.legacyId;
  const errors = [];
  const adir = `authoring/chunks/accept/${lang}`;
  const review = J(`${adir}/REVIEW.json`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(review.reviewedBy || '') || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt || '')) errors.push(`${adir}/REVIEW.json: reviewedBy (a handle) and reviewedAt (YYYY-MM-DD)`);
  const stamp = { reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt };
  /** @type {Record<string, any>} */ const accept = {};
  for (const f of readdirSync(path.join(ROOT, adir)).filter(n => /^p\d+\.json$/.test(n)).sort()) Object.assign(accept, J(`${adir}/${f}`));
  const en = new Map(J('content/igloo/chunks/en.json').map((/** @type {any} */ c, /** @type {number} */ i) => [c.id, { ...c, i }]));
  const tr = J(`content/igloo/chunks/${lang}.json`);
  /** @type {[string, any][]} */ const rows = [];
  for (const [id, a] of Object.entries(accept)) {
    const e = en.get(id), t = tr.chunks[id];
    if (!e || !t || !t.ex) { errors.push(`${id}: no English source or ${lang} model sentence`); continue; }
    if (!String(e.natural_example).toLowerCase().includes(String(a.core_en).toLowerCase())) errors.push(`${id}: core_en is not in the English sentence`);
    const hit = Match.check(t.ex, a.accept, { anywhere: true, pack });
    if (!hit.ok) errors.push(`${id}: the model sentence matches no pattern (app matcher): ${t.ex}`);
    const det = Det.run(t.ex, { model: t.ex }, hit, {}, pack);
    if (det) errors.push(`${id}: detector ${det.cls} fires on the model sentence: ${t.ex}`);
    if (!review.ids || !review.ids.includes(id)) errors.push(`${id}: not in the review (${adir}/REVIEW.json ids)`);
    rows.push([id, { en: e.natural_example, hl: a.core_en, ex: t.ex, n: t.n || null, accept: a.accept, level: e.cefr_level || e.level || 'B1',
      cat: e.category, fn: e.pragmatic_function || null, ...(a.weak ? { weak: true } : {}) }]);
  }
  rows.sort((x, y) => LEVELS.indexOf(x[1].level) - LEVELS.indexOf(y[1].level) || /** @type {any} */ (en.get(x[0])).i - /** @type {any} */ (en.get(y[0])).i);
  const course = { lang, ...stamp, phrases: Object.fromEntries(rows) };

  // the word list
  const wdir = `authoring/words/${code}`;
  /** @type {any[]} */ let words = [];
  if (existsSync(path.join(ROOT, wdir))) for (const f of readdirSync(path.join(ROOT, wdir)).filter(n => n.endsWith('.json')).sort()) words.push(...J(`${wdir}/${f}`));
  const order = ['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron'];
  words = words.map((w, i) => ({ w, i })).sort((a, b) => LEVELS.indexOf(a.w.level) - LEVELS.indexOf(b.w.level) || order.indexOf(a.w.pos) - order.indexOf(b.w.pos) || a.i - b.i)
    .map(({ w }, rank) => {
      const out = { id: w.id, w: w.w, art: w.art || '', pl: w.pl ?? null, pos: w.pos, en: w.en, alt: w.alt || [], level: w.level, theme: w.theme || null, rank: rank + 1, zipf: null,
        ex: w.ex || null, exen: w.exen || null };
      for (const k of ['g', 'forms', 'aux', 'pp', 'note', 'fem', 'before']) if (w[k] != null && w[k] !== '') /** @type {any} */ (out)[k] = w[k];
      return { ...out, ...stamp };
    });
  const F = /** @type {any} */ (pack.grammar.forms);
  errors.push(...F.validateForms(null, words));
  const ix = F.formsIndex(words, null);
  for (const w of words) {
    if (!w.ex) { errors.push(`words ${w.id}: no example`); continue; }
    const f = F.formsOf(ix, { lemma: w.w, pos: w.pos, id: `W:${w.id}` });
    if (!f || !F.findForm(w.ex, [w.w, ...f.surface])) errors.push(`words ${w.id}: the example does not hold the word: ${w.ex}`);
    const det = Det.run(w.ex, { model: w.ex }, null, {}, pack);
    if (det) errors.push(`words ${w.id}: detector ${det.cls} fires on the example: ${w.ex}`);
    if (!Array.isArray(w.en) || !w.en.length) errors.push(`words ${w.id}: no English meaning`);
  }
  const acceptOut = Object.fromEntries(Object.entries(accept).map(([id, a]) => [id, { ...a, ...stamp }]));
  const json = (/** @type {any} */ d) => JSON.stringify(d, null, 0) + '\n';
  return {
    files: {
      [`content/course/${code}.json`]: json(course),
      [`content/igloo/words/${code}.json`]: json(words),
      [`content/igloo/chunks/accept_${lang}.json`]: json(acceptOut),
    },
    errors,
    counts: { phrases: rows.length, patterns: rows.reduce((n, [, r]) => n + r.accept.length, 0), words: words.length },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = process.argv[2];
  const check = process.argv.includes('--check');
  if (!code) { console.error('usage: node tools/build-course.mjs <code> [--check]'); process.exit(2); }
  const { files, errors, counts } = buildCourse(code);
  for (const [p, text] of Object.entries(files)) {
    const abs = path.join(ROOT, p);
    const cur = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (check) { if (cur !== text) errors.push(`${p} is out of date: run node tools/build-course.mjs ${code}`); }
    else if (cur !== text) { mkdirSync(path.dirname(abs), { recursive: true }); writeFileSync(abs, text); console.log(`wrote ${p}`); }
  }
  for (const e of errors) console.error(`ERROR ${e}`);
  console.log(`course ${code}: ${counts.phrases} phrases (${counts.patterns} patterns), ${counts.words} words, ${errors.length} error(s)`);
  process.exit(errors.length ? 1 : 0);
}
