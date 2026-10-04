/* Look up: hearing a word or a sentence. Neural recordings from the B1 exam app's media origin (manifest.json maps
   the text to a file), else the device's German voice if it has a real one, else nothing (the caller says so). */
import { audioManifest } from './data.js';

/** b1-exam's audio key: no "a) " list prefix, single spaces. @param {string} t */
export const audioKey = t => String(t || '').replace(/^[abc]\)\s*/, '').replace(/\s+/g, ' ').trim();

/** @type {HTMLAudioElement | null} */ let cur = null;
/** @type {SpeechSynthesisVoice | null | undefined} */ let voice;

function germanVoice() {
  if (voice !== undefined || typeof speechSynthesis === 'undefined') return voice || null;
  const vs = speechSynthesis.getVoices().filter(v => /^de[-_]/i.test(v.lang) && !/multilingual/i.test(v.name));
  if (!vs.length) return null;   // voices load late on some browsers; try again next time
  voice = vs.find(v => /Anna|Helena|Petra|Markus|Google Deutsch/i.test(v.name)) || vs[0];
  return voice;
}

export function stop() {
  if (cur) { cur.pause(); cur = null; }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/**
 * @param {any} content @param {string} text
 * @returns {Promise<boolean>} false when there is no recording and no German voice
 */
export async function play(content, text) {
  stop();
  const { base, files } = await audioManifest(content);
  const f = files[audioKey(text)];
  if (f) {
    cur = new Audio(new URL(f, base).href);
    cur.play().catch(() => {});
    return true;
  }
  const v = germanVoice();
  if (v) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE'; u.voice = v; u.rate = 0.95;
    speechSynthesis.speak(u);
    return true;
  }
  return false;
}

/** Warm the manifest so the first tap plays at once. @param {any} content */
export const prefetchAudio = content => { audioManifest(content).catch(() => {}); };
