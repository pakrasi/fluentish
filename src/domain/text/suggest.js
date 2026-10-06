/* Which words of a text to underline as "you may not know this" (SCRIPT-UX §7.2, round 2: UX P1-20), which tokens
   are names or foreign words (not tappable, never suggested), and the card id of a marked word. Language-neutral: the
   lemmas come from the pack's word-list lookup (pack.grammar.morphology.lookup), the folding from pack.text, and the
   cognate pattern and the foreign-word checks from pack.reading. Pure; tested in node (tests/unit/script-words.test.mjs
   through Scripts, tests/unit/text-layer.test.mjs). Moved from features/practice-script/suggest.js (round 4, L2a)
   with no change in behaviour for German.

   Suggested when the token is not a name and any of: its word-list level is above his level (B2, C1, C2 for a B1
   learner); his knowledge score for the word (data/knowledge.js, one score across every source) says not known, or
   not seen for a word above A1; it is in neither the word list (after lemmatising) nor the lexicon of forms the
   content uses; its card has 2 or more lapses. Never suggested: words he knows (score known, or a card he recalls
   today with 90 % or more), words he unmarked in this text. A word's CEFR level says nothing about whether he knows
   it; his own score does. capSuggest() keeps the strongest at about 12 % of a section's words, so the screen never
   turns into a dotted wall. */
// @ts-check
import { slug, wordId } from '../itemids.js';
import { levelRank } from './estimate.js';

/** @typedef {import('../../lang/types.js').LanguagePack} LanguagePack */
/** @typedef {import('../../lang/types.js').WordEntry} Word */
/** @typedef {import('../../lang/types.js').WordIndex} Index */
/** @typedef {import('../../lang/types.js').LemmaInfo} Lemma */
/** @typedef {import('./tokens.js').Token} Token */

export { levelRank };

/** A word against the pack's word list; without a lookup, the word itself, as a guess. @param {LanguagePack} pack */
export function lookupOf(pack) {
  const look = pack.grammar?.morphology?.lookup;
  if (look) return look;
  /** @type {import('../../lang/types.js').LookupFn} */
  const plain = (surface, _idx, o = {}) => {
    const word = String(surface).replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
    return { lemma: /^\p{Lu}/u.test(word) && !o.start ? word : word.toLowerCase(), entry: null, how: 'guess', guess: true };
  };
  return plain;
}

/**
 * @typedef {object} Classified
 * @property {number} k           word index in the sentence (-1: punctuation)
 * @property {'skip' | 'name' | 'word'} type
 * @property {boolean} suggest
 * @property {string} lemma
 * @property {Word | null} entry
 * @property {string} how
 * @property {boolean} [guess]  a local lemma guess he should confirm
 * @property {number} [pri]     how strong the suggestion is (0 strongest), for capSuggest
 * @property {number} [zipf]    word frequency (rarer first within a strength)
 */

/**
 * @param {Token[]} tokens one sentence
 * @param {object} ctx
 * @param {LanguagePack} ctx.pack       the text's language
 * @param {Index} ctx.idx               the pack's word list (pack.grammar.morphology.index)
 * @param {Set<string>} [ctx.lexicon]   folded word forms the content uses (pool.js buildLexicon)
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
  const { pack, idx, lexicon = new Set(), level = 'B1', names = new Set(), unmarked = new Set(), forced = new Set(), card = () => null, wordmap = {}, know = null, has = null } = ctx;
  const mine = levelRank(level);
  const lemmaOf = lookupOf(pack);
  const reading = pack.reading;
  const foreign = reading?.foreign || (() => false);
  const foreignWords = reading?.foreignWords || new Set();
  const cognate = reading?.cognate || null;
  const words = tokens.filter(t => t.w);
  const first = words[0];
  /** @type {Map<Token, Lemma>} */ const lem = new Map();
  words.forEach((t, i) => { if (!t.num) lem.set(t, lemmaOf(t.t, idx, { start: t === first, prev: i ? words[i - 1].t.toLowerCase() : '' })); });
  const unknownCap = (/** @type {Token | undefined} */ t) => !!t && !t.num && t !== first && /^\p{Lu}/u.test(t.t) && !lem.get(t)?.entry && lem.get(t)?.how === 'guess';
  return tokens.map(t => {
    if (!t.w || t.num) return { k: t.k, type: 'skip', suggest: false, lemma: '', entry: null, how: '' };
    const L = /** @type {Lemma} */ (lem.get(t));
    const low = t.t.toLowerCase();
    const folded = pack.text.tokenize(t.t)[0]?.n || low;
    const known = !!L.entry || lexicon.has(folded);
    const wi = words.indexOf(t);
    let name = false;
    if (!forced.has(low) && !L.entry) {
      if (names.has(low) && L.how !== 'compound') name = true;
      else if (/^[\p{Lu}\d-]{2,}$/u.test(t.t) && /\p{Lu}.*\p{Lu}/u.test(t.t)) name = true;          // NASA, ESA (KI-Modell is not all caps)
      else if (!known && foreign(t, tokens, tokens.indexOf(t))) name = true;
      else if (unknownCap(t) && [words[wi - 1], words[wi + 1]].some(n => n && foreignWords.has(n.t.toLowerCase()) && !lexicon.has(n.t.toLowerCase()))) name = true;
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
    } else if (!lexicon.has(folded) && !(cognate && (cognate.test(L.lemma) || cognate.test(t.t)))) { suggest = true; pri = 1; }
    if (c && c.lapses >= 2) { suggest = true; pri = 0; }
    if (st === 'known' || (c && c.r >= 0.9)) suggest = false;
    if (unmarked.has(L.lemma.toLowerCase())) suggest = false;
    return { k: t.k, type: 'word', suggest, lemma: L.lemma, entry: L.entry, how: L.how, guess: !!L.guess, pri, zipf: L.entry?.zipf ?? 0 };
  });
}

/**
 * The card id of a marked word: the word list's W: id when the lemma is listed (the same card as everywhere else),
 * else SW:<slug> (a script word; always device-only).
 * @param {string} lemma @param {Word | null} entry @param {Record<string, [string, string]>} [wordmap]
 * @param {((id: string) => boolean) | null} [has]  a card exists
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

/** "die Schnittstelle, -n" style head for a word sheet. @param {Word | null} e @param {string} lemma */
export function headOf(e, lemma) {
  if (!e) return lemma;
  if (e.pos === 'noun' && e.art) return `${e.art} ${lemma}${e.pl && e.pl !== lemma ? `, ${e.pl}` : ''}`;
  return lemma;
}

/** The meaning from the list, or null. @param {Word | null} e */
export const glossOf = e => (e && e.en && e.en.length ? e.en.slice(0, 3).join(', ') : null);
