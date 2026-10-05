/* Practice: the speech interface. Say it aloud, the mic check, the Teil 2 talk and "read answers aloud" talk to this
   object only, so the iOS app (Capacitor) can swap in native speech recognition, recording and voices with
   setSpeech() and leave the views as they are.

   interface Speech {
     canListen(): boolean                       a recogniser for German is available
     listen({ onInterim?, continuous? }): { done: Promise<{text, error, spans}>, stop(): void }
     blocked(): boolean                         the user or the browser refused the microphone
     canRecord(): boolean
     record(): Promise<{ stop(): Promise<Blob | null> }>   throws when the microphone is refused
     canSay(lang): boolean
     say(text, lang): boolean                   read text aloud; false when no voice for lang
     cancel(): void                             stop listening, recording and speaking
   }
   The web version uses the Web Speech API (SpeechRecognition, speechSynthesis) and MediaRecorder. */

/** @typedef {{text: string, error: string | null, spans: number[]}} Heard */

/** @returns {any} */
export function webSpeech() {
  const w = /** @type {any} */ (globalThis);
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  // a home-screen web app on iOS has no recogniser that works
  const standalone = () => !!(navigator && /** @type {any} */ (navigator).standalone) || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  let micBlocked = false;
  /** @type {Set<() => void>} */ const live = new Set();
  const VOICE = /** @type {Record<string, string>} */ ({ de: 'de-DE', en: 'en-GB' });

  return {
    canListen: () => !!SR && !standalone(),
    blocked: () => micBlocked,
    /** @param {{onInterim?: (t: string) => void, continuous?: boolean}} [o] */
    listen({ onInterim, continuous = false } = {}) {
      /** @type {any} */ let rec = null;
      const done = /** @type {Promise<Heard>} */ (new Promise(resolve => {
        try {
          rec = new SR(); rec.lang = 'de-DE'; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = continuous;
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
    canRecord: () => !!(navigator.mediaDevices?.getUserMedia && w.MediaRecorder),
    async record() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new w.MediaRecorder(stream);
      /** @type {Blob[]} */ const chunks = [];
      rec.ondataavailable = (/** @type {any} */ e) => { if (e.data.size) chunks.push(e.data); };
      rec.start();
      const release = () => stream.getTracks().forEach(t => t.stop());
      const stop = () => new Promise(resolve => {
        live.delete(halt);
        if (rec.state === 'inactive') { release(); resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type || 'audio/mp4' }) : null); return; }
        rec.addEventListener('stop', () => { release(); resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type || 'audio/mp4' }) : null); }, { once: true });
        rec.stop();
      });
      const halt = () => { stop(); };
      live.add(halt);
      return { stop };
    },
    /** @param {string} lang */
    canSay(lang = 'de') {
      if (!('speechSynthesis' in w)) return false;
      const code = VOICE[lang] || lang;
      return w.speechSynthesis.getVoices().some((/** @type {any} */ v) => v.lang.replace('_', '-').startsWith(code.slice(0, 2)));
    },
    /** @param {string} text @param {string} [lang] */
    say(text, lang = 'de') {
      if (!('speechSynthesis' in w)) return false;
      const code = VOICE[lang] || lang, voices = w.speechSynthesis.getVoices();
      const v = voices.find((/** @type {any} */ x) => x.lang.replace('_', '-') === code) || voices.find((/** @type {any} */ x) => x.lang.startsWith(code.slice(0, 2)));
      if (!v) return false;
      w.speechSynthesis.cancel();
      const u = new w.SpeechSynthesisUtterance(String(text).replace(/\s*\/\s*.*$/, ''));
      u.voice = v; u.lang = v.lang; u.rate = 0.9;
      w.speechSynthesis.speak(u);
      return true;
    },
    cancel() {
      for (const stop of [...live]) stop();
      live.clear();
      try { w.speechSynthesis?.cancel(); } catch { /* none */ }
    },
  };
}

/** @type {any} */ let impl = null;
/** The speech implementation in use (the web one unless a native shell set another). */
export const speech = () => impl || (impl = webSpeech());
/** For the iOS shell and tests. @param {any} s */
export function setSpeech(s) { impl = s; }
/** Load the voice list early (Safari fills it asynchronously). */
export function warmVoices() { try { /** @type {any} */ (globalThis).speechSynthesis?.getVoices(); } catch { /* none */ } }
