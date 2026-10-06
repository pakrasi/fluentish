/* The recorder interface (review: platform services behind interfaces, so an iOS shell can swap in a native one).
   Features never touch MediaRecorder or getUserMedia directly; they ask for a recorder:

     const rec = createRecorder();
     rec.supported                     false when this browser cannot record (offer a file picker instead)
     await rec.start({ onChunk, onEnded, onLevel })
                                       asks for the microphone; throws RecorderError('denied' | 'unsupported').
                                       onChunk(blobSoFar) after every second of audio, so the caller can keep it;
                                       onEnded() when the system stopped the recording on its own;
                                       onLevel(dBFS) about every 60 ms, from the same stream (services/level.js)
     rec.recording                     true between start and stop
     rec.ended                         true when the system ended the take (a call, Siri, the screen locking)
     const { blob, mime } = await rec.stop()
                                       also after the system ended the take: what was captured is never dropped
     rec.cancel()                      stop and drop the audio (leaving the page)

   The microphone is asked for with echo cancellation, noise suppression and automatic gain (audioConstraints()), as
   plain booleans: a browser applies what it can and never fails on the rest (MDN, MediaTrackConstraints). iOS Safari
   applies echo cancellation (iOS 11+); noise suppression and gain control are not supported there (MDN browser-compat
   data), so on the iPhone they are requested and ignored. A Mac's Safari and Chrome apply them.

   The web implementation below records in the first MIME type the browser supports (WebM/Opus, else MP4/AAC on
   Safari) with a chunk every second, so a long take is not one huge buffer. */

import { audioConstraints, createMeter } from './level.js';
export { audioConstraints };

export class RecorderError extends Error {
  /** @param {'denied' | 'unsupported' | 'empty'} code */
  constructor(code) { super(code); this.code = code; }
}

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

/**
 * @param {{ mediaDevices?: MediaDevices | null, MediaRecorderImpl?: any, meter?: () => ({ start: (onDb: (db: number) => void, o?: { stream?: MediaStream }) => Promise<void>, stop: () => void }) | null }} [o] injectable for tests
 */
export function createRecorder({ mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null,
  MediaRecorderImpl = typeof window !== 'undefined' ? /** @type {any} */ (window).MediaRecorder : undefined, meter = () => createMeter({ mediaDevices }) } = {}) {
  const supported = !!(mediaDevices && typeof mediaDevices.getUserMedia === 'function' && MediaRecorderImpl);
  /** @type {any} */ let rec = null;
  /** @type {MediaStream | null} */ let stream = null;
  /** @type {Blob[]} */ let chunks = [];
  let mime = '';
  let stopping = false, ended = false;
  /** @type {{ stop: () => void } | null} */ let level = null;
  const release = () => { level?.stop(); level = null; stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const typeOf = () => (rec && rec.mimeType) || chunks[0]?.type || mime || 'audio/webm';

  return {
    supported,
    get recording() { return !!rec && rec.state === 'recording'; },
    get ended() { return ended; },
    /** @param {{ onChunk?: (blob: Blob) => void, onEnded?: () => void, onLevel?: (db: number) => void }} [o] */
    async start({ onChunk, onEnded, onLevel } = {}) {
      if (!supported) throw new RecorderError('unsupported');
      // made before the await, inside the tap, so iOS lets its audio context run
      const m = onLevel ? meter() : null;
      try { stream = await /** @type {MediaDevices} */ (mediaDevices).getUserMedia({ audio: audioConstraints(mediaDevices) }); } catch { m?.stop(); throw new RecorderError('denied'); }
      if (m && onLevel) { level = m; m.start(onLevel, { stream }).catch(() => { m.stop(); if (level === m) level = null; }); }
      mime = MIMES.find(m => MediaRecorderImpl.isTypeSupported?.(m)) || '';
      rec = new MediaRecorderImpl(stream, mime ? { mimeType: mime } : undefined);
      chunks = []; stopping = false; ended = false;
      rec.ondataavailable = (/** @type {BlobEvent} */ e) => {
        if (e.data && e.data.size) { chunks.push(e.data); try { onChunk?.(new Blob(chunks, { type: typeOf() })); } catch { /* the caller's problem */ } }
      };
      // ended by the system (or an error): keep every chunk; the caller saves them with stop()
      const sysEnd = () => { if (stopping || ended) return; ended = true; try { onEnded?.(); } catch { /* ignore */ } };
      rec.onstop = sysEnd;
      rec.onerror = sysEnd;
      // the microphone track ending (another app took it) also ends the take
      for (const tr of stream.getTracks()) tr.addEventListener?.('ended', sysEnd);
      rec.start(1000);
    },
    /** @returns {Promise<{blob: Blob, mime: string}>} */
    stop() {
      return new Promise((resolve, reject) => {
        if (!rec) { reject(new RecorderError('empty')); return; }
        const r = rec;
        const finish = () => {
          release();
          const type = typeOf();
          const blob = new Blob(chunks, { type });
          rec = null;
          if (!blob.size) reject(new RecorderError('empty')); else resolve({ blob, mime: type });
        };
        if (r.state === 'inactive') { finish(); return; }   // the system already ended it: keep what was captured
        stopping = true;
        r.onstop = finish;
        try { r.stop(); } catch { finish(); }
      });
    },
    cancel() {
      if (rec && rec.state !== 'inactive') { stopping = true; rec.onstop = null; try { rec.stop(); } catch { /* already stopped */ } }
      rec = null; chunks = [];
      release();
    },
  };
}
