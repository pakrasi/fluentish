/* The word panel's data: what a card that asks for one word shows before and after the answer, the same for exam
   words, Word clusters, word-list cards and Quick sort (core/wordpanel.js draws it). Pure; tested in node.

   Before the answer: the word type, the CEFR level and how common the word is (a 5-bar meter from its Zipf
   frequency), and a prompt that never gives the answer away (maskAnswer).
   After the answer: the dictionary form, the key forms (domain/forms.js), ONE example sentence with the word marked,
   its source ("From Test 2 · Lesen") or nothing for the word list's example. */
import { formsOf, pickExample, wordType, findForm } from './forms.js';

/**
 * How common a word is, from its Zipf frequency (log10 of uses per billion words; 7 is "der", 1 is very rare).
 * bars: 1 to 5 for the meter; band: 'very' (5 and up), 'common' (4 to 5), 'less' (below 4).
 * @param {number | null | undefined} zipf
 * @returns {{bars: number, band: 'very' | 'common' | 'less'} | null}
 */
export function freq(zipf) {
  if (!Number.isFinite(zipf) || !zipf) return null;
  const z = /** @type {number} */ (zipf);
  const bars = z >= 5.5 ? 5 : z >= 4.8 ? 4 : z >= 4 ? 3 : z >= 3.2 ? 2 : 1;
  return { bars, band: z >= 5 ? 'very' : z >= 4 ? 'common' : 'less' };
}

/** Most common first, unknown frequencies last; stable. @template T @param {T[]} list @param {(x: T) => number | null | undefined} zipfOf */
export function byFrequency(list, zipfOf) {
  return list.map((x, i) => ({ x, i, z: Number(zipfOf(x)) || 0 })).sort((a, b) => b.z - a.z || a.i - b.i).map(o => o.x);
}

const fold = (/** @type {string} */ s) => String(s).toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');

/**
 * The answer's forms, folded (lower case, umlauts and ß folded): the lemma without article or "sich", and every
 * surface form the forms give (plural, conjugated forms). @param {string[]} answers @param {string[]} [surface]
 */
export function answerForms(answers, surface = []) {
  const out = new Set();
  for (const a of answers) for (const w of String(a).split(/\s+/)) if (!/^(der|die|das|sich)$/i.test(w) && w.length > 1) out.add(fold(w.replace(/[^\p{L}-]/gu, '')));
  for (const s of surface) if (s && s.length > 1) out.add(fold(s));
  out.delete('');
  return out;
}

/**
 * A prompt or gloss with the answer taken out: every word that is a form of the answer becomes "…" ("point of view
 * (aus meiner Sicht)" → "point of view (aus meiner …)"). A gloss word outside brackets and quotes that is only the
 * lemma itself is the English word for it (hotel: das Hotel; the card asks for the article) and stays: cognate().
 * @param {string} text @param {Set<string>} forms answerForms() @param {string} lemma
 */
export function maskAnswer(text, forms, lemma) {
  const s = String(text || '');
  let depth = 0, out = '', i = 0;
  const lem = fold(lemma.replace(/^(der|die|das|sich)\s+/i, ''));
  for (const m of s.matchAll(/[\p{L}-]+|[^\p{L}-]+/gu)) {
    const tok = m[0];
    if (!/\p{L}/u.test(tok)) { for (const ch of tok) { if ('([„“"«'.includes(ch)) depth++; if (')]”"»'.includes(ch) && depth > 0) depth--; } out += tok; continue; }
    const f = fold(tok);
    const hit = forms.has(f);
    out += hit && (depth > 0 || f !== lem || /[äöüß]/i.test(tok)) ? '…' : tok;
    i++;
  }
  return out.replace(/…(\s*…)+/g, '…');
}

/**
 * The words of a text that give the answer away: forms of the answer other than a plain English cognate outside
 * brackets (see maskAnswer). Empty when the text is safe to show before the answer.
 * @param {string} text @param {Set<string>} forms @param {string} lemma
 */
export function leaks(text, forms, lemma) {
  const masked = maskAnswer(text, forms, lemma);
  const lem = fold(lemma.replace(/^(der|die|das|sich)\s+/i, ''));
  return [...masked.matchAll(/[\p{L}-]+/gu)].map(m => m[0]).filter(w => forms.has(fold(w)) && fold(w) !== lem);
}

/**
 * @typedef {object} WordCard
 * @property {string} type     'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition' | 'phrase' | … | 'word'
 * @property {string} head     the dictionary form
 * @property {string | null} forms   the key forms on one line
 * @property {string | null} pres    "er fährt" when irregular
 * @property {string | null} plural  "die Zäune"
 * @property {'none' | 'only' | null} pluralNote
 * @property {string | null} level   CEFR level
 * @property {number | null} zipf
 * @property {string | null} ex      the one example sentence
 * @property {[number, number] | null} exAt  where the word is in it
 * @property {string | null} exSrc   "From Test 2 · Lesen" for his exam sentence, else null
 * @property {string | null} exEn    its English, when it is the whole word-list sentence
 * @property {string | null} conf    a confusion note
 */

/**
 * The card for one word.
 * @param {ReturnType<typeof import('./forms.js').formsIndex>} ix
 * @param {{lemma: string, pos?: string | null, id?: string | null, zipf?: number | null, level?: string | null, conf?: string | null,
 *   sent?: string | null, form?: string | null, src?: string | null, fallbacks?: ({de: string, en?: string | null} | null)[], verbs?: Set<string> | null}} w
 * @returns {{card: WordCard, accept: string[], forms: Set<string>}}
 */
export function wordCard(ix, w) {
  const f = formsOf(ix, { lemma: w.lemma, pos: w.pos, id: w.id });
  const listed = w.id && /^W:/.test(w.id) ? ix.byId.get(w.id.slice(2)) : null;
  // the word list's example; a written one (content b1.forms examples) where the list's example does not hold the word
  const own = listed ? ix.examples.get(listed.id) : null;
  const fallbacks = [own || null, listed && listed.ex ? { de: listed.ex, en: listed.exen || null } : null, ...(w.fallbacks || [])];
  const ex = pickExample({ sent: w.sent || null, form: w.form || null, src: w.src || null, fallbacks, verbs: w.verbs || null }, f);
  const type = (f && f.type) || wordType(w.pos) || 'word';
  const accept = f ? f.accept : [w.lemma];
  return {
    card: { type, head: f ? f.head : w.lemma, forms: f ? f.line : null, pres: f ? f.pres : null, plural: f ? f.plural : null, pluralNote: f ? f.pluralNote : null,
      level: w.level || (listed && listed.level) || null, zipf: w.zipf ?? (listed ? listed.zipf : null) ?? null,
      ex: ex ? ex.text : null, exAt: ex ? [ex.start, ex.end] : null, exSrc: ex ? ex.src : null, exEn: ex ? ex.en : null, conf: w.conf || null },
    accept, forms: answerForms(accept, f ? f.surface : []),
  };
}

export { findForm };
