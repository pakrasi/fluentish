/* What the conversation screen needs to know about the language, loaded once a session: the pack and its conversation
   part, the word list indexed for lemmas (the gloss sheet looks words up here first, with no network), and the forms
   index for the word card. Public content only. */
import { loadWordIx } from '../shared/wordix.js';
import { wordCard } from '../../domain/wordcard.js';
import { convPack } from './data.js';

/** @type {Map<string, Promise<any>>} */ const memo = new Map();

/**
 * @param {import('../contract.js').ViewCtx} ctx
 * @returns {Promise<{pack: any, conv: any, idx: any, words: any[], card: ((entry: any, lemma: string) => any) | null}>}
 */
export function language(ctx) {
  const { code, pack, conv } = convPack(ctx.settings());
  let p = memo.get(code);
  if (!p) {
    p = (async () => {
      const words = await ctx.content.load(pack?.content?.words || 'igloo.words.de').catch(() => []);
      const list = Array.isArray(words) ? words : [];
      const M = pack?.grammar?.morphology;
      const idx = M?.index ? M.index(list) : { forms: new Map(), lemmas: new Map(), words: list };
      const wix = code === 'de' ? await loadWordIx(ctx, list).catch(() => null) : null;
      const card = wix ? (/** @type {any} */ entry, /** @type {string} */ lemma) => wordCard(wix.ix, { lemma, pos: entry.pos, id: `W:${entry.id}`, zipf: entry.zipf ?? null, level: entry.level || null }) : null;
      return { pack, conv, idx, words: list, card };
    })();
    p.catch(() => memo.delete(code));
    memo.set(code, p);
  }
  return p;
}

/**
 * The listed words of his typed turns as item ids (W:<id>), stop words left out: the conversation evidence of
 * knowledge.js. A word the list does not have is left out (no guess becomes evidence).
 * @param {any} lang @param {string[]} texts
 */
export function usedIds(lang, texts) {
  const look = lang.pack?.grammar?.morphology?.lookup;
  if (!look) return [];
  // the pack's stop words (der, und, ich, haben …) are left out: meeting them says nothing
  const stop = lang.pack?.reading?.stop || new Set();
  const fold = lang.pack?.text?.fold || ((/** @type {string} */ s) => s.toLowerCase());
  /** @type {string[]} */ const out = [];
  for (const text of texts) {
    const words = String(text || '').match(/[\p{L}][\p{L}'’-]*/gu) || [];
    words.forEach((w, i) => {
      if (stop.has(fold(w.toLowerCase())) || stop.has(w.toLowerCase())) return;
      const r = look(w, lang.idx, { start: i === 0, prev: i ? words[i - 1].toLowerCase() : '' });
      if (r && r.entry && r.entry.id && r.how !== 'guess' && !r.guess) out.push(`W:${r.entry.id}`);
    });
  }
  return out;
}
