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
   width. Every step but Listen ends with Again / Hard / Good / Easy; the peek count suggests one. */
import { h, replace, announce } from '../../../core/dom.js';
import { icon } from '../../../core/icons.js';
import { reduced, segments } from '../../../core/motion.js';
import { label, add } from '../../../core/clock.js';
import * as P from './parse.js';
import * as St from './store.js';
import * as Lad from './ladder.js';
import { fsCtx } from './plan.js';
import { celebrate } from './moment.js';
import { say, hush, hasVoice, onVoices } from './voice.js';
import { gradeSheet, fullScreen, checkMark } from './ui.js';
import { addActivity } from '../data.js';

const SPEEDS = [0.8, 0.9, 1.0];

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {any} script @param {string} sectionId */
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
  const sents = section.sentences;
  const marked = new Set((script.marks || []).filter((/** @type {any} */ m) => m.sentenceId).map((/** @type {any} */ m) => `${m.sentenceId}:${m.start}`));

  // ---------- header ----------
  const segs = h('div', { class: 'segments sc-rh-segs', 'aria-label': t('practice.script.ladder') });
  const drawSegs = (/** @type {any} */ p) => {
    const atCue = p.step === 'cue' && !!p.done.cue, i = steps.indexOf(p.step);
    segments(segs, steps.map((_, k) => (atCue || k < i ? 'done' : k === i ? 'now' : '')));
  };
  drawSegs(prog0);
  const chips = h('div', { class: 'sc-steps', role: 'group', 'aria-label': t('practice.script.steps') }, steps.map(s =>
    h('button', { type: 'button', class: 'chip pressable', name: `step:${s}`, 'aria-pressed': String(s === step), onclick: () => setStep(s) }, t(`practice.script.step.${s}`))));
  const top = h('div', { class: 'sc-rh-top' },
    h('div', { class: 'sc-rh-row' }, h('h1', { class: 'sc-rh-title' }, section.title),
      h('button', { type: 'button', class: 'btn btn-quiet pressable sc-end', onclick: () => end() }, t('practice.script.end'))),
    segs, chips);

  // ---------- the text ----------
  const textEl = h('div', { class: 'sc-rtext', lang: 'de' });
  const enEl = h('p', { class: 'sc-en', lang: 'en', hidden: true });
  const cueEl = h('div', { class: 'sc-cue', hidden: true });
  const noteEl = section.note ? h('p', { class: 'caption sc-note' }, section.note) : null;
  const body = h('div', { class: 'sc-rh-body' }, noteEl, cueEl, textEl, enEl);

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
      const w = h('button', { type: 'button', tabindex: '-1', class: ['sc-rw', first && 'is-first', marked.has(`${sid}:${tok.k}`) && 'is-mark'], style: { '--d': String(d) }, onclick: (/** @type {Event} */ e) => peek(/** @type {HTMLElement} */ (e.currentTarget)) },
        h('span', { class: 'sc-a' }, h('span', { class: 'sc-t' }, chars[0])),
        chars.length > 1 ? h('span', { class: 'sc-r' }, h('span', { class: 'sc-t' }, chars.slice(1).join(''))) : null);
      return [space, w];
    });
  }
  function drawText() {
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
  }
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
  const foot = h('div', { class: 'sc-rh-foot' }, voiceNote, transport, h('div', { class: 'sc-rh-actions' }, enBtn, doneBtn));
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
    if (s === step) return;
    stop();
    const was = step;
    step = s; reveal = 0;
    chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(/** @type {HTMLButtonElement} */ (b).name === `step:${s}`)));
    history.replaceState(null, '', `#/practice/scripts/${script.id}/rehearse/${section.id}?step=${s}`);
    if (s === 'parts' || was === 'parts') { cur = Math.min(cur, sents.length - 1); drawText(); } else treat(true);
    transport.hidden = s === 'cue';
    drawFoot();
    announce(t(`practice.script.step.${s}`));
  }
  function listenDone() {
    const p = Lad.listened(St.progress(store, script.id).sections?.[section.id], section, c.today);
    St.updateProgress(store, script.id, x => ({ ...x, sections: { ...x.sections, [section.id]: p } }));
    drawSegs(p);
    showDone(null, p);
  }
  async function finish() {
    if (step === 'listen') { stop(); listenDone(); return; }
    if (step === 'parts' && cur < sents.length - 1) { move(1); return; }
    stop();
    const g = await gradeSheet({ t, peeks, suggest: Lad.suggestGrade(peeks), title: t('practice.script.grade.title') });
    if (!g || !alive) return;
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
      if (g >= 3 && now.rows.find(x => x.id === section.id)?.ready) celebrate(script.id, section.id);
    }
    drawSegs(p);
    showDone(g, p);
  }
  /** The step is done: the segment fills, a line says what comes next. @param {number | null} g @param {any} p */
  function showDone(g, p) {
    const nextName = p.step;
    const msg = step === 'cue' ? (g === 1 ? t('practice.script.doneCueAgain') : t('practice.script.doneCue'))
      : nextName === step ? t('practice.script.doneRepeat', { step: t(`practice.script.step.${step}`) })
        : t('practice.script.doneNext', { step: t(`practice.script.step.${step}`), next: t(`practice.script.step.${nextName}`), when: !p.at || p.at <= c.today ? t('practice.script.when.now') : p.at === add(c.today, 1) ? t('practice.script.when.tomorrow') : t('practice.script.when.from', { date: label(p.at) }) });
    const nextSec = script.sections[script.sections.findIndex((/** @type {any} */ s) => s.id === section.id) + 1];
    const doneEl = h('div', { class: 'sc-stepdone', role: 'status' },
      h('span', { class: 'sc-bigcheck' }, checkMark()),
      h('p', { class: 'lead' }, msg),
      h('div', { class: 'row-actions wrap' },
        h('a', { class: 'btn btn-primary pressable', href: `#/practice/scripts/${script.id}` }, t('practice.script.toOverview')),
        nextSec ? h('a', { class: 'btn pressable', href: `#/practice/scripts/${script.id}/rehearse/${nextSec.id}?step=${Lad.blank(St.progress(store, script.id).sections?.[nextSec.id]).step}` }, t('practice.script.nextSection', { section: nextSec.title })) : null,
        nextName !== step && step !== 'cue' ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { doneEl.remove(); foot.hidden = false; setStep(nextName); } }, t('practice.script.tryNow', { step: t(`practice.script.step.${nextName}`) })) : null));
    foot.hidden = true;
    body.append(doneEl);
    requestAnimationFrame(() => doneEl.classList.add('is-correct'));
    doneEl.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    /** @type {HTMLElement | null} */ (doneEl.querySelector('a'))?.focus({ preventScroll: true });
  }
  function end() { ctx.go(`/practice/scripts/${script.id}`); }

  const view = h('div', { class: 'sc-rh', role: 'region', 'aria-label': t('practice.script.rehearse') }, top, h('div', { class: 'sc-rh-scroll' }, body), foot);
  replace(el, view);
  drawText();
  transport.hidden = step === 'cue';
  drawFoot();
  const offV = onVoices(() => alive && drawFoot());
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) end(); };
  document.addEventListener('keydown', onKey);
  return () => {
    alive = false; stop(); offV(); document.removeEventListener('keydown', onKey); restore();
    addActivity(store, c.today, { minutes: Math.min(30, (performance.now() - t0) / 60000) });
  };
}
