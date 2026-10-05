/* Word building: what opens when, the order of new items, the rounds and the 60-second game. Pure (no DOM, storage
   or clock reads); tested in node (tests/unit/build-plan.test.mjs).

   Unlock order (PREFIX-DESIGN §6):
     1. prefixes: the motion card (PX:<p>.see) of the ten core prefixes (auf, ab, ein, aus, vor, nach, an, zu, be,
        ver), at most three new a day; a prefix's say card (PX:<p>.say, the reverse) opens after its motion card's
        first Good. The other prefixes open once six core prefixes have had a first Good.
     2. verbs: a prefix's verbs (PD:) open after its first prefix card's first Good. Order: roots he knows first (the
        root verb's knowledge state, then its frequency), then literal before picture before word to learn, then up
        to B1 before the rest; never two verbs of the same root in a row, never three of the same prefix. A verb's
        typing card (PV:) opens the day after its PD card's first Good, and comes before new PD cards.
     3. sentences: the frames of a kind (separable, inseparable) open after six verbs of that kind were seen; the
        present of every open frame first, then the Perfekt, and so on. Frames of verbs missed in Split or stay come
        first.
     4. suffixes: the rule cards (SX:) open after twelve verbs were seen; a rule's words (PW:) after the rule card's
        first Good. A participle used as an adjective has no rule card and opens with the rule cards.
   New items of the day: the deck's own cap (domain/budget.js buildBudget), taken from the four streams in turn. */
import { CORE, FORMS, hasSee, pwNodes, bare } from './wordbuild.js';

/** @typedef {import('./wordbuild.js').BuildContent} BuildContent */
/** @typedef {Record<string, any>} Cards  card id → FSRS record (deck 'build') */
/** @typedef {'px'|'verbs'|'ps'|'sx'} Stream */

export const PX_PER_DAY = 3;
export const REST_GATE = 6;
export const FRAME_GATE = 6;
export const SUFFIX_GATE = 12;
export const ROUND_SIZE = 12;
export const STREAMS = /** @type {Stream[]} */ (['px', 'verbs', 'ps', 'sx']);
const LEVEL = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const GRADE = /** @type {Record<string, number>} */ ({ T: 0, M: 1, O: 2 });
const KNOW = /** @type {Record<string, number>} */ ({ known: 0, shaky: 1, unknown: 2, unseen: 3 });

/** A card that has been answered at least once. @param {any} rec */
export const seen = rec => !!(rec && rec.reps);
/** A card that has had a Good (or Easy) answer: graduated, or a 3+ in its log. @param {any} rec */
export const firstGood = rec => seen(rec) && (rec.learn == null || (rec.hist || []).some((/** @type {any[]} */ h) => h[1] >= 3));
/** The stream a card id belongs to. @param {string} id @returns {Stream | null} */
export const streamOf = id => (/^PX:/.test(id) ? 'px' : /^P[DV]:/.test(id) ? 'verbs' : /^PS:/.test(id) ? 'ps' : /^(SX|PW):/.test(id) ? 'sx' : null);

/**
 * The open new items of each stream, in order.
 * @param {object} o
 * @param {BuildContent} o.content
 * @param {Cards} o.cards
 * @param {string} o.today
 * @param {(rootId: string) => {state?: string, zipf?: number}} [o.root]   what he knows of a root verb (W:<root>.verb)
 * @param {string[]} [o.missed]   verb ids missed in Split or stay lately
 * @returns {Record<Stream, string[]>}
 */
export function openNew({ content: c, cards, today, root = () => ({}), missed = [] }) {
  const rec = (/** @type {string} */ id) => cards[id];
  const P = new Map(c.prefixes.map(p => [p.id, p]));
  const firstCard = (/** @type {string} */ p) => { const x = P.get(p); return x && hasSee(x) ? `PX:${p}.see` : `PX:${p}.say`; };
  // 1. prefixes
  /** @type {string[]} */ const px = [];
  const coreGood = CORE.filter(p => firstGood(rec(firstCard(p)))).length;
  const order = [...CORE, ...c.prefixes.map(p => p.id).filter(p => !CORE.includes(p))];
  for (const p of order) {
    const pre = P.get(p); if (!pre) continue;
    if (!CORE.includes(p) && coreGood < REST_GATE) continue;
    const see = `PX:${p}.see`, say = `PX:${p}.say`;
    if (hasSee(pre)) {
      if (!seen(rec(see))) px.push(see);
      else if (firstGood(rec(see)) && !seen(rec(say))) px.push(say);
    } else if (!seen(rec(say))) px.push(say);
  }
  // 2. verbs: typing cards of verbs met on an earlier day first, then new verbs of the open prefixes
  const openPre = new Set(c.prefixes.filter(p => firstGood(rec(firstCard(p.id)))).map(p => p.id));
  const pv = c.verbs.filter(v => { const d = rec(`PD:${v.id}`); return firstGood(d) && d.first && d.first < today && !seen(rec(`PV:${v.id}`)); })
    .sort((a, b) => String(rec(`PD:${a.id}`).first).localeCompare(String(rec(`PD:${b.id}`).first))).map(v => `PV:${v.id}`);
  const fresh = c.verbs.filter(v => openPre.has(v.pre) && !seen(rec(`PD:${v.id}`)));
  const rk = (/** @type {import('./wordbuild.js').Verb} */ v) => { const r = root(v.root) || {}; return [KNOW[r.state || 'unseen'] ?? 3, -(r.zipf || 0)]; };
  fresh.sort((a, b) => {
    const [ka, za] = rk(a), [kb, zb] = rk(b);
    return ka - kb || za - zb || GRADE[a.grade] - GRADE[b.grade] || (lv(a.level) > 2 ? 1 : 0) - (lv(b.level) > 2 ? 1 : 0) || c.verbs.indexOf(a) - c.verbs.indexOf(b);
  });
  const verbs = [...pv, ...interleave(fresh).map(v => `PD:${v.id}`)];
  // 3. sentences
  const seenKind = { s: 0, i: 0 };
  for (const v of c.verbs) if (seen(rec(`PD:${v.id}`))) seenKind[v.kind]++;
  const openFrames = c.frames.filter(f => seenKind[f.kind] >= FRAME_GATE);
  const miss = new Set(missed);
  const frames = [...openFrames.filter(f => f.verb && miss.has(f.verb)), ...openFrames.filter(f => !(f.verb && miss.has(f.verb)))];
  /** @type {string[]} */ const ps = [];
  for (const form of FORMS) for (const f of frames) {
    if (!f.forms[form]) continue;
    const id = `PS:${f.id}.${form}`;
    if (seen(rec(id))) continue;
    const before = FORMS.slice(0, FORMS.indexOf(form)).filter(x => f.forms[x]);
    if (before.every(x => seen(rec(`PS:${f.id}.${x}`)))) ps.push(id);
  }
  // 4. suffixes
  /** @type {string[]} */ const sx = [];
  if (seenKind.s + seenKind.i >= SUFFIX_GATE) {
    for (const s of c.suffixes) if (!seen(rec(`SX:${s.id}`))) sx.push(`SX:${s.id}`);
    for (const n of pwNodes(c)) {
      const id = `PW:${n.word}`;
      if (seen(rec(id))) continue;
      if (n.add === 'pp' || firstGood(rec(`SX:${n.add}`))) sx.push(id);
    }
  }
  return { px, verbs, ps, sx };
}
const lv = (/** @type {string} */ l) => { const i = LEVEL.indexOf(l); return i < 0 ? 9 : i; };

/**
 * Keep the sorted order but never two verbs of the same root in a row, never three of the same prefix: take the first
 * verb that fits, else the first one.
 * @template {{root: string, pre: string}} T @param {T[]} list @returns {T[]}
 */
export function interleave(list) {
  const left = [...list], out = /** @type {T[]} */ ([]);
  while (left.length) {
    const a = out[out.length - 1], b = out[out.length - 2];
    let k = left.findIndex(v => (!a || v.root !== a.root) && !(a && b && v.pre === a.pre && v.pre === b.pre));
    if (k < 0) k = 0;
    out.push(left.splice(k, 1)[0]);
  }
  return out;
}

/**
 * Today's new items: from the four streams in turn, at most n, and at most PX_PER_DAY prefix cards a day.
 * @param {Record<Stream, string[]>} open @param {number} n @param {{pxShown?: number, only?: Stream | null}} [o]
 */
export function pickNew(open, n, { pxShown = 0, only = null } = {}) {
  const lists = STREAMS.filter(s => !only || s === only).map(s => ({ s, ids: [...open[s]] }));
  const pxCap = Math.max(0, PX_PER_DAY - pxShown);
  /** @type {string[]} */ const out = [];
  let px = 0;
  while (out.length < n) {
    let moved = false;
    for (const l of lists) {
      if (out.length >= n) break;
      if (l.s === 'px' && px >= pxCap) continue;
      const id = l.ids.shift();
      if (!id) continue;
      out.push(id); moved = true;
      if (l.s === 'px') px++;
    }
    if (!moved) break;
  }
  return out;
}

/** New items shown today, by stream (cards first answered today). @param {Cards} cards @param {string} today */
export function shownToday(cards, today) {
  /** @type {Record<Stream, number> & {all: number}} */ const out = { px: 0, verbs: 0, ps: 0, sx: 0, all: 0 };
  for (const [id, r] of Object.entries(cards || {})) if (r && r.first === today && r.reps) { const s = streamOf(id); if (s) { out[s]++; out.all++; } }
  return out;
}

/**
 * The ids of a round. kind:
 *   'review'   due cards (lowest recall first), then today's new items, one new after every two reviews
 *   'prefixes' | 'verbs' | 'sentences' | 'suffixes'   that stream only: its due cards and its new items
 *   'drill'    "Which prefix?": the motion cards he has met (due first), else new ones
 *   'pick'     exactly the given ids (from the compass or the Table)
 * @param {object} o
 * @param {'review'|'prefixes'|'verbs'|'sentences'|'suffixes'|'drill'|'pick'} o.kind
 * @param {BuildContent} o.content @param {Cards} o.cards @param {string} o.today
 * @param {(rec: any) => boolean} o.isDue @param {(rec: any) => number} o.recall
 * @param {number} o.newLeft   new items left today (budget)
 * @param {string[]} [o.ids]   for 'pick'
 * @param {Record<Stream, string[]>} [o.open]   openNew()
 * @param {number} [o.size]
 * @returns {string[]}
 */
export function composeRound({ kind, content, cards, today, isDue, recall, newLeft, ids = [], open, size = ROUND_SIZE }) {
  const all = new Set(cardIdsOf(content));
  if (kind === 'pick') return [...new Set(ids)].filter(id => all.has(id)).slice(0, 40);
  const streamFor = /** @type {Record<string, Stream | null>} */ ({ review: null, prefixes: 'px', verbs: 'verbs', sentences: 'ps', suffixes: 'sx', drill: 'px' });
  const only = streamFor[kind] ?? null;
  const o = open || openNew({ content, cards, today });
  const due = Object.entries(cards || {}).filter(([id, r]) => all.has(id) && r && r.reps && isDue(r) && (!only || streamOf(id) === only) && (kind !== 'drill' || /\.see$/.test(id)))
    .sort((a, b) => recall(a[1]) - recall(b[1]) || a[0].localeCompare(b[0])).map(([id]) => id);
  if (kind === 'drill') {
    const met = Object.entries(cards || {}).filter(([id, r]) => /^PX:.+\.see$/.test(id) && all.has(id) && seen(r) && !due.includes(id))
      .sort((a, b) => recall(a[1]) - recall(b[1])).map(([id]) => id);
    const fresh = o.px.filter(id => /\.see$/.test(id)).slice(0, Math.max(0, newLeft));
    return [...due, ...met, ...fresh].slice(0, 8);
  }
  const shown = shownToday(cards, today);
  const fresh = pickNew(o, Math.max(0, Math.min(newLeft, size - Math.min(due.length, size))), { pxShown: shown.px, only });
  const d = due.slice(0, size);
  /** @type {string[]} */ const out = [];
  let i = 0, j = 0;
  while (i < d.length || j < fresh.length) {
    if (i < d.length) out.push(d[i++]);
    if (i < d.length) out.push(d[i++]);
    if (j < fresh.length) out.push(fresh[j++]);
  }
  return out.slice(0, size);
}

/** Every card id the content creates (wordbuild.js cardIds, as a Set-friendly list). @param {BuildContent} c */
function cardIdsOf(c) {
  /** @type {string[]} */ const out = [];
  for (const p of c.prefixes) { if (hasSee(p)) out.push(`PX:${p.id}.see`); out.push(`PX:${p.id}.say`); }
  for (const v of c.verbs) out.push(`PD:${v.id}`, `PV:${v.id}`);
  for (const f of c.frames) for (const form of FORMS) if (f.forms[form]) out.push(`PS:${f.id}.${form}`);
  for (const s of c.suffixes) out.push(`SX:${s.id}`);
  for (const n of pwNodes(c)) out.push(`PW:${n.word}`);
  return out;
}

/* ------------------------------------------------------------------ Split or stay */

/**
 * @typedef {object} GameItem
 * @property {string} id   the verb id
 * @property {string} pre @property {string} stem @property {string} word  the infinitive (without sich)
 * @property {'s'|'i'} kind @property {string} meaning  what shows under the word (a dual verb shows the reading)
 * @property {string} ex  the example sentence (shown after the answer)
 */

/**
 * The game's deck in a random order (rand: a function returning [0, 1), so tests can fix it). A dual verb shows its
 * meaning, which tells the reading: "umfahren: knock over" splits, "umfahren: drive around" stays.
 * @param {BuildContent} c @param {() => number} rand @returns {GameItem[]}
 */
export function gameDeck(c, rand) {
  const items = c.verbs.map(v => {
    const word = bare(v.inf);
    return { id: v.id, pre: v.pre, stem: word.slice(v.pre.length), word, kind: v.kind, meaning: v.dual ? v.en : v.en.split(';')[0].trim(), ex: v.ex };
  });
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}

/** Whether an answer is right: "Splits" for a separable verb, "Stays" for an inseparable one. @param {GameItem} it @param {boolean} splits */
export const gameRight = (it, splits) => (it.kind === 's') === splits;

/**
 * The game log (kv 'build.game'): one entry per game, newest last, the last 60 kept. No card is written: a speeded
 * guess (50 % by chance) is noisy evidence, so the game only feeds the sentence cards of the verbs he missed.
 * @param {{games?: {day: string, n: number, right: number, missed: string[], timed: boolean}[]} | null} log
 * @param {{day: string, n: number, right: number, missed: string[], timed: boolean}} game
 */
export function logGame(log, game) {
  const games = [...((log && log.games) || []), game].slice(-60);
  return { ...(log || {}), games };
}

/** Verbs missed in the games of the last three days (newest first, each once). @param {any} log @param {string} today @param {(a: string, b: string) => number} diff */
export function recentMisses(log, today, diff) {
  /** @type {string[]} */ const out = [];
  for (const g of [...((log && log.games) || [])].reverse()) if (diff(g.day, today) <= 3) for (const id of g.missed || []) if (!out.includes(id)) out.push(id);
  return out;
}

/** Whether a game was played today. @param {any} log @param {string} today */
export const playedToday = (log, today) => ((log && log.games) || []).some((/** @type {any} */ g) => g.day === today);
