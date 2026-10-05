/* The knowledge score for the app: reads every deck, the exam words, the Look up views and Igloo's legacy Test and
   Drill data (doors.know.v1, doors.srs.v1: read-only, never written), and the content that maps cards onto items, then
   scores with domain/knowledge.js. Explore and Practice's clusters call loadKnowledge(); it never writes. */
import { knowledge, resolver, conceptItems } from '../domain/knowledge.js';
import { COLLECTION as SEEN } from './seen.js';

/** Decks of the one review schedule whose cards are items. */
export const DECKS = ['b1', 'speak', 'script', 'clusters'];

/** @type {Promise<any> | null} */ let maps = null;

/**
 * The content that maps card ids onto items (loaded once a session; a missing file only loses its mapping).
 * @param {{load: (id: string) => Promise<any>}} content
 */
export function itemMaps(content) {
  if (!maps) {
    const get = (/** @type {string} */ id) => content.load(id).catch(() => null);
    maps = Promise.all(['igloo.words.de', 'speak.situations', 'b1.items', 'clusters.de', 'igloo.grammar.concepts.de', 'igloo.grammar.items.de', 'b1.plan'].map(get))
      .then(([words, sim, items, clusters, concepts, gItems, plan]) => {
        /** @type {Record<string, string>} */ const chunkOf = {};
        for (const it of (sim && sim.items) || []) if (it.ck) chunkOf[it.id] = it.ck;
        for (const it of items || []) if (it.chunk) chunkOf[it.id] = it.chunk;
        /** @type {Record<string, string>} */ const gapPrep = {};
        for (const g of (clusters && clusters.preps && clusters.preps.gaps) || []) gapPrep[g.id] = g.prep;
        return { words: words || [], clusters, resolve: resolver({ words: words || [], chunkOf, gapPrep }),
          concepts: conceptItems({ concepts: concepts || [], items: gItems || [], b1Items: items || [], plan }), conceptList: concepts || [] };
      });
    maps.catch(() => { maps = null; });
  }
  return maps;
}

/** A legacy localStorage value, read-only; {} when it is missing or blocked. @param {string} key */
function legacy(key) {
  try { const v = globalThis.localStorage && localStorage.getItem(key); return v ? JSON.parse(v) || {} : {}; } catch { return {}; }
}

/**
 * Score everything now. patch: card records to use instead of the stored ones ({deck: {id: record | null}}), for the
 * state before a round. @param {{store: any, clock: any, content: any}} ctx @param {{patch?: Record<string, Record<string, any>>}} [o]
 * @returns {Promise<ReturnType<typeof knowledge> & {maps: any}>}
 */
export async function loadKnowledge(ctx, { patch = {} } = {}) {
  const m = await itemMaps(ctx.content);
  const c = ctx.clock.ctx();
  /** @type {Record<string, Record<string, any>>} */ const decks = {};
  for (const d of DECKS) {
    decks[d] = ctx.store.cards(d) || {};
    if (patch[d]) { decks[d] = { ...decks[d] }; for (const [id, rec] of Object.entries(patch[d])) { if (rec) decks[d][id] = rec; else delete decks[d][id]; } }
  }
  const wc = ctx.store.get('words.exam', null);
  const examWords = wc && Array.isArray(wc.words) ? wc.words.map((/** @type {any} */ w) => m.resolve(w.id, 'b1')).filter(Boolean) : [];
  const k = knowledge({ today: c.today, epoch: ctx.clock.epochDay(), decks, resolve: m.resolve, know: legacy('doors.know.v1'), srs: legacy('doors.srs.v1'),
    lang: 'german', examWords, seen: ctx.store.get(SEEN, {}) || {} });
  return { ...k, maps: m };
}
