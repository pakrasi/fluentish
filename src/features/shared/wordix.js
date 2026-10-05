/* The word forms index every word card reads (domain/forms.js over the word list and content b1.forms), loaded once
   per content version. Exam words, Word clusters and Quick sort build their word panels from it. */
import { formsIndex, verbSet } from '../../domain/forms.js';

/** @type {{key: any, forms: any, v: {ix: ReturnType<typeof formsIndex>, verbs: Set<string>}} | null} */ let memo = null;

/**
 * @param {{content: {load: (id: string) => Promise<any>}}} ctx
 * @param {any[] | null} [words] the word list when the caller has it already
 */
export async function loadWordIx(ctx, words = null) {
  const [list, forms] = await Promise.all([words ? Promise.resolve(words) : ctx.content.load('igloo.words.de'), ctx.content.load('b1.forms').catch(() => null)]);
  if (memo && memo.key === list && memo.v && forms === memo.forms) return memo.v;
  const ix = formsIndex(Array.isArray(list) ? list : [], forms);
  const v = { ix, verbs: verbSet(ix) };
  memo = { key: list, forms, v };
  return v;
}
