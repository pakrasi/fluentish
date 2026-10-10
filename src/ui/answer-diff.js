// @ts-check
/* Answer feedback with a letter diff (round 8, design C §1). The lines under a verdict: what he typed and the right
   answer, marked at the letter where it can be and at the word where it must (domain/letterdiff.js). Display only:
   the caller has graded the answer and passes what the grader found (slips, capitals, the rest's ranges).

     kind 'right-slip'  a right answer with a typo, a capital or an umlaut: one line, his answer once in its right
                        spelling, the letters to fix underlined in accent (never red; DESIGN.md Colors)
     kind 'wrong'       You and Right lines: letters he typed that differ underlined in red (600), letters he left out
                        as a faint ghost in his word, the right letters in the Right line on a green bar (500); whole
                        words struck or underlined; a far miss (mode plain) shows both lines unmarked (C F3)
     kind 'study'       the same lines for a new card's first attempt; the Right line is the study sentence
     kind 'partial'     marks only inside the grader's ranges (a phrase card's rest)

   Motion: marks draw start to end (--dur-base, ease-out) from +120 ms, 28 ms apart in reading order, at most 8 apart,
   then the rest at once; ghosts fade in with them. A wrong answer with letter marks nudges the first wrong word once
   (+200 ms). Reduced motion: every mark is there at once, no nudge. Enter-to-skip: finish().
   Accessibility: the drawn lines are aria-hidden; one .sr-only paragraph says the lines as sentences. */
import { reduced, sequence, nudge, pulse } from '../core/motion.js';
import { answerDiff, rangeDiff, slipSegs, firstDiffWord } from '../domain/letterdiff.js';
import { activePack } from '../lang/registry.js';

/** @typedef {import('../domain/letterdiff.js').Seg} Seg */
/** @typedef {import('../domain/letterdiff.js').AnswerDiff} AnswerDiff */
/** @typedef {import('../domain/letterdiff.js').Slip} Slip */
/** @typedef {'right-slip' | 'wrong' | 'study' | 'partial'} AnswerDiffKind */
/**
 * @typedef {object} AnswerDiffOpts
 * @property {AnswerDiffKind} kind
 * @property {string} [right]      the right answer (right-slip: unused, the line is built from typed and slips)
 * @property {string} [typed]      his answer; for right-slip the grader's input (the slips' offsets point into it)
 * @property {Slip[]} [slips]      right-slip: the grader's typos, capMiss and umlautMiss, each {start, end, expected}
 * @property {{ typed: string }[]} [capMiss]   wrong/study: words the grader found in the wrong case (marked as fixes)
 * @property {{ typed: { start: number, end: number }[], right: { start: number, end: number }[] }} [ranges]  partial
 * @property {boolean} [plainYou]  his line without marks (a situation grades one phrase, not his whole sentence)
 * @property {number[]} [marked]   word indexes (the pack's tokens of right) to mark as whole-word `miss` instead of a
 *   diff: a situation's phrase, his sentence plain
 * @property {number[]} [gap]      word indexes of right that fill a gap card's blank: on a far miss (no other marks) they
 *   are marked as whole-word `miss`, so the eye finds the word the card is about
 * @property {{ you?: string, right?: string, caption?: string | ((d: AnswerDiff) => string | null) }} labels
 *   from the caller's en.js section; an empty label leaves its line without one
 * @property {{ root?: string, you?: string, right?: string, label?: string, caption?: string }} [classes]  the caller's
 *   classes for the parts (practice: pr-diff, answer-key, caption)
 * @property {string} [lang] @property {string} [dir]   the study language's lang and dir (core/lang.js)
 * @property {AbortSignal} [signal]
 */
/** @typedef {import('./index.js').UiCreated<AnswerDiffOpts> & { diff: AnswerDiff, finish: () => void, locus: (attempt: string) => Promise<void> }} AnswerDiffHandle */

/** @typedef {Node | string | null | undefined | false} Kid1 */
/** @typedef {Kid1 | Kid1[]} Kid */
/**
 * A small element builder (core/dom.js h() is not on the strict list yet): class as a list, attributes, children.
 * @param {string} tag @param {{ class?: (string | false | null | undefined)[] | string, [k: string]: unknown } | null} attrs @param {...Kid} kids
 * @returns {HTMLElement}
 */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = (Array.isArray(v) ? v : [v]).filter(Boolean).join(' ');
    else e.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(/** @type {Node | string} */ (c));
  return e;
}

const START = 120, STAGGER = 28, MAX_STAGGER = 8, NUDGE_AT = 200;

/** The diff for these options. @param {AnswerDiffOpts} o @returns {AnswerDiff} */
function diffOf(o) {
  const typed = o.typed || '', rightText = o.right || '';
  if (o.kind === 'right-slip') {
    const segs = slipSegs(typed, o.slips || []);
    return { typed: segs, right: [], mode: segs.some(s => s.k !== 'eq') ? 'letters' : 'words', stats: { near: 0, missing: 0, extra: 0, words: 0 } };
  }
  if (o.kind === 'partial') return rangeDiff(typed, rightText, o.ranges?.typed || [], o.ranges?.right || []);
  if (o.marked) {   // a situation: the phrase's words marked in the answer, his sentence plain
    const want = new Set(o.marked);
    const right = markedLine(rightText, want);
    return { typed: typed ? [{ text: typed, k: 'eq' }] : [], right, mode: 'words', stats: { near: 0, missing: want.size, extra: 0, words: right.filter(x => x.word != null).length } };
  }
  const d = answerDiff(typed, rightText, { capMiss: o.capMiss });
  // a far miss on a gap card: both lines stay plain, but the word the card is about is marked
  if (d.mode === 'plain' && o.gap?.length) return { ...d, right: markedLine(d.right.map(x => x.text).join(''), new Set(o.gap)), mode: 'words' };
  return o.plainYou ? { ...d, typed: typed ? [{ text: typed, k: 'eq' }] : [] } : d;
}

/** The right line with the words at `want` (token indexes) as whole-word `miss`, the rest plain. @param {string} r @param {Set<number>} want @returns {Seg[]} */
function markedLine(r, want) {
  /** @type {Seg[]} */ const right = [];
  let p = 0;
  activePack().text.tokenize(r).forEach((tok, word) => {
    if (tok.start > p) right.push({ text: r.slice(p, tok.start), k: 'eq' });
    right.push({ text: tok.raw, k: want.has(word) ? 'miss' : 'eq', w: want.has(word), word });
    p = tok.end;
  });
  if (p < r.length) right.push({ text: r.slice(p), k: 'eq' });
  return right;
}

/**
 * A line's segments as nodes: each run of non-space text is one word span (data-w: the word's index), marks inside it.
 * @param {Seg[]} segs @returns {Node[]}
 */
function render(segs) {
  /** @type {Node[]} */ const out = [];
  /** @type {HTMLElement | null} */ let word = null;
  const close = () => { word = null; };
  const into = () => {
    if (!word) { word = h('span', { class: 'ui-ad-w' }); out.push(word); }
    return word;
  };
  for (const s of segs) {
    if (s.k === 'eq') {
      for (const part of s.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { close(); out.push(document.createTextNode(part)); continue; }
        const w = into();
        if (s.word != null && !w.dataset.w) w.dataset.w = String(s.word);
        w.append(part);
      }
      continue;
    }
    const w = into();
    if (s.word != null && !w.dataset.w) w.dataset.w = String(s.word);
    w.classList.add('is-marked');
    w.append(h('span', { class: ['ui-ad-m', `is-${s.k}`, s.w && 'is-word'] }, s.text));
  }
  return out;
}

/** The text a screen reader hears for a line: ghosts (letters he did not type) left out. @param {Seg[]} segs */
const spoken = segs => segs.filter(s => s.k !== 'ghost').map(s => s.text).join('').replace(/\s+/g, ' ').trim();

/**
 * Feedback lines for one answer. Builds its own root; the caller puts handle.el under its verdict.
 * @param {AnswerDiffOpts} opts @returns {AnswerDiffHandle}
 */
export function createAnswerDiff(opts) {
  /** @type {AnswerDiffOpts} */ let o = { ...opts };
  const el = h('div', { class: 'ui-ad' });
  /** @type {ReturnType<typeof sequence> | null} */ let seq = null;
  let dead = false;
  /** @type {AnswerDiff} */ let diff = diffOf(o);

  const onAbort = () => destroy();
  o.signal?.addEventListener('abort', onAbort, { once: true });

  function build() {
    seq?.cancel();
    diff = diffOf(o);
    const c = o.classes || {};
    const lang = o.lang, dir = o.dir;
    const right = o.kind === 'right-slip';
    el.className = ['ui-ad', `is-${o.kind}`, c.root].filter(Boolean).join(' ');
    el.dataset.mode = diff.mode;
    /** @param {string | undefined} label @param {Seg[]} segs @param {string | undefined} cls @param {string} part */
    const lineEl = (label, segs, cls, part) => h('p', { class: ['ui-ad-line', part, cls], lang, dir, 'aria-hidden': 'true' },
      label ? [h('span', { class: ['ui-ad-label', c.label] }, label), ' '] : null, render(segs));
    /** @type {HTMLElement[]} */ const kids = [];
    if (right) kids.push(lineEl(o.labels.right, diff.typed, c.you, 'ui-ad-you'));
    else {
      if (o.typed && diff.typed.length) kids.push(lineEl(o.labels.you, diff.typed, c.you, 'ui-ad-you'));
      kids.push(lineEl(o.labels.right, diff.right, c.right, 'ui-ad-right'));
    }
    const cap = typeof o.labels.caption === 'function' ? o.labels.caption(diff) : o.labels.caption;
    if (cap) kids.push(h('p', { class: ['ui-ad-caption', c.caption] }, cap));
    // one sentence form for a screen reader: labels with the text as written, without the drawn marks
    const say = right
      ? [o.labels.right, spoken(diff.typed.filter(s => s.k !== 'extra'))]
      : [o.typed && diff.typed.length ? `${o.labels.you || ''} ${spoken(diff.typed)}.` : '', o.labels.right, spoken(diff.right), cap || ''];
    kids.push(h('p', { class: 'sr-only' }, say.filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\.\.$/, '.').trim()));
    el.replaceChildren(...kids);
    draw();
  }

  // the marks draw in reading order; a near miss nudges its first wrong word
  function draw() {
    const marks = /** @type {HTMLElement[]} */ ([...el.querySelectorAll('.ui-ad-m')]);
    el.classList.remove('is-pending', 'is-instant');
    if (!marks.length || reduced()) return;
    el.classList.add('is-pending');
    /** @type {import('../core/motion.js').SeqStep[]} */ const steps = [];
    let n = 0;
    for (const m of marks) {
      const at = START + Math.min(n, MAX_STAGGER) * STAGGER;
      if (!m.classList.contains('is-ghost')) n++;
      steps.push({ at, run: instant => { if (instant) el.classList.add('is-instant'); m.classList.add('is-on'); } });
    }
    const first = /** @type {HTMLElement | null} */ (el.querySelector('.ui-ad-you .ui-ad-m.is-wrong, .ui-ad-you .ui-ad-m.is-extra, .ui-ad-you .ui-ad-m.is-ghost'));
    if ((o.kind === 'wrong' || o.kind === 'study') && diff.mode === 'letters' && first) {
      const w = /** @type {HTMLElement} */ (first.closest('.ui-ad-w'));
      w.classList.add('is-nudge');
      steps.push({ at: NUDGE_AT, run: instant => { if (!instant) void nudge(w); } });
    }
    seq = sequence(steps, { signal: o.signal });
  }

  /** Every mark at its end state now (Enter during the reveal, a new card). */
  function finish() { seq?.finish(); }

  /**
   * The retype locus (design A7): the first word of the right line his attempt does not have pulses once ('locus').
   * Resolves when the pulse is over; at once when every word is there.
   * @param {string} attempt
   */
  function locus(attempt) {
    const j = firstDiffWord(attempt, o.kind === 'right-slip' ? spoken(diff.typed) : o.right || '');
    const line = el.querySelector(o.kind === 'right-slip' ? '.ui-ad-you' : '.ui-ad-right');
    const w = j < 0 ? null : /** @type {HTMLElement | null} */ (line?.querySelector(`.ui-ad-w[data-w="${j}"]`) || null);
    return w ? pulse(w, 'locus', { signal: o.signal }) : Promise.resolve();
  }

  /** @param {Partial<AnswerDiffOpts>} next */
  function update(next) {
    if (dead) return;
    const keys = /** @type {(keyof AnswerDiffOpts)[]} */ (Object.keys(next));
    if (!keys.some(k => next[k] !== o[k])) return;
    if (next.signal && next.signal !== o.signal) { o.signal?.removeEventListener('abort', onAbort); next.signal.addEventListener('abort', onAbort, { once: true }); }
    o = { ...o, ...next };
    build();
  }

  function destroy() {
    if (dead) return;
    dead = true;
    seq?.cancel();
    seq = null;
    o.signal?.removeEventListener('abort', onAbort);
    el.classList.remove('is-pending');   // whatever was not drawn yet shows
  }

  build();
  return { el, update, destroy, finish, locus, get diff() { return diff; } };
}
