/* What reading needs to know about German (the pack's reading part, round 4; src/lang/types.js ReadingRules). The
   cognate pattern and the English checks moved unchanged from features/practice-script/suggest.js, the abbreviations
   from domain/script/parse.js (L2a), so Scripts behave as before and the reader shares them. */
// @ts-check
import { CLOSED } from './grading.js';
import { fold } from './text.js';

/** @typedef {import('../types.js').TextToken} TextToken */

// the stop words Scripts' language check counts (domain/script/parse.js langOf), as folded keys, and the closed class
const COMMON = 'der die das und ist nicht ich ein eine zu mit auf für von den dem sich es wir sie auch aber wie wenn dass oder noch so im ins zum zur wird werden hat haben sind war man nur schon sehr kann können mehr dann denn weil also hier da was wer bei aus nach über unter einen einem einer ja nein euch ihr uns mir mich dir dich doch immer gibt heute';
/** Function words a reader never offers to save (folded keys). */
export const STOP = new Set([...CLOSED, ...COMMON.split(' ').map(w => fold(w))]);

// international words an English speaker reads at once (Installation, Stabilität, simulieren, visuell, Parameter):
// off the list, they are tappable but not suggested
export const COGNATE = /(?:ation|ition|ution|ktion|ion|ität|ismus|ist|istin|ieren|iert|ierte[nmrs]?|ierung|ell|elle[nmrs]?|ik|iv|ive[nmrs]?|al|ale[nmrs]?|eter|ur|ent|enz|ant|anz|ograf\w*|ograph\w*|ologie|isch|ische[nmrs]?)$/i;

// English letter patterns that German words almost never have
const ENGLISH = /th|wh|sh(?!e?n\b)|ee|oo|ea|ou|aw|ow\b|y$|^y|c(?![hk])|q(?!u)|j(?=[^aeiouäöü])/i;
// English words that are not German words: a capitalised token next to one is part of an English name ("Bikes for Kids")
const EN_WORDS = 'the of and to at for in on with from by is are was a an or not this that it its we you they our your my how what why who new'.split(' ');
const DE_TOO = new Set(['in', 'an', 'so', 'man', 'will', 'was', 'die', 'war', 'also', 'hat', 'tag', 'bad', 'rat', 'hand', 'land', 'name', 'see', 'gift', 'arm', 'rest', 'wind']);
/** English function words that are not German words. */
export const FOREIGN_WORDS = new Set(EN_WORDS.filter(w => !DE_TOO.has(w)));

/**
 * An English word in German text: plain letters, and an English letter pattern or an English function word.
 * @param {TextToken} token
 */
export const foreign = token => /^[a-z-]+$/i.test(token.t) && (ENGLISH.test(token.t) || FOREIGN_WORDS.has(token.t.toLowerCase()));

/** Abbreviations a full stop does not end a sentence after (German and the English ones talks quote). */
export const ABBREVIATIONS = new Set(['z', 'b', 'd', 'h', 'u', 'a', 'bzw', 'ca', 'dr', 'prof', 'nr', 'usw', 'etc', 'vgl', 'evtl', 'ggf', 'inkl', 'bspw', 'mio', 'mrd', 'str', 'tel', 'hr', 'fr', 'st', 'e', 'v', 'chr', 'jh', 'mr', 'mrs', 'ms', 'vs', 'max', 'min']);

/** Spellings before the 1996 reform that public-domain texts use → today's (lower case; a caller keeps the word's capital). */
export const SPELLING = /** @type {Record<string, string>} */ ({
  daß: 'dass', muß: 'muss', mußt: 'musst', mußte: 'musste', mußten: 'mussten', müßte: 'müsste', müßten: 'müssten', wußte: 'wusste', wußten: 'wussten',
  gewußt: 'gewusst', läßt: 'lässt', laß: 'lass', ißt: 'isst', iß: 'iss', faßt: 'fasst', paßt: 'passt', bißchen: 'bisschen', gewiß: 'gewiss',
  schluß: 'schluss', fluß: 'fluss', kuß: 'kuss', haß: 'hass', schloß: 'schloss', genuß: 'genuss', schuß: 'schuss', mißverständnis: 'missverständnis',
});

const words = (/** @type {TextToken[]} */ s) => s.filter(t => t.w).map(t => t.t.toLowerCase());
const KONJ1 = new Set(['sei', 'seien', 'habe', 'werde', 'könne', 'müsse', 'solle', 'wolle', 'dürfe', 'gebe', 'komme', 'gehe', 'wisse', 'liege', 'stehe', 'brauche', 'finde']);
const THIRD = new Set(['er', 'sie', 'es', 'man']);
const MODALS = /^(kann|können|könnte|könnten|muss|müssen|müsste|müssten|soll|sollen|sollte|sollten|darf|dürfen|dürfte|dürften|will|wollen)$/;

/**
 * Constructions the level estimate looks for in a sentence (tokens of domain/text/tokens.js).
 * @type {{id: string, concept: string | null, test: (sentence: TextToken[]) => boolean}[]}
 */
export const CONSTRUCTIONS = [
  // indirect speech: er/sie/es/man + a Konjunktiv I form that is not also the indicative ("er sei", "sie habe")
  { id: 'konj1', concept: 'konjunktiv-1', test: s => { const w = words(s); return w.some((x, i) => KONJ1.has(x) && (THIRD.has(w[i - 1]) || THIRD.has(w[i + 1]))); } },
  // a modal with a passive infinitive at the end: "muss repariert werden"
  { id: 'passive-modal', concept: 'passiv-mit-modalverben', test: s => { const w = words(s); const n = w.length; return n >= 3 && w.some(x => MODALS.test(x)) && w[n - 1] === 'werden' && /^(ge\p{L}+(t|en)|\p{L}+iert)$/u.test(w[n - 2]); } },
  // je … desto / umso
  { id: 'je-desto', concept: 'je-desto', test: s => { const w = words(s); const j = w.indexOf('je'); return j >= 0 && w.slice(j + 1).some(x => x === 'desto' || x === 'umso'); } },
];
