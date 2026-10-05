/* Mock exams: grading and the small pure helpers the exam screens, Today and the sync share. Generic over exam
   definitions (exam-def@1, domain/examdef.js): the items, their types, the values a result row stores and the pass
   share all come from the definition. For Goethe B1 that gives the B1 exam app's answerKey/grade (app.js, server.py
   answer_key) exactly, with the same item ids, values ('r'/'f', 'a'/'b'/'c', 'ja'/'nein', ad letters, 'mod'/'a'/'b')
   and result rows, because sync.py imports the rows as they are (tests/vectors/exam.goethe-b1.json, captured before
   the change, holds every output). Pure: no DOM, no clock, no storage. Tested in node (tests/unit/exam-grade.test.mjs). */
import { objectiveItems, correctValue, itemText, section } from './examdef.js';

/** @typedef {{ item_id: string, teil: string, skill: string, given: string | null, correct: string, is_correct: 0 | 1 }} Response */
/** @typedef {Record<string, [string, string, string]>} AnswerKey  item id → [correct value, Teil code, skill] */

/** The Goethe B1 modules, for callers without a definition at hand (the sync's B1 exam app shapes). */
export const MODULES = /** @type {const} */ (['lesen', 'hoeren', 'schreiben', 'sprechen']);
export const OBJECTIVE = /** @type {const} */ (['lesen', 'hoeren']);
/** The pass share when a definition gives none. */
export const PASS_SHARE = 0.6;

/**
 * Every objective item of a test → [correct, Teil, skill] (for Goethe B1, server.answer_key).
 * @param {any} ex a test of the exam (goethe-b1-exam@1 for Goethe B1) @param {any} def its exam-def@1
 * @returns {AnswerKey}
 */
export function answerKey(ex, def) {
  /** @type {AnswerKey} */ const key = {};
  for (const it of objectiveItems(def, ex)) key[it.id] = [correctValue(def, it.type, it.item), it.part.id, it.item.skill];
  return key;
}

/** Answer as stored: trimmed, lower case; empty → null. @param {unknown} v */
export const normAnswer = v => (v === undefined || v === null || v === '' ? null : String(v).trim().toLowerCase());

/**
 * Grade one objective module. Items left blank count as wrong.
 * @param {AnswerKey} key @param {string} module a section id @param {Record<string, unknown>} answers @param {any} def
 * @returns {{ score: number, max_score: number, by_teil: Record<string, {score: number, max: number}>, results: Response[] }}
 */
export function grade(key, module, answers, def) {
  const teile = new Set((section(def, module)?.parts || []).map((/** @type {any} */ p) => p.id));
  /** @type {Response[]} */ const results = [];
  let score = 0;
  for (const [id, [correct, teil, skill]] of Object.entries(key)) {
    if (!teile.has(teil)) continue;
    const given = normAnswer(answers ? answers[id] : null);
    const ok = given === correct.toLowerCase();
    if (ok) score++;
    results.push({ item_id: id, teil, skill, given, correct, is_correct: ok ? 1 : 0 });
  }
  /** @type {Record<string, {score: number, max: number}>} */ const by_teil = {};
  for (const r of results) { const t = (by_teil[r.teil] ||= { score: 0, max: 0 }); t.max++; t.score += r.is_correct; }
  return { score, max_score: results.length, by_teil, results };
}

/**
 * Item ids per part in exam order (tab counts and the submit summary).
 * @param {any} ex @param {string} module @param {any} def @returns {string[][]}
 */
export function teilIds(ex, module, def) {
  const ids = objectiveItems(def, ex, module);
  return (section(def, module)?.parts || []).map((/** @type {any} */ p) => ids.filter(it => it.part === p).map(it => it.id));
}

/** How many of these ids have an answer. @param {string[]} ids @param {Record<string, unknown>} answers */
export const answeredIn = (ids, answers) => ids.filter(id => normAnswer(answers[id]) !== null).length;

/**
 * Item id → number as printed in the exam (each part's `first` on; Goethe B1: L1 1–6 … L5 27–30, H1 1–10 … H4 23–30)
 * and its text.
 * @param {any} ex @param {any} def @returns {Record<string, {nr: number, text: string}>}
 */
export function itemInfo(ex, def) {
  /** @type {Record<string, {nr: number, text: string}>} */ const m = {};
  for (const it of objectiveItems(def, ex)) m[it.id] = { nr: it.nr, text: itemText(def, it) };
  return m;
}

/** Words in a text, as the B1 exam app and server.py count them. @param {string | null | undefined} t */
export const wordCount = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;

/** Correct and total per skill, weakest first (only skills with a miss). @param {Response[]} responses */
export function weakSkills(responses) {
  /** @type {Record<string, [number, number]>} */ const s = {};
  for (const r of responses || []) { const x = (s[r.skill] ||= [0, 0]); x[0] += r.is_correct ? 1 : 0; x[1]++; }
  return Object.entries(s).filter(([, v]) => v[0] < v[1]).sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1]);
}

/** Correct/total per Teil code. @param {Response[]} responses @returns {Record<string, [number, number]>} */
export function byTeil(responses) {
  /** @type {Record<string, [number, number]>} */ const t = {};
  for (const r of responses || []) { const x = (t[r.teil] ||= [0, 0]); x[0] += r.is_correct ? 1 : 0; x[1]++; }
  return t;
}

/**
 * Whether a score passes: at least the definition's share of the maximum (Goethe B1: 60 %).
 * @param {number | null | undefined} score @param {number} max @param {number} [share] exam-def scoring.passShare
 */
export const passes = (score, max, share = PASS_SHARE) => score != null && max > 0 && score / max >= share;

/* ---------- feedback (Fritz's corrections and one-click corrections) ---------- */

/** The "! circa 62 / 100 · bestanden" line of a correction, without the "! ". @param {string} body */
export function scoreLine(body) { const m = /^!\s*(.+)$/m.exec(String(body || '')); return m ? m[1].trim() : null; }

/** 62 from "circa 62 / 100 · …", or null. @param {string | null} line */
export function scoreNum(line) { const m = /(\d+)\s*\/\s*100/.exec(line || ''); return m ? Number(m[1]) : null; }

/** ms since the epoch for an ISO stamp; stamps without a zone from the phone app are UTC. @param {string | null | undefined} iso @param {boolean} [utc] */
export function stampMs(iso, utc = false) {
  if (!iso) return 0;
  const s = String(iso);
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return new Date(`${s}T00:00:00`).getTime() || 0;
  const zoned = /(Z|[+-]\d\d:?\d\d)$/.test(s);
  const t = new Date(zoned || !utc ? s : `${s}Z`).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Ids an attempt is known by: its own id, the legacy id from the B1 exam app and the Mac's database id (alias).
 * @param {any} a @returns {string[]}
 */
export const attemptIds = a => [a?.id, a?.legacy?.id, a?.alias, a?.attempt_id].filter(x => x != null && x !== '').map(String);

/** Feedback written for exactly this attempt. @param {any} f @param {any} a */
export const sameAttempt = (f, a) => f.attempt_id != null && attemptIds(a).includes(String(f.attempt_id));

/**
 * Split a module's feedback into the current attempt's and older ones. Rows without attempt_id (older CLI runs) count
 * for an attempt only if written after it and no newer attempt of that module exists. Newest first.
 * @param {any[]} feedback @param {string} module @param {any} attempt @param {any[]} attempts
 * @returns {{ cur: any[], older: any[] }}
 */
export function fbSplit(feedback, module, attempt, attempts) {
  const all = (feedback || []).filter(f => f && f.module === module)
    .sort((x, y) => stampMs(y.created_at) - stampMs(x.created_at) || (Number(y.id) || 0) - (Number(x.id) || 0));
  if (!attempt) return { cur: [], older: all };
  const at = stampMs(attempt.submitted_at, attempt.source === 'remote');
  const mine = new Set(attemptIds(attempt));
  const newer = (attempts || []).some(x => x.module === module && !attemptIds(x).some(i => mine.has(i)) && stampMs(x.submitted_at, x.source === 'remote') > at);
  const cur = all.filter(f => (f.attempt_id != null ? sameAttempt(f, attempt) : !newer && stampMs(f.created_at) >= at));
  return { cur, older: all.filter(f => !cur.includes(f)) };
}

/**
 * Corrections in a feedback body: lines "~~wrong~~ → ==right==" with the "_why_" line under them.
 * Each becomes a practice item ("Rewrite this correctly").
 * @param {string} body @returns {{ wrong: string, right: string, rule: string }[]}
 */
export function corrections(body) {
  const lines = String(body || '').split('\n');
  /** @type {{ wrong: string, right: string, rule: string }[]} */ const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*~~(.+?)~~\s*→\s*==(.+?)==/.exec(lines[i]);
    if (!m) continue;
    const why = [];
    while (i + 1 < lines.length && /^\s*_.+_\s*$/.test(lines[i + 1])) why.push(lines[++i].trim().replace(/^_|_$/g, ''));
    out.push({ wrong: m[1].trim(), right: m[2].trim(), rule: why.join(' ') });
  }
  return out;
}

/* ---------- which module next ---------- */

/**
 * The latest attempt per test and module, from local attempts and the synced results. Local and synced copies of the
 * same attempt (same repo file) count once; the newer submission wins.
 * @param {any[]} attempts @returns {Map<string, any>} key `${test}:${module}`
 */
export function latestByTestModule(attempts) {
  /** @type {Map<string, any>} */ const m = new Map();
  for (const a of attempts || []) {
    if (!a || !Number.isInteger(a.day)) continue;
    const k = `${a.day}:${a.module}`;
    const cur = m.get(k);
    if (!cur || stampMs(a.submitted_at, a.source === 'remote') >= stampMs(cur.submitted_at, cur.source === 'remote')) m.set(k, a);
  }
  return m;
}
