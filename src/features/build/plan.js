/* Word building's offer for Today's plan (docs/CONTRIBUTING-FEATURES.md). planItems is pure over ctx: the number of
   new cards open comes from kv 'build'.stats, which prepare() (and every Word building screen) writes from the
   content, so Today plans without loading it.

   Rows:
     - Word building: due cards and today's new ones (the deck's own cap, domain/budget.js buildBudget, never taken
       from the B1 allowance). Shown once the deck has been started; Today's composer keeps it only when the day's
       minutes allow (priority 56, after the B1 rounds, Schreiben, situations and clusters; never cut).
     - Split or stay: the 60-second game (1 min, priority 58), done once played today. Not on the exam day (only the
       warm-up then). */
import { isDue } from '../../domain/b1ready.js';
import { buildBudget } from '../../domain/budget.js';
import { DECK } from '../../domain/wordbuild.js';
import { playedToday, shownToday } from '../../domain/wordbuild-plan.js';

const KV = 'build', GAME = 'build.game';

/** Refresh the open-card count Today reads (loads the content once a session). Never throws. @param {any} ctx a view ctx */
export async function prepare(ctx) {
  try {
    if (ctx.settings().language !== 'german') return;
    const { loadContent, today } = await import('./data.js');
    const d = await loadContent(ctx);
    writeStats(ctx.store, today(ctx, d));
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
  if (started) {
    const due = Object.values(cards).filter(r => r && r.reps && isDue(r, c.today, c)).length;
    const kv = store.get(KV, {}) || {};
    const stats = kv.stats && kv.stats.day === c.today ? kv.stats : null;
    const b = buildBudget({ c, settings, dueN: due, newShown: shownToday(cards, c.today).all, unseen: stats ? stats.open : 0 });
    const rounds = kv.rounds && kv.rounds.day === c.today ? kv.rounds.n : 0;
    if (b.n > 0) {
      const what = b.due && b.newLeft ? t('plan.build.dueNew', { due: b.due, n: b.newLeft }) : b.due ? t('plan.build.due', { n: b.due }) : t('plan.build.new', { n: b.newLeft });
      const n = Math.min(12, b.n);
      out.push({ id: 'build.round', source: 'build', kind: b.due ? 'review' : 'new', introducesNew: b.due === 0, title: t('plan.build'), detail: what,
        minutes: b.minutes, href: '#/practice/build/round?kind=review&from=today', priority: 56, noCut: true,
        action: t('plan.build.action', { n, min: b.minutes }) });
    } else if (rounds > 0) {
      out.push({ id: 'build.round', source: 'build', kind: 'review', title: t('plan.build'), detail: t('plan.build.done'), minutes: 0, href: '#/practice/build', priority: 56, done: true });
    }
  }
  const game = store.get(GAME, null);
  const played = playedToday(game, c.today);
  out.push({ id: 'build.game', source: 'build', kind: 'warmup', title: t('plan.game'), detail: played ? t('plan.game.done') : t('plan.game.detail'),
    minutes: 1, href: '#/practice/build/game?from=today', priority: 58, noCut: true, done: played, action: t('plan.game.action') });
  return out;
}
