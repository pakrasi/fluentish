/* Word families and Today's family: loading and saving (round 7). Everything it calls is pure
   (domain/wordbuild-family.js); the cards go through data.js saveAnswer, the one writer of deck 'build'.

   Writes:
     kv 'build.family'   Today's family: { days: [{ day, root, level, cards, writes, fresh, tiles, tries, done, split,
                          extras, points, ms, stats: {known, n} }], recent: [root] } (domain FamilyLog), the last 60
                          days. In the backup (rule 'family': merged by day), so a board in progress follows him.
     kv 'build.reports'  "Report this word": [{ form, root, word, day }] on this device only (never in a backup, never
                          sent anywhere); Profile › Diagnostics lists them. A reported form leaves the board.
     cards 'build'       only for a board word that is due today or new inside the allowance (saveAnswer). */
import * as F from '../../domain/wordbuild-family.js';
import { dayAllowance, todayPlan } from '../../domain/allowance.js';
import { courseGoal } from '../../domain/levels.js';
import { loadContent, cardsOf, dueFns, saveAnswer, today as todayState } from './data.js';

export const FAMILY = 'build.family';
export const REPORTS = 'build.reports';

/** @type {WeakMap<any, Map<string, F.Family>>} */ const models = new WeakMap();

/** The families of the content, with level, frequency and examples from the word list (once a session). @param {any} d loadContent() */
export function familiesOf(d) {
  let m = models.get(d);
  if (!m) {
    m = F.familyModel(d.c, { info: lemma => { const w = d.byId.get(lemma); return w ? { level: w.level || null, zipf: w.zipf ?? null, ex: w.ex || null, exEn: w.exen || null } : null; } });
    models.set(d, m);
  }
  return m;
}

/** @param {any} ctx */
export async function loadFamilies(ctx) {
  const d = await loadContent(ctx);
  return { d, fams: familiesOf(d) };
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

/** @param {any} store @returns {F.FamilyLog} */
export const logOf = store => store.get(FAMILY, null) || { days: [], recent: [] };
/** @param {any} store @returns {{form: string, root: string, word: string, day: string}[]} */
export const reportsOf = store => { const r = store.get(REPORTS, null); return Array.isArray(r) ? r : []; };

/**
 * Today's board: the day's log, made once and kept all day (a reload and a second device find it). Null when no
 * family has a board for him today (new items paused and too few seen words).
 * @param {any} ctx @param {any} d @param {Map<string, F.Family>} fams @param {any} [k] knowledge
 * @returns {F.DayLog & {stats?: {known: number, n: number}} | null}
 */
export function todayBoard(ctx, d, fams, k = null) {
  const c = ctx.clock.ctx();
  const log = logOf(ctx.store);
  const have = F.dayOf(log, c.today);
  if (have && fams.has(have.root)) return have;
  const settings = ctx.settings();
  todayState(ctx, d, k);   // writes kv 'build'.stats (the open new items), which the allowance reads
  const a = dayAllowance({ store: ctx.store, c, settings });
  const b = a.decks.build;
  const g = courseGoal(settings);
  const level = g.level || g.goal || 'B1';
  const light = todayPlan({ store: ctx.store, c, settings }).kind === 'light';
  const reported = new Set(reportsOf(ctx.store).map(r => r.form));
  const board = F.boardFor({ families: fams, cards: cardsOf(ctx.store), day: c.today, level, light, newLeft: b ? b.newLeft : 0, paused: !b || b.paused || !c.newItems,
    isDue: dueFns(c).isDue, state: f => stateOf(d, k, f), recent: log.recent || [], reported });
  if (!board) return null;
  const fam = /** @type {F.Family} */ (fams.get(board.root));
  const day = { ...F.newDay(board), stats: statsOf(d, k, fam) };
  ctx.store.update(FAMILY, (/** @type {any} */ x) => F.putDay(x, day), null);
  return day;
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
