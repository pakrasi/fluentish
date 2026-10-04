/* Exam modules from the learner's results: the latest score of each module and the weakest one. Pure; tested in node.

   Practice reads this to give Schreiben its share of the day while it is the weakest module (domain/budget.js
   writingBudget). It reads what is in the store without loading content or importing the Exam feature:
     - attempts (this device) and the synced results (exams.remote.results: days → module → attempt), with score and
       max_score for Lesen and Hören
     - corrections (exams.remote.feedback and exams.feedbackLocal) for Schreiben and Sprechen, whose score is the
       "! circa NN / 100" line of the newest correction of that module
   Scores are compared as a share of the module's maximum. A module with no score (not taken, or not scored yet) is
   left out of the ranking: an unscored Sprechen never pushes a failing Schreiben out of the plan.

   Schreiben gets its share of the day (writingFocus) while it has no score, scores under the pass line (60 %), or
   scores lowest of the modules with a score. */
import { scoreLine, scoreNum, stampMs } from './grade.js';

export const MODULES = ['lesen', 'hoeren', 'schreiben', 'sprechen'];

/**
 * @typedef {object} ModuleScore
 * @property {number | null} pct   latest score ÷ maximum, null when taken but not scored
 * @property {number} at           when that score was made (ms), 0 when unknown
 */

/**
 * The latest score per module.
 * @param {{attempts?: any[], results?: any, feedback?: any[], examId?: string}} o
 *   attempts: store.attempts(); results: exams.remote.results ({days: {n: {attempts: {module: attempt}}}});
 *   feedback: Mac and local corrections ({module, body, created_at})
 * @returns {Record<string, ModuleScore>}
 */
export function moduleScores({ attempts = [], results = null, feedback = [], examId = 'goethe-b1' }) {
  /** @type {Record<string, ModuleScore>} */ const out = {};
  const put = (/** @type {string} */ m, /** @type {number | null} */ pct, /** @type {number} */ at) => {
    const cur = out[m];
    if (!cur || (pct != null && (cur.pct == null || at >= cur.at))) out[m] = { pct, at };
  };
  const take = (/** @type {any} */ a, /** @type {string} */ module, /** @type {boolean} */ utc) => {
    if (!a || !MODULES.includes(module)) return;
    const at = stampMs(a.submitted_at || a.createdAt, utc);
    const max = a.max_score || a.maxScore || 0;
    put(module, a.score != null && max > 0 ? a.score / max : null, at);
  };
  for (const a of attempts || []) if (a && !a.deletedAt && (!a.examId || a.examId === examId)) take(a, a.module, false);
  for (const d of Object.values((results && results.days) || {})) {
    for (const [module, a] of Object.entries(/** @type {any} */ (d).attempts || {})) take(a, module, true);
  }
  for (const f of feedback || []) {
    if (!f || !MODULES.includes(f.module)) continue;
    const n = scoreNum(scoreLine(f.body));
    if (n != null) put(f.module, n / 100, stampMs(f.created_at));
  }
  return out;
}

export const PASS = 0.6;

/**
 * The weakest module among those of the exam goal that have a score: the lowest latest share (ties: the productive
 * module). Null when none has a score.
 * @param {Record<string, ModuleScore>} scores @param {string[]} [modules]
 */
export function weakestModule(scores, modules = MODULES) {
  const ranked = modules.filter(m => scores[m] && scores[m].pct != null).map(m => ({ m, p: /** @type {number} */ (scores[m].pct) }))
    .sort((a, b) => a.p - b.p || MODULES.indexOf(b.m) - MODULES.indexOf(a.m));
  return ranked.length ? ranked[0].m : null;
}

/**
 * Whether Schreiben gets its share of the day: the exam goal has it, the exam is ahead, and Schreiben has no score,
 * scores under the pass line or scores lowest.
 * @param {{store: any, c: {phase: string}, settings: any}} ctx
 */
export function writingFocus({ store, c, settings }) {
  const goal = settings?.exam?.type ? (settings.exam.modules?.length ? settings.exam.modules : MODULES) : [];
  if (!goal.includes('schreiben') || !['week', 'lastNew', 'eve'].includes(c.phase)) return false;
  const remote = store.get('exams.remote', {}) || {};
  const scores = moduleScores({
    attempts: typeof store.attempts === 'function' ? store.attempts() : [],
    results: remote.results || null,
    feedback: [...((remote.feedback && remote.feedback.feedback) || []), ...(store.get('exams.feedbackLocal', []) || [])],
    examId: settings.exam.type,
  });
  return needsWork(scores, goal);
}

/** Schreiben has no score, is under the pass line, or is the weakest scored module. @param {Record<string, ModuleScore>} scores @param {string[]} goal */
export function needsWork(scores, goal = MODULES) {
  const s = scores.schreiben;
  return !s || s.pct == null || s.pct < PASS || weakestModule(scores, goal) === 'schreiben';
}
