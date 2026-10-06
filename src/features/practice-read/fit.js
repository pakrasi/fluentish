/* Reading: how each graded text fits him (round 4, UX review #5). His coverage of every graded text of the content,
   its band, and the next one to read: the first unread text in his study band (95 to 98 % known), then the easy ones,
   then the stretches, the texts nearest his level first. Today's Read row offers it, and the library sorts by it.
   Worked out once a day per level and per number of texts opened, and kept for the session; a text he finished or
   read most of is read. */
import * as R from '../shared/read-data.js';
import * as L from './logic.js';
import { language, knowledgeNow, langOf } from './load.js';
import { levelRank } from '../../domain/text/estimate.js';

/** @typedef {{id: string, slug: string, title: string, level: string, words: number, lit: boolean, coverage: number | null, band: string | null, by: any, read: boolean, share: number}} Fit */

/** The bands in the order a text is offered. */
const ORDER = { study: 0, easy: 1, stretch: 2, hard: 3 };
/** @type {Map<string, Promise<Fit[]>>} */ const memo = new Map();
/** The last list worked out (for Today's plan, which reads it without waiting), and the level it was for. @type {Fit[] | null} */ let last = null;
let lastLevel = 'B1';

/** A graded text's slug ("b2-work-01"). @param {any} x */
export const slugOf = x => String(x.id).split('/').pop() || '';

/** The graded texts of the content in a language, or []. @param {import('../contract.js').ViewCtx} ctx @param {string} lang */
export async function gradedTexts(ctx, lang) {
  try {
    const m = await ctx.content.manifest();
    if (!(m.files || []).some((/** @type {any} */ f) => f.id === `read.${lang}`)) return [];
    return ((await ctx.content.load(`read.${lang}`)) || {}).texts || [];
  } catch { return []; }
}

/**
 * Every graded text with his coverage, its band and whether he has read it, in the order to read them.
 * @param {import('../contract.js').ViewCtx} ctx @returns {Promise<Fit[]>}
 */
export function fits(ctx) {
  const lang = langOf(ctx);
  const level = ctx.settings().level || 'B1';
  const reads = R.listReads(ctx.store).filter(r => r.source?.kind === 'graded');
  const key = `${lang}|${level}|${ctx.clock.today()}|${reads.length}|${reads.reduce((n, r) => n + (r.progress?.done ? 1 : 0), 0)}`;
  let p = memo.get(key);
  if (!p) {
    p = (async () => {
      const texts = await gradedTexts(ctx, lang);
      if (!texts.length) return [];
      const [Lg, K] = await Promise.all([language(ctx), knowledgeNow(ctx)]);
      const view = K || { get: () => ({ state: /** @type {const} */ ('unseen') }) };
      const met = R.metSet(ctx.store);
      const byText = new Map(reads.map(r => [String(r.source.textId).split('/').pop(), r]));
      const out = texts.map((/** @type {any} */ x) => {
        const slug = slugOf(x);
        const r = byText.get(slug) || byText.get(x.id);
        let e = r && r.estimate && r.estimate.ver === L.ESTIMATE_VER ? r.estimate : null;
        if (!e) {
          try {
            const an = L.analyse(L.sentencesOf({ sections: L.gradedSections(x) }), { pack: Lg.pack, idx: Lg.idx, lexicon: Lg.lexicon, level, suggest: false });
            e = L.estimate(an, { pack: Lg.pack, idx: Lg.idx, view, level, met });
          } catch { e = null; }
        }
        const share = Number(r?.progress?.share) || 0;
        return { id: x.id, slug, title: x.title, level: x.level, words: e?.words || x.words || 0, lit: !!x.source, coverage: e ? e.coverage : null, band: e ? e.band : null, by: e ? e.by : null,
          read: !!(r && (r.progress?.done || share >= 0.9)), share };
      });
      const me = levelRank(level);
      out.sort((/** @type {Fit} */ a, /** @type {Fit} */ b) => Number(a.read) - Number(b.read) || (ORDER[/** @type {keyof ORDER} */ (a.band || 'hard')] - ORDER[/** @type {keyof ORDER} */ (b.band || 'hard')])
        || (b.coverage ?? 0) - (a.coverage ?? 0) || Math.abs(levelRank(a.level) - me) - Math.abs(levelRank(b.level) - me) || a.id.localeCompare(b.id));
      last = out; lastLevel = level;
      return out;
    })();
    p.catch(() => memo.delete(key));
    memo.clear();
    memo.set(key, p);
  }
  return p;
}

/**
 * The next text to read: unread, in the study band, then easy, then a stretch; when every text is harder than that,
 * the unread one at his own level he knows most of. @param {Fit[] | null} list @param {string} [level] his level
 */
export const nextOf = (list, level) => (list || []).find(f => !f.read && f.band && f.band !== 'hard')
  || (list || []).filter(f => !f.read && f.level === level).sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0))[0] || null;

/** The last worked-out next text, for a caller that cannot wait (Today's plan). */
export const lastNext = () => nextOf(last, lastLevel);

