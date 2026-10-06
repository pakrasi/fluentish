/* Sticky-error detectors: a runner over the language pack's detectors (Wave C2; German: src/lang/de/detect.js). Run on
   EVERY typed answer, accepted or not (an accepted answer can still hide "weil ich muss arbeiten" in a free [x] slot).
   Pure; an ES module, tested in node.
   Detect.run(input, item, r, opts) → null | {cls, hint, word}   (r = the Match.check result, optional): the first hit
   of the pack's detectors, in the pack's order. classes(), norm(), verbForms() and FRONTED are the pack's word-order
   rules (German: the ones tools/validate_b1.py mirrors; tests/unit/b1.test.mjs checks that both agree).
   Every function takes the pack last (default: the active pack, lang/registry.js). */
// @ts-check
import { activePack } from '../lang/registry.js';
/** @typedef {import('../lang/types.js').LanguagePack} LanguagePack */
/** @typedef {import('../lang/types.js').DetectContext} DetectContext */
/** The pack an argument names, else the active one (a callback's index or array is not a pack). @param {unknown} p @returns {LanguagePack} */
const packOf = p => (p && typeof p === 'object' && 'grammar' in p ? /** @type {LanguagePack} */ (p) : activePack());

/** The pack's word-order rules; a pack without them detects no word order. @param {unknown} p */
const wordOrder = (/** @type {unknown} */ p) => packOf(p).grammar.wordOrder;

/**
 * The first sticky error in an answer, or null.
 * @param {string} input @param {any} [item] @param {any} [r] the Match.check result
 * @param {{verbs?: Set<string> | null, conj?: any}} [opts] verbs: finite verb forms (verbForms()) for answers no model
 *   covers; conj: the pack's verb forms index (grammar.verbs.build), for the verb-form detector
 * @param {LanguagePack} [pack]
 * @returns {{cls: string, word: string, hint: string} | null}  word is null only for a für/vor at the answer's start
 */
function run(input, item = {}, r = null, opts = {}, pack) {
  const text = String(input || '');
  if (!text.trim()) return null;
  /** @type {DetectContext} */
  const ctx = { text, model: item.model || '', item, r, verbs: (opts && opts.verbs) || null, conj: (opts && opts.conj) || null, memo: new Map() };
  for (const d of packOf(pack).grammar.detectors) {
    const hit = d.find(ctx);
    if (hit) return { cls: d.cls, word: hit.word, hint: hit.hint };
  }
  return null;
}

/** The word-order classes of an answer, sorted (the parity test's view). @param {unknown} text @param {unknown} model @param {LanguagePack} [pack] */
const classes = (text, model, pack) => { const w = wordOrder(pack); return w ? w.classes(text, model) : []; };
/** The detectors' word key of a text. @param {unknown} s @param {LanguagePack} [pack] */
const norm = (s, pack) => { const w = wordOrder(pack); return w ? w.norm(s) : String(s == null ? '' : s).normalize('NFC').toLowerCase(); };
/** Finite verb forms of a word list, as norm() writes them. @param {any[] | null | undefined} words @param {LanguagePack} [pack] */
const verbForms = (words, pack) => { const w = wordOrder(pack); return w ? w.verbForms(words) : new Set(); };

const api = {
  run, classes, norm, verbForms,
  /** @param {string[]} list */
  setFronted(list) { const w = wordOrder(activePack()); if (w) w.setFronted(list); },
  get FRONTED() { const w = wordOrder(activePack()); return w ? w.fronted() : []; },
};
export default api;
export { run, classes, norm, verbForms };
