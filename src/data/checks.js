/* Typed production checks: the one writer (the rules are domain/checks.js). Quick sort (both modes), its Recheck list,
   "Check by typing" before "I know this" and the level spot check call these.

   A check never writes a card. It updates kv 'known.checks' and appends one card.checked event (backed up like the
   other card events, data/sync/backup.js BACKUP_TYPES). Marking a word known after a right answer is data/known.js's
   job, called by the view. Undo puts the item's entry back as it was and appends the same event with undo: true. */
import { KV, withLearn, withProd, withEntry, checkEvent } from '../domain/checks.js';
import { wordEntry } from './known.js';

/** @typedef {import('../domain/checks.js').Mode} Mode @typedef {import('../domain/checks.js').From} From */
/** @typedef {{store: any, clock: {ctx: () => any}}} Ctx */
/** @typedef {{itemId: string, prev: any, ev: Record<string, any>}} Token  what undo needs: the entry before, the event */

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** The checks collection. @param {any} store @returns {import('../domain/checks.js').Checks} */
export const checksOf = store => store.get(KV, {}) || {};

/**
 * Record one check of an item.
 *   learn: he sorted it to Learn (Recognise: Learn; Produce: a wrong answer), which puts it on the Recheck list
 *   typed: a typed production check with its result (ok, typo: "I knew it, typo")
 * @param {Ctx} ctx
 * @param {{itemId: string, deck?: string, mode: Mode, ok: boolean, from: From, learn?: boolean, typed?: boolean, typo?: boolean}} x
 * @returns {Token}
 */
export function recordCheck(ctx, x) {
  const { store } = ctx, c = ctx.clock.ctx(), at = Date.now();
  const kv0 = checksOf(store);
  const prev = kv0[x.itemId] ? structuredClone(kv0[x.itemId]) : undefined;
  let kv = kv0;
  if (x.learn) kv = withLearn(kv, x.itemId, { on: c.today, at, mode: x.mode, from: x.from });
  if (x.typed) kv = withProd(kv, x.itemId, { on: c.today, at, ok: x.ok, from: x.from, typo: x.typo });
  store.set(KV, kv);
  const deck = x.deck || (x.itemId.startsWith('W:') ? wordEntry(store, x.itemId.slice(2)).deck : 'b1');
  const ev = checkEvent({ deck, itemId: x.itemId, mode: x.mode, ok: x.ok, from: x.from, learn: x.learn, typo: x.typo }, c, tz());
  store.append('card.checked', ev);
  return { itemId: x.itemId, prev, ev };
}

/**
 * Take checks back (newest first): each item's entry goes back to what it was before the first of them, and each check
 * gets its undo event.
 * @param {Ctx} ctx @param {Token[]} tokens in the order they were made
 */
export function undoChecks(ctx, tokens) {
  const { store } = ctx, c = ctx.clock.ctx();
  let kv = checksOf(store);
  for (const tk of [...tokens].reverse()) {
    kv = withEntry(kv, tk.itemId, tk.prev);
    const e = tk.ev;
    store.append('card.checked', checkEvent({ deck: e.deck, itemId: e.itemId, mode: e.mode, ok: e.ok, from: e.from, learn: e.learn, typo: e.typo, undo: true }, c, tz()));
  }
  store.set(KV, kv);
}
