/* Script mode: the full run (#/practice/scripts/<id>/run, SCRIPT-UX §3.9). Full screen. The whole script from cues,
   one card per section; Next records the split. The screen stays awake (Wake Lock where available). At the end a
   bar per section shows planned against actual time (motion moment 5: the bars rise in sequence, the total ticks),
   then one grade for the whole run and the sections he got stuck in. Stuck sections get Again on their section
   card; the others get the run's grade, at most Good. Runs stay on this device (SYNC_RUNS is false). Recording a
   run comes with record-and-compare in phase 2. */
import { h, replace, announce } from '../../core/dom.js';
import { countTo, reduced } from '../../core/motion.js';
import * as P from '../../domain/script/parse.js';
import * as St from '../../data/scripts.js';
import * as Lad from '../../domain/script/ladder.js';
import { fsCtx, runMinutes } from '../../domain/script/plan.js';
import { fullScreen, clockTime } from './ui.js';
import { gradeRow } from '../shared/selfgrade.js';
import { switchRow } from '../../core/ui.js';
import { addActivity } from '../shared/data.js';
import { WPM } from '../../domain/script/config.js';
import { langAttr, dirAttr } from '../../core/lang.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} script */
export function mountRun(el, ctx, script) {
  /** @type {((e: KeyboardEvent) => void) | null} */ let keyOff = null;
  const { t, store } = ctx;
  const restore = fullScreen();
  const c = ctx.clock.ctx();
  let target = runMinutes(script), notes = true, alive = true;
  /** @type {any} */ let lock = null;
  /** @type {number[]} */ const splits = [];
  let i = 0, t0 = 0, tick = 0;
  const words = script.sections.map((/** @type {any} */ s) => P.sectionWords(s));
  const total = words.reduce((a, b) => a + b, 0) || 1;
  const planned = () => words.map(w => (w / total) * target * 60000);

  function start() {
    replace(el, h('div', { class: 'sc-run stack' },
      h('div', { class: 'sc-rh-row' }, h('h1', null, t('practice.script.run.title')), h('a', { class: 'btn btn-quiet pressable sc-end', href: `#/practice/scripts/${script.id}` }, t('practice.script.end'))),
      h('p', { class: 'lead' }, t('practice.script.run.intro', { n: script.sections.length })),
      h('div', { class: 'form-field' }, h('label', { class: 'field-label', for: 'sc-target' }, t('practice.script.run.target')),
        h('div', { class: 'sc-target' }, h('input', { class: 'input tnum', id: 'sc-target', type: 'number', inputmode: 'numeric', min: 1, max: 120, value: String(target),
          onchange: (/** @type {Event} */ e) => { const v = Math.round(Number(/** @type {HTMLInputElement} */ (e.target).value)); if (v > 0) target = v; } }), h('span', { class: 'caption' }, t('practice.script.run.targetHint', { wpm: WPM })))),
      switchRow({ label: t('practice.script.run.notes'), checked: notes, onChange: v => { notes = v; } }),
      h('p', { class: 'caption' }, t('practice.script.run.private')),
      h('div', { class: 'sc-actions' }, h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable', onclick: () => go() }, t('practice.script.run.start')))));
  }

  // ---------- running ----------
  const timeEl = h('span', { class: 'tnum sc-runtime' });
  const fillEl = h('span', { class: 'fill' });
  const bar = h('div', { class: 'track sc-runbar', 'aria-hidden': 'true' }, fillEl);
  const cardEl = h('div', { class: 'sc-runcard' });
  const nextBtn = h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable', onclick: () => next() });
  async function go() {
    try { lock = await /** @type {any} */ (navigator).wakeLock?.request('screen'); } catch { lock = null; }
    t0 = performance.now(); i = 0; splits.length = 0;
    const plan = planned();
    let at = 0;
    const ticks = plan.slice(0, -1).map(ms => { at += ms; return h('i', { class: 'sc-tick', style: { left: `${(100 * at) / (target * 60000)}%` } }); });
    bar.append(...ticks);
    replace(el, h('div', { class: 'sc-run is-running' },
      h('div', { class: 'sc-rh-row' }, h('p', { class: 'sc-runclock' }, timeEl, h('span', { class: 'caption' }, ` / ${t('practice.script.run.about', { time: clockTime(target * 60000) })}`)),
        h('button', { type: 'button', class: 'btn btn-quiet pressable sc-end', onclick: () => abandon() }, t('practice.script.end'))),
      bar, h('h1', { class: 'sr-only' }, t('practice.script.run.title')), cardEl, h('div', { class: 'sc-actions sc-run-actions' }, nextBtn)));
    drawCard();
    tick = window.setInterval(clock, 500); clock();
  }
  function clock() {
    const ms = performance.now() - t0;
    timeEl.textContent = clockTime(ms);
    fillEl.style.setProperty('--p', String(Math.min(1, ms / (target * 60000))));
  }
  function drawCard() {
    const s = script.sections[i];
    const first = s.sentences[0];
    const cue = first?.en || `${String(first?.de || '').split(/\s+/).slice(0, 4).join(' ')} …`;
    const full = h('div', { class: 'sc-runfull', lang: langAttr(), dir: dirAttr(), hidden: true }, s.sentences.map((/** @type {any} */ x) => h('p', null, x.de)));
    replace(cardEl, h('p', { class: 'caption tnum' }, t('practice.script.run.of', { n: i + 1, total: script.sections.length })),
      h('p', { class: 'sc-runtitle' }, s.title),
      h('p', { class: 'prompt sc-runcue', lang: first?.en ? 'en' : 'de' }, cue),
      notes && s.note ? h('p', { class: 'caption' }, s.note) : null,
      h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-expanded': 'false', onclick: (/** @type {Event} */ e) => { full.hidden = !full.hidden; /** @type {HTMLElement} */ (e.currentTarget).setAttribute('aria-expanded', String(!full.hidden)); } }, t('practice.script.run.text')),
      full);
    nextBtn.textContent = i < script.sections.length - 1 ? t('practice.script.run.next') : t('practice.script.run.finish');
    announce(`${t('practice.script.run.of', { n: i + 1, total: script.sections.length })}: ${s.title}`);
  }
  function next() {
    splits.push(performance.now() - t0 - splits.reduce((a, b) => a + b, 0));
    if (i < script.sections.length - 1) { i++; drawCard(); return; }
    clearInterval(tick); release();
    done();
  }
  function abandon() { clearInterval(tick); release(); ctx.go(`/practice/scripts/${script.id}`); }
  function release() { try { lock?.release?.(); } catch { /* none */ } lock = null; }

  // ---------- the end ----------
  function done() {
    const ms = splits.reduce((a, b) => a + b, 0);
    const plan = planned();
    const max = Math.max(...plan, ...splits, 1);
    const totalEl = h('span', { class: 'figure tnum' }, '00:00');
    const bars = h('div', { class: 'runway sc-runbars', role: 'list', style: { '--n': String(script.sections.length), '--gap': script.sections.length > 20 ? '3px' : '6px' } },
      script.sections.map((/** @type {any} */ s, /** @type {number} */ k) => {
        const top = Math.max(plan[k], splits[k]);
        const p = Math.min(1, splits[k] / top);
        const fill = h('span', { style: { '--p': '0' } });
        const b = h('div', { class: 'runway-day', role: 'listitem', style: { '--i': String(k) }, 'aria-label': t('practice.script.run.barLabel', { section: s.title, actual: clockTime(splits[k]), planned: clockTime(plan[k]) }) },
          h('div', { class: 'runway-bar sc-runcol', style: { '--h': `${Math.round(24 + 72 * (top / max))}px` } }, fill, splits[k] > plan[k] ? h('i', { class: 'sc-plan', style: { bottom: `${(100 * plan[k]) / top}%` } }) : null),
          h('abbr', { title: s.title }, String(k + 1)));
        if (reduced()) fill.style.setProperty('--p', String(p)); else requestAnimationFrame(() => requestAnimationFrame(() => fill.style.setProperty('--p', String(p))));
        return b;
      }));
    const stuck = new Set();
    const rowG = gradeRow({ t, label: t('practice.script.run.how'), onGrade: g => grade(ms, g) });
    const chips = h('div', { class: 'chips sc-stuck', role: 'group', 'aria-labelledby': 'sc-stuck-h' }, script.sections.map((/** @type {any} */ s, /** @type {number} */ k) =>
      h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': 'false', onclick: (/** @type {Event} */ e) => { const b = /** @type {HTMLElement} */ (e.currentTarget); if (stuck.has(k)) stuck.delete(k); else stuck.add(k); b.setAttribute('aria-pressed', String(stuck.has(k))); } }, `${k + 1} ${s.title}`)));
    replace(el, h('div', { class: 'sc-run stack' },
      h('p', { class: 'label' }, t('practice.script.run.title')),
      h('h1', null, totalEl, h('span', { class: 'sc-runof' }, ` ${t('practice.script.run.target2', { time: clockTime(target * 60000) })}`)),
      bars,
      h('p', { class: 'caption sc-runlegend' }, t('practice.script.run.legend')),
      h('h2', { id: 'sc-stuck-h' }, t('practice.script.run.stuck')), chips,
      h('h2', null, t('practice.script.run.how')), rowG.el));
    rowG.set(['', '', '', '']);
    rowG.show({ focus: false });
    keyOff = (/** @type {KeyboardEvent} */ e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) rowG.key(e); };
    document.addEventListener('keydown', keyOff);
    countTo(totalEl, Math.round(ms / 1000), { from: 0, duration: 800, format: n => clockTime(n * 1000) });
    /** @param {number} total @param {1|2|3|4} g */
    function grade(total, g) {
      if (!alive) return;
      const cards = St.cardOf(store), cx = fsCtx(script, c.today);
      const prog = St.progress(store, script.id);
      script.sections.forEach((/** @type {any} */ s, /** @type {number} */ k) => {
        const p = Lad.blank(prog.sections?.[s.id]);
        if (p.step !== 'cue' || !p.done.cue) return;
        const id = Lad.srId(script.id, s.id), prev = cards(id)?.rec || null;
        const gg = /** @type {1|2|3|4} */ (stuck.has(k) ? 1 : Math.min(3, g));
        const r = Lad.rate(prev, gg, cx);
        St.saveReview(store, { id, rec: r.rec, prev, deck: St.DECK, g: gg, mode: 's', flags: 'run', ctx: cx, scriptId: script.id });
        if (gg === 1) St.updateProgress(store, script.id, x => ({ ...x, sections: { ...x.sections, [s.id]: Lad.graded(x.sections[s.id], s, 'cue', 1, c.today) } }));
      });
      St.updateProgress(store, script.id, x => ({ ...x, runs: [...(x.runs || []), { day: c.today, ms: Math.round(total), splits: splits.map(Math.round), grade: g, stuck: [...stuck] }].slice(-20) }));
      addActivity(store, c.today, { minutes: Math.min(60, total / 60000), kind: 'script' });
      setTimeout(() => ctx.go(`/practice/scripts/${script.id}`), reduced() ? 0 : 420);
    }
  }

  start();
  return () => { alive = false; clearInterval(tick); release(); restore(); if (keyOff) document.removeEventListener('keydown', keyOff); };
}
