/* Speaking situations: playing a line. The clips are neural recordings (tools/build_speak_audio.py) published next to
   the exam audio, at <exam media>/speak/<md5>.mp3 (the same origin as the exam and word audio, so the CSP's media-src
   already allows it). On a dev server the local media/speak/ folder is tried first. When no clip plays (not published
   yet, offline, or stalled for STALL_MS), the device's German voice reads the line; when there is none either, play()
   says so and the line is read on screen. One line plays at a time.

   iOS only lets speechSynthesis speak from a user gesture, and the clip attempts await first. So playLine() unlocks
   the voice synchronously, inside the tap, with a silent utterance; and the fallback reports 'voice' only once the
   voice has really started (else 'none', so the screen can say there is no audio). */
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

/** A clip that neither plays nor fails within this long counts as stalled. */
const STALL_MS = 4000;
/** How long the device voice may take to start. */
const VOICE_START_MS = 1500;

/** @type {HTMLAudioElement | null} */ let cur = null;
let unlocked = false;
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
  unlockVoice();
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
      const stall = setTimeout(() => resolve('stalled'), STALL_MS);
      const done = (/** @type {string} */ r) => { clearTimeout(stall); resolve(r); };
      a.addEventListener('playing', () => done('clip'), { once: true });
      a.addEventListener('error', () => done('error'), { once: true });
      a.play().catch(e => done(e && e.name === 'NotAllowedError' ? 'blocked' : 'error'));
    });
    if (res === 'stalled') { try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* gone */ } }
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
  const started = new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), VOICE_START_MS);
    u.onstart = () => { clearTimeout(timer); onStart(); resolve(true); };
  });
  u.onend = end; u.onerror = end;
  speechSynthesis.speak(u);
  if (await started) return 'voice';
  try { speechSynthesis.cancel(); } catch { /* none */ }
  end();
  return 'none';
}

/** Inside the tap: a silent utterance, so a later speak() outside the gesture is allowed on iOS. */
function unlockVoice() {
  if (unlocked || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
  const ua = /** @type {any} */ (navigator).userActivation;
  if (ua && !ua.isActive) return;   // not inside a tap: try again on the next one
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); unlocked = true; } catch { /* none */ }
}
