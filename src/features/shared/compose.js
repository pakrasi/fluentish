/* Practice: what goes into a round, and how many new items a day. Pure; tested in node.
   Ported from Igloo's b1.js composer, with the exam date read from the clock context instead of a stored date:
     - a round: due items first (lowest recall), at most 4 new (8 in the very first round), 2 trap items, the two
       easiest due items as a warm-up, and a miss from earlier today last ("the fix")
     - new items come in priority order (P14): Teil 2 ★ phrases, trap grammar, Teil 1/3 ★ phrases, … ; mistakes from
       corrections are spread through the front (one in three)
     - two streams share the b1 deck's part of the day's allowance (domain/budget.js): phrases, situations and words
       ('p') and grammar ('g'), 40 : 15
     - Schreiben phrases (area writing, stream 'w') have their own rounds (kind write) and their own share of the
       allowance; the daily round leaves them out. Mistakes from corrections (stream 'm') have their own share (it
       comes first): one in three new items of a round while it lasts, and all of it in their own round
     - a learner below B1 (settings.level A1 or A2) meets the items of his level first, then the next level; in his
       first study week only items of his level
     - situations come in once two phrases with that job have graduated
     - the exam day is a warm-up of well-known items; nothing new on the eve or the day

   state = { data (pool.js buildPool), cards (deck 'b1': id → FSRS record), day (session day log), c (clock ctx),
             newPerDay (the b1 share of the allowance), writingNew, mistakesNew, level, fresh } */
import * as D8 from '../../domain/days.js';
import * as FS from '../../domain/fsrs.js';
import * as RD from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { ROUND, SPLIT, NEW_ITEM_MIN, streamQuota } from '../../domain/budget.js';
import { skipsNew } from '../../domain/known.js';

export { ROUND, NEW_ITEM_MIN };

/**
 * @typedef {object} State
 * @property {ReturnType<typeof import('./pool.js').buildPool>} data
 * @property {Record<string, any>} cards
 * @property {{day: string, rounds: number, traps: string[]|null, newShown: number, newBy?: Record<string, number>, firstTry: number[], pred: number[], shown: string[]}} day
 * @property {import('../../core/clock.js').ClockCtx} c
 * @property {number} newPerDay
 * @property {number} [writingNew]   new Schreiben phrases for the day (stream 'w')
 * @property {number} [mistakesNew]  new mistakes from corrections for the day (stream 'm'; Infinity when not given)
 * @property {Set<string>} [marked]   items marked known in any deck (domain/known.js markedItems): never introduced as new
 * @property {string | null} [level] the learner's level (settings.level)
 * @property {boolean} [fresh]       his first study week: only items of his level are new
 */

/** @param {State} s @param {any} it */
export const unseen = (s, it) => !(s.cards[it.id] && s.cards[it.id].reps);
/** @param {State} s @param {any} it */
export const due = (s, it) => RD.isDue(s.cards[it.id], s.c.today, s.c);
/** @param {State} s @param {any} it @param {string} day */
const R = (s, it, day) => FS.Ron(s.cards[it.id], day);
/** @param {any} it */
export const stream = it => (it.area === 'grammar' ? 'g' : it.area === 'writing' ? 'w' : it.area === 'clusters' ? 'c' : it.area === 'mistakes' ? 'm' : 'p');

/** A study step on a new item (Show me): logged as 1 with the flag v, it is not a miss. @param {any[]} h a hist entry */
export const studyStep = h => String(h[4] || '').includes('v');
/** A real miss in the log: rated 1 and not a study step. @param {any[]} h */
export const isMiss = h => h[1] === 1 && !studyStep(h);

/** A fresh day log. @param {string} today */
export const newDay = today => ({ day: today, rounds: 0, traps: null, newShown: 0, newBy: {}, firstTry: [0, 0], pred: [0, 0], shown: /** @type {string[]} */ ([]) });

/**
 * Roll the session's day log: a log from an earlier day moves into `days` (last 40 kept).
 * @param {{day?: any, days?: any[]}} session @param {string} today
 * @returns {{day: any, days: any[], rolled: boolean}}
 */
export function rollDay(session, today) {
  const d = session.day;
  if (d && d.day === today) return { day: d, days: session.days || [], rolled: false };
  let days = session.days || [];
  if (d && d.day) days = [...days.filter(x => x.day !== d.day), d].slice(-40);
  return { day: newDay(today), days, rolled: true };
}

/** A stream's share of today's new items (the two shares add up to newPerDay). @param {State} s @param {string} st 'p' | 'g' */
export function quota(s, st) {
  if (!s.c.newItems) return 0;
  if (st === 'w') return s.writingNew || 0;
  if (st === 'm') return s.mistakesNew ?? Infinity;
  return streamQuota(s.newPerDay, /** @type {'p'|'g'} */ (st));
}
/** New items the day still has room for across the daily streams: a round that took more than its stream's share
 * (a custom or "all" round, domain/roundsize.js) uses up the day, not just its stream. @param {State} s */
const dayRoom = s => Math.max(0, (s.newPerDay || 0) - (s.day.newShown || 0));
/** @param {State} s @param {string} st */
export const newLeftOf = (s, st) => {
  const own = Math.max(0, quota(s, st) - ((s.day.newBy || {})[st] || 0));
  return st === 'w' || st === 'm' ? own : Math.min(own, dayRoom(s));
};
/** New items left today in the daily rounds (Schreiben phrases have their own: newLeftOf(s, 'w')). @param {State} s */
export const newLeft = s => Math.min(newLeftOf(s, 'p') + newLeftOf(s, 'g'), dayRoom(s));

/** Situations come in once two phrases with that job have graduated. @param {State} s @param {any} it */
export function topicReady(s, it) {
  if (it.kind !== 'topic' && it.kind !== 'reply') return true;
  const fn = it.fn === 't1_react' ? 't1_reject' : it.fn;
  let n = 0;
  for (const x of s.data.pool) if (x.fn === fn && x.kind === 'phrase' && s.cards[x.id]?.reps && s.cards[x.id].learn == null) if (++n >= 2) return true;
  return false;
}

/** Unseen items in the order they are introduced (P14). @param {State} s @param {any[]} pool @param {boolean} [anyTopic] */
export function newOrder(s, pool, anyTopic = false) {
  const topics = s.data.topics;
  const tier = (/** @type {any} */ it) => {
    if (it.area === 'speaking' && it.group === 'S2' && it.star && it.kind === 'phrase') return 1;
    if (it.area === 'grammar' && topics.get(it.group)?.trap) return 2;
    if (it.area === 'speaking' && (it.group === 'S1' || it.group === 'S3') && it.star && it.kind === 'phrase') return 3;
    if (it.area === 'speaking' && it.group === 'opinion' && it.kind === 'phrase') return 4;
    if (it.area === 'grammar' && it.rank <= 20) return 5;
    if (it.area === 'reading' && it.group !== 'signal') return 6;
    if (it.area === 'speaking' && it.kind === 'phrase') return 7;
    if (it.kind === 'topic' || it.kind === 'reply') return 8;
    if (it.area === 'words') return 9;
    if (it.area === 'reading') return 10;
    if (it.area === 'writing') return 12;
    return 11;
  };
  const eligible = (/** @type {any} */ it) => it.rank !== 21 && !(it.group === 'praeteritum' && it.kind !== 'grammar');
  // a learner below B1 meets his level first (band 0), then the next; in his first week only his level
  const band = levelBand(s.level);
  const list = pool.filter(it => unseen(s, it) && eligible(it) && (anyTopic || topicReady(s, it)) && !(s.marked && skipsNew(s.marked, it.id, it.chunk))
    && !(s.fresh && band(it) > 0 && !it.mine));
  // inside a level band and a tier: rank (grammar, Schreiben), ★ first, then the more common word first (zipf; exam words carry it)
  const base = list.filter(it => !it.mine).map((it, i) => /** @type {[number, number, number, number, number, any, number, number]} */ ([tier(it), it.area === 'grammar' || it.area === 'writing' ? it.rank ?? 99 : 0, it.star ? 0 : 1, it.bank ? 1 : 0, i, it, -(Number(it.zipf) || 0), band(it)]))
    .sort((a, b) => a[7] - b[7] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[6] - b[6] || a[3] - b[3] || a[4] - b[4]).map(x => x[5]);
  // mistakes from corrections are spread through the front of the order: one in every three
  const mine = list.filter(it => it.mine), out = [];
  while (base.length || mine.length) { if (mine.length) out.push(mine.shift()); for (let k = 0; k < 2 && base.length; k++) out.push(base.shift()); }
  return out;
}

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/**
 * How far an item is above a learner's level: 0 at or below it, 1 one level up … Only for a learner below B1
 * (A1, A2); otherwise every item is band 0. An item without a level counts as B1.
 * @param {string | null | undefined} level @returns {(it: any) => number}
 */
export function levelBand(level) {
  const me = LEVELS.indexOf(String(level || ''));
  if (me < 0 || me >= 2) return () => 0;
  return it => { const l = LEVELS.indexOf(String(it.level || '')); return Math.max(0, (l < 0 ? 2 : l) - me); };
}

/** The first n new items, taking each stream's quota in turn. @param {State} s @param {any[]} pool @param {number} n */
export function nextNew(s, pool, n, left = { p: newLeftOf(s, 'p'), g: newLeftOf(s, 'g'), w: newLeftOf(s, 'w'), m: newLeftOf(s, 'm') }, anyTopic = false) {
  const order = newOrder(s, pool, anyTopic), out = [], q = /** @type {Record<'p'|'g'|'w'|'m', number>} */ ({ w: 0, m: 0, ...left });
  const byS = { p: order.filter(it => stream(it) === 'p'), g: order.filter(it => stream(it) === 'g'), w: order.filter(it => stream(it) === 'w'), m: order.filter(it => stream(it) === 'm') };
  const can = (/** @type {'p'|'g'|'w'|'m'} */ st) => q[st] > 0 && byS[st].length > 0;
  while (out.length < n && (can('p') || can('g') || can('w') || can('m'))) {
    /** @type {'p'|'g'|'w'|'m'} */ let st = 'w';
    // mistakes from corrections: one in every three new items while their share lasts (their own stream, 'm')
    if (can('m') && (out.length % 3 === 0 || !(can('p') || can('g') || can('w')))) st = 'm';
    else if (!can('w')) {   // the daily streams take turns by their split; a Schreiben round has only 'w'
      const tp = out.filter(it => stream(it) === 'p').length, tg = out.filter(it => stream(it) === 'g').length;
      st = (tp / SPLIT.p <= tg / SPLIT.g) ? 'p' : 'g';
      if (!can(st)) st = st === 'p' ? 'g' : 'p';
      if (!can(st)) st = 'm';
    }
    out.push(byS[st].shift()); q[st]--;
  }
  return out;
}

/** ★ and trap items not seen yet (the pace count for Auto new items). @param {State} s */
export function priorityLeft(s) {
  return s.data.pool.filter(it => (it.star || it.trap) && it.area !== 'writing' && unseen(s, it)).length;
}

/** The day's trap set: 2 per sticky-error class, 2 more from mistakes; most-flagged and weakest first. @param {State} s */
export function trapSet(s) {
  if (s.day.traps) return s.day.traps;
  const today = s.c.today, recent = D8.add(today, -3);
  const flagCount = (/** @type {any} */ it, /** @type {string} */ cls) => (s.cards[it.id]?.hist || []).filter((/** @type {any[]} */ h) => h[0] >= recent && String(h[4]).includes('d' + cls)).length;
  /** @type {string[]} */ const out = [];
  const pickFrom = (/** @type {any[]} */ list, /** @type {number} */ n, /** @type {string} */ cls) => {
    const seen = list.filter(it => !unseen(s, it)).sort((a, b) => flagCount(b, cls) - flagCount(a, cls) || R(s, a, today) - R(s, b, today));
    const fresh = list.filter(it => unseen(s, it));
    for (const it of [...seen, ...fresh]) { if (n <= 0) break; if (!out.includes(it.id)) { out.push(it.id); n--; } }
  };
  pickFrom(s.data.pool.filter(it => it.mine && it.trap), 2, '');
  for (const cls of ['verb-final', 'v2', 'fuer-vor', 'cap', 'neuter']) pickFrom(s.data.pool.filter(it => it.trap === cls && it.area !== 'words'), 2, cls);
  return out;
}

/** @param {State} s @param {any} it */
function lastMiss(s, it) {
  const hs = (s.cards[it.id]?.hist || []).filter(isMiss);
  return hs.length ? Date.parse(hs[hs.length - 1][0]) : 0;
}
/** Items missed (rated 1) in the last 3 days, latest first; a study step on a new item (Show me) is not a miss. @param {State} s */
export function missed(s) {
  const since = D8.add(s.c.today, -3);
  return s.data.pool.filter(it => (s.cards[it.id]?.hist || []).some((/** @type {any[]} */ h) => h[0] >= since && isMiss(h))).sort((a, b) => lastMiss(s, b) - lastMiss(s, a));
}

/** New items between reviews: r r n r r n … @param {State} s @param {any[]} list */
function spread(s, list) {
  const news = list.filter(it => unseen(s, it)), olds = list.filter(it => !unseen(s, it)), out = [];
  while (news.length || olds.length) { if (olds.length) out.push(olds.shift()); if (olds.length && out.length % 3 === 1) out.push(olds.shift()); if (news.length) out.push(news.shift()); }
  return out;
}

/**
 * Parse a round kind from the URL: 'today' (default), 'missed', 'mistakes', 'warmup', 'situation',
 * 'area:<speaking|reading|grammar|words|writing>', 'topic:<grammar topic>', 'write' and 'write:<W1|W2|W3>' (Schreiben
 * phrases, all or one Aufgabe).
 * @param {string | null} kind
 * @returns {{kind: string, area?: string, topic?: string}}
 */
export function parseKind(kind) {
  const k = String(kind || 'today');
  const w = /^write(?::(W[123]))?$/.exec(k);
  if (w || k === 'area:writing') return w && w[1] ? { kind: 'write', area: 'writing', topic: w[1] } : { kind: 'write', area: 'writing' };
  const m = /^(area|topic):(.+)$/.exec(k);
  if (m && m[1] === 'area' && ['speaking', 'reading', 'grammar', 'words'].includes(m[2])) return { kind: 'area', area: m[2] };
  if (m && m[1] === 'topic') return { kind: 'topic', area: 'grammar', topic: m[2] };
  if (['missed', 'mistakes', 'warmup', 'situation'].includes(k)) return { kind: k };
  // items picked on the Explore map (phrases, grammar): pick:<id>,<id>…
  const p = /^pick:(.+)$/.exec(k);
  if (p) return { kind: 'pick', topic: p[1] };
  return { kind: 'today' };
}

/**
 * The item ids of a round.
 * @param {State} s
 * @param {{kind?: string, area?: string, topic?: string, size?: number}} [spec]
 * @returns {string[]}
 */
export function compose(s, { kind = 'today', area, topic, size = ROUND } = {}) {
  const c = s.c, today = c.today, data = s.data;
  const situation = kind === 'situation';
  const write = kind === 'write';
  let pool = data.pool.filter(it => (!area || it.area === area)
    && (!topic || it.group === topic || (data.topics.get(topic)?.confusable || []).includes(it.group))
    && (!situation || it.kind === 'topic' || it.kind === 'reply'));
  // mistakes stay out of the other area rounds; the daily round and their own round take them
  if (kind === 'area' || kind === 'topic' || situation || write) pool = pool.filter(it => it.area !== 'mistakes');
  // the Schreiben phrases have their own rounds and their own share of the day
  if (kind === 'today') pool = pool.filter(it => it.area !== 'writing');
  if (kind === 'missed') return missed(s).slice(0, size).map(it => it.id);
  if (kind === 'pick') {   // the items as given (at most a round), new ones only while new items are allowed
    return [...new Set(String(topic || '').split(','))].map(id => data.byId.get(id)).filter(it => it && it.area !== 'mistakes' && (c.newItems || !unseen(s, it)))
      .slice(0, size).map(it => it.id);
  }
  if (c.phase === 'day' || kind === 'warmup') {   // exam morning: a warm-up of items he knows well, nothing written
    return pool.filter(it => s.cards[it.id]?.reps && s.cards[it.id].learn == null && it.area !== 'mistakes')
      .sort((a, b) => R(s, b, today) - R(s, a, today)).slice(0, c.phase === 'day' ? 9 : size).map(it => it.id);
  }
  if (kind === 'mistakes') {   // his corrections: due ones, then unseen ones (their share of the day; none on the eve)
    const mine = pool.filter(it => it.area === 'mistakes');
    const d = mine.filter(it => due(s, it)).sort((a, b) => R(s, a, today) - R(s, b, today));
    const fresh = c.newItems ? mine.filter(it => unseen(s, it)).slice(0, Math.max(0, newLeftOf(s, 'm'))) : [];
    return [...d, ...fresh].slice(0, size).map(it => it.id);
  }
  const dueList = pool.filter(it => due(s, it));
  const starFirst = c.phase === 'eve';
  dueList.sort((a, b) => (starFirst ? ((b.star || b.trap ? 1 : 0) - (a.star || a.trap ? 1 : 0)) : 0) || R(s, a, today) - R(s, b, today));
  const firstEver = !Object.values(s.cards).some(r => r && r.hist && r.hist.length);
  const nNew = write ? Math.min(newLeftOf(s, 'w'), 8) : Math.min(newLeft(s), firstEver ? 8 : 4);
  const fresh = nextNew(s, pool, nNew + 2, undefined, situation);
  const shownToday = new Set(s.day.shown || []);
  const traps = (!area || area !== 'words') && kind === 'today'
    ? trapSet(s).map(id => data.byId.get(id)).filter(it => it && pool.includes(it) && !shownToday.has(it.id) && !(s.cards[it.id]?.last === today && !due(s, it))) : [];
  /** @type {any[]} */ const chosen = [];
  const add = (/** @type {any} */ it) => { if (it && !chosen.includes(it) && chosen.length < size) chosen.push(it); };
  const fix = dueList.find(it => s.cards[it.id]?.relearn || (s.cards[it.id]?.learn != null && (s.cards[it.id].hist || []).some((/** @type {any[]} */ h) => h[0] === today && isMiss(h))));
  const warm = dueList.filter(it => it !== fix && !s.cards[it.id]?.relearn && s.cards[it.id]?.learn == null).sort((a, b) => R(s, b, today) - R(s, a, today)).slice(0, 2);
  warm.forEach(add);
  // a trap item never seen is new: for a learner below B1 it waits for its level band, like every new item (newOrder)
  const band = levelBand(s.level);
  const trapPick = traps.filter(it => !unseen(s, it) || (nNew > 0 && band(it) === 0)).slice(0, 2);
  const rest = dueList.filter(it => it !== fix && !warm.includes(it));
  let newUsed = 0;
  /** @type {any[]} */ const mid = [];
  const dueCap = size - warm.length - (fix ? 1 : 0) - trapPick.length - Math.min(nNew, fresh.length);
  for (const it of rest.slice(0, Math.max(0, dueCap))) mid.push(it);
  for (const it of trapPick) { if (mid.includes(it)) continue; if (unseen(s, it)) { if (newUsed >= nNew) continue; newUsed++; } mid.push(it); }
  for (const it of fresh) { if (newUsed >= nNew || mid.includes(it)) continue; mid.push(it); newUsed++; }
  for (const it of rest.slice(Math.max(0, dueCap))) { if (warm.length + mid.length + (fix ? 1 : 0) >= size) break; if (!mid.includes(it)) mid.push(it); }
  for (const it of nextNew(s, pool, size, undefined, situation)) { if (warm.length + mid.length + (fix ? 1 : 0) >= size || newUsed >= nNew) break; if (!mid.includes(it)) { mid.push(it); newUsed++; } }
  mid.sort((a, b) => (unseen(s, a) ? 1 : 0) - (unseen(s, b) ? 1 : 0));
  const out = [...warm, ...spread(s, mid)];
  if (fix && !out.includes(fix)) out.push(fix);
  return out.slice(0, size).map(it => it.id);
}

/**
 * The list a round kind draws from, by what a round would do with each item (domain/roundsize.js Buckets): the round
 * size picker's N and its custom and "all" rounds. Recommended stays compose(). The same pool rules as compose():
 * mistakes only in their own round, Schreiben phrases in theirs; items marked known and items never introduced
 * (rank 21, Präteritum phrases) are not in it as new.
 * @param {State} s @param {{kind?: string, area?: string, topic?: string}} spec
 * @returns {import('../../domain/roundsize.js').Buckets}
 */
export function buckets(s, { kind = 'today', area, topic } = {}) {
  const c = s.c, today = c.today, data = s.data;
  let pool;
  if (kind === 'missed') pool = missed(s);
  else if (kind === 'mistakes') pool = data.pool.filter(it => it.area === 'mistakes');
  else {
    pool = data.pool.filter(it => (!area || it.area === area) && (!topic || it.group === topic || (data.topics.get(topic)?.confusable || []).includes(it.group)) && it.area !== 'mistakes');
    if (kind === 'today') pool = pool.filter(it => it.area !== 'writing');
  }
  const weak = (/** @type {any} */ a, /** @type {any} */ b) => R(s, a, today) - R(s, b, today);
  const dueL = pool.filter(it => !unseen(s, it) && due(s, it)).sort(weak).map(it => it.id);
  const rest = pool.filter(it => !unseen(s, it) && !due(s, it)).sort(weak).map(it => it.id);
  // a missed round answers items already seen; the rest share the day's allowance (mistakes their own share)
  const fresh = kind === 'missed' ? [] : kind === 'mistakes' ? pool.filter(it => unseen(s, it)).map(it => it.id) : newOrder(s, pool, true).map(it => it.id);
  const st = kind === 'write' ? 'w' : kind === 'mistakes' ? 'm' : area === 'grammar' || kind === 'topic' ? 'g' : 'p';
  const newLeft = !c.newItems || kind === 'missed' ? 0 : kind === 'today' ? newLeft_(s) : newLeftOf(s, st);
  return { due: dueL, fresh, rest, newLeft, daily: true };
}
const newLeft_ = (/** @type {State} */ s) => newLeft(s);

/** Due counts for the next n days, today first. @param {Record<string, any>} cards @param {string} today */
export const forecast = (/** @type {Record<string, any>} */ cards, /** @type {any} */ c, n = 8) => RD.forecast(cards, c.today, n, c);

/** "12 questions, 4 min" for a round of n. @param {number} n */
export const roundCost = n => ({ n, min: roundMinutes(n) });
