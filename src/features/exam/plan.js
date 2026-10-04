/* Exam's offer for Today: the next mock module, corrections waiting (Schreiben not corrected yet, corrections not
   read yet) and the module bars. Pure over ctx: it reads the store (attempts, drafts, the Mac's results and feedback
   cached by the results sync) and the clock context; no DOM, no network. Dates come only from the clock. */
import { today as studyDay } from '../../core/clock.js';
import { scoreLine, scoreNum, stampMs } from '../../domain/grade.js';
import { allAttempts, allFeedback, feedbackFor, latest } from './data.js';

/**
 * The next module to sit (UX §3.4): a started one, else a productive module (Schreiben, Sprechen) never attempted,
 * else the module with the lowest latest score; on the first test of that module not yet done.
 * @param {{ exam: any, modules: string[], attempts: any[], drafts: Record<string, any> }} o
 * @returns {{ test: number, module: string } | null}
 */
export function nextModule({ exam, modules, attempts, drafts }) {
  if (!exam || !modules.length) return null;
  const tests = exam.tests || [];
  const done = (/** @type {string} */ m) => new Set(attempts.filter(a => a.module === m).map(a => a.day));
  for (const [k, d] of Object.entries(drafts || {}).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    const m = /^(\d+):([a-z]+)$/.exec(k);
    const started = d && (d.answers != null || d.start != null || d.prepStart != null);
    if (m && modules.includes(m[2]) && started && !done(m[2]).has(Number(m[1]))) return { test: Number(m[1]), module: m[2] };
  }
  const firstOpen = (/** @type {string} */ m) => tests.find((/** @type {number} */ n) => !done(m).has(n)) ?? null;
  for (const m of ['schreiben', 'sprechen']) {
    if (modules.includes(m) && done(m).size === 0) { const n = firstOpen(m); if (n != null) return { test: n, module: m }; }
  }
  const latestOf = (/** @type {string} */ m) => attempts.filter(a => a.module === m && a.score != null).sort((a, b) => stampMs(b.submitted_at) - stampMs(a.submitted_at))[0];
  const ranked = modules.map(m => {
    const def = exam.modules.find((/** @type {any} */ x) => x.id === m);
    const a = latestOf(m);
    return { m, pct: a && def ? a.score / def.max : -1 };
  }).sort((x, y) => x.pct - y.pct);
  for (const { m } of ranked) { const n = firstOpen(m); if (n != null) return { test: n, module: m }; }
  return null;
}

/** Attempts submitted on a study day. @param {any[]} attempts @param {string} day */
const submittedOn = (attempts, day) => attempts.filter(a => !a.remote && studyDay(new Date(stampMs(a.submitted_at) || stampMs(a.createdAt))) === day);

/**
 * Mock modules that still fit before the exam: one a day up to exam−2 (no mock on the eve or the day), minus today's
 * if one is done. null without a date or after it.
 * @param {import('../../core/clock.js').ClockCtx} c @param {any[]} attempts
 */
export function modulesFitting(c, attempts) {
  if (c.phase !== 'week' && c.phase !== 'lastNew') return null;
  const days = /** @type {number} */ (c.daysLeft) - 1;
  return Math.max(0, days - (submittedOn(attempts, c.today).length ? 1 : 0));
}

/** @param {import('../contract.js').PlanCtx} ctx @returns {import('../../domain/today.js').PlanItem[]} */
export function planItems({ store, c, settings, exam, t }) {
  if (!exam || settings.exam.type !== exam.id) return [];
  const attempts = allAttempts(store, exam.id);
  const today = submittedOn(attempts, c.today);
  if (today.length) {
    const a = today[today.length - 1];
    const def = exam.modules.find((/** @type {any} */ x) => x.id === a.module);
    return [{ id: 'exam.today', source: 'exam', kind: 'mock', mock: true, done: true, title: `${def ? def.name : a.module} · ${t('exam.test', { n: a.day })}`,
      detail: t('plan.mock.submitted'), minutes: def ? def.minutes : 30, href: `#/exam/${a.day}/${a.module}/review/${a.id}`, priority: 30 }];
  }
  const modules = settings.exam.modules?.length ? settings.exam.modules : exam.modules.map((/** @type {any} */ m) => m.id);
  const next = nextModule({ exam, modules, attempts, drafts: store.get('exams.drafts', {}) || {} });
  if (!next) return [];
  const def = exam.modules.find((/** @type {any} */ x) => x.id === next.module);
  return [{
    id: 'exam.next', source: 'exam', kind: 'mock', mock: true, title: `${def.name} · ${t('exam.test', { n: next.test })}`,
    detail: t('plan.mock.detail', { min: def.minutes }), minutes: def.minutes, href: `#/exam/${next.test}/${next.module}`, priority: 30,
    action: t('plan.mock.action', { module: def.name, min: def.minutes }),
  }];
}

/** Corrections waiting: new ones to read first, then Schreiben not corrected yet. @param {import('../contract.js').PlanCtx} ctx */
export function todayFeedback({ store, exam, t }) {
  if (!exam) return [];
  const rows = [];
  const last = latest(store, exam.id);
  for (const f of allFeedback(store)) {
    if (f.seen || !f.module || !f.day) continue;
    const a = last.get(`${f.day}:${f.module}`);
    if (!a || !feedbackFor(store, exam.id, a).cur.some(x => x.id === f.id)) continue;
    rows.push({ id: `fb.${f.id}`, title: `${f.module === 'sprechen' ? 'Sprechen' : f.module === 'schreiben' ? 'Schreiben' : f.module === 'lesen' ? 'Lesen' : 'Hören'} · ${t('exam.test', { n: f.day })}`,
      status: t('feedback.new'), href: `#/exam/${f.day}/${f.module}/review/${encodeURIComponent(a.id)}`, action: t('feedback.read') });
  }
  const pending = [...last.values()].filter(a => a.module === 'schreiben' && !a.remote && (a.writings || []).some((/** @type {any} */ w) => w.text) && !feedbackFor(store, exam.id, a).cur.length)
    .sort((a, b) => a.day - b.day);
  for (const a of pending) {
    rows.push({ id: `uncorrected.${a.id}`, title: `Schreiben · ${t('exam.test', { n: a.day })}`, status: t('feedback.notCorrected'),
      href: `#/exam/${a.day}/schreiben/review/${encodeURIComponent(a.id)}`, action: t('feedback.correct') });
  }
  return rows;
}

/** Latest score per module against the pass line; Schreiben and Sprechen from the correction's score line. @param {import('../contract.js').PlanCtx} ctx */
export function todayModules({ store, settings, exam }) {
  if (!exam) return [];
  const attempts = allAttempts(store, exam.id).sort((a, b) => stampMs(b.submitted_at) - stampMs(a.submitted_at));
  const mods = settings.exam.modules?.length ? settings.exam.modules : exam.modules.map((/** @type {any} */ m) => m.id);
  return exam.modules.filter((/** @type {any} */ m) => mods.includes(m.id)).map((/** @type {any} */ m) => {
    let score = null;
    for (const a of attempts.filter(x => x.module === m.id)) {
      if (a.score != null) { score = a.score; break; }
      const f = feedbackFor(store, exam.id, a).cur[0];
      const n = f ? scoreNum(scoreLine(f.body)) : null;
      if (n != null) { score = n; break; }
    }
    return { id: m.id, name: m.name, score, max: m.max, pass: m.pass, href: '#/exam' };
  });
}
