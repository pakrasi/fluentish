/* Speech recognition and recording, behind one interface (Arch #8), so the iOS app (Capacitor) can swap in native
   recognition and recording with setSpeech() and leave the views as they are. The mic check, the Teil 2 talk and
   "Check with the mic" in the situations talk to this object only. Voices are services/voice.js; playback is
   services/audio.js; the level meter is services/level.js; the rules (noise, restarts, trust) are domain/hearing.js.

   interface Speech {
     canListen(): boolean                       a recogniser is available
     listen(o): { done: Promise<Heard>, stop(): void }
        o.lang                                  the BCP-47 locale to recognise (core/lang.js asrLocale())
        o.onInterim?(text)                      the transcript so far
        o.continuous?                           keep the session open over pauses (the Teil 2 talk)
        o.hold?                                 hold to talk: listen until stop() (he lets go), restarting over gusts
        o.onLevel?(0..1)                        the meter while listening (none when the meter can't open)
        o.check?                                measure the room for ~1 s first, unless measured in the last minute
        o.onPhase?('checking' | 'listening', ambient)
                                                checking: the noise check runs; listening: the recogniser started
     noise(): Ambient | null                    the last room measured in the last minute (domain/hearing.js ambient)
     checkNoise(ms?): Promise<Ambient | null>   measure the room now (the Teil 2 talk, before the mic check)
     blocked(): boolean                         the user or the browser refused the microphone
     canRecord(): boolean
     record({ onLevel? }?): Promise<{ stop(): Promise<Blob | null>, floor(): number | null }>
                                                throws when the microphone is refused; floor: the noise under the take
     cancel(): void                             stop listening and recording
   }
   Heard: { text, error, spans, alts, confidence, restarts, ambient, floor, hold }
     text        the recogniser's best guess (alts[0]); alts: every transcript its alternatives allow, best first, each
                 {text, confidence} (confidence 0..1, null when not given); the caller scores all of them
     restarts    how often the session ended early and was restarted inside this attempt
     ambient     the room before listening (null: not measured); floor: the quietest level while listening (dBFS)

   The web version uses the Web Speech API (webkitSpeechRecognition on iOS Safari 14.5+, the Siri engine) and
   services/recorder.js for the microphone. maxAlternatives, interimResults, confidence and the result, error and end
   events are all supported on iOS Safari 14.5+; continuous since iOS 17 (MDN browser-compat data 8.1.4).
   Sources: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
            https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionAlternative/confidence
   Outdoors (docs/IOS-CHECKS.md › Speaking outdoors): a session that ends with nothing heard is restarted; a take
   whose words stop changing for STALE_MS is ended, since wind keeps the level up and Safari waits for silence; a take
   is capped at MAX_MS. The meter's stream is closed before done resolves, so the answer then plays at full volume. */
import { createRecorder } from './recorder.js';
import { createMeter } from './level.js';
import * as H from '../domain/hearing.js';

/** @typedef {import('../domain/hearing.js').Alt} Alt */
/** @typedef {import('../domain/hearing.js').Ambient} Ambient */
/** @typedef {{text: string, error: string | null, spans: number[], alts: Alt[], confidence: number | null, restarts: number, ambient: Ambient | null, floor: number | null, hold: boolean}} Heard */
/** @typedef {{ done: Promise<Heard>, stop: () => void }} Listening */
/** @typedef {{ lang: string, onInterim?: (t: string) => void, continuous?: boolean, hold?: boolean, onLevel?: (x: number) => void, check?: boolean, onPhase?: (p: 'checking' | 'listening', a: Ambient | null) => void }} ListenOptions */

export const CHECK_MS = 1000;       // the noise check
export const FRESH_MS = 60000;      // a room measured this recently is not measured again
export const STALE_MS = 2500;       // words unchanged this long, after something was heard: the take is over
export const MAX_MS = 20000;        // a tap's take never runs longer
const RESTART_GAP_MS = 150;         // Safari refuses start() right after end

/**
 * The web implementation.
 * @param {{ recorder?: () => ReturnType<typeof createRecorder>, meter?: () => ReturnType<typeof createMeter> | null, now?: () => number }} [o] injectable for tests
 */
export function webSpeech({ recorder = () => createRecorder(), meter = () => createMeter(), now = () => Date.now() } = {}) {
  const w = /** @type {any} */ (globalThis);
  const SR = () => w.SpeechRecognition || w.webkitSpeechRecognition;
  // a home-screen web app on iOS has no recogniser that works
  const standalone = () => !!(typeof navigator !== 'undefined' && /** @type {any} */ (navigator).standalone) || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  let micBlocked = false;
  /** the meter's stream and the recogniser clashed once ('audio-capture'): listen without the meter from now on */
  let meterClash = false;
  /** @type {{ at: number, a: Ambient } | null} */ let room = null;
  /** @type {Set<() => void>} */ const live = new Set();
  const fresh = () => (room && now() - room.at < FRESH_MS ? room.a : null);

  /** Open the meter and measure ~ms of the room; every frame (dBFS) also goes to onDb, before and after.
   * @param {any} m @param {number} ms @param {(db: number) => void} [onDb] @returns {Promise<Ambient | null>} */
  const measure = (m, ms, onDb) => new Promise(resolve => {
    /** @type {number[]} */ const dbs = [];
    let over = false;
    const finish = () => { if (over) return; over = true; const a = H.ambient(dbs); if (a) room = { at: now(), a }; resolve(a); };
    m.start((/** @type {number} */ db) => { if (!over) dbs.push(db); onDb?.(db); }).then(() => setTimeout(finish, ms), () => finish());
    setTimeout(finish, ms + 1500);   // a microphone prompt left open never holds up listening
  });

  return {
    canListen: () => !!SR() && !standalone(),
    blocked: () => micBlocked,
    noise: () => fresh(),
    /** @param {number} [ms] */
    async checkNoise(ms = CHECK_MS) {
      const m = meter();
      if (!m) return null;
      const stop = () => m.stop();
      live.add(stop);
      try { return await measure(m, ms); } finally { live.delete(stop); m.stop(); }
    },
    /** @param {ListenOptions} o @returns {Listening} */
    listen({ lang, onInterim, continuous = false, hold = false, onLevel, check = false, onPhase }) {
      /** @type {any} */ let rec = null;
      let stopped = false, over = false, restarts = 0;
      /** @type {(() => void) | null} */ let finishNow = null;
      // the meter is made here, inside the tap (iOS runs an AudioContext made in a gesture)
      const m = (onLevel || check) && !meterClash ? meter() : null;
      /** @type {number[]} */ const levels = [];
      const stop = () => {
        stopped = true;
        if (rec) { try { rec.stop(); } catch { finishNow?.(); } } else finishNow?.();
      };
      live.add(stop);
      const done = /** @type {Promise<Heard>} */ (new Promise(resolve => {
        /** @type {{alts: Alt[]}[]} */ const finals = [];
        /** @type {number[]} */ const spans = [];
        /** @type {string | null} */ let error = null;
        /** @type {Ambient | null} */ let amb = null;
        let t0 = now(), lastText = '', lastChange = now();
        /** @type {any} */ let watch = null;
        const textSoFar = () => finals.map(f => f.alts[0]?.text || '').filter(Boolean).join(' ');
        const finish = () => {
          if (over) return; over = true;
          clearInterval(watch); m?.stop(); live.delete(stop);
          const alts = H.candidates(finals);
          const top = alts[0];
          resolve({ text: top ? top.text.trim() : '', error: top ? null : error, spans, alts, confidence: top ? top.confidence : null,
            restarts, ambient: amb, floor: H.floor(levels), hold });
        };
        finishNow = finish;
        const begin = () => {
          if (over) return;
          if (stopped) { finish(); return; }
          let r;
          try {
            const R = SR();
            r = rec = new R(); r.lang = lang; r.interimResults = true; r.maxAlternatives = 5; r.continuous = continuous || hold;
          } catch { error = 'start'; finish(); return; }
          /** @type {Set<number>} */ const seen = new Set();   // finals of this session already kept
          let pending = '';   // interim words not finalised yet: kept if the session ends without finalising them
          r.onresult = (/** @type {any} */ e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const res = e.results[i];
              if (res.isFinal) {
                if (seen.has(i)) continue;
                seen.add(i);
                /** @type {Alt[]} */ const alts = [];
                for (let k = 0; k < res.length; k++) {
                  const a = res[k];
                  if (a && a.transcript && a.transcript.trim()) alts.push({ text: a.transcript.trim(), confidence: typeof a.confidence === 'number' ? a.confidence : null });
                }
                if (alts.length) { finals.push({ alts }); spans.push(now()); }
              } else interim += res[0]?.transcript || '';
            }
            pending = interim.trim();
            const so = (textSoFar() + ' ' + interim).trim();
            if (so !== lastText) { lastText = so; lastChange = now(); }
            onInterim?.(so);
          };
          r.onerror = (/** @type {any} */ e) => {
            error = e.error;
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') micBlocked = true;
          };
          r.onend = () => {
            if (rec === r) rec = null;
            if (over) return;
            if (pending) { finals.push({ alts: [{ text: pending, confidence: null }] }); spans.push(now()); pending = ''; }
            // the meter's stream and the recogniser can't share the microphone here: once, without the meter
            if (error === 'audio-capture' && m && !meterClash) { meterClash = true; m.stop(); error = null; setTimeout(begin, RESTART_GAP_MS); return; }
            if (H.shouldRestart({ stopped, error, text: textSoFar(), restarts, elapsedMs: now() - t0, hold })) {
              restarts++; error = null;
              setTimeout(begin, RESTART_GAP_MS);
              return;
            }
            finish();
          };
          try { r.start(); } catch { error = 'start'; rec = null; finish(); }
        };
        const listenNow = () => {
          if (over) return;
          t0 = now(); lastChange = now();
          onPhase?.('listening', amb);
          begin();
          // the take is over when the words stop changing (wind keeps Safari from hearing silence), or at MAX_MS
          if (!hold) watch = setInterval(() => {
            if (over || stopped) return;
            if (now() - t0 >= MAX_MS || (lastText && now() - lastChange >= STALE_MS)) { stopped = true; try { rec?.stop(); } catch { finish(); } }
          }, 250);
        };
        (async () => {
          if (m) {
            let on = false;   // listening: frames count toward the noise floor
            const onDb = (/** @type {number} */ db) => { if (on) levels.push(db); onLevel?.(H.meter(db)); };
            amb = fresh();
            if (check && !amb && !hold) {
              onPhase?.('checking', null);
              amb = await measure(m, CHECK_MS, onDb);   // null: the meter could not open, so listen without it
            } else {
              m.start(onDb).catch(() => m.stop());
            }
            on = true;
          }
          listenNow();
        })();
      }));
      return { done, stop };
    },
    canRecord: () => recorder().supported,
    /** One take with services/recorder.js. Throws when the microphone is refused or missing. @param {{ onLevel?: (x: number) => void }} [o] */
    async record({ onLevel } = {}) {
      const r = recorder();
      /** @type {number[]} */ const dbs = [];
      await r.start(onLevel ? { onLevel: (/** @type {number} */ db) => { if (dbs.length < 4000) dbs.push(db); onLevel(H.meter(db)); } } : {});
      /** @type {Promise<Blob | null> | null} */ let stopping = null;
      const stop = () => {
        live.delete(halt);
        if (!stopping) stopping = r.stop().then(x => x.blob, () => null);
        return stopping;
      };
      const halt = () => { stop(); };
      live.add(halt);
      /** the noise under the take (dBFS, the quietest fifth of frames); null without a meter */
      const floor = () => H.floor(dbs);
      return { stop, floor };
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
