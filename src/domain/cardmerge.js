/* Merging card state from several devices (review B4; ARCHITECTURE §3.2). Pure; tested in node.

   Inputs: card sets (this device's cards and each device's snapshot) and learning events (card.reviewed,
   card.marked_known, card.unmarked_known: each item carries the card before, `base`, and after, `post`).

   1. Join the card sets: per card, the newest record wins. "Newest" is one total order, so the join is the same
      whatever order the sets come in: the larger `u` (last write time), then the larger `reps`, then the larger
      canonical JSON text (an arbitrary but fixed tie-break).
   2. Replay the events in one total order: event time, then device id, then seq, then event id. For each item:
        the card now matches `base` (same `u` and `reps`, or both absent)  → take `post` (null deletes: an undone
                                                                             mark of a card that had no record)
        otherwise                                                          → the newest review wins: take `post`
                                                                             only when it is newer than the card now
   Replaying an event twice changes nothing (its post is then the card, or older than it), so a merge run again on
   its own result is a no-op, and two devices that read the same backups end with the same cards. */

/** Canonical JSON: keys sorted, undefined left out. @param {any} v @returns {string} */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** @param {any} r */
const uOf = r => (r && Number.isFinite(Number(r.u)) ? Number(r.u) : -1);

/**
 * The total order of card records: > 0 when a is newer than b. A missing record is older than any record.
 * @param {any} a @param {any} b @returns {number}
 */
export function compare(a, b) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1;
  return uOf(a) - uOf(b) || (Number(a.reps) || 0) - (Number(b.reps) || 0) || (canon(a) < canon(b) ? -1 : canon(a) > canon(b) ? 1 : 0);
}

/**
 * Whether a card is the one an event started from.
 * @param {any} cur @param {any} base {u, reps} or a full record; null or {u: null, reps: 0}: no card
 */
export function matchesBase(cur, base) {
  const none = (/** @type {any} */ r) => r == null || (r.u == null && !r.reps);
  if (none(base)) return none(cur);
  return cur != null && (cur.u ?? null) === (base.u ?? null) && (Number(cur.reps) || 0) === (Number(base.reps) || 0);
}

/** @typedef {Record<string, Record<string, any>>} Decks  deck → item id → record */

/**
 * Join card sets: per card, the newest record. Order-independent.
 * @param {Decks[]} sets @param {(deck: string) => boolean} [keep] decks to take
 * @returns {Decks}
 */
export function joinCards(sets, keep = () => true) {
  /** @type {Decks} */ const out = {};
  for (const set of sets) {
    for (const [deck, recs] of Object.entries(set || {})) {
      if (!keep(deck) || !recs || typeof recs !== 'object') continue;
      const d = out[deck] || (out[deck] = {});
      for (const [id, rec] of Object.entries(recs)) {
        if (!rec || typeof rec !== 'object') continue;
        if (compare(rec, d[id]) > 0) d[id] = rec;
      }
    }
  }
  return out;
}

/** The card changes one event carries: [{deck, itemId, base, post}]. @param {any} e */
export function itemsOf(e) {
  const p = e && e.payload;
  if (!p || typeof p !== 'object' || typeof p.deck !== 'string') return [];
  if (e.type === 'card.reviewed') return typeof p.itemId === 'string' && 'post' in p ? [{ deck: p.deck, itemId: p.itemId, base: p.base ?? null, post: p.post ?? null }] : [];
  if (e.type === 'card.marked_known' || e.type === 'card.unmarked_known') {
    return (Array.isArray(p.items) ? p.items : []).filter((/** @type {any} */ x) => x && typeof x.itemId === 'string' && 'post' in x)
      .map((/** @type {any} */ x) => ({ deck: p.deck, itemId: x.itemId, base: x.base ?? null, post: x.post ?? null }));
  }
  return [];
}

/** The replay order: time, device, seq, id. @param {any} a @param {any} b */
export function eventOrder(a, b) {
  const ta = Date.parse(a.at) || 0, tb = Date.parse(b.at) || 0;
  if (ta !== tb) return ta - tb;
  const da = String(a.deviceId || ''), db = String(b.deviceId || '');
  if (da !== db) return da < db ? -1 : 1;
  return (Number(a.seq) || 0) - (Number(b.seq) || 0) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
}

/**
 * Replay events over a card state (changed in place and returned). Events are deduplicated by id.
 * @param {Decks} state @param {any[]} events @param {(deck: string) => boolean} [keep]
 * @returns {Decks}
 */
export function replay(state, events, keep = () => true) {
  /** @type {Map<string, any>} */ const byId = new Map();
  for (const e of events) if (e && typeof e.id === 'string' && !byId.has(e.id)) byId.set(e.id, e);
  for (const e of [...byId.values()].sort(eventOrder)) {
    for (const { deck, itemId, base, post } of itemsOf(e)) {
      if (!keep(deck)) continue;
      const d = state[deck] || (state[deck] = {});
      const cur = d[itemId] ?? null;
      if (matchesBase(cur, base)) { if (post == null) delete d[itemId]; else d[itemId] = post; }
      else if (post != null && compare(post, cur) > 0) d[itemId] = post;
    }
  }
  return state;
}

/**
 * The merged cards and what changes against this device's cards.
 * @param {{local: Decks, snapshots: Decks[], events: any[], keep?: (deck: string) => boolean}} o
 * @returns {{cards: Decks, changes: Record<string, [string, any][]>, counts: {added: number, updated: number, removed: number, unchanged: number}}}
 */
export function mergeCards({ local, snapshots, events, keep = () => true }) {
  const cards = replay(joinCards([local, ...snapshots], keep), events, keep);
  /** @type {Record<string, [string, any][]>} */ const changes = {};
  const counts = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const decks = new Set([...Object.keys(local || {}), ...Object.keys(cards)].filter(keep));
  for (const deck of [...decks].sort()) {
    const was = (local || {})[deck] || {}, now = cards[deck] || {};
    for (const id of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
      const a = was[id], b = now[id];
      if (a == null && b == null) continue;
      if (a == null) counts.added++;
      else if (b == null) counts.removed++;
      else if (canon(a) === canon(b)) { counts.unchanged++; continue; }
      else counts.updated++;
      (changes[deck] || (changes[deck] = [])).push([id, b ?? null]);
    }
  }
  return { cards, changes, counts };
}
