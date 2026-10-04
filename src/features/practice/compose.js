/* Practice: what goes into a round, and how many new items a day. Pure; tested in node.
   Ported from Igloo's b1.js composer, with the exam date read from the clock context instead of a stored date:
     - a round: due items first (lowest recall), at most 4 new (8 in the very first round), 2 trap items, the two
       easiest due items as a warm-up, and a miss from earlier today last ("the fix")
     - new items come in priority order (P14): Teil 2 ★ phrases, trap grammar, Teil 1/3 ★ phrases, … ; mistakes from
       corrections are spread through the front (one in three)
     - two streams with their own quota: phrases, situations and words ('p') and grammar ('g'), 40 : 15
     - situations come in once two phrases with that job have graduated
     - the exam day is a warm-up of well-known items; nothing new on the eve or the day

   state = { data (pool.js buildPool), cards (deck 'b1': id → FSRS record), day (session day log), c (clock ctx),
             newPerDay (dailyNew()) } */
import * as D8 from '../../domain/days.js';
import * as FS from '../../domain/fsrs.js';
import * as RD from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { ROUND, SPLIT, NEW_ITEM_MIN, dailyNew, streamQuota } from '../../domain/budget.js';

export { ROUND, NEW_ITEM_MIN };

/**
 * @typedef {object} State
 * @property {ReturnType<typeof import('./pool.js').buildPool>} data
 * @property {Record<string, any>} cards
 * @property {{day: string, rounds: number, traps: string[]|null, newShown: number, newBy?: Record<string, number>, firstTry: number[], pred: number[], shown: string[]}} day
 * @property {import('../../core/clock.js').ClockCtx} c
 * @property {number} newPerDay
 */

/** @param {State} s @param {any} it */
export const unseen = (s, it) => !(s.cards[it.id] && s.cards[it.id].reps);
/** @param {State} s @param {any} it */
export const due = (s, it) => RD.isDue(s.cards[it.id], s.c.today, s.c);
/** @param {State} s @param {any} it @param {string} day */
const R = (s, it, day) => FS.Ron(s.cards[it.id], day);
/** @param {any} it */
export const stream = it => (it.area === 'grammar' ? 'g' : 'p');

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

/** New items a day: domain/budget.js (the one answer to "how much today"). */
export { dailyNew };

/** A stream's share of today's new items (the two shares add up to newPerDay). @param {State} s @param {string} st 'p' | 'g' */
export function quota(s, st) {
  if (!s.c.newItems) return 0;
  return streamQuota(s.newPerDay, /** @type {'p'|'g'} */ (st));
}
/** @param {State} s @param {string} st */
export const newLeftOf = (s, st) => Math.max(0, quota(s, st) - ((s.day.newBy || {})[st] || 0));
/** @param {State} s */
export const newLeft = s => newLeftOf(s, 'p') + newLeftOf(s, 'g');

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
    return 11;
  };
  const eligible = (/** @type {any} */ it) => it.rank !== 21 && !(it.group === 'praeteritum' && it.kind !== 'grammar');
  const list = pool.filter(it => unseen(s, it) && eligible(it) && (anyTopic || topicReady(s, it)));
  const base = list.filter(it => !it.mine).map((it, i) => /** @type {[number, number, number, number, number, any]} */ ([tier(it), it.area === 'grammar' ? it.rank : 0, it.star ? 0 : 1, it.bank ? 1 : 0, i, it]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]).map(x => x[5]);
  // mistakes from corrections are spread through the front of the order: one in every three
  const mine = list.filter(it => it.mine), out = [];
  while (base.length || mine.length) { if (mine.length) out.push(mine.shift()); for (let k = 0; k < 2 && base.length; k++) out.push(base.shift()); }
  return out;
}

/** The first n new items, taking each stream's quota in turn. @param {State} s @param {any[]} pool @param {number} n */
export function nextNew(s, pool, n, left = { p: newLeftOf(s, 'p'), g: newLeftOf(s, 'g') }, anyTopic = false) {
  const order = newOrder(s, pool, anyTopic), out = [], q = { ...left };
  const byS = { p: order.filter(it => stream(it) === 'p'), g: order.filter(it => stream(it) === 'g') };
  while (out.length < n && ((q.p > 0 && byS.p.length) || (q.g > 0 && byS.g.length))) {
    const tp = out.filter(it => stream(it) === 'p').length, tg = out.length - tp;
    /** @type {'p'|'g'} */ let st = (tp / SPLIT.p <= tg / SPLIT.g) ? 'p' : 'g';
    if (!(q[st] > 0 && byS[st].length)) st = st === 'p' ? 'g' : 'p';
    out.push(byS[st].shift()); q[st]--;
  }
  return out;
}

/** ★ and trap items not seen yet (the pace count for Auto new items). @param {State} s */
export function priorityLeft(s) {
  return s.data.pool.filter(it => (it.star || it.trap) && unseen(s, it)).length;
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
  const hs = (s.cards[it.id]?.hist || []).filter((/** @type {any[]} */ h) => h[1] === 1);
  return hs.length ? Date.parse(hs[hs.length - 1][0]) : 0;
}
/** Items missed (rated 1) in the last 3 days, latest first. @param {State} s */
export function missed(s) {
  const since = D8.add(s.c.today, -3);
  return s.data.pool.filter(it => (s.cards[it.id]?.hist || []).some((/** @type {any[]} */ h) => h[0] >= since && h[1] === 1)).sort((a, b) => lastMiss(s, b) - lastMiss(s, a));
}

/** New items between reviews: r r n r r n … @param {State} s @param {any[]} list */
function spread(s, list) {
  const news = list.filter(it => unseen(s, it)), olds = list.filter(it => !unseen(s, it)), out = [];
  while (news.length || olds.length) { if (olds.length) out.push(olds.shift()); if (olds.length && out.length % 3 === 1) out.push(olds.shift()); if (news.length) out.push(news.shift()); }
  return out;
}

/**
 * Parse a round kind from the URL: 'today' (default), 'missed', 'mistakes', 'warmup', 'situation',
 * 'area:<speaking|reading|grammar|words>', 'topic:<grammar topic>'.
 * @param {string | null} kind
 * @returns {{kind: string, area?: string, topic?: string}}
 */
export function parseKind(kind) {
  const k = String(kind || 'today');
  const m = /^(area|topic):(.+)$/.exec(k);
  if (m && m[1] === 'area' && ['speaking', 'reading', 'grammar', 'words'].includes(m[2])) return { kind: 'area', area: m[2] };
  if (m && m[1] === 'topic') return { kind: 'topic', area: 'grammar', topic: m[2] };
  if (['missed', 'mistakes', 'warmup', 'situation'].includes(k)) return { kind: k };
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
  let pool = data.pool.filter(it => (!area || it.area === area)
    && (!topic || it.group === topic || (data.topics.get(topic)?.confusable || []).includes(it.group))
    && (!situation || it.kind === 'topic' || it.kind === 'reply'));
  // mistakes stay out of the other area rounds; the daily round and their own round take them
  if (kind === 'area' || kind === 'topic' || situation) pool = pool.filter(it => it.area !== 'mistakes');
  if (kind === 'missed') return missed(s).slice(0, size).map(it => it.id);
  if (c.phase === 'day' || kind === 'warmup') {   // exam morning: a warm-up of items he knows well, nothing written
    return pool.filter(it => s.cards[it.id]?.reps && s.cards[it.id].learn == null && it.area !== 'mistakes')
      .sort((a, b) => R(s, b, today) - R(s, a, today)).slice(0, c.phase === 'day' ? 9 : size).map(it => it.id);
  }
  if (kind === 'mistakes') {   // his corrections: due ones, then unseen ones (no daily quota; none on the eve)
    const mine = pool.filter(it => it.area === 'mistakes');
    const d = mine.filter(it => due(s, it)).sort((a, b) => R(s, a, today) - R(s, b, today));
    const fresh = c.newItems ? mine.filter(it => unseen(s, it)) : [];
    return [...d, ...fresh].slice(0, size).map(it => it.id);
  }
  const dueList = pool.filter(it => due(s, it));
  const starFirst = c.phase === 'eve';
  dueList.sort((a, b) => (starFirst ? ((b.star || b.trap ? 1 : 0) - (a.star || a.trap ? 1 : 0)) : 0) || R(s, a, today) - R(s, b, today));
  const firstEver = !Object.values(s.cards).some(r => r && r.hist && r.hist.length);
  const nNew = Math.min(newLeft(s), firstEver ? 8 : 4);
  const fresh = nextNew(s, pool, nNew + 2, undefined, situation);
  const shownToday = new Set(s.day.shown || []);
  const traps = (!area || area !== 'words') && kind === 'today'
    ? trapSet(s).map(id => data.byId.get(id)).filter(it => it && pool.includes(it) && !shownToday.has(it.id) && !(s.cards[it.id]?.last === today && !due(s, it))) : [];
  /** @type {any[]} */ const chosen = [];
  const add = (/** @type {any} */ it) => { if (it && !chosen.includes(it) && chosen.length < size) chosen.push(it); };
  const fix = dueList.find(it => s.cards[it.id]?.relearn || (s.cards[it.id]?.learn != null && (s.cards[it.id].hist || []).some((/** @type {any[]} */ h) => h[0] === today && h[1] === 1)));
  const warm = dueList.filter(it => it !== fix && !s.cards[it.id]?.relearn && s.cards[it.id]?.learn == null).sort((a, b) => R(s, b, today) - R(s, a, today)).slice(0, 2);
  warm.forEach(add);
  const trapPick = traps.filter(it => !unseen(s, it) || nNew > 0).slice(0, 2);
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

/** Due counts for the next n days, today first. @param {Record<string, any>} cards @param {string} today */
export const forecast = (/** @type {Record<string, any>} */ cards, /** @type {any} */ c, n = 8) => RD.forecast(cards, c.today, n, c);

/** "12 questions, 4 min" for a round of n. @param {number} n */
export const roundCost = n => ({ n, min: roundMinutes(n) });
