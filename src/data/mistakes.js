/* Mistakes from corrections become review cards (UX §3.3). This is the store-level API between the feature that has
   a correction (Exam: a corrected Schreiben or Sprechen attempt; Practice › Schreiben: a text written from memory,
   "Write it yourself", which Build an email also ends in) and Practice, which turns each mistake
   into an item ("Rewrite this sentence correctly") in the one review queue, deck 'b1', id 'F:<attempt>-<n>'.

   The records live in the profile's key-value collection 'mistakes' (private: never in the public repo or content).
   Only this module writes it. A feature calls:

     addMistakes(store, { attemptId, test, module, label, items: [{ wrong, right, rule? }] })   → ids added
     listMistakes(store)                    → live records, oldest first
     removeMistake(store, id)               → marks one deleted (the card stays in history, the item leaves rounds)

   addMistakes is idempotent per attempt: calling it again with the same attemptId replaces that attempt's list
   (a re-correction), keeping the ids of sentences that did not change so their schedule survives.

   Record (mistake@1): { id, v: 1, wrong, right, rule, source: { attemptId, test, module, label }, createdAt, deletedAt } */
import { mistakeId } from '../domain/itemids.js';
import { corrections } from '../domain/grade.js';

export const COLLECTION = 'mistakes';

/**
 * @typedef {object} Mistake
 * @property {string} id            'F:<attemptId>-<n>'
 * @property {1} v
 * @property {string} wrong         the learner's sentence
 * @property {string} right         the corrected sentence
 * @property {string} rule          one line on what changed (may be '')
 * @property {{attemptId: string, test: number|null, module: string|null, label: string|null}} source
 * @property {string} createdAt     ISO time
 * @property {string|null} deletedAt
 */

const clean = (/** @type {unknown} */ s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * Pure: the next collection value after adding one attempt's mistakes.
 * @param {Record<string, Mistake>} cur
 * @param {{attemptId: string, test?: number|null, module?: string|null, label?: string|null, items: {wrong: string, right: string, rule?: string}[]}} o
 * @param {string} now  ISO time
 * @returns {{next: Record<string, Mistake>, added: string[]}}
 */
export function planMistakes(cur, { attemptId, test = null, module = null, label = null, items }, now) {
  if (!attemptId) throw new Error('addMistakes: attemptId is required');
  const next = { ...cur };
  const old = Object.values(cur).filter(m => m.source.attemptId === attemptId && !m.deletedAt);
  const byPair = new Map(old.map(m => [`${m.wrong}\u0000${m.right}`, m]));
  const keep = new Set();
  /** @type {string[]} */ const added = [];
  let n = Math.max(0, ...Object.values(cur).filter(m => m.source.attemptId === attemptId).map(m => Number(m.id.split('-').pop()) || 0));
  for (const it of items || []) {
    const wrong = clean(it.wrong), right = clean(it.right);
    if (!wrong || !right || wrong === right) continue;
    const same = byPair.get(`${wrong}\u0000${right}`);
    if (same) { keep.add(same.id); next[same.id] = { ...same, rule: clean(it.rule) || same.rule }; continue; }
    const id = mistakeId(attemptId, ++n);
    next[id] = { id, v: 1, wrong, right, rule: clean(it.rule), source: { attemptId, test, module, label }, createdAt: now, deletedAt: null };
    keep.add(id); added.push(id);
  }
  for (const m of old) if (!keep.has(m.id)) next[m.id] = { ...m, deletedAt: now };
  return { next, added };
}

/**
 * Add (or replace) the mistakes of one corrected attempt. Returns the ids of the new mistakes.
 * @param {{get: (n: string, f?: any) => any, set: (n: string, v: any) => void}} store
 * @param {Parameters<typeof planMistakes>[1]} o
 */
export function addMistakes(store, o) {
  const { next, added } = planMistakes(store.get(COLLECTION, {}) || {}, o, new Date().toISOString());
  store.set(COLLECTION, next);
  return added;
}

/**
 * A practice text's correction (Practice › Schreiben, Write it yourself): its correction lines (~~wrong~~ → ==right==,
 * domain/grade.js corrections) as the input of addMistakes. One correction is one attempt: 'W-<task id>-<time>', so
 * writing the same task again later adds its own mistakes, and asking again for the same text keeps their ids.
 * @param {{taskId: string, at: number, label: string, body: string}} o
 * @returns {Parameters<typeof planMistakes>[1]}
 */
export function freeWriteMistakes({ taskId, at, label, body }) {
  return { attemptId: `W-${taskId}-${at}`, test: null, module: 'schreiben', label, items: corrections(body) };
}

/** Live mistakes, oldest first. @param {{get: (n: string, f?: any) => any}} store @returns {Mistake[]} */
export function listMistakes(store) {
  return Object.values(/** @type {Record<string, Mistake>} */ (store.get(COLLECTION, {}) || {}))
    .filter(m => m && !m.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** @param {{get: (n: string, f?: any) => any, set: (n: string, v: any) => void}} store @param {string} id */
export function removeMistake(store, id) {
  const cur = store.get(COLLECTION, {}) || {};
  if (!cur[id] || cur[id].deletedAt) return false;
  store.set(COLLECTION, { ...cur, [id]: { ...cur[id], deletedAt: new Date().toISOString() } });
  return true;
}
