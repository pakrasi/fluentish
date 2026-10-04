/* Script mode: the word knowledge the mark screen and the word round need, loaded once a session: the German word
   list indexed for lemmas, the lexicon of German forms the B1 content uses (the grader's), the word map and the noun
   list. Loads public content only. */
import { buildIndex } from './lemma.js';
import { buildLexicon } from '../pool.js';

/** @type {Promise<{idx: any, lexicon: Set<string>, wordmap: Record<string, [string, string]>, nouns: Record<string, string>}> | null} */
let memo = null;

/** @param {import('../../contract.js').ViewCtx} ctx */
export function lexicon(ctx) {
  if (!memo) {
    memo = (async () => {
      const [words, wordmap, nouns] = await Promise.all(['igloo.words.de', 'b1.wordmap', 'b1.nouns'].map(id => ctx.content.load(id).catch(() => null)));
      /** @type {any} */ let data = null;
      try { const { loadData } = await import('../data.js'); data = await loadData(ctx); } catch { /* the B1 content is optional here */ }
      const list = Array.isArray(words) ? words : [];
      return {
        idx: buildIndex(list),
        lexicon: data?.lexicon || buildLexicon({ lexWords: list, nouns: nouns || {} }),
        wordmap: wordmap || data?.wordmap || {},
        nouns: nouns || data?.nouns || {},
      };
    })();
    memo.catch(() => { memo = null; });
  }
  return memo;
}
