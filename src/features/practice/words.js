/* Practice: exam words. The words he saved in mock exams live in the private results repository (data/vocab.json).
   Practice reads that file at runtime with the GitHub token from the store (secrets.githubToken), keeps a trimmed copy
   in the profile's 'words.exam' collection, and turns each word into a round item: his exam sentence with the word
   gapped, or "type the noun with der, die or das" when the sentence has no article before it.
   Ported from Igloo's b1more.js. trimWords/toItem/inQueue are pure and tested in node; fetchWords takes its fetch. */
import { wordId } from '../../domain/itemids.js';
import { wordTriage } from '../../domain/wordtriage.js';

export const COLLECTION = 'words.exam';
/** At most one request per 10 minutes. */
export const REFRESH_MS = 10 * 60e3;
const MOD = /** @type {Record<string, string>} */ ({ lesen: 'Lesen', hoeren: 'Hören', schreiben: 'Schreiben', sprechen: 'Sprechen' });

const parse = (/** @type {any} */ s) => { if (!s) return null; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return null; } };

/**
 * vocab.json rows → one record per lemma (earliest test wins), only glossed words with a sentence.
 * @param {any[]} rows @param {Record<string, [string, string]>} wordmap lemma → [word id, level]
 */
export function trimWords(rows, wordmap, has = null) {
  /** @type {Map<string, any>} */ const by = new Map();
  for (const r of rows || []) {
    if (!r || r.deleted || !r.gloss || !(r.lemma || r.word) || !r.sentence) continue;
    const lemma = String(r.lemma || r.word).trim();
    const k = lemma.toLowerCase();   // one record per word whatever its case, as Look up groups them
    if (!by.has(k) || (r.day || 99) < (by.get(k).day || 99)) by.set(k, r);
  }
  const out = [];
  for (const r of by.values()) {
    const lemma = String(r.lemma || r.word).trim();
    const wm = wordmap[lemma] || wordmap[lemma.toLowerCase()] || wordmap[lemma.charAt(0).toUpperCase() + lemma.slice(1)] || null;
    const ex = (parse(r.examples) || []).find((/** @type {any} */ e) => e && e.de && e.de !== r.sentence) || null;
    const det = parse(r.details) || {};
    out.push({ id: wordId(lemma, wordmap, has), lemma, art: (r.gender || '').replace(/[()]/g, '') || null, pl: r.plural || null,
      pos: r.pos || null, gloss: String(r.gloss).split(/[,;]/).map(s => s.trim()).filter(Boolean), sent: r.sentence, form: r.word || lemma,
      ex: ex ? { de: ex.de, en: ex.en || '' } : null, cluster: r.cluster || null, day: r.day || null, module: r.module || null, teil: r.teil || null,
      examDays: r.exam_days || 0, level: wm ? wm[1] : '', conf: (det.confusions || [])[0] || null, zipf: r.zipf || 0 });
  }
  return out.sort((a, b) => (b.examDays - a.examDays) || (b.zipf - a.zipf));
}

/**
 * Whether a trimmed word is in the review queue today: the shared triage (domain/wordtriage.js, UX §3.3).
 * trimWords keeps only glossed words. @param {any} w a trimmed word @param {string} phase clock phase
 */
export const inQueue = (w, phase) => wordTriage({ glossed: true, zipf: w.zipf, examDays: w.examDays, level: w.level }, phase) === 'queue';

const DETS = new Set(`der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner mein meine meinen meinem meiner
  dein deine deinen deinem sein seine seinen seinem ihr ihre ihren ihrem unser unsere unseren euer eure dieser diese dieses diesen diesem
  jeder jede jedes jeden jedem welche welcher welches viele wenige einige mehrere alle beide im am zum zur vom beim ins ans aufs`.split(/\s+/));

/** A trimmed word → a round item, or null when the word is not in its own sentence. @param {any} w */
export function toItem(w) {
  const s = String(w.sent), f = String(w.form);
  const re = new RegExp(`(^|[^\\p{L}])(${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'u');
  const m = s.match(re);
  let i;
  if (m && m.index != null) i = m.index + m[1].length;
  else { const k = s.toLowerCase().indexOf(f.toLowerCase()); if (k < 0) return null; i = k; }
  const prompt = s.slice(0, i) + '___' + s.slice(i + f.length);
  const before = s.slice(0, i).toLowerCase().match(/[\p{L}]+/gu) || [];
  const noun = /^nomen$/i.test(w.pos || '') && !!w.art;
  const needArt = noun && !before.slice(-2).some(x => DETS.has(x));
  const head = noun ? `${w.art} ${w.lemma}${w.pl && !/^\(?pl/i.test(w.pl) ? ', ' + w.pl : ''}` : w.lemma;
  return { id: w.id, kind: 'word', area: 'words', group: w.cluster || 'words', teil: null, fn: null, star: false, trap: null, focus: ['word'], strict: [],
    plan: 'recall', task: needArt ? 'Type the noun with der, die or das.' : null, prompt, promptLang: 'de', hl: null, partner: null, prefill: null,
    gap: !needArt, showGap: needArt, accept: needArt ? [`${w.art} ${w.lemma}`] : [f], anywhere: false, literal: true, loose: !needArt,
    model: needArt ? `${w.art} ${w.lemma}` : s, wrong: [], rule: '', src: 'exam', level: w.level || 'B1', gloss: w.gloss.join(', '),
    source: `From Test ${w.day || '?'}${w.module ? ' · ' + (MOD[w.module] || w.module) : ''}`,
    card: { head, ex: w.ex ? w.ex.de : null, exEn: w.ex ? w.ex.en : null, conf: w.conf } };
}

/** Round items for the words that pass triage today. @param {any[]} words @param {string} phase */
export const wordItems = (words, phase) => (words || []).filter(w => inQueue(w, phase)).map(toItem).filter(Boolean);

/**
 * Read data/vocab.json from the private repository. Returns the next cache value and what changed.
 * @param {{token: string | null, cached: any, wordmap: Record<string, [string, string]>, url: string, fetch: typeof fetch, now: number, online?: boolean, force?: boolean}} o
 * @returns {Promise<{state: 'ok'|'cached'|'no-token'|'error', cache: any, added: string[], error?: string}>}
 */
export async function fetchWords({ token, cached, wordmap, url, fetch: f, now, online = true, force = false, has = null }) {
  if (!token) return { state: 'no-token', cache: cached, added: [] };
  if (!online || (!force && cached && now - cached.fetchedAt < REFRESH_MS)) return { state: 'cached', cache: cached, added: [] };
  try {
    const r = await f(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json',
      ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) }, cache: 'no-store' });
    if (r.status === 304 && cached) return { state: 'ok', cache: { ...cached, fetchedAt: now }, added: [] };
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    const rows = Array.isArray(body) ? body : body.words || [];
    const words = trimWords(rows, wordmap, has);
    const prev = new Set((cached?.words || []).map((/** @type {any} */ w) => w.id));
    const added = cached ? words.filter(w => !prev.has(w.id)) : [];
    return { state: 'ok', added: added.map(w => w.id), cache: { v: 1, fetchedAt: now, etag: r.headers.get('etag'), total: rows.filter((/** @type {any} */ x) => x && !x.deleted).length,
      words, added: added.map(w => w.id), addedTest: added.length ? Math.max(...added.map(w => w.day || 0)) : null } };
  } catch (e) {
    return { state: 'error', cache: cached, added: [], error: /** @type {Error} */ (e).message };
  }
}
