/* Practice: grading one typed answer. Pure; tested in node. Ported from Igloo's b1.js gradeAnswer(): match.js with
   the B1 options (endings, umlauts, strict words, capitals from the noun list), then the sticky-error detectors
   (detect.js), then the answer to show and the other accepted answers. */
import * as Match from '../../domain/match.js';
import * as Detect from '../../domain/detect.js';

/** @param {string} s */
export const norm = s => Match.fold(String(s).toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Noun capitalisation reference: the noun list plus every non-initial word of the model answers. */
function caseRef(/** @type {any} */ it, /** @type {Record<string, string>} */ nouns) {
  const m = new Map(Object.entries(nouns || {}).map(([k, v]) => [Match.fold(k), v]));
  for (const s of [it.model, ...(it.moves || []).map((/** @type {any} */ x) => x.model)].filter(Boolean)) {
    String(s).normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => Match.words(sent).forEach((/** @type {any} */ w, /** @type {number} */ i) => { if (i) m.set(w.n, w.raw); }));
  }
  return m;
}
const refCache = new WeakMap();

/**
 * @typedef {object} Grade
 * @property {boolean} ok          accepted and no detector fired
 * @property {boolean} matchOk     accepted by the matcher (detectors aside)
 * @property {{cls: string, hint: string, word?: string} | null} det
 * @property {string} input
 * @property {any[]} typos @property {any[]} capMiss @property {any[]} umlautMiss
 * @property {string} right        the answer to show (closest accepted when wrong)
 * @property {string[]} alsoCorrect
 * @property {boolean} primary     exactly the first accepted answer
 * @property {string | null} detRule
 */

/**
 * @param {any} item
 * @param {string} input
 * @param {any} [move]    for reply items: the move the learner picked
 * @param {{nouns?: Record<string, string>, traps?: Map<string, any>}} [data]
 * @returns {Grade}
 */
export function gradeAnswer(item, input, move = null, data = {}) {
  const it = move ? { ...item, accept: move.accept, model: move.model, anywhere: true, fn: move.fn } : item;
  const accepted = it.gap ? Match.acceptedForGap(it.prompt, it.accept) : it.accept;
  let ref = refCache.get(it);
  if (!ref) { ref = caseRef(it, data.nouns || {}); refCache.set(it, ref); }
  /** @type {any} */
  const o = { anywhere: !!it.anywhere, slotMax: 10, endings: true, umlaut: true, strict: it.strict || [], caseRef: ref, strictCase: !!it.strictCase };
  if (it.loose || it.gap) o.loose = Match.gapLoose(it.prompt);
  const r = Match.check(input, accepted, o);
  const det = Detect.run(input, it, r);
  const own = new Set(it.accept || []);
  const render = (/** @type {string} */ p) => it.gap ? (own.has(p) ? (Match.gapFill(it.prompt, p)?.text || p) : p) : it.literal ? p : Match.renderPattern(p, it.model);
  let right = it.model;
  if (!r.ok && r.nearest != null && r.nearest > 0) right = render(accepted[r.nearest]);
  const shown = new Set([norm(r.ok ? r.input : right)]);
  /** @type {string[]} */ const also = [];
  for (const p of (it.gap ? it.accept : accepted)) {
    const s = render(p); const k = norm(s);
    if (shown.has(k) || (/…/.test(s) && it.kind !== 'topic' && it.kind !== 'reply' && it.anywhere === false)) continue;
    shown.add(k); also.push(s);
  }
  if (r.ok && it.model && !shown.has(norm(it.model))) also.unshift(it.model);
  const detRule = det ? data.traps?.get(det.cls)?.rule || null : null;
  return {
    ok: r.ok && !det, matchOk: r.ok, det, input: r.input, typos: r.typos || [], capMiss: r.capMiss || [], umlautMiss: r.umlautMiss || [],
    right, alsoCorrect: also.slice(0, 8), primary: !!(r.ok && r.matched === accepted[0] && r.exact), detRule,
  };
}
