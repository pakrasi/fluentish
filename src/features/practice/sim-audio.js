/* Speaking situations: playing a line. The clips are neural recordings (tools/build_speak_audio.py) published next to
   the exam audio, at <exam media>/speak/<md5>.mp3 (the same origin as the exam and word audio, so the CSP's media-src
   already allows it). On a dev server the local media/speak/ folder is tried first. When no clip plays (not published
   yet, offline), the device's German voice reads the line; when there is none either, play() says so and the line is
   read on screen. One line plays at a time. */
import { config, isDev } from '../../core/config.js';

/** @type {Promise<string> | null} */ let baseP = null;

/** <exam media>/speak/, or '' when no exam has media. @param {{manifest: () => Promise<any>}} content */
export function speakBase(content) {
  if (!baseP) baseP = content.manifest().then((/** @type {any} */ m) => {
    const exam = (m.exams || []).find((/** @type {any} */ e) => e.media);
    return exam ? new URL('speak/', exam.media).href : '';
  }).catch(() => { baseP = null; return ''; });
  return baseP;
}

/** @type {HTMLAudioElement | null} */ let cur = null;
let token = 0;
/** @type {SpeechSynthesisVoice | null | undefined} */ let voice;

function germanVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  if (voice) return voice;
  const vs = speechSynthesis.getVoices().filter(v => /^de[-_]/i.test(v.lang) && !/multilingual/i.test(v.name));
  voice = vs.find(v => /Anna|Helena|Petra|Markus|Google Deutsch/i.test(v.name)) || vs[0] || null;
  return voice;
}

export function stopLine() {
  token++;
  if (cur) { try { cur.pause(); } catch { /* gone */ } cur = null; }
  try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* none */ }
}

/**
 * Play a line. Resolves to 'clip' | 'voice' when it starts, 'blocked' when the browser wants a tap first, 'none'
 * when there is nothing to play it with. onEnd runs once when it stops for any reason (also after 'blocked'/'none').
 * @param {{content: any, file: string, text: string, onStart?: () => void, onEnd?: () => void}} o
 * @returns {Promise<'clip' | 'voice' | 'blocked' | 'none'>}
 */
export async function playLine({ content, file, text, onStart = () => {}, onEnd = () => {} }) {
  stopLine();
  const my = ++token;
  let ended = false;
  const end = () => { if (!ended) { ended = true; onEnd(); } };
  const base = await speakBase(content);
  if (my !== token) { end(); return 'none'; }
  const urls = [isDev() ? new URL(`media/speak/${file}`, config.root).href : null, base ? new URL(file, base).href : null].filter(Boolean);
  for (const url of /** @type {string[]} */ (urls)) {
    const a = new Audio(url);
    cur = a;
    const res = await new Promise(resolve => {
      a.addEventListener('playing', () => resolve('clip'), { once: true });
      a.addEventListener('error', () => resolve('error'), { once: true });
      a.play().catch(e => resolve(e && e.name === 'NotAllowedError' ? 'blocked' : 'error'));
    });
    if (my !== token) { end(); return 'none'; }
    if (res === 'clip') {
      onStart();
      a.addEventListener('ended', end, { once: true });
      a.addEventListener('pause', end, { once: true });
      a.addEventListener('error', end, { once: true });
      return 'clip';
    }
    if (res === 'blocked') { end(); return 'blocked'; }
  }
  cur = null;
  const v = germanVoice();
  if (!v || typeof SpeechSynthesisUtterance === 'undefined') { end(); return 'none'; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = v.lang; u.voice = v; u.rate = 0.95;
  u.onstart = () => onStart();
  u.onend = end; u.onerror = end;
  speechSynthesis.speak(u);
  return 'voice';
}
