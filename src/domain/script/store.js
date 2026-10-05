/* Script mode: reading the stored scripts (the writers are data/scripts.js, which re-exports these). Pure over the
   store object it is given, so the day's allowance (domain/allowance.js) and Today's script rows can count scripts
   without a feature import.
     kv 'scripts', kv 'scripts.progress', kv 'scripts.words', cards deck 'script': see data/scripts.js */
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

/** @param {any} store @param {string} id @returns {any} */
export const progress = (store, id) => (store.get(PROGRESS, {}) || {})[id] || { sections: {}, runs: [], newBy: {} };

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
