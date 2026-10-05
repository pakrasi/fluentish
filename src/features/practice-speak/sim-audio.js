/* Speaking situations: playing a line. The clips are neural recordings (tools/build_speak_audio.py) published next to
   the exam audio, at <exam media>/speak/<md5>.mp3 (the same origin as the exam and word audio, so the CSP's media-src
   already allows it). On a dev server the local media/speak/ folder is tried first. When no clip plays (not published
   yet, offline, or stalled for STALL_MS), the device's voice reads the line; when there is none either, play()
   says so and the line is read on screen. One line plays at a time (services/audio.js is the only player).

   iOS only plays audio and lets speechSynthesis speak from a user gesture. So playLine() unlocks the voice
   synchronously, inside the tap, with a silent utterance; once the media base is known it starts the first clip inside
   the tap too (no await before it); and the fallback reports 'voice' only once the voice has really started (else
   'none', so the screen can say there is no audio). */
import { config, isDev } from '../../core/config.js';
import { bcp47 } from '../../core/lang.js';
import { clip, stop } from '../../services/audio.js';
import * as voice from '../../services/voice.js';

/** @type {Promise<string> | null} */ let baseP = null;
/** @type {string | undefined} */ let baseNow;

/** <exam media>/speak/, or '' when no exam has media. @param {{manifest: () => Promise<any>}} content */
export function speakBase(content) {
  if (!baseP) baseP = content.manifest().then((/** @type {any} */ m) => {
    const exam = (m.exams || []).find((/** @type {any} */ e) => e.media);
    baseNow = exam ? new URL('speak/', exam.media).href : '';
    return baseNow;
  }).catch(() => { baseP = null; return ''; });
  return baseP;
}

/** A clip that neither plays nor fails within this long counts as stalled. */
const STALL_MS = 4000;

let token = 0;

export function stopLine() {
  token++;
  stop();
}

/**
 * Play a line. Resolves to 'clip' | 'voice' when it starts, 'blocked' when the browser wants a tap first, 'none'
 * when there is nothing to play it with. onEnd runs once when it stops for any reason (also after 'blocked'/'none').
 * @param {{content: any, file: string, text: string, onStart?: () => void, onEnd?: () => void}} o
 * @returns {Promise<'clip' | 'voice' | 'blocked' | 'none'>}
 */
export async function playLine({ content, file, text, onStart = () => {}, onEnd = () => {} }) {
  stopLine();
  voice.unlock();
  const my = ++token;
  let ended = false;
  const end = () => { if (!ended) { ended = true; onEnd(); } };
  const base = baseNow !== undefined ? baseNow : await speakBase(content);
  if (my !== token) { end(); return 'none'; }
  const urls = [isDev() ? new URL(`media/speak/${file}`, config.root).href : null, base ? new URL(file, base).href : null].filter(Boolean);
  for (const url of /** @type {string[]} */ (urls)) {
    const c = clip(url, { stallMs: STALL_MS, onEnd: end });
    const res = await c.result;
    if (my !== token) { c.stop(); end(); return 'none'; }
    if (res === 'playing') { onStart(); return 'clip'; }
    if (res === 'blocked') { end(); return 'blocked'; }
  }
  const tag = bcp47();
  const s = voice.say(text, tag, { rate: 0.95, onStart });
  if (!s) { end(); return 'none'; }
  s.done.then(end);
  if (await s.started) return 'voice';
  s.cancel();
  end();
  return 'none';
}
