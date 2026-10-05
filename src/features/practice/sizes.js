/* The round size picker's lists: for a round address, the list it draws from (domain/roundsize.js Buckets), what
   Recommended is (the list's own composer, so Recommended is exactly the round that starts without the picker), and
   whether a round of it is paused. picker.js draws the sheet from this; the runners (round.js, sim-view.js,
   script/words.js) build a custom or "all" round from the same buckets.

   Lists with a picker: B1 areas and grammar topics, Schreiben (all or one Aufgabe), missed items, mistakes from
   corrections, exam words, word clusters (one cluster, or the due ones), speaking situations (mixed, a level, a
   function: the Sprechen Teil groups) and a script's words. Not: the daily round and the warm-up (Today's and the hub's
   one tap), a round of items picked on the map, Quick sort. */
import * as RS from '../../domain/roundsize.js';
import { ROUND, ROUND_MIN } from '../../domain/budget.js';

/** Minutes for n typed questions: a round of 12 is about 4 minutes (domain/budget.js). @param {number} n */
const roundMinutes = n => Math.max(1, Math.ceil((n * ROUND_MIN) / ROUND - 1e-9));
import * as C from './compose.js';
import * as S from './session.js';
import { loadData, stateFor, session } from './data.js';

/** Round kinds of round.js that take a size. @param {{kind: string, topic?: string | null}} spec */
export const sizedKind = spec => ['area', 'topic', 'write', 'missed', 'mistakes'].includes(spec.kind) || (spec.kind === 'cluster' && !/^pick:/.test(String(spec.topic || '')));

/**
 * The list behind a round address, or null when the address has no picker.
 * @param {string} href "#/practice/round?kind=area:grammar", "#/practice/situations/round?pick=fn:decline", …
 * @returns {{runner: 'round' | 'sim' | 'script', type: string, query: URLSearchParams} | null}
 */
export function listOf(href) {
  const m = /^#\/practice\/(round|situations\/round)(?:\?(.*))?$/.exec(String(href || ''));
  if (!m) return null;
  const q = new URLSearchParams(m[2] || '');
  if (q.get('size')) return null;
  if (m[1] === 'situations/round') return { runner: 'sim', type: 'situations', query: q };
  const kind = q.get('kind') || '';
  if (/^script:/.test(kind)) return kind === 'script:words' ? null : { runner: 'script', type: 'script', query: q };
  if (/^cluster:/.test(kind)) return kind === 'cluster:pick' ? null : { runner: 'round', type: 'cluster', query: q };
  const spec = C.parseKind(kind);
  if (!sizedKind(spec)) return null;
  return { runner: 'round', type: spec.kind === 'area' && spec.area === 'words' ? 'words' : spec.kind, query: q };
}

/**
 * @typedef {object} ListInfo
 * @property {string} type       the list type the choice is remembered for
 * @property {string} title
 * @property {RS.Buckets} b
 * @property {string[]} rec      Recommended's ids
 * @property {(n: number, fresh: number) => number} minutes
 * @property {number | null} paused  questions left in a paused round of this list (the tap resumes it), else null
 */

/**
 * @param {import('../contract.js').ViewCtx} ctx @param {string} href
 * @returns {Promise<ListInfo | null>}
 */
export async function listInfo(ctx, href) {
  const l = listOf(href);
  if (!l) return null;
  const { t, store } = ctx;
  const c = ctx.clock.ctx();
  if (c.phase === 'day') return null;   // the exam day: every round is the warm-up
  const kind = l.query.get('kind') || '';
  if (l.runner === 'round' && l.type === 'cluster') {
    const { loadClusters, dueCards, recallOf, DECK } = await import('./clusters/data.js');
    const CI = await import('./clusters/items.js');
    const { marked } = await import('../../data/known.js');
    const { skipsNew } = await import('../../domain/known.js');
    const { isDue } = await import('../../domain/b1ready.js');
    const data = await loadClusters(ctx);
    const ck = CI.parseClusterKind(kind);
    if (!ck) return null;
    const cl = ck.key ? data.ix.byKey.get(ck.key) : null;
    if (ck.key && !cl) return null;
    const cards = store.cards(DECK) || {}, mk = marked(store);
    const o = { ids: cl ? CI.cardIds(cl, data.ix) : dueCards(store, c), cards, c, isDue: (/** @type {any} */ r) => isDue(r, c.today, c), recall: recallOf(c), skip: (/** @type {string} */ id) => skipsNew(mk, id), zipf: CI.zipfOf(data.ix) };
    let rec = CI.compose(o).ids;
    if (ck.due) rec = rec.filter(id => cards[id]?.reps);
    const b = CI.buckets(o);
    if (ck.due) { b.fresh = []; b.rest = []; }
    const saved = S.savedRound(session(store), S.slotKey({ kind: 'cluster', topic: ck.key || 'due' }));
    return { type: 'cluster', title: cl ? cl.label : t('practice.clusters.title'), b, rec, minutes: n => roundMinutes(n), paused: S.resumable(saved, c.today, Date.now()) ? saved.queue.length - saved.i : null };
  }
  if (l.runner === 'round') {
    const data = await loadData(ctx);
    const st = stateFor(ctx, data);
    const spec = C.parseKind(kind);
    const saved = S.savedRound(session(store), S.slotKey(spec));
    const title = spec.kind === 'area' ? t(`practice.area.${spec.area}`) : spec.kind === 'topic' ? (data.topics.get(spec.topic)?.name || t('practice.kind.topic'))
      : spec.kind === 'write' ? (spec.topic ? `Schreiben ${spec.topic.replace('W', 'Aufgabe ')}` : 'Schreiben') : spec.kind === 'missed' ? t('practice.kind.missedTitle') : t('practice.kind.mistakesTitle');
    return { type: l.type, title, b: C.buckets(st, spec), rec: C.compose(st, spec), minutes: n => roundMinutes(n), paused: S.resumable(saved, c.today, Date.now()) ? saved.queue.length - saved.i : null };
  }
  if (l.runner === 'sim') {
    const SM = await import('./sim.js');
    const { loadBank, simState, simCards } = await import('./sim-data.js');
    const { simToday } = await import('./plan.js');
    const bank = await loadBank(ctx);
    const pick = SM.parsePick(l.query.get('pick'));
    const sim = simState(store), settings = ctx.settings();
    const o = { items: bank.items, cards: simCards(store), c, pick, start: SM.startFor(sim.start, settings.level), newLeft: simToday({ store, c, settings }).newLeft };
    const title = pick.kind === 'level' ? `${t('practice.sim')} · ${pick.lv}` : pick.kind === 'fn' ? (bank.bank.functions?.[pick.fn] || pick.fn) : t('practice.sim');
    const paused = SM.resumable(sim.round, c.today, Date.now()) && sim.round.pick === SM.pickKey(pick) ? sim.round.queue.length - sim.round.i : null;
    // a situation card takes about 12 s, a new one comes twice (domain/budget.js SIM_CARD_MIN)
    return { type: 'situations', title, b: SM.buckets(o), rec: SM.compose(o).ids, minutes: (n, fresh) => Math.max(1, Math.ceil((n + fresh) * 0.2)), paused };
  }
  // a script's words
  const St = await import('./script/store.js');
  const P = await import('./script/plan.js');
  const { todayBudget } = await import('./plan.js');
  const script = St.get(store, kind.slice('script:'.length));
  if (!script) return null;
  const cards = St.cardOf(store);
  let dayLeft = Infinity;
  try { dayLeft = todayBudget({ store, c, settings: ctx.settings(), t, exam: null }).newLeft; } catch { /* the script's own cap holds */ }
  const allowed = P.newAllowed(script, St.progress(store, script.id), c.today, { newItems: c.newItems !== false, dayLeft });
  const ws = P.words(script, cards, c);
  const rec = [...ws.due, ...ws.fresh.slice(0, allowed)].slice(0, 12);
  return { type: 'script', title: script.title || t('practice.script.words.title'), b: P.wordBuckets(script, cards, c, allowed), rec, minutes: n => roundMinutes(n), paused: null };
}

/** The remembered choices, per list type, on this device (localStorage; it may be missing or blocked). */
const KEY = 'fluentish.roundSize';
/** @returns {Record<string, {mode: string, n: number}>} */
export function remembered() {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
/** @param {string} type @param {{mode: string, n: number}} choice */
export function remember(type, choice) {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...remembered(), [type]: { mode: choice.mode, n: choice.n } })); } catch { /* private mode */ }
}

/** The address that starts a round of a size. @param {string} href @param {'rec' | 'all' | number} size */
export const sizedHref = (href, size) => `${href}${href.includes('?') ? '&' : '?'}size=${RS.sizeKey(size)}`;
