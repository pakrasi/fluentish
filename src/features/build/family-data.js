/* Word families and Today's family: loading and saving (round 7). Everything it calls is pure
   (domain/wordbuild-family.js); the cards go through data.js saveAnswer, the one writer of deck 'build'.

   Writes:
     kv 'build.family'   Today's family: { days: [{ day, root, level, cards, writes, fresh, tiles, tries, done, split,
                          extras, points, ms, stats: {known, n} }], recent: [root], next: {day, root} } (domain
                          FamilyLog), the last 60 days; next is the root the done screen named for tomorrow. In the backup (rule 'family': merged by day), so a board in progress follows him.
     kv 'build.reports'  "Report this word": [{ form, root, word, day }] on this device only (never in a backup, never
                          sent anywhere); Profile › Diagnostics lists them. A reported form leaves the board.
     cards 'build'       only for a board word that is due today or new inside the allowance (saveAnswer). */
import * as F from '../../domain/wordbuild-family.js';
import { dayAllowance, todayPlan } from '../../domain/allowance.js';
import { courseGoal } from '../../domain/levels.js';
import { familyFiles, cardsOf, dueFns, saveAnswer, today as todayState } from './data.js';
import { rootEntries } from '../../domain/wordbuild-family-index.js';
import * as D8 from '../../domain/days.js';

export const FAMILY = 'build.family';
export const REPORTS = 'build.reports';

/** Each root's model, once a session: content object → root → Family. @type {WeakMap<any, Map<string, F.Family>>} */
const models = new WeakMap();

/**
 * The families of these roots (one file each, family-files.js), as models with level, frequency and examples from
 * the word list. Loads only what is not in memory; a root whose file fails is left out of the map.
 * @param {any} ctx @param {any} d loadContent() @param {string[]} roots
 * @returns {Promise<Map<string, F.Family>>}
 */
export async function familiesFor(ctx, d, roots) {
  let m = models.get(d.c);
  if (!m) { m = new Map(); models.set(d.c, m); }
  const want = [...new Set(roots)].filter(r => !(/** @type {Map<string, F.Family>} */ (m).has(r)));
  const raw = await familyFiles(ctx).some(d.c, want);
  for (const fam of raw) {
    // the root's family alone (fromFamily: the file's full shape), so no other root is built from the verbs and chains
    const one = F.familyModel({ ...d.c, families: [fam], roots: (d.c.roots || []).filter((/** @type {any} */ r) => r.id === fam.root) }, { info: infoOf(d) }).get(fam.root);
    if (one) m.set(fam.root, one);
  }
  return new Map(roots.filter(r => /** @type {Map<string, F.Family>} */ (m).has(r)).map(r => [r, /** @type {F.Family} */ (/** @type {Map<string, F.Family>} */ (m).get(r))]));
}
/** Every family (Browse by prefix or ending, the done screen's tomorrow). @param {any} ctx @param {any} d */
export const allFamilies = (ctx, d) => familiesFor(ctx, d, familyRoots(ctx, d));
/** The families in memory now, by root (no loading). @param {any} d */
export const loadedFamilies = d => models.get(d.c) || new Map();
/** What the word list says of a lemma. @param {any} d */
const infoOf = d => (/** @type {string} */ lemma) => { const w = d.byId.get(lemma); return w ? { level: w.level || null, zipf: w.zipf ?? null, ex: w.ex || null, exEn: w.exen || null } : null; };

/** The roots with a family, in the content's order (the index). @param {any} ctx @param {any} d @returns {string[]} */
export const familyRoots = (ctx, d) => familyFiles(ctx).index(d.c).map(e => String(e.root));
/** The roots as root choice reads them, from the index (no family file needed). @param {any} d */
const rootsOf = d => (d.c.familyIndex && !d.c.families ? rootEntries(d.c.familyIndex)
  : [...F.familyModel(d.c, { info: infoOf(d) }).values()].map(F.rootEntryOf));
/** The roots whose families hold these cards (a round's PF: cards), from the index. @param {any} d @param {string[]} ids */
export function rootsOfCards(d, ids) {
  const want = new Set(ids);
  return rootsOf(d).filter(r => r.forms.some(f => f.card && want.has(f.card))).map(r => r.root);
}
/** After a screen's first paint: the other family files, in idle moments (the service worker keeps them). @param {any} ctx @param {any} d */
export function warmFamilies(ctx, d) {
  const nav = /** @type {any} */ (globalThis).navigator;
  requestAnimationFrame(() => { familyFiles(ctx).warm(d.c, { saveData: !!(nav && nav.connection && nav.connection.saveData) }).catch(() => {}); });
}

/** The knowledge state of a form (the Atlas encodings): its card's item, else its word. @param {any} d @param {any} k @param {F.Form} f */
export function stateOf(d, k, f) {
  if (!k) return 'unseen';
  const item = f.card ? d.resolve(f.card) : f.lemma ? `W:${f.lemma}` : null;
  const s = item ? k.get(item) : null;
  const w = !s || s.state === 'unseen' ? (f.lemma ? k.get(`W:${f.lemma}`) : null) : null;
  return (w && w.state !== 'unseen' ? w : s)?.state || 'unseen';
}
/** Practised today (accent): the item's score says so. @param {any} d @param {any} k @param {F.Form} f */
export function todayOf(d, k, f) {
  if (!k) return false;
  const item = f.card ? d.resolve(f.card) : f.lemma ? `W:${f.lemma}` : null;
  return !!(item && k.get(item)?.today);
}

/** @param {any} store @returns {F.FamilyLog & {next?: {day: string, root: string}}} */
export const logOf = store => store.get(FAMILY, null) || { days: [], recent: [] };
/** @param {any} store @returns {{form: string, root: string, word: string, day: string}[]} */
export const reportsOf = store => { const r = store.get(REPORTS, null); return Array.isArray(r) ? r : []; };

/**
 * Today's board: the day's log, made once and kept all day (a reload and a second device find it). The root comes
 * from the index (pickRoot, no family file), then only that root's file is loaded to make the board. Null when no
 * family has a board for him today (new items paused and too few seen words), or its file cannot be loaded.
 * @param {any} ctx @param {any} d @param {any} [k] knowledge
 * @returns {Promise<F.DayLog & {stats?: {known: number, n: number}} | null>}
 */
export async function todayBoard(ctx, d, k = null) {
  const c = ctx.clock.ctx();
  const log = logOf(ctx.store);
  const have = F.dayOf(log, c.today);
  const roots = rootsOf(d);
  if (have && roots.some(r => r.root === have.root)) return have;
  const settings = ctx.settings();
  todayState(ctx, d, k);   // writes kv 'build'.stats (the open new items), which the allowance reads
  const a = dayAllowance({ store: ctx.store, c, settings });
  const b = a.decks.build;
  const g = courseGoal(settings);
  const level = g.level || g.goal || 'B1';
  const light = todayPlan({ store: ctx.store, c, settings }).kind === 'light';
  const reported = new Set(reportsOf(ctx.store).map(r => r.form));
  const o = { cards: cardsOf(ctx.store), day: c.today, level, isDue: dueFns(c).isDue, state: (/** @type {any} */ f) => stateOf(d, k, f), recent: log.recent || [], reported };
  // the root yesterday's done screen named ("Tomorrow: kommen") when it is still playable, else the day's pick
  const named = log.next && log.next.day === c.today ? F.pickRoot({ ...o, roots, root: log.next.root }) : null;
  const root = named || F.pickRoot({ ...o, roots });
  if (!root) return null;
  const fams = await familiesFor(ctx, d, [root]);
  if (!fams.has(root)) return null;
  // the A2 rule (a board of six at A1 to B1, else B1's) needs the root forced, which also keeps the index's pick
  const board = F.boardFor({ ...o, families: fams, light, newLeft: b ? b.newLeft : 0, paused: !b || b.paused || !c.newItems, root });
  if (!board) return null;
  const fam = /** @type {F.Family} */ (fams.get(board.root));
  const now = F.dayOf(logOf(ctx.store), c.today);   // made by another screen while the file loaded
  if (now) return now;
  const day = { ...F.newDay(board), stats: statsOf(d, k, fam) };
  ctx.store.update(FAMILY, (/** @type {any} */ x) => F.putDay(x, day), null);
  return day;
}

/**
 * Tomorrow's root, for the done screen's "Tomorrow: kommen": root choice run for tomorrow on the index (no file),
 * with today's root resting, kept in the log (next: {day, root}) so tomorrow's board is that root while it is playable.
 * @param {any} ctx @param {any} d @param {any} [k] knowledge
 * @returns {string | null}
 */
export function tomorrowRoot(ctx, d, k = null) {
  const c = ctx.clock.ctx();
  const day = D8.add(c.today, 1);
  const log = logOf(ctx.store);
  if (log.next && log.next.day === day) return log.next.root;
  const g = courseGoal(ctx.settings());
  const root = F.pickRoot({ roots: rootsOf(d), cards: cardsOf(ctx.store), day, level: g.level || g.goal || 'B1', isDue: (/** @type {any} */ r) => !!(r && r.due && r.due <= day),
    state: (/** @type {any} */ f) => stateOf(d, k, f), recent: log.recent || [], reported: new Set(reportsOf(ctx.store).map(r => r.form)) });
  if (!root) return null;
  ctx.store.update(FAMILY, (/** @type {any} */ x) => ({ ...(x || { days: [], recent: [] }), next: { day, root } }), null);
  return root;
}

/** Known of a family's forms ("5 of 32 known"). @param {any} d @param {any} k @param {F.Family} fam */
export function statsOf(d, k, fam) {
  return { known: fam.forms.filter(f => stateOf(d, k, f) === 'known').length, n: fam.forms.length };
}

/** Write a day's log (a clue finished, an extra word). @param {any} store @param {F.DayLog} day */
export function saveDay(store, day) {
  store.update(FAMILY, (/** @type {any} */ x) => F.putDay(x, day), null);
}

/**
 * A finished clue to the schedule: only a word that is due today, or new and inside today's allowance, writes its
 * card (data.js saveAnswer, mode g for tiles, t for typed); any other word is logged only, so the game never pulls a
 * review forward. Returns whether a card was written.
 * @param {any} ctx @param {F.DayLog} day @param {string} card
 * @param {{tries: number, shown?: boolean, splitMiss?: boolean, artMiss?: boolean, slip?: boolean, typed?: boolean, ms?: number}} o
 */
export function answerClue(ctx, day, card, o) {
  const rec = cardsOf(ctx.store)[card] || null;
  const gr = F.gradeFor({ ...o, rec });
  let may = day.writes.includes(card);
  if (may && day.fresh.includes(card) && !(rec && rec.reps)) {
    const c = ctx.clock.ctx();
    const b = dayAllowance({ store: ctx.store, c, settings: ctx.settings() }).decks.build;
    may = !!b && !b.paused && b.newLeft > 0;
  }
  if (!may) return { wrote: false, g: gr.g };
  saveAnswer(ctx, { id: card, g: gr.g, ms: o.ms || 0, flags: gr.flags, mode: o.typed ? 't' : 'g', study: gr.study });
  return { wrote: true, g: gr.g };
}

/** Report a word: it leaves the board until it is reviewed; the list stays on this device. @param {any} store @param {{form: string, root: string, word: string, day: string}} r */
export function reportWord(store, r) {
  store.update(REPORTS, (/** @type {any} */ x) => [...(Array.isArray(x) ? x : []).filter((/** @type {any} */ y) => y.form !== r.form), r].slice(-200), null);
}
/** @param {any} store @param {string} form */
export function unreportWord(store, form) {
  store.update(REPORTS, (/** @type {any} */ x) => (Array.isArray(x) ? x : []).filter((/** @type {any} */ y) => y.form !== form), null);
}
