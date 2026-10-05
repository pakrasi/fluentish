/* Look up › Exam words: the words captured in mock-test reviews, with the glosses, examples and details added to them
   in the private results repository (data/vocab.json). Pure except fetchVocab, whose fetch is injected; tested in
   node (tests/unit/lookup-words.test.mjs) with a mocked GitHub API.

   fetchVocab({token, repo, api, fetch})  → raw word entries; throws VocabError('auth' | 'net' | 'http')
   mergeVocab(remote, local, events)       → remote words plus captures on this device not yet imported, minus deletes
   lemmaGroups(words)                      → one group per lemma (several captured forms of the same word)
   triage(group, phase, wordmap)           → the shared triage (domain/wordtriage.js): waiting | later | queue | reference
   cardId(group, wordmap)                  → the group's review card id, the same one Practice schedules (domain/itemids.js)
   headword(g), examples(g), details(g), freqBand(zipf), sources(g)
   The capture format is b1-exam's (docs/SCHEMA.md › vocab.local): {day, module, teil, word, word_key, lemma, gloss,
   gender, plural, pos, note, cluster, zipf, exam_days, sentence, sentence_en, examples (JSON), details (JSON), box,
   due, reviews, deleted}. */

import { wordId } from '../../domain/itemids.js';
import { langAttr } from '../../core/lang.js';
import { wordTriage, wordLevel, frequent as isFrequent } from '../../domain/wordtriage.js';

export class VocabError extends Error {
  /** @param {'auth' | 'net' | 'http'} code @param {string} msg */
  constructor(code, msg) { super(msg); this.code = code; }
}

/** b1-exam's word key: lower case, letters and digits only. @param {string} w */
export const wordKey = w => String(w || '').trim().toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');

/**
 * Read data/vocab.json from the private results repository through the GitHub contents API.
 * A missing file is an empty list (a new repository); 401/403 means the device link is no longer valid.
 * @param {{token: string, repo: string, api: string, fetch?: typeof fetch}} o
 * @returns {Promise<any[]>}
 */
export async function fetchVocab({ token, repo, api, fetch: f = (...a) => fetch(...a) }) {
  let r;
  try {
    r = await f(`${api}/repos/${repo}/contents/data/vocab.json`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json' },
      cache: 'no-store',
    });
  } catch (e) { throw new VocabError('net', String(/** @type {any} */ (e)?.message || e)); }
  if (r.status === 404) return [];
  if (r.status === 401 || r.status === 403) throw new VocabError('auth', `GitHub ${r.status}`);
  if (!r.ok) throw new VocabError('http', `GitHub ${r.status}`);
  let j;
  try { j = await r.json(); } catch { throw new VocabError('http', 'vocab.json is not JSON'); }
  return Array.isArray(j?.words) ? j.words : Array.isArray(j) ? j : [];
}

/**
 * @param {any[]} remote   data/vocab.json words
 * @param {any[]} local    vocab.local: captures made on this device (synced or not)
 * @param {any[]} events   vocab.events: reviews and deletes made on this device
 */
export function mergeVocab(remote = [], local = [], events = []) {
  const key = (/** @type {any} */ w) => `${w.day}:${wordKey(w.word_key || w.word)}`;
  const by = new Map();
  for (const w of remote || []) if (w && w.word) by.set(key(w), { ...w });
  for (const w of local || []) if (w && w.word && !by.has(key(w))) by.set(key(w), { ...w, local: true });
  for (const ev of events || []) if (ev && ev.action === 'delete') by.delete(`${ev.day}:${wordKey(ev.word)}`);
  return [...by.values()].filter(w => !w.deleted);
}

const FIELDS = ['gloss', 'gender', 'plural', 'note', 'pos', 'cluster', 'zipf', 'exam_days', 'sentence', 'sentence_en', 'examples', 'details'];

/**
 * @param {any[]} words
 * @returns {any[]} groups {key, lemma, entries, forms: string[], days: number[], ...first non-empty FIELDS}
 */
export function lemmaGroups(words) {
  const m = new Map();
  for (const w of words) {
    const lemma = String(w.lemma || w.word).trim();
    const k = lemma.toLowerCase();
    let g = m.get(k);
    if (!g) { g = { key: k, lemma, entries: [], forms: new Set(), days: new Set() }; m.set(k, g); }
    g.entries.push(w); g.forms.add(w.word);
    if (w.day) g.days.add(Number(w.day));
    for (const f of FIELDS) if (g[f] == null && w[f] != null && w[f] !== '') g[f] = w[f];
  }
  return [...m.values()].map(g => {
    g.forms.delete(g.lemma);
    return { ...g, forms: [...g.forms], days: [...g.days].sort((a, b) => a - b) };
  });
}

/**
 * The review card of a captured word: 'W:<word id>' or 'BW:<slug>' through wordId(), exactly as Practice keys it.
 * @param {any} g a lemma group @param {Record<string, [string, string]>} wordmap
 */
export const cardId = (g, wordmap, has = null) => wordId(g.lemma, wordmap, has);

/** Importance (b1-exam): frequency plus how many of the 14 tests use it. @param {any} g */
export const importance = g => (g.zipf ?? 3) + 1.5 * ((g.exam_days ?? 1) / 14);

/** @param {any[]} groups */
export const byImportance = groups => [...groups].sort((a, b) => importance(b) - importance(a) || a.lemma.localeCompare(b.lemma, langAttr()));

/** Frequent enough for the queue in an exam week (UX §3.3). @param {any} g */
export const frequent = g => isFrequent({ zipf: g.zipf, examDays: g.exam_days });

/**
 * Where a captured word stands (UX §3.3), by the rule Practice uses to fill rounds (domain/wordtriage.js).
 * @param {any} g @param {string} phase clock phase @param {Record<string, [string, string]>} [wordmap] for the word's level
 * @returns {'waiting' | 'later' | 'queue' | 'reference'}
 */
export const triage = (g, phase, wordmap = {}) =>
  wordTriage({ glossed: !!g.gloss, zipf: g.zipf, examDays: g.exam_days, level: wordLevel(g.lemma, wordmap) }, phase);

/** "die Nachbarschaft" (article only for nouns, without b1-exam's brackets). @param {any} g */
export const headword = g => [String(g.gender || '').replace(/[()]/g, '').trim(), g.lemma].filter(Boolean).join(' ');

/** @param {string | any} v */
function parseJson(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * The exam sentence first, then the examples added later. Each: {de, en, form}.
 * @param {any} g
 */
export function examples(g) {
  const out = [];
  const orig = g.entries.find((/** @type {any} */ e) => e.sentence);
  if (orig) out.push({ de: orig.sentence, en: orig.sentence_en || null, form: orig.word, exam: true });
  for (const ex of parseJson(g.examples, [])) if (ex && ex.de) out.push({ de: ex.de, en: ex.en || null, form: ex.form || g.lemma });
  return out;
}

/** {usage, colloquial[], chunks[], family[], etymology, confusions} @param {any} g */
export const details = g => parseJson(g.details, {}) || {};

/** Zipf frequency bands (b1-exam). @param {number | null | undefined} z @returns {'very' | 'common' | 'mid' | 'rare' | null} */
export function freqBand(z) {
  if (z == null) return null;
  return z >= 5 ? 'very' : z >= 4.3 ? 'common' : z >= 3.5 ? 'mid' : 'rare';
}

/** "Test 1 · Lesen Teil 1" for each capture, unique. @param {any} g @param {(n: number) => string} testName */
export function sources(g, testName) {
  const MOD = /** @type {Record<string, string>} */ ({ lesen: 'Lesen', hoeren: 'Hören', schreiben: 'Schreiben', sprechen: 'Sprechen' });
  const seen = new Set();
  for (const e of g.entries) {
    if (!e.day) continue;
    const mod = MOD[e.module] || e.module || '';
    seen.add([testName(Number(e.day)), [mod, e.teil].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
  }
  return [...seen];
}
