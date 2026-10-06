/* Typed production checks: "can he produce the German from the English?" Pure (no storage, no clock reads); tested in
   node (tests/unit/checks.test.mjs). The writer is data/checks.js; the views are Quick sort in Produce mode and its
   Recheck list (features/practice-clusters/sort.js), and "Check by typing" before "I know this" on a card that is
   only said aloud (features/shared/typecheck.js).

   Nothing here changes a card. A check is evidence next to the schedule, never a review: a right answer marks the
   word known through the one mark-known path (data/known.js), and a wrong one leaves every card as it was.

   kv 'known.checks' (profile; in the backup snapshot, merged per item and field by the later `at`):
     { [itemId]: { learn?: {on, at, mode, from},          he sorted it to Learn (Quick sort: Learn, or a wrong typed
                                                          answer); the Recheck list is built from these
                   prod?:  {on, at, ok, from, typo?} } }  the last typed production check and its result; typo: he
                                                          overrode a miss with "I knew it, typo"
   on: the study day; at: the time (ms); mode: 'recognise' | 'produce' (the Quick sort mode the Learn came from);
   from: 'sort' | 'recheck' | 'know' | 'spot'. No typed text is stored.

   Event card.checked (event@1, backed up with the other card events; it carries no card, so a merge or a replay of
   the cards passes it by: domain/cardmerge.js itemsOf):
     {deck, itemId, mode: 'recognise' | 'produce', ok, from, learn?: true, typo?: true, undo?: true, ctx: {exam, phase, tz}}
   learn: this check sent the item to Learn; undo: the check with these fields was taken back (Quick sort's Undo). */

export const KV = 'known.checks';
/** @typedef {'recognise' | 'produce'} Mode */
/** @typedef {'sort' | 'recheck' | 'know' | 'spot'} From */
/** @typedef {{on: string, at: number, mode: Mode, from: From}} Learn */
/** @typedef {{on: string, at: number, ok: boolean, from: From, typo?: boolean}} Prod */
/** @typedef {{learn?: Learn, prod?: Prod}} Entry */
/** @typedef {Record<string, Entry>} Checks */

export const MODES = /** @type {const} */ (['recognise', 'produce']);
/** @param {any} m @returns {m is Mode} */
export const isMode = m => m === 'recognise' || m === 'produce';

/** A copy of the collection with one entry replaced (undefined: removed). @param {Checks | null | undefined} kv @param {string} id @param {Entry | undefined} entry */
export function withEntry(kv, id, entry) {
  /** @type {Checks} */ const out = { ...(kv || {}) };
  if (entry && (entry.learn || entry.prod)) out[id] = entry; else delete out[id];
  return out;
}

/** He sorted an item to Learn. @param {Checks | null | undefined} kv @param {string} id @param {Learn} learn */
export const withLearn = (kv, id, learn) => withEntry(kv, id, { ...((kv || {})[id] || {}), learn: { on: learn.on, at: learn.at, mode: learn.mode, from: learn.from } });

/** A typed production check. @param {Checks | null | undefined} kv @param {string} id @param {Prod} prod */
export function withProd(kv, id, prod) {
  /** @type {Prod} */ const p = { on: prod.on, at: prod.at, ok: !!prod.ok, from: prod.from };
  if (prod.typo) p.typo = true;
  return withEntry(kv, id, { ...((kv || {})[id] || {}), prod: p });
}

/**
 * Whether a card's own answers show a typed production: an answer typed ('t') and right (Good or better, or Hard),
 * never a study step (flag v). Cards are meaning → German in the word decks, so a typed right answer is production.
 * @param {any} rec card-fsrs@1 or null
 */
export const typedOk = rec => !!(rec && Array.isArray(rec.hist) && rec.hist.some((/** @type {any[]} */ x) => Array.isArray(x) && x[3] === 't' && Number(x[1]) >= 2 && !String(x[4] || '').includes('v')));

/**
 * Whether an item has a successful typed production: a check that passed, or a typed right answer on one of its cards.
 * @param {Checks | null | undefined} kv @param {string} id @param {any[]} recs the item's cards
 */
export const produced = (kv, id, recs = []) => !!(kv && kv[id] && kv[id].prod && kv[id].prod.ok) || recs.some(typedOk);

/**
 * The mode Quick sort opens in: the one remembered on this device, else Produce while any word of the list has no
 * successful typed production yet, else Recognise.
 * @param {any} remembered @param {boolean[]} producedFlags one per word of the list
 * @returns {Mode}
 */
export function startMode(remembered, producedFlags) {
  if (isMode(remembered)) return remembered;
  return producedFlags.length && producedFlags.every(Boolean) ? 'recognise' : 'produce';
}

/**
 * The Recheck list: items he sorted to Learn, with no passing typed check since, that are not known or marked known
 * now. Latest first.
 * @param {Checks | null | undefined} kv @param {(itemId: string) => {state: string, marked?: any} | null | undefined} score
 * @returns {string[]} item ids
 */
export function recheckList(kv, score) {
  return Object.entries(kv || {})
    .filter(([id, e]) => {
      if (!e || !e.learn) return false;
      if (e.prod && e.prod.ok && Number(e.prod.at) >= Number(e.learn.at)) return false;
      const s = score(id);
      return !(s && (s.marked || s.state === 'known'));
    })
    .sort((a, b) => Number(b[1].learn?.at || 0) - Number(a[1].learn?.at || 0) || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}

/** The later of two field values by `at` (the second on a tie). @template {{at: number}} T @param {T | undefined} a @param {T | undefined} b */
const later = (a, b) => (!a ? b : !b ? a : Number(b.at) >= Number(a.at) ? b : a);

/**
 * Merge two copies of the collection (a restore or a merge of the backup, data/restore.js rule 'checks'): per item and
 * per field, the later record. Order-independent up to ties.
 * @param {Checks | null | undefined} a @param {Checks | null | undefined} b @returns {Checks}
 */
export function joinChecks(a, b) {
  /** @type {Checks} */ const out = { ...(a || {}) };
  for (const [id, y] of Object.entries(b || {})) {
    if (!y || typeof y !== 'object') continue;
    const x = out[id];
    if (!x) { out[id] = y; continue; }
    /** @type {Entry} */ const e = {};
    const learn = later(x.learn, y.learn), prod = later(x.prod, y.prod);
    if (learn) e.learn = learn;
    if (prod) e.prod = prod;
    out[id] = e;
  }
  return out;
}

/**
 * The card.checked payload.
 * @param {{deck: string, itemId: string, mode: Mode, ok: boolean, from: From, learn?: boolean, typo?: boolean, undo?: boolean}} x
 * @param {{exam: string | null, phase: string}} c @param {string} tz
 */
export function checkEvent(x, c, tz) {
  /** @type {Record<string, any>} */ const p = { deck: x.deck, itemId: x.itemId, mode: x.mode, ok: !!x.ok, from: x.from };
  if (x.learn) p.learn = true;
  if (x.typo) p.typo = true;
  if (x.undo) p.undo = true;
  p.ctx = { exam: c.exam, phase: c.phase, tz };
  return p;
}
