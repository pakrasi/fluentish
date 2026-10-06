/* A speaking module (Goethe B1: Sprechen): preparation with notes on the clock (prepMinutes), then the parts of the
   exam definition, one recording each: 'plan' (planning with a partner whose lines are heard; Teil 1), 'present' (a
   presentation, slide by slide; Teil 2) and 'questions' (the examiner's questions on the chosen topic; Teil 3).

   A recording is never lost: while it runs, the audio so far is written to IndexedDB every 2 seconds (data.js
   beginTake/keepTakeAudio), so a reload or a killed page keeps all but the last 2 seconds (recoverTake on the next
   start); a take the system ends on its own (a call, Siri, the screen locking) is saved with what was captured; the
   blob is written to IndexedDB with its file name before any upload, the upload is retried by the results sync until
   both files are in the repository, and "Save file" downloads it at any time. While a take runs, leaving the page
   asks first. */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createRecorder, RecorderError } from '../../services/recorder.js';
import { clip } from '../../services/audio.js';
import { shareFile } from '../../services/share.js';
import { audioExt } from '../../data/sync/index.js';
import { draft, saveDraft, submitAttempt, saveRecording, recordings, mediaUrl, sync, linked, beginTake, keepTakeAudio, endTake, recoverTake, sectionOf } from './data.js';
import { uuidv7 } from '../../data/ids.js';
import { clockBar, backLink, confirmPanel, arrowKeys } from './parts.js';
import { fmt } from './timer.js';
import { stampMs } from '../../domain/grade.js';
import { at, fill } from '../../domain/examdef.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { fill as fillBar, reduced } from '../../core/motion.js';
import { meter as level01 } from '../../domain/hearing.js';

/** @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, ex: any, def: any }} o */
export function runSprechen(el, ctx, { exam, n, ex, def }) {
  const { store, t } = ctx;
  const tx = exam.tx;
  document.body.dataset.chrome = 'off';
  const module = def.id;
  const sec = sectionOf(exam, module);
  /** the part of each kind, and its task in the test */
  const kind = (/** @type {string} */ k) => sec.parts.find((/** @type {any} */ p) => p.kind === k);
  const [PLAN, PRES, QUES] = [kind('plan'), kind('present'), kind('questions')];
  const P = { teil1: at(ex, PLAN.task), teil2: at(ex, PRES.task), teil3: at(ex, QUES.task) };
  const PARTS = sec.parts.map((/** @type {any} */ p) => p.id);
  const PHASES = [['prep', tx('prep')], ...PARTS.map((/** @type {string} */ id, /** @type {number} */ i) => [id, tx('teil', { n: i + 1 })]), ['done', tx('done')]];
  const st = { topic: 0, notes1: '', notes: '', phase: 'prep', recorded: /** @type {Record<string, boolean>} */ ({}), ...(draft(store, n, module)?.answers || {}) };
  const save = () => saveDraft(store, n, module, { answers: { ...st, recorded: { ...st.recorded } } });
  const rec = createRecorder();
  /** @type {ReturnType<typeof clip> | null} */ let cueAudio = null;
  let recording = false;
  /** stop the take that is running, from outside its box (the page is being hidden) @type {((auto: boolean) => Promise<void>) | null} */
  let activeStop = null;
  /** write the take's audio so far now @type {(() => void) | null} */
  let flushTake = null;
  const clock = clockBar({ ctx, tx, n, module, minutes: sec.prepMinutes || def.minutes, label: tx('prepShort') });
  const since = clock.clock.start;
  const tabs = h('div', { class: 'ex-tabs', role: 'tablist', 'aria-label': tx('tabs') });
  arrowKeys(tabs);
  const content = h('div', { id: 'ex-panel', role: 'tabpanel' });
  const stopCue = () => { cueAudio?.stop(); cueAudio = null; };
  const setPhase = (/** @type {string} */ p) => {
    if (recording) { ctx.toast(tx('rec.stopFirst')); return; }
    stopCue();
    st.phase = p; save(); draw();
    scrollTo({ top: 0 });
  };
  const nav = (/** @type {string | null} */ prev, /** @type {string | null} */ next) => h('div', { class: 'ex-nav' },
    prev ? h('button', { type: 'button', class: 'btn pressable', onclick: () => setPhase(prev) }, tx('back')) : null,
    h('span', { class: 'ex-nav-grow' }),
    next ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => setPhase(next) }, tx('next')) : null);
  const notesArea = (/** @type {'notes1' | 'notes'} */ field, /** @type {string} */ ph) => {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'ex-write ex-notes', 'aria-label': tx('notes'), placeholder: ph, spellcheck: 'false', autocorrect: 'off', lang: langAttr(), dir: dirAttr(),
      oninput: (/** @type {Event} */ e) => { st[field] = /** @type {HTMLTextAreaElement} */ (e.target).value; save(); } }));
    ta.value = st[field] || '';
    return ta;
  };
  const hidden = (/** @type {string} */ text) => {
    const box = h('p', { class: 'ex-cue-text', hidden: true }, text);
    const b = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { box.hidden = !box.hidden; b.textContent = box.hidden ? tx('showText') : tx('hideText'); } }, tx('showText'));
    return [b, box];
  };
  const playCue = (/** @type {string} */ url, /** @type {() => void} */ onEnd = () => {}) => {
    stopCue();
    const c = cueAudio = clip(url, { onEnded: onEnd });
    c.result.then(r => { if (cueAudio === c && (r === 'blocked' || r === 'error')) { ctx.toast(tx('audioBlocked')); onEnd(); } });
  };

  /** The recorder for one Teil. @param {string} part @param {string} label @param {string} hint */
  function recorderBox(part, label, hint) {
    const box = h('section', { class: 'ex-rec', 'aria-label': tx('rec.title') });
    const timeEl = h('span', { class: 'ex-rec-t tnum' });
    // the level while recording, so he sees the phone hearing him (kit .track .fill; stepped with reduced motion)
    const meterEl = h('div', { class: 'track ex-meter', 'aria-hidden': 'true', hidden: true }, h('span', { class: 'fill' }));
    let meterAt = 0;
    const onLevel = (/** @type {number} */ db) => { const now = performance.now(); if (reduced() && now - meterAt < 250) return; meterAt = now; fillBar(meterEl, level01(db)); };
    const status = h('p', { class: 'caption', 'aria-live': 'polite' });
    const list = h('ul', { class: 'ex-takes' });
    let t0 = 0;
    /** @type {any} */ let iv = null;
    const fileIn = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (f) keep(f, f.type || 'audio/mp4');
    } }));
    const startBtn = h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: start }, icon('record', { size: 18 }), tx('recStart'));
    const stopBtn = h('button', { type: 'button', class: 'btn btn-danger pressable', onclick: () => stop(false), hidden: true }, icon('stop', { size: 18 }), tx('recStop'));
    /** @type {string | null} */ let takeId = null;
    /** @type {Blob | null} */ let soFar = null;
    let savedAt = 0;
    const flush = () => { if (takeId && soFar) { savedAt = Date.now(); keepTakeAudio(store, takeId, soFar).catch(() => {}); } };
    const fileBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => fileIn.click() }, rec.supported ? tx('recFile') : tx('recFileOnly'));
    async function start() {
      try {
        const id = uuidv7(Date.now());
        await rec.start({
          onChunk: b => { soFar = b; if (Date.now() - savedAt >= 2000) flush(); },
          onEnded: () => { if (recording) stop(true); },
          onLevel,
        });
        meterEl.hidden = false;
        takeId = id; soFar = null; savedAt = 0;
        beginTake(store, { id, n, part, label, startedAt: Date.now(), module });
        activeStop = stop; flushTake = flush;
        recording = true; drawTabs();
        box.classList.add('is-on');
        startBtn.hidden = true; stopBtn.hidden = false;
        t0 = Date.now();
        iv = setInterval(() => { timeEl.textContent = fmt((Date.now() - t0) / 1000); }, 500);
        timeEl.textContent = '0:00';
        status.textContent = tx('rec.running');
      } catch (e) {
        status.textContent = e instanceof RecorderError && e.code === 'denied' ? tx('rec.denied') : tx('rec.unsupported');
      }
    }
    /** @param {boolean} auto the system ended the take, or the page is going away */
    async function stop(auto) {
      if (!recording) return;
      recording = false; activeStop = null; flushTake = null;
      clearInterval(iv);
      meterEl.hidden = true; fillBar(meterEl, 0);
      const id = takeId;
      try {
        const { blob, mime } = await rec.stop();
        if (await keep(blob, mime) && id) await endTake(store, id);
        if (auto) status.textContent = tx('rec.stoppedBySystem');
      } catch {
        status.textContent = tx('rec.empty');
        if (id) await endTake(store, id);
      }
      takeId = null;
      drawTabs();
      box.classList.remove('is-on');
      startBtn.hidden = false; stopBtn.hidden = true;
    }
    /** @param {Blob} blob @param {string} mime @returns {Promise<boolean>} whether the recording is stored */
    async function keep(blob, mime) {
      status.textContent = tx('rec.saving');
      let stored = false;
      try {
        await saveRecording(ctx, { n, part, label, blob, mime, module });
        stored = true;
        st.recorded[part] = true; save(); drawTabs();
        status.textContent = linked(store) ? tx('rec.savedSending') : tx('rec.savedLocal');
        setTimeout(drawList, 50);
        const r = await sync(ctx, true);
        status.textContent = !linked(store) ? tx('rec.savedLocal') : r.error ? tx('rec.notSentYet') : tx('rec.sentOk');
        drawList();
      } catch (e) {
        // the blob could not even be stored: offer the file right away so nothing is lost
        console.error(e);
        status.textContent = tx('rec.storeFailed');
        box.append(h('button', { type: 'button', class: 'btn pressable', onclick: () => shareFile(blob, `test${n}-${module}-${part}.${audioExt(mime)}`) }, icon('download', { size: 18 }), tx('rec.saveFile')));
      }
      return stored;
    }
    async function drawList() {
      const mine = recordings(store, n, module).filter(v => v.part === part && stampMs(v.created_at) >= since - 60e3);
      const items = await Promise.all(mine.map(async (v, i) => {
        const blob = v.blobRef ? await store.adapter.getBlob(v.blobRef).catch(() => null) : null;
        return h('li', null, h('span', { class: 'caption' }, `${tx('take', { n: i + 1 })} · ${v.sent ? tx('rec.sent') : tx('rec.notSent')}`),
          !v.sent ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: async () => { const r = await sync(ctx, true); ctx.toast(r.error ? tx('sendFailed', { why: r.error }) : tx('allSent')); drawList(); } }, tx('sendNow')) : null,
          blob ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => shareFile(blob, `test${n}-${module}-${part}-${i + 1}.${audioExt(blob.type)}`) }, tx('rec.saveFile')) : null);
      }));
      replace(list, items);
    }
    drawList();
    replace(box, h('div', { class: 'ex-rec-row' }, rec.supported ? startBtn : null, rec.supported ? stopBtn : null, h('span', { class: 'ex-rec-dot', 'aria-hidden': 'true' }), timeEl, meterEl, fileBtn, fileIn),
      h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() }, hint), status, list);
    return box;
  }

  const drawTabs = () => replace(tabs, PHASES.map(([p, nm]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(st.phase === p), disabled: recording && st.phase !== p, class: 'ex-tab pressable', lang: langAttr(), dir: dirAttr(), onclick: () => setPhase(p),
  }, nm, PARTS.includes(p) ? h('span', { class: ['ex-dot', st.recorded[p] && 'is-full'], role: 'img', 'aria-label': st.recorded[p] ? tx('rec.has') : tx('rec.hasNot') }) : null)));

  function draw() {
    drawTabs();
    clock.el.hidden = st.phase !== 'prep';
    const instr = (/** @type {string} */ s) => h('p', { class: 'ex-instr', lang: langAttr(), dir: dirAttr() }, s);
    let c;
    if (st.phase === 'prep') {
      c = h('div', { lang: langAttr(), dir: dirAttr() }, instr(tx('prepIntro')),
        h('section', { class: 'ex-block' }, h('p', { class: 'label' }, tx('s1Title')), h('p', null, P.teil1.situation),
          h('ul', { class: 'ex-points' }, P.teil1.points.map((/** @type {string} */ p) => h('li', null, p))),
          h('p', { class: 'label' }, tx('notesFor', { n: 1 })), notesArea('notes1', tx('notes1Placeholder'))),
        h('section', { class: 'ex-block' }, h('p', { class: 'label' }, tx('s2Choose')),
          h('div', { class: 'ex-opts', role: 'radiogroup', 'aria-label': tx('topic') }, P.teil2.topics.map((/** @type {string} */ tp, /** @type {number} */ i) => h('label', { class: 'ex-opt' },
            h('input', { type: 'radio', name: 'topic', checked: st.topic === i, onchange: () => { st.topic = i; save(); } }), h('span', { class: 'ex-opt-text' }, tp)))),
          h('p', { class: 'label' }, tx('slides')), h('ol', { class: 'ex-points' }, P.teil2.folien.map((/** @type {string} */ f) => h('li', null, f))),
          h('p', { class: 'label' }, tx('notesFor', { n: 2 })), notesArea('notes', tx('notes2Placeholder'))),
        nav(null, PLAN.id));
    } else if (st.phase === PLAN.id) {
      let idx = -1;
      const cues = P.teil1[PLAN.cues.from] || [];
      const cueBox = h('div', { class: 'ex-cue', 'aria-live': 'polite' });
      const drawCue = (/** @type {boolean} */ playing) => idx < 0
        ? replace(cueBox, h('p', { class: 'caption' }, tx('partnerStarts')))
        : replace(cueBox, h('p', { class: 'caption' }, tx('cueOf', { i: idx + 1, n: cues.length })), h('p', { class: 'ex-cue-state' }, playing ? tx('partnerSpeaks') : tx('yourTurn')), ...hidden(cues[idx]));
      const step = (/** @type {number} */ dx) => { idx = Math.max(0, Math.min(cues.length - 1, idx + dx)); drawCue(true); playCue(mediaUrl(exam, n, fill(PLAN.cues.file, { i: idx + 1 })), () => drawCue(false)); };
      drawCue(false);
      c = h('div', { lang: langAttr(), dir: dirAttr() }, instr(tx(PLAN.instruction)),
        h('section', { class: 'ex-block' }, h('p', null, P.teil1.situation), h('ul', { class: 'ex-points' }, P.teil1.points.map((/** @type {string} */ p) => h('li', null, p))),
          st.notes1 ? h('p', { class: 'caption ex-pre' }, st.notes1) : null),
        h('section', { class: 'ex-block' }, cueBox, h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn pressable', 'aria-label': tx('prevCue'), onclick: () => step(-1) }, icon('prev', { size: 18 })),
          h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => step(1) }, tx('nextCue')),
          h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => step(0) }, icon('replay', { size: 18 }), tx('again')))),
        recorderBox(PLAN.id, String(P.teil1.situation).slice(0, 80), tx(PLAN.recordHint)),
        nav('prep', PRES.id));
    } else if (st.phase === PRES.id) {
      let f = 0;
      const slides = P.teil2.folien;
      const folie = h('div', { class: 'ex-folie' });
      const show = () => replace(folie, h('p', { class: 'caption' }, tx('slideOf', { i: f + 1, n: slides.length })), h('p', { class: 'ex-folie-t' }, String(P.teil2.topics[st.topic]).replace(new RegExp(PRES.topicPrefix || '^$'), '')), h('p', null, slides[f]));
      show();
      c = h('div', { lang: langAttr(), dir: dirAttr() }, instr(tx(PRES.instruction)), folie,
        h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: () => { f = Math.max(0, f - 1); show(); } }, tx('slidePrev')), h('button', { type: 'button', class: 'btn pressable', onclick: () => { f = Math.min(slides.length - 1, f + 1); show(); } }, tx('slideNext'))),
        st.notes ? h('section', { class: 'ex-block' }, h('p', { class: 'label' }, tx('yourNotes')), h('p', { class: 'ex-pre' }, st.notes)) : null,
        recorderBox(PRES.id, P.teil2.topics[st.topic], tx(PRES.recordHint)),
        nav(PLAN.id, QUES.id));
    } else if (st.phase === QUES.id) {
      // one question set per presentation topic, each with its recordings
      const set = QUES.questions[Math.min(st.topic, QUES.questions.length - 1)];
      const qs = P.teil3[set.from];
      c = h('div', { lang: langAttr(), dir: dirAttr() }, instr(tx(QUES.instruction)),
        h('section', { class: 'ex-block' }, qs.map((/** @type {string} */ q, /** @type {number} */ i) => h('div', { class: 'ex-item' },
          h('button', { type: 'button', class: 'btn pressable', onclick: () => playCue(mediaUrl(exam, n, fill(set.file, { i: i + 1 }))) }, icon('play', { size: 18 }), tx('question', { i: i + 1 })), ...hidden(q)))),
        recorderBox(QUES.id, P.teil2.topics[st.topic], tx(QUES.recordHint)),
        nav(PRES.id, 'done'));
    } else {
      const missing = PARTS.filter((/** @type {string} */ p) => !st.recorded[p]);
      const teil = (/** @type {string} */ p) => tx('teil', { n: PARTS.indexOf(p) + 1 });
      const confirmSlot = h('div');
      let busy = false;
      const finish = async () => {
        if (busy) return;
        busy = true;
        try {
          const notes = [st.notes1 ? `${tx('notesTeil', { n: 1 })}\n${st.notes1}` : '', st.notes || ''].filter(Boolean).join('\n\n');
          const cl = clock.clock;
          const r = await submitAttempt(ctx, { exam, n, module, clock: cl, score: null, maxScore: def.max,
            writings: notes ? [{ aufgabe: `${module}-notizen`, text: notes, word_count: notes.split(/\s+/).filter(Boolean).length }] : [],
            meta: { topic: P.teil2.topics[st.topic], recorded: st.recorded } });
          clock.stop(false);   // only once the attempt is stored
          submitted = true;
          ctx.go(`/exam/${n}/${module}/review/${r.id}`, { replace: true });
        } catch (e) { busy = false; console.error(e); ctx.toast(tx('submitFailed')); }
      };
      c = h('div', { lang: langAttr(), dir: dirAttr() },
        h('section', { class: 'ex-block' }, h('p', { class: 'label' }, tx('recordings')),
          h('p', null, PARTS.map((/** @type {string} */ p) => `${teil(p)} ${st.recorded[p] ? tx('recorded') : tx('missing')}`).join(' · ')),
          h('p', { class: 'caption' }, tx('afterSubmit'))),
        h('div', { class: 'ex-nav' }, h('button', { type: 'button', class: 'btn pressable', onclick: () => setPhase(PARTS[PARTS.length - 1]) }, tx('back')), h('span', { class: 'ex-nav-grow' }),
          h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => replace(confirmSlot, confirmPanel({
            lang: langAttr(), dir: dirAttr(), title: missing.length ? tx('missingQ', { list: missing.map(teil).join(tx('and')) }) : tx('submitQ', { module: def.name }),
            lines: [tx('final')], yes: tx('submitSprechen'), no: tx('keepGoing'), onNo: () => replace(confirmSlot), onYes: finish,
          })) }, tx('submitSprechen'))),
        confirmSlot);
    }
    replace(content, c);
  }
  let submitted = false;
  // while a take runs: reloading or closing asks first; hiding the page writes the audio so far; leaving for good stops
  // and keeps the take
  const guard = (/** @type {BeforeUnloadEvent} */ e) => { if (recording) { e.preventDefault(); e.returnValue = ''; } };
  const onHide = () => { flushTake?.(); if (activeStop) activeStop(true); };
  const onVis = () => { if (document.visibilityState === 'hidden') flushTake?.(); };
  addEventListener('beforeunload', guard);
  addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVis);
  // a take cut off by a reload is kept as a recording
  recoverTake(ctx).then(info => { if (info) { ctx.toast(tx('rec.recovered')); draw(); } }).catch(() => {});
  replace(el, h('div', { class: 'ex-run', lang: langAttr(), dir: dirAttr() },
    h('header', { class: 'ex-runhead' }, backLink(`#/exam/${n}`, t('exam.backTest', { n })), h('div', { class: 'ex-runhead-end' }, clock.el)),
    h('h1', { class: 'ex-run-title' }, def.name, h('span', { class: 'caption' }, ` · ${ex.topic}`)),
    tabs, content));
  draw();
  return {
    canLeave() { if (rec.recording) { ctx.toast(tx('rec.stopFirst')); return false; } return true; },
    unmount() {
      removeEventListener('beforeunload', guard); removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onVis);
      if (activeStop) activeStop(true); else rec.cancel();   // never drop a take on the way out
      stopCue(); clock.stop(!submitted); document.body.dataset.chrome = 'on';
    },
  };
}

