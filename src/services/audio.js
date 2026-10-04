/* Word and sentence audio, shared by Look up (▶ on rows and the word sheet) and Practice (▶ on exam-word cards).
   Neural recordings come from the B1 exam app's media origin: <exam media>/vocab/manifest.json maps the text to a
   file. CSP: the manifest needs connect-src and the files media-src for that origin (index.html allows both).
   Without a recording, the device's German voice if it has a real one, else nothing (the caller says so). */

/** b1-exam's audio key: no "a) " list prefix, single spaces. @param {string} t */
export const audioKey = t => String(t || '').replace(/^[abc]\)\s*/, '').replace(/\s+/g, ' ').trim();

/** @type {Promise<{base: string, files: Record<string, string>}> | null} */ let manifestP = null;

/**
 * The recordings manifest, fetched once per session (a failed fetch is an empty manifest, tried again next session).
 * @param {{manifest: () => Promise<any>}} content @param {typeof fetch} [f]
 * @returns {Promise<{base: string, files: Record<string, string>}>}
 */
export function audioManifest(content, f = (...a) => fetch(...a)) {
  if (!manifestP) manifestP = (async () => {
    const m = await content.manifest();
    const exam = (m.exams || []).find((/** @type {any} */ e) => e.media);
    if (!exam) return { base: '', files: {} };
    const base = new URL('vocab/', exam.media).href;
    try {
      const r = await f(new URL('manifest.json', base).href, { cache: 'default' });
      return { base, files: r.ok ? await r.json() : {} };
    } catch { return { base, files: {} }; }
  })().catch(() => { manifestP = null; return { base: '', files: {} }; });
  return manifestP;
}

/** The recording's URL for a text, or null. @param {any} content @param {string} text */
export async function audioUrl(content, text) {
  const { base, files } = await audioManifest(content);
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
 * @param {any} content @param {string} text
 * @returns {Promise<boolean>} false when there is no recording and no German voice
 */
export async function play(content, text) {
  stop();
  const url = await audioUrl(content, text);
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

/** Warm the manifest so the first tap plays at once. @param {any} content */
export const prefetchAudio = content => { audioManifest(content).catch(() => {}); };
