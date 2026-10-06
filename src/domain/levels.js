/* The per-strand level gate (round 4, lane L1b; CONTENT-INPUT-PLAN §4): when items of the next level (the B2 layer)
   join a learner's new items. Pure, no storage or clock reads; tested in node (tests/unit/levels.test.mjs).

   Strands: grammar ('g', area grammar), phrases ('p', phrase items) and words ('w', area words). Each strand opens on
   its own, by how much of the B1 pool's items of that strand he has seen:
     seen = an item with a card he has answered, or one he marked known; the items counted are those the B1 pool can
     introduce as new (features/shared/compose.js newOrder's eligible items, mistakes and Schreiben left out)
     under GATE_MIX (50 %) seen     closed: no B2 items among his new items (consolidate first)
     GATE_MIX to GATE_OPEN (80 %)   mix:    1 in MIX_EVERY (4) new items of the strand is a B2 item
     GATE_OPEN or more              open:   B2 first, B1 leftovers spread through (1 in OPEN_B1_EVERY, 3)
     a strand with no B1 items      open (there is nothing at B1 to consolidate)
   The gate is shut for every strand unless the active course has a level goal of B2 or above (goal.level; a goal of
   C1 or C2 opens the B2 layer, the only one with content). A course whose own level is B2 or above has the layer at
   its level: every strand is open.
   Paused inside an exam window (phases week, lastNew, eve, day) when the exam is below the layer (a Goethe B1 exam):
   B2 new items wait until after the exam. An exam at B2 or above never pauses it. Reviews of B2 cards already made are
   never gated: they come due in the daily round like any card.
   The B2 layer's items carry layer: 'b2' (features/shared/pool.js) and are kept out of everything that measures the B1
   pool: readiness (domain/b1ready.js), the ★/trap pace (compose.js priorityLeft) and the grader's lexicon. */

export const LEVELS = /** @type {const} */ (['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
/** The layer the gate opens (its items' `layer`). */
export const LAYER = 'b2';
/** The level of that layer. */
export const LAYER_LEVEL = 'B2';
/** Share of the strand's B1 items seen at which 1 in MIX_EVERY new items of the strand is a B2 item. */
export const GATE_MIX = 0.5;
/** Share of the strand's B1 items seen at which the B2 layer is open (B2 first). */
export const GATE_OPEN = 0.8;
/** mix: one new item in this many of the strand is a B2 item. */
export const MIX_EVERY = 4;
/** open: one new item in this many of the strand is a B1 leftover. */
export const OPEN_B1_EVERY = 3;
export const STRANDS = /** @type {const} */ (['g', 'p', 'w']);
/** @typedef {typeof STRANDS[number]} Strand */
/** @typedef {'closed' | 'mix' | 'open'} StrandState */
/**
 * @typedef {object} StrandGate
 * @property {StrandState} state
 * @property {number} n      the strand's B1 items that count
 * @property {number} seen   of them, seen
 * @property {number} share  seen ÷ n (1 without items)
 */
/**
 * @typedef {object} Gate
 * @property {string | null} level  the layer's level when the goal reaches it ('B2'), else null
 * @property {boolean} paused       inside the window of an exam below the layer
 * @property {'noGoal' | 'examWindow' | null} reason  why every strand is closed (null when the strands decide)
 * @property {Record<Strand, StrandGate>} strands
 */

/** A level's place in LEVELS (-1 when it is none of them). @param {unknown} l */
export const levelIndex = l => LEVELS.indexOf(/** @type {any} */ (String(l || '').toUpperCase()));

/**
 * The strand an item belongs to, or null (mistakes, Schreiben, reading items, situations …).
 * @param {{area?: string, kind?: string, mine?: boolean} | null | undefined} it @returns {Strand | null}
 */
export function strandOf(it) {
  if (!it || it.mine || it.area === 'mistakes' || it.area === 'writing') return null;
  if (it.area === 'grammar') return 'g';
  if (it.area === 'words') return 'w';
  if (it.kind === 'phrase') return 'p';
  return null;
}

/** The level an exam id names ('goethe-b1' → 'B1', 'telc-b2' → 'B2'), or null. @param {unknown} id */
export function examLevel(id) {
  const m = /(?:^|[-_.])([abc][12])(?:$|[-_.])/i.exec(String(id || ''));
  return m ? m[1].toUpperCase() : null;
}

/**
 * What the gate reads from settings: the active course's level goal, its exam and its own level.
 * @param {any} settings normalised settings @returns {{goal: string | null, exam: string | null, level: string | null}}
 */
export function courseGoal(settings) {
  const list = settings && Array.isArray(settings.courses) ? settings.courses : [];
  const c = list.find((/** @type {any} */ x) => x && x.id === settings.activeCourse);
  if (!c) return { goal: null, exam: settings?.exam?.type ?? null, level: settings?.level ?? null };
  return { goal: c.goal?.level ?? null, exam: c.goal?.exam ?? null, level: c.level ?? null };
}

/**
 * Each strand's B1 items and how many he has seen.
 * @template T
 * @param {T[]} items the B1 pool's items that can be introduced (no B2 layer)
 * @param {(it: T) => boolean} seen @param {(it: T) => Strand | null} [strand]
 * @returns {Record<Strand, {n: number, seen: number}>}
 */
export function gateCounts(items, seen, strand = /** @type {any} */ (strandOf)) {
  /** @type {Record<Strand, {n: number, seen: number}>} */ const out = { g: { n: 0, seen: 0 }, p: { n: 0, seen: 0 }, w: { n: 0, seen: 0 } };
  for (const it of items) {
    const k = strand(it);
    if (!k) continue;
    out[k].n++;
    if (seen(it)) out[k].seen++;
  }
  return out;
}

/** A strand's state from its coverage. @param {number} seen @param {number} n @returns {StrandState} */
export function strandState(seen, n) {
  if (n <= 0) return 'open';
  const share = seen / n;
  return share >= GATE_OPEN ? 'open' : share >= GATE_MIX ? 'mix' : 'closed';
}

const WINDOW = new Set(['week', 'lastNew', 'eve', 'day']);

/**
 * The gate (see the header).
 * @param {object} o
 * @param {string | null | undefined} o.goal     the course's level goal (goal.level)
 * @param {string | null | undefined} [o.exam]   the course's exam id (goal.exam)
 * @param {string | null | undefined} [o.level] the course's own level
 * @param {string} o.phase                        the clock's phase (core/clock.js: 'none' before the exam window)
 * @param {Record<Strand, {n: number, seen: number}>} o.counts  gateCounts()
 * @returns {Gate}
 */
export function levelGate({ goal, exam = null, level = null, phase, counts }) {
  const L = levelIndex(LAYER_LEVEL);
  const reached = levelIndex(goal) >= L;
  const paused = reached && WINDOW.has(phase) && levelIndex(examLevel(exam) ?? 'B1') < L;
  const atLevel = levelIndex(level) >= L;
  /** @type {any} */ const strands = {};
  for (const k of STRANDS) {
    const { n, seen } = counts[k] || { n: 0, seen: 0 };
    const share = n ? seen / n : 1;
    strands[k] = { state: !reached || paused ? 'closed' : atLevel ? 'open' : strandState(seen, n), n, seen, share: Math.round(share * 1000) / 1000 };
  }
  return { level: reached ? LAYER_LEVEL : null, paused, reason: !reached ? 'noGoal' : paused ? 'examWindow' : null, strands };
}

/** Whether the gate lets any B2 item in. @param {Gate | null | undefined} g */
export const gateOpen = g => !!g && STRANDS.some(k => g.strands[k].state !== 'closed');

/**
 * The new-item order with the B2 layer mixed in, strand by strand (see the header). b1 is the B1 order as it was; b2
 * the layer's unseen items in their own order. Items of a closed strand are left out. Without an open strand the B1
 * order is returned as it is.
 * @template T
 * @param {T[]} b1 @param {T[]} b2 @param {Gate | null | undefined} gate @param {(it: T) => Strand | null} [strand]
 * @returns {T[]}
 */
export function mixLayers(b1, b2, gate, strand = /** @type {any} */ (strandOf)) {
  if (!b2.length || !gateOpen(gate)) return b1;
  const g = /** @type {Gate} */ (gate);
  /** @type {Record<Strand, T[]>} */ const q = { g: [], p: [], w: [] };
  for (const it of b2) { const k = strand(it); if (k && g.strands[k].state !== 'closed') q[k].push(it); }
  /** @type {Record<Strand, number>} */ const count = { g: 0, p: 0, w: 0 };
  // the next place in the strand (1-based) is a B2 item's: every MIX_EVERY-th in mix, all but every OPEN_B1_EVERY-th open
  const b2Next = (/** @type {Strand} */ k) => { const pos = count[k] + 1; return g.strands[k].state === 'mix' ? pos % MIX_EVERY === 0 : pos % OPEN_B1_EVERY !== 0; };
  /** @type {T[]} */ const out = [];
  for (const it of b1) {
    const k = strand(it);
    if (k) {
      while (q[k].length && b2Next(k)) { out.push(/** @type {T} */ (q[k].shift())); count[k]++; }
      count[k]++;
    }
    out.push(it);
  }
  for (const k of STRANDS) out.push(...q[k]);
  return out;
}
