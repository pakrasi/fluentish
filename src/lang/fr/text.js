/* French text rules: what a word is and which spellings are the same (the French pack, C3b; the contract is
   tests/unit/lang-contract.test.mjs, written before the pack around this tokenizer).
   - Elision splits: l'ami → l' ami, qu'il → qu' il, jusqu'à → jusqu' à; a lexicalised apostrophe stays (aujourd'hui,
     quelqu'un, prud'homme).
   - Accents carry meaning (ou/où, a/à, du/dû): the key keeps them. Forgiving a dropped accent is the grader's slip
     rule (grading.slips.marks with minimalPairs, src/lang/fr/grading.js), never the key's.
   - œ and æ are typed oe and ae: the key folds them.
   - French typography puts a no-break space before ? ! : ; and inside « »: normalize makes it a plain space. */
// @ts-check
/** @typedef {import('../types.js').Token} Token */

/** @type {Record<string, string>} */
const FOLD = { 'œ': 'oe', 'Œ': 'Oe', 'æ': 'ae', 'Æ': 'Ae' };
/** @param {unknown} s */
export const fold = s => String(s).replace(/[œŒæÆ]/g, c => FOLD[c]);
// an elided word with its apostrophe (before a letter), else a word
export const WORD_RE = /(?:jusqu|lorsqu|puisqu|quoiqu|qu|[cdjlmnst])'(?=\p{L})|[\p{L}\p{M}\p{N}_'-]+/giu;
/** NFC, one apostrophe, plain spaces. @param {unknown} s */
export const normalize = s => String(s == null ? '' : s).normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[   ]/g, ' ');
/** @param {unknown} s @param {number} [offset] @returns {Token[]} */
export function tokenize(s, offset = 0) {
  /** @type {Token[]} */ const out = [];
  for (const m of String(s).matchAll(WORD_RE)) {
    const raw = m[0], low = raw.toLowerCase(), at = /** @type {number} */ (m.index);
    out.push({ raw, low, n: fold(low), len: (low.match(/\p{L}/gu) || []).length || low.length, start: offset + at, end: offset + at + raw.length });
  }
  return out;
}
