/* Marking items as known: the one writer (the rules are domain/known.js). Every entry point calls these: "I know
   this" in a round, Quick sort, select mode on the Explore map and list, "Mark all A1 as known", and the import of
   Igloo's placement results.

   A mark writes the card in its deck (store.putCards, one transaction per deck) and appends one event per deck:
     card.marked_known    {deck, by, items: [{itemId, base: {u, reps} | null, post}], ctx: {exam, phase, tz}}
     card.unmarked_known  the same shape; post is the record put back (null: the card was deleted)
   Nothing here touches a day's new-item counts, so marks never use up the new-item budget.
     kv 'known'   { placement: the day Igloo's placement results were imported (once a profile) } */
import { markRec, unmarkRec, isMarked, itemOf, markedItems, checkOffset, markEvent, placementMarks } from '../domain/known.js';

/** Decks whose cards are items (the same list as data/knowledge.js). */
export const DECKS = ['b1', 'speak', 'script', 'clusters'];
export const KV = 'known';

/** @typedef {{deck: string, id: string}} Entry */
/** @typedef {{store: any, clock: {ctx: () => any}}} Ctx */

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** @param {Entry[]} entries @returns {Map<string, string[]>} */
function byDeck(entries) {
  /** @type {Map<string, string[]>} */ const m = new Map();
  for (const e of entries) { const l = m.get(e.deck) || []; if (!l.includes(e.id)) l.push(e.id); m.set(e.deck, l); }
  return m;
}

/**
 * Mark cards known. Cards already marked or already long-known are left as they are (marking is idempotent).
 * @param {Ctx} ctx @param {Entry[]} entries
 * @param {{by?: import('../domain/known.js').By, spread?: boolean}} [o]  spread: a batch spreads its checks (off for one card)
 * @returns {{n: number, entries: Entry[], undo: () => number}}
 */
export function markCards(ctx, entries, { by = 'self', spread = true } = {}) {
  const { store } = ctx, c = ctx.clock.ctx(), now = Date.now(), zone = tz();
  const total = entries.length;
  /** @type {Entry[]} */ const done = [];
  for (const [deck, ids] of byDeck(entries)) {
    const cards = store.cards(deck) || {};
    /** @type {[string, any][]} */ const puts = [];
    /** @type {{itemId: string, base: any, post: any}[]} */ const items = [];
    for (const id of ids) {
      const rec0 = cards[id] || null;
      const rec = markRec(rec0, { today: c.today, by, now, offset: checkOffset(id, spread ? total : 1) });
      if (!rec) continue;
      puts.push([id, rec]); items.push({ itemId: id, base: rec0, post: rec }); done.push({ deck, id });
    }
    if (!puts.length) continue;
    store.putCards(deck, puts);
    store.append('card.marked_known', markEvent(deck, by, items, c, zone));
  }
  return { n: done.length, entries: done, undo: () => unmarkCards(ctx, done) };
}

/**
 * Undo marks: each card goes back to the record it had before (deleted when it had none). Cards whose check has been
 * answered are left alone. Returns how many were undone.
 * @param {Ctx} ctx @param {Entry[]} entries
 */
export function unmarkCards(ctx, entries) {
  const { store } = ctx, c = ctx.clock.ctx(), zone = tz();
  let n = 0;
  for (const [deck, ids] of byDeck(entries)) {
    const cards = store.cards(deck) || {};
    /** @type {[string, any][]} */ const puts = [];
    /** @type {{itemId: string, base: any, post: any}[]} */ const items = [];
    /** @type {any} */ let by = 'self';
    for (const id of ids) {
      const back = unmarkRec(cards[id]);
      if (!back) continue;
      by = cards[id].known.by;
      puts.push([id, back.rec]); items.push({ itemId: id, base: cards[id], post: back.rec });
    }
    if (!puts.length) continue;
    store.putCards(deck, puts);
    store.append('card.unmarked_known', markEvent(deck, by, items, c, zone));
    n += puts.length;
  }
  return n;
}

/** The decks of the one schedule. @param {any} store */
const decksOf = store => Object.fromEntries(DECKS.map(d => [d, store.cards(d) || {}]));

/** Items marked known (and not checked yet) in any deck. @param {any} store */
export const marked = store => markedItems(decksOf(store));

/**
 * Where a word's mark goes: the card he already has for it (deck clusters W:<id>, deck b1 W:<id>, a family card
 * CF:<id>), else a new deck-clusters card W:<id> (meaning → word, the cluster rounds ask it at the check).
 * @param {any} store @param {string} wordId a word id ('gut.adj'), without W:
 * @returns {Entry}
 */
export function wordEntry(store, wordId) {
  const cl = store.cards('clusters') || {}, b1 = store.cards('b1') || {};
  const w = `W:${wordId}`;
  if (cl[w]?.reps) return { deck: 'clusters', id: w };
  if (b1[w]?.reps) return { deck: 'b1', id: w };
  if (cl[`CF:${wordId}`]?.reps) return { deck: 'clusters', id: `CF:${wordId}` };
  return { deck: 'clusters', id: w };
}

/**
 * Mark words known (Quick sort, select mode, a level). @param {Ctx} ctx @param {string[]} wordIds ids without W:
 * @param {{spread?: boolean}} [o]
 */
export const markWords = (ctx, wordIds, o = {}) => markCards(ctx, wordIds.map(w => wordEntry(ctx.store, w)), o);

/**
 * Undo every mark (not checked yet) on these items, in any deck. @param {Ctx} ctx @param {string[]} itemIds 'W:gut.adj', …
 */
export function unmarkItems(ctx, itemIds) {
  const want = new Set(itemIds);
  /** @type {Entry[]} */ const out = [];
  for (const [deck, cards] of Object.entries(decksOf(ctx.store))) for (const [id, rec] of Object.entries(cards)) if (isMarked(rec) && want.has(itemOf(id))) out.push({ deck, id });
  return unmarkCards(ctx, out);
}

/**
 * Igloo's placement results (doors.know.v1, read-only) go through the same path, once a profile: every item it says
 * he knows that has no card anywhere yet is marked known by 'igloo' (its check about 60 days out, spread).
 * place(itemId) → where its card lives, or null. Returns how many were marked.
 * @param {Ctx} ctx @param {Record<string, any>} know @param {(itemId: string) => Entry | null} place
 */
export function importPlacement(ctx, know, place) {
  const { store } = ctx;
  const st = store.get(KV, {}) || {};
  if (st.placement) return 0;
  const decks = decksOf(store);
  const items = new Set(Object.values(decks).flatMap(cards => Object.entries(cards).filter(([, r]) => r && r.reps).map(([id]) => itemOf(id))));
  const list = placementMarks(know, 'german', place, (deck, id) => !!decks[deck]?.[id]?.reps || items.has(itemOf(id)));
  const res = list.length ? markCards(ctx, list, { by: 'igloo' }) : { n: 0 };
  store.set(KV, { ...st, placement: ctx.clock.ctx().today, placed: res.n });
  return res.n;
}
