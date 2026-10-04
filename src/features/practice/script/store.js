/* Script mode: storage. Everything a script holds is private to this device (SCRIPT-UX §8):
     kv 'scripts'           { [scriptId]: script@1 }   the text, sections, marks; a deleted script keeps a tombstone
     kv 'scripts.progress'  { [scriptId]: { sections: { [sectionId]: ladder progress }, runs: [...], newBy: { [day]: n }, seenPct } }
     kv 'scripts.words'     { [cardId]: { lemma, head, gloss } }   words of deleted scripts, so they stay reviewable
     cards deck 'script'    SR: section rehearsals, SW: script words, and W: list words first met in a script
   A W: card he already had in deck 'b1' stays there and is reviewed there (one card per lemma).
   Reviews append card.reviewed events marked local: true; the results sync never sends them (its types exclude
   card.reviewed, and the flag says why), and Profile › Data › Export leaves all of this out unless he ticks
   "Include scripts". */
import * as D8 from '../../../domain/days.js';
import { timeZone } from '../../../data/ids.js';
import { MAX_ACTIVE } from './config.js';

export const KV = 'scripts';
export const PROGRESS = 'scripts.progress';
export const WORDS = 'scripts.words';
export const DECK = 'script';

/** @param {any} store @returns {Record<string, any>} */
export const all = store => store.get(KV, {}) || {};

/** Scripts to show: not deleted. Active first by delivery date, then no date, then paused; archived last. @param {any} store */
export function list(store) {
  const rank = (/** @type {any} */ s) => (s.status === 'archived' ? 3 : s.status === 'paused' ? 2 : s.deliverOn ? 0 : 1);
  return Object.values(all(store)).filter(s => s && !s.deletedAt && s.sections)
    .sort((a, b) => rank(a) - rank(b) || String(a.deliverOn || '').localeCompare(String(b.deliverOn || '')) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** @param {any} store @param {string} id */
export const get = (store, id) => { const s = all(store)[id]; return s && !s.deletedAt && s.sections ? s : null; };

/** @param {any} store @param {any} script */
export function put(store, script) {
  store.update(KV, (/** @type {any} */ m) => ({ ...(m || {}), [script.id]: { ...script, rev: Date.now() } }), {});
}

/** @param {any} store @param {string} id @returns {any} */
export const progress = (store, id) => (store.get(PROGRESS, {}) || {})[id] || { sections: {}, runs: [], newBy: {} };

/** @param {any} store @param {string} id @param {(p: any) => any} fn */
export function updateProgress(store, id, fn) {
  return store.update(PROGRESS, (/** @type {any} */ m) => {
    const cur = (m || {})[id] || { sections: {}, runs: [], newBy: {} };
    return { ...(m || {}), [id]: fn(structuredClone(cur)) };
  }, {});
}

/** Active scripts (not paused, archived or deleted). @param {any} store */
export const active = store => list(store).filter(s => s.status === 'active');
/** Whether a new script may start active (at most two at once). @param {any} store */
export const canActivate = store => active(store).length < MAX_ACTIVE;

/**
 * A card wherever it lives: deck 'b1' first (a list word he already had), then deck 'script'.
 * @param {any} store @returns {(id: string) => {rec: any, deck: string} | null}
 */
export function cardOf(store) {
  const b1 = store.cards('b1'), sc = store.cards(DECK);
  return id => (b1[id] ? { rec: b1[id], deck: 'b1' } : sc[id] ? { rec: sc[id], deck: DECK } : null);
}

/**
 * Save one review of a script card (word or section) with its local-only event.
 * @param {any} store @param {{id: string, rec: any, prev: any, deck: string, g: number, ms?: number, flags?: string, mode?: string, ctx: any, scriptId: string}} o
 */
export function saveReview(store, { id, rec, prev, deck, g, ms = 0, flags = '', mode = 't', ctx, scriptId }) {
  if (!rec) return;
  const origin = new Set([...(prev?.origin || []), ...(rec.origin || [])]);
  if (deck === DECK) origin.add(`script:${scriptId}`);
  const next = deck === DECK ? { ...rec, origin: [...origin] } : rec;
  store.putCards(deck, [[id, next]]);
  store.append('card.reviewed', { deck, itemId: id, g, ms: Math.round(ms), flags, mode, ctx: { exam: ctx.exam || null, phase: ctx.phase, tz: timeZone() },
    base: { u: prev?.u ?? null, reps: prev?.reps ?? 0 }, post: next, local: true });
}

/** Count a new word introduced today. @param {any} store @param {string} id @param {string} today */
export function countNew(store, id, today) {
  updateProgress(store, id, p => {
    const by = { ...(p.newBy || {}) };
    by[today] = (by[today] || 0) + 1;
    // keep two weeks
    for (const d of Object.keys(by)) if (D8.diff(d, today) > 14) delete by[d];
    return { ...p, newBy: by };
  });
}

/**
 * Delete a script: a tombstone for the text, its progress and its section cards gone; its words stay reviewable
 * (scripts.words keeps lemma and meaning) unless dropWords, which removes the word cards only this script made.
 * @param {any} store @param {string} id @param {{dropWords?: boolean, at: string}} o
 */
export function purge(store, id, { dropWords = false, at }) {
  const s = all(store)[id];
  if (!s) return;
  const words = { ...(store.get(WORDS, {}) || {}) };
  const sc = store.cards(DECK);
  /** @type {[string, any][]} */ const drop = [];
  for (const m of s.marks || []) {
    if (!m.cardId) continue;
    const rec = sc[m.cardId];
    const only = rec && (rec.origin || []).every((/** @type {string} */ o) => o === `script:${id}`);
    if (dropWords && only) drop.push([m.cardId, null]);
    else if (m.gloss) words[m.cardId] = { lemma: m.lemma, head: m.head || m.lemma, gloss: m.gloss };
  }
  for (const sec of s.sections || []) if (sc[`SR:${id}.${sec.id}`]) drop.push([`SR:${id}.${sec.id}`, null]);
  if (drop.length) store.putCards(DECK, drop);
  store.set(WORDS, words);
  store.update(KV, (/** @type {any} */ m) => ({ ...(m || {}), [id]: { id, deletedAt: at, rev: Date.now() } }), {});
  store.update(PROGRESS, (/** @type {any} */ m) => { const n = { ...(m || {}) }; delete n[id]; return n; }, {});
}
