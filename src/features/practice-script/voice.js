/* Script mode: the device's German voice for Listen and the per-sentence play buttons. Unlike Practice's speech.say()
   it reports word boundaries and the end of each sentence, and takes a speed, so read-along can follow and pause
   after each sentence for his own repetition. Uses the same voice choice as practice/speech.js. */

const w = /** @type {any} */ (globalThis);

/**
 * A German voice that runs on the device. A script is private (§8): a cloud voice ("Google Deutsch" on Chrome for
 * Windows, ChromeOS and Android has localService false) would send its text to a server, so only local voices are used
 * (audit P2-2). With none, Listen and Play are off and the note says how to add one.
 * @returns {any | null}
 */
function voice() {
  if (!('speechSynthesis' in w)) return null;
  const vs = w.speechSynthesis.getVoices().filter((/** @type {any} */ v) => v.localService !== false);
  return vs.find((/** @type {any} */ v) => v.lang.replace('_', '-') === 'de-DE') || vs.find((/** @type {any} */ v) => /^de/i.test(v.lang)) || null;
}

/** A German voice is there (Safari fills the list late: call again after voiceschanged). */
export const hasVoice = () => !!voice();

/** Calls fn once the voice list changes (Safari loads it asynchronously). @param {() => void} fn */
export function onVoices(fn) {
  if (!('speechSynthesis' in w)) return () => {};
  w.speechSynthesis.addEventListener?.('voiceschanged', fn);
  return () => w.speechSynthesis.removeEventListener?.('voiceschanged', fn);
}

/**
 * Speak one text. Resolves when it ends (or is cancelled) with how long it took.
 * @param {string} text
 * @param {{rate?: number, onWord?: (charIndex: number, length: number) => void}} [o]
 * @returns {{done: Promise<{ms: number, ended: boolean}>, cancel: () => void}}
 */
export function say(text, { rate = 0.9, onWord } = {}) {
  const v = voice();
  if (!v) return { done: Promise.resolve({ ms: 0, ended: false }), cancel() {} };
  w.speechSynthesis.cancel();
  const u = new w.SpeechSynthesisUtterance(String(text));
  u.voice = v; u.lang = v.lang; u.rate = rate;
  const t0 = performance.now();
  let settle = (/** @type {boolean} */ _ended) => {};
  const done = new Promise(resolve => { settle = ended => resolve({ ms: performance.now() - t0, ended }); });
  u.onend = () => settle(true);
  u.onerror = () => settle(false);
  if (onWord) u.onboundary = (/** @type {any} */ e) => { if (e.name === 'word' || e.name === undefined) onWord(e.charIndex, e.charLength || 0); };
  w.speechSynthesis.speak(u);
  return { done, cancel: () => { try { w.speechSynthesis.cancel(); } catch { /* none */ } settle(false); } };
}

/** Stop any speech. */
export function hush() { try { w.speechSynthesis?.cancel(); } catch { /* none */ } }
