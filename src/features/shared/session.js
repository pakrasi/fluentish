/* Practice: a round in progress, as data. Pure (no DOM, no storage, no clock reads); tested in node. The view owns a
   round object, calls these functions, and persists what they return. Ported from Igloo's b1.js runRound().

   round (kv 'b1.session'.round) = { id, kind, area, topic, day, startedAt, queue: [{id, re?}], i, results: [...],
                                     planned, prev: {id: record before the round} }
   result = { id, g, ok, first, ms, isNew, det }

   Scheduling rules kept from the trainer:
     - the rating comes from fsrs.rate(): wrong or revealed 1, over twice the limit 1, late / self-repair / capital or
       umlaut slip / phrase right but the rest of its sentence not (partial) 2, fast and steady 4, else 3
     - "Show me" on an item never seen (new and revealed before any answer) is a study step, not a miss: the card's
       learning steps start (fsrs.js study), its segment shows as seen, and it never counts as missed
     - a miss or a learning step comes back in the same round: +4 questions, then +10, at most 3 showings
     - a "missed" round answers items already reviewed today: those answers only log
     - Claude's "My answer is right" redoes the answer as Hard (2) from the record before it */
import * as FS from '../../domain/fsrs.js';
import * as T from '../../domain/timer.js';
import { stream } from './compose.js';
import { origin } from '../../domain/itemids.js';

/** @param {string[]} ids @param {{kind: string, area?: string, topic?: string}} spec @param {string} today @param {number} now */
export function startRound(ids, spec, today, now) {
  return { id: now, kind: spec.kind, area: spec.area || null, topic: spec.topic || null, day: today, startedAt: now,
    queue: ids.map(id => ({ id })), i: 0, results: /** @type {any[]} */ ([]), planned: ids.length, prev: /** @type {Record<string, any>} */ ({}) };
}

/**
 * The slot a round is kept in: 'today' for the daily round (b1.session.round, the shape carried over from the
 * trainer), else its kind ('missed', 'mistakes', 'area:grammar', 'topic:verb-final', …) in b1.session.rounds, so
 * starting a missed or mistakes round never replaces a paused daily round.
 * @param {{kind: string, area?: string | null, topic?: string | null}} r a round or a parsed kind
 */
export const slotKey = r => (r.kind === 'area' ? `area:${r.area}` : r.kind === 'topic' ? `topic:${r.topic}` : r.kind === 'write' ? (r.topic ? `write:${r.topic}` : 'write') : r.kind === 'cluster' ? `cluster:${r.topic}` : r.kind === 'pick' ? `pick:${r.topic}` : r.kind || 'today');

/** The address that opens (or resumes) a round of this slot. @param {{kind: string, area?: string | null, topic?: string | null}} r */
export const roundHref = r => { const k = slotKey(r); return k === 'today' ? '#/practice/round' : `#/practice/round?kind=${encodeURIComponent(k)}`; };

/** The saved round of a slot (or null). A round carried over from the trainer in the main slot belongs to its own kind. @param {any} sess @param {string} key */
export function savedRound(sess, key) {
  const own = (sess.rounds || {})[key];
  if (own) return own;
  return sess.round && slotKey(sess.round) === key ? sess.round : null;
}

/** A saved round is resumable on the same study day, within 6 hours, while questions are left. @param {any} r @param {string} today @param {number} now */
export function resumable(r, today, now) {
  return !!(r && r.queue && r.day === today && now - r.startedAt <= 6 * 3600e3 && r.i < r.queue.length);
}

/**
 * The entry at the round's position, skipping ids that are no longer in the pool. Returns null at the end.
 * @param {any} round @param {Map<string, any>} byId @param {Record<string, any>} cards
 */
export function current(round, byId, cards) {
  while (round.i < round.queue.length) {
    const q = round.queue[round.i];
    const item = byId.get(q.id);
    if (!item) { round.i++; continue; }
    const rec = cards[item.id];
    const isNew = !rec || !rec.reps;
    const stage = isNew || rec.learn != null ? 0 : rec.stage || 0;
    const fresh = isNew && !q.re;
    return { item, isNew: fresh, limit: fresh ? null : T.limit(item, { stage }), stage, reinsert: !!q.re, q, before: rec ? structuredClone(rec) : null, n: round.i + 1 };
  }
  return null;
}

/**
 * Event payload for card.reviewed (event@1, review B4).
 * @param {string} itemId @param {any} before @param {any} rec @param {{g: number, ms: number, flags: string, mode: string}} o
 * @param {{exam: string|null, phase: string}} c @param {string} tz
 */
export function reviewEvent(itemId, before, rec, o, c, tz, deck = 'b1') {
  return { deck, itemId, g: o.g, ms: Math.round(o.ms || 0), flags: o.flags || '', mode: o.mode || 't',
    ctx: { exam: c.exam, phase: c.phase, tz }, base: before ? { u: before.u ?? null, reps: before.reps ?? 0 } : null, post: rec };
}

/**
 * Record one answer. Mutates round and day; returns the new card record (or null) and the event payload.
 * @param {object} a
 * @param {any} a.round
 * @param {any} a.entry      from current()
 * @param {{ok: boolean, ms: number, revealed?: boolean, selfRepair?: boolean, capSlip?: boolean, umlaut?: boolean, typo?: boolean, partial?: boolean, punct?: boolean, det?: string|null, gDet?: string|null}} a.o
 * @param {Record<string, any>} a.cards
 * @param {any} a.day        the session day log
 * @param {any} a.c          clock context
 * @param {(day: string) => number} [a.forecast]
 * @param {number} a.now
 * @param {string} [a.tz]
 */
export function answer({ round, entry, o, cards, day, c, forecast = () => 0, now, tz = 'UTC' }) {
  const id = entry.item.id, rec = cards[id];
  const logOnly = round.kind === 'missed' && rec?.last === c.today;
  if (!(id in round.prev)) round.prev[id] = entry.before;
  const study = !!(entry.isNew && o.revealed && !o.ok);
  const g = FS.rate({ ok: o.ok, revealed: o.revealed, ms: o.ms, limit: entry.limit, selfRepair: o.selfRepair, capSlip: o.capSlip, umlaut: o.umlaut, partial: o.partial, punct: o.punct,
    prevRating: rec?.hist?.length ? rec.hist[rec.hist.length - 1][1] : 0, stage: entry.stage });
  const over = entry.limit && o.ms > entry.limit * 1000;
  const det = o.det || o.gDet || null;
  const flags = [o.selfRepair && 'r', o.capSlip && 'c', o.typo && 'y', o.umlaut && 'u', over && 'o', o.partial && 'p', o.punct && 'k', study && 'v', det && 'd' + det].filter(Boolean).join('');
  // honesty: predicted recall vs the first try of reviewed items, first attempt of the day only
  const own = !round.deck || round.deck === 'b1';   // a cluster round (deck 'clusters') keeps out of the B1 day log
  if (own && rec && rec.reps && rec.learn == null && rec.last !== c.today && !entry.reinsert) {
    day.pred[0] += FS.Ron(rec, c.today); day.pred[1]++; day.firstTry[0] += g >= 3 ? 1 : 0; day.firstTry[1]++;
  }
  // a new Schreiben phrase (or mistake) counts against its own share (newBy.w, newBy.m), not the daily rounds' new
  // items (newShown)
  if (entry.isNew && own) { const st = stream(entry.item); if (st === 'p' || st === 'g') day.newShown++; day.newBy = day.newBy || {}; day.newBy[st] = (day.newBy[st] || 0) + 1; }
  if (own && !day.shown.includes(id)) day.shown.push(id);
  const src = entry.item.origin || (entry.item.area === 'words' ? 'exam' : origin(id, 'b1'));
  const res = FS.schedule(rec, { g, ms: o.ms, onTime: !!(entry.limit && o.ms <= entry.limit * 1000), flags, mode: 't', logOnly, src, study }, { ...c, forecast }, now);
  // reinsert misses and learning steps: +4, then +10. A mistake from a correction typed right the first time is not
  // asked again in its own round: it comes back on its schedule.
  const times = round.queue.filter((/** @type {any} */ q) => q.id === id).length;
  const rightFirst = round.kind === 'mistakes' && res.reinsert === 'learn' && o.ok && !entry.reinsert;
  if (res.reinsert && times < 3 && !rightFirst) {
    const at = Math.min(round.queue.length, round.i + 1 + (times === 1 ? 4 : 10));
    round.queue.splice(Math.max(round.i + 1, at), 0, { id, re: true });
  }
  round.results.push({ id, g, ok: o.ok, first: !entry.reinsert, ms: Math.round(o.ms || 0), isNew: entry.isNew, det, ...(o.partial ? { partial: true } : {}), ...(study ? { study: true } : {}) });
  return { g, rec: res.rec, event: res.rec ? reviewEvent(id, rec || null, res.rec, { g, ms: o.ms, flags, mode: 't' }, c, tz, round.deck || 'b1') : null };
}

/**
 * Claude said the answer is right: redo it as Hard from the record before this answer and drop its reinsertion.
 * @param {{round: any, entry: any, ms: number, c: any, forecast?: (d: string) => number, now: number, tz?: string}} a
 */
export function override({ round, entry, ms, c, forecast = () => 0, now, tz = 'UTC' }) {
  const id = entry.item.id;
  const res = FS.schedule(entry.before, { g: 2, ms: ms || 0, flags: 'a' }, { ...c, forecast }, now);
  round.queue = round.queue.filter((/** @type {any} */ q, /** @type {number} */ k) => k <= round.i || !(q.id === id && q.re));
  const last = round.results[round.results.length - 1];
  if (last && last.id === id) { last.ok = true; last.g = 2; }
  return { rec: res.rec, event: res.rec ? reviewEvent(id, entry.before, res.rec, { g: 2, ms, flags: 'a', mode: 't' }, c, tz, round.deck || 'b1') : null };
}

/** Move on. Returns true while there is a next question. @param {any} round */
export function advance(round) { round.i++; return round.i < round.queue.length; }

/** Segment states for the kit's segments(): 'done' | 'miss' | 'seen' (a study step) | 'now' | ''. answered: the current card has its result. @param {any} round */
export function dots(round, answered = false) {
  return round.queue.map((/** @type {any} */ q, /** @type {number} */ k) => {
    if (k === round.i && !answered) return 'now';
    if (k > round.i) return '';
    const r = round.results.filter((/** @type {any} */ x) => x.id === q.id)[round.queue.slice(0, k).filter((/** @type {any} */ x) => x.id === q.id).length];
    return r && r.ok ? 'done' : r && r.study ? 'seen' : 'miss';
  });
}

/**
 * A spoken answer (Say it aloud). Right = Good (Hard when slow); trap items (verb at the end, für/vor) get at most
 * Hard from speech alone, and so does a phrase whose sentence was not right around it (partial); items not met yet
 * only log (speech never starts a schedule).
 * @param {{item: any, rec: any, o: {ok: boolean, ms: number, limit?: number|null, partial?: boolean}, c: any, forecast?: (d: string) => number, now: number, tz?: string}} a
 */
export function spoken({ item, rec, o, c, forecast = () => 0, now, tz = 'UTC' }) {
  const trap = ['verb-final', 'fuer-vor'].some(x => item.trap === x || (item.focus || []).includes(x));
  let g = o.ok ? (o.limit && o.ms > o.limit * 1000 ? 2 : 3) : 1;
  if (o.ok && (trap || o.partial)) g = Math.min(g, 2);
  const flags = o.ok && o.partial ? 'sp' : 's';
  const res = FS.schedule(rec, { g, ms: o.ms || 0, onTime: g >= 3, flags, mode: 's', logOnly: !rec || !rec.reps }, { ...c, forecast }, now);
  return { g, rec: res.rec, event: res.rec ? reviewEvent(item.id, rec || null, res.rec, { g, ms: o.ms, flags, mode: 's' }, c, tz) : null };
}

/**
 * What the done screen shows. @param {any} round @param {Map<string, any>} byId
 */
export function summary(round, byId) {
  // a card marked "I know this" is not an answer: it is counted apart (known)
  const firsts = round.results.filter((/** @type {any} */ r) => r.first && !r.known && !r.study);
  const right = firsts.filter((/** @type {any} */ r) => r.ok).length;
  const late = firsts.filter((/** @type {any} */ r) => r.ok && r.g === 2 && !r.partial).length;
  const partial = firsts.filter((/** @type {any} */ r) => r.ok && r.partial).length;
  // a study step on a new item is not a miss: it is in news, never in back
  const missedIds = new Set(firsts.filter((/** @type {any} */ r) => !r.ok && !r.study).map((/** @type {any} */ r) => r.id));
  const uniq = (/** @type {string[]} */ ids) => [...new Set(ids)].map(id => byId.get(id)).filter(Boolean);
  const fixed = uniq(round.results.filter((/** @type {any} */ r) => !r.first && r.ok && missedIds.has(r.id)).map((/** @type {any} */ r) => r.id));
  const news = uniq(round.results.filter((/** @type {any} */ r) => r.isNew && !r.known).map((/** @type {any} */ r) => r.id));
  const known = uniq(round.results.filter((/** @type {any} */ r) => r.known).map((/** @type {any} */ r) => r.id));
  const back = uniq([...missedIds]);
  const last = round.results[round.results.length - 1];
  return { total: firsts.length, right, late, partial, fixed, news, back, known, fixedLast: !!(last && !last.first && last.ok),
    ms: round.results.reduce((/** @type {number} */ a, /** @type {any} */ r) => a + Math.min(r.ms || 0, 60000), 0) };
}
