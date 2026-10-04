/* Word and sentence audio, shared by Look up (▶ on rows and the word sheet) and Practice (▶ on exam-word cards).
   Neural recordings come from the B1 exam app's media origin (<exam media>/vocab/<file>). The index that maps a text
   to its file is found in this order:
     1. the private copy: data/vocab-audio.json in the results repo, pulled with the device's token by the results
        sync (data/sync/github-b1exam.js, PULLED) into the store key exams.vocabAudio
     2. the public <exam media>/vocab/manifest.json, while it still exists (before the b1-exam privacy fix)
     3. none: the device's German voice if it has a real one, else nothing (the caller says so)
   CSP: the public index needs connect-src and the files media-src for the media origin (index.html allows both). */

/** b1-exam's audio key: no "a) " list prefix, single spaces. @param {string} t */
export const audioKey = t => String(t || '').replace(/^[abc]\)\s*/, '').replace(/\s+/g, ' ').trim();

/** Store key of the private index (written by the results sync). */
export const VOCAB_AUDIO_KV = 'exams.vocabAudio';

/** @type {Promise<string> | null} */ let baseP = null;
/** @type {Promise<Record<string, string>> | null} */ let publicP = null;

/** <exam media>/vocab/, or '' when no exam has media. @param {{manifest: () => Promise<any>}} content */
function vocabBase(content) {
  if (!baseP) baseP = content.manifest().then((/** @type {any} */ m) => {
    const exam = (m.exams || []).find((/** @type {any} */ e) => e.media);
    return exam ? new URL('vocab/', exam.media).href : '';
  }).catch(() => { baseP = null; return ''; });
  return baseP;
}

/** A usable index: a non-empty object of text → file name. @param {any} x */
const isIndex = x => !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length > 0;

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
  let priv = null;
  try { priv = store?.get(VOCAB_AUDIO_KV, null); } catch { priv = null; }
  if (isIndex(priv)) return { base, files: priv, source: 'private' };
  if (!publicP) publicP = (async () => {
    try {
      const r = await f(new URL('manifest.json', base).href, { cache: 'default' });
      const j = r.ok ? await r.json() : {};
      return isIndex(j) ? j : {};
    } catch { return {}; }
  })();
  const files = await publicP;
  return { base, files, source: isIndex(files) ? 'public' : 'none' };
}

/** For tests: forget the cached base and public index. */
export const resetAudio = () => { baseP = null; publicP = null; };

/**
 * The recording's URL for a text, or null.
 * @param {any} content @param {string} text @param {{store?: any, fetch?: typeof fetch}} [o]
 */
export async function audioUrl(content, text, o) {
  const { base, files } = await audioManifest(content, o);
  const file = files[audioKey(text)];
  return file ? new URL(file, base).href : null;
}

/** @type {HTMLAudioElement | null} */ let cur = null;
/** @type {SpeechSynthesisVoice | null | undefined} */ let voice;

function germanVoice() {
  if (voice !== undefined || typeof speechSynthesis === 'undefined') return voice || null;
  const vs = speechSynthesis.getVoices().filter(v => /^de[-_]/i.test(v.lang) && !/multilingual/i.test(v.name));
  if (!vs.length) return null;   // voices load late on some browsers; try again next time
  voice = vs.find(v => /Anna|Helena|Petra|Markus|Google Deutsch/i.test(v.name)) || vs[0];
  return voice;
}

export function stop() {
  if (cur) { cur.pause(); cur = null; }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/**
 * @param {any} content @param {string} text @param {any} [store]  the open store, for the private index
 * @returns {Promise<boolean>} false when there is no recording and no German voice
 */
export async function play(content, text, store = null) {
  stop();
  const url = await audioUrl(content, text, { store });
  if (url) {
    cur = new Audio(url);
    cur.play().catch(() => {});
    return true;
  }
  const v = germanVoice();
  if (v) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE'; u.voice = v; u.rate = 0.95;
    speechSynthesis.speak(u);
    return true;
  }
  return false;
}

/** Warm the index so the first tap plays at once. @param {any} content @param {any} [store] */
export const prefetchAudio = (content, store = null) => { audioManifest(content, { store }).catch(() => {}); };
