/* Cluster study: loading and the small state it keeps. The cards are in deck 'clusters'; the knowledge score
   (data/knowledge.js) counts what is known in each cluster from every deck, so a word learnt anywhere counts here.
     kv 'clusters'   { day: {day, rounds, newShown}, last: '<type>:<id>', shown: { '<type>:<id>': known count last shown } } */
import { index } from '../../domain/clusters.js';
import { loadKnowledge } from '../../data/knowledge.js';
import { isDue, sideCap } from '../../domain/b1ready.js';
import * as FS from '../../domain/fsrs.js';
import { cardIds, itemFor, itemIds } from './cluster-items.js';
import { loadWordIx } from './wordix.js';

export const DECK = 'clusters';
export const KV = 'clusters';

/** @type {Promise<{c: any, words: any[], ix: ReturnType<typeof index>, fx: any}> | null} */ let memo = null;

/** The clusters content, the word list, the index and the word forms index (once a session). @param {{content: any}} ctx */
export function loadClusters(ctx) {
  if (!memo) {
    memo = Promise.all([ctx.content.load('clusters.de'), ctx.content.load('igloo.words.de')])
      .then(async ([c, words]) => ({ c, words, ix: index(c, words), fx: await loadWordIx(ctx, words).catch(() => null) }));
    memo.catch(() => { memo = null; });
  }
  return memo;
}

/** @param {any} store */
export const state = store => store.get(KV, {}) || {};

/** Today's day log. @param {any} store @param {string} today */
export const dayOf = (store, today) => { const d = state(store).day; return d && d.day === today ? d : { day: today, rounds: 0, newShown: 0 }; };

/** @param {any} store @param {(s: any) => any} fn */
export const update = (store, fn) => store.update(KV, (/** @type {any} */ s) => fn({ ...(s || {}) }), {});

/**
 * Counts for one cluster: known, shaky, unknown, unseen out of n, from the knowledge score.
 * @param {import('../../domain/clusters.js').Cluster} cl @param {any} k loadKnowledge()
 */
export const countsOf = (cl, k) => k.summary(itemIds(cl));

/**
 * Field cell states for a cluster's words (Field: 0 not started, 1 learning, 2 known, 3 known and practised today).
 * @param {import('../../domain/clusters.js').Cluster} cl @param {any} k
 */
export function cellsOf(cl, k) {
  return itemIds(cl).map(id => { const s = k.get(id); return s.state === 'known' ? (s.today ? 3 : 2) : s.state === 'unseen' ? 0 : 1; });
}

/** Cards in deck 'clusters' due today (all clusters; at their own due dates through an exam window). @param {any} store @param {any} c */
export function dueCards(store, c) {
  const sc = sideCap(c);
  return Object.entries(store.cards(DECK) || {}).filter(([, r]) => r && r.reps && isDue(r, c.today, sc)).map(([id]) => id);
}

/** Recall of a card today (unseen 0). @param {any} c */
export const recallOf = c => (/** @type {any} */ rec) => FS.Ron(rec, c.today);

export { cardIds, itemFor, loadKnowledge };
