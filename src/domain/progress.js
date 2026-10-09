/* The progress log: one record per study day of what he knew that day, kept for years so later charts can draw it
   exactly. Pure (no storage, no clock reads); tested in node (tests/unit/progress.test.mjs). The writer is
   data/progress.js; the format is in docs/SCHEMA.md › Progress log.

   kv 'progress.<course>.<YYYY-MM>' (profile scope, one key per month): { [day]: DayRecord }
     v        1
     at       when it was computed (ISO time)
     dev      the device that computed it
     src      'live' (from the cards as they were that day) | 'replay' (rebuilt from backups and events) |
              'estimate' (rebuilt from the cards' answer history)
     estimated  true when any card had to be estimated (src 'estimate'); absent otherwise
     fin      true when it was computed after the day had ended (nothing could change it any more)
     atlas    the version of the pool the counts are against (the map's file hash for German)
     known    { w, p, g }   items in knowledge state 'known' (domain/knowledge.js: the definition of Where you stand
                            and the map), words / phrases / grammar, by CEFR level: [A1, A2, B1, B2, C1, C2, none],
                            trailing zeros left out
     shaky    { w, p, g }   state 'shaky'
     seen     { w, p, g }   any state but 'unseen'
     of       { w, p, g }   the pool on that day (the denominators: the map grows with releases)
     day      { new, learnt, missed, reviews, again }   cards first answered that day, of them graduated by its end,
                            misses on cards learnt before, cards reviewed (not new), cards with a miss
     min      { total, rounds, dev: { [deviceId]: {m, by?} }, by? }   minutes of this course that day, per device and
                            by kind (kinds only when that day's study was all this course's)
     jump     { from: 'igloo', known }   on the day Igloo's placement results came in: the known items they added
   Only month logs match the key pattern (MONTH_KEY, exact), so a later collection under progress.* never inherits
   the per-day merge rule. Map frames (a picture per item) are not recorded: the daily snapshots in the backup are
   exact from the day they began, so frames can be computed from them later.

   Merging two devices' records of a day (mergeDay): the counts come from the most complete record (an exact record
   over an estimate, then the one that saw more of that day's study, then more items seen, then a final one, then the
   later); the minutes unite the devices (each device's larger entry), so two devices on one day add up. */
import * as D8 from './days.js';
import * as FS from './fsrs.js';
import { KNOWN_S, KNOWN_D } from './known.js';
import { replay, joinCards, itemsOf, eventOrder, canon, compare } from './cardmerge.js';
import { MONTH_KEY } from './progress-key.js';

export const V = 1;
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** Index of an item without a level. */
export const NO_LEVEL = 6;
export const KINDS = /** @type {const} */ (['w', 'p', 'g']);
const STATES = new Set(['unknown', 'shaky', 'known']);

/** @typedef {'w' | 'p' | 'g'} Kind */
/** @typedef {{id: string, kind: Kind, level: string}} PoolItem */
/** @typedef {{w: number[], p: number[], g: number[]}} Counts */
/** @typedef {{new: number, learnt: number, missed: number, reviews: number, again: number}} DayStats */
/** @typedef {{m: number, by?: Record<string, number>}} DevMin */
/** @typedef {{total: number, rounds: number, dev: Record<string, DevMin>, by?: Record<string, number>}} Minutes */
/**
 * @typedef {object} DayRecord
 * @property {number} v @property {string} at @property {string} dev @property {'live' | 'replay' | 'estimate'} src
 * @property {true} [estimated] @property {true} [fin] @property {string | null} atlas
 * @property {Counts} known @property {Counts} shaky @property {Counts} seen @property {Counts} of
 * @property {DayStats} day @property {Minutes} min @property {{from: string, known: number}} [jump]
 */

/** @param {any} x */
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const tenth = (/** @type {number} */ x) => Math.round(x * 10) / 10;

/** The level slot of an item. @param {string | null | undefined} L */
export const levelIndex = L => { const i = LEVELS.indexOf(String(L || '')); return i < 0 ? NO_LEVEL : i; };

/** @returns {Counts} */
const zero = () => ({ w: [0, 0, 0, 0, 0, 0, 0], p: [0, 0, 0, 0, 0, 0, 0], g: [0, 0, 0, 0, 0, 0, 0] });
/** An array without its trailing zeros (the stored form). @param {number[]} a */
const trim = a => { let n = a.length; while (n && !a[n - 1]) n--; return a.slice(0, n); };
/** @param {Counts} c @returns {Counts} */
const trimmed = c => ({ w: trim(c.w), p: trim(c.p), g: trim(c.g) });
/** The sum of a count. @param {Counts | undefined} c */
export const total = c => (c ? [...(c.w || []), ...(c.p || []), ...(c.g || [])].reduce((t, x) => t + num(x), 0) : 0);
/** A count of one kind at one level ('w', 'B1'); reads the stored form. @param {Counts | undefined} c @param {Kind} k @param {string} L */
export const at = (c, k, L) => num(c?.[k]?.[levelIndex(L)]);

/**
 * Count the pool by state, kind and level.
 * @param {PoolItem[]} pool @param {(item: PoolItem) => string} stateOf the item's knowledge state
 * @returns {{known: Counts, shaky: Counts, seen: Counts, of: Counts}}
 */
export function countPool(pool, stateOf) {
  const known = zero(), shaky = zero(), seen = zero(), of = zero();
  for (const it of pool) {
    const k = it.kind, L = levelIndex(it.level), s = stateOf(it);
    of[k][L]++;
    if (!STATES.has(s)) continue;
    seen[k][L]++;
    if (s === 'known') known[k][L]++;
    else if (s === 'shaky') shaky[k][L]++;
  }
  return { known: trimmed(known), shaky: trimmed(shaky), seen: trimmed(seen), of: trimmed(of) };
}

/**
 * What happened to the cards on one day, from their answer history (cards in the state of that day's end).
 * @param {Record<string, Record<string, any>>} decks @param {string} day @returns {DayStats}
 */
export function dayStats(decks, day) {
  const out = { new: 0, learnt: 0, missed: 0, reviews: 0, again: 0 };
  for (const cards of Object.values(decks)) {
    for (const [id, r] of Object.entries(cards || {})) {
      if (!r || !r.reps || /^SR:/.test(id)) continue;
      const h = (r.hist || []).filter((/** @type {any[]} */ x) => x[0] === day);
      if (!h.length) continue;
      const miss = h.some((/** @type {any[]} */ x) => x[1] === 1 && !String(x[4] || '').includes('v'));
      if (r.first === day) { out.new++; if (r.learn == null) out.learnt++; } else { out.reviews++; if (miss) out.missed++; }
      if (miss) out.again++;
    }
  }
  return out;
}

/**
 * A day's minutes for a course, from data/activity minutesFor ({total, rounds, dev: {id: minutes}, by}) and the
 * devices' kinds. @param {{total: number, rounds: number, dev: Record<string, number>, by?: Record<string, number>}} m
 * @param {Record<string, {by?: Record<string, number>}>} [kinds] each device's kinds that day (activity dev[id].by)
 * @returns {Minutes}
 */
export function minutesRecord(m, kinds = {}) {
  /** @type {Record<string, DevMin>} */ const dev = {};
  const only = !!m.by;
  for (const [id, x] of Object.entries(m.dev || {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    /** @type {DevMin} */ const d = { m: tenth(num(x)) };
    const by = kinds[id]?.by;
    if (only && by && Object.keys(by).length) d.by = { ...by };
    dev[id] = d;
  }
  return withTotals({ total: 0, rounds: num(m.rounds), dev });
}

/** The totals of a minutes record from its devices. @param {Minutes} m @returns {Minutes} */
function withTotals(m) {
  let t = 0;
  /** @type {Record<string, number> | undefined} */ let by;
  for (const d of Object.values(m.dev)) {
    t += num(d.m);
    if (d.by) { by = by || {}; for (const [k, v] of Object.entries(d.by)) by[k] = tenth((by[k] || 0) + num(v)); }
  }
  /** @type {Minutes} */ const out = { total: tenth(t), rounds: num(m.rounds), dev: m.dev };
  if (by) out.by = by;
  return out;
}

/**
 * One day's record.
 * @param {object} o
 * @param {string} o.day @param {string} o.at @param {string} o.dev
 * @param {'live' | 'replay' | 'estimate'} o.src @param {boolean} [o.fin] @param {number} [o.estimatedCards] cards estimated
 * @param {string | null} o.atlas
 * @param {PoolItem[]} o.pool @param {(item: PoolItem) => string} o.stateOf
 * @param {Record<string, Record<string, any>>} o.decks  the course's cards as they were at the end of that day
 * @param {Minutes} o.min
 * @param {{from: string, known: number} | null} [o.jump]
 * @returns {DayRecord}
 */
export function dayRecord(o) {
  const c = countPool(o.pool, o.stateOf);
  const est = o.src === 'estimate' || num(o.estimatedCards) > 0;
  /** @type {DayRecord} */ const record = {
    v: V, at: o.at, dev: o.dev, src: est ? 'estimate' : o.src, atlas: o.atlas,
    known: c.known, shaky: c.shaky, seen: c.seen, of: c.of, day: dayStats(o.decks, o.day), min: o.min,
  };
  if (est) record.estimated = true;
  if (o.fin) record.fin = true;
  if (o.jump && o.jump.known) record.jump = o.jump;
  return record;
}

/** Whether two records hold the same picture (all but when and where they were computed). @param {any} a @param {any} b */
export function sameDay(a, b) {
  if (!a || !b) return a === b;
  const { at: _a, dev: _d, ...x } = a, { at: _b, dev: _e, ...y } = b;
  return canon(x) === canon(y);
}

/** How complete a record's counts are: larger is better. @param {any} r @returns {number[]} */
const rank = r => [r.estimated ? 0 : 1, num(r.day?.new) + num(r.day?.reviews), total(r.seen), r.fin ? 1 : 0, Date.parse(r.at) || 0];

/** > 0 when record a's counts are more complete than b's. @param {any} a @param {any} b */
export function moreComplete(a, b) {
  const x = rank(a), y = rank(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  const ca = canon(a), cb = canon(b);
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

/** Two minutes records united: each device's larger entry; totals summed. @param {any} a @param {any} b @returns {Minutes} */
export function mergeMinutes(a, b) {
  if (!a) return b;
  if (!b) return a;
  /** @type {Record<string, DevMin>} */ const dev = {};
  for (const id of [...new Set([...Object.keys(a.dev || {}), ...Object.keys(b.dev || {})])].sort()) {
    const x = a.dev?.[id], y = b.dev?.[id];
    dev[id] = !x ? y : !y ? x : num(y.m) > num(x.m) || (num(y.m) === num(x.m) && canon(y) > canon(x)) ? y : x;
  }
  return withTotals({ total: 0, rounds: Math.max(num(a.rounds), num(b.rounds)), dev });
}

/**
 * Two devices' records of one day merged (commutative, idempotent): the counts of the more complete one, the minutes
 * of both devices. @param {any} a @param {any} b @returns {any}
 */
export function mergeDay(a, b) {
  if (!a) return b;
  if (!b) return a;
  const best = moreComplete(a, b) >= 0 ? a : b;
  const min = mergeMinutes(a.min, b.min);
  return canon(min) === canon(best.min) ? best : { ...best, min };
}

/** Two month records merged day by day. @param {any} a @param {any} b @returns {Record<string, any>} */
export function mergeMonth(a, b) {
  /** @type {Record<string, any>} */ const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [day, y] of Object.entries(b && typeof b === 'object' ? b : {})) {
    if (!D8.isDay(day) || !y || typeof y !== 'object') continue;
    out[day] = out[day] ? mergeDay(out[day], y) : y;
  }
  return sortKeys(out);
}

/** @param {Record<string, any>} o */
const sortKeys = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

/* ---------- keys ---------- */

export { MONTH_KEY };
/** @param {string} course @param {string} day */
export const monthKey = (course, day) => `progress.${course}.${day.slice(0, 7)}`;
/** Whether a kv name is a month of the log. @param {string} name */
export const isMonthKey = name => MONTH_KEY.test(name);
/** The course of a month key. @param {string} name */
export const keyCourse = name => (MONTH_KEY.exec(name) || [])[1] || null;

/* ---------- the cards as they were on a past day ---------- */

/**
 * A card as it was at the end of `day`, estimated from its answer history (`hist`, the last 12 answers): the answers up
 * to that day are replayed through the scheduler. Exact when the history is complete and has no log-only answers;
 * null when the card did not exist yet. A card marked known counts from the day of the mark; Igloo's marks only from
 * `jumpDay` (they arrive as one labelled jump).
 * @param {any} rec @param {string} day @param {string | null} [jumpDay]
 * @returns {any}
 */
export function estimateCard(rec, day, jumpDay = null) {
  if (!rec || !rec.reps) return null;
  const all = /** @type {any[][]} */ (rec.hist || []);
  if ((!rec.last || rec.last <= day) && all.every(h => h[0] <= day) && !(rec.known && rec.known.on > day)) {
    if (rec.known && rec.known.by === 'igloo' && jumpDay && day < jumpDay && !all.length) return null;
    if (!all.length && rec.first && rec.first > day) return null;
    return rec;   // unchanged since that day
  }
  const hist = all.filter(h => h[0] <= day);
  if (!hist.length) {
    const k = rec.known;
    if (k && k.on && k.on <= day && !(k.by === 'igloo' && jumpDay && day < jumpDay)) {
      return { S: KNOWN_S, D: KNOWN_D, due: D8.add(k.on, KNOWN_S), reps: 1, lapses: 0, last: k.on, first: rec.first || k.on, stage: 2, streak: 0, learn: null, relearn: false, u: 0, hist: [], known: { by: k.by, on: k.on } };
    }
    return null;
  }
  /** @type {any} */ let cur = null;
  for (const h of hist) {
    const flags = String(h[4] || '');
    const res = FS.schedule(cur, /** @type {any} */ ({ g: h[1], ms: h[2], mode: h[3], flags: flags.replace(/[lv]/g, ''), study: flags.includes('v') }), { today: h[0], exam: null, phase: 'none' }, 0);
    if (res.rec) cur = res.rec;
  }
  if (!cur) return null;
  cur.hist = hist;
  if (rec.src) cur.src = rec.src;
  return cur;
}

/**
 * The cards of a course as they were at the end of a past day, and how many of them had to be estimated.
 *   1. anchors: each backup snapshot of that day or before, and every card here that has not changed since that day
 *      (no event, answer or mark after it);
 *   2. the learning events of that day and before are replayed on them (domain/cardmerge.js, the merge's own order);
 *   3. a card here that changed after that day and is in neither (no snapshot or event holds its state then) is
 *      estimated from its history (estimateCard); a card whose first event after that day made it (base none) did not
 *      exist yet.
 * @param {object} o
 * @param {Record<string, Record<string, any>>} o.decks   the course's cards now
 * @param {any[]} o.events     learning events (card.reviewed, card.marked_known, card.unmarked_known), any order
 * @param {{day: string, cards: Record<string, Record<string, any>>}[]} [o.snapshots]   backup snapshots
 * @param {string} o.day
 * @param {(deck: string) => boolean} [o.keep]   the course's decks
 * @param {string | null} [o.jumpDay]
 * @returns {{decks: Record<string, Record<string, any>>, estimated: number}}
 */
export function cardsAt({ decks, events, snapshots = [], day, keep = () => true, jumpDay = null }) {
  /** @type {Map<string, any>} first change after the day, per card */ const after = new Map();
  /** @type {any[]} */ const upTo = [];
  for (const e of [...events].sort(eventOrder)) {
    if (!e || typeof e.day !== 'string') continue;
    if (e.day <= day) { upTo.push(e); continue; }
    for (const x of itemsOf(e)) {
      if (!keep(x.deck)) continue;
      const k = `${x.deck}\n${x.itemId}`;
      if (!after.has(k)) after.set(k, x);
    }
  }
  /** @type {Record<string, Record<string, any>>} */ const still = {};
  for (const [deck, cards] of Object.entries(decks)) {
    if (!keep(deck)) continue;
    for (const [id, rec] of Object.entries(cards || {})) {
      if (!rec || after.has(`${deck}\n${id}`)) continue;
      const changed = (rec.last && rec.last > day) || (rec.known && rec.known.on > day) || (rec.hist || []).some((/** @type {any[]} */ h) => h[0] > day);
      if (!changed) (still[deck] || (still[deck] = {}))[id] = rec;
    }
  }
  const anchors = snapshots.filter(s => s && s.day <= day).map(s => s.cards || {});
  const state = replay(joinCards([...anchors, still], keep), upTo, keep);
  let estimated = 0;
  /** @param {string} deck @param {string} id @param {any} rec */
  const fill = (deck, id, rec) => {
    const d = state[deck] || (state[deck] = {});
    if (d[id] !== undefined) return;
    const est = estimateCard(rec, day, jumpDay);
    if (est) { d[id] = est; estimated++; }
  };
  for (const [deck, cards] of Object.entries(decks)) {
    if (!keep(deck)) continue;
    for (const [id, rec] of Object.entries(cards || {})) {
      if (state[deck]?.[id] !== undefined) continue;
      const first = after.get(`${deck}\n${id}`);
      if (first && (first.base == null || (first.base.u == null && !first.base.reps))) continue;   // made after the day
      if (!first && !still[deck]?.[id] && rec && !(rec.hist || []).some((/** @type {any[]} */ h) => h[0] <= day) && !(rec.known && rec.known.on <= day) && !(rec.first && rec.first <= day)) continue;
      fill(deck, id, rec);
    }
  }
  // cards gone now that existed then (an undone mark) are in the snapshots or the events, or were never on that day
  for (const [deck, d] of Object.entries(state)) for (const [id, rec] of Object.entries(d)) if (rec == null) delete d[id];
  return { decks: state, estimated };
}

/**
 * The cards of a course at the end of each day of a run, walked forward once: cardsAt's three steps, made incremental
 * so a year of days costs one pass over the cards, the snapshots and the events (round 4, audit P1-8; cardsAt called
 * day by day re-joined every earlier snapshot and re-sorted every event, so the cost grew with the square of the days).
 *   - the events are sorted once (cardmerge eventOrder) and replayed day by day onto one running state; each card's
 *     changes after a day are found with a pointer that only moves forward;
 *   - a snapshot is joined into the running state on the day it was taken and can be dropped after: step() takes the
 *     snapshots of the days since the last step, so the caller reads them as it goes (data/progress.js reads each file
 *     from the backup only when the walk reaches its day);
 *   - a card that has not changed since a day joins the state on that day (its last change, computed once);
 *   - the estimates of step 3 (estimateCard) go into that day's answer only, never into the running state.
 * The answer equals cardsAt's for every day where the events' times run in the order of their days (the normal
 * case): joining, replaying and the newest-wins rule commute; tests/unit/progress-walk.test.mjs checks the two
 * against each other on random histories.
 * Resuming (a backfill cut off by a closed tab): the first step() may be to the last day done, with each device's
 * newest snapshot up to it, which gives the state of that day; the walk goes on from there.
 * @param {object} o
 * @param {Record<string, Record<string, any>>} o.decks   the course's cards now
 * @param {any[]} o.events   learning events, any order
 * @param {(deck: string) => boolean} [o.keep]
 * @param {string | null} [o.jumpDay]
 */
export function walkDays({ decks, events, keep = () => true, jumpDay = null }) {
  // eventOrder, with each event's time read once (a year is tens of thousands of events)
  const sorted = events.filter(e => e && typeof e.day === 'string' && typeof e.id === 'string').map(e => ({ e, t: Date.parse(e.at) || 0 }))
    .sort((a, b) => a.t - b.t || eventOrder(a.e, b.e)).map(x => x.e);
  /** @type {Set<string>} */ const seenIds = new Set();
  /** @type {any[]} */ const evs = [];
  for (const e of sorted) if (!seenIds.has(e.id)) { seenIds.add(e.id); evs.push(e); }
  // the events by study day, each day's in the replay order
  /** @type {Map<string, any[]>} */ const byDay = new Map();
  for (const e of evs) { let a = byDay.get(e.day); if (!a) byDay.set(e.day, (a = [])); a.push(e); }
  const evDays = [...byDay.keys()].sort();
  // each card's changes in the replay order (for "the first change after the day") and its last event day
  /** @type {Map<string, {day: string, base: any}[]>} */ const changes = new Map();
  for (const e of evs) {
    for (const x of itemsOf(e)) {
      if (!keep(x.deck)) continue;
      const k = `${x.deck}\n${x.itemId}`;
      let a = changes.get(k);
      if (!a) changes.set(k, (a = []));
      a.push({ day: e.day, base: x.base });
    }
  }
  // the day each card here stops changing: it joins the state ("still") from then on
  /** @type {{deck: string, id: string, rec: any, from: string}[]} */ const cards = [];
  for (const [deck, recs] of Object.entries(decks)) {
    if (!keep(deck)) continue;
    for (const [id, rec] of Object.entries(recs || {})) {
      if (!rec) continue;
      let from = '';
      if (rec.last && rec.last > from) from = rec.last;
      if (rec.known && rec.known.on > from) from = rec.known.on;
      for (const h of rec.hist || []) if (h[0] > from) from = h[0];
      for (const c of changes.get(`${deck}\n${id}`) || []) if (c.day > from) from = c.day;
      cards.push({ deck, id, rec, from });
    }
  }
  const byFrom = [...cards].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  /** @type {Map<string, number>} */ const ptr = new Map();
  /** @type {Record<string, Record<string, any>>} */ const state = {};
  let di = 0, si = 0;
  let prev = '';
  /** a card record into the state: the newer wins (cardmerge compare), equal records cheaply @param {string} deck @param {string} id @param {any} rec */
  const join = (deck, id, rec) => {
    if (!rec || typeof rec !== 'object') return;
    const d = state[deck] || (state[deck] = {});
    const cur = d[id];
    if (cur === rec) return;
    if (cur && cur.u === rec.u && (Number(cur.reps) || 0) === (Number(rec.reps) || 0) && JSON.stringify(cur) === JSON.stringify(rec)) return;
    if (compare(rec, cur) > 0) d[id] = rec;
  };
  /** The first change of a card after a day (the pointer moves forward only). @param {string} k @param {string} day */
  const firstAfter = (k, day) => {
    const a = changes.get(k);
    if (!a) return null;
    let i = ptr.get(k) || 0;
    while (i < a.length && a[i].day <= day) i++;
    ptr.set(k, i);
    return i < a.length ? a[i] : null;
  };
  return {
    /**
     * The cards at the end of `day` (after the last step's day), and how many had to be estimated.
     * @param {string} day @param {{cards: Record<string, Record<string, any>>}[]} [snapshots] the snapshots taken after the last step's day, up to this one
     * @returns {{decks: Record<string, Record<string, any>>, estimated: number}}
     */
    step(day, snapshots = []) {
      if (day < prev) throw new Error(`walkDays: ${day} is before ${prev}`);
      for (const snap of snapshots) for (const [deck, recs] of Object.entries((snap && snap.cards) || {})) {
        if (!keep(deck) || !recs || typeof recs !== 'object') continue;
        for (const [id, rec] of Object.entries(recs)) join(deck, id, rec);
      }
      for (; si < byFrom.length && byFrom[si].from <= day; si++) join(byFrom[si].deck, byFrom[si].id, byFrom[si].rec);
      /** @type {any[]} */ const now = [];
      let parts = 0;
      for (; di < evDays.length && evDays[di] <= day; di++, parts++) for (const e of /** @type {any[]} */ (byDay.get(evDays[di]))) now.push(e);
      if (parts > 1) now.sort(eventOrder);
      if (now.length) replay(state, now, keep);
      prev = day;
      // the day's answer: the state, and the cards here that changed after the day and are in neither, estimated
      /** @type {Record<string, Record<string, any>>} */ const out = {};
      for (const [deck, d] of Object.entries(state)) out[deck] = d;
      let estimated = 0;
      for (const c of cards) {
        const d = state[c.deck];
        if (d && d[c.id] !== undefined) continue;
        const k = `${c.deck}\n${c.id}`;
        const first = firstAfter(k, day);
        if (first && (first.base == null || (first.base.u == null && !first.base.reps))) continue;   // made after the day
        const still = c.from <= day;
        const rec = c.rec;
        if (!first && !still && !(rec.hist || []).some((/** @type {any[]} */ h) => h[0] <= day) && !(rec.known && rec.known.on <= day) && !(rec.first && rec.first <= day)) continue;
        const est = estimateCard(rec, day, jumpDay);
        if (!est) continue;
        if (out[c.deck] === state[c.deck]) out[c.deck] = { ...(state[c.deck] || {}) };
        (out[c.deck] || (out[c.deck] = {}))[c.id] = est;
        estimated++;
      }
      return { decks: out, estimated };
    },
  };
}

/**
 * Study days: days with study minutes or rounds, or a card answered or marked on them.
 * @param {Record<string, any>} activity @param {Record<string, Record<string, any>>} decks
 * @returns {string[]} sorted
 */
export function studyDays(activity, decks) {
  /** @type {Set<string>} */ const days = new Set();
  for (const [d, a] of Object.entries(activity || {})) if (D8.isDay(d) && a && (num(a.minutes) > 0 || num(a.rounds) > 0)) days.add(d);
  for (const cards of Object.values(decks || {})) {
    for (const rec of Object.values(cards || {})) {
      if (!rec) continue;
      for (const h of rec.hist || []) if (D8.isDay(h[0])) days.add(h[0]);
      if (rec.known && D8.isDay(rec.known.on)) days.add(rec.known.on);
    }
  }
  return [...days].sort();
}

/** The epoch day (days since the Unix epoch, Igloo's SM-2 unit) of a calendar day. @param {string} day */
export const epochOf = day => { const [y, m, d] = day.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };

/** Every record of a course in a set of kv values: [day, record] sorted. @param {Record<string, any>} kv @param {string} course */
export function records(kv, course) {
  /** @type {[string, any][]} */ const out = [];
  for (const [name, v] of Object.entries(kv || {})) {
    if (!isMonthKey(name) || keyCourse(name) !== course || !v || typeof v !== 'object') continue;
    for (const [d, r] of Object.entries(v)) if (D8.isDay(d) && r) out.push([d, r]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
}

