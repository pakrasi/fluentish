/* French sentence knowledge the matcher and the punctuation rules use: clause shapes, which slot words may move, which
   "also correct" lines can be written from the model, and the commas the grader writes. Word lists are keys (Token.n:
   lower case, accents kept) unless said otherwise.

   French keeps subject-verb order after a subordinator (parce que, quand, si), so every clause has one shape for word
   order; what makes two patterns not interchangeable is the passé composé's auxiliary (je suis allé / j'ai mangé),
   as in German sein/haben. Commas: the grader writes none of its own (French puts no comma before que, parce que or
   si); the model's comma before mais, car or donc is kept. */
// @ts-check
import { fold } from './text.js';
/** @typedef {import('../types.js').Shape} Shape */

const keys = (/** @type {string} */ s) => new Set(s.split(/\s+/).filter(Boolean).map(w => fold(w.toLowerCase())));

/* ---- clause shapes (restCheck, alsoLines) ---- */
export const SUBORDINATORS = keys("que qu' parce quand lorsque lorsqu' si s' comme puisque puisqu' pendant bien pour avant après dès depuis");
const ETRE = /^(suis|es|est|sommes|êtes|sont)$/, AVOIR = /^(ai|as|a|avons|avez|ont)$/;
/** @param {string[]} ws a pattern's words (keys), slots removed @returns {Shape} */
export function shape(ws) {
  return { clause: '', order: '', sein: ws.some(w => ETRE.test(w)), haben: ws.some(w => AVOIR.test(w)) };
}
// not être in one where the other has avoir (je suis allé / j'ai allé)
export const sameShape = (/** @type {Shape} */ a, /** @type {Shape} */ b) => a.order === b.order && !((a.sein && !a.haben && b.haben && !b.sein) || (a.haben && !a.sein && b.sein && !b.haben));

/* ---- slot words (restCheck borrowable) ---- */
export const TIME_RE = /^(le|ce|cette|chaque|tous|toutes|la|à|en|dans|depuis|pendant|avant|après|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( \S+)* (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|week-end|heure|heures|matin|soir|midi|après-midi|semaine|mois|an|ans|année|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|été|hiver|printemps|automne|prochain|prochaine|dernier|dernière)$/;
export const ADVERBS = keys(`absolument avant après bientôt déjà encore ensemble ici là maintenant souvent toujours vite tôt tard vraiment sûrement
  certainement enfin aujourd'hui demain hier partout tout bien mieux volontiers`);
// modal verbs and aller: they do not decide the form of the words in a slot (être and avoir do)
export const HELPERS = keys(`peux peut pouvons pouvez peuvent pourrais pourrait pourriez pourrions pourraient dois doit devons devez doivent devrais
  devrait devriez veux veut voulons voulez veulent voudrais voudrait voudriez vais vas va allons allez vont à de d'`);
export const PREPOSITIONS = keys("à au aux de d' du des dans en sur sous chez avec sans pour par entre vers depuis pendant avant après contre devant derrière jusqu' près");
// words that only add emphasis or a nuance: he may add them, drop them or use another one in a slot
export const PARTICLES = keys('vraiment juste aussi alors bien déjà encore peut-être bon franchement quand même seulement surtout');

/* ---- commas the grader writes ---- */
// the model's comma before one of these is kept in an "also correct" line
export const COMMA_WORDS = keys('mais car donc puis sinon');
/** French takes no comma before que, parce que, si: the grader adds none. @param {string} text */
export const clauseCommas = text => text;
/** @param {string} text */
export const subCommas = text => text;

/* ---- "also correct" lines (alsoLines) ---- */
// a line that starts with one of these is a question (the model's ? stays)
export const QUESTION = keys(`est-ce qu'est-ce qu' est-ce comment pourquoi où quand qui quoi quel quelle quels quelles combien lequel laquelle
  pouvez-vous peux-tu pourriez-vous pourrais-tu voulez-vous veux-tu avez-vous as-tu êtes-vous es-tu savez-vous sais-tu
  ça c'est-à-dire tu vous`);
export const DETLIKE = keys(`le la les l' un une des du de d' au aux mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs ce cet cette ces
  chaque quelques plusieurs tous toutes tout toute deux trois quatre cinq six sept huit neuf dix aucun aucune`);
export const OPENERS = keys(`je j' tu il elle on nous vous ils elles c' ce ça cela moi toi le la les l' un une il y mon ma mes`);
// polite or not: vous is polite and plural alike, so nothing is known only from the model
export const POLITE = new Set();
export const INTERJ = keys("oui non bon bien ok d'accord merci super génial pardon désolé désolée");
export const CONTRACTIONS = new Set();

/* ---- articles ---- */
/** @type {Record<string, string>} */
const INDEF = { le: 'un', la: 'une' };
/** "la maison" → "une maison"; "l'école" stays (its gender is not in the article). @param {string} s */
export const toIndef = s => { const m = String(s).match(/^(le|la)\s+(.+)$/i); return m ? `${INDEF[m[1].toLowerCase()]} ${m[2]}` : s; };

/* ---- the punctuation rules' exceptions (domain/punct.js) ---- */
export const BEFORE_OK = keys('et ou mais');
export const POLITE_CAPS = new Set();
/** A word's key in a noun table: lower case, œ folded. @param {string} w */
export const nounKey = w => fold(String(w).toLowerCase());
