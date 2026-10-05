/* Script mode: what to do next in a script, and its row on Today (SCRIPT-UX §3.6, §6). Pure; tested in node.

   Next step, in this order: (1) a section whose words are not marked yet → Mark words; (2) before any section has
   been listened to, Listen to the first one (a word is learnt best in the sentence, so words come after Listen);
   (3) word cards due → Words; (4) a section at Cue whose rehearsal is due → Cue; (5) the earliest section not at Cue
   whose step is offered today → that step; (6) every section at Cue → Full run. In the last 3 days before delivery the
   full run comes first.

   Exam first: while a B1 exam date is ahead (phases week, lastNew, eve, day) a script adds no Today row, unless it
   is to be delivered on or before the exam. After the exam a script's row takes at most 25 % of the daily minutes
   (MINUTES_SHARE), more only when the delivery date needs it (remaining step minutes ÷ days left), up to 50 %.
   The share is one pool for all scripts together, split between their rows in order (audit P1-7).
   Priority 45; 22 in the last 7 days; on the eve "Full run and Listen"; on the day a 2-minute warm-up (Listen to
   the first section). New words: at most 8 a day per script, none in the last 3 days before delivery, none when the
   clock allows no new items (the B1 eve and exam day), and never more than the B1 day's new items left; they count as
   new items shown today in the B1 budget (newShownToday), so the combined new load never grows (audit P1-6). */
import * as D8 from '../days.js';
import * as RD from '../b1ready.js';
import * as FS from '../fsrs.js';
import { roundMinutes } from '../today.js';
import { phase as clockPhase } from '../days.js';
import { MINUTES_SHARE, MINUTES_SHARE_MAX, NEW_WORDS_PER_DAY, NO_NEW_DAYS, WPM, KNOWN_R } from './config.js';
import { blank, srId, stepsFor } from './ladder.js';
import { wordCount } from './parse.js';

const EXAM_AHEAD = new Set(['week', 'lastNew', 'eve', 'day']);

/**
 * The script's own phase from its delivery date: 'none' (no date), 'build' (8 or more days), 'polish' (7 to 2),
 * 'eve', 'day', 'after'.
 * @param {string} today @param {string | null} deliverOn
 */
export function scriptPhase(today, deliverOn) {
  if (!deliverOn) return 'none';
  const d = D8.diff(today, deliverOn);
  return d >= 8 ? 'build' : d >= 2 ? 'polish' : d === 1 ? 'eve' : d === 0 ? 'day' : 'after';
}

/** The scheduler context for a script's cards: the delivery date plays the exam date. @param {{deliverOn: string | null}} script @param {string} today */
export const fsCtx = (script, today) => ({ today, exam: script.deliverOn || null, phase: clockPhase(today, script.deliverOn || null) });

/** Card ids of the marked words, one per lemma. @param {any} script @returns {string[]} */
export function wordIds(script) {
  // a word waits for its meaning, and a guessed dictionary form waits for his check, before it becomes a card
  return [...new Set((script.marks || []).filter((/** @type {any} */ m) => m && m.cardId && m.gloss && !m.guess).map((/** @type {any} */ m) => m.cardId))];
}

/**
 * Word cards due and not seen yet. b1-deck cards (list words he already had) follow the exam cap; script cards the
 * delivery cap.
 * @param {any} script @param {(id: string) => {rec: any, deck: string} | null} cardOf @param {any} c clock ctx
 */
export function words(script, cardOf, c) {
  const cap = fsCtx(script, c.today);
  /** @type {string[]} */ const due = [], fresh = [], known = [];
  for (const id of wordIds(script)) {
    const x = cardOf(id);
    if (!x || !x.rec || !x.rec.reps) { fresh.push(id); continue; }
    if (RD.isDue(x.rec, c.today, x.deck === 'b1' ? c : cap)) due.push(id);
    if (!x.rec.relearn && x.rec.learn == null && FS.Ron(x.rec, c.today) >= KNOWN_R) known.push(id);
  }
  return { due, fresh, known, total: wordIds(script).length };
}

/**
 * A script's words by what a round would do with them (domain/roundsize.js Buckets), for the round size picker.
 * newLeft: newAllowed() for the script today (it shares the B1 day's new items).
 * @param {any} script @param {(id: string) => {rec: any, deck: string} | null} cardOf @param {any} c @param {number} newLeft
 * @returns {import('../roundsize.js').Buckets}
 */
export function wordBuckets(script, cardOf, c, newLeft) {
  const w = words(script, cardOf, c);
  const due = new Set(w.due);
  const R = (/** @type {string} */ id) => FS.Ron(cardOf(id)?.rec, c.today);
  const rest = wordIds(script).filter(id => cardOf(id)?.rec?.reps && !due.has(id)).sort((a, b) => R(a) - R(b));
  return { due: [...w.due].sort((a, b) => String(cardOf(a)?.rec?.due).localeCompare(String(cardOf(b)?.rec?.due))), fresh: w.fresh, rest, newLeft, daily: true };
}

/**
 * How many new words this script may introduce today.
 * @param {any} script @param {any} prog kv 'scripts.progress'[id] @param {string} today
 * @param {{newItems?: boolean, dayLeft?: number}} [o] newItems: the clock allows new items today (false on the B1
 *   exam's eve and day); dayLeft: the B1 day's new items left (todayBudget().newLeft), which script words share
 */
export function newAllowed(script, prog, today, { newItems = true, dayLeft = Infinity } = {}) {
  if (!newItems) return 0;
  if (script.deliverOn) { const left = D8.diff(today, script.deliverOn); if (left >= 0 && left < NO_NEW_DAYS) return 0; }
  const shown = prog?.newBy?.[today] || 0;
  return Math.max(0, Math.min(NEW_WORDS_PER_DAY - shown, dayLeft));
}

/** New script words introduced today across all scripts (for the B1 day budget). @param {Record<string, any>} progressAll @param {string} today */
export const newShownToday = (progressAll, today) => Object.values(progressAll || {}).reduce((n, p) => n + ((p && p.newBy && p.newBy[today]) || 0), 0);

/** Minutes for one ladder step of a section (Listen at 40 words a minute, the others at 60). @param {any} section @param {string} step */
export function stepMinutes(section, step) {
  const w = section.sentences.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + wordCount(s.de), 0);
  return Math.max(1, Math.round(w / (step === 'listen' ? 40 : 60)));
}
/** Minutes to say the whole script (the full-run target). @param {any} script */
export const runMinutes = script => script.targetMin || Math.max(1, Math.round(script.sections.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.sentences.reduce((/** @type {number} */ m, /** @type {any} */ x) => m + wordCount(x.de), 0), 0) / WPM));

/**
 * @typedef {object} Next
 * @property {'mark' | 'words' | 'cue' | 'step' | 'run' | 'rest'} kind
 * @property {any} [section]
 * @property {string} [step]
 * @property {number} minutes
 * @property {number} [n]   words due (kind words)
 */

/**
 * The next step of a script.
 * @param {any} script @param {any} prog @param {(id: string) => {rec: any, deck: string} | null} cardOf @param {any} c
 * @returns {Next}
 */
export function nextStep(script, prog, cardOf, c) {
  const today = c.today;
  const secs = script.sections;
  const P = (/** @type {any} */ s) => blank(prog?.sections?.[s.id]);
  const ph = scriptPhase(today, script.deliverOn);
  const allCue = secs.length > 0 && secs.every((/** @type {any} */ s) => P(s).step === 'cue' && P(s).done.cue);
  const run = /** @type {Next} */ ({ kind: 'run', minutes: runMinutes(script) });
  const ranToday = (prog?.runs || []).some((/** @type {any} */ r) => r.day === today);
  if ((ph === 'polish' || ph === 'eve') && script.deliverOn && D8.diff(today, script.deliverOn) <= 3 && allCue && !ranToday) return run;
  const unmarked = secs.find((/** @type {any} */ s) => !P(s).marked);
  if (unmarked) return { kind: 'mark', section: unmarked, minutes: 2 };
  const first = secs[0];
  if (first && !secs.some((/** @type {any} */ s) => P(s).done.listen) && P(first).step === 'listen') return { kind: 'step', section: first, step: 'listen', minutes: stepMinutes(first, 'listen') };
  const w = words(script, cardOf, c);
  const fresh = Math.min(w.fresh.length, newAllowed(script, prog, today, { newItems: c.newItems !== false, dayLeft: c.dayNewLeft ?? Infinity }));
  if (w.due.length + fresh > 0) return { kind: 'words', n: w.due.length + fresh, minutes: roundMinutes(w.due.length + fresh) };
  const cap = fsCtx(script, today);
  const cueDue = secs.find((/** @type {any} */ s) => { const p = P(s); const x = cardOf(srId(script.id, s.id)); return p.step === 'cue' && x?.rec?.reps && RD.isDue(x.rec, today, cap); });
  if (cueDue) return { kind: 'cue', section: cueDue, step: 'cue', minutes: stepMinutes(cueDue, 'cue') };
  const ladder = secs.find((/** @type {any} */ s) => { const p = P(s); return !(p.step === 'cue' && p.done.cue) && (!p.at || p.at <= today); });
  if (ladder) return { kind: 'step', section: ladder, step: P(ladder).step, minutes: stepMinutes(ladder, P(ladder).step) };
  if (allCue && !ranToday && (ph === 'polish' || ph === 'eve' || ph === 'day' || ph === 'none' || ph === 'build')) return run;
  return { kind: 'rest', minutes: 0 };
}

/**
 * Step minutes left until every section is at Cue (for the deadline share).
 * @param {any} script @param {any} prog
 */
export function minutesLeft(script, prog) {
  let m = 0;
  for (const s of script.sections) {
    const p = blank(prog?.sections?.[s.id]);
    const steps = stepsFor(s);
    const i = steps.indexOf(p.step);
    for (const st of steps.slice(Math.max(0, i))) if (!(st === 'cue' && p.done.cue)) m += stepMinutes(s, st);
  }
  return m;
}

/**
 * Today's rows for the scripts (one per active script with something to do).
 * @param {object} o
 * @param {any[]} o.scripts                 active, not deleted
 * @param {Record<string, any>} o.progress  kv 'scripts.progress'
 * @param {(id: string) => {rec: any, deck: string} | null} o.cardOf
 * @param {any} o.c                         clock ctx (the B1 exam)
 * @param {any} o.settings
 * @param {(k: string, v?: any) => string} o.t
 * @returns {import('../today.js').PlanItem[]}
 */
export function planRows({ scripts, progress, cardOf, c, settings, t }) {
  /** @type {import('../today.js').PlanItem[]} */ const out = [];
  const daily = settings?.minutesPerDay || 60;
  // one pool for all scripts: 25 % of the day, more (up to 50 %) only as far as the nearest deadlines need it
  let need = 0;
  for (const s of scripts) {
    if (!s || s.deletedAt || s.status !== 'active' || !s.deliverOn) continue;
    const left = Math.max(1, D8.diff(c.today, s.deliverOn));
    if (D8.diff(c.today, s.deliverOn) >= 0) need += minutesLeft(s, progress?.[s.id]) / left;
  }
  let pool = Math.max(1, Math.round(daily * Math.min(MINUTES_SHARE_MAX, Math.max(MINUTES_SHARE, need / daily))));
  for (const s of scripts) {
    if (!s || s.deletedAt || s.status !== 'active') continue;
    const examAhead = c.exam && EXAM_AHEAD.has(c.phase);
    if (examAhead && !(s.deliverOn && s.deliverOn <= c.exam)) continue;
    const prog = progress?.[s.id];
    const ph = scriptPhase(c.today, s.deliverOn);
    if (ph === 'after') continue;
    const href = `#/practice/scripts/${s.id}`;
    if (ph === 'day') {
      out.push({ id: `script.${s.id}`, source: 'practice', kind: 'warmup', title: s.title, detail: t('practice.script.plan.warmup', { section: s.sections[0]?.title || '' }),
        minutes: 2, href: `${href}/rehearse/${s.sections[0]?.id}?step=listen`, priority: 10, action: t('practice.script.plan.warmupAction') });
      continue;
    }
    const nx = nextStep(s, prog, cardOf, c);
    // the script deck's due words are reviews (domain/budget.js): the step row carries them when its step is the
    // words, else a row of their own says so, so they are never left uncounted (not even when the share is spent)
    const wDue = words(s, cardOf, c).due.filter(id => cardOf(id)?.deck === 'script').length;
    let carried = false;
    const left = s.deliverOn ? Math.max(1, D8.diff(c.today, s.deliverOn)) : null;
    const near = left != null && left <= 7;
    if (nx.kind !== 'rest' && pool > 0) {
      let minutes = nx.minutes;
      if (ph === 'eve') minutes = runMinutes(s) + stepMinutes(s.sections[0], 'listen');
      minutes = Math.max(1, Math.min(minutes, pool));
      pool -= minutes;
      const detail = ph === 'eve' ? t('practice.script.plan.eve') : detailOf(nx, t);
      carried = nx.kind === 'words' && ph !== 'eve';
      out.push({ id: `script.${s.id}`, source: 'practice', kind: 'speak', title: s.title, detail, minutes, href: hrefOf(s, nx), priority: near ? 22 : 45,
        ...(carried && wDue ? { reviews: wDue } : {}),
        introducesNew: nx.kind === 'words' && words(s, cardOf, c).due.length === 0, action: t('practice.script.plan.action', { title: s.title, min: minutes }) });
    }
    if (wDue && !carried) {
      const wn = Math.min(12, wDue);
      out.push({ id: `script.${s.id}.words`, source: 'practice', kind: 'review', title: s.title, detail: t('practice.script.next.words', { n: wDue, min: roundMinutes(wn) }),
        minutes: roundMinutes(wn), href: `#/practice/round?kind=script:${s.id}`, priority: near ? 22 : 46, noCut: true, reviews: wDue,
        action: t('practice.script.plan.action', { title: s.title, min: roundMinutes(wn) }) });
    }
  }
  return out;
}

/** @param {Next} nx @param {(k: string, v?: any) => string} t */
export function detailOf(nx, t) {
  if (nx.kind === 'mark') return t('practice.script.next.mark', { section: nx.section.title });
  if (nx.kind === 'words') return t('practice.script.next.words', { n: nx.n, min: nx.minutes });
  if (nx.kind === 'cue') return t('practice.script.next.cue', { section: nx.section.title });
  if (nx.kind === 'step') return t('practice.script.next.step', { step: t(`practice.script.step.${nx.step}`), section: nx.section.title, min: nx.minutes });
  if (nx.kind === 'run') return t('practice.script.next.run', { min: nx.minutes });
  return t('practice.script.next.rest');
}

/** @param {any} s @param {Next} nx */
export function hrefOf(s, nx) {
  const base = `#/practice/scripts/${s.id}`;
  if (nx.kind === 'mark') return `${base}/mark/${nx.section.id}`;
  if (nx.kind === 'words') return `#/practice/round?kind=script:${s.id}`;
  if (nx.kind === 'cue' || nx.kind === 'step') return `${base}/rehearse/${nx.section.id}?step=${nx.step}`;
  if (nx.kind === 'run') return `${base}/run`;
  return base;
}
