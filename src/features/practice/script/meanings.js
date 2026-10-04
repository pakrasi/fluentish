/* Script mode: "Get meanings", the one Claude call of phase 1 (SCRIPT-UX §7). Words he marked that the word list has no
   meaning for go in one batched call with his key, each with the sentence it stands in, and come back with a
   dictionary form and a short English meaning. The prompt is a public template that says nothing about the learner;
   the reply is validated and rendered as text only. */
import { ask } from '../../../services/claude.js';
import { config } from '../../../core/config.js';

/**
 * @param {{surface: string, lemma: string, sentence: string}[]} words
 * @returns {string}
 */
export function meaningsPrompt(words) {
  const list = words.map((w, i) => `${i + 1}. word: ${w.surface} | guessed dictionary form: ${w.lemma} | sentence: ${w.sentence}`).join('\n');
  return 'You help a learner of German (level B1) with words from a text he will say aloud. For each word below, give its '
    + 'dictionary form (nouns with der, die or das and capitalised; verbs in the infinitive, separable prefix attached; '
    + 'adjectives in the base form) and a short English meaning that fits the sentence (at most 5 words).\n'
    + `${list}\n`
    + 'Reply with JSON only: [{"n": 1, "lemma": "die Schnittstelle", "en": "interface"}, …], one object per word, in order.';
}

/**
 * Parse the reply; unusable rows are dropped.
 * @param {string} text @param {number} count
 * @returns {Map<number, {lemma: string, art: string | null, en: string}>}  1-based index → meaning
 */
export function parseMeanings(text, count) {
  /** @type {Map<number, {lemma: string, art: string | null, en: string}>} */ const out = new Map();
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return out;
  /** @type {any} */ let j = null;
  try { j = JSON.parse(m[0]); } catch { return out; }
  if (!Array.isArray(j)) return out;
  j.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
    const n = Number.isInteger(r?.n) ? r.n : i + 1;
    if (n < 1 || n > count || typeof r?.en !== 'string' || typeof r?.lemma !== 'string') return;
    const en = r.en.replace(/\s+/g, ' ').trim().slice(0, 80);
    let lemma = r.lemma.replace(/\s+/g, ' ').trim().slice(0, 60);
    const am = /^(der|die|das)\s+(\S.*)$/i.exec(lemma);
    const art = am ? am[1].toLowerCase() : null;
    if (am) lemma = am[2];
    if (!en || !lemma || /[<>{}]/.test(lemma + en)) return;
    out.set(n, { lemma, art, en });
  });
  return out;
}

/**
 * @param {{key: string, words: {surface: string, lemma: string, sentence: string}[], fetch?: typeof fetch}} o
 */
export async function getMeanings({ key, words, fetch: f }) {
  const res = await ask({ key, user: meaningsPrompt(words), model: config.anthropic.models.check, maxTokens: 60 + 40 * words.length, effort: null, fallback: false, fetch: f });
  return parseMeanings(res.text, words.length);
}
