/* Script mode: rehearse a section (#/practice/scripts/<id>/rehearse/<section>?step=…, SCRIPT-UX §3.7). Full screen.

   One layout for every step; only the text treatment changes:
     Listen   the device's German voice reads sentence by sentence and pauses after each (1.2 × its length) for his
              own repetition; the current sentence is ink, the others quiet. No grade: it is exposure.
     Parts    one sentence at a time: its parts (his Bausteine, or the sentence cut at commas) with first letters,
              then the whole sentence as gaps. Say each part, then the whole sentence.
     Letters  every word reduced to its first letter, the rest a baseline at the word's own width.
     Gaps     only the first word of each sentence and the punctuation stay.
     Cue      the text is hidden; the cue is the English of the first sentence and the title (or the first words).
   A tap on a hidden word shows it for 2 s and counts as a peek. Switching Listen → Letters → Gaps, the letters fade
   out left to right across the section (motion moment 2); the words never move, because hidden letters keep their
   width. Every step but Listen ends with the one self-grade row (Again / Hard / Good / Easy, keys 1 to 4); the peek
   count suggests one. The step done is the shared done hero, inline, with the section's ready-meter row as its data.
   Screen readers: a hidden word is a "hidden word" button (one tab stop, arrows move, Enter peeks); its letters are out
   of the accessibility tree while the step hides them. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { reduced } from '../../core/motion.js';
import { label, add } from '../../core/clock.js';
import { diff as D8diff } from '../../domain/days.js';
import * as P from '../../domain/script/parse.js';
import * as St from '../../data/scripts.js';
import * as Lad from '../../domain/script/ladder.js';
import { fsCtx } from '../../domain/script/plan.js';
import { celebrate } from './moment.js';
import { say, hush, hasVoice, onVoices } from './voice.js';
import { fullScreen, checkMark, scriptField } from './ui.js';
import { addActivity } from '../shared/data.js';
import { gradeRow } from '../shared/selfgrade.js';
import { doneHero } from '../shared/done-hero.js';
import { variantBox } from './register.js';
import { langAttr, dirAttr } from '../../core/lang.js';

const SPEEDS = [0.8, 0.9, 1.0];

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} script @param {string} sectionId */
export function mountRehearse(el, ctx, script, sectionId) {
  const { t, store } = ctx;
  const section = script.sections.find((/** @type {any} */ s) => s.id === sectionId);
  if (!section) { ctx.go(`/practice/scripts/${script.id}`, { replace: true }); return; }
  const restore = fullScreen();
  const steps = Lad.stepsFor(section);
  const c = ctx.clock.ctx();
  const prog0 = Lad.blank(St.progress(store, script.id).sections?.[section.id]);
  /** @type {Lad.Step} */ let step = /** @type {any} */ (steps.includes(/** @type {any} */ (ctx.query.get('step'))) ? ctx.query.get('step') : prog0.step);
  let cur = 0, peeks = 0, playing = false, speed = 0.9, showEn = false, alive = true, reveal = 0;
  const played = new Set();
  /** @type {{cancel: () => void} | null} */ let speaking = null;
  let pauseTimer = 0;
  const t0 = performance.now();
  const base = section.sentences;
  /** The sentences shown: the section's own, or its other-register version while that is switched on. */
  let sents = base;
  const marked = new Set((script.marks || []).filter((/** @type {any} */ m) => m.sentenceId).map((/** @type {any} */ m) => `${m.sentenceId}:${m.start}`));

  // ---------- header: the step pills carry the ladder (a check before each step done; the step shown is ink) ----------
  const chips = h('div', { class: 'sc-steps', role: 'group', 'aria-label': t('practice.script.steps') }, steps.map(s =>
    h('button', { type: 'button', class: 'chip pressable sc-stepchip', name: `step:${s}`, 'aria-pressed': String(s === step), onclick: () => setStep(s) }, checkMark(), h('span', null, t(`practice.script.step.${s}`)))));
  /** @param {any} p @param {string | null} [justDone] a step that was just done: its check draws */
  const drawSegs = (p, justDone = null) => {
    const atCue = p.step === 'cue' && !!p.done.cue, i = steps.indexOf(p.step);
    chips.querySelectorAll('button').forEach((b, k) => {
      const done = atCue || k < i || !!p.done[steps[k]];
      b.classList.toggle('is-done', done);
      b.setAttribute('aria-label', done ? t('practice.script.stepDone', { step: t(`practice.script.step.${steps[k]}`) }) : t(`practice.script.step.${steps[k]}`));
      if (justDone === steps[k] && !reduced()) { b.classList.remove('is-drawn'); void b.offsetWidth; b.classList.add('is-drawn'); }
    });
  };
  const howEl = h('p', { class: 'caption sc-how' });
  /** One line of instruction per step until the step has been done once (UX P1-16). */
  const drawHow = () => {
    const p = Lad.blank(St.progress(store, script.id).sections?.[section.id]);
    howEl.textContent = p.done[step] ? '' : t(`practice.script.how.${step}`);
    howEl.hidden = !!p.done[step];
  };
  const top = h('div', { class: 'sc-rh-top' },
    h('div', { class: 'sc-rh-row' }, h('h1', { class: 'sc-rh-title' }, section.title),
      h('button', { type: 'button', class: 'btn btn-quiet pressable sc-end', onclick: () => end() }, t('practice.script.end'))),
    chips, howEl);
  drawSegs(prog0);

  // ---------- the text ----------
  const textEl = h('div', { class: 'sc-rtext', lang: langAttr(), dir: dirAttr() });
  const enEl = h('p', { class: 'sc-en', lang: 'en', hidden: true });
  const cueEl = h('div', { class: 'sc-cue', hidden: true });
  // Register "Both": the Sie (or ihr) version of the section, made once with Claude and kept on the device
  const variant = variantBox({ ctx, script, section, onChange: () => { drawText(); drawFoot(); } });
  const noteEl = section.note ? h('p', { class: 'caption sc-note' }, section.note) : null;
  const body = h('div', { class: 'sc-rh-body' }, noteEl, cueEl, variant.el, textEl, enEl);

  /** Words as spans whose letters can fade, sentence by sentence. @param {string} de @param {number} si @param {string} sid */
  function sentenceNodes(de, si, sid) {
    const toks = P.tokenize(de);
    let wi = 0;
    return toks.map(tok => {
      const space = tok.sp ? ' ' : '';
      if (!tok.w) return space + tok.t;
      const d = Math.min(480, si * 28 + wi * 9);
      const first = wi === 0;
      wi++;
      const chars = [...tok.t];
      const w = h('button', { type: 'button', tabindex: '-1', class: ['sc-rw', first && 'is-first', sid && marked.has(`${sid}:${tok.k}`) && 'is-mark'], style: { '--d': String(d) }, dataset: { w: tok.t }, onclick: (/** @type {Event} */ e) => peek(/** @type {HTMLElement} */ (e.currentTarget)) },
        h('span', { class: 'sc-a' }, h('span', { class: 'sc-t' }, chars[0])),
        chars.length > 1 ? h('span', { class: 'sc-r' }, h('span', { class: 'sc-t' }, chars.slice(1).join(''))) : null);
      return [space, w];
    });
  }
  function drawText() {
    variant.setStep(step);
    sents = variant.sentences() || base;
    if (step === 'parts') {
      const s = sents[cur];
      const parts = P.partsOf(s);
      const items = parts.map((p, i) => h('li', { class: 'sc-part' }, h('span', { class: 'sc-partn caption tnum' }, String(i + 1)),
        h('span', { class: 'sc-sent is-letters-only' }, sentenceNodes(p, i, ''))));
      items.push(h('li', { class: 'sc-part is-whole' }, h('span', { class: 'sc-partn caption' }, t('practice.script.parts.whole')),
        h('span', { class: 'sc-sent is-gaps-only' }, sentenceNodes(s.de, parts.length, s.id))));
      replace(textEl, h('ol', { class: 'sc-parts' }, items));
    } else {
      /** @type {any[]} */ const paras = []; let para = /** @type {any[]} */ ([]);
      sents.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
        if (s.p && para.length) { paras.push(para); para = []; }
        para.push(h('span', { class: ['sc-sent', i === cur && 'is-cur'], dataset: { i: String(i) } }, sentenceNodes(s.de, i, s.id)), ' ');
      });
      if (para.length) paras.push(para);
      replace(textEl, paras.map(p => h('p', { class: 'sc-para' }, p)));
    }
    treat(false);
  }
  /** The text treatment for the step: classes on the container; CSS fades the letters with the kit timings. @param {boolean} animate */
  function treat(animate) {
    const mode = step === 'letters' ? 'is-letters' : step === 'gaps' ? 'is-gaps' : step === 'cue' ? (reveal === 0 ? 'is-hidden' : reveal === 1 ? 'is-letters' : '') : step === 'parts' ? 'is-parts' : '';
    textEl.className = ['sc-rtext', mode, (!animate || reduced()) && 'is-still', step === 'listen' && 'is-listen'].filter(Boolean).join(' ');
    if (!animate || reduced()) requestAnimationFrame(() => textEl.classList.remove('is-still'));
    cueEl.hidden = step !== 'cue';
    if (step === 'cue') drawCue();
    drawEn();
    a11y();
  }
  /**
   * Hidden words leave the accessibility tree: each is a "hidden word" button (or "word starting with K" in Letters),
   * one tab stop for the text with arrows between words, Enter to peek (audit P1-4). Visible words are plain text.
   */
  function a11y() {
    const mode = textEl.classList.contains('is-hidden') ? 'gap' : textEl.classList.contains('is-letters') ? 'letter' : textEl.classList.contains('is-gaps') ? 'gaps' : textEl.classList.contains('is-parts') ? 'parts' : '';
    const ws = /** @type {HTMLElement[]} */ ([...textEl.querySelectorAll('.sc-rw')]);
    let first = true;
    for (const w of ws) {
      const word = w.dataset.w || '';
      let how = '';
      if (mode === 'gap') how = 'gap';
      else if (mode === 'letter') how = 'letter';
      else if (mode === 'gaps') how = w.classList.contains('is-first') ? '' : 'gap';
      else if (mode === 'parts') how = w.closest('.is-letters-only') ? 'letter' : w.classList.contains('is-first') ? '' : 'gap';
      const r = w.querySelector('.sc-r'), a = w.querySelector('.sc-a');
      if (how) {
        w.setAttribute('aria-label', how === 'letter' ? t('practice.script.peek.letter', { l: word.charAt(0) }) : t('practice.script.peek.gap'));
        r?.setAttribute('aria-hidden', 'true'); a?.setAttribute('aria-hidden', 'true');
        w.tabIndex = first ? 0 : -1; first = false;
      } else {
        w.removeAttribute('aria-label'); r?.removeAttribute('aria-hidden'); a?.removeAttribute('aria-hidden');
        w.tabIndex = -1;
      }
    }
  }
  textEl.addEventListener('keydown', e => {
    const ws = /** @type {HTMLElement[]} */ ([...textEl.querySelectorAll('.sc-rw[aria-label]')]);
    const i = ws.indexOf(/** @type {HTMLElement} */ (e.target));
    if (i < 0) return;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ws.length - 1 : -2;
    if (to === -2) return;
    e.preventDefault();
    const b = ws[Math.max(0, Math.min(ws.length - 1, to))];
    ws[i].tabIndex = -1; b.tabIndex = 0; b.focus();
  });
  function drawCue() {
    const first = sents[0];
    const cue = first?.en || `${String(first?.de || '').split(/\s+/).slice(0, 3).join(' ')} …`;
    replace(cueEl, h('p', { class: 'label' }, t('practice.script.cue.label')),
      h('p', { class: 'prompt sc-cue-text', lang: first?.en ? 'en' : 'de' }, cue),
      h('div', { class: 'row-actions' }, reveal < 2 ? h('button', { type: 'button', class: 'btn pressable', onclick: () => { reveal++; peeks += reveal === 1 ? 2 : 4; treat(true); drawFoot(); } },
        reveal === 0 ? t('practice.script.cue.show') : t('practice.script.cue.showAll')) : null));
  }
  function drawEn() {
    const s = sents[cur];
    const can = step !== 'cue' && !!s?.en;
    enEl.hidden = !(can && showEn);
    enEl.textContent = can ? s.en : '';
    enBtn.hidden = !can;
    enBtn.setAttribute('aria-pressed', String(showEn));
  }
  /** @param {HTMLElement} w */
  function peek(w) {
    if (!['letters', 'gaps', 'parts', 'cue'].includes(step)) return;
    if (w.classList.contains('is-peek')) return;
    const hidden = textEl.classList.contains('is-letters') || textEl.classList.contains('is-gaps') || textEl.classList.contains('is-parts') || textEl.classList.contains('is-hidden');
    if (!hidden) return;
    peeks++;
    w.classList.add('is-peek');
    announce(w.textContent || '');
    setTimeout(() => w.classList.remove('is-peek'), 2000);
  }

  // ---------- transport ----------
  const counter = h('span', { class: 'caption tnum sc-counter' });
  const playBtn = h('button', { type: 'button', class: 'btn pressable sc-play', onclick: () => (playing ? stop() : play()) });
  const speedBtn = h('button', { type: 'button', class: 'chip pressable sc-speed', onclick: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; drawFoot(); if (playing) { stop(); play(); } } });
  const enBtn = h('button', { type: 'button', class: 'chip pressable sc-enbtn', 'aria-pressed': 'false', onclick: () => { showEn = !showEn; drawEn(); } }, t('practice.script.english'));
  const doneBtn = h('button', { type: 'button', class: 'btn btn-primary pressable sc-done', onclick: () => finish() });
  const voiceNote = h('p', { class: 'caption sc-novoice', hidden: true }, t('practice.script.noVoice'));
  const transport = h('div', { class: 'sc-transport' },
    h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-label': t('practice.script.t.replay'), onclick: () => { stop(); play(); } }, icon('replay', { size: 18 })),
    h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-label': t('practice.script.t.prev'), onclick: () => move(-1) }, icon('prev', { size: 18 })),
    playBtn,
    h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-label': t('practice.script.t.next'), onclick: () => move(1) }, icon('next', { size: 18 })),
    counter, speedBtn);
  const actions = h('div', { class: 'sc-rh-actions' }, enBtn, doneBtn);
  const grades = gradeRow({ t, label: t('practice.script.grade.title'), onGrade: g => graded(/** @type {1|2|3|4} */ (g)),
    describe: g => t(`practice.script.grade.${g}.what`) });
  const peekLine = h('p', { class: 'caption sc-peeks', hidden: true });
  const foot = h('div', { class: 'sc-rh-foot' }, voiceNote, transport, actions, peekLine, grades.el);
  function drawFoot() {
    replace(playBtn, playing ? icon('pause', { size: 20 }) : icon('play', { size: 20 }));
    playBtn.setAttribute('aria-label', playing ? t('practice.script.t.pause') : t('practice.script.t.play'));
    counter.textContent = t('practice.script.t.count', { n: cur + 1, total: sents.length });
    speedBtn.textContent = `${speed.toFixed(1)}×`;
    speedBtn.setAttribute('aria-label', t('practice.script.t.speed', { x: speed.toFixed(1) }));
    voiceNote.hidden = hasVoice();
    playBtn.disabled = !hasVoice();
    const listenDone = step === 'listen' && played.size >= sents.length;
    doneBtn.textContent = step === 'listen' ? (listenDone ? t('practice.script.listenDone') : t('practice.script.listenFinish')) : step === 'parts' && cur < sents.length - 1 ? t('practice.script.parts.next') : t('practice.script.done');
    drawEn();
  }
  /** @param {number} d */
  function move(d) {
    stop();
    cur = Math.max(0, Math.min(sents.length - 1, cur + d));
    if (step === 'parts') drawText(); else highlight();
    drawFoot();
  }
  function highlight() {
    textEl.querySelectorAll('.sc-sent').forEach(s => s.classList.toggle('is-cur', /** @type {HTMLElement} */ (s).dataset.i === String(cur)));
    textEl.querySelector('.sc-sent.is-cur')?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }
  async function play() {
    if (!hasVoice() || !sents.length) return;
    playing = true; drawFoot();
    const idx = cur;
    const s = sents[idx];
    const sentEl = textEl.querySelector(`.sc-sent[data-i="${idx}"]`);
    const wordsEl = sentEl ? [...sentEl.querySelectorAll('.sc-rw')] : [];
    const starts = []; let pos = 0;
    for (const tok of P.tokenize(s.de)) { const at = s.de.indexOf(tok.t, pos); if (tok.w) starts.push(at); pos = at + tok.t.length; }
    speaking = say(step === 'parts' ? P.partsOf(s).join(' ') : s.de, { rate: speed, onWord: ci => {
      let k = 0; while (k + 1 < starts.length && starts[k + 1] <= ci) k++;
      wordsEl.forEach((w, i) => w.classList.toggle('is-said', i === k));
    } });
    const r = await speaking.done;
    wordsEl.forEach(w => w.classList.remove('is-said'));
    if (!alive || !playing || cur !== idx) return;
    if (r.ended) played.add(idx);
    if (step !== 'listen' || !r.ended) { playing = false; drawFoot(); return; }
    // the pause for his own repetition, then the next sentence
    if (idx >= sents.length - 1) { playing = false; drawFoot(); if (played.size >= sents.length) listenDone(); return; }
    pauseTimer = window.setTimeout(() => { if (!alive || !playing) return; cur = idx + 1; highlight(); drawFoot(); play(); }, Math.max(1200, 1.2 * r.ms));
  }
  function stop() { playing = false; clearTimeout(pauseTimer); speaking?.cancel(); speaking = null; hush(); drawFoot(); }

  // ---------- steps ----------
  /** @param {Lad.Step} s */
  function setStep(s) {
    // leaving a step's done screen
    const doneWrap = body.querySelector('.sc-stepdone-wrap');
    if (doneWrap) { doneWrap.remove(); stopHero(); foot.hidden = false; textEl.hidden = false; }
    if (s === step) { if (doneWrap) { grades.reset(); actions.hidden = false; transport.hidden = s === 'cue'; peekLine.hidden = true; reveal = 0; peeks = 0; drawText(); drawFoot(); } return; }
    stop();
    grades.reset(); peekLine.hidden = true; actions.hidden = false; transport.hidden = s === 'cue'; peeks = 0;
    const was = step;
    step = s; reveal = 0;
    chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(/** @type {HTMLButtonElement} */ (b).name === `step:${s}`)));
    history.replaceState(null, '', `#/practice/scripts/${script.id}/rehearse/${section.id}?step=${s}`);
    if (s === 'parts' || was === 'parts' || (was === 'cue' && sents !== base)) { cur = Math.min(cur, sents.length - 1); drawText(); } else treat(true);
    drawFoot(); drawHow();
    announce(t(`practice.script.step.${s}`));
  }
  function listenDone() {
    const p = Lad.listened(St.progress(store, script.id).sections?.[section.id], section, c.today);
    St.updateProgress(store, script.id, x => ({ ...x, sections: { ...x.sections, [section.id]: p } }));
    drawSegs(p, 'listen');
    showDone(null, p);
  }
  function finish() {
    if (step === 'listen') { stop(); listenDone(); return; }
    if (step === 'parts' && cur < sents.length - 1) { move(1); return; }
    stop();
    // the grade row replaces the actions in the footer; the peeks suggest a grade, he always picks
    actions.hidden = true; transport.hidden = true;
    peekLine.textContent = t('practice.script.grade.peeks', { n: peeks }); peekLine.hidden = false;
    grades.set(whenLines());
    grades.show({ suggest: /** @type {1|2|3|4} */ (Lad.suggestGrade(peeks)) });
  }
  /** What each grade does, under its button: the step tomorrow or the next step; at Cue, when the section comes back. */
  function whenLines() {
    if (step === 'cue' && !variant.on()) {
      const prev = St.cardOf(store)(Lad.srId(script.id, section.id))?.rec || null;
      const cx = fsCtx(script, c.today);
      return [1, 2, 3, 4].map(g => {
        const due = Lad.rate(prev, /** @type {1|2|3|4} */ (g), cx).rec?.due;
        const n = due ? D8diff(c.today, due) : 1;
        return n <= 1 ? t('practice.script.when.tomorrowShort') : t('practice.script.when.days', { n });
      });
    }
    if (step === 'cue') return ['', '', '', ''];
    const at = steps.indexOf(step), cue = steps.indexOf('cue');
    const nextOf = (/** @type {number} */ k) => t('practice.script.when.next', { step: t(`practice.script.step.${steps[Math.min(cue, at + k)]}`) });
    return [t('practice.script.when.again'), t('practice.script.when.again'), nextOf(1), nextOf(2)];
  }
  /** @param {1|2|3|4} g */
  function graded(g) {
    if (!alive) return;
    // the other-register version (Both) is its own practice: it records a grade without moving the ladder or the card
    if (variant.on()) {
      variant.graded(g, c.today);
      setTimeout(() => { if (alive) showDone(g, Lad.blank(St.progress(store, script.id).sections?.[section.id]), true); }, reduced() ? 0 : 420);
      return;
    }
    const before = St.progress(store, script.id).sections?.[section.id];
    const p = Lad.graded(before, section, step, g, c.today, peeks);
    St.updateProgress(store, script.id, x => ({ ...x, sections: { ...x.sections, [section.id]: p } }));
    if (step === 'cue') {
      const id = Lad.srId(script.id, section.id);
      const prev = St.cardOf(store)(id)?.rec || null;
      const cx = fsCtx(script, c.today);
      const r = Lad.rate(prev, g, cx);
      St.saveReview(store, { id, rec: r.rec, prev, deck: St.DECK, g, mode: 's', flags: peeks ? `k${peeks}` : '', ctx: cx, scriptId: script.id });
      const now = Lad.readiness(St.get(store, script.id), St.progress(store, script.id), x => St.cardOf(store)(x)?.rec, c.today);
      // the overview fills this section's row on the next open (it lands in accent when the section became ready)
      celebrate(script.id, section.id);
      void now;
    }
    drawSegs(p, step);
    setTimeout(() => { if (alive) showDone(g, p); }, reduced() ? 0 : 420);
  }
  /**
   * The step is done: the shared done hero inline (the steps done of the section as its figure, the section's row of
   * the ready meter as its data), a line says what comes next.
   * @param {number | null} g @param {any} p @param {boolean} [isVariant]
   */
  function showDone(g, p, isVariant = false) {
    const nextName = p.step;
    const msg = step === 'cue' ? (g === 1 ? t('practice.script.doneCueAgain') : t('practice.script.doneCue'))
      : nextName === step ? t('practice.script.doneRepeat', { step: t(`practice.script.step.${step}`) })
        : t('practice.script.doneNext', { step: t(`practice.script.step.${step}`), next: t(`practice.script.step.${nextName}`), when: !p.at || p.at <= c.today ? t('practice.script.when.now') : p.at === add(c.today, 1) ? t('practice.script.when.tomorrow') : t('practice.script.when.from', { date: label(p.at) }) });
    const nextSec = script.sections[script.sections.findIndex((/** @type {any} */ s) => s.id === section.id) + 1];
    // the figure counts the steps with a check in the pills: passed on the ladder, or done once by choice
    const pos = Lad.position(p, section);
    const atCue = p.step === 'cue' && !!p.done.cue;
    pos.done = atCue ? pos.steps.length : pos.steps.filter((/** @type {string} */ x, /** @type {number} */ k) => k < pos.index || !!p.done[x]).length;
    const r = Lad.readiness(St.get(store, script.id) || script, St.progress(store, script.id), x => St.cardOf(store)(x)?.rec, c.today);
    const row = r.rows.find(x => x.id === section.id);
    const field = scriptField({ rows: row ? [row] : [] });
    const hero = doneHero({ level: 'h2', cls: 'sc-stepdone', atmo: !reduced(), inFlow: true, label: isVariant ? t('practice.script.variant.done', { form: variant.formName() }) : t('practice.script.stepDoneLabel', { step: t(`practice.script.step.${step}`) }),
      figure: pos.done, of: t('practice.script.stepsOf', { n: pos.steps.length }), lines: [h('p', { class: 'lead' }, isVariant ? t('practice.script.variant.saved') : msg)], data: field });
    // within a week of delivery the next step is the one to do now (UX P2-32)
    const soon = !!script.deliverOn && D8diff(c.today, script.deliverOn) <= 7;
    const tryNext = nextName !== step && step !== 'cue' && !isVariant;
    const doneEl = h('div', { class: 'sc-stepdone-wrap', role: 'status' }, hero.el,
      h('div', { class: 'row-actions wrap' },
        tryNext && soon ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => setStep(nextName) }, t('practice.script.tryNow', { step: t(`practice.script.step.${nextName}`) })) : null,
        h('a', { class: ['btn', 'pressable', !(tryNext && soon) && 'btn-primary'], href: `#/practice/scripts/${script.id}` }, t('practice.script.toOverview')),
        nextSec ? h('a', { class: 'btn pressable', href: `#/practice/scripts/${script.id}/rehearse/${nextSec.id}?step=${Lad.blank(St.progress(store, script.id).sections?.[nextSec.id]).step}` }, t('practice.script.nextSection', { section: nextSec.title })) : null,
        tryNext && !soon ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => setStep(nextName) }, t('practice.script.tryNow', { step: t(`practice.script.step.${nextName}`) })) : null));
    foot.hidden = true;
    textEl.hidden = true; cueEl.hidden = true; enEl.hidden = true; variant.el.hidden = true;
    body.append(doneEl);
    stopHero = hero.start();
    // the section's cells fill with the runway spring, one after another
    if (!reduced()) field.querySelectorAll('.sc-cell').forEach((x, i) => { /** @type {HTMLElement} */ (x).style.setProperty('--i', String(Math.min(i, 24))); x.classList.add('is-fill'); });
    body.scrollTop = 0;
    drawHow();
  }
  let stopHero = () => {};
  function end() { ctx.go(`/practice/scripts/${script.id}`); }

  const view = h('div', { class: 'sc-rh', role: 'region', 'aria-label': t('practice.script.rehearse'), 'data-title': t('practice.script.title') }, top, h('div', { class: 'sc-rh-scroll' }, body), foot);
  replace(el, view);
  drawText();
  transport.hidden = step === 'cue';
  drawFoot(); drawHow();
  const offV = onVoices(() => alive && drawFoot());
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (grades.key(e)) return;
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) end();
  };
  document.addEventListener('keydown', onKey);
  return () => {
    alive = false; stop(); offV(); stopHero(); variant.destroy(); document.removeEventListener('keydown', onKey); restore();
    addActivity(store, c.today, { minutes: Math.min(30, (performance.now() - t0) / 60000) });
  };
}
