/* Speech recognition and recording, behind one interface (Arch #8), so the iOS app (Capacitor) can swap in native
   recognition and recording with setSpeech() and leave the views as they are. The mic check, the Teil 2 talk and
   "Check with the mic" in the situations talk to this object only. Voices are services/voice.js; playback is
   services/audio.js.

   interface Speech {
     canListen(): boolean                       a recogniser is available
     listen({ lang, onInterim?, continuous? }): { done: Promise<{text, error, spans}>, stop(): void }
                                                lang: the BCP-47 locale to recognise (core/lang.js asrLocale())
     blocked(): boolean                         the user or the browser refused the microphone
     canRecord(): boolean
     record(): Promise<{ stop(): Promise<Blob | null> }>   throws when the microphone is refused
     cancel(): void                             stop listening and recording
   }
   The web version uses the Web Speech API (SpeechRecognition) and services/recorder.js for the microphone. */
import { createRecorder } from './recorder.js';

/** @typedef {{text: string, error: string | null, spans: number[]}} Heard */
/** @typedef {{ done: Promise<Heard>, stop: () => void }} Listening */
/** @typedef {{ lang: string, onInterim?: (t: string) => void, continuous?: boolean }} ListenOptions */

/**
 * The web implementation.
 * @param {{ recorder?: () => ReturnType<typeof createRecorder> }} [o] injectable for tests
 */
export function webSpeech({ recorder = () => createRecorder() } = {}) {
  const w = /** @type {any} */ (globalThis);
  const SR = () => w.SpeechRecognition || w.webkitSpeechRecognition;
  // a home-screen web app on iOS has no recogniser that works
  const standalone = () => !!(typeof navigator !== 'undefined' && /** @type {any} */ (navigator).standalone) || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  let micBlocked = false;
  /** @type {Set<() => void>} */ const live = new Set();

  return {
    canListen: () => !!SR() && !standalone(),
    blocked: () => micBlocked,
    /** @param {ListenOptions} o @returns {Listening} */
    listen({ lang, onInterim, continuous = false }) {
      /** @type {any} */ let rec = null;
      const done = /** @type {Promise<Heard>} */ (new Promise(resolve => {
        try {
          const R = SR();
          rec = new R(); rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = continuous;
        } catch { resolve({ text: '', error: 'start', spans: [] }); return; }
        let finalText = '', error = /** @type {string | null} */ (null);
        /** @type {number[]} */ const spans = [];
        rec.onresult = (/** @type {any} */ e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) { finalText += (finalText ? ' ' : '') + r[0].transcript.trim(); spans.push(Date.now()); } else interim += r[0].transcript;
          }
          onInterim?.((finalText + ' ' + interim).trim());
        };
        rec.onerror = (/** @type {any} */ e) => { error = e.error; if (e.error === 'not-allowed' || e.error === 'service-not-allowed') micBlocked = true; };
        rec.onend = () => { live.delete(stop); resolve({ text: finalText.trim(), error, spans }); };
        try { rec.start(); } catch { resolve({ text: '', error: 'start', spans: [] }); }
      }));
      const stop = () => { try { rec?.stop(); } catch { /* already stopped */ } };
      live.add(stop);
      return { done, stop };
    },
    canRecord: () => recorder().supported,
    /** One take with services/recorder.js. Throws when the microphone is refused or missing. */
    async record() {
      const r = recorder();
      await r.start();
      /** @type {Promise<Blob | null> | null} */ let stopping = null;
      const stop = () => {
        live.delete(halt);
        if (!stopping) stopping = r.stop().then(x => x.blob, () => null);
        return stopping;
      };
      const halt = () => { stop(); };
      live.add(halt);
      return { stop };
    },
    cancel() {
      for (const stop of [...live]) stop();
      live.clear();
    },
  };
}

/** @typedef {ReturnType<typeof webSpeech>} Speech */
/** @type {Speech | null} */ let impl = null;
/** The speech implementation in use (the web one unless a native shell set another). */
export const speech = () => impl || (impl = webSpeech());
/** For the iOS shell and tests (null: the web one again). @param {Speech | null} s */
export function setSpeech(s) { impl = s; }
