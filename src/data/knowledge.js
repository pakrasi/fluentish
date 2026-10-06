/* The knowledge score for the app: reads every deck, the exam words, the Look up views and Igloo's legacy Test and
   Drill data (doors.know.v1, doors.srs.v1: read-only, never written), and the content that maps cards onto items, then
   scores with domain/knowledge.js. Explore and Practice's clusters call loadKnowledge(); it never writes. */
import { knowledge, resolver, conceptItems } from '../domain/knowledge.js';
import { COLLECTION as SEEN } from './seen.js';
import { lemmaMaps } from '../domain/wordbuild.js';
import { LEGACY_DECKS, decksOf } from '../domain/decks.js';
import { activeCourse, langIdOf } from './settings.js';

/**
 * Evidence without a card (domain/knowledge.js Input.evidence): origin → the profile kv collection of
 * {[item id]: {first, last, n}} it is read from. A feature that records where items were met adds one line here
 * (round 4: reading, conversation); the collection's owner is the only writer.
 * @type {Partial<Record<import('../domain/itemids.js').Origin, string>>}
 */
export const EVIDENCE_KV = {
  lookup: SEEN,
};

/** The evidence collections of a store, by origin. @param {any} store */
export const evidenceOf = store => Object.fromEntries(Object.entries(EVIDENCE_KV).map(([o, kv]) => [o, store.get(kv, {}) || {}]));

/** Decks of the one review schedule whose cards are items (the decks from before courses: all German). */
export const DECKS = [...LEGACY_DECKS];

/**
 * The decks knowledge reads: the active course's (Arch #12): of the legacy decks and any '<lang>:<name>' deck in the
 * store, those in the course's language. Without a course (before onboarding) every legacy deck, as before courses.
 * @param {any} store @returns {string[]}
 */
export function knowledgeDecks(store) {
  const named = Object.keys((store && store.cardsByDeck) || {}).filter(d => d.includes(':') && !DECKS.includes(d));
  return decksOf([...DECKS, ...named.sort()], activeCourse(store.get('settings')));
}

/** The Igloo language key of the active course ('german'): its legacy SM-2 data is keyed '<key>|<item id>'. @param {any} store */
const iglooLang = store => langIdOf(activeCourse(store.get('settings'))?.lang) || 'german';

/** @type {Promise<any> | null} */ let maps = null;

/**
 * The content that maps card ids onto items (loaded once a session; a missing file only loses its mapping).
 * @param {{load: (id: string) => Promise<any>}} content
 */
export function itemMaps(content) {
  if (!maps) {
    const get = (/** @type {string} */ id) => content.load(id).catch(() => null);
    maps = Promise.all(['igloo.words.de', 'speak.situations', 'b1.items', 'clusters.de', 'igloo.grammar.concepts.de', 'igloo.grammar.items.de', 'b1.plan', 'build.de'].map(get))
      .then(([words, sim, items, clusters, concepts, gItems, plan, build]) => {
        /** @type {Record<string, string>} */ const chunkOf = {};
        for (const it of (sim && sim.items) || []) if (it.ck) chunkOf[it.id] = it.ck;
        for (const it of items || []) if (it.chunk) chunkOf[it.id] = it.chunk;
        /** @type {Record<string, string>} */ const gapPrep = {};
        for (const g of (clusters && clusters.preps && clusters.preps.gaps) || []) gapPrep[g.id] = g.prep;
        return { words: words || [], clusters, build, resolve: resolver({ words: words || [], chunkOf, gapPrep, build: build ? lemmaMaps(build) : {} }),
          concepts: conceptItems({ concepts: concepts || [], items: gItems || [], b1Items: items || [], plan }), conceptList: concepts || [] };
      });
    maps.catch(() => { maps = null; });
  }
  return maps;
}

/** A legacy localStorage value, read-only; {} when it is missing or blocked. @param {string} key */
export function legacy(key) {
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
  for (const d of knowledgeDecks(ctx.store)) {
    decks[d] = ctx.store.cards(d) || {};
    if (patch[d]) { decks[d] = { ...decks[d] }; for (const [id, rec] of Object.entries(patch[d])) { if (rec) decks[d][id] = rec; else delete decks[d][id]; } }
  }
  const wc = ctx.store.get('words.exam', null);
  const examWords = wc && Array.isArray(wc.words) ? wc.words.map((/** @type {any} */ w) => m.resolve(w.id, 'b1')).filter(Boolean) : [];
  // Igloo's data on this device belongs to the profile the legacy import ran for, not to every profile
  const migrated = !!(ctx.store.get('meta', {}) || {}).migratedAt;
  const k = knowledge({ today: c.today, epoch: ctx.clock.epochDay(), decks, resolve: m.resolve, know: migrated ? legacy('doors.know.v1') : {}, srs: migrated ? legacy('doors.srs.v1') : {},
    lang: iglooLang(ctx.store), itemLang: activeCourse(ctx.store.get('settings'))?.lang || 'de', examWords, evidence: evidenceOf(ctx.store) });
  return { ...k, maps: m };
}
