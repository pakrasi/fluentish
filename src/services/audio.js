/* Audio playback: the app's only player (Arch #8). Nothing else creates an Audio element, so one thing plays at a time
   and the iOS shell has one place for background audio, ducking and route changes.

     clip(url, { stallMs, onStart, onEnded, onEnd })
                       a one-off recording (a word, a situation line, an exam cue, the sound check). It starts at once,
                       so call it inside the tap (iOS plays only from a user gesture). result resolves 'playing',
                       'blocked' (the browser wants a tap first), 'error' or 'stalled' (neither played nor failed within
                       stallMs). onStart when it plays; onEnded when it reached its end; onEnd once when it stops for any
                       reason after it started (ended, paused, failed, stopped).
     track(url, { limit, used, onCount })
                       exam audio with a play limit: preload none, no seeking, and a play counts (onCount) only once
                       playback has really started. start() also begins inside the tap. The exam keeps the count
                       (exam/data.js usePlay) and the screen (exam/player.js).
     stop()            stop whatever plays, and the device voice
     setAudioHooks({ duck })
                       for a native shell: duck(true) when playback starts, duck(false) when it stops.

   Word and sentence audio, shared by Look up (▶ on rows and the word sheet), Practice (▶ on exam-word cards) and Word
   building: play(content, text, store, bcp47). Neural recordings come from the B1 exam app's media origin
   (<exam media>/vocab/<file>). The index that maps a text to its file is found in this order:
     1. the private copy: data/vocab-audio.json in the results repo, pulled with the device's token by the results
        sync (data/sync/github-b1exam.js, PULLED) into the store key exams.vocabAudio
     2. the public <exam media>/vocab/manifest.json, while it still exists (before the b1-exam privacy fix)
     3. none: the device's voice for the language if it has a real one (services/voice.js), else nothing (the caller
        says so)
   Once the index is known, play() starts the recording inside the tap, with no await before it.
   CSP: the public index needs connect-src and the files media-src for the media origin (index.html allows both). */
import { bcp47 } from '../core/lang.js';
import * as voice from './voice.js';

/* ---------------------------------------------------------------- the player */

/** @type {{ duck: (on: boolean) => void }} */
const hooks = { duck: () => {} };
/** For the iOS shell. @param {Partial<typeof hooks>} h */
export function setAudioHooks(h) { Object.assign(hooks, h); }

/** @type {HTMLAudioElement | null} */ let current = null;

/** This element is the one that plays now: pause any other. @param {HTMLAudioElement} el */
function claim(el) {
  if (current && current !== el) { try { current.pause(); } catch { /* gone */ } }
  current = el;
}

/** The native shell hears about starts and stops. @param {HTMLAudioElement} el */
function watch(el) {
  const on = () => { try { hooks.duck(true); } catch { /* the shell's problem */ } };
  const off = () => { if (current === el) current = null; try { hooks.duck(false); } catch { /* the shell's problem */ } };
  el.addEventListener('playing', on);
  el.addEventListener('pause', off);
  el.addEventListener('ended', off);
}

/** @typedef {'playing' | 'blocked' | 'error' | 'stalled'} ClipResult */

/**
 * Play a recording once, starting now (inside the caller's tap).
 * @param {string} url
 * @param {{ stallMs?: number, onStart?: () => void, onEnded?: () => void, onEnd?: () => void }} [o]
 * @returns {{ result: Promise<ClipResult>, stop: () => void, el: HTMLAudioElement }}
 */
export function clip(url, { stallMs = 0, onStart, onEnded, onEnd } = {}) {
  const el = new Audio(url);
  claim(el);
  watch(el);
  let started = false, finished = false;
  const end = () => { if (!started || finished) return; finished = true; try { onEnd?.(); } catch { /* the caller's */ } };
  /** @type {(r: ClipResult) => void} */ let settle = () => {};
  const result = /** @type {Promise<ClipResult>} */ (new Promise(resolve => {
    /** @type {ReturnType<typeof setTimeout> | null} */ const stall = stallMs > 0 ? setTimeout(() => settle('stalled'), stallMs) : null;
    let done = false;
    settle = r => {
      if (done) return;
      done = true;
      if (stall) clearTimeout(stall);
      if (r === 'playing') { started = true; try { onStart?.(); } catch { /* the caller's */ } }
      else if (r === 'stalled') { try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* gone */ } if (current === el) current = null; }
      resolve(r);
    };
  }));
  el.addEventListener('playing', () => settle('playing'), { once: true });
  el.addEventListener('error', () => { settle('error'); end(); }, { once: true });
  el.addEventListener('ended', () => { if (started) { try { onEnded?.(); } catch { /* the caller's */ } } end(); });
  el.addEventListener('pause', end);
  try {
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(e => settle(e && e.name === 'NotAllowedError' ? 'blocked' : 'error'));
  } catch (e) { settle(/** @type {any} */ (e)?.name === 'NotAllowedError' ? 'blocked' : 'error'); }
  return { result, el, stop: () => { try { el.pause(); } catch { /* gone */ } end(); if (current === el) current = null; } };
}

/**
 * Exam audio with a play limit. The element is the caller's to read (duration, currentTime, its events).
 * @param {string} url
 * @param {{ limit?: number, used?: () => number, onCount?: () => void }} [o]
 */
export function track(url, { limit = Infinity, used = () => 0, onCount = () => {} } = {}) {
  const el = new Audio();
  el.preload = 'none';
  el.src = url;
  watch(el);
  const remaining = () => Math.max(0, limit - used());
  return {
    el,
    remaining,
    /**
     * Play from the start, inside the tap. 'playing' once playback really began (the play is counted then),
     * 'blocked' when it could not start, 'limit' when no play is left.
     * @returns {Promise<'playing' | 'blocked' | 'limit'>}
     */
    start() {
      if (remaining() <= 0) return Promise.resolve('limit');
      claim(el);
      el.preload = 'auto';
      try { el.currentTime = 0; } catch { /* before metadata */ }
      let p;
      try { p = el.play(); } catch { return Promise.resolve('blocked'); }
      return Promise.resolve(p).then(() => { onCount(); return /** @type {const} */ ('playing'); }, () => /** @type {const} */ ('blocked'));
    },
    pause() { try { el.pause(); } catch { /* not started */ } },
  };
}

/** Stop whatever plays, and the device voice. */
export function stop() {
  if (current) { try { current.pause(); } catch { /* gone */ } current = null; }
  voice.hush();
}

/* ---------------------------------------------------------------- word and sentence audio */

/** b1-exam's audio key: no "a) " list prefix, single spaces. @param {string} t */
export const audioKey = t => String(t || '').replace(/^[abc]\)\s*/, '').replace(/\s+/g, ' ').trim();

/** Store key of the private index (written by the results sync). */
export const VOCAB_AUDIO_KV = 'exams.vocabAudio';

/** @type {Promise<string> | null} */ let baseP = null;
/** @type {Promise<Record<string, string>> | null} */ let publicP = null;
/* The same, once known, so play() can start inside the tap without waiting. */
/** @type {string | undefined} */ let baseNow;
/** @type {Record<string, string> | undefined} */ let publicNow;

/** <exam media>/vocab/, or '' when no exam has media. @param {{manifest: () => Promise<any>}} content */
function vocabBase(content) {
  if (!baseP) baseP = content.manifest().then((/** @type {any} */ m) => {
    const exam = (m.exams || []).find((/** @type {any} */ e) => e.media);
    baseNow = exam ? new URL('vocab/', exam.media).href : '';
    return baseNow;
  }).catch(() => { baseP = null; return ''; });
  return baseP;
}

/** A usable index: a non-empty object of text → file name. @param {any} x */
const isIndex = x => !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length > 0;

/** @param {any} store */
function privateIndex(store) {
  try { return store?.get(VOCAB_AUDIO_KV, null); } catch { return null; }
}

/**
 * The recordings index. The private copy is read from the store on every call (it can arrive with any sync); the
 * public one is fetched once per session (a failed fetch is an empty index, tried again next session).
 * @param {{manifest: () => Promise<any>}} content
 * @param {{store?: {get: (k: string, d?: any) => any} | null, fetch?: typeof fetch}} [o]
 * @returns {Promise<{base: string, files: Record<string, string>, source: 'private' | 'public' | 'none'}>}
 */
export async function audioManifest(content, { store = null, fetch: f = (...a) => fetch(...a) } = {}) {
  const base = await vocabBase(content);
  if (!base) return { base: '', files: {}, source: 'none' };
  const priv = privateIndex(store);
  if (isIndex(priv)) return { base, files: priv, source: 'private' };
  if (!publicP) publicP = (async () => {
    try {
      const r = await f(new URL('manifest.json', base).href, { cache: 'default' });
      const j = r.ok ? await r.json() : {};
      return isIndex(j) ? j : {};
    } catch { return {}; }
  })().then(x => { publicNow = x; return x; });
  const files = await publicP;
  return { base, files, source: isIndex(files) ? 'public' : 'none' };
}

/** For tests: forget the cached base and public index. */
export const resetAudio = () => { baseP = null; publicP = null; baseNow = undefined; publicNow = undefined; };

/**
 * The recording's URL for a text, or null.
 * @param {any} content @param {string} text @param {{store?: any, fetch?: typeof fetch}} [o]
 */
export async function audioUrl(content, text, o) {
  const { base, files } = await audioManifest(content, o);
  const file = files[audioKey(text)];
  return file ? new URL(file, base).href : null;
}

/**
 * The URL without waiting, when the index is already known: a URL, null (no recording), or undefined (not known yet).
 * @param {string} text @param {any} store
 */
function audioUrlNow(text, store) {
  if (baseNow === undefined) return undefined;
  if (!baseNow) return null;
  const priv = privateIndex(store);
  const files = isIndex(priv) ? priv : publicNow;
  if (files === undefined) return undefined;
  const file = files[audioKey(text)];
  return file ? new URL(file, baseNow).href : null;
}

/**
 * Play a word or sentence: its recording, else the device's voice for the language.
 * @param {any} content @param {string} text @param {any} [store]  the open store, for the private index
 * @param {string} [tag]  BCP-47 tag of the text (the study language by default)
 * @returns {Promise<boolean>} false when there is no recording and no voice
 */
export async function play(content, text, store = null, tag = bcp47()) {
  stop();
  const known = audioUrlNow(text, store);
  const url = known !== undefined ? known : await audioUrl(content, text, { store });
  if (url) {
    clip(url);
    return true;
  }
  return !!voice.say(text, tag, { rate: 0.95 });
}

/** Warm the index so the first tap plays at once. @param {any} content @param {any} [store] */
export const prefetchAudio = (content, store = null) => { audioManifest(content, { store }).catch(() => {}); };
