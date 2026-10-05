/* Text to speech: the device's voices, behind one interface (Arch #8), so the iOS shell can swap in AVSpeechSynthesizer
   with setVoice() and every caller stays as it is. Every call takes a BCP-47 tag (core/lang.js bcp47()).

     canSay(bcp47, o)                       a voice for this language is there
     say(text, bcp47, { prefer, avoid, rate, localOnly, onWord, onStart })
                                            → { done: Promise<{ms, ended}>, started: Promise<boolean>, cancel() },
                                              or null when there is no voice (the caller says so)
     hush()                                 stop speaking
     unlock()                               inside a tap: a silent utterance, so a later say() outside the gesture is
                                            allowed on iOS
     onVoices(fn)                           the voice list changed (Safari fills it late)
     warm()                                 load the voice list early

   Which voice: one whose language matches the tag's language. A name that matches `prefer` (the language's list in
   core/lang.js unless the caller passes one) wins, then the exact region, then the first. Voices that read several
   languages with one accent ("Multilingual") are never used, and neither is a name matching `avoid`. `localOnly` keeps
   voices that run on the device (a script is private: a cloud voice would send its text to a server). */
import { voicePrefsFor, MULTILINGUAL } from '../core/lang.js';

/** @typedef {{ prefer?: RegExp | null, avoid?: RegExp | null, localOnly?: boolean }} VoiceChoice */
/** @typedef {VoiceChoice & { rate?: number, onWord?: (charIndex: number, length: number) => void, onStart?: () => void }} SayOptions */
/** @typedef {{ done: Promise<{ms: number, ended: boolean}>, started: Promise<boolean>, cancel: () => void }} Saying */
/** @typedef {{ name: string, lang: string, localService?: boolean }} VoiceLike */

/** How long a voice may take to start before started resolves false. */
export const VOICE_START_MS = 1500;

const g = /** @type {any} */ (globalThis);
const synth = () => /** @type {any} */ (g.speechSynthesis || null);
const norm = (/** @type {string} */ l) => String(l || '').replace('_', '-').toLowerCase();

/**
 * The voice to use for a tag, from a list (pure, for tests).
 * @param {VoiceLike[]} list @param {string} tag @param {VoiceChoice} [o]
 * @returns {VoiceLike | null}
 */
export function pickVoice(list, tag, o = {}) {
  const want = norm(tag), base = want.split('-')[0];
  const cfg = voicePrefsFor(tag);
  const prefer = o.prefer === undefined ? cfg.prefer : o.prefer;
  const avoid = o.avoid === undefined ? cfg.avoid : o.avoid;
  const ok = (list || []).filter(v => {
    const l = norm(v.lang);
    if (l !== base && !l.startsWith(base + '-')) return false;
    if (MULTILINGUAL.test(v.name || '')) return false;
    if (avoid && avoid.test(v.name || '')) return false;
    if (o.localOnly && v.localService === false) return false;
    return true;
  });
  if (!ok.length) return null;
  const score = (/** @type {VoiceLike} */ v) => (prefer && prefer.test(v.name || '') ? 2 : 0) + (norm(v.lang) === want ? 1 : 0);
  let best = ok[0];
  for (const v of ok) if (score(v) > score(best)) best = v;
  return best;
}

/** @param {string} tag @param {VoiceChoice} [o] */
function voiceFor(tag, o) {
  const s = synth();
  if (!s || typeof s.getVoices !== 'function') return null;
  try { return pickVoice(s.getVoices(), tag, o); } catch { return null; }
}

/** The web implementation (speechSynthesis). */
export function webVoice() {
  let unlocked = false;
  return {
    /** @param {string} tag @param {VoiceChoice} [o] */
    canSay: (tag, o) => !!voiceFor(tag, o),
    /**
     * @param {string} text @param {string} tag @param {SayOptions} [o]
     * @returns {Saying | null}
     */
    say(text, tag, o = {}) {
      const v = voiceFor(tag, o);
      const s = synth();
      if (!v || !s || typeof g.SpeechSynthesisUtterance === 'undefined') return null;
      try { s.cancel(); } catch { /* none */ }
      const u = new g.SpeechSynthesisUtterance(String(text));
      u.voice = v; u.lang = v.lang; u.rate = o.rate ?? 0.95;
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      let settle = (/** @type {boolean} */ _ended) => {};
      const done = /** @type {Promise<{ms: number, ended: boolean}>} */ (new Promise(resolve => { settle = ended => resolve({ ms: now() - t0, ended }); }));
      let start = (/** @type {boolean} */ _ok) => {};
      const started = /** @type {Promise<boolean>} */ (new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), VOICE_START_MS);
        start = ok => { clearTimeout(timer); resolve(ok); };
      }));
      u.onstart = () => { start(true); try { o.onStart?.(); } catch { /* the caller's problem */ } };
      u.onend = () => { start(false); settle(true); };
      u.onerror = () => { start(false); settle(false); };
      const onWord = o.onWord;
      if (onWord) u.onboundary = (/** @type {any} */ e) => { if (e.name === 'word' || e.name === undefined) onWord(e.charIndex, e.charLength || 0); };
      s.speak(u);
      return { done, started, cancel: () => { try { s.cancel(); } catch { /* none */ } start(false); settle(false); } };
    },
    hush() { try { synth()?.cancel(); } catch { /* none */ } },
    unlock() {
      const s = synth();
      if (unlocked || !s || typeof g.SpeechSynthesisUtterance === 'undefined') return;
      const ua = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).userActivation : null;
      if (ua && !ua.isActive) return;   // not inside a tap: try again on the next one
      try { const u = new g.SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u); unlocked = true; } catch { /* none */ }
    },
    /** @param {() => void} fn */
    onVoices(fn) {
      const s = synth();
      if (!s) return () => {};
      s.addEventListener?.('voiceschanged', fn);
      return () => s.removeEventListener?.('voiceschanged', fn);
    },
    warm() { try { synth()?.getVoices(); } catch { /* none */ } },
  };
}

/** @typedef {ReturnType<typeof webVoice>} Voice */
/** @type {Voice | null} */ let impl = null;
const voice = () => impl || (impl = webVoice());
/** For the iOS shell and tests: another implementation (null: the web one again). @param {Voice | null} v */
export function setVoice(v) { impl = v; }

/** @param {string} tag @param {VoiceChoice} [o] */
export const canSay = (tag, o) => voice().canSay(tag, o);
/** @param {string} text @param {string} tag @param {SayOptions} [o] */
export const say = (text, tag, o) => voice().say(text, tag, o);
export const hush = () => voice().hush();
export const unlock = () => voice().unlock();
/** @param {() => void} fn */
export const onVoices = fn => voice().onVoices(fn);
export const warm = () => voice().warm();
