/* Exam's offer for Today: the next mock module, uncorrected Schreiben and unread corrections, and the module bars.
   Stage A works from the attempts and drafts already in the store (migrated from the B1 exam app). Stage B adds the
   full run (once, on exam−4 or exam−3) and Fritz's feedback from the results sync. Pure over ctx. */
import { today as studyDay } from '../../core/clock.js';

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
    if (m && modules.includes(m[2]) && d && d.answers != null && !done(m[2]).has(Number(m[1]))) return { test: Number(m[1]), module: m[2] };
  }
  const firstOpen = (/** @type {string} */ m) => tests.find((/** @type {number} */ n) => !done(m).has(n)) ?? null;
  for (const m of ['schreiben', 'sprechen']) {
    if (modules.includes(m) && done(m).size === 0) { const n = firstOpen(m); if (n != null) return { test: n, module: m }; }
  }
  const latest = (/** @type {string} */ m) => attempts.filter(a => a.module === m && a.score != null).sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];
  const ranked = modules.map(m => {
    const def = exam.modules.find((/** @type {any} */ x) => x.id === m);
    const a = latest(m);
    return { m, pct: a && def ? a.score / def.max : -1 };
  }).sort((x, y) => x.pct - y.pct);
  for (const { m } of ranked) { const n = firstOpen(m); if (n != null) return { test: n, module: m }; }
  return null;
}

/** @param {import('../contract.js').PlanCtx} ctx @returns {import('../../domain/today.js').PlanItem[]} */
export function planItems({ store, c, settings, exam, t }) {
  if (!exam || settings.exam.type !== exam.id) return [];
  const attempts = store.attempts().filter((/** @type {any} */ a) => a.examId === exam.id);
  const today = attempts.filter((/** @type {any} */ a) => a.createdAt && studyDay(new Date(a.createdAt)) === c.today);
  /** @type {import('../../domain/today.js').PlanItem[]} */
  const out = [];
  if (today.length) {
    const a = today[today.length - 1];
    const def = exam.modules.find((/** @type {any} */ x) => x.id === a.module);
    out.push({ id: 'exam.today', source: 'exam', kind: 'mock', mock: true, done: true, title: `${def ? def.name : a.module} · ${t('exam.test', { n: a.day })}`,
      detail: t('plan.mock.submitted'), minutes: def ? def.minutes : 30, href: `#/exam/${a.day}`, priority: 30 });
    return out;
  }
  const next = nextModule({ exam, modules: settings.exam.modules, attempts, drafts: store.get('exams.drafts', {}) });
  if (!next) return out;
  const def = exam.modules.find((/** @type {any} */ x) => x.id === next.module);
  out.push({
    id: 'exam.next', source: 'exam', kind: 'mock', mock: true, title: `${def.name} · ${t('exam.test', { n: next.test })}`,
    detail: t('plan.mock.detail', { min: def.minutes }), minutes: def.minutes, href: `#/exam/${next.test}/${next.module}`, priority: 30,
    action: t('plan.mock.action', { module: def.name, min: def.minutes }),
  });
  return out;
}

/** Uncorrected Schreiben and unread corrections. @param {import('../contract.js').PlanCtx} ctx */
export function todayFeedback({ store, exam, t }) {
  if (!exam) return [];
  const rows = [];
  const seen = new Set(store.get('exams.seen', []) || []);
  for (const f of store.get('exams.feedbackLocal', []) || []) {
    if (!f || seen.has(f.id)) continue;
    rows.push({ id: `fb.${f.id}`, title: `${f.module === 'sprechen' ? 'Sprechen' : 'Schreiben'} · ${t('exam.test', { n: f.day })}`, status: t('feedback.new'), href: `#/exam/${f.day}/${f.module}`, action: t('feedback.read') });
  }
  const pending = store.attempts().filter((/** @type {any} */ a) => a.examId === exam.id && a.module === 'schreiben' && a.score == null && (a.writings || []).length)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.day - b.day);
  for (const a of pending) {
    rows.push({ id: `uncorrected.${a.id}`, title: `Schreiben · ${t('exam.test', { n: a.day })}`, status: t('feedback.notCorrected'),
      href: `#/exam/${a.day}/schreiben/review/${a.id}`, action: t('feedback.correct') });
  }
  return rows;
}

/** Latest score per module against the pass line. @param {import('../contract.js').PlanCtx} ctx */
export function todayModules({ store, settings, exam }) {
  if (!exam) return [];
  const attempts = store.attempts().filter((/** @type {any} */ a) => a.examId === exam.id && a.score != null)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
  return exam.modules.filter((/** @type {any} */ m) => settings.exam.modules.includes(m.id)).map((/** @type {any} */ m) => {
    const a = attempts.find((/** @type {any} */ x) => x.module === m.id);
    return { id: m.id, name: m.name, score: a ? a.score : null, max: m.max, pass: m.pass, href: '#/exam' };
  });
}
