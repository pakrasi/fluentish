/* The German language pack: today's German rules, unchanged, behind the LanguagePack interface (src/lang/types.js).
   Every value here was a constant or a function of domain/match.js, detect.js, punct.js, forms.js, clusters.js or
   atlas.js before Wave C2; tests/vectors and the grading corpus prove the move changed no result. */
// @ts-check
import * as text from './text.js';
import * as G from './grading.js';
import * as S from './syntax.js';
import * as D from './detect.js';
import * as M from './morph.js';
import * as forms from './forms.js';
/** @typedef {import('../types.js').LanguagePack} LanguagePack */

/** @type {LanguagePack} */
const de = {
  id: 'de', legacyId: 'german', name: 'German', native: 'Deutsch',
  bcp47: 'de-DE', script: 'Latn', dir: 'ltr', full: true,
  fonts: { prompt: 'var(--font-display)', ui: 'var(--font-ui)' },
  speech: { tts: { locales: ['de-DE'], prefer: /Anna|Helena|Petra|Markus|Google Deutsch/i, avoid: null }, asr: { locale: 'de-DE' } },

  text: { normalize: text.normalize, tokenize: text.tokenize, fold: text.fold, wordRe: text.WORD_RE },
  input: { acceptsTransliteration: false },

  grading: {
    closedClass: G.CLOSED,
    articles: G.ARTICLES,
    endings: G.ENDINGS,
    isFormChange: G.formChange,
    soundAlikes: G.SOUNDS,
    minimalPairs: G.UML_PAIR,
    slips: { marks: { base: G.deUml, dropped: G.umlautDropped } },
    caseSensitive: 'nouns',
    eitherCase: G.eitherCase,
    paradigms: G.FAMILY,
  },

  grammar: {
    gender: {
      values: ['m', 'f', 'n'],
      articles: { m: ['der', 'ein'], f: ['die', 'eine'], n: ['das', 'ein'] },
      citation: M.CITATION,
      toIndefinite: S.toIndef,
    },
    cases: ['nom', 'akk', 'dat', 'gen'],
    forms,
    detectors: D.DETECTORS,
    wordOrder: { classes: D.classes, norm: D.norm, verbForms: D.verbForms, fronted: D.fronted, setFronted: D.setFronted },
    punctuation: {
      commaWords: S.COMMA_WORDS, clauseCommas: S.clauseCommas, subCommas: S.subCommas,
      beforeOk: S.BEFORE_OK, politeCaps: S.POLITE_CAPS, nounKey: S.nounKey,
    },
    clauses: { subordinators: S.VERB_LAST, shape: S.shape, same: S.sameShape },
    slots: { helpers: S.HELPERS, prepositions: S.PREPS, adverbs: S.ADVERBS, timePhrase: S.TIME_RE, particles: S.PARTICLES },
    lines: {
      questionStarts: S.QUESTION, determinerLike: S.DETLIKE, openers: S.OPENERS, polite: S.POLITE, interjections: S.INTERJ,
      contractions: S.CONTRACTIONS, contrast: 'aber',
    },
    morphology: { inseparable: M.INSEPARABLE, prefixes: M.PREFIX_SET, prepCases: M.PREP_CASES, notHeads: M.NOT_HEADS, notIn: M.NOT_IN },
  },

  exams: ['goethe-b1'],
  content: {
    words: 'igloo.words.de', phrases: 'igloo.chunks.german', accept: 'igloo.chunks.accept.german', sentences: 'igloo.sentences.german',
    grammar: 'igloo.grammar.items.de', clusters: 'clusters.de', build: 'build.de', atlas: 'atlas.de', forms: 'b1.forms',
  },
};

export default de;
