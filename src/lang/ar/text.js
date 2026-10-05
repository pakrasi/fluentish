/* Arabic text rules: a STUB that tests/unit/lang-contract.test.mjs describes (Wave C2). Not a pack and not used by the
   app; it fixes the tokenizer and normaliser contract before an Arabic pack is built.
   - Text is stored and tokenized in logical order; direction is the pack's `dir: 'rtl'`, set on the element, never
     reversed in the string.
   - The key drops the short vowels and other harakat (U+064B–U+0652, U+0670) and the tatweel (ـ), writes every alef
     with hamza or madda (أ إ آ ٱ) as ا and alef maqsura (ى) as ي: learners and keyboards differ there, the word does not.
   - Arabic punctuation (، ؛ ؟) is never part of a word; Arabic-Indic digits are digits. Clitics (و، ال، ب) stay
     attached: splitting them is the grader's business, not the tokenizer's. */
// @ts-check
/** @typedef {import('../types.js').Token} Token */

/** @param {unknown} s */
export const fold = s => String(s);
export const WORD_RE = /[\p{L}\p{M}\p{N}_'-]+/gu;
/** @param {unknown} s */
export const normalize = s => String(s == null ? '' : s).normalize('NFC').replace(/[‘’ʼ]/g, "'");
/** The comparison key of a lower-cased word. @param {string} w */
const key = w => w.replace(/[ً-ْٰـ]/g, '').replace(/[آأإٱ]/g, 'ا').replace(/ى/g, 'ي');
/** @param {unknown} s @param {number} [offset] @returns {Token[]} */
export function tokenize(s, offset = 0) {
  /** @type {Token[]} */ const out = [];
  for (const m of String(s).matchAll(WORD_RE)) {
    const raw = m[0], low = raw.toLowerCase(), at = /** @type {number} */ (m.index), n = key(low);
    out.push({ raw, low, n, len: (n.match(/\p{L}/gu) || []).length || n.length, start: offset + at, end: offset + at + raw.length });
  }
  return out;
}
