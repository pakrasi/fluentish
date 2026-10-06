/* Quick sort's session: the words, the choices made, and Undo, apart from the screen (sort.js draws it). Pure over its
   deps; tested in node with the real grader and the real writers (tests/unit/checks.test.mjs).

   Two modes (domain/checks.js):
     recognise   he sees the German and picks Know (marked known, data/known.js) or Learn (recorded as a Learn pick,
                 which puts the word on the Recheck list; the card is not touched)
     produce     he sees the English meaning and types the German; the grader (grade.js) decides:
                   right first time  → marked known, and the check recorded
                   wrong             → the answer shows, the word goes to Learn (a Learn pick, the card not touched),
                                       and "I knew it, typo" turns that into a mark
                   skip              → nothing is written
   Recheck (recheck: true) runs Produce over the words he sorted to Learn before: right marks the word known; wrong
   records the check and leaves the word exactly as it was (still on the list).
   Undo takes back the last choice whatever it was: the mark (data/known.js unmarkCards) and the check entries
   (data/checks.js undoChecks). */

/** @typedef {import('../../domain/checks.js').Mode} Mode */
/** @typedef {'know' | 'learn' | 'skip' | 'stay'} Choice  stay: a wrong answer in Recheck (nothing changed) */
/** @typedef {{id: string, choice: Choice, res: any, tokens: any[], typed?: boolean, typo?: boolean}} Pick */
/**
 * @typedef {object} Deps
 * @property {(id: string) => {n: number, entries: any[]}} mark       mark a word known (data/known.js markWords)
 * @property {(res: any) => number} unmark                             undo a mark (data/known.js unmarkCards)
 * @property {(x: {itemId: string, mode: Mode, ok: boolean, from: import('../../domain/checks.js').From, learn?: boolean, typed?: boolean, typo?: boolean}) => any} check
 *                                                                     record a check (data/checks.js recordCheck)
 * @property {(tokens: any[]) => void} uncheck                         take checks back (data/checks.js undoChecks)
 * @property {(id: string, typed: string) => {ok: boolean, right: string}} grade   the grader's verdict on a typed answer
 */

/**
 * @param {{list: string[], mode: Mode, recheck?: boolean, deps: Deps}} o  list: word ids (no W:)
 */
export function sortSession({ list, mode, recheck = false, deps }) {
  /** @type {Pick[]} */ const picks = [];
  let i = 0;
  /** @type {'answer' | 'feedback'} */ let phase = 'answer';
  /** @type {{ok: boolean, right: string} | null} */ let verdict = null;
  let m = recheck ? 'produce' : mode;
  const from = recheck ? 'recheck' : 'sort';
  const item = (/** @type {string} */ id) => `W:${id}`;
  const done = () => i >= list.length;

  function push(/** @type {Pick} */ p) { picks.push(p); }
  function advance() { phase = 'answer'; verdict = null; i++; }

  return {
    get i() { return i; },
    get id() { return list[i]; },
    get mode() { return m; },
    get phase() { return phase; },
    get verdict() { return verdict; },
    get picks() { return picks; },
    get done() { return done(); },
    get recheck() { return recheck; },
    list,
    /** Switch the mode (Recheck stays Produce); only between words. @param {Mode} next */
    setMode(next) { if (!recheck && phase === 'answer') m = next; return m; },
    /** Recognise: Know. */
    know() {
      if (done() || phase !== 'answer' || m !== 'recognise') return null;
      const id = list[i];
      push({ id, choice: 'know', res: deps.mark(id), tokens: [] });
      advance();
      return 'know';
    },
    /** Learn: Recognise's Learn, or in Produce "I don't know it" without typing. Recheck: the word stays. */
    learn() {
      if (done() || phase !== 'answer') return null;
      const id = list[i];
      if (recheck) { push({ id, choice: 'stay', res: null, tokens: [] }); advance(); return 'stay'; }
      push({ id, choice: 'learn', res: null, tokens: [deps.check({ itemId: item(id), mode: m, ok: false, from, learn: true })] });
      advance();
      return 'learn';
    },
    /** Produce: check a typed answer. Returns the verdict, or null when there is nothing to check. @param {string} typed */
    submit(typed) {
      if (done() || phase !== 'answer' || m !== 'produce' || !String(typed || '').trim()) return null;
      const id = list[i];
      const v = deps.grade(id, String(typed));
      verdict = { ok: !!v.ok, right: v.right };
      phase = 'feedback';
      if (v.ok) push({ id, choice: 'know', typed: true, res: deps.mark(id), tokens: [deps.check({ itemId: item(id), mode: 'produce', ok: true, from, typed: true })] });
      else if (recheck) push({ id, choice: 'stay', typed: true, res: null, tokens: [deps.check({ itemId: item(id), mode: 'produce', ok: false, from, typed: true })] });
      else push({ id, choice: 'learn', typed: true, res: null, tokens: [deps.check({ itemId: item(id), mode: 'produce', ok: false, from, typed: true, learn: true })] });
      return verdict;
    },
    /** "I knew it, typo": after a wrong answer, mark the word known after all. */
    typo() {
      const p = picks[picks.length - 1];
      if (phase !== 'feedback' || !verdict || verdict.ok || !p || p.id !== list[i] || p.choice === 'know') return false;
      p.res = deps.mark(p.id);
      p.tokens.push(deps.check({ itemId: item(p.id), mode: 'produce', ok: true, from, typed: true, typo: true }));
      p.choice = 'know'; p.typo = true;
      verdict = { ...verdict, ok: true };
      return true;
    },
    /** Skip: nothing is written. */
    skip() {
      if (done() || phase !== 'answer') return false;
      push({ id: list[i], choice: 'skip', res: null, tokens: [] });
      advance();
      return true;
    },
    /** After the feedback: the next word. */
    next() { if (phase === 'feedback') advance(); return !done(); },
    /** Take back the last choice. Returns its pick, or null. */
    undo() {
      const p = picks.pop();
      if (!p) return null;
      if (p.res) deps.unmark(p.res);
      if (p.tokens.length) deps.uncheck(p.tokens);
      i = list.indexOf(p.id);
      phase = 'answer'; verdict = null;
      return p;
    },
    /** Counts for the stacks and the summary. */
    counts() {
      const n = (/** @type {Choice} */ c) => picks.filter(p => p.choice === c).length;
      return { know: n('know'), learn: n('learn'), skip: n('skip'), stay: n('stay'), left: list.length - picks.length, typed: picks.filter(p => p.typed).length };
    },
  };
}
