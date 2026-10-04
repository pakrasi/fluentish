/* Sprechen: 15 minutes of preparation with notes, then Teil 1 (planning with a partner whose lines are heard),
   Teil 2 (a presentation, slide by slide) and Teil 3 (the examiner's questions), one recording each.

   A recording is never lost: while it runs, the audio so far is written to IndexedDB every 2 seconds (data.js
   beginTake/keepTakeAudio), so a reload or a killed page keeps all but the last 2 seconds (recoverTake on the next
   start); a take the system ends on its own (a call, Siri, the screen locking) is saved with what was captured; the
   blob is written to IndexedDB with its file name before any upload, the upload is retried by the results sync until
   both files are in the repository, and "Save file" downloads it at any time. While a take runs, leaving the page
   asks first. */
import { h, replace, download } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createRecorder, RecorderError } from '../../services/recorder.js';
import { audioExt } from '../../data/sync/github-b1exam.js';
import { draft, saveDraft, submitAttempt, saveRecording, recordings, mediaUrl, sync, linked, beginTake, keepTakeAudio, endTake, recoverTake } from './data.js';
import { uuidv7 } from '../../data/ids.js';
import { clockBar, backLink, confirmPanel, arrowKeys } from './parts.js';
import { fmt } from './timer.js';
import { stampMs } from '../../domain/grade.js';

const PHASES = [['prep', 'Vorbereitung'], ['teil1', 'Teil 1'], ['teil2', 'Teil 2'], ['teil3', 'Teil 3'], ['done', 'Abgabe']];

/** @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, ex: any, def: any }} o */
export function runSprechen(el, ctx, { exam, n, ex }) {
  const { store, t } = ctx;
  document.body.dataset.chrome = 'off';
  const P = ex.sprechen;
  const st = { topic: 0, notes1: '', notes: '', phase: 'prep', recorded: /** @type {Record<string, boolean>} */ ({}), ...(draft(store, n, 'sprechen')?.answers || {}) };
  const save = () => saveDraft(store, n, 'sprechen', { answers: { ...st, recorded: { ...st.recorded } } });
  const rec = createRecorder();
  /** @type {HTMLAudioElement | null} */ let cueAudio = null;
  let recording = false;
  /** stop the take that is running, from outside its box (the page is being hidden) @type {((auto: boolean) => Promise<void>) | null} */
  let activeStop = null;
  /** write the take's audio so far now @type {(() => void) | null} */
  let flushTake = null;
  const clock = clockBar({ ctx, n, module: 'sprechen', minutes: 15, label: 'Vorb.' });
  const since = clock.clock.start;
  const tabs = h('div', { class: 'ex-tabs', role: 'tablist', 'aria-label': 'Teile' });
  arrowKeys(tabs);
  const content = h('div', { id: 'ex-panel', role: 'tabpanel' });
  const stopCue = () => { try { cueAudio?.pause(); } catch { /* none */ } cueAudio = null; };
  const setPhase = (/** @type {string} */ p) => {
    if (recording) { ctx.toast(t('exam.de.rec.stopFirst')); return; }
    stopCue();
    st.phase = p; save(); draw();
    scrollTo({ top: 0 });
  };
  const nav = (/** @type {string | null} */ prev, /** @type {string | null} */ next) => h('div', { class: 'ex-nav' },
    prev ? h('button', { type: 'button', class: 'btn pressable', onclick: () => setPhase(prev) }, t('exam.de.back')) : null,
    h('span', { class: 'ex-nav-grow' }),
    next ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => setPhase(next) }, t('exam.de.next')) : null);
  const notesArea = (/** @type {'notes1' | 'notes'} */ field, /** @type {string} */ ph) => {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'ex-write ex-notes', 'aria-label': 'Stichpunkte', placeholder: ph, spellcheck: 'false', autocorrect: 'off', lang: 'de',
      oninput: (/** @type {Event} */ e) => { st[field] = /** @type {HTMLTextAreaElement} */ (e.target).value; save(); } }));
    ta.value = st[field] || '';
    return ta;
  };
  const hidden = (/** @type {string} */ text) => {
    const box = h('p', { class: 'ex-cue-text', hidden: true }, text);
    const b = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { box.hidden = !box.hidden; b.textContent = box.hidden ? t('exam.de.showText') : t('exam.de.hideText'); } }, t('exam.de.showText'));
    return [b, box];
  };
  const playCue = (/** @type {string} */ url, /** @type {() => void} */ onEnd = () => {}) => {
    stopCue();
    cueAudio = new Audio(url);
    cueAudio.onended = onEnd;
    cueAudio.play().catch(() => { ctx.toast(t('exam.de.audioBlocked')); onEnd(); });
  };

  /** The recorder for one Teil. @param {string} part @param {string} label @param {string} hint */
  function recorderBox(part, label, hint) {
    const box = h('section', { class: 'ex-rec', 'aria-label': t('exam.de.rec.title') });
    const timeEl = h('span', { class: 'ex-rec-t tnum' });
    const status = h('p', { class: 'caption', 'aria-live': 'polite' });
    const list = h('ul', { class: 'ex-takes' });
    let t0 = 0;
    /** @type {any} */ let iv = null;
    const fileIn = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (f) keep(f, f.type || 'audio/mp4');
    } }));
    const startBtn = h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: start }, icon('record', { size: 18 }), t('exam.de.recStart'));
    const stopBtn = h('button', { type: 'button', class: 'btn btn-danger pressable', onclick: () => stop(false), hidden: true }, icon('stop', { size: 18 }), t('exam.de.recStop'));
    /** @type {string | null} */ let takeId = null;
    /** @type {Blob | null} */ let soFar = null;
    let savedAt = 0;
    const flush = () => { if (takeId && soFar) { savedAt = Date.now(); keepTakeAudio(store, takeId, soFar).catch(() => {}); } };
    const fileBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => fileIn.click() }, rec.supported ? t('exam.de.recFile') : t('exam.de.recFileOnly'));
    async function start() {
      try {
        const id = uuidv7(Date.now());
        await rec.start({
          onChunk: b => { soFar = b; if (Date.now() - savedAt >= 2000) flush(); },
          onEnded: () => { if (recording) stop(true); },
        });
        takeId = id; soFar = null; savedAt = 0;
        beginTake(store, { id, n, part, label, startedAt: Date.now() });
        activeStop = stop; flushTake = flush;
        recording = true; drawTabs();
        box.classList.add('is-on');
        startBtn.hidden = true; stopBtn.hidden = false;
        t0 = Date.now();
        iv = setInterval(() => { timeEl.textContent = fmt((Date.now() - t0) / 1000); }, 500);
        timeEl.textContent = '0:00';
        status.textContent = t('exam.de.rec.running');
      } catch (e) {
        status.textContent = e instanceof RecorderError && e.code === 'denied' ? t('exam.de.rec.denied') : t('exam.de.rec.unsupported');
      }
    }
    /** @param {boolean} auto the system ended the take, or the page is going away */
    async function stop(auto) {
      if (!recording) return;
      recording = false; activeStop = null; flushTake = null;
      clearInterval(iv);
      const id = takeId;
      try {
        const { blob, mime } = await rec.stop();
        if (await keep(blob, mime) && id) await endTake(store, id);
        if (auto) status.textContent = t('exam.de.rec.stoppedBySystem');
      } catch {
        status.textContent = t('exam.de.rec.empty');
        if (id) await endTake(store, id);
      }
      takeId = null;
      drawTabs();
      box.classList.remove('is-on');
      startBtn.hidden = false; stopBtn.hidden = true;
    }
    /** @param {Blob} blob @param {string} mime @returns {Promise<boolean>} whether the recording is stored */
    async function keep(blob, mime) {
      status.textContent = t('exam.de.rec.saving');
      let stored = false;
      try {
        await saveRecording(ctx, { n, part, label, blob, mime });
        stored = true;
        st.recorded[part] = true; save(); drawTabs();
        status.textContent = linked(store) ? t('exam.de.rec.savedSending') : t('exam.de.rec.savedLocal');
        setTimeout(drawList, 50);
        const r = await sync(ctx, true);
        status.textContent = !linked(store) ? t('exam.de.rec.savedLocal') : r.error ? t('exam.de.rec.notSentYet') : t('exam.de.rec.sentOk');
        drawList();
      } catch (e) {
        // the blob could not even be stored: offer the file right away so nothing is lost
        console.error(e);
        status.textContent = t('exam.de.rec.storeFailed');
        box.append(h('button', { type: 'button', class: 'btn pressable', onclick: () => download(blob, `test${n}-sprechen-${part}.${audioExt(mime)}`) }, icon('download', { size: 18 }), t('exam.de.rec.saveFile')));
      }
      return stored;
    }
    async function drawList() {
      const mine = recordings(store, n).filter(v => v.part === part && stampMs(v.created_at) >= since - 60e3);
      const items = await Promise.all(mine.map(async (v, i) => {
        const blob = v.blobRef ? await store.adapter.getBlob(v.blobRef).catch(() => null) : null;
        return h('li', null, h('span', { class: 'caption' }, `${t('exam.de.take', { n: i + 1 })} · ${v.sent ? t('exam.de.rec.sent') : t('exam.de.rec.notSent')}`),
          !v.sent ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: async () => { const r = await sync(ctx, true); ctx.toast(r.error ? t('exam.de.sendFailed', { why: r.error }) : t('exam.de.allSent')); drawList(); } }, t('exam.de.sendNow')) : null,
          blob ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => download(blob, `test${n}-sprechen-${part}-${i + 1}.${audioExt(blob.type)}`) }, t('exam.de.rec.saveFile')) : null);
      }));
      replace(list, items);
    }
    drawList();
    replace(box, h('div', { class: 'ex-rec-row' }, rec.supported ? startBtn : null, rec.supported ? stopBtn : null, h('span', { class: 'ex-rec-dot', 'aria-hidden': 'true' }), timeEl, fileBtn, fileIn),
      h('p', { class: 'caption', lang: 'de' }, hint), status, list);
    return box;
  }

  const drawTabs = () => replace(tabs, PHASES.map(([p, nm]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(st.phase === p), disabled: recording && st.phase !== p, class: 'ex-tab pressable', lang: 'de', onclick: () => setPhase(p),
  }, nm, p.startsWith('teil') ? h('span', { class: ['ex-dot', st.recorded[p] && 'is-full'], role: 'img', 'aria-label': st.recorded[p] ? t('exam.de.rec.has') : t('exam.de.rec.hasNot') }) : null)));

  function draw() {
    drawTabs();
    clock.el.hidden = st.phase !== 'prep';
    const instr = (/** @type {string} */ s) => h('p', { class: 'ex-instr', lang: 'de' }, s);
    let c;
    if (st.phase === 'prep') {
      c = h('div', { lang: 'de' }, instr(t('exam.de.prepIntro')),
        h('section', { class: 'ex-block' }, h('p', { class: 'label' }, 'Teil 1 · Gemeinsam etwas planen'), h('p', null, P.teil1.situation),
          h('ul', { class: 'ex-points' }, P.teil1.points.map((/** @type {string} */ p) => h('li', null, p))),
          h('p', { class: 'label' }, 'Stichpunkte Teil 1'), notesArea('notes1', 'Ideen, Vorschläge, Redemittel …')),
        h('section', { class: 'ex-block' }, h('p', { class: 'label' }, 'Teil 2 · Thema wählen'),
          h('div', { class: 'ex-opts', role: 'radiogroup', 'aria-label': 'Thema' }, P.teil2.topics.map((/** @type {string} */ tp, /** @type {number} */ i) => h('label', { class: 'ex-opt' },
            h('input', { type: 'radio', name: 'topic', checked: st.topic === i, onchange: () => { st.topic = i; save(); } }), h('span', { class: 'ex-opt-text' }, tp)))),
          h('p', { class: 'label' }, 'Die fünf Folien'), h('ol', { class: 'ex-points' }, P.teil2.folien.map((/** @type {string} */ f) => h('li', null, f))),
          h('p', { class: 'label' }, 'Stichpunkte Teil 2'), notesArea('notes', 'Folie 1: …\nFolie 2: …')),
        nav(null, 'teil1'));
    } else if (st.phase === 'teil1') {
      let idx = -1;
      const cueBox = h('div', { class: 'ex-cue', 'aria-live': 'polite' });
      const drawCue = (/** @type {boolean} */ playing) => idx < 0
        ? replace(cueBox, h('p', { class: 'caption' }, t('exam.de.partnerStarts')))
        : replace(cueBox, h('p', { class: 'caption' }, t('exam.de.cueOf', { i: idx + 1, n: P.teil1.partner_cues.length })), h('p', { class: 'ex-cue-state' }, playing ? t('exam.de.partnerSpeaks') : t('exam.de.yourTurn')), ...hidden(P.teil1.partner_cues[idx]));
      const step = (/** @type {number} */ dx) => { idx = Math.max(0, Math.min(P.teil1.partner_cues.length - 1, idx + dx)); drawCue(true); playCue(mediaUrl(exam, n, `s1-${idx + 1}.mp3`), () => drawCue(false)); };
      drawCue(false);
      c = h('div', { lang: 'de' }, instr(t('exam.de.t1')),
        h('section', { class: 'ex-block' }, h('p', null, P.teil1.situation), h('ul', { class: 'ex-points' }, P.teil1.points.map((/** @type {string} */ p) => h('li', null, p))),
          st.notes1 ? h('p', { class: 'caption ex-pre' }, st.notes1) : null),
        h('section', { class: 'ex-block' }, cueBox, h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn pressable', 'aria-label': t('exam.de.prevCue'), onclick: () => step(-1) }, icon('prev', { size: 18 })),
          h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => step(1) }, t('exam.de.nextCue')),
          h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => step(0) }, icon('replay', { size: 18 }), t('exam.de.again')))),
        recorderBox('teil1', String(P.teil1.situation).slice(0, 80), t('exam.de.rec1')),
        nav('prep', 'teil2'));
    } else if (st.phase === 'teil2') {
      let f = 0;
      const folie = h('div', { class: 'ex-folie' });
      const show = () => replace(folie, h('p', { class: 'caption' }, `Folie ${f + 1} von 5`), h('p', { class: 'ex-folie-t' }, String(P.teil2.topics[st.topic]).replace(/^Thema [AB]: /, '')), h('p', null, P.teil2.folien[f]));
      show();
      c = h('div', { lang: 'de' }, instr(t('exam.de.t2')), folie,
        h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: () => { f = Math.max(0, f - 1); show(); } }, '← Folie'), h('button', { type: 'button', class: 'btn pressable', onclick: () => { f = Math.min(4, f + 1); show(); } }, 'Folie →')),
        st.notes ? h('section', { class: 'ex-block' }, h('p', { class: 'label' }, 'Ihre Stichpunkte'), h('p', { class: 'ex-pre' }, st.notes)) : null,
        recorderBox('teil2', P.teil2.topics[st.topic], t('exam.de.rec2')),
        nav('teil1', 'teil3'));
    } else if (st.phase === 'teil3') {
      const qs = st.topic === 0 ? P.teil3.questions : P.teil3.questions_b;
      const prefix = st.topic === 0 ? 's3' : 's3b';
      c = h('div', { lang: 'de' }, instr(t('exam.de.t3')),
        h('section', { class: 'ex-block' }, qs.map((/** @type {string} */ q, /** @type {number} */ i) => h('div', { class: 'ex-item' },
          h('button', { type: 'button', class: 'btn pressable', onclick: () => playCue(mediaUrl(exam, n, `${prefix}-${i + 1}.mp3`)) }, icon('play', { size: 18 }), `Frage ${i + 1}`), ...hidden(q)))),
        recorderBox('teil3', P.teil2.topics[st.topic], t('exam.de.rec3')),
        nav('teil2', 'done'));
    } else {
      const missing = ['teil1', 'teil2', 'teil3'].filter(p => !st.recorded[p]);
      const confirmSlot = h('div');
      let busy = false;
      const finish = async () => {
        if (busy) return;
        busy = true;
        try {
          const notes = [st.notes1 ? `Teil 1:\n${st.notes1}` : '', st.notes || ''].filter(Boolean).join('\n\n');
          const cl = clock.clock;
          const r = await submitAttempt(ctx, { exam, n, module: 'sprechen', clock: cl, score: null, maxScore: 100,
            writings: notes ? [{ aufgabe: 'sprechen-notizen', text: notes, word_count: notes.split(/\s+/).filter(Boolean).length }] : [],
            meta: { topic: P.teil2.topics[st.topic], recorded: st.recorded } });
          clock.stop(false);   // only once the attempt is stored
          submitted = true;
          ctx.go(`/exam/${n}/sprechen/review/${r.id}`, { replace: true });
        } catch (e) { busy = false; console.error(e); ctx.toast(t('exam.de.submitFailed')); }
      };
      c = h('div', { lang: 'de' },
        h('section', { class: 'ex-block' }, h('p', { class: 'label' }, 'Aufnahmen'),
          h('p', null, ['teil1', 'teil2', 'teil3'].map(p => `${p.replace('teil', 'Teil ')} ${st.recorded[p] ? 'aufgenommen' : 'fehlt'}`).join(' · ')),
          h('p', { class: 'caption' }, t('exam.de.afterSubmit'))),
        h('div', { class: 'ex-nav' }, h('button', { type: 'button', class: 'btn pressable', onclick: () => setPhase('teil3') }, t('exam.de.back')), h('span', { class: 'ex-nav-grow' }),
          h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => replace(confirmSlot, confirmPanel({
            lang: 'de', title: missing.length ? t('exam.de.missingQ', { list: missing.map(p => p.replace('teil', 'Teil ')).join(' und ') }) : t('exam.de.submitQ', { module: 'Sprechen' }),
            lines: [t('exam.de.final')], yes: t('exam.de.submitSprechen'), no: t('exam.de.keepGoing'), onNo: () => replace(confirmSlot), onYes: finish,
          })) }, t('exam.de.submitSprechen'))),
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
  recoverTake(ctx).then(info => { if (info) { ctx.toast(t('exam.de.rec.recovered')); draw(); } }).catch(() => {});
  replace(el, h('div', { class: 'ex-run', lang: 'de' },
    h('header', { class: 'ex-runhead' }, backLink(`#/exam/${n}`, t('exam.backTest', { n })), h('div', { class: 'ex-runhead-end' }, clock.el)),
    h('h1', { class: 'ex-run-title' }, 'Sprechen', h('span', { class: 'caption' }, ` · ${ex.topic}`)),
    tabs, content));
  draw();
  return {
    canLeave() { if (rec.recording) { ctx.toast(t('exam.de.rec.stopFirst')); return false; } return true; },
    unmount() {
      removeEventListener('beforeunload', guard); removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onVis);
      if (activeStop) activeStop(true); else rec.cancel();   // never drop a take on the way out
      stopCue(); clock.stop(!submitted); document.body.dataset.chrome = 'on';
    },
  };
}

