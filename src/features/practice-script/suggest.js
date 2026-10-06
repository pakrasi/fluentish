/* Script mode's suggestions: domain/text/suggest.js (moved there unchanged in round 4) with the German pack. */
import * as T from '../../domain/text/suggest.js';
import { scriptPack } from './lemma.js';

export const { cardId, capSuggest, SUGGEST_SHARE, levelRank } = T;

/**
 * Classify one sentence's tokens (domain/text/suggest.js classify) with the German pack.
 * @param {import('../../domain/text/tokens.js').Token[]} tokens
 * @param {Omit<Parameters<typeof T.classify>[1], 'pack'> & {pack?: import('../../lang/types.js').LanguagePack}} ctx
 */
export const classify = (tokens, ctx) => T.classify(tokens, { pack: scriptPack, ...ctx });
