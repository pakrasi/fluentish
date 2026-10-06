/* Running text: sentences and tokens. Language-neutral; the language's data (the abbreviations a full stop does not end
   a sentence after) comes from the pack, pack.reading.abbreviations. Pure; tested in node (tests/unit/script-parse.test.mjs
   through domain/script/parse.js, which re-exports these for Scripts; tests/unit/text-layer.test.mjs).

   Moved unchanged from domain/script/parse.js (round 4, L2a), so Scripts, the reader and conversation split and
   tokenize text the same way. */
// @ts-check

/** @typedef {import('../../lang/types.js').TextToken} Token */
/** @typedef {import('../../lang/types.js').LanguagePack} LanguagePack */

/** @type {ReadonlySet<string>} */
const NONE = new Set();

/**
 * Sentences. Splits after . ! ? … when the next word starts a sentence; never after an abbreviation of the pack
 * ("z. B.", "Dr.") or a number ("am 3. Oktober").
 * @param {string} text @param {LanguagePack | null} [pack] @returns {string[]}
 */
export function splitSentences(text, pack = null) {
  const abbr = pack?.reading?.abbreviations || NONE;
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  /** @type {string[]} */ const out = [];
  let start = 0;
  const re = /([.!?…]+)(["“”»«'’)]*)\s+(?=[„"“«»'(]?[\p{Lu}\d])/gu;
  let m;
  while ((m = re.exec(s))) {
    const end = m.index + m[1].length + m[2].length;
    const before = s.slice(start, m.index);
    const last = (before.match(/([\p{L}\d]+)$/u) || [])[1] || '';
    if (m[1] === '.' && (abbr.has(last.toLowerCase()) || /^\d+$/.test(last) || /^\p{L}$/u.test(last))) continue;
    out.push(s.slice(start, end).trim());
    start = end;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Tokens of one sentence: words (hyphenated compounds are one word), and punctuation and quotes as their own tokens.
 * @param {string} sentence @returns {Token[]}
 */
export function tokenize(sentence) {
  /** @type {Token[]} */ const out = [];
  let k = 0;
  for (const chunk of String(sentence || '').split(/(\s+)/)) {
    if (!chunk || /^\s+$/.test(chunk)) continue;
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(chunk) || ['', '', chunk, ''];
    const [, lead, core, trail] = m;
    let first = true;
    const push = (/** @type {Token} */ tok) => { if (first) { tok.sp = out.length > 0; first = false; } out.push(tok); };
    if (lead) push({ t: lead, w: false, k: -1 });
    if (core) push({ t: core, w: true, k: k++, num: /^[\d.,:]+$/.test(core) });
    if (trail) push({ t: trail, w: false, k: -1 });
  }
  return out;
}

/** Words in a text. @param {string} s */
export const wordCount = s => tokenize(s).filter(x => x.w).length;
