/* How hard a text is for him: personal coverage, the share of a text's running words he knows, and the band it puts
   the text in. Language-neutral (the stop words and the cognate pattern are the pack's, pack.reading). Pure; tested in
   node (tests/unit/text-layer.test.mjs). Not shown anywhere yet: the reader (round 4, L2b) will read it.

   A running word counts as known when any of:
     - his knowledge score (domain/knowledge.js, one score across every source) for its word-list item is known or shaky;
     - it is a function word of the pack (pack.reading.stop);
     - its word-list level is at least two levels below his, it is common (zipf 5 or more), and he has never missed it
       (no score of unknown);
     - a word off the list that an English speaker reads at once (pack.reading.cognate, as Scripts use it);
     - a compound whose listed last part he knows.
   Names, foreign words and numbers are not running words (classify() marks them). Unseen words at or above his level
   are unknown.

   Bands (the usual reading thresholds; Hu and Nation 2000, Laufer 1989):
     easy     98 % or more    extensive reading: read for pleasure, look nothing up
     study    95 % to 98 %    intensive reading: a word or two per sentence to look up
     stretch  90 % to 95 %    hard work, with support (glosses, a translation)
     hard     below 90 %      too hard to read for now */
// @ts-check
import { scopeItem } from '../itemids.js';

/** @typedef {import('../../lang/types.js').LanguagePack} LanguagePack */
/** @typedef {import('../../lang/types.js').WordIndex} Index */
/** @typedef {import('../knowledge.js').State} State */
/** @typedef {'easy' | 'study' | 'stretch' | 'hard'} Band */

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** A CEFR level's place in LEVELS; an unknown level reads as B1. @param {string | null | undefined} l */
export const levelRank = l => { const i = LEVELS.indexOf(String(l || '').toUpperCase()); return i < 0 ? 2 : i; };

/** The lowest coverage of each band, highest first; below the last is 'hard'. */
export const BANDS = /** @type {readonly {band: Band, min: number}[]} */ ([{ band: 'easy', min: 0.98 }, { band: 'study', min: 0.95 }, { band: 'stretch', min: 0.90 }]);

/** The band of a coverage (0..1). @param {number} coverage @returns {Band} */
export function bandOf(coverage) {
  for (const b of BANDS) if (coverage >= b.min - 1e-9) return b.band;
  return 'hard';
}

/**
 * One classified word, as domain/text/suggest.js classify() returns it (only the fields read here).
 * @typedef {{type: 'skip' | 'name' | 'word', lemma: string, entry: import('../../lang/types.js').WordEntry | null, how: string}} Classified
 */
/** @typedef {'known' | 'stop' | 'easy' | 'cognate' | 'compound' | 'unknown'} Why */

/**
 * His coverage of a text: known running words over all running words, and the band.
 * @param {Classified[][]} sentences  classify() per sentence (the names and numbers it marks are left out)
 * @param {object} o
 * @param {LanguagePack} o.pack
 * @param {{get: (itemId: string) => {state: State}}} o.view   his knowledge (domain/knowledge.js knowledge())
 * @param {string} [o.level]          his level ('B1')
 * @param {Index} [o.idx]             the pack's word list, for a compound's last part
 * @param {Set<string>} [o.known]     lemmas (lower case) to count as known whatever the score (words he unmarked)
 * @returns {{words: number, known: number, coverage: number, band: Band, unknown: string[], by: Record<Why, number>}}
 *   unknown: the unknown lemmas, most frequent in the text first
 */
export function personalCoverage(sentences, { pack, view, level = 'B1', idx, known: mark = new Set() }) {
  const mine = levelRank(level);
  const stop = pack.reading?.stop || new Set();
  const cognate = pack.reading?.cognate || null;
  const look = pack.grammar?.morphology?.lookup || null;
  const fold = (/** @type {string} */ s) => pack.text.fold(s.toLowerCase());
  const item = (/** @type {{id: string}} */ e) => scopeItem(pack.id, `W:${e.id}`);
  const state = (/** @type {{id: string} | null | undefined} */ e) => (e && e.id ? view.get(item(e)).state : 'unseen');
  const knows = (/** @type {State} */ s) => s === 'known' || s === 'shaky';
  /** @type {Record<Why, number>} */ const by = { known: 0, stop: 0, easy: 0, cognate: 0, compound: 0, unknown: 0 };
  /** @type {Map<string, number>} */ const unknown = new Map();
  let n = 0;
  for (const sentence of sentences) for (const x of sentence) {
    if (!x || x.type !== 'word') continue;
    n++;
    /** @type {Why} */ let why = 'unknown';
    const st = state(x.entry);
    const low = x.lemma.toLowerCase();
    if (knows(st) || mark.has(low)) why = 'known';
    else if (stop.has(fold(x.lemma))) why = 'stop';
    else if (x.entry && st !== 'unknown' && levelRank(x.entry.level) <= mine - 2 && (x.entry.zipf ?? 0) >= 5) why = 'easy';
    else if (cognate && !x.entry && cognate.test(x.lemma)) why = 'cognate';
    else if (x.how === 'compound' && look && idx && knows(state(look(x.lemma, idx).part))) why = 'compound';
    by[why]++;
    if (why === 'unknown') unknown.set(x.lemma, (unknown.get(x.lemma) || 0) + 1);
  }
  const k = n - by.unknown;
  const coverage = n ? k / n : 1;
  return { words: n, known: k, coverage, band: bandOf(coverage), unknown: [...unknown.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]), by };
}
