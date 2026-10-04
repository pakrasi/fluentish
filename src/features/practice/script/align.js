/* Script mode: editing a script without losing what is attached to it (SCRIPT-UX §7.5). Pure; tested in node.

   Each sentence and section keeps the short id it got when it was first parsed. On save, a section's old and new
   sentences are aligned in order: identical text keeps its id; a sentence at the same place with a word overlap of
   0.6 or more keeps its id and gets changedAt; anything else gets a new id; removed sentences are listed (their
   flags go). Marks are re-attached by sentence id and the word they point at (its surface, else the same lemma);
   a mark whose word has gone is removed and named in the summary. Word cards never change: their ids are lemma based. */
import { tokenize, splitSentences } from './parse.js';

const words = (/** @type {string} */ s) => tokenize(s).filter(t => t.w).map(t => t.t.toLowerCase());

/** Word overlap of two sentences: shared words ÷ the longer one's words. @param {string} a @param {string} b */
export function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return 0;
  const bag = new Map();
  for (const w of B) bag.set(w, (bag.get(w) || 0) + 1);
  let n = 0;
  for (const w of A) { const k = bag.get(w) || 0; if (k) { n++; bag.set(w, k - 1); } }
  return n / Math.max(A.length, B.length);
}

/**
 * @param {import('./parse.js').Sentence[]} old
 * @param {{de: string, en?: string | null}[]} next
 * @param {() => string} id  new ids
 * @param {string} at        changedAt stamp
 * @returns {{sentences: import('./parse.js').Sentence[], changed: string[], added: string[], removed: import('./parse.js').Sentence[]}}
 */
export function alignSentences(old, next, id, at) {
  const n = old.length, m = next.length;
  // longest common subsequence on identical text
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = old[i].de === next[j].de ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {[number, number][]} */ const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (old[i].de === next[j].de) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  /** @type {(import('./parse.js').Sentence | null)[]} */ const out = new Array(m).fill(null);
  /** @type {string[]} */ const changed = [], added = [];
  const usedOld = new Set();
  for (const [i, j] of pairs) { out[j] = { ...old[i], ...(next[j].en !== undefined && next[j].en !== null ? { en: next[j].en } : {}) }; usedOld.add(i); }
  // the gaps between identical anchors: pair in order when the words mostly agree
  const anchors = [[-1, -1], ...pairs, [n, m]];
  for (let a = 0; a + 1 < anchors.length; a++) {
    const [i0, j0] = anchors[a], [i1, j1] = anchors[a + 1];
    const os = []; for (let i = i0 + 1; i < i1; i++) os.push(i);
    const ns = []; for (let j = j0 + 1; j < j1; j++) ns.push(j);
    let oi = 0;
    for (const j of ns) {
      let hit = -1;
      for (let k = oi; k < os.length; k++) if (overlap(old[os[k]].de, next[j].de) >= 0.6) { hit = k; break; }
      const same = hit < 0 ? old.findIndex((o, i) => !usedOld.has(i) && o.de === next[j].de) : -1;   // moved, not edited
      if (same >= 0) { out[j] = { ...old[same] }; usedOld.add(same); continue; }
      if (hit >= 0) {
        const o = old[os[hit]];
        out[j] = { id: o.id, de: next[j].de, en: next[j].en !== undefined ? (next[j].en ?? o.en) : o.en, changedAt: at };
        if (o.p) /** @type {any} */ (out[j]).p = true;
        usedOld.add(os[hit]); changed.push(o.id); oi = hit + 1;
      } else {
        const s = { id: id(), de: next[j].de, en: next[j].en ?? null };
        out[j] = s; added.push(s.id);
      }
    }
  }
  const removed = old.filter((_, i) => !usedOld.has(i));
  return { sentences: /** @type {import('./parse.js').Sentence[]} */ (out), changed, added, removed };
}

/**
 * Apply an edit to a script.
 * @param {any} script
 * @param {{id?: string | null, title: string, kind?: 'talk' | 'retell', note?: string | null, de: string, en?: string | null}[]} edits
 *   the sections in their new order; de is the section's German (sentences split again), en optional: one English line
 *   per German sentence (used only when the counts agree)
 * @param {{id: () => string, at: string, lemma?: (surface: string) => string}} o
 * @returns {{script: any, sections: {id: string, title: string, changed: number, added: number, removed: number}[], marksRemoved: string[]}}
 */
export function applyEdit(script, edits, { id, at, lemma = s => s.toLowerCase() }) {
  const oldById = new Map(script.sections.map((/** @type {any} */ s) => [s.id, s]));
  /** @type {any[]} */ const sections = [];
  /** @type {{id: string, title: string, changed: number, added: number, removed: number}[]} */ const report = [];
  /** @type {Set<string>} */ const touched = new Set();
  /** @type {Set<string>} */ const alive = new Set();
  for (const e of edits) {
    const des = splitSentences(e.de);
    const ens = e.en ? String(e.en).split(/\n+/).map(x => x.trim()).filter(Boolean) : [];
    const next = des.map((de, i) => ({ de, en: ens.length === des.length ? ens[i] : undefined }));
    const old = e.id ? oldById.get(e.id) : null;
    if (old) {
      const r = alignSentences(old.sentences, next, id, at);
      sections.push({ ...old, title: e.title || old.title, kind: e.kind || old.kind, note: e.note !== undefined ? e.note : old.note, sentences: r.sentences });
      r.changed.forEach(x => touched.add(x));
      if (r.changed.length || r.added.length || r.removed.length) report.push({ id: old.id, title: e.title || old.title, changed: r.changed.length, added: r.added.length, removed: r.removed.length });
    } else {
      const sid = id();
      const sents = next.map(x => ({ id: id(), de: x.de, en: x.en ?? null }));
      sections.push({ id: sid, title: e.title || '', kind: e.kind || 'talk', note: e.note ?? null, sentences: sents });
      report.push({ id: sid, title: e.title || '', changed: 0, added: sents.length, removed: 0 });
    }
  }
  const sentById = new Map();
  for (const s of sections) for (const x of s.sentences) { sentById.set(x.id, x); alive.add(x.id); }
  /** @type {string[]} */ const marksRemoved = [];
  const marks = [];
  const oldSentIds = new Set(script.sections.flatMap((/** @type {any} */ x) => x.sentences.map((/** @type {any} */ y) => y.id)));
  for (let mk of script.marks || []) {
    let s = sentById.get(mk.sentenceId);
    // its sentence was split or rewritten: the first new sentence of the script with the same word takes the mark
    if (!s) s = [...sentById.values()].find(x => !oldSentIds.has(x.id) && tokenize(x.de).some(tk => tk.w && tk.t === mk.surface));
    if (!s) { marksRemoved.push(mk.surface); continue; }
    if (s.id !== mk.sentenceId) mk = { ...mk, sentenceId: s.id };
    const toks = tokenize(s.de).filter(t => t.w);
    const at0 = toks.find(t => t.k === mk.start);
    if (at0 && at0.t === mk.surface) { marks.push(mk); continue; }
    const same = toks.find(t => t.t === mk.surface) || toks.find(t => lemma(t.t) === String(mk.lemma).toLowerCase());
    if (same) marks.push({ ...mk, start: same.k, end: same.k, surface: same.t });
    else marksRemoved.push(mk.surface);
  }
  // unchanged text keeps its parts; changed text loses them (they no longer fit)
  for (const s of sections) for (const x of s.sentences) if (touched.has(x.id) || !x.parts) delete x.parts;
  return {
    script: { ...script, sections, marks, flagged: (script.flagged || []).filter((/** @type {string} */ f) => alive.has(f)) },
    sections: report,
    marksRemoved,
  };
}
