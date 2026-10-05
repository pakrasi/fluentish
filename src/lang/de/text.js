/* German text rules: what a word is and which spellings are the same (moved unchanged from domain/match.js, Wave C2).
   ae/oe/ue/ss count as ä/ö/ü/ß; other accents are ignored (Cafe = Café); gern and gerne are one word. */
// @ts-check
/** @typedef {import('../types.js').Token} Token */

/** @type {Record<string, string>} */
const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ẞ': 'SS' };
/** @param {unknown} s */
export const fold = s => String(s).replace(/[äöüßÄÖÜẞ]/g, c => FOLD[c]);
export const WORD_RE = /[\p{L}\p{N}_'-]+/gu;   // what validate_accept.norm keeps as a word (brackets aside)

/** NFC and one apostrophe. @param {unknown} s */
export const normalize = s => String(s == null ? '' : s).normalize('NFC').replace(/[‘’ʼ]/g, "'");

// words of a string, with offsets: {raw, low, n (lowercase + folded), len (letters), start, end}
/** @param {unknown} s @param {number} [offset] @returns {Token[]} */
export function tokenize(s, offset = 0) {
  /** @type {Token[]} */ const out = [];
  for (const m of String(s).matchAll(WORD_RE)) {
    const raw = m[0], low = raw.toLowerCase();
    const at = /** @type {number} */ (m.index);
    // gern and gerne are the same word: one spelling for matching
    const n = fold(low).normalize('NFD').replace(/\p{M}/gu, '');
    out.push({ raw, low, n: n === 'gerne' ? 'gern' : n, len: (low.match(/\p{L}/gu) || []).length || low.length, start: offset + at, end: offset + at + raw.length });
  }
  return out;
}
