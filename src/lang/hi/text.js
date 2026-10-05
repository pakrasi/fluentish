/* Hindi text rules: a STUB that tests/unit/lang-contract.test.mjs describes (Wave C2). Not a pack and not used by the
   app; it fixes the tokenizer, normaliser and transliteration contract before a Hindi pack is built.
   - A word is letters with their marks: a conjunct (क्या: virama), a nukta (क़), a nasal mark (हैं) never splits, nor does
     a ZWJ or ZWNJ inside it. The danda (। ॥) is punctuation.
   - normalize: NFC, which writes a nukta letter one way (क़ U+0958 and क + ़ are one spelling).
   - The key drops ZWJ and ZWNJ (they change the glyph, not the word). Devanagari has no case and nothing to fold.
   - Learners type Latin: input.transliterate gives Devanagari candidates (here a small word table; a pack uses a
     full scheme). */
// @ts-check
/** @typedef {import('../types.js').Token} Token */

/** @param {unknown} s */
export const fold = s => String(s);
export const WORD_RE = /[\p{L}\p{M}\p{N}‌‍_'-]+/gu;
/** @param {unknown} s */
export const normalize = s => String(s == null ? '' : s).normalize('NFC').replace(/[‘’ʼ]/g, "'");
/** @param {unknown} s @param {number} [offset] @returns {Token[]} */
export function tokenize(s, offset = 0) {
  /** @type {Token[]} */ const out = [];
  for (const m of String(s).matchAll(WORD_RE)) {
    const raw = m[0], low = raw.toLowerCase(), at = /** @type {number} */ (m.index);
    out.push({ raw, low, n: low.replace(/[‌‍]/g, ''), len: (low.match(/\p{L}/gu) || []).length || low.length, start: offset + at, end: offset + at + raw.length });
  }
  return out;
}
/** @type {Record<string, string[]>} */
const TABLE = { kya: ['क्या'], aap: ['आप'], theek: ['ठीक'], thik: ['ठीक'], hai: ['है'], hain: ['हैं'], main: ['मैं', 'में'], hoon: ['हूँ'], hun: ['हूँ'] };
/** Devanagari spellings of a word typed in Latin (the stub knows a few words). @param {string} latin */
export const transliterate = latin => (TABLE[String(latin).toLowerCase()] || []).slice();
