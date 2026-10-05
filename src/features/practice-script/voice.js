/* Script mode: the device's voice for Listen and the per-sentence play buttons, through services/voice.js. It reports
   word boundaries and the end of each sentence, and takes a speed, so read-along can follow and pause after each
   sentence for his own repetition.

   A script is private (§8): a cloud voice ("Google Deutsch" on Chrome for Windows, ChromeOS and Android has
   localService false) would send its text to a server, so only voices that run on the device are used (audit P2-2).
   With none, Listen and Play are off and the note says how to add one. */
import { bcp47 } from '../../core/lang.js';
import * as voice from '../../services/voice.js';

const LOCAL = { localOnly: true };

/** A voice for the study language is there (Safari fills the list late: call again after voiceschanged). */
export const hasVoice = () => voice.canSay(bcp47(), LOCAL);

/** Calls fn once the voice list changes (Safari loads it asynchronously). @param {() => void} fn */
export const onVoices = fn => voice.onVoices(fn);

/**
 * Speak one text. Resolves when it ends (or is cancelled) with how long it took.
 * @param {string} text
 * @param {{rate?: number, onWord?: (charIndex: number, length: number) => void}} [o]
 * @returns {{done: Promise<{ms: number, ended: boolean}>, cancel: () => void}}
 */
export function say(text, { rate = 0.9, onWord } = {}) {
  return voice.say(text, bcp47(), { ...LOCAL, rate, onWord }) || { done: Promise.resolve({ ms: 0, ended: false }), cancel() {} };
}

/** Stop any speech. */
export const hush = () => voice.hush();
