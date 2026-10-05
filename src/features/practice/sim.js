/* Speaking situations (#/practice/situations): the bank, the level unlocks, a round and its scheduling, as data.
   Pure (no DOM, no storage, no clock reads); tested in node (tests/unit/sim.test.mjs). The view is sim-view.js.

   An item is one everyday situation: a setup in English, the other person's line in German, a goal, and model
   answers with the target chunk marked by offsets (content/speak/situations.json, built from authoring/speak/ by
   tools/build-speak.mjs). The learner says his answer out loud, sees the model answer and grades himself Again / Hard
   / Good / Easy. Each item is a card 'SS:<fn>-<nn>' in deck 'speak' of the one FSRS schedule (domain/fsrs.js), so
   the B1 review round, its due count and readiness never see these cards.

   Levels open in order A1 → A2 → B1 → B2: a level is open when it is at or below the learner's chosen start level,
   or when the level before it is open and steady (STEADY of its items learnt: seen, out of the learning steps and
   not lapsed). Choosing a start level ("Start at B1") opens everything up to it at once. */
import * as FS from '../../domain/fsrs.js';
import * as D8 from '../../domain/days.js';
import { isDue } from '../../domain/b1ready.js';

export const LEVELS = /** @type {const} */ (['A1', 'A2', 'B1', 'B2']);
export const DECK = 'speak';
export const PREFIX = 'SS:';
/** kv collection: { start, round, day: {day, newShown, rounds}, stats: {day, unseen, due, total} } */
export const KV = 'speak.sim';
export const ROUND_SIZE = 12;
/** Share of a level's items learnt before the next level opens. */
export const STEADY = 0.6;
/** New items in one round picked by level or function (the mixed round follows the day's budget). */
export const PICK_NEW = 6;

/** @typedef {{de: string, chunk: [number, number], audio: string}} Answer */
/** @typedef {{id: string, fn: string, lv: string, freq: number, reg: 'du'|'Sie', setup: string, goal: string,
 *   other: {de: string, audio: string, voice: string}, answers: Answer[], ck?: string, frame?: string, src: string}} Item */
/** @typedef {{kind: 'mixed'} | {kind: 'level', lv: string} | {kind: 'fn', fn: string}} Pick */

const idx = (/** @type {string} */ lv) => LEVELS.indexOf(/** @type {any} */ (lv));

/* ------------------------------------------------------------------ */
/* The bank                                                            */
/* ------------------------------------------------------------------ */

/**
 * "Am Mittwoch kann ich nicht. [Wie wäre es mit] Donnerstag?" → { de, chunk: [start, end] }. Exactly one pair of
 * brackets around a non-empty span without outer spaces; null otherwise.
 * @param {string} s
 */
export function parseMarked(s) {
  const m = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/.exec(String(s));
  if (!m || m[2] !== m[2].trim()) return null;
  return { de: m[1] + m[2] + m[3], chunk: /** @type {[number, number]} */ ([m[1].length, m[1].length + m[2].length]) };
}

/** An answer split around its chunk: [before, chunk, after]. @param {Answer} a */
export const chunkParts = a => [a.de.slice(0, a.chunk[0]), a.de.slice(a.chunk[0], a.chunk[1]), a.de.slice(a.chunk[1])];

const ID = /^SS:[a-z]+-\d{2}$/;
const AUDIO = /^[0-9a-f]{32}\.mp3$/;
// formal forms inside a du item (not at a sentence start, where "Sie" can be "she" or "they"), informal ones in a Sie item
const FORMAL = /(?:[^.!?„“"\s]\s+)(Sie|Ihnen|Ihr|Ihre[mnrs]?)\b|\bIhnen\b/;
const INFORMAL = /\b(du|dich|dir|dein|deine[mnrs]?|euch|euer|eure[mnrs]?)\b/i;

/**
 * Everything the bank must satisfy beyond its JSON Schema. Used by tools/validate-content.mjs and the unit tests.
 * @param {any} bank content/speak/situations.json
 * @param {{chunkIds?: Set<string> | null, frameIds?: Set<string> | null}} [o] known chunk bank and frame ids
 * @returns {string[]} problems, empty when the bank is valid
 */
export function validateBank(bank, { chunkIds = null, frameIds = null } = {}) {
  /** @type {string[]} */ const out = [];
  const fns = bank && bank.functions && typeof bank.functions === 'object' ? bank.functions : {};
  const items = Array.isArray(bank?.items) ? bank.items : [];
  if (!items.length) out.push('no items');
  const voices = bank?.voices || {};
  if (!voices.answer || !Array.isArray(voices.other) || !voices.other.length) out.push('voices: an answer voice and other voices are required');
  if (voices.other?.includes(voices.answer)) out.push('voices: the answer voice must differ from the other person\'s voices');
  const seen = new Set();
  for (const it of items) {
    const at = it?.id || '?';
    const bad = (/** @type {string} */ m) => out.push(`${at}: ${m}`);
    if (!ID.test(String(it?.id))) bad('id must look like SS:<function>-<nn>');
    if (seen.has(it?.id)) bad('duplicate id'); seen.add(it?.id);
    if (it?.id && it.fn && !String(it.id).startsWith(`${PREFIX}${it.fn}-`)) bad(`id does not match its function ${it.fn}`);
    if (!(it?.fn in fns)) bad(`unknown function ${it?.fn}`);
    if (idx(it?.lv) < 0) bad(`unknown level ${it?.lv}`);
    if (![1, 2, 3].includes(it?.freq)) bad('freq must be 1, 2 or 3');
    if (it?.reg !== 'du' && it?.reg !== 'Sie') bad('reg must be du or Sie');
    for (const k of ['setup', 'goal']) {
      const v = String(it?.[k] || '');
      if (!v.trim()) bad(`${k} is empty`);
      if (/[—–]/.test(v)) bad(`${k} has a dash`);
    }
    if (!String(it?.other?.de || '').trim()) bad('the other person\'s line is empty');
    if (!AUDIO.test(String(it?.other?.audio))) bad('other.audio must be <md5>.mp3');
    if (it?.other?.voice && voices.other && !voices.other.includes(it.other.voice)) bad(`other.voice ${it.other.voice} is not one of the other voices`);
    const answers = Array.isArray(it?.answers) ? it.answers : [];
    if (!answers.length) bad('no model answer');
    answers.forEach((/** @type {any} */ a, /** @type {number} */ k) => {
      const de = String(a?.de || ''), [s, e] = Array.isArray(a?.chunk) ? a.chunk : [-1, -1];
      if (!de.trim()) bad(`answer ${k + 1} is empty`);
      if (!(Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e > s && e <= de.length)) bad(`answer ${k + 1}: the chunk is outside the sentence`);
      else if (de.slice(s, e) !== de.slice(s, e).trim()) bad(`answer ${k + 1}: the chunk starts or ends with a space`);
      if (!AUDIO.test(String(a?.audio))) bad(`answer ${k + 1}: audio must be <md5>.mp3`);
      if (it?.reg === 'du' && FORMAL.test(de)) bad(`answer ${k + 1} uses Sie in a du situation`);
      if (it?.reg === 'Sie' && INFORMAL.test(de)) bad(`answer ${k + 1} uses du in a Sie situation`);
    });
    if (it?.reg === 'du' && FORMAL.test(String(it?.other?.de || ''))) bad('the other line uses Sie in a du situation');
    if (it?.reg === 'Sie' && INFORMAL.test(String(it?.other?.de || ''))) bad('the other line uses du in a Sie situation');
    if (it?.ck != null && chunkIds && !chunkIds.has(it.ck)) bad(`unknown chunk ${it.ck}`);
    if (it?.frame != null && frameIds && !frameIds.has(it.frame)) bad(`unknown frame ${it.frame}`);
  }
  for (const lv of LEVELS) if (items.length && !items.some((/** @type {any} */ it) => it?.lv === lv)) out.push(`no items at ${lv}`);
  return out;
}

/** Items in learning order: level, then how common, then the bank's order. @param {Item[]} items */
export function ordered(items) {
  const pos = new Map(items.map((it, i) => [it.id, i]));
  return [...items].sort((a, b) => idx(a.lv) - idx(b.lv) || a.freq - b.freq || /** @type {number} */ (pos.get(a.id)) - /** @type {number} */ (pos.get(b.id)));
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

/** Seen, out of the learning steps and not lapsed. @param {any} rec */
export const learnt = rec => !!(rec && rec.reps && rec.learn == null && !rec.relearn);

/**
 * @typedef {object} LevelState
 * @property {string} lv @property {number} n @property {number} seen @property {number} learnt
 * @property {boolean} steady   learnt ≥ STEADY of n
 * @property {boolean} open     new items of this level can be shown
 * @property {boolean} chosen   at or below the chosen start level
 */

/**
 * @param {Item[]} items @param {Record<string, any>} cards deck 'speak' @param {string | null | undefined} start the chosen start level
 * @returns {LevelState[]}
 */
export function levelStates(items, cards, start) {
  const s = Math.max(0, idx(start || 'A1'));
  /** @type {LevelState[]} */ const out = [];
  LEVELS.forEach((lv, i) => {
    const mine = items.filter(it => it.lv === lv);
    const seenN = mine.filter(it => cards[it.id]?.reps).length;
    const learntN = mine.filter(it => learnt(cards[it.id])).length;
    const steady = mine.length > 0 && learntN / mine.length >= STEADY - 1e-9;
    const prev = out[i - 1];
    const chosen = i <= s;
    out.push({ lv, n: mine.length, seen: seenN, learnt: learntN, steady, chosen, open: chosen || !!(prev && prev.open && prev.steady) });
  });
  return out;
}

/**
 * The start level in effect: the one he chose, or his profile level when that is higher, so a B1 learner finds every
 * level up to B1 open from the first visit (levels above it still open at STEADY of the one before).
 * @param {string | null | undefined} chosen @param {string | null | undefined} level settings.level
 */
export function startFor(chosen, level) {
  const a = idx(chosen || 'A1'), b = level ? idx(level) : -1;
  return LEVELS[Math.max(0, a, b)];
}

/** The levels whose new items can be shown. @param {LevelState[]} states */
export const openLevels = states => new Set(states.filter(x => x.open).map(x => x.lv));

/**
 * New items in the order they come: the start level first, then the open levels above it, then the open levels below
 * it (easy wins after a jump), each by how common and then the bank's order.
 * @param {Item[]} items @param {Record<string, any>} cards @param {string | null | undefined} start @param {Set<string>} open
 */
export function newOrder(items, cards, start, open) {
  const s = Math.max(0, idx(start || 'A1'));
  const rank = (/** @type {string} */ lv) => { const i = idx(lv); return i >= s ? i - s : LEVELS.length + (s - i); };
  const pos = new Map(items.map((it, i) => [it.id, i]));
  return items.filter(it => open.has(it.lv) && !cards[it.id]?.reps)
    .sort((a, b) => rank(a.lv) - rank(b.lv) || a.freq - b.freq || /** @type {number} */ (pos.get(a.id)) - /** @type {number} */ (pos.get(b.id)));
}

/* ------------------------------------------------------------------ */
/* A round                                                             */
/* ------------------------------------------------------------------ */

/** @param {Item} it @param {Pick} pick */
const inPick = (it, pick) => pick.kind === 'mixed' || (pick.kind === 'level' ? it.lv === pick.lv : it.fn === pick.fn);

/** "mixed" | "level:B1" | "fn:decline" → a Pick (unknown → mixed). @param {string | null | undefined} s */
export function parsePick(s) {
  const [k, v] = String(s || '').split(':');
  if (k === 'level' && idx(v) >= 0) return /** @type {Pick} */ ({ kind: 'level', lv: v });
  if (k === 'fn' && /^[a-z]+$/.test(v || '')) return /** @type {Pick} */ ({ kind: 'fn', fn: v });
  return /** @type {Pick} */ ({ kind: 'mixed' });
}
/** @param {Pick} p */
export const pickKey = p => (p.kind === 'level' ? `level:${p.lv}` : p.kind === 'fn' ? `fn:${p.fn}` : 'mixed');

/** Reorder so the same function never comes twice in a row when it can be avoided (stable otherwise). @param {Item[]} list */
export function interleave(list) {
  const rest = [...list], out = [];
  while (rest.length) {
    const last = out[out.length - 1];
    const k = rest.findIndex(it => !last || it.fn !== last.fn);
    out.push(rest.splice(k < 0 ? 0 : k, 1)[0]);
  }
  return out;
}

/**
 * The cards of a new round.
 *   due:   items of the pick that are due (open level or not: a card once seen keeps its schedule), oldest due first
 *   new:   items not seen yet in open levels, in newOrder; the mixed round takes at most newLeft (the day's budget),
 *          a level or function round at most PICK_NEW (none when the clock allows no new items)
 *   extra: when nothing is due or new, seen items not reviewed today, least well known first (practice ahead)
 * @param {object} o
 * @param {Item[]} o.items @param {Record<string, any>} o.cards @param {any} o.c clock context @param {Pick} o.pick
 * @param {string | null | undefined} o.start @param {number} o.newLeft @param {number} [o.size]
 * @returns {{ids: string[], due: number, fresh: number, extra: boolean}}
 */
export function compose({ items, cards, c, pick, start, newLeft, size = ROUND_SIZE }) {
  const open = openLevels(levelStates(items, cards, start));
  const pool = items.filter(it => inPick(it, pick));
  const due = pool.filter(it => cards[it.id]?.reps && isDue(cards[it.id], c.today, c))
    .sort((a, b) => String(cards[a.id].due).localeCompare(String(cards[b.id].due)) || idx(a.lv) - idx(b.lv)).slice(0, size);
  const cap = !c.newItems ? 0 : pick.kind === 'mixed' ? Math.max(0, newLeft) : PICK_NEW;
  const fresh = newOrder(pool, cards, start, open).slice(0, Math.max(0, Math.min(cap, size - due.length)));
  if (due.length + fresh.length) return { ids: interleave([...due, ...fresh]).map(it => it.id), due: due.length, fresh: fresh.length, extra: false };
  const extra = pool.filter(it => cards[it.id]?.reps && cards[it.id].last !== c.today)
    .sort((a, b) => FS.Ron(cards[a.id], c.today) - FS.Ron(cards[b.id], c.today)).slice(0, size);
  return { ids: interleave(extra).map(it => it.id), due: 0, fresh: 0, extra: extra.length > 0 };
}

/** @param {string[]} ids @param {Pick} pick @param {string} today @param {number} now */
export function startRound(ids, pick, today, now) {
  return { id: now, pick: pickKey(pick), day: today, startedAt: now, queue: ids.map(id => ({ id })), i: 0, planned: ids.length,
    results: /** @type {{id: string, g: number, first: boolean, isNew: boolean, ms: number}[]} */ ([]) };
}

/** A saved round can go on the same study day, within 6 hours, while cards are left. @param {any} r @param {string} today @param {number} now */
export const resumable = (r, today, now) => !!(r && Array.isArray(r.queue) && r.day === today && now - r.startedAt <= 6 * 3600e3 && r.i < r.queue.length);

/**
 * One self-grade through the shared scheduler. Easy on a card never seen graduates it at once (it skips the second
 * learning step); everything else is FSRS as the B1 trainer runs it, with mode 's' (spoken).
 * @param {{rec: any, g: 1|2|3|4, c: any, now: number, ms?: number, forecast?: (d: string) => number, src?: string}} o
 * @returns {{rec: any, reinsert: null | 'learn' | 'lapse', wrote: boolean}}
 */
export function gradeCard({ rec, g, c, now, ms = 0, forecast = () => 0, src = 'speech' }) {
  const ctx = { ...c, forecast };
  const res = FS.schedule(rec, { g, ms, onTime: g >= 3, flags: '', mode: 's', src }, ctx, now);
  if (g === 4 && res.reinsert === 'learn' && res.rec && (!rec || !rec.reps)) {
    return { rec: { ...res.rec, learn: null, due: FS.dueFor(res.rec.S, ctx) }, reinsert: null, wrote: res.wrote };
  }
  return res;
}

/**
 * What each button would do, for the captions under them: null = back in this round, else days until the card is due.
 * @param {any} rec @param {any} c @param {number} now @param {(d: string) => number} [forecast]
 * @returns {(number | null)[]} for Again, Hard, Good, Easy
 */
export function preview(rec, c, now, forecast) {
  return /** @type {(1|2|3|4)[]} */ ([1, 2, 3, 4]).map(g => {
    const r = gradeCard({ rec: rec ? structuredClone(rec) : null, g, c, now, forecast });
    if (r.reinsert || !r.rec) return null;
    return Math.max(1, D8.diff(c.today, r.rec.due));
  });
}

/**
 * Record a grade in the round: the result, and a reinsertion for Again and learning steps (+3 cards, then +6; at most
 * three showings of a card per round). Mutates round; returns whether the card comes back.
 * @param {any} round @param {{id: string, g: number, isNew: boolean, ms: number, reinsert: string | null}} r
 */
export function record(round, { id, g, isNew, ms, reinsert }) {
  const q = round.queue[round.i];
  round.results.push({ id, g, first: !q?.re, isNew: !!isNew && !q?.re, ms: Math.round(Math.min(ms || 0, 120000)) });
  const times = round.queue.filter((/** @type {any} */ x) => x.id === id).length;
  if (!reinsert || times >= 3) return false;
  const at = Math.min(round.queue.length, round.i + 1 + (times === 1 ? 3 : 6));
  round.queue.splice(Math.max(round.i + 1, at), 0, { id, re: true });
  return true;
}

/** Move on; true while a card is left. @param {any} round */
export function advance(round) { round.i++; return round.i < round.queue.length; }

/**
 * The current run of Good/Easy answers, counted back from the last result.
 * @param {any} round
 */
export function streak(round) {
  let n = 0;
  for (let k = round.results.length - 1; k >= 0 && round.results[k].g >= 3; k--) n++;
  return n;
}

/**
 * What the done screen shows: each situation once, with its first grade, in the order met.
 * @param {any} round @param {Map<string, Item>} byId
 */
export function summary(round, byId) {
  /** @type {Map<string, {item: Item, g: number, last: number}>} */ const seen = new Map();
  for (const r of round.results) {
    const item = byId.get(r.id);
    if (!item) continue;
    const cur = seen.get(r.id);
    if (!cur) seen.set(r.id, { item, g: r.g, last: r.g }); else cur.last = r.g;
  }
  const list = [...seen.values()];
  const by = (/** @type {number} */ g) => list.filter(x => x.g === g).length;
  return { list, total: list.length, counts: { again: by(1), hard: by(2), good: by(3), easy: by(4) },
    fresh: round.results.filter((/** @type {any} */ r) => r.isNew).length, cards: round.results.length,
    ms: round.results.reduce((/** @type {number} */ a, /** @type {any} */ r) => a + (r.ms || 0), 0) };
}

/* ------------------------------------------------------------------ */
/* Counts for Today and the hub                                        */
/* ------------------------------------------------------------------ */

/**
 * Due cards in deck 'speak' (only SS: ids count; due dates capped for the exam as everywhere).
 * @param {Record<string, any>} cards @param {any} c
 */
export const dueCount = (cards, c) => Object.entries(cards || {}).filter(([id, r]) => id.startsWith(PREFIX) && isDue(r, c.today, c)).length;

/**
 * The stats Today reads without loading the bank: unseen items in open levels.
 * @param {Item[]} items @param {Record<string, any>} cards @param {string | null | undefined} start @param {any} c
 */
export function stats(items, cards, start, c) {
  const open = openLevels(levelStates(items, cards, start));
  return { day: c.today, unseen: items.filter(it => open.has(it.lv) && !cards[it.id]?.reps).length, total: items.length };
}

/** Today's day log, a fresh one on a new study day. @param {any} sim kv 'speak.sim' @param {string} today */
export const dayOf = (sim, today) => (sim && sim.day && sim.day.day === today ? sim.day : { day: today, newShown: 0, rounds: 0 });

/**
 * Segment states for the kit's segments(): one per card in the queue; results are in queue order, Again is a miss.
 * @param {any} round @param {boolean} [answered] the current card has its grade
 */
export function dots(round, answered = false) {
  return round.queue.map((/** @type {any} */ _q, /** @type {number} */ k) => {
    if (k === round.i && !answered) return 'now';
    const r = round.results[k];
    if (k > round.i || !r) return '';
    return r.g === 1 ? 'miss' : 'done';
  });
}
