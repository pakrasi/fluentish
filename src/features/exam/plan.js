/* Exam's offer for Today: the next mock module, corrections waiting (Schreiben not corrected yet, corrections not
   read yet) and the module scores. Pure over ctx: it reads the store (attempts, drafts, the Mac's results and feedback
   cached by the results sync) and the clock context; no DOM, no network. Dates come only from the clock.

   A mock is planned only while an exam date is ahead with mock days left (phases week and lastNew): after the exam,
   or with no date, Today has no mock row until he sets a next exam. While Schreiben is the weakest module
   (domain/modules.js writingFocus) the mock is Schreiben when a test is left; it may run over the day only when the
   whole module fits (the day's minutes at least the module plus 30), else it waits under "If you have time" and the
   day's Schreiben is the task from memory (practice-write/plan.js). Any other module's mock then never runs over: the
   Schreiben work comes first. */
import { today as studyDay } from '../../core/clock.js';
import { scoreLine, scoreNum, stampMs } from '../../domain/grade.js';
import { allAttempts, allFeedback, feedbackFor, latest } from './data.js';
import * as T from './timer.js';
import { writingFocus } from '../../domain/modules.js';

/** The latest score of an attempt, Schreiben and Sprechen from the score line of their correction. @param {any} store @param {string} examId */
export const scoreReader = (store, examId) => (/** @type {any} */ a) => {
  if (a.score != null) return a.score;
  const f = feedbackFor(store, examId, a).cur[0];
  return f ? scoreNum(scoreLine(f.body)) : null;
};

/** Minutes a module takes in a day's plan (exam-def planMinutes; Sprechen: 15 of preparation plus about 15 of exam). @param {any} def a manifest module */
export const planMinutes = def => def.planMinutes ?? def.minutes;
/** "30 min (15 prep)" for a module with preparation time (Sprechen), "65 min" for the others. @param {any} def @param {(k: string, v?: any) => string} t */
export const minutesLabel = (def, t) => (def.prepMinutes ? t('exam.sprechenMinutes') : t('unit.min', { n: def.minutes }));

/** A draft started this recently still wins Up next; an older one waits on its test page as "Resume". */
export const RESUME_MS = 3 * 864e5;
/** Modules never taken, weakest skill first: the productive ones before the receptive ones. */
const FIRST = ['schreiben', 'sprechen', 'hoeren', 'lesen'];

/** When a draft was last worked on (ms), or 0 when it has no clock. @param {any} d */
export function draftTouched(d) {
  const c = T.normalize({ start: d?.start ?? d?.prepStart, pause: d?.pause ?? d?.['prep:pause'], seen: d?.seen ?? d?.['prep:seen'] });
  return c ? Math.max(c.start, c.seen || 0, c.pause.pausedAt || 0) : 0;
}

/**
 * The next module to sit (UX §3.4): a draft worked on in the last 3 days; else a module never taken (Schreiben,
 * Sprechen, Hören, Lesen in that order); else the module with the lowest latest score (scoreOf reads Schreiben and
 * Sprechen from their corrections; unknown counts as lowest). Always on the first test of that module not yet done.
 * @param {{ exam: any, modules: string[], attempts: any[], drafts: Record<string, any>, now?: number, scoreOf?: (a: any) => number | null }} o
 * @returns {{ test: number, module: string } | null}
 */
export function nextModule({ exam, modules, attempts, drafts, now = Date.now(), scoreOf = a => a.score }) {
  if (!exam || !modules.length) return null;
  const tests = exam.tests || [];
  const done = (/** @type {string} */ m) => new Set(attempts.filter(a => a.module === m).map(a => a.day));
  for (const [k, d] of Object.entries(drafts || {}).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    const m = /^(\d+):([a-z]+)$/.exec(k);
    if (!m || !modules.includes(m[2]) || done(m[2]).has(Number(m[1]))) continue;
    if (now - draftTouched(d) <= RESUME_MS) return { test: Number(m[1]), module: m[2] };
  }
  const firstOpen = (/** @type {string} */ m) => tests.find((/** @type {number} */ n) => !done(m).has(n)) ?? null;
  for (const m of FIRST) {
    if (modules.includes(m) && done(m).size === 0) { const n = firstOpen(m); if (n != null) return { test: n, module: m }; }
  }
  const latestOf = (/** @type {string} */ m) => attempts.filter(a => a.module === m).sort((a, b) => stampMs(b.submitted_at) - stampMs(a.submitted_at))[0];
  const ranked = modules.map(m => {
    const def = exam.modules.find((/** @type {any} */ x) => x.id === m);
    const a = latestOf(m);
    const sc = a ? scoreOf(a) : null;
    return { m, pct: sc != null && def ? sc / def.max : -1 };
  }).sort((x, y) => x.pct - y.pct || FIRST.indexOf(x.m) - FIRST.indexOf(y.m));
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
  if (c.phase !== 'week' && c.phase !== 'lastNew' && c.phase !== 'eve' && c.phase !== 'day') return [];
  const attempts = allAttempts(store, exam.id);
  const today = submittedOn(attempts, c.today);
  if (today.length) {
    const a = today[today.length - 1];
    const def = exam.modules.find((/** @type {any} */ x) => x.id === a.module);
    return [{ id: 'exam.today', source: 'exam', kind: 'mock', mock: true, done: true, title: `${def ? def.name : a.module} · ${t('exam.test', { n: a.day })}`,
      detail: t('plan.mock.submitted'), minutes: def ? planMinutes(def) : 30, href: `#/exam/${a.day}/${a.module}/review/${a.id}`, priority: 30 }];
  }
  const modules = settings.exam.modules?.length ? settings.exam.modules : exam.modules.map((/** @type {any} */ m) => m.id);
  const drafts = store.get('exams.drafts', {}) || {};
  const focus = writingFocus({ store, c, settings }) && modules.includes('schreiben');
  const next = (focus && nextModule({ exam, modules: ['schreiben'], attempts, drafts, scoreOf: scoreReader(store, exam.id) }))
    || nextModule({ exam, modules, attempts, drafts, scoreOf: scoreReader(store, exam.id) });
  if (!next) return [];
  const def = exam.modules.find((/** @type {any} */ x) => x.id === next.module);
  const fitsDay = (settings.minutesPerDay || 60) >= planMinutes(def) + 30;
  return [{
    id: 'exam.next', source: 'exam', kind: 'mock', mock: true, module: next.module, title: `${def.name} · ${t('exam.test', { n: next.test })}`,
    detail: t('plan.mock.detailLabel', { min: minutesLabel(def, t) }), minutes: planMinutes(def), href: `#/exam/${next.test}/${next.module}`, priority: 30,
    action: t('plan.mock.action', { module: def.name, min: planMinutes(def) }),
    ...(focus && (next.module !== 'schreiben' || !fitsDay) ? { noOverrun: true } : {}),
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
    const title = `${exam.modules.find((/** @type {any} */ m) => m.id === f.module)?.name ?? f.module} · ${t('exam.test', { n: f.day })}`;
    rows.push({ id: `fb.${f.id}`, title, status: t('feedback.new'), href: `#/exam/${f.day}/${f.module}/review/${encodeURIComponent(a.id)}`, action: t('feedback.read'), label: t('feedback.readLabel', { title }),
      module: f.module, need: 'read', test: f.day });
  }
  const pending = [...last.values()].filter(a => a.module === 'schreiben' && !a.remote && (a.writings || []).some((/** @type {any} */ w) => w.text) && !feedbackFor(store, exam.id, a).cur.length)
    .sort((a, b) => a.day - b.day);
  for (const a of pending) {
    const title = `Schreiben · ${t('exam.test', { n: a.day })}`;
    rows.push({ id: `uncorrected.${a.id}`, title, status: t('feedback.notCorrected'),
      href: `#/exam/${a.day}/schreiben/review/${encodeURIComponent(a.id)}?correct=1`, action: t('feedback.correct'), label: t('feedback.correctLabel', { title }),
      module: 'schreiben', need: 'correct', test: a.day });
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
