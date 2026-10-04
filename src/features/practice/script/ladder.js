/* Script mode: the rehearsal ladder of a section and what "ready" means. Pure; tested in node.

   Ladder (SCRIPT-UX §3.7, his own method): Listen → Parts → Letters → Gaps → Cue for a Talk section (said word for
   word); Listen → Cue for a Retell section (said in his own words). Steps before Cue are not scheduled cards: a Good
   or Easy grade unlocks the next step for the next study day (Easy skips one), Again or Hard repeats the step the next
   day. At Cue the section is a scheduled item, SR:<script>.<section>, graded by self-report; Again there sends the
   section back to Gaps (Listen for Retell). The step chips are free to switch; only a grade moves the ladder.

   Ready (§6): the words of every section that is at Cue and whose SR card has an expected recall of 90 % or more on the
   delivery day (today without a date), divided by all words of the script. A section counts fully or not at all.

   Section progress (kv 'scripts.progress'[script].sections[section]):
     { step: 'listen' | 'parts' | 'letters' | 'gaps' | 'cue',   the step to do next
       at: day | null,                                           the first day that step is offered
       done: { [step]: day },                                    the last day each step was done
       marked: day | null,                                       words marked (Mark finished for this section)
       peeks: number, grades: { [step]: 1..4 } }                 the last peek count and grade per step */
import * as FS from '../../../domain/fsrs.js';
import * as D8 from '../../../domain/days.js';
import { PARTS_STEP, KNOWN_R } from './config.js';
import { wordCount } from './parse.js';

/** @typedef {'listen' | 'parts' | 'letters' | 'gaps' | 'cue'} Step */

/** @type {Step[]} */ export const TALK = PARTS_STEP ? ['listen', 'parts', 'letters', 'gaps', 'cue'] : ['listen', 'letters', 'gaps', 'cue'];
/** @type {Step[]} */ export const RETELL = ['listen', 'cue'];

/** @param {{kind?: string}} section @returns {Step[]} */
export const stepsFor = section => (section.kind === 'retell' ? RETELL : TALK);

/** @param {any} p */
export const blank = (p = null) => ({ step: /** @type {Step} */ ('listen'), at: null, done: {}, marked: null, peeks: 0, grades: {}, ...(p || {}) });

/** The SR card id of a section. @param {string} scriptId @param {string} sectionId */
export const srId = (scriptId, sectionId) => `SR:${scriptId}.${sectionId}`;

/**
 * Listen was played to the end.
 * @param {any} p section progress @param {any} section @param {string} today
 */
export function listened(p, section, today) {
  const q = blank(structuredClone(p));
  q.done.listen = today;
  if (q.step === 'listen') { q.step = stepsFor(section)[1]; q.at = D8.add(today, 1); }
  return q;
}

/**
 * A self-grade for a step (2..cue). Returns the new progress.
 * @param {any} p @param {any} section @param {Step} step @param {1|2|3|4} g @param {string} today @param {number} [peeks]
 */
export function graded(p, section, step, g, today, peeks = 0) {
  const steps = stepsFor(section);
  const q = blank(structuredClone(p));
  q.done[step] = today; q.grades[step] = g; q.peeks = peeks;
  const at = steps.indexOf(step), cur = steps.indexOf(q.step), cue = steps.indexOf('cue');
  if (at < 0) return q;
  if (step === 'cue') {
    if (g === 1) { q.step = section.kind === 'retell' ? 'listen' : 'gaps'; q.at = D8.add(today, 1); }
    else { q.step = 'cue'; q.at = null; }
    return q;
  }
  if (at < cur) return q;                                   // an earlier step, by choice: nothing moves
  if (g >= 3) { q.step = steps[Math.min(cue, at + (g === 4 ? 2 : 1))]; q.at = D8.add(today, 1); }
  else if (at === cur) q.at = D8.add(today, 1);             // repeat it the next day
  return q;
}

/**
 * The section's kind changed (Talk ↔ Retell): keep what was reached.
 * @param {any} p @param {'talk' | 'retell'} kind
 */
export function rekind(p, kind) {
  const q = blank(structuredClone(p));
  if (kind === 'retell' && q.step !== 'listen') q.step = 'cue';
  if (kind === 'talk' && q.step === 'cue' && !q.done.gaps && !q.done.cue) q.step = TALK[1];
  return q;
}

/** The text of a section changed: it goes back to Gaps (Listen for Retell) if it was further. @param {any} p @param {any} section */
export function textChanged(p, section) {
  const q = blank(structuredClone(p));
  const steps = stepsFor(section), back = section.kind === 'retell' ? 'listen' : 'gaps';
  if (steps.indexOf(q.step) > steps.indexOf(back)) { q.step = back; q.at = null; }
  return q;
}

/** Index of the current step, and how many steps the section has (for the 4/5 segments). @param {any} p @param {any} section */
export function position(p, section) {
  const steps = stepsFor(section), q = blank(p);
  const cueDone = !!q.done.cue && q.step === 'cue';
  return { steps, index: steps.indexOf(q.step), done: cueDone ? steps.length : Math.max(0, steps.indexOf(q.step)) };
}

/** The day expected recall is measured on: the delivery day while it is ahead, else today. @param {string | null} deliverOn @param {string} today */
export const recallDay = (deliverOn, today) => (deliverOn && deliverOn >= today ? deliverOn : today);

/**
 * @param {any} rec an SR card @param {string} day
 */
export const recallOn = (rec, day) => (rec && rec.reps ? FS.Ron(rec, day) : 0);

/**
 * Ready and the script field (§5.2): per section, its state; per sentence, a cell sized by its words.
 * @param {any} script @param {any} progress kv 'scripts.progress'[script.id] @param {(id: string) => any} card SR card lookup
 * @param {string} today
 */
export function readiness(script, progress, card, today) {
  const day = recallDay(script.deliverOn, today);
  let total = 0, ready = 0;
  const rows = script.sections.map((/** @type {any} */ s) => {
    const p = blank(progress?.sections?.[s.id]);
    const words = s.sentences.reduce((/** @type {number} */ n, /** @type {any} */ x) => n + wordCount(x.de), 0);
    const rec = card(srId(script.id, s.id));
    const atCue = p.step === 'cue' && !!p.done.cue && !!rec?.reps;
    const r = atCue ? recallOn(rec, day) : 0;
    const isReady = atCue && !rec.relearn && r >= KNOWN_R;
    const started = !!(p.done.listen || p.done.parts || p.done.letters || p.done.gaps || p.done.cue);
    /** @type {'empty' | 'learning' | 'known' | 'today'} */
    const state = isReady ? (rec.last === today ? 'today' : 'known') : started ? 'learning' : 'empty';
    total += words; if (isReady) ready += words;
    return { id: s.id, title: s.title, words, state, ready: isReady, recall: r, cells: s.sentences.map((/** @type {any} */ x) => wordCount(x.de)) };
  });
  return { pct: total ? Math.floor((100 * ready) / total) : 0, ready, total, day, rows };
}

/**
 * Self-grade on an SR card (§6): FSRS without the in-session learning steps (a rehearsed section is never due again
 * the same day). Again: due tomorrow. Delivery day = the exam date for this card (due dates capped at delivery−1).
 * @param {any} rec0 @param {1|2|3|4} g
 * @param {{today: string, exam: string | null, phase: string, forecast?: (d: string) => number}} ctx
 * @param {number} [now]
 */
export function rate(rec0, g, ctx, now = Date.now()) {
  const t = ctx.today;
  const entry = [t, g, 0, 's', ''];
  if (ctx.phase === 'day') {
    const rec = rec0 ? { ...rec0, hist: [...(rec0.hist || []), [t, g, 0, 's', 'l']].slice(-12), u: now } : null;
    return { rec, wrote: false };
  }
  let rec;
  if (!rec0 || !rec0.reps) {
    rec = { ...FS.init(g), reps: 1, lapses: 0, last: t, first: t, stage: 0, streak: 0, learn: null, relearn: false, due: t, hist: [] };
  } else if (rec0.last === t) {
    rec = { ...rec0, hist: [...(rec0.hist || []), [t, g, 0, 's', 'l']].slice(-12), u: now };
    if (g === 1) rec.due = D8.add(t, 1);
    return { rec, wrote: false };
  } else {
    rec = { ...rec0 };
    const s = FS.next(rec, g, D8.diff(rec.last || t, t));
    rec.S = s.S; rec.D = s.D; rec.reps++; rec.last = t;
    if (g === 1) rec.lapses++;
  }
  rec.relearn = g === 1;
  rec.due = g === 1 ? D8.add(t, 1) : FS.dueFor(rec.S, ctx);
  rec.hist = [...(rec.hist || []), entry].slice(-12);
  rec.u = now;
  return { rec, wrote: true };
}

/** Peeks → the suggested grade (§3.7): 0 → Good, 1–3 → Hard, more → Again. He always taps. @param {number} peeks */
export const suggestGrade = peeks => (peeks === 0 ? 3 : peeks <= 3 ? 2 : 1);
