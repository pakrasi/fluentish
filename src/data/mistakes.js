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

   Record (mistake@1): { id, v: 1, wrong, right, rule, source: { attemptId, test, module, label }, createdAt, deletedAt }
   Added in round 5 (optional; a record without them is read as before): context {before, after}, the words around the
   sentence in his text with his other mistakes there corrected (domain/mistake.js mistakeContext), and en, its English
   when the correction gives one. A Schreiben text's mistakes get their context when they are made; older records get it
   once from the text they came from (backfillContext). A conversation's do not: its transcript stays on the device. */
import { mistakeId } from '../domain/itemids.js';
import { corrections } from '../domain/grade.js';
import { mistakeContext } from '../domain/mistake.js';

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
 * @property {{before: string, after: string} | null} [context]  the words around it in his text (round 5)
 * @property {string | null} [en]   its English, when the correction gives one (round 5)
 */

const clean = (/** @type {unknown} */ s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * Pure: the next collection value after adding one attempt's mistakes.
 * @param {Record<string, Mistake>} cur
 * @param {{attemptId: string, test?: number|null, module?: string|null, label?: string|null, items: {wrong: string, right: string, rule?: string, context?: {before: string, after: string} | null, en?: string | null}[]}} o
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
    // (context and en are added fields: only written when there is one, and never taken away)
    const extra = { ...(it.context ? { context: it.context } : {}), ...(it.en ? { en: clean(it.en) } : {}) };
    if (same) { keep.add(same.id); next[same.id] = { ...same, rule: clean(it.rule) || same.rule, ...extra }; continue; }
    const id = mistakeId(attemptId, ++n);
    next[id] = { id, v: 1, wrong, right, rule: clean(it.rule), source: { attemptId, test, module, label }, createdAt: now, deletedAt: null, ...extra };
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
 * A correction's lines (~~wrong~~ → ==right==, domain/grade.js corrections), each with the words around it in the text
 * that was corrected (mistakeContext; his other mistakes there corrected).
 * @param {string} body @param {(string | null | undefined)[]} texts the corrected texts (an exam attempt's Aufgaben)
 */
export function correctionItems(body, texts) {
  const items = corrections(body);
  return items.map(it => {
    const context = texts.map(tx => mistakeContext(it.wrong, tx, items)).find(Boolean) || null;
    return context ? { ...it, context } : it;
  });
}

/**
 * A practice text's correction (Practice › Schreiben, Write it yourself): its correction lines as the input of
 * addMistakes. One correction is one attempt: 'W-<task id>-<time>', so writing the same task again later adds its own
 * mistakes, and asking again for the same text keeps their ids.
 * @param {{taskId: string, at: number, label: string, body: string, text?: string | null}} o  text: the text he wrote
 * @returns {Parameters<typeof planMistakes>[1]}
 */
export function freeWriteMistakes({ taskId, at, label, body, text = null }) {
  return { attemptId: `W-${taskId}-${at}`, test: null, module: 'schreiben', label, items: correctionItems(body, [text]) };
}

/**
 * Pure: the context for live records that have none, from the text they came from. find(record) gives that text's
 * correction {body, texts} or null (a Practice text: the saved correction with the same time; an exam attempt: its
 * Aufgaben). Only the added field is written; ids, wrong, right and every other field stay as they are.
 * @param {Record<string, Mistake>} cur @param {(m: Mistake) => {body: string, texts: (string | null | undefined)[]} | null} find
 * @returns {Record<string, Mistake> | null} the next collection value, or null when nothing changed
 */
export function planBackfill(cur, find) {
  let next = null;
  for (const m of Object.values(cur || {})) {
    if (!m || m.deletedAt || m.context) continue;
    const src = find(m);
    if (!src) continue;
    const others = corrections(src.body);
    const context = src.texts.map(tx => mistakeContext(m.wrong, tx, others)).find(Boolean);
    if (!context) continue;
    next = next || { ...cur };
    next[m.id] = { ...m, context };
  }
  return next;
}

/**
 * Give older mistakes the words around them (round 5), once: a Practice text's from the saved correction it came from
 * (kv practice.write: corrections[task] = {body, text, at}, the same time as the attempt id), an exam attempt's from
 * its Aufgaben and its feedback. Returns how many records got one.
 * @param {{get: (n: string, f?: any) => any, set: (n: string, v: any) => void, attempts?: () => any[]}} store
 * @param {{feedback?: any[]}} [o] the exam feedback rows (their bodies hold the other corrections)
 */
export function backfillContext(store, o = {}) {
  const cur = store.get(COLLECTION, {}) || {};
  if (!Object.values(cur).some(m => m && !m.deletedAt && !m.context)) return 0;
  const pw = store.get('practice.write', {}) || {};
  const attempts = typeof store.attempts === 'function' ? store.attempts() || [] : [];
  const next = planBackfill(cur, m => {
    const id = String(m.source.attemptId || '');
    const w = /^W-(.+)-(\d+)$/.exec(id);
    if (w) {
      const cr = (pw.corrections || {})[w[1]];
      return cr && String(cr.at) === w[2] && cr.text ? { body: cr.body || '', texts: [cr.text] } : null;
    }
    const a = attempts.find(x => x && x.id === id);
    if (!a || !Array.isArray(a.writings)) return null;
    const body = (o.feedback || []).filter(f => f && String(f.attempt_id) === id).map(f => f.body).join('\n');
    return { body, texts: a.writings.map((/** @type {any} */ x) => x && x.text) };
  });
  if (!next) return 0;
  store.set(COLLECTION, next);
  return Object.keys(next).filter(k => next[k] !== cur[k]).length;
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
