/* "I know this": one mechanism for marking an item as known. Pure (no storage, no clock reads); tested in node
   (tests/unit/known.test.mjs). The writes are data/known.js; every entry point goes through it: "I know this" (K) on a
   new card in any round, Quick sort (Practice › sort), select mode on the Explore map and list, "Mark all A1 as known"
   after a spot check, and Igloo's placement results (doors.know.v1, s: 'known').

   Known never deletes. Marking schedules the card as long-known:
     S = KNOWN_S (60 days), D = D0(Easy), learn null, stage 2, due about KNOWN_DAYS (60) days out, last = the day it was
     marked, and a `known` field: {by: 'self' | 'igloo', on: day, prev: the record before (null when there was none)}.
   That due date is the one verification check: the card comes up as a normal review in its own deck's rounds. The
   scheduler (fsrs.schedule) closes the mark on that first real answer ({…, checked: day, ok: g >= 2}, prev dropped):
   a pass grows S as any review does; a miss is a lapse like any other (relearn, a short S), so the card is back in
   normal reviews. Until then the mark can be undone: the record goes back to `prev` (deleted when prev is null).

   A mark is not a new item: nothing here or in the writers touches the day's new-item counts (b1.session day.newShown,
   the clusters', situations' or scripts' counters), so it never uses up the daily new-item budget. The composers
   leave marked items out of the new ones they introduce, in every deck (markedItems / skipsNew).

   A batch of n marks spreads its checks: at most about BATCH_PER_DAY a day, over ceil(n / BATCH_PER_DAY) days
   from day 60, by a stable hash of the card id, so marking 700 words never lands 700 reviews on one day.

   Card ids and record shapes do not change; `known` is an added field (schemas/records/card-fsrs.schema.json). */
import * as D8 from './days.js';

export const KNOWN_S = 60;
export const KNOWN_DAYS = 60;
export const BATCH_PER_DAY = 20;
/** D0(4) of FSRS-4.5 (W[4] - W[5]): the difficulty of an item first answered Easy. */
export const KNOWN_D = 3.932;

/** @typedef {'self' | 'igloo'} By */
/** @typedef {{by: By, on: string, prev?: any, checked?: string, ok?: boolean}} Mark */

/** A card marked known whose check has not come yet (the mark can still be undone). @param {any} rec */
export const isMarked = rec => !!(rec && rec.reps && rec.known && !rec.known.checked);

/** A graduated card that is already at least as stable as a mark would make it. @param {any} rec */
export const longKnown = rec => !!(rec && rec.reps && rec.learn == null && !rec.relearn && (rec.S || 0) >= KNOWN_S);

/** A small stable hash of a string (FNV-1a, 32 bit). @param {string} s */
export function hash(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x >>> 0;
}

/**
 * Days from the mark to its check: KNOWN_DAYS for one card; in a batch of n, spread over ceil(n / BATCH_PER_DAY) days
 * (at most KNOWN_DAYS) by the card id.
 * @param {string} id @param {number} [n]
 */
export function checkOffset(id, n = 1) {
  const span = Math.min(KNOWN_DAYS, Math.max(1, Math.ceil(n / BATCH_PER_DAY)));
  return KNOWN_DAYS + (span > 1 ? hash(String(id)) % span : 0);
}

/**
 * The record of a card marked known, or null when nothing changes (it is marked already, or already long-known), so
 * marking twice is the same as marking once.
 * @param {any} rec0 the card now (null or undefined: no card yet)
 * @param {{today: string, by?: By, now?: number, offset?: number}} o  offset: days to the check (checkOffset())
 * @returns {any | null}
 */
export function markRec(rec0, { today, by = 'self', now = 0, offset = KNOWN_DAYS }) {
  if (isMarked(rec0) || longKnown(rec0)) return null;
  const prev = rec0 || null;
  return {
    ...(rec0 || {}),
    S: KNOWN_S, D: KNOWN_D, due: D8.add(today, Math.max(1, offset)), reps: Math.max(1, (rec0 && rec0.reps) || 0), lapses: (rec0 && rec0.lapses) || 0,
    last: today, first: (rec0 && rec0.first) || today, stage: 2, streak: 0, learn: null, relearn: false,
    hist: (rec0 && rec0.hist) || [], u: now,
    known: /** @type {Mark} */ ({ by, on: today, prev: prev ? structuredClone(prev) : null }),
  };
}

/**
 * Undo a mark: the record it replaced ({rec: null} when the card did not exist), or null when there is nothing to
 * undo (not marked, or its check has been answered).
 * @param {any} rec @returns {{rec: any | null} | null}
 */
export function unmarkRec(rec) {
  if (!isMarked(rec) || !('prev' in rec.known)) return null;
  return { rec: rec.known.prev ? structuredClone(rec.known.prev) : null };
}

/**
 * The mark after the check's answer (fsrs.schedule calls this on the first answer that changes the card).
 * @param {Mark} mark @param {string} day @param {number} g
 * @returns {Mark}
 */
export const checked = (mark, day, g) => ({ by: mark.by, on: mark.on, checked: day, ok: g >= 2 });

/**
 * The item a card stands for, without content: a family card CF:<w> and an opposite card CO:<a>~<b> ask the word
 * W:<w> / W:<b>; every other card id is its own item. (domain/knowledge.js resolver() does the full mapping with
 * content; this is what the composers need.) @param {string} id
 */
export function itemOf(id) {
  const s = String(id || '');
  if (s.startsWith('CF:')) return `W:${s.slice(3)}`;
  if (s.startsWith('CO:')) { const b = s.slice(3).split('~')[1]; return b ? `W:${b}` : s; }
  return s;
}

/**
 * Items with a mark in any deck (marked and not yet checked).
 * @param {Record<string, Record<string, any>>} decks deck → card id → record
 * @returns {Set<string>}
 */
export function markedItems(decks) {
  const out = new Set();
  for (const cards of Object.values(decks || {})) for (const [id, rec] of Object.entries(cards || {})) if (isMarked(rec)) out.add(itemOf(id));
  return out;
}

/**
 * Whether a composer should leave a card out of the new items it introduces: its item is marked known in some deck.
 * A B1 phrase that is a chunk's twin (chunk) is also the item K:<chunk>.
 * @param {Set<string>} marked markedItems() @param {string} id @param {string | null} [chunk]
 */
export const skipsNew = (marked, id, chunk = null) => marked.has(itemOf(id)) || (!!chunk && marked.has(`K:${chunk}`));

/**
 * Event payload for card.marked_known / card.unmarked_known: what changed, enough to rebuild the cards elsewhere.
 * @param {string} deck @param {By} by @param {{itemId: string, base: any, post: any}[]} items
 * @param {{exam: string | null, phase: string}} c @param {string} tz
 */
export const markEvent = (deck, by, items, c, tz) => ({ deck, by, items: items.map(x => ({ itemId: x.itemId, base: x.base ? { u: x.base.u ?? null, reps: x.base.reps ?? 0 } : null, post: x.post })),
  ctx: { exam: c.exam, phase: c.phase, tz } });

/**
 * Igloo's placement results that should become marks: known results ('<lang>|<item id>' → {s: 'known'}) for items
 * that have no card anywhere yet. place(itemId) says where the item's card lives ({deck, id}) or null when there is
 * none to make (an item Practice does not ask).
 * @param {Record<string, any>} know doors.know.v1 @param {string} lang
 * @param {(itemId: string) => {deck: string, id: string} | null} place
 * @param {(deck: string, id: string) => boolean} has a card exists
 * @returns {{deck: string, id: string}[]}
 */
export function placementMarks(know, lang, place, has) {
  /** @type {{deck: string, id: string}[]} */ const out = [];
  const seen = new Set();
  for (const [key, k] of Object.entries(know || {})) {
    if (!k || k.s !== 'known') continue;
    const i = key.indexOf('|');
    if (i <= 0 || key.slice(0, i) !== lang) continue;
    const p = place(key.slice(i + 1));
    if (!p || seen.has(`${p.deck}/${p.id}`) || has(p.deck, p.id)) continue;
    seen.add(`${p.deck}/${p.id}`);
    out.push(p);
  }
  return out;
}
