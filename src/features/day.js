/* Today's plan, composed once for every screen that shows it: Today's rows and dock, and Practice's Start button
   (which needs the review row after Today's cut, so both say "round 1 of 2"). Core: it asks every feature's plan
   module through the registry and arranges what they offer with arrange() before domain/today.js composes the day. */
import { composeToday } from '../domain/today.js';
import { planProviders } from './registry.js';
import { dayPlan } from '../domain/week.js';

/**
 * The rules that need more than one feature's rows (pure, tested in node):
 *   - Schreiben while it is the weakest module: the task from memory stays the first row, and a correction waiting
 *     (a new one to read first, else a written mock not corrected yet) comes right after it as its own row; its
 *     mistakes follow (practice.mistakes). The promoted correction, and every other Schreiben mock waiting for a
 *     correction, leave the Feedback list: the plan row says how many, so each shows once.
 *   - On a day whose mock is Schreiben and the whole module fits the day (it may run over), the mock is the writing:
 *     the task from memory waits for another day.
 *   - On a day whose mock is not Sprechen, speaking situations move up (priority 28, before the mock), so their four
 *     minutes fit.
 * @param {import('../domain/today.js').PlanItem[]} items @param {import('../domain/today.js').FeedbackRow[]} feedback
 * @param {(k: string, v?: any) => string} t
 */
export function arrange(items, feedback, t) {
  let rows = [...items];
  let fb = [...feedback];
  const mock = rows.find(r => r.mock && !r.done && r.module);
  const k = rows.findIndex(r => r.id === 'practice.schreiben');
  if (k >= 0) {
    const pick = fb.find(f => f.module === 'schreiben' && f.need === 'read') || fb.find(f => f.module === 'schreiben' && f.need === 'correct') || null;
    if (pick) {
      const read = pick.need === 'read';
      const waiting = fb.filter(f => f.module === 'schreiben' && f.need === 'correct');
      const more = read ? waiting.length : waiting.length - 1;
      rows.push({ id: 'practice.correction', source: 'exam', kind: 'read', href: pick.href, minutes: read ? 5 : 3, priority: 19,
        title: t(read ? 'plan.schreiben.read' : 'plan.schreiben.get'),
        detail: [t(read ? 'plan.schreiben.readDetail' : 'plan.schreiben.getDetail', { n: pick.test }), more > 0 ? t('plan.schreiben.more', { n: more }) : null].filter(Boolean).join(' · '),
        action: t(read ? 'plan.schreiben.readAction' : 'plan.schreiben.getAction', { n: pick.test }) });
      fb = fb.filter(f => f !== pick && !(f.module === 'schreiben' && f.need === 'correct'));
    }
    if (mock && mock.module === 'schreiben' && !mock.noOverrun && !rows[k].done) rows = rows.filter(r => r.id !== 'practice.schreiben');
  }
  if (mock && mock.module !== 'sprechen') rows = rows.map(r => (r.id === 'practice.situations' ? { ...r, priority: 28 } : r));
  return { items: rows, feedback: fb };
}

/**
 * @param {import('./contract.js').ViewCtx} ctx @param {{prepare?: boolean}} [o] prepare: let features refresh their
 *   cached stats first (Today does; Practice has just built its own)
 */
export async function composeDay(ctx, { prepare = true } = {}) {
  const { store, t } = ctx;
  const s = ctx.settings();
  const c = ctx.clock.ctx();
  const manifest = await ctx.content.manifest().catch(() => null);
  const exam = manifest && s.exam.type ? manifest.exams.find((/** @type {any} */ e) => e.id === s.exam.type) || null : null;
  const lang = manifest && s.language ? manifest.languages.find((/** @type {any} */ l) => l.id === s.language) : null;
  const pctx = { store, c, settings: s, exam, t, day: dayPlan(s, c) };
  /** @type {any[]} */ const items = [], feedback = [], modules = [];
  const providers = /** @type {any[]} */ (await planProviders());
  if (prepare) await Promise.all(providers.map(p => p.mod.prepare?.(ctx)));   // e.g. Practice's pool stats, so both tabs read one budget
  for (const { id, mod } of providers) {
    try {
      items.push(...((await mod.planItems?.(pctx)) || []));
      feedback.push(...(mod.todayFeedback?.(pctx) || []));
      modules.push(...(mod.todayModules?.(pctx) || []));
    } catch (e) { console.error(`today: ${id}`, e); }
  }
  // a language with no mock exam in the content (French, C3b) is studied without a date: no prompt to set one
  const examLang = !manifest || (manifest.exams || []).some((/** @type {any} */ e) => e.language === s.language);
  if (s.language && examLang && c.phase === 'none') items.push({ id: 'today.setDate', source: 'today', kind: 'setup', title: t('plan.setDate'), detail: t('plan.setDate.detail'), minutes: 0, href: '#/profile/goal', priority: 90 });
  if (s.language && examLang && c.phase === 'after') items.push({ id: 'today.nextExam', source: 'today', kind: 'setup', title: t('plan.nextExam'), detail: t('plan.nextExam.detail'), minutes: 0, href: '#/profile/goal', priority: 90 });
  const a = arrange(items, feedback, t);
  const activity = store.get('activity', {}) || {};
  // on the exam day nothing asks for work: no corrections to read, only the warm-up
  const plan = composeToday({ ctx: c, budget: s.minutesPerDay, items: a.items, feedback: c.phase === 'day' ? [] : a.feedback, modules, doneMinutes: activity[c.today]?.minutes || 0 });
  return { plan, exam, lang, c, settings: s, activity };
}
