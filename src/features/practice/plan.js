/* Practice's offer for Today's plan (docs/CONTRIBUTING-FEATURES.md). planItems is pure over ctx: no DOM, no fetches,
   no content. Every number comes from the one daily allowance (features/allowance.js → domain/budget.js): the pool-wide
   counts it needs (★ and trap items not seen yet, unseen items, cards no round can ask) come from 'b1.session'.stats,
   which Practice writes whenever it builds the pool; prepare() builds it before Today composes, so Today and Practice
   read the same numbers from the same inputs.

   Rows: the warm-up on the exam day; while Schreiben is the weakest module (domain/modules.js writingFocus), a
   Schreiben task written from memory before everything else (features/day.js puts a correction waiting right after
   it); the review round (due + its share of new items, about N rounds); Schreiben phrases; mistakes from corrections;
   speaking situations; the Sprechen frames on the eve; the Teil 2 talk while the exam is ahead; the scripts; word
   clusters. A row that carries due cards says how many (reviews), so Today can count every deck's reviews and say
   when they do not fit. When today's rounds are done and nothing is due, the round row shows done. */
import { dueOn } from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { ROUND } from '../../domain/budget.js';
import { DECK as SIM_DECK, ROUND_SIZE as SIM_ROUND, KV as SIM_KV, dayOf as simDayOf } from './sim.js';
import { add } from '../../core/clock.js';
import { scriptPlanItems } from './script/today.js';
import { dayAllowance, writingTask } from '../allowance.js';

export { writingTask };

/**
 * Refresh the pool stats Today reads (loads the content once; cached for the session). Never throws.
 * @param {any} ctx a view ctx (content, clock, store, settings)
 */
export async function prepare(ctx) {
  try {
    const { loadData, stateFor } = await import('./data.js');
    if (!ctx.settings().language) return;
    stateFor(ctx, await loadData(ctx));
    const { refreshSimStats } = await import('./sim-data.js');
    await refreshSimStats(ctx);
  } catch { /* offline: Today plans from the last stats */ }
}

/**
 * Today's numbers from the store and the cached stats: the allowance (every deck), plus what the review round's row,
 * Practice's hub and the rounds read: the b1 deck's due count, rounds and minutes, the size of the next round.
 * @param {import('../contract.js').PlanCtx} ctx
 */
export function todayBudget({ store, c, settings }) {
  const a = dayAllowance({ store, c, settings });
  const b = a.decks.b1;
  const act = (store.get('activity', {}) || {})[c.today];
  const day = a.day;
  const roundsToday = Math.max(act ? act.rounds || 0 : 0, day ? day.rounds || 0 : 0);
  const cards = store.cards('b1');
  const firstEver = !Object.values(cards).some(r => r && r.hist && r.hist.length);
  // the next daily round's size: what the composer made of the same state (data.js stateFor), else its rule
  const next = a.stats && Number.isFinite(a.stats.next) ? a.stats.next : Math.min(ROUND, b.due + Math.min(b.newLeft, firstEver ? 8 : 4));
  return { ...a, due: b.due, rounds: b.rounds, minutes: b.minutes, b1: b, writing: { ...a.decks.writing, focus: a.focus, n: a.decks.writing.due + a.decks.writing.newLeft },
    roundsToday, writeRounds: day ? day.writeRounds || 0 : 0, next };
}

/**
 * Word clusters today, from the allowance: cards due and, outside the exam, its share of new cards.
 * @param {{store: any, c: any, settings?: any}} ctx
 */
export function clusterToday({ store, c, settings }) {
  const x = dayAllowance({ store, c, settings: settings || {} }).decks.clusters;
  return { due: x.due, newLeft: x.newLeft, paused: x.paused, minutes: x.due + x.newLeft ? roundMinutes(Math.min(ROUND, x.due + x.newLeft)) : 0 };
}

/**
 * Speaking situations today: due cards, new ones left and the minutes they take (the hub and Today's row agree), from
 * the allowance's speak share.
 * @param {{store: any, c: any, settings: any}} ctx
 */
export function simToday({ store, c, settings }) {
  const x = dayAllowance({ store, c, settings }).decks.speak;
  const day = simDayOf(store.get(SIM_KV, {}) || {}, c.today);
  return { newPerDay: x.newPerDay, newLeft: x.newLeft, cards: x.due + 2 * x.newLeft, minutes: x.minutes, due: x.due, roundsToday: day.rounds || 0 };
}

/**
 * The label of the button that starts the next review round, shared by Today's dock and Practice's hub. It counts the
 * rounds the composed plan row shows, after Today's cut ("2 rounds today" → "Start round 1 of 2"), so the row and both
 * buttons say the same.
 * @param {{rounds: number}} b @param {number} n questions in the next round @param {(k: string, v?: any) => string} t
 */
export function roundAction(b, n, t) {
  return b.rounds > 1 ? t('plan.round.actionOf', { k: 1, total: b.rounds, n }) : t('plan.round.action', { n, min: roundMinutes(n) });
}

/**
 * @param {import('../contract.js').PlanCtx} ctx
 * @returns {import('../../domain/today.js').PlanItem[]}
 */
export function planItems({ store, c, settings, t, exam }) {
  if (settings.language !== 'german') return [];   // phase 1: the practice content is German; never German for another language
  if (c.phase === 'day') {
    return [{ id: 'practice.warmup', source: 'practice', kind: 'warmup', title: t('plan.warmup'), detail: t('plan.warmup.detail'),
      minutes: 3, href: '#/practice/round?kind=warmup', priority: 10, action: t('plan.warmup.action') }];
  }
  const cards = store.cards('b1');
  const recs = Object.entries(cards);
  const b = todayBudget({ store, c, settings, t, exam });
  const maint = b.mode === 'maintenance' || b.mode === 'start';
  const due = b.due, fresh = b.b1.newLeft;
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  // Schreiben first while it is the weakest module: a task from memory (features/day.js puts a correction after it)
  const task = b.task;
  if (task) {
    out.push(task.done
      ? { id: 'practice.schreiben', source: 'practice', kind: 'write', title: t('plan.schreiben'), detail: t('plan.schreiben.done', { n: task.a.slice(1) }), minutes: 0, href: '#/practice/write', priority: 18, done: true }
      : { id: 'practice.schreiben', source: 'practice', kind: 'write', title: t('plan.schreiben'), detail: t('plan.schreiben.detail', { n: task.a.slice(1), title: task.title }),
        minutes: task.min, href: `#/practice/write/build/${task.id}/free`, priority: 18, action: t('plan.schreiben.action', { min: task.min }) });
  }
  if (due > 0 || fresh > 0) {
    const n = b.next || Math.min(ROUND, due + fresh);
    const what = due > 0 ? (fresh > 0 ? t('plan.review.detailNew', { due, fresh }) : t('plan.review.detail', { n: due, due })) : t('plan.new.detail', { n: fresh });
    out.push({
      id: 'practice.round', source: 'practice', kind: due > 0 ? 'review' : 'new', introducesNew: due === 0, reviews: due,
      title: recs.length ? t('plan.review') : t('plan.firstRound'),
      detail: b.rounds > 1 ? `${what} · ${t('plan.rounds', { n: b.rounds })}` : what,
      minutes: b.minutes, href: '#/practice/round', priority: 20, rounds: b.rounds,
      action: roundAction(b, n, t), actionFor: rounds => roundAction({ rounds }, n, t),
    });
  } else if (b.roundsToday > 0) {
    out.push({ id: 'practice.round', source: 'practice', kind: 'review', title: t('plan.review'), detail: t('plan.review.none'), minutes: 0, href: '#/practice', priority: 20, done: true });
  }
  // Schreiben phrases: their own rounds; right after the review round while Schreiben is the weakest module
  const w = b.writing;
  if (w.due + w.newLeft > 0) {
    const n = Math.min(ROUND, w.due + w.newLeft);
    out.push({ id: 'practice.writing', source: 'practice', kind: 'write', introducesNew: w.due === 0, reviews: w.due, title: t('plan.writing'),
      detail: w.due && w.newLeft ? t('plan.review.detailNew', { due: w.due, fresh: w.newLeft }) : w.due ? t('plan.review.detail', { n: w.due, due: w.due }) : t('plan.new.detail', { n: w.newLeft }),
      minutes: w.minutes, href: '#/practice/round?kind=write', priority: w.focus ? 22 : 50, rounds: w.rounds,
      action: t('plan.writing.action', { n, min: roundMinutes(n) }) });
  } else if (w.focus && b.writeRounds > 0) {
    out.push({ id: 'practice.writing', source: 'practice', kind: 'write', title: t('plan.writing'), detail: t('plan.writing.done'), minutes: 0, href: '#/practice/write', priority: 22, done: true });
  }
  // mistakes from corrections: due ones and ones not practised yet (their share of the day's new items comes first);
  // while Schreiben is the focus they come right after the writing and its correction
  const m = b.decks.mistakes;
  if (m.due + m.newLeft > 0) {
    const n = Math.min(ROUND, m.due + m.newLeft);
    out.push({ id: 'practice.mistakes', source: 'practice', kind: 'mistakes', introducesNew: m.due === 0, reviews: m.due, title: t('practice.plan.mistakes'),
      detail: t('practice.plan.mistakes.detail', { n: m.due + m.newLeft }), minutes: roundMinutes(n), href: '#/practice/round?kind=mistakes', priority: b.focus ? 19.5 : 25,
      action: t('practice.plan.mistakes.action', { n, min: roundMinutes(n) }) });
  }
  // speaking situations: a short self-graded round after the reviews
  const sim = simToday({ store, c, settings });
  if (sim.cards > 0) {
    const n = Math.min(SIM_ROUND, sim.cards);
    out.push({ id: 'practice.situations', source: 'practice', kind: 'speak', introducesNew: sim.due === 0, reviews: sim.due, title: t('plan.sim'),
      detail: sim.due ? (sim.newLeft ? t('plan.sim.detailNew', { due: sim.due, fresh: sim.newLeft }) : t('plan.sim.detail', { n: sim.due })) : t('plan.sim.detailFresh', { n: sim.newLeft }),
      minutes: sim.minutes, href: '#/practice/situations/round?from=today', priority: 48, action: t('plan.sim.action', { n, min: Math.max(1, Math.ceil(n * 0.2)) }) });
  } else if (sim.roundsToday > 0) {
    out.push({ id: 'practice.situations', source: 'practice', kind: 'speak', title: t('plan.sim'), detail: t('plan.sim.none'), minutes: 0, href: '#/practice/situations', priority: 48, done: true });
  }
  if (c.phase === 'eve') {
    out.push({ id: 'practice.frames', source: 'practice', kind: 'read', title: t('plan.frames'), detail: t('plan.frames.detail'), minutes: 5, href: '#/lookup/frames', priority: 45 });
  }
  const goalSpeaking = settings.exam.type && settings.exam.modules.includes('sprechen');
  if (goalSpeaking && (c.phase === 'week' || c.phase === 'lastNew')) {
    out.push({ id: 'practice.teil2', source: 'practice', kind: 'speak', title: t('plan.teil2'), detail: t('plan.teil2.detail'), minutes: 6, href: '#/practice/speak/teil2', priority: 50 });
  }
  // scripts: their words are the script deck's share of the day; after the exam they are one of his goals (priority 30)
  out.push(...scriptPlanItems({ store, c: { ...c, dayNewLeft: b.decks.script.newLeft }, settings, t }).map(r => (maint && !r.done && r.priority > 30 ? { ...r, priority: 30 } : r)));
  // word clusters: due cards always (they are reviews like any other), and outside the exam their share of new cards
  // from the cluster he studied last
  const cl = b.decks.clusters;
  const last = (store.get('clusters', {}) || {}).last;
  if (cl.due > 0) {
    const n = Math.min(ROUND, cl.due);
    out.push({ id: 'practice.clusters', source: 'practice', kind: 'review', reviews: cl.due, title: t('plan.clusters'), detail: t('plan.clusters.detail', { n: cl.due }),
      minutes: roundMinutes(n), href: '#/practice/round?kind=cluster%3Adue', priority: maint ? 38 : 55, noCut: true, action: t('plan.clusters.action', { n, min: roundMinutes(n) }) });
  } else if (cl.newLeft > 0 && last) {
    const n = Math.min(ROUND, cl.newLeft);
    out.push({ id: 'practice.clusters', source: 'practice', kind: 'new', introducesNew: true, title: t('plan.clusters'), detail: t('plan.clusters.new', { n }),
      minutes: roundMinutes(n), href: `#/practice/round?kind=${encodeURIComponent(`cluster:${last}`)}&from=today`, priority: 38, noCut: true, optional: true,
      action: t('plan.clusters.action', { n, min: roundMinutes(n) }) });
  }
  return out;
}

/**
 * Cards due tomorrow in every deck, for "Done for today. Tomorrow: about N due."
 * @param {import('../contract.js').PlanCtx} ctx
 */
export function dueTomorrow({ store, c }) {
  const tomorrow = add(c.today, 1);
  let n = 0;
  for (const deck of ['b1', SIM_DECK, 'script', 'build', 'clusters']) {
    for (const [id, r] of Object.entries(store.cards(deck) || {})) {
      if (!r || !r.reps || /^SR:/.test(id)) continue;
      if ((dueOn(r, c) || '') <= tomorrow || r.learn != null || r.relearn) n++;
    }
  }
  return n;
}
