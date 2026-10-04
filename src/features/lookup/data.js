/* Look up: loading and caching. Content files come through ctx.content (manifest ids, cached by hash); each section
   is turned into rows and search docs once per app session and kept here, so going back to Look up, switching
   sections or opening a word sheet never reloads or re-indexes anything. My words come from the private results
   repository through the device's GitHub token (Profile › Connections) and are refetched after ten minutes. */
import { config } from '../../core/config.js';
import { buildIndex } from './search.js';
import { LANGS, phraseRows, dictRows, layerRows, topicRows, frameGroups, phraseDocs, dictDocs, layerDocs, topicDocs, frameDocs, myWordDocs } from './sources.js';
import { fetchVocab, mergeVocab, lemmaGroups, byImportance, headword, VocabError } from './words.js';

/** @typedef {{rows: any, index: import('./search.js').IndexedDoc[]}} Section */

/** @type {Map<string, Promise<any>>} */
const cache = new Map();
const once = (/** @type {string} */ key, /** @type {() => Promise<any>} */ make) => {
  let p = cache.get(key);
  if (!p) { p = make(); cache.set(key, p); p.catch(() => cache.delete(key)); }
  return p;
};

/** @param {any} content @param {string} lang @returns {Promise<Section>} */
export function phrases(content, lang) {
  const L = LANGS[lang];
  return once(`phrases:${lang}`, async () => {
    const [en, target, prio] = await Promise.all([content.load('igloo.chunks.en'), content.load(L.chunks), L.priority ? content.load(L.priority).catch(() => null) : null]);
    const rows = phraseRows(en, target, prio);
    return { rows, index: buildIndex(phraseDocs(rows)) };
  });
}

/** @param {any} content @param {string} lang @returns {Promise<Section>} */
export function dictionary(content, lang) {
  const L = LANGS[lang];
  return once(`dict:${lang}`, async () => {
    const rows = L.words ? dictRows(await content.load(L.words)) : [];
    return { rows, index: buildIndex(dictDocs(rows)) };
  });
}

/** Grammar layer and verb frames (one file pair), B1 topics, Sprechen frames, notes. @param {any} content @param {string} lang */
export function grammar(content, lang) {
  const L = LANGS[lang];
  return once(`grammar:${lang}`, async () => {
    const [fw, lf, plan, items, frames, turns] = await Promise.all([
      content.load('igloo.framework'), content.load(L.lang),
      L.b1 ? content.load('b1.plan') : null, L.b1 ? content.load('b1.grammar') : [], L.b1 ? content.load('b1.frames') : [],
      content.load('igloo.turns').catch(() => null),
    ]);
    const layers = layerRows(fw, lf);
    const topics = plan ? topicRows(plan, items) : [];
    const sprechen = plan ? frameGroups(frames, plan) : [];
    return {
      layers, topics, sprechen, notes: (lf && lf.notes) || {}, turns,
      index: buildIndex([...topicDocs(topics), ...layerDocs(layers), ...frameDocs(sprechen)]),
    };
  });
}

/** Everything the search needs except My words. @param {any} content @param {string} lang */
export const allContent = (content, lang) => Promise.all([dictionary(content, lang), phrases(content, lang), grammar(content, lang)]);

/* ---------- My words ---------- */

/** @type {{at: number, key: string, p: Promise<any[]>} | null} */
let remote = null;
const FRESH_MS = 10 * 60 * 1000;

/**
 * @typedef {object} MyWords
 * @property {'nolink' | 'ok' | 'auth' | 'net' | 'http'} status
 * @property {any[]} groups   lemma groups by importance
 * @property {import('./search.js').IndexedDoc[]} index
 * @property {number} local   captures on this device that the repository does not have yet
 */

/**
 * @param {any} store
 * @param {{force?: boolean, fetch?: typeof fetch}} [o]
 * @returns {Promise<MyWords>}
 */
export async function myWords(store, { force = false, fetch: f } = {}) {
  const token = (store.get('secrets', {}) || {}).githubToken || null;
  const local = store.get('vocab.local', []) || [], events = store.get('vocab.events', []) || [];
  /** @type {MyWords['status']} */ let status = 'nolink';
  /** @type {any[]} */ let words = [];
  if (token) {
    const key = String(token).slice(-6);
    if (force || !remote || remote.key !== key || Date.now() - remote.at > FRESH_MS) {
      const p = fetchVocab({ token, repo: config.resultsRepo, api: config.github.api, fetch: f });
      remote = { at: Date.now(), key, p };
      p.catch(() => { if (remote && remote.p === p) remote = null; });
    }
    try { words = await remote.p; status = 'ok'; } catch (e) { status = e instanceof VocabError ? e.code : 'net'; }
  }
  const merged = mergeVocab(words, local, events);
  const groups = byImportance(lemmaGroups(merged));
  return { status, groups, index: buildIndex(myWordDocs(groups, headword)), local: merged.filter(w => w.local).length };
}

/** Forget the cached repository copy (after the token changes). */
export const resetMyWords = () => { remote = null; };

/* ---------- word map ---------- */

/** The B1 word map (lemma → [word id, level]) that exam-word card ids are built from; {} if it cannot load. @param {any} content */
export const wordmap = content => once('wordmap', () => content.load('b1.wordmap')).catch(() => ({}));
