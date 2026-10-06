/* Script mode's lemmas: the German pack's word-list lookup (src/lang/de/lemma.js, pack.grammar.morphology), moved
   there unchanged in round 4 so the reader and conversation share it. Scripts are German: this binds the German pack
   whatever the study language. */
import { packFor } from '../../core/lang.js';
export { headOf, glossOf } from '../../domain/text/suggest.js';

/** The pack Scripts read their text with. @type {import('../../lang/types.js').LanguagePack} */
export const scriptPack = /** @type {any} */ (packFor('de'));
const M = /** @type {Required<import('../../lang/types.js').MorphologyRules>} */ (scriptPack.grammar.morphology);

/** @typedef {import('../../lang/types.js').WordEntry} Word */
/** @typedef {import('../../lang/types.js').WordIndex} Index */
/** @typedef {import('../../lang/types.js').LemmaInfo} Lemma */

/** Index the word list by every written form it lists. @type {(words: Word[]) => Index} */
export const buildIndex = M.index;
/** The lemma of one token (the German pack's lookup). @type {import('../../lang/types.js').LookupFn} */
export const lemmaOf = M.lookup;
