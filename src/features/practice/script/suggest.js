/* Script mode: which words to underline as "you may not know this" (SCRIPT-UX §7.2, round 2: UX P1-20), which tokens
   are names or English terms (not tappable, never suggested), and the card id of a marked word. Pure; tested in node.

   Suggested when the token is not a name and any of: its word-list level is above his level (B2, C1, C2 for a B1
   learner); his knowledge score for the word (data/knowledge.js, one score across every source) says not known, or
   not seen for a word above A1; it is in neither the word list (after lemmatising) nor the lexicon of German forms the
   B1 content uses; its card has 2 or more lapses. Never suggested: words he knows (score known, or a card he recalls
   today with 90 % or more), words he unmarked in this script. A word's CEFR level says nothing about whether he knows
   it; his own score does. capSuggest() keeps the strongest at about 12 % of a section's words, so the screen never
   turns into a dotted wall. */
import * as Match from '../../../domain/match.js';
import { slug, wordId } from '../../../domain/itemids.js';
import { lemmaOf } from './lemma.js';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** @param {string | null | undefined} l */
export const levelRank = l => { const i = LEVELS.indexOf(String(l || '').toUpperCase()); return i < 0 ? 2 : i; };

// English letter patterns that German words almost never have
const ENGLISH = /th|wh|sh(?!e?n\b)|ee|oo|ea|ou|aw|ow\b|y$|^y|c(?![hk])|q(?!u)|j(?=[^aeiouäöü])/i;
// English words that are not German words: a capitalised token next to one is part of an English name ("Bikes for Kids")
const EN_WORDS = new Set('the of and to at for in on with from by is are was a an or not this that it its we you they our your my how what why who new'.split(' '));
const DE_TOO = new Set(['in', 'an', 'so', 'man', 'will', 'was', 'die', 'war', 'also', 'hat', 'tag', 'bad', 'rat', 'hand', 'land', 'name', 'see', 'gift', 'arm', 'rest', 'wind']);
// international words an English speaker reads at once (Installation, Stabilität, simulieren, visuell, Parameter):
// off the list, they are tappable but not suggested
const COGNATE = /(?:ation|ition|ution|ktion|ion|ität|ismus|ist|istin|ieren|iert|ierte[nmrs]?|ierung|ell|elle[nmrs]?|ik|iv|ive[nmrs]?|al|ale[nmrs]?|eter|ur|ent|enz|ant|anz|ograf\w*|ograph\w*|ologie|isch|ische[nmrs]?)$/i;

/**
 * @typedef {object} Classified
 * @property {number} k           word index in the sentence (-1: punctuation)
 * @property {'skip' | 'name' | 'word'} type
 * @property {boolean} suggest
 * @property {string} lemma
 * @property {import('./lemma.js').Word | null} entry
 * @property {string} how
 * @property {boolean} [guess]  a local lemma guess he should confirm
 * @property {number} [pri]     how strong the suggestion is (0 strongest), for capSuggest
 * @property {number} [zipf]    word frequency (rarer first within a strength)
 */

/**
 * @param {import('./parse.js').Token[]} tokens one sentence
 * @param {object} ctx
 * @param {import('./lemma.js').Index} ctx.idx
 * @param {Set<string>} [ctx.lexicon]   folded German word forms (pool.js buildLexicon)
 * @param {string} [ctx.level]          his level ('B1')
 * @param {Set<string>} [ctx.names]     lower-case words of the English lines
 * @param {Set<string>} [ctx.unmarked]  lower-case lemmas he unmarked in this script
 * @param {Set<string>} [ctx.forced]    lower-case surfaces he made tappable with a long press
 * @param {(id: string) => {r: number, lapses: number} | null} [ctx.card]  his card for an id, if any
 * @param {((itemId: string) => 'known' | 'shaky' | 'unknown' | 'unseen' | null) | null} [ctx.know]  his knowledge score of an item
 * @param {Record<string, [string, string]>} [ctx.wordmap]
 * @param {((id: string) => boolean) | null} [ctx.has]  a card exists (a legacy BW: card keeps its id)
 * @returns {Classified[]}
 */
export function classify(tokens, ctx) {
  const { idx, lexicon = new Set(), level = 'B1', names = new Set(), unmarked = new Set(), forced = new Set(), card = () => null, wordmap = {}, know = null, has = null } = ctx;
  const mine = levelRank(level);
  const words = tokens.filter(t => t.w);
  const first = words[0];
  /** @type {Map<import('./parse.js').Token, any>} */ const lem = new Map();
  words.forEach((t, i) => { if (!t.num) lem.set(t, lemmaOf(t.t, idx, { start: t === first, prev: i ? words[i - 1].t.toLowerCase() : '' })); });
  const unknownCap = (/** @type {any} */ t) => !!t && !t.num && t !== first && /^\p{Lu}/u.test(t.t) && !lem.get(t)?.entry && lem.get(t)?.how === 'guess';
  return tokens.map(t => {
    if (!t.w || t.num) return { k: t.k, type: 'skip', suggest: false, lemma: '', entry: null, how: '' };
    const L = lem.get(t);
    const low = t.t.toLowerCase();
    const folded = Match.words(t.t)[0]?.n || low;
    const known = !!L.entry || lexicon.has(folded);
    const wi = words.indexOf(t);
    let name = false;
    if (!forced.has(low) && !L.entry) {
      if (names.has(low) && L.how !== 'compound') name = true;
      else if (/^[\p{Lu}\d-]{2,}$/u.test(t.t) && /\p{Lu}.*\p{Lu}/u.test(t.t)) name = true;          // NASA, ESA (KI-Modell is not all caps)
      else if (!known && /^[a-z-]+$/i.test(t.t) && (ENGLISH.test(t.t) || (EN_WORDS.has(low) && !DE_TOO.has(low)))) name = true;
      else if (unknownCap(t) && [words[wi - 1], words[wi + 1]].some(n => n && EN_WORDS.has(n.t.toLowerCase()) && !DE_TOO.has(n.t.toLowerCase()) && !lexicon.has(n.t.toLowerCase()))) name = true;
      else if (unknownCap(t) && (unknownCap(words[wi - 1]) || unknownCap(words[wi + 1]))) name = true;   // two unknown capitalised words in a row: a name
    }
    if (name) return { k: t.k, type: 'name', suggest: false, lemma: t.t, entry: null, how: 'name' };
    const id = cardId(L.lemma, L.entry, wordmap, has);
    const c = card(id);
    const st = know && L.entry && L.entry.id ? know(`W:${L.entry.id}`) : null;
    let suggest = false, pri = 9;
    if (L.entry) {
      const lv = levelRank(L.entry.level);
      if (lv > mine) { suggest = true; pri = 0; }
      else if (st === 'unknown') { suggest = true; pri = 1; }
      else if (st === 'unseen' && lv >= 1) { suggest = true; pri = 2 + (mine - lv); }
    } else if (!lexicon.has(folded) && !COGNATE.test(L.lemma) && !COGNATE.test(t.t)) { suggest = true; pri = 1; }
    if (c && c.lapses >= 2) { suggest = true; pri = 0; }
    if (st === 'known' || (c && c.r >= 0.9)) suggest = false;
    if (unmarked.has(L.lemma.toLowerCase())) suggest = false;
    return { k: t.k, type: 'word', suggest, lemma: L.lemma, entry: L.entry, how: L.how, guess: !!L.guess, pri, zipf: L.entry?.zipf ?? 0 };
  });
}

/**
 * The card id of a marked word: the word list's W: id when the lemma is listed (the same card as everywhere else),
 * else SW:<slug> (a script word; always device-only).
 * @param {string} lemma @param {import('./lemma.js').Word | null} entry @param {Record<string, [string, string]>} [wordmap]
 */
export function cardId(lemma, entry, wordmap = {}, has = null) {
  // an exam word he already has as BW:<slug> (captured before the lemma joined the list) keeps that card: one
  // schedule per lemma (audit P2-4)
  const legacy = `BW:${slug(lemma)}`;
  if (has && has(legacy)) return legacy;
  if (entry && entry.id) return `W:${entry.id}`;
  const id = wordId(lemma, wordmap, has);
  return id.startsWith('W:') || (has && id.startsWith('BW:') && has(id)) ? id : `SW:${slug(lemma)}`;
}

/** The share of a section's words that may be suggested. */
export const SUGGEST_SHARE = 0.12;

/**
 * Keep the strongest suggestions of a section at about 12 % of its words: above his level and lapsed first, then not
 * known, then not seen (higher levels first), rarer words first within each. Mutates and returns the lists.
 * @param {Classified[][]} sentences classify() per sentence @param {number} [share]
 */
export function capSuggest(sentences, share = SUGGEST_SHARE) {
  const all = sentences.flat();
  const n = all.filter(x => x.type === 'word').length;
  const max = Math.max(1, Math.round(n * share));
  /** @type {Map<string, {pri: number, zipf: number}>} */ const best = new Map();
  for (const x of all) if (x.suggest) {
    const k = x.lemma.toLowerCase(), cur = best.get(k), p = x.pri ?? 9, z = x.zipf ?? 0;
    if (!cur || p < cur.pri) best.set(k, { pri: p, zipf: z });
  }
  const keep = new Set([...best.entries()].sort((a, b) => a[1].pri - b[1].pri || a[1].zipf - b[1].zipf).slice(0, max).map(e => e[0]));
  for (const x of all) if (x.suggest && !keep.has(x.lemma.toLowerCase())) x.suggest = false;
  return sentences;
}
