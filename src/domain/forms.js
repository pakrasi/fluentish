/* Word forms for a word card: the dictionary form to type, the key forms to show after the answer, and the one example.
   Since Wave C2 this is the language-neutral entry point: every function hands the call to the active language pack's
   forms model (pack.grammar.forms; German: src/lang/de/forms.js, where the rules and their documentation live), so a
   feature never imports a language's morphology. Pure; tested in node (tests/unit/forms.test.mjs) and checked over the
   content by tools/validate-content.mjs. */
// @ts-check
import { activePack } from '../lang/registry.js';
/** @typedef {import('../lang/types.js').FormsModel} FormsModel */
/** @typedef {import('../lang/de/forms.js').Forms} Forms */

/** The active pack's forms model. @returns {FormsModel} */
const F = () => activePack().grammar.forms;

/** The word type in English ('verb', 'noun', …) for a part-of-speech tag. @param {string | null | undefined} pos */
export const wordType = pos => F().wordType(pos);
/** The dictionary head of a verb phrase ("sich bewerben um" → "bewerben"). @param {string} w */
export const verbBase = w => F().verbBase(w);
/** The lookup tables. @type {FormsModel['formsIndex']} */
export const formsIndex = (words, forms) => F().formsIndex(words, forms);
/** @type {FormsModel['regularThird']} */
export const regularThird = inf => F().regularThird(inf);
/** @type {FormsModel['verbParts']} */
export const verbParts = f => F().verbParts(f);
/** @type {FormsModel['verbForms']} */
export const verbForms = (w, f) => F().verbForms(w, f);
/** Forms for a word: the dictionary form, what to accept and the key forms. @type {FormsModel['formsOf']} */
export const formsOf = (ix, w) => F().formsOf(ix, w);
/** Where a form of the word is in a text. @type {FormsModel['findForm']} */
export const findForm = (text, forms) => F().findForm(text, forms);
/** The one clause of a sentence that holds the word, as a sentence of its own. @type {FormsModel['exampleClause']} */
export const exampleClause = (sentence, form, o) => F().exampleClause(sentence, form, o);
/** Verb forms a clause can hold. @type {FormsModel['verbSet']} */
export const verbSet = ix => F().verbSet(ix);
/** The content rules a schema cannot say. @type {FormsModel['validateForms']} */
export const validateForms = (forms, words) => F().validateForms(forms, words);
/** The one example a word card shows. @type {FormsModel['pickExample']} */
export const pickExample = (o, f) => F().pickExample(o, f);
/** The separable particles (the active pack's). */
export const SEPARABLE = F().SEPARABLE;
