/* B1 trainer: speech helpers. Pure (no DOM, no recogniser); an ES module, tested in node.
   clean(transcript)            → the transcript without fillers, a self-repair keeps the last try ("ich glaube ich glaube dass" → "ich glaube dass")
   grade(transcript, item, cal, opts) → per-check rows for Say it aloud: {chunk, verbFinal, fuerVor, rest, partial, ok, text}
        each check is true (✓), false (✗), 'not-in' (not in this answer) or 'off' (the mic check showed the phone fixes it)
        opts.match(text) → bool: the phrase check (B1.gradeAnswer(...).matchOk in the app; Match.check in tests)
        opts.rest: the rest-of-sentence status from the grader ('ok'|'differs'|'na'|null). It counts (partial: Hard)
        only when the mic check showed the phone keeps article and ending mistakes; otherwise the row is 'off'.
   CANARY                       → the 12 mic-check sentences, 3 per class, all wrong on purpose
   canaryKept(cls, said)        → did the recogniser keep the mistake in `said`?
   calibrate(results)           → {verbFinal, fuerVor, articles, endings}: true when every sentence of that class kept its mistake
   syllables(text)              → a syllable estimate for German (vowel groups) */
// @ts-check
import * as Det from './detect.js';
/** @typedef {boolean | 'not-in' | 'off'} CheckState  ✓, ✗, not in this answer, or off (the mic check showed the phone fixes it) */
/** @typedef {{verbFinal?: boolean, fuerVor?: boolean, articles?: boolean, endings?: boolean}} Asr  what the mic check showed the phone keeps */
const fold = (/** @type {unknown} */ s) => String(s || '').normalize('NFC').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const toks = (/** @type {unknown} */ s) => fold(s).replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
const FILLERS = new Set(['aeh', 'aehm', 'oehm', 'oeh', 'hm', 'hmm', 'mhm', 'em', 'eh', 'aeh,']);

/** @param {unknown} transcript */
function clean(transcript) {
  let w = String(transcript || '').replace(/[„“"]/g, ' ').split(/\s+/).filter(Boolean);
  w = w.filter(x => !FILLERS.has(fold(x).replace(/[^\p{L}]/gu, '')));
  // self-repair: an immediately repeated run of 1–4 words keeps the last copy ("dass das dass das ist" → "dass das ist")
  for (let changed = true; changed;) {
    changed = false;
    for (let n = 4; n >= 1 && !changed; n--) {
      for (let i = 0; i + 2 * n <= w.length; i++) {
        const a = w.slice(i, i + n).map(x => fold(x).replace(/[^\p{L}\p{N}]/gu, '')).join(' ');
        const b = w.slice(i + n, i + 2 * n).map(x => fold(x).replace(/[^\p{L}\p{N}]/gu, '')).join(' ');
        if (a && a === b) { w.splice(i, n); changed = true; break; }
      }
    }
  }
  return w.join(' ').replace(/\s+([,.!?])/g, '$1').trim();
}

const SUBS = new Set(['dass', 'weil', 'ob', 'wenn', 'obwohl', 'damit', 'falls']);
/**
 * @param {unknown} transcript
 * @param {{model?: string, trap?: string, focus?: string[]}} [item]
 * @param {{asr?: Asr} | null} [cal]
 * @param {{match?: (text: string) => boolean, rest?: 'ok'|'differs'|'na'|null}} [opts]
 * @returns {{text: string, chunk: boolean | null, verbFinal: CheckState, fuerVor: CheckState, rest: CheckState, partial: boolean, ok: boolean}}
 */
function grade(transcript, item = {}, cal = null, opts = {}) {
  const text = clean(transcript);
  const t = toks(text), model = item.model || '';
  /** @type {Asr} */ const asr = (cal && cal.asr) || {};
  const classes = Det ? Det.classes(text, model) : [];
  const chunk = opts.match ? !!opts.match(text) : null;
  // verb at the end: only when the answer has a clause that needs it
  /** @type {CheckState} */ let verbFinal = t.some(x => SUBS.has(x)) ? !classes.includes('verb-final') && !classes.includes('inversion') : 'not-in';
  if (verbFinal !== 'not-in' && asr.verbFinal === false) verbFinal = 'off';
  // für or vor: only on items about it (trap/focus, or Angst/warnen/sich schämen/fürchten … vor in the model), as detect.js
  const hasFV = item.trap === 'fuer-vor' || (item.focus || []).includes('fuer-vor') || /\b(angst|warnen|warnt|schämen|schäme|fürchten)\b.*\bvor\b/i.test(model);
  /** @type {CheckState} */ let fuerVor = 'not-in';
  if (hasFV) {
    const d = Det ? Det.run(text, item) : null;
    fuerVor = !(d && d.cls === 'fuer-vor');
    if (asr.fuerVor === false) fuerVor = 'off';
  }
  const ok = chunk !== false && verbFinal !== false && fuerVor !== false;
  /** @type {CheckState} */ let rest = opts.rest === 'ok' ? true : opts.rest === 'differs' ? false : 'not-in';
  if (rest === false && !(asr.endings === true && asr.articles === true)) rest = 'off';
  return { text, chunk, verbFinal, fuerVor, rest, partial: ok && rest === false, ok };
}

// the mic check: every sentence is wrong on purpose; a class counts as "checked" when the phone kept all three mistakes
/** @type {{cls: 'verbFinal'|'fuerVor'|'articles'|'endings', de: string, keep?: string}[]} */
const CANARY = [
  { cls: 'verbFinal', de: 'Ich glaube, dass das ist eine gute Idee.' },
  { cls: 'verbFinal', de: 'Ich komme nicht, weil ich muss arbeiten.' },
  { cls: 'verbFinal', de: 'Ich weiß nicht, ob er hat Zeit.' },
  { cls: 'fuerVor', de: 'Ich habe Angst für der Prüfung.', keep: 'fuer der pruefung' },
  { cls: 'fuerVor', de: 'Er warnt uns für dem Hund.', keep: 'fuer dem hund' },
  { cls: 'fuerVor', de: 'Sie hat Angst für Spinnen.', keep: 'fuer spinnen' },
  { cls: 'articles', de: 'Der Thema ist interessant.', keep: 'der thema' },
  { cls: 'articles', de: 'Ich habe der Problem gelöst.', keep: 'der problem' },
  { cls: 'articles', de: 'Die Wetter ist heute schön.', keep: 'die wetter' },
  { cls: 'endings', de: 'Ich habe einen neue Auto.', keep: 'einen neue' },
  { cls: 'endings', de: 'Wir wohnen in einer kleinen Haus.', keep: 'einer kleinen haus' },
  { cls: 'endings', de: 'Das ist ein gute Frage.', keep: 'ein gute frage' },
];
/** @param {{cls: string, keep?: string}} c @param {unknown} said */
function canaryKept(c, said) {
  const s = toks(said).join(' ');
  if (c.cls === 'verbFinal') return Det ? Det.classes(String(said), null).includes('verb-final') : false;
  return (' ' + s + ' ').includes(' ' + c.keep + ' ');
}
// results: [{i, said}] → per class {kept, n, checked}
/** @param {{i: number, said: string}[]} results */
function calibrate(results) {
  /** @type {Record<string, {kept: number, n: number, checked: boolean}>} */ const out = {};
  for (const cls of ['verbFinal', 'fuerVor', 'articles', 'endings']) {
    const rs = results.filter(r => CANARY[r.i] && CANARY[r.i].cls === cls);
    const kept = rs.filter(r => canaryKept(CANARY[r.i], r.said)).length;
    out[cls] = { kept, n: rs.length, checked: rs.length > 0 && kept === rs.length };
  }
  return out;
}
/** @param {unknown} text */
function syllables(text) {
  return toks(text).reduce((a, w) => a + Math.max(1, (w.replace(/ae|oe|ue/g, 'a').replace(/(ei|ie|au|eu|aeu)/g, 'a').match(/[aeiouy]+/g) || []).length), 0);
}

const api = { clean, grade, CANARY, canaryKept, calibrate, syllables };
export default api;
export { clean, grade, CANARY, canaryKept, calibrate, syllables };
