/* The microphone's level, for the noise check and the meter while listening (services/speech.js) or recording
   (services/recorder.js). Features never use it directly: they get dBFS numbers through speech.listen({onLevel}).

     const m = createMeter()                 call it inside the tap: the AudioContext is made at once, so iOS lets it run
     await m.start(onDb, { stream? })        opens the microphone (or measures a stream it is given); onDb(dBFS) about
                                             every 60 ms; throws when the microphone is refused or missing
     m.stop()                                stops the timer, closes the context, releases a microphone it opened

   Web Audio: an AnalyserNode's getFloatTimeDomainData (iOS Safari 14.5+, MDN browser-compat data) gives the frame; the
   RMS and dBFS come from domain/hearing.js. audioConstraints() is the one place the capture constraints are chosen
   (recorder.js uses it too). */
// @ts-check
import { rms, toDb } from '../domain/hearing.js';

const PROCESSING = /** @type {const} */ (['echoCancellation', 'noiseSuppression', 'autoGainControl']);

/**
 * The audio constraints: each processing step the browser lists as supported (all three when it can't say), as an
 * ideal, never exact, so getUserMedia never fails on them.
 * Source: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/noiseSuppression
 * @param {MediaDevices | null | undefined} md
 * @returns {MediaTrackConstraints | true}
 */
export function audioConstraints(md) {
  /** @type {Record<string, boolean>} */ let sup = {};
  try { sup = /** @type {any} */ (md?.getSupportedConstraints?.() || {}); } catch { sup = {}; }
  const known = Object.keys(sup).length > 0;
  const c = Object.fromEntries(PROCESSING.filter(k => !known || sup[k]).map(k => [k, true]));
  return Object.keys(c).length ? c : true;
}

/**
 * @param {{ mediaDevices?: MediaDevices | null, AC?: any, every?: number }} [o] injectable for tests
 */
export function createMeter({ mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null,
  AC = /** @type {any} */ (globalThis).AudioContext || /** @type {any} */ (globalThis).webkitAudioContext, every = 60 } = {}) {
  /** @type {any} */ let ac = null;
  try { ac = AC ? new AC() : null; } catch { ac = null; }
  /** @type {MediaStream | null} */ let own = null;
  /** @type {any} */ let iv = null;
  let stopped = false;
  const supported = !!(ac && mediaDevices && typeof mediaDevices.getUserMedia === 'function');
  return {
    supported,
    /** @param {(db: number) => void} onDb @param {{ stream?: MediaStream }} [o] */
    async start(onDb, { stream } = {}) {
      if (!ac) throw new Error('unsupported');
      try { ac.resume?.(); } catch { /* resumed on the next gesture */ }
      let s = stream || null;
      if (!s) {
        if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') throw new Error('unsupported');
        s = own = await mediaDevices.getUserMedia({ audio: audioConstraints(mediaDevices) });
      }
      if (stopped) { this.stop(); return; }
      const src = ac.createMediaStreamSource(s);
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        try { onDb(toDb(rms(buf))); } catch { /* the caller's problem */ }
      }, every);
    },
    stop() {
      stopped = true;
      clearInterval(iv); iv = null;
      own?.getTracks().forEach(t => t.stop()); own = null;
      try { ac?.close?.(); } catch { /* already closed */ }
      ac = null;
    },
  };
}
