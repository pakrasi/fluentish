/* Reading: what the reader needs to know about the language and about him, loaded once a session: the pack, the word
   list indexed for lemmas, the phrases of the list, the forms index for the word sheet, the lexicon of forms the
   content uses, and his knowledge (fresh on every call). Public content only; nothing is sent anywhere. */
import { packFor } from '../../core/lang.js';
import { langCode } from '../../data/settings.js';
import { buildLexicon } from '../shared/pool.js';
import { loadWordIx } from '../shared/wordix.js';
import { loadKnowledge, knowledgeDecks } from '../../data/knowledge.js';
import { phraseIndex, gradedSections } from './logic.js';
import { readDeck } from '../shared/read-data.js';

/** @typedef {import('../../lang/types.js').LanguagePack} LanguagePack */

/** @type {Map<string, Promise<any>>} */ const memo = new Map();

/** The study language's code ('de'). @param {import('../contract.js').ViewCtx} ctx */
export const langOf = ctx => langCode(ctx.settings().language) || 'de';

/**
 * @param {import('../contract.js').ViewCtx} ctx
 * @returns {Promise<{pack: LanguagePack, lang: string, deck: string, words: any[], idx: any, lexicon: Set<string>, nouns: Record<string, string>,
 *   wordmap: Record<string, [string, string]>, phrases: import('./logic.js').Phrase[], ix: any, verbs: Set<string>}>}
 */
export function language(ctx) {
  const lang = langOf(ctx);
  let p = memo.get(lang);
  if (!p) {
    p = (async () => {
      const pack = /** @type {LanguagePack} */ (packFor(lang) || packFor('de'));
      const get = (/** @type {string} */ id) => ctx.content.load(id).catch(() => null);
      const [words, nouns, wordmap] = await Promise.all([get(pack.content?.words || 'igloo.words.de'), lang === 'de' ? get('b1.nouns') : null, lang === 'de' ? get('b1.wordmap') : null]);
      const list = Array.isArray(words) ? words : [];
      const M = pack.grammar?.morphology;
      const idx = M?.index ? M.index(list) : { forms: new Map(), lemmas: new Map(), words: list };
      const { ix, verbs } = lang === 'de' ? await loadWordIx(ctx, list) : { ix: null, verbs: new Set() };
      return { pack, lang, deck: readDeck(lang), words: list, idx, lexicon: buildLexicon({ lexWords: list, nouns: nouns || {} }), nouns: nouns || {}, wordmap: wordmap || {},
        phrases: phraseIndex(list, pack, idx), ix, verbs };
    })();
    p.catch(() => memo.delete(lang));
    memo.set(lang, p);
  }
  return p;
}

/** His knowledge now, or null when it cannot be read. @param {import('../contract.js').ViewCtx} ctx */
export async function knowledgeNow(ctx) {
  try { return await loadKnowledge(ctx); } catch { return null; }
}

/** The course's decks other than the reading deck, with their cards (for one card per item). @param {any} store @param {string} deck */
export function otherDecks(store, deck) {
  /** @type {Record<string, Record<string, any>>} */ const out = {};
  for (const d of knowledgeDecks(store)) if (d !== deck) out[d] = store.cards(d) || {};
  return out;
}

/**
 * The sections of a text: its own, or a graded text's from the content.
 * @param {import('../contract.js').ViewCtx} ctx @param {any} read
 * @returns {Promise<{sections: any[], graded: any | null}>}
 */
export async function sectionsFor(ctx, read) {
  if (read.source?.kind !== 'graded') return { sections: read.sections || [], graded: null };
  const text = await gradedText(ctx, read.lang || 'de', read.source.textId);
  return { sections: text ? gradedSections(text) : [], graded: text };
}

/** A graded text of the content by id, or null. @param {import('../contract.js').ViewCtx} ctx @param {string} lang @param {string} id */
export async function gradedText(ctx, lang, id) {
  try {
    const m = await ctx.content.manifest();
    if (!(m.files || []).some((/** @type {any} */ f) => f.id === `read.${lang}`)) return null;
    return (((await ctx.content.load(`read.${lang}`)) || {}).texts || []).find((/** @type {any} */ x) => x.id === id || String(x.id).split('/').pop() === id) || null;
  } catch { return null; }
}

