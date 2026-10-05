/* Punctuation and the small letter after a letter's greeting: the rules a Schreiben item names in `punct`. Pure;
   tested in node (tests/unit/schreiben.test.mjs). The matcher ignores punctuation, so these are checked after a match
   and count as a slip (the answer is right, rated Hard), like a capital slip; never as a wrong answer.

     comma-end            the greeting ends with a comma          Liebe Maria,
     no-comma-end         no comma after the sign-off             Mit freundlichen Grüßen
     lower-start          the line after the greeting starts small    vielen Dank für deine E-Mail.
     comma-before:<word>  a comma before dass, weil, ob, wenn …   Ich hoffe, dass …
   tools/build_schreiben.py checks that every model keeps its own rules.
   The rules are language-neutral; their exceptions are the language pack's (pack.grammar.punctuation: the words after
   which a subordinator needs no comma, the polite pronoun that keeps its capital, a word's key in the noun table).
   Both functions take the pack last (default: the active pack, lang/registry.js). */
// @ts-check
import { activePack } from '../lang/registry.js';
/** @typedef {import('../lang/types.js').LanguagePack} LanguagePack */
/** The pack an argument names, else the active one (a callback's index or array is not a pack). @param {unknown} p @returns {LanguagePack} */
const packOf = p => (p && typeof p === 'object' && 'grammar' in p ? /** @type {LanguagePack} */ (p) : activePack());

const WORD = /[\p{L}\p{N}'-]+/gu;

/**
 * @typedef {object} PunctMiss
 * @property {'comma-end'|'no-comma-end'|'lower-start'|'comma-before'} code
 * @property {string} [word]    for comma-before: the word that needs the comma
 * @property {number} [at]      where in the input (for marking)
 */

/**
 * The punctuation rules an answer breaks.
 * @param {string} input
 * @param {string[] | null | undefined} rules
 * @param {{nouns?: Record<string, string>}} [o]  nouns: folded lower-case noun → its cased form, so a noun may start the line
 * @param {LanguagePack} [pack]
 * @returns {PunctMiss[]}
 */
export function punctCheck(input, rules, o = {}, pack) {
  const { beforeOk: BEFORE_OK, politeCaps: POLITE, nounKey } = packOf(pack).grammar.punctuation;
  const s = String(input || '').normalize('NFC').trim();
  /** @type {PunctMiss[]} */ const out = [];
  if (!s || !rules || !rules.length) return out;
  const words = [...s.matchAll(WORD)].map(m => ({ w: m[0], i: /** @type {number} */ (m.index) }));
  for (const r of rules) {
    if (r === 'comma-end' && !/,\s*$/.test(s)) out.push({ code: 'comma-end', at: s.length });
    else if (r === 'no-comma-end' && /,\s*$/.test(s)) out.push({ code: 'no-comma-end', at: s.length - 1 });
    else if (r === 'lower-start') {
      const first = words[0];
      if (first && /^\p{Lu}/u.test(first.w) && !POLITE.has(first.w) && !isNoun(first.w, o.nouns, nounKey)) out.push({ code: 'lower-start', word: first.w, at: first.i });
    } else if (r.startsWith('comma-before:')) {
      const want = r.slice(13).toLowerCase();
      const k = words.findIndex((x, j) => j > 0 && x.w.toLowerCase() === want);
      if (k > 0 && !BEFORE_OK.has(words[k - 1].w.toLowerCase())) {
        const between = s.slice(words[k - 1].i + words[k - 1].w.length, words[k].i);
        if (!between.includes(',')) out.push({ code: 'comma-before', word: words[k].w, at: words[k].i });
      }
    }
  }
  return out;
}

/** @param {string} w @param {Record<string, string> | undefined} nouns @param {(w: string) => string} nounKey */
function isNoun(w, nouns, nounKey) {
  if (!nouns) return false;
  const k = nounKey(w);
  return !!(nouns[k] || nouns[w.toLowerCase()]);
}

/** The model with its first letter made small, for a line that follows the greeting. @param {string} s @param {LanguagePack} [pack] */
export const lowerStart = (s, pack) => {
  const POLITE = packOf(pack).grammar.punctuation.politeCaps;
  const m = /^(\P{L}*)(\p{L})/u.exec(String(s));
  if (!m) return String(s);
  const first = String(s).slice(m[1].length).match(/^[\p{L}'-]+/u)?.[0] || '';
  return POLITE.has(first) ? String(s) : m[1] + m[2].toLowerCase() + String(s).slice(m[0].length);
};
