/* How far a speech recogniser's result can be trusted, and the microphone's level. Pure (no DOM, no recogniser, no
   clock reads); tested in node (tests/unit/hearing.test.mjs). services/speech.js feeds it; the views read its verdicts.

   rms(samples) / toDb(rms) / meter(db)   a frame's level: root mean square, dBFS (−100 floor), 0..1 for the meter bar
   ambient(dbs)                           ~1 s of frames before listening → {db, peak, loud, gusty, noisy}
   floor(dbs)                             the quietest fifth of frames while listening (the noise under his voice)
   shouldRestart(s)                       restart a recogniser that ended early, inside one attempt?
   candidates(results)                    every transcript the alternatives allow, best guess first
   best(cands, score)                     the candidate the caller scores highest (ties: the recogniser's order)
   trust({text, confidence, expected, ambient, restarts})
                                          {unsure, why}: when unsure, a failed check is never shown as wrong

   The thresholds are first guesses from the level meter's scale, logged with every noisy attempt (kv speech.log) so they
   can be tuned on the street (docs/IOS-CHECKS.md › Speaking outdoors). */
// @ts-check

/** @typedef {{text: string, confidence: number | null}} Alt  one candidate transcript; confidence null: not given */
/** @typedef {{db: number, peak: number, loud: boolean, gusty: boolean, noisy: boolean}} Ambient */

export const NOISE = Object.freeze({
  loudDb: -42,      // median ambient level at or above this: loud (a street, a café)
  gustDb: -28,      // the 90th percentile at or above this …
  gustSpread: 12,   // … and this far above the median: gusts (wind on the mic)
  minFrames: 5,     // fewer frames than this: no verdict
  lowConf: 0.5,     // a final result's confidence under this: unsure (0 or missing: not given)
});
export const RESTART = Object.freeze({ tap: 2, hold: 6, windowMs: 12000 });
/** Errors that mean the microphone or the service refused: a restart would only fail again. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'bad-grammar', 'audio-capture']);

/** @param {ArrayLike<number>} samples floats in −1..1 */
export function rms(samples) {
  const n = samples.length;
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / n);
}
/** dBFS of an RMS value, floored at −100. @param {number} r */
export const toDb = r => (r > 0 ? Math.max(-100, 20 * Math.log10(r)) : -100);
/** The meter bar: −70 dBFS (a quiet room) is empty, −10 dBFS (a shout at the mic) is full. @param {number} db */
export const meter = db => Math.max(0, Math.min(1, (db + 70) / 60));

/** @param {number[]} xs sorted @param {number} p 0..1 */
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];

/**
 * The room before he speaks. null when there are too few frames or only digital silence (the meter could not open).
 * @param {number[]} dbs one dBFS value a frame
 * @returns {Ambient | null}
 */
export function ambient(dbs) {
  const xs = (dbs || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (xs.length < NOISE.minFrames) return null;
  if (xs[xs.length - 1] <= -100) return null;   // digital silence: the meter read nothing (a suspended audio context), not a quiet room
  const db = pct(xs, 0.5), peak = pct(xs, 0.9);
  const loud = db >= NOISE.loudDb;
  const gusty = peak >= NOISE.gustDb && peak - db >= NOISE.gustSpread;
  return { db: Math.round(db), peak: Math.round(peak), loud, gusty, noisy: loud || gusty };
}

/** The noise under his voice while listening: the quietest fifth of frames. @param {number[]} dbs */
export function floor(dbs) {
  const xs = (dbs || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  return xs.length < NOISE.minFrames ? null : Math.round(pct(xs, 0.2));
}

/**
 * Restart the recogniser inside one attempt? Hold to talk keeps listening until he lets go; a tap retries a session
 * that ended with nothing heard, a few times, inside the window.
 * @param {{stopped: boolean, error: string | null, text: string, restarts: number, elapsedMs: number, hold?: boolean}} s
 */
export function shouldRestart({ stopped, error, text, restarts, elapsedMs, hold = false }) {
  if (stopped) return false;
  if (error && FATAL.has(error)) return false;
  if (hold) return restarts < RESTART.hold;
  return !text && restarts < RESTART.tap && elapsedMs < RESTART.windowMs;
}

/**
 * Every transcript the alternatives allow: the recogniser's best guess first, then each result with one of its other
 * alternatives swapped in (a phrase is usually one result; a long answer two or three). At most `max`.
 * @param {{alts: Alt[]}[]} results final results in order
 * @param {number} [max]
 * @returns {Alt[]}
 */
export function candidates(results, max = 12) {
  const rs = (results || []).filter(r => r && r.alts && r.alts.length);
  if (!rs.length) return [];
  const join = (/** @type {Alt[]} */ pick) => ({
    text: pick.map(a => a.text.trim()).filter(Boolean).join(' '),
    confidence: pick.every(a => a.confidence != null) ? Math.min(...pick.map(a => /** @type {number} */ (a.confidence))) : null,
  });
  const top = rs.map(r => r.alts[0]);
  /** @type {Alt[]} */ const out = [join(top)];
  for (let i = 0; i < rs.length && out.length < max; i++) {
    for (let k = 1; k < rs[i].alts.length && out.length < max; k++) {
      const pick = top.slice(); pick[i] = rs[i].alts[k];
      const c = join(pick);
      if (c.text && !out.some(o => o.text === c.text)) out.push(c);
    }
  }
  return out.filter(c => c.text);
}

/**
 * The candidate that scores highest; ties keep the recogniser's order.
 * @template T
 * @param {Alt[]} cands @param {(text: string) => {score: number, value: T}} score
 * @returns {{alt: Alt, value: T, index: number} | null}
 */
export function best(cands, score) {
  /** @type {{alt: Alt, value: T, index: number, s: number} | null} */ let top = null;
  cands.forEach((alt, index) => {
    const r = score(alt.text);
    if (!top || r.score > top.s) top = { alt, value: r.value, index, s: r.score };
  });
  if (!top) return null;
  const { alt, value, index } = /** @type {{alt: Alt, value: T, index: number}} */ (top);
  return { alt, value, index };
}

const fold = (/** @type {unknown} */ s) => String(s || '').normalize('NFC').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const toks = (/** @type {unknown} */ s) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * Can this transcript be graded against the expected answer? Unsure when the recogniser said so (low confidence), when
 * it looks garbled (no letters, mostly single letters, a word or two where a sentence was expected), or when the room
 * was loud and little of the expected answer came through. A clean, confident wrong answer stays gradable.
 * @param {{text: string, confidence?: number | null, expected?: string, ambient?: Ambient | null, restarts?: number}} o
 * @returns {{unsure: boolean, why: ('confidence' | 'garbled' | 'noise')[]}}
 */
export function trust({ text, confidence = null, expected = '', ambient: amb = null, restarts = 0 }) {
  /** @type {('confidence' | 'garbled' | 'noise')[]} */ const why = [];
  const t = toks(text), want = toks(expected);
  if (confidence != null && confidence > 0 && confidence < NOISE.lowConf) why.push('confidence');
  const singles = t.filter(w => w.length === 1).length;
  if (!t.length || !/\p{L}/u.test(text) || (t.length >= 3 && singles / t.length >= 0.4) || (want.length >= 5 && t.length <= 2)) why.push('garbled');
  if ((amb?.noisy || restarts > 0) && want.length) {
    const have = new Set(t);
    const overlap = want.filter(w => have.has(w)).length / want.length;
    if (overlap < 0.5) why.push('noise');
  }
  return { unsure: why.length > 0, why };
}
