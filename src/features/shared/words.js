/* Practice: exam words. The words he saved in mock exams live in the private results repository (data/vocab.json).
   Practice reads that file at runtime with the GitHub token from data/credentials.js github(), keeps a trimmed copy
   in the profile's 'words.exam' collection, and turns each word into a round item that tests the word: its meaning in
   English and its type, answered with the dictionary form, then its key forms and one example sentence.
   Ported from Igloo's b1more.js. trimWords/toItem/inQueue are pure and tested in node; fetchWords takes its fetch. */
import { wordId } from '../../domain/itemids.js';
import { wordTriage } from '../../domain/wordtriage.js';
import { wordType } from '../../domain/forms.js';
import { wordCard, answerForms, maskAnswer } from '../../domain/wordcard.js';
/** @typedef {import('../../domain/forms.js').formsIndex} formsIndex */

export const COLLECTION = 'words.exam';
/** At most one request per 10 minutes. */
export const REFRESH_MS = 10 * 60e3;
const MOD = /** @type {Record<string, string>} */ ({ lesen: 'Lesen', hoeren: 'Hören', schreiben: 'Schreiben', sprechen: 'Sprechen' });

const parse = (/** @type {any} */ s) => { if (!s) return null; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return null; } };

/**
 * vocab.json rows → one record per lemma (earliest test wins), only glossed words with a sentence.
 * @param {any[]} rows @param {Record<string, [string, string]>} wordmap lemma → [word id, level]
 */
export function trimWords(rows, wordmap, has = null) {
  /** @type {Map<string, any>} */ const by = new Map();
  for (const r of rows || []) {
    if (!r || r.deleted || !r.gloss || !(r.lemma || r.word) || !r.sentence) continue;
    const lemma = String(r.lemma || r.word).trim();
    const k = lemma.toLowerCase();   // one record per word whatever its case, as Look up groups them
    if (!by.has(k) || (r.day || 99) < (by.get(k).day || 99)) by.set(k, r);
  }
  const out = [];
  for (const r of by.values()) {
    const lemma = String(r.lemma || r.word).trim();
    const wm = wordmap[lemma] || wordmap[lemma.toLowerCase()] || wordmap[lemma.charAt(0).toUpperCase() + lemma.slice(1)] || null;
    const ex = (parse(r.examples) || []).find((/** @type {any} */ e) => e && e.de && e.de !== r.sentence) || null;
    const det = parse(r.details) || {};
    out.push({ id: wordId(lemma, wordmap, has), lemma, art: (r.gender || '').replace(/[()]/g, '') || null, pl: r.plural || null,
      pos: r.pos || null, gloss: String(r.gloss).split(/[,;]/).map(s => s.trim()).filter(Boolean), sent: r.sentence, form: r.word || lemma,
      ex: ex ? { de: ex.de, en: ex.en || '' } : null, cluster: r.cluster || null, day: r.day || null, module: r.module || null, teil: r.teil || null,
      examDays: r.exam_days || 0, level: wm ? wm[1] : '', conf: (det.confusions || [])[0] || null, zipf: r.zipf || 0 });
  }
  return out.sort((a, b) => (b.examDays - a.examDays) || (b.zipf - a.zipf));
}

/**
 * Whether a trimmed word is in the review queue today: the shared triage (domain/wordtriage.js, UX §3.3).
 * trimWords keeps only glossed words. @param {any} w a trimmed word @param {string} phase clock phase
 */
export const inQueue = (w, phase) => wordTriage({ glossed: true, zipf: w.zipf, examDays: w.examDays, level: w.level }, phase) === 'queue';

const TASK = /** @type {Record<string, string>} */ ({ verb: 'Type the infinitive.', noun: 'Type it with der, die or das.', nounPl: 'Plural only: type it with die.',
  nounName: 'Type the name.', adjective: 'Type the base form.', adverb: 'Type the word.', preposition: 'Type the word.', number: 'Type the word.', word: 'Type the German word.' });

/**
 * A trimmed word → a round item that tests the word itself: the prompt is the English
 * meaning and the word type, the answer is the dictionary form (a verb's infinitive, a noun with its article, an
 * adjective's base form), graded by the real grader. After the answer the card shows the key forms (domain/forms.js,
 * from validated content) and ONE example: his exam sentence cut to the clause with the word, with "From Test N ·
 * Module" under it, else the word list's example. The card id is the word's id as before (W:/BW:), so its schedule
 * and history carry over.
 * @param {any} w a trimmed word (trimWords)
 * @param {{ix?: ReturnType<typeof formsIndex> | null, verbs?: Set<string> | null}} [o] ix: forms index (formsIndex over the word list and
 *   content b1.forms); without it the card falls back to the exam list's own article
 */
export function toItem(w, { ix = null, verbs = null } = {}) {
  const src = `From Test ${w.day || '?'}${w.module ? ' · ' + (MOD[w.module] || w.module) : ''}`;
  const made = ix ? wordCard(ix, { lemma: w.lemma, pos: w.pos, id: w.id, zipf: w.zipf || null, level: w.level || null, conf: w.conf, sent: w.sent, form: w.form, src, verbs,
    fallbacks: [w.ex ? { de: w.ex.de, en: w.ex.en || null } : null] }) : null;
  const type = made ? made.card.type : wordType(w.pos) || 'word';
  const art = type === 'noun' && w.art ? String(w.art).split('/')[0] : null;
  const accept = made ? made.accept : [art ? `${art} ${w.lemma}` : w.lemma];
  const head = made ? made.card.head : accept[0];
  const forms = made ? made.forms : answerForms(accept);
  const task = type === 'noun' ? (made?.card.pluralNote === 'only' ? TASK.nounPl : /^(der|die|das) /.test(head) ? TASK.noun : TASK.nounName) : TASK[type] || TASK.word;
  return { id: w.id, kind: 'word', area: 'words', group: w.cluster || 'words', teil: null, fn: null, star: false, trap: null, focus: ['word'], strict: [],
    plan: 'recall', task, prompt: maskAnswer(w.gloss.join(', '), forms, head), promptLang: 'en', hl: null, partner: null, prefill: null,
    gap: false, showGap: false, accept, anywhere: false, literal: true, loose: false,
    model: head, wrong: [], rule: '', src: 'exam', level: w.level || 'B1', gloss: null, zipf: w.zipf || null,
    card: made ? made.card : { type, head, forms: null, pres: null, plural: null, pluralNote: null, level: w.level || null, zipf: w.zipf || null, ex: null, exAt: null, exSrc: null, exEn: null, conf: w.conf } };
}

/**
 * Round items for the words that pass triage today. @param {any[]} words @param {string} phase
 * @param {{ix?: ReturnType<typeof formsIndex> | null, verbs?: Set<string> | null}} [o]
 */
export const wordItems = (words, phase, o = {}) => (words || []).filter(w => inQueue(w, phase)).map(w => toItem(w, o)).filter(Boolean);

/**
 * Read data/vocab.json from the private repository. Returns the next cache value and what changed.
 * @param {{token: string | null, cached: any, wordmap: Record<string, [string, string]>, url: string, fetch: typeof fetch, now: number, online?: boolean, force?: boolean}} o
 * @returns {Promise<{state: 'ok'|'cached'|'no-token'|'error', cache: any, added: string[], error?: string}>}
 */
export async function fetchWords({ token, cached, wordmap, url, fetch: f, now, online = true, force = false, has = null }) {
  if (!token) return { state: 'no-token', cache: cached, added: [] };
  if (!online || (!force && cached && now - cached.fetchedAt < REFRESH_MS)) return { state: 'cached', cache: cached, added: [] };
  try {
    const r = await f(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json',
      ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) }, cache: 'no-store' });
    if (r.status === 304 && cached) return { state: 'ok', cache: { ...cached, fetchedAt: now }, added: [] };
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    const rows = Array.isArray(body) ? body : body.words || [];
    const words = trimWords(rows, wordmap, has);
    const prev = new Set((cached?.words || []).map((/** @type {any} */ w) => w.id));
    const added = cached ? words.filter(w => !prev.has(w.id)) : [];
    return { state: 'ok', added: added.map(w => w.id), cache: { v: 1, fetchedAt: now, etag: r.headers.get('etag'), total: rows.filter((/** @type {any} */ x) => x && !x.deleted).length,
      words, added: added.map(w => w.id), addedTest: added.length ? Math.max(...added.map(w => w.day || 0)) : null } };
  } catch (e) {
    return { state: 'error', cache: cached, added: [], error: /** @type {Error} */ (e).message };
  }
}
