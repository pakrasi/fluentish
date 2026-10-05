/* Quick sort and the level spot check: which words, and the rules. Pure; tested in node (tests/unit/known.test.mjs).
   The views are sort.js and check.js. */
import { typable } from '../clusters/items.js';

const ALL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** Most words a sort takes at once (a level is long; he can sort the rest later). */
export const SORT_MAX = 400;

/**
 * The words to sort: in the given order, without repeats, words that exist and have no gap, not known yet.
 * @param {string[]} ids word ids (no W:) @param {(id: string) => any} word @param {(itemId: string) => {state: string}} score
 */
export function sortList(ids, word, score) {
  /** @type {string[]} */ const out = [];
  for (const id of ids) {
    if (out.includes(id)) continue;
    const w = word(id);
    if (!w || !typable(w)) continue;
    if (score(`W:${id}`).state === 'known') continue;
    out.push(id);
    if (out.length >= SORT_MAX) break;
  }
  return out;
}

/**
 * Parse the address into a source: {kind, key?, level?, ids?, title?}.
 * @param {URLSearchParams} q
 */
export function sortSource(q) {
  const cluster = q.get('cluster'), level = q.get('level'), ids = q.get('ids');
  if (cluster && /^(family|opp|prefix|suffix|topic|prep):[\w.äöüß-]+$/.test(cluster)) return { kind: 'cluster', key: cluster };
  if (level && ALL_LEVELS.includes(level)) return { kind: 'level', level };
  if (ids) return { kind: 'ids', ids: ids.split(',').map(x => x.trim().replace(/^W:/, '')).filter(x => /^[\wäöüÄÖÜß.'-]+$/.test(x)), title: (q.get('title') || '').slice(0, 80) };
  return null;
}

export const CHECK_N = 10;
export const MAX_MISSES = 2;

/**
 * The words a level mark takes: the level's words with no gap that he has not studied anywhere.
 * @param {any[]} words the word list @param {string} level @param {(itemId: string) => {state: string, marked?: any}} score
 */
export function levelWords(words, level, score) {
  return words.filter(w => w.level === level && typable(w) && score(`W:${w.id}`).state === 'unseen').map(w => w.id);
}

/** n ids at random (Fisher-Yates on a copy). @param {string[]} ids @param {number} n @param {() => number} [rand] */
export function sample(ids, n, rand = Math.random) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

/** Whether a check passes: at most MAX_MISSES misses. @param {number} misses */
export const passes = misses => misses <= MAX_MISSES;

