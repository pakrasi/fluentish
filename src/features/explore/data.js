/* Explore: loading the map and scoring it. The map (content atlas.de, tools/build-atlas.mjs) is decoded once a session;
   the knowledge score (data/knowledge.js) is read again whenever a deck changes, and turned into typed arrays the
   renderer draws from. Explore never writes a card. Its own small state:
     kv 'explore'   { mode, gaps, introDay, shown: {day, ids: [item ids already shown as learned today]} } */
import { decode, positions, bounds, sourceGroups, layoutSource, STATE_CODE, KINDS, LEVELS, ARTICLES } from '../../domain/atlas.js';
import { index as clusterIndex } from '../../domain/clusters.js';
import { loadKnowledge } from '../../data/knowledge.js';

export const KV = 'explore';
/** @param {any} store */
export const prefs = store => store.get(KV, {}) || {};
/** @param {any} store @param {(s: any) => any} fn */
export const setPrefs = (store, fn) => store.update(KV, (/** @type {any} */ s) => fn({ ...(s || {}) }), {});

/** @type {Promise<any> | null} */ let memo = null;

/**
 * The decoded map with its item table as typed arrays (once a session).
 * @param {{content: any}} ctx
 */
export function loadAtlas(ctx) {
  if (!memo) {
    memo = ctx.content.load('atlas.de').then((/** @type {any} */ file) => {
      const m = decode(file), I = m.items, n = I.id.length;
      const W = new Float32Array(n), AW = new Float32Array(n), F = new Float32Array(n);
      for (let i = 0; i < n; i++) { W[i] = I.w[i] / 10; AW[i] = I.aw[i] / 10; F[i] = I.f[i] / 100; }
      const index = new Map(I.id.map((/** @type {string} */ id, /** @type {number} */ i) => [id, i]));
      // a phrase's slot ("dass [Satz]") reads as an ellipsis, the way it is said
      return { n, ids: /** @type {string[]} */ (I.id), text: /** @type {string[]} */ (I.t.map((/** @type {string} */ x) => x.replace(/\[[^\]]*\]/g, '…'))), art: I.a.map((/** @type {number} */ a) => ARTICLES[a]),
        kind: I.k.map((/** @type {number} */ k) => KINDS[k]), level: I.L.map((/** @type {number} */ l) => LEVELS[l] || ''), pos: I.p, W, AW, F, index, modes: m.modes, unit: m.unit };
    });
    memo.catch(() => { memo = null; });
  }
  return memo;
}

/**
 * A mode's layout: the groups and every item's place. Source is laid out here from where each item was met.
 * @param {any} A loadAtlas() @param {string} mode @param {any} [K] scores(), for Source
 */
export function layoutOf(A, mode, K) {
  let groups = A.modes[mode];
  if (mode === 'source') {
    const items = A.ids.map((/** @type {string} */ id, /** @type {number} */ i) => ({ id, t: A.text[i], a: A.art[i], k: A.kind[i], L: A.level[i], p: A.pos[i], f: A.F[i], r: i }));
    const specs = sourceGroups(items, id => ({ sources: K ? K.sourcesOf(id) : [] }), id => (K ? K.firstOf(id) : ''));
    const placed = layoutSource(specs, new Map(A.ids.map((/** @type {string} */ id, /** @type {number} */ i) => [id, Math.round(A.W[i] * 10)])));
    groups = placed.map(g => ({ ...g, items: g.ids.map(id => A.index.get(id)), pair: g.pair }));
  }
  const P = positions(groups, A.n);
  return { mode, groups, ...P, bounds: bounds(groups) };
}

/**
 * Score every item on the map: state codes (atlas STATE_CODE), today flags, and accessors for the cards.
 * @param {any} ctx view ctx @param {any} A loadAtlas()
 */
export async function scores(ctx, A) {
  const k = await loadKnowledge(ctx);
  const st = new Uint8Array(A.n), today = new Uint8Array(A.n);
  /** @type {Map<number, any>} */ const concept = new Map();
  for (let i = 0; i < A.n; i++) {
    const id = A.ids[i];
    let s;
    if (A.kind[i] === 'g') { s = k.concept(id.slice(3), k.maps.concepts[id.slice(3)] || []); concept.set(i, s); } else s = k.get(id);
    st[i] = STATE_CODE[/** @type {import('../../domain/atlas.js').State} */ (s.state)]; today[i] = s.today ? 1 : 0;
  }
  const decks = Object.fromEntries(['b1', 'speak', 'script', 'clusters'].map(d => [d, ctx.store.cards(d) || {}]));
  return {
    k, st, today,
    /** @param {number} i */ score: i => concept.get(i) || k.get(A.ids[i]),
    /** @param {string} id */ sourcesOf: id => { const i = A.index.get(id); return (i != null && concept.get(i)?.sources) || k.get(id).sources; },
    /** the day the item was first met: the earliest `first` of its cards ('' when unknown) @param {string} id */
    firstOf: id => {
      let best = '';
      for (const c of k.get(id).cards) { const j = c.indexOf('/'); const rec = decks[c.slice(0, j)]?.[c.slice(j + 1)]; const f = rec && rec.first; if (f && (!best || f < best)) best = f; }
      return best;
    },
  };
}

/** @type {Promise<any> | null} */ let details = null;
/**
 * What a word card needs beyond the map: the word list entries, the phrases' English and examples, the concepts, and
 * the clusters index (opposites, families). Loaded on the first card.
 * @param {any} ctx @param {any} maps loadKnowledge().maps
 */
export function loadDetails(ctx, maps) {
  if (!details) {
    const get = (/** @type {string} */ id) => ctx.content.load(id).catch(() => null);
    details = Promise.all([get('igloo.chunks.german'), get('igloo.chunks.en'), get('b1.plan'), get('b1.bank'), get('b1.items'), get('b1.grammar')]).then(([de, en, plan, bank, items, grammar]) => {
      // what Practice rounds can ask (#/practice/round?kind=pick:…): the speaking bank's phrases (K:), a B1 item that is
      // a phrase's twin (asked under its own id), the B1 grammar items (G:, BG:)
      /** @type {Map<string, string>} */ const twinOf = new Map();
      for (const it of items || []) if (it.chunk && !twinOf.has(it.chunk)) twinOf.set(it.chunk, it.id);
      const bankIds = new Set(Object.keys(bank || {}));
      const askable = new Set([...((grammar || []).map((/** @type {any} */ g) => `G:${g.id}`)), ...(items || []).filter((/** @type {any} */ it) => String(it.id).startsWith('BG:')).map((/** @type {any} */ it) => it.id)]);
      /** The round id of a map item or a grammar item, or null when no round asks it. @param {string} id */
      const roundId = id => {
        if (id.startsWith('K:')) { const cid = id.slice(2); return twinOf.get(cid) || (bankIds.has(cid) ? id : null); }
        return askable.has(id) ? id : null;
      };
      const words = new Map((maps.words || []).map((/** @type {any} */ w) => [w.id, w]));
      const ix = maps.clusters ? clusterIndex(maps.clusters, maps.words || []) : null;
      /** @type {Map<string, string>} */ const famOf = new Map();
      for (const f of maps.clusters?.families || []) for (const m of f.members) famOf.set(m, f.id);
      /** @type {Map<string, string>} */ const topicOfConcept = new Map();
      for (const t of plan?.topics || []) for (const c of t.concepts || []) if (!topicOfConcept.has(c)) topicOfConcept.set(c, t.id);
      return { words, chunksDe: de?.chunks || {}, chunksEn: new Map((en || []).map((/** @type {any} */ c) => [c.id, c])), concepts: new Map((maps.conceptList || []).map((/** @type {any} */ c) => [c.id, c])),
        ix, families: new Map((maps.clusters?.families || []).map((/** @type {any} */ f) => [f.id, f])), famOf, topicOfConcept, roundId };
    });
    details.catch(() => { details = null; });
  }
  return details;
}

/** Fold for search: lower case, no accents, ß as ss. @param {string} s */
export const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

/**
 * Search the map: German prefix matches first (any word of the item), then German anywhere, then English. Returns
 * item indices. @param {any} A @param {string[]} folded fold(article + text) per item @param {string[]} en folded English per item
 * @param {string} q @param {number} [n]
 */
export function find(A, folded, en, q, n = 12) {
  const f = fold(q.trim());
  if (!f) return [];
  /** @type {[number, number, number][]} */ const hits = [];
  for (let i = 0; i < A.n; i++) {
    const g = folded[i];
    const s = g.startsWith(f) || g.split(/[\s,]+/).some(p => p.startsWith(f)) ? 0 : g.includes(f) ? 1 : en[i] && en[i].includes(f) ? 2 : -1;
    if (s >= 0) hits.push([s, -A.F[i], i]);
  }
  return hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).slice(0, n).map(h => h[2]);
}
