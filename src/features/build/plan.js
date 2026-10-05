/* Word building's offer for Today's plan (docs/CONTRIBUTING-FEATURES.md). planItems is pure over ctx: the number of
   new cards open comes from kv 'build'.stats, which prepare() (and every Word building screen) writes from the
   content, so Today plans without loading it.

   Rows:
     - Word building: due cards and its share of the day's one allowance of new items (domain/allowance.js →
       domain/budget.js; Profile › Practice sets how many it wants). After the exam, or with no date, it is one of
       his goals: the row shows even before the deck was started (priority 35). While an exam is ahead its new cards
       pause and the row shows only due cards (priority 56, after the exam work; never cut). Not in a new learner's
       first week.
     - Split or stay: the 60-second game (1 min, optional: it never takes the place of a row before it), only after
       the exam or with no date, and once the deck has been started. */
import { DECK } from '../../domain/wordbuild.js';
import { playedToday } from '../../domain/wordbuild-plan.js';
import { dayAllowance } from '../../domain/allowance.js';

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
  // the game: after the exam or with no date, once Word building has been started
  if (goal && started) {
    const game = store.get(GAME, null);
    const played = playedToday(game, c.today);
    out.push({ id: 'build.game', source: 'build', kind: 'warmup', title: t('plan.game'), detail: played ? t('plan.game.done') : t('plan.game.detail'),
      minutes: 1, href: '#/practice/build/game?from=today', priority: 58, noCut: true, optional: true, done: played, action: t('plan.game.action') });
  }
  return out;
}
