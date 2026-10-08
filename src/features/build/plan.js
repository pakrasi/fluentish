/* Word building's offer for Today's plan (docs/CONTRIBUTING-FEATURES.md). planItems is pure over ctx: the number of
   new cards open comes from kv 'build'.stats, which prepare() (and every Word building screen) writes from the
   content, so Today plans without loading it.

   Rows:
     - Word building: due cards and its share of the day's one allowance of new items (domain/allowance.js →
       domain/budget.js; Profile › Practice sets how many it wants). After the exam, or with no date, it is one of
       his goals: the row shows even before the deck was started (priority 35). While an exam is ahead its new cards
       pause and the row shows only due cards (priority 56, after the exam work; never cut). Not in a new learner's
       first week.
     - Today's family (round 7): the daily puzzle, a board of meanings to build from one root (today.js). Optional
       (it never takes the place of a row before it), priority 46 (between Word building and the old game row),
       minutes = board size × the review cost. It shows once prepare() has made the day's board (family-data.js
       todayBoard): not in a new learner's first week, and with an exam ahead only when he has seen six or more
       forms of a root (new items pause then). "4 of 10 found" while in progress, the done tick at the end. Its place
       stays after the core work (an optional 4-minute row must not push a review row out of a short day); while it is
       in the day's plan and not done, Today's hero carries a line to it, so it is in view without scrolling.
       It replaces Split or stay on Today (the owner's decision of 8 Oct): the board asks splits or stays for every
       verb on it, and Split or stay stays in the Word building hub. */
import { DECK } from '../../domain/wordbuild.js';
import { dayAllowance } from '../../domain/allowance.js';
import { dayOf, foundCount } from '../../domain/wordbuild-family.js';
import { REVIEW_COST } from '../../domain/budget.js';

const KV = 'build', FAMILY = 'build.family';

/** Refresh the open-card count Today reads (loads the content once a session). Never throws. @param {any} ctx a view ctx */
export async function prepare(ctx) {
  try {
    if (ctx.settings().language !== 'german') return;
    const { loadContent, today } = await import('./data.js');
    const d = await loadContent(ctx);
    writeStats(ctx.store, today(ctx, d));
    // Today's family: the day's board, made once (not in a new learner's first week)
    const c = ctx.clock.ctx();
    if (c.phase === 'day' || dayOf(ctx.store.get(FAMILY, null), c.today)) return;
    if (dayAllowance({ store: ctx.store, c, settings: ctx.settings() }).mode === 'start') return;
    const [{ familiesOf, todayBoard, ensureFamilies }, { knowledge }] = await Promise.all([import('./family-data.js'), import('./data.js')]);
    await ensureFamilies(ctx, d);
    todayBoard(ctx, d, familiesOf(d), await knowledge(ctx).catch(() => null));
  } catch { /* offline: Today plans from the last stats */ }
}

/** @param {any} store @param {{c: any, open: Record<string, string[]>}} st */
export function writeStats(store, st) {
  const open = Object.values(st.open).reduce((n, l) => n + l.length, 0);
  const cur = (store.get(KV, {}) || {}).stats;
  if (!cur || cur.day !== st.c.today || cur.open !== open) store.update(KV, (/** @type {any} */ s) => ({ ...(s || {}), stats: { day: st.c.today, open } }), {});
}

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t }) {
  if (settings.language !== 'german' || c.phase === 'day') return [];
  const cards = store.cards(DECK) || {};
  /** @type {import('../../domain/today.js').PlanItem[]} */ const out = [];
  const started = Object.values(cards).some(r => r && r.reps);
  const a = dayAllowance({ store, c, settings });
  const goal = a.mode === 'maintenance';
  const b = a.decks.build;
  const kv = store.get(KV, {}) || {};
  const rounds = kv.rounds && kv.rounds.day === c.today ? kv.rounds.n : 0;
  const n = b.due + b.newLeft;
  if (n > 0 && (started || goal)) {
    const what = b.due && b.newLeft ? t('plan.build.dueNew', { due: b.due, n: b.newLeft }) : b.due ? t('plan.build.due', { n: b.due }) : t('plan.build.new', { n: b.newLeft });
    const k = Math.min(12, n);
    out.push({ id: 'build.round', source: 'build', kind: b.due ? 'review' : 'new', introducesNew: b.due === 0, reviews: b.due, title: t('plan.build'), detail: what,
      minutes: b.minutes, href: '#/practice/build/round?kind=review&from=today', priority: goal ? 35 : 56, noCut: true, optional: !b.due,
      action: t('plan.build.action', { n: k, min: b.minutes }) });
  } else if (rounds > 0) {
    out.push({ id: 'build.round', source: 'build', kind: 'review', title: t('plan.build'), detail: t('plan.build.done'), minutes: 0, href: '#/practice/build', priority: goal ? 35 : 56, done: true });
  }
  // Today's family: once prepare() has made the day's board
  const fam = dayOf(store.get(FAMILY, null), c.today);
  if (fam && fam.cards.length) {
    const total = fam.cards.length, found = foundCount(fam, fam.done || {});
    const finished = fam.cards.every(id => (fam.done || {})[id]);
    const started2 = Object.keys(fam.done || {}).length > 0 || (fam.extras || []).length > 0;
    const min = Math.max(1, Math.ceil(total * REVIEW_COST.build));
    out.push({ id: 'build.family', source: 'build', kind: 'warmup', title: t('plan.family'),
      detail: finished || started2 ? t('plan.family.progress', { root: fam.root, n: found, total }) : t('plan.family.detail', { root: fam.root, n: total }),
      minutes: finished ? 0 : min, href: finished ? `#/practice/build/family/${encodeURIComponent(fam.root)}?from=today` : '#/practice/build/today?from=today',
      priority: 46, noCut: true, optional: true, done: finished, action: t('plan.family.action', { min }) });
  }
  return out;
}
