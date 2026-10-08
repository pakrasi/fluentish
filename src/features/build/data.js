/* Word building: loading and saving. The only module of the feature that touches the store, the content or the
   settings; everything it calls is pure (domain/wordbuild*.js, domain/budget.js, domain/fsrs.js).

   Writes:
     cards 'build'   one FSRS record per card (the one review schedule, its own deck)
     kv 'build'      { calib: [{id, guess, truth, day}] (the derivability guesses, logged, never graded), rounds: {day, n} }
     kv 'build.game' Split or stay: { games: [{day, n, right, missed, timed}], untimed } (no card is ever written)
     kv 'build.family', 'build.reports'  Today's family and reported words: family-data.js
     settings        practice.buildNew (the deck's daily cap) through data/settings.js setSetting
   and appends card.reviewed events (deck 'build'). */
import * as FS from '../../domain/fsrs.js';
import * as RD from '../../domain/b1ready.js';
import * as D8 from '../../domain/days.js';
import { dayAllowance } from '../../domain/allowance.js';
import { DECK, bare, lemmaMaps, itemResolver } from '../../domain/wordbuild.js';
import { openNew, shownToday, recentMisses } from '../../domain/wordbuild-plan.js';
import { splitMisses } from '../../domain/wordbuild-family.js';
import { lexiconOf } from '../../domain/wordbuild-grade.js';
import { loadKnowledge } from '../../data/knowledge.js';
import { setSetting } from '../../data/settings.js';

export const KV = 'build';
export const GAME = 'build.game';

/** @type {Promise<any> | null} */ let memo = null;

/** The content and its indexes (once a session). @param {{content: any}} ctx */
export function loadContent(ctx) {
  if (!memo) {
    memo = Promise.all([ctx.content.load('build.de'), ctx.content.load('igloo.words.de').catch(() => [])]).then(([c, words]) => {
      const byId = new Map((words || []).map((/** @type {any} */ w) => [w.id, w]));
      const P = new Map(c.prefixes.map((/** @type {any} */ p) => [p.id, p]));
      const R = new Map(c.roots.map((/** @type {any} */ r) => [r.id, r]));
      const V = new Map(c.verbs.map((/** @type {any} */ v) => [v.id, v]));
      const F = new Map(c.frames.map((/** @type {any} */ f) => [f.id, f]));
      const S = new Map(c.suffixes.map((/** @type {any} */ s) => [s.id, s]));
      const maps = lemmaMaps(c);
      return { c, words: words || [], byId, P, R, V, F, S, resolve: itemResolver(maps), lex: lexiconOf(c), zipf: (/** @type {string} */ id) => (byId.get(id) || {}).zipf || 0 };
    });
    memo.catch(() => { memo = null; });
  }
  return memo;
}

/** @param {any} store @returns {Record<string, any>} */
export const cardsOf = store => store.cards(DECK) || {};

/** The knowledge score (every deck, Igloo, exam words): roots he knows, prefix concepts. @param {any} ctx */
export const knowledge = ctx => loadKnowledge(ctx);

/** Verbs of a root and a prefix, separable reading first. @param {any} d @param {string} root @param {string} pre */
export const verbsFor = (d, root, pre) => d.c.verbs.filter((/** @type {any} */ v) => v.root === root && v.pre === pre).sort((/** @type {any} */ a, /** @type {any} */ b) => (a.kind === 's' ? -1 : 1) - (b.kind === 's' ? -1 : 1));

/**
 * Today's state: due cards, what is open, the budget (Word building's share of the day's one allowance,
 * domain/allowance.js; the open count is written to kv 'build'.stats first, so the allowance reads it).
 * @param {any} ctx @param {any} d loadContent() @param {any} [k] knowledge (for the order of new verbs)
 */
export function today(ctx, d, k = null) {
  const c = ctx.clock.ctx();
  const cards = cardsOf(ctx.store);
  const known = new Set(Object.keys(cards));
  const dueIds = Object.entries(cards).filter(([id, r]) => r && r.reps && RD.isDue(r, c.today, RD.sideCap(c)) && known.has(id)).map(([id]) => id);
  const game = ctx.store.get(GAME, null);
  const root = (/** @type {string} */ id) => { const r = d.R.get(id); const s = k && r ? k.get(`W:${r.lemma}`) : null; return { state: s ? s.state : 'unseen', zipf: r ? d.zipf(r.lemma) : 0 }; };
  // verbs whose split he missed (Split or stay, Today's family): their sentence cards come first
  const missed = [...new Set([...splitMisses(ctx.store.get('build.family', null), c.today, D8.diff), ...recentMisses(game, c.today, D8.diff)])];
  const open = openNew({ content: d.c, cards, today: c.today, root, missed });
  const unseen = open.px.length + open.verbs.length + open.ps.length + open.sx.length;
  const shown = shownToday(cards, c.today);
  writeStats(ctx.store, c.today, unseen);
  const x = dayAllowance({ store: ctx.store, c, settings: ctx.settings() }).decks.build;
  const newLeft = Math.min(x.newLeft, unseen);
  const n = dueIds.length + newLeft;
  const budget = { newPerDay: x.newPerDay, newLeft, due: dueIds.length, n, rounds: n ? Math.ceil(n / 12) : 0, minutes: x.minutes, paused: x.paused };
  return { c, cards, dueIds, open, shown, budget };
}

/** kv 'build'.stats: the new cards open today (the allowance reads it). @param {any} store @param {string} today @param {number} open */
function writeStats(store, today, open) {
  const cur = (store.get('build', {}) || {}).stats;
  if (!cur || cur.day !== today || cur.open !== open) store.update('build', (/** @type {any} */ s) => ({ ...(s || {}), stats: { day: today, open } }), {});
}

/** isDue and recall for the composer. @param {any} c clock ctx */
export const dueFns = c => ({ isDue: (/** @type {any} */ r) => RD.isDue(r, c.today, RD.sideCap(c)), recall: (/** @type {any} */ r) => FS.Ron(r, c.today) });

/** The time zone for card.reviewed ctx. */
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/**
 * Save one answer: schedule the card (FSRS, the exam rules in its context), write it and its card.reviewed event.
 * study: a new item shown before any answer (Today's family shows it after three tries): its learning steps start, no
 * lapse (domain/fsrs.js, flag v).
 * @param {any} ctx @param {{id: string, g: 1|2|3|4, ms?: number, flags?: string, mode?: string, study?: boolean}} a
 * @returns {{rec: any, reinsert: null | 'learn' | 'lapse', before: any}}
 */
export function saveAnswer(ctx, { id, g, ms = 0, flags = '', mode = 't', study = false }) {
  const c = ctx.clock.ctx();
  const cards = cardsOf(ctx.store);
  const before = cards[id] ? structuredClone(cards[id]) : null;
  const fc = RD.forecast(cards, c.today, 8, RD.sideCap(c));
  const forecast = (/** @type {string} */ day) => (fc.find((/** @type {any} */ x) => x.day === day) || {}).n || 0;
  const res = FS.schedule(before, { g, ms, onTime: g >= 3, flags, mode, src: 'practice', ...(study ? { study: true } : {}) }, { ...RD.sideCap(c), forecast }, Date.now());
  if (res.rec) {
    ctx.store.putCards(DECK, [[id, res.rec]]);
    ctx.store.append('card.reviewed', { deck: DECK, itemId: id, g, ms: Math.round(ms), flags, mode, ctx: { exam: c.exam, phase: c.phase, tz: tz() },
      base: before ? { u: before.u ?? null, reps: before.reps ?? 0 } : null, post: res.rec });
  }
  return { rec: res.rec, reinsert: res.reinsert, before };
}

/**
 * When each grade would bring the card back: "This round", "1 day", "4 days" (a dry run of the scheduler).
 * @param {any} ctx @param {any} rec @param {(k: string, v?: any) => string} t
 */
export function whenFor(ctx, rec, t) {
  const c = ctx.clock.ctx();
  return [1, 2, 3, 4].map(g => {
    const r = FS.schedule(rec ? structuredClone(rec) : null, { g: /** @type {1|2|3|4} */ (g) }, { ...RD.sideCap(c) }, Date.now());
    if (!r.rec || r.reinsert) return t('build.when.round');
    const n = D8.diff(c.today, r.rec.due);
    return n <= 0 ? t('build.when.round') : t('build.when.days', { n });
  });
}

/** Log a derivability guess (PD cards): logged, never graded. @param {any} store @param {{id: string, guess: string, truth: string, day: string}} x */
export function logCalib(store, x) {
  store.update(KV, (/** @type {any} */ s) => ({ ...(s || {}), calib: [...((s && s.calib) || []), x].slice(-300) }), {});
}

/** Minutes and a round to today's activity, per device and kind (data/activity.js). */
export { addActivity } from '../../data/activity.js';

/** Count a finished round today (Today's row shows done when nothing is due). @param {any} store @param {string} day */
export function countRound(store, day) {
  store.update(KV, (/** @type {any} */ s) => { const r = (s && s.rounds && s.rounds.day === day) ? s.rounds : { day, n: 0 }; return { ...(s || {}), rounds: { day, n: r.n + 1 } }; }, {});
}

/** Rounds finished today. @param {any} store @param {string} day */
export const roundsToday = (store, day) => { const r = (store.get(KV, {}) || {}).rounds; return r && r.day === day ? r.n : 0; };

/** The deck's daily cap (Settings is the only writer of settings). @param {any} ctx @param {number} n */
export function setNewPerDay(ctx, n) {
  setSetting({ store: ctx.store, hlc: ctx.app.hlc, bus: ctx.bus }, 'practice.buildNew', n);
}

export { bare };
