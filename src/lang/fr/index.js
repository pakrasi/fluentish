/* The French language pack (round 3, C3b): the second full pack, behind the same interface as German
   (src/lang/types.js). What differs from German, and where:
     text       elision splits (l' ami, qu' il; aujourd'hui is one word), accents stay in the key, no-break spaces
                before ; : ! ? are plain spaces                                              (text.js)
     grading    a dropped accent is a slip, except the meaning pairs (ou/où, a/à, la/là …) and a participle's final é;
                the articles, pronouns and prepositions are never typos; spelling changes of a verb stem are forms
                                                                                            (grading.js)
     grammar    gender through the article, elided l' included (the word card names the gender); no cases; the
                passé composé's auxiliary decides which patterns stand in for each other; the detectors (avoir with
                an être verb, ne … pas order, agreement after elle)                         (syntax.js, detect.js)
     forms      infinitive, présent, passé composé with its auxiliary, imparfait, futur; the participle agreement
                note                                                                        (forms.js)
     speech     fr-FR, monolingual voices only (core/lang.js never uses "Multilingual" voices)
   Case: proper nouns only (caseSensitive 'proper'): the case reference is the model's own capitals. */
// @ts-check
import * as text from './text.js';
import * as G from './grading.js';
import * as S from './syntax.js';
import * as D from './detect.js';
import * as forms from './forms.js';
/** @typedef {import('../types.js').LanguagePack} LanguagePack */

/** @type {LanguagePack} */
const fr = {
  id: 'fr', legacyId: 'french', name: 'French', native: 'Français',
  bcp47: 'fr-FR', script: 'Latn', dir: 'ltr', full: true,
  fonts: { prompt: 'var(--font-display)', ui: 'var(--font-ui)' },
  // Apple's and Google's French voices; a "Multilingual" voice is never used (core/lang.js MULTILINGUAL)
  speech: { tts: { locales: ['fr-FR'], prefer: /Thomas|Amélie|Amelie|Audrey|Aurélie|Aurelie|Marie|Daniel|Google français/i, avoid: /Canada|Québec|Quebec|Belgi|Suisse/i }, asr: { locale: 'fr-FR' } },

  text: { normalize: text.normalize, tokenize: text.tokenize, fold: text.fold, wordRe: text.WORD_RE },
  input: { acceptsTransliteration: false },

  grading: {
    closedClass: G.CLOSED,
    articles: G.ARTICLES,
    endings: G.ENDINGS,
    isFormChange: G.formChange,
    soundAlikes: G.SOUNDS,
    minimalPairs: G.MINIMAL_PAIRS,
    slips: { marks: { base: G.base, dropped: G.marksDropped } },
    caseSensitive: 'proper',
    // « Comment ça va ? » « Ça va bien. »: a sentence starts after closing and opening guillemets too
    sentenceStart: /[.!?:…]\s*(?:["„“”«»]\s*)*$/,
    eitherCase: G.eitherCase,
    paradigms: G.FAMILY,
  },

  grammar: {
    gender: {
      values: ['m', 'f'],
      articles: { m: ['le', 'un'], f: ['la', 'une'] },
      citation: ['le', 'la', "l'"],
      toIndefinite: S.toIndef,
      elided: ["l'"],
    },
    cases: null,
    forms,
    detectors: D.DETECTORS,
    wordOrder: null,
    punctuation: {
      commaWords: S.COMMA_WORDS, clauseCommas: S.clauseCommas, subCommas: S.subCommas,
      beforeOk: S.BEFORE_OK, politeCaps: S.POLITE_CAPS, nounKey: S.nounKey,
    },
    clauses: { subordinators: S.SUBORDINATORS, shape: S.shape, same: S.sameShape },
    slots: { helpers: S.HELPERS, prepositions: S.PREPOSITIONS, adverbs: S.ADVERBS, timePhrase: S.TIME_RE, particles: S.PARTICLES },
    lines: {
      questionStarts: S.QUESTION, determinerLike: S.DETLIKE, openers: S.OPENERS, polite: S.POLITE, interjections: S.INTERJ,
      contractions: S.CONTRACTIONS, contrast: 'mais',
    },
    morphology: null,
  },

  exams: [],
  content: {
    words: 'igloo.words.fr', phrases: 'igloo.chunks.french', accept: 'igloo.chunks.accept.french', sentences: 'igloo.sentences.french',
    course: 'course.fr', lang: 'igloo.lang.french',
  },
};

export default fr;
