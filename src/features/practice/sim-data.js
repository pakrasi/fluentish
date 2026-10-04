/* Speaking situations: loading and saving. The only sim module that touches the store or the content pack.

   Writes:
     cards 'speak'   one FSRS record per situation ('SS:<fn>-<nn>'), the shared scheduler (domain/fsrs.js)
     speak.sim       { start, round, day: {day, newShown, rounds}, stats: {day, unseen, total} }
     activity        minutes for Today's runway (no rounds: those count the B1 review rounds)
   and appends card.reviewed events (deck 'speak') to the outbox; the results sync does not send them. */
import * as S from './sim.js';
import { addActivity } from './data.js';

/** @type {Promise<{bank: any, items: S.Item[], byId: Map<string, S.Item>}> | null} */ let bankP = null;

/** The bank, loaded once a session. @param {{content: any}} ctx */
export function loadBank(ctx) {
  if (!bankP) bankP = ctx.content.load('speak.situations').then((/** @type {any} */ bank) => {
    const items = /** @type {S.Item[]} */ (bank.items || []);
    return { bank, items, byId: new Map(items.map(it => [it.id, it])) };
  }).catch((/** @type {any} */ e) => { bankP = null; throw e; });
  return bankP;
}

/** @param {any} store */
export const simState = store => store.get(S.KV, {}) || {};

/** Read-modify-write of kv 'speak.sim'. @param {any} store @param {(s: any) => any} fn */
export const updateSim = (store, fn) => store.update(S.KV, (/** @type {any} */ s) => fn(s || {}), {});

/** Cards of deck 'speak'. @param {any} store */
export const simCards = store => store.cards(S.DECK);

/**
 * Refresh the stats Today reads (unseen situations in open levels). Never throws.
 * @param {any} ctx a view ctx
 */
export async function refreshSimStats(ctx) {
  try {
    const { items } = await loadBank(ctx);
    const c = ctx.clock.ctx();
    const sim = simState(ctx.store);
    const st = S.stats(items, simCards(ctx.store), sim.start, c);
    if (JSON.stringify(sim.stats) !== JSON.stringify(st)) updateSim(ctx.store, s => ({ ...s, stats: st }));
  } catch { /* offline: Today plans from the last stats */ }
}

/** Choose the start level: every level up to it opens. @param {any} store @param {string} lv */
export const setStart = (store, lv) => updateSim(store, s => ({ ...s, start: lv }));

/**
 * Save one grade: the card, its event, the round and the day log.
 * @param {any} store @param {{id: string, before: any, rec: any, g: number, ms: number, c: any, tz: string, round: any, isNew: boolean}} o
 */
export function saveGrade(store, { id, before, rec, g, ms, c, tz, round, isNew }) {
  if (rec) {
    store.putCards(S.DECK, [[id, rec]]);
    store.append('card.reviewed', { deck: S.DECK, itemId: id, g, ms: Math.round(ms || 0), flags: '', mode: 's',
      ctx: { exam: c.exam, phase: c.phase, tz }, base: before ? { u: before.u ?? null, reps: before.reps ?? 0 } : null, post: rec });
  }
  updateSim(store, s => {
    const day = S.dayOf(s, c.today);
    return { ...s, round, day: { ...day, newShown: (day.newShown || 0) + (isNew ? 1 : 0) } };
  });
}

/** Keep the round (start, resume, end). @param {any} store @param {any} round */
export const saveRound = (store, round) => updateSim(store, s => ({ ...s, round }));

/**
 * A finished round: clear it, count it for today and add its minutes to the day's activity.
 * @param {any} store @param {string} today @param {number} minutes
 */
export function finishRound(store, today, minutes) {
  updateSim(store, s => { const day = S.dayOf(s, today); return { ...s, round: null, day: { ...day, rounds: (day.rounds || 0) + 1 } }; });
  if (minutes > 0) addActivity(store, today, { minutes });
}
