/* The recorder interface (review: platform services behind interfaces, so an iOS shell can swap in a native one).
   Features never touch MediaRecorder or getUserMedia directly; they ask for a recorder:

     const rec = createRecorder();
     rec.supported                     false when this browser cannot record (offer a file picker instead)
     await rec.start()                 asks for the microphone; throws RecorderError('denied' | 'unsupported')
     rec.recording                     true between start and stop
     const { blob, mime } = await rec.stop()
     rec.cancel()                      stop and drop the audio (leaving the page)

   The web implementation below records in the first MIME type the browser supports (WebM/Opus, else MP4/AAC on
   Safari) with a chunk every second, so a long take is not one huge buffer. */

export class RecorderError extends Error {
  /** @param {'denied' | 'unsupported' | 'empty'} code */
  constructor(code) { super(code); this.code = code; }
}

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

/**
 * @param {{ mediaDevices?: MediaDevices | null, MediaRecorderImpl?: any }} [o] injectable for tests
 */
export function createRecorder({ mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null,
  MediaRecorderImpl = typeof window !== 'undefined' ? /** @type {any} */ (window).MediaRecorder : undefined } = {}) {
  const supported = !!(mediaDevices && typeof mediaDevices.getUserMedia === 'function' && MediaRecorderImpl);
  /** @type {any} */ let rec = null;
  /** @type {MediaStream | null} */ let stream = null;
  /** @type {Blob[]} */ let chunks = [];
  const release = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };

  return {
    supported,
    get recording() { return !!rec && rec.state === 'recording'; },
    async start() {
      if (!supported) throw new RecorderError('unsupported');
      try { stream = await /** @type {MediaDevices} */ (mediaDevices).getUserMedia({ audio: true }); } catch { throw new RecorderError('denied'); }
      const mime = MIMES.find(m => MediaRecorderImpl.isTypeSupported?.(m)) || '';
      rec = new MediaRecorderImpl(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      rec.ondataavailable = (/** @type {BlobEvent} */ e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start(1000);
    },
    /** @returns {Promise<{blob: Blob, mime: string}>} */
    stop() {
      return new Promise((resolve, reject) => {
        if (!rec || rec.state === 'inactive') { reject(new RecorderError('empty')); return; }
        const r = rec;
        r.onstop = () => {
          release();
          const mime = r.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mime });
          rec = null;
          if (!blob.size) reject(new RecorderError('empty')); else resolve({ blob, mime });
        };
        r.stop();
      });
    },
    cancel() {
      if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop(); } catch { /* already stopped */ } }
      rec = null; chunks = [];
      release();
    },
  };
}
