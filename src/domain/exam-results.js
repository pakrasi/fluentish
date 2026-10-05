/* Result-file adapters: what an exam attempt, a recording and a correction become as files for the results target.
   An exam definition names its adapter (exam-def@1 `results.adapter`); the exam feature shapes an attempt with it
   and the results target (data/sync/github-b1exam.js) names the files with it. Pure: no DOM, no clock, no storage.

   b1-exam-sync@1 is the format the Mac's scripts/sync.py imports (pakrasi/b1-exam): the B1 exam app's attempt shape
   and the names data/attempts/<stamp>-dayNN-<module>.json, data/voice/dayNN/<stamp>-<module>-<part>.<ext> and
   data/feedback-ai/<stamp>-dayNN-<module>.json. Its bytes are pinned by tests/vectors/exam-results.b1-exam.json
   (captured before this module existed) and by the contract test that runs the real sync.py
   (tests/unit/exam-sync.test.mjs). Any exam whose module ids and day numbers sync.py accepts can use it. */

const pad2 = (/** @type {number | string} */ n) => String(n).padStart(2, '0');

/**
 * @typedef {{
 *   id: string,
 *   attemptFile: (a: any) => any,
 *   attemptName: (file: any, stamp: string) => string,
 *   voiceStem: (p: any, stamp: string) => string,
 *   feedbackName: (p: any, stamp: string) => string,
 * }} ResultAdapter
 *   attemptFile: the stored attempt → the file's JSON value; *Name/*Stem: repository paths (voiceStem without the
 *   audio extension, which the target adds)
 */

/** @type {ResultAdapter} */
export const b1ExamSync = {
  id: 'b1-exam-sync@1',
  /** An attempt record as the B1 exam app's attempt file. @param {any} a */
  attemptFile(a) {
    const meta = { ...(a.meta || {}), source: 'remote' };
    return {
      id: a.id, day: a.day, module: a.module, started_at: a.started_at ?? null, submitted_at: a.submitted_at, duration_s: a.duration_s ?? null,
      score: a.score ?? null, max_score: a.max_score, meta,
      responses: (a.responses || []).map((/** @type {any} */ r) => ({ item_id: r.item_id, teil: r.teil, skill: r.skill, given: r.given ?? null, correct: r.correct, is_correct: r.is_correct ? 1 : 0 })),
      writings: (a.writings || []).map((/** @type {any} */ w) => ({ aufgabe: w.aufgabe, text: w.text ?? '', word_count: w.word_count ?? 0 })),
    };
  },
  attemptName: (file, s) => `data/attempts/${s}-day${pad2(file.day)}-${file.module}.json`,
  voiceStem: (p, s) => `data/voice/day${pad2(p.day)}/${s}-${p.module}-${p.part}`,
  feedbackName: (p, s) => `data/feedback-ai/${s}-day${pad2(p.day)}-${p.module}.json`,
};

/** Adapters by id. A new result format is one entry here, named by the definitions that use it. */
export const ADAPTERS = /** @type {Record<string, ResultAdapter>} */ ({ [b1ExamSync.id]: b1ExamSync });

/** The adapter an exam definition names. Throws for an unknown id, so a definition never writes files silently wrong. @param {any} def */
export function adapterFor(def) {
  const id = def?.results?.adapter;
  const a = id ? ADAPTERS[id] : null;
  if (!a) throw new Error(`exam ${def?.id}: no result-file adapter ${id}`);
  return a;
}
