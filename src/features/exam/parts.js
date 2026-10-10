/* Building blocks shared by the exam screens: the clock bar, answer options, the confirm panel and small rows. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { backLink as uiBack } from '../../core/ui.js';
import * as T from './timer.js';
import { draft, saveDraft } from './data.js';
import { langAttr, dirAttr } from '../../core/lang.js';

/** The back link at the top of every exam screen ("‹ Test 3", core/ui.js). narrow: in the runner's header, only the
    chevron below 400 px. @param {string} href @param {string} text @param {{narrow?: boolean}} [o] */
export const backLink = (href, text, { narrow = false } = {}) => uiBack({ href, label: text, narrow });

/**
 * The module clock: shows time left (or time used for Hören), pauses and resumes, writes the last tick every 15 s,
 * pauses itself when the runner is left or the page is hidden for good. Announces 10, 5 and 1 minutes left.
 * @param {{ ctx: any, tx: import('./locale.js').ExamT, n: number, module: string, minutes: number, countUp?: boolean, label?: string,
 *           onChange?: (paused: boolean, leftMs: number) => void }} o   tx: the exam's strings
 */
export function clockBar({ ctx, tx, n, module, minutes, countUp = false, label = '', onChange }) {
  const { store } = ctx;
  let clock = /** @type {T.Clock} */ (draft(store, n, module)?.clock || T.begin(Date.now()));
  clock = T.reopen(clock, Date.now());
  const save = () => saveDraft(store, n, module, { clock });
  save();
  const text = h('span', { class: 'ex-clock-t tnum', role: 'timer', 'aria-live': 'off' });
  const btn = h('button', { type: 'button', class: 'btn btn-quiet ex-clock-btn pressable' });
  const el = h('div', { class: 'ex-clock' }, label ? h('span', { class: 'ex-clock-l', lang: langAttr(), dir: dirAttr() }, label) : null, text, btn);
  let lastSave = Date.now();
  const said = new Set();
  let stopped = false;
  const draw = (quiet = false) => {
    const now = Date.now();
    const leftMs = T.left(clock, now, minutes);
    const shown = countUp ? T.elapsed(clock, now) : leftMs;
    text.textContent = `${!countUp && leftMs < 0 ? '+' : ''}${T.fmt(shown / 1000)}`;
    const isLow = !countUp && leftMs < 5 * 60e3 && !T.paused(clock);
    el.classList.toggle('is-low', isLow);
    el.title = isLow ? tx('lowTime') : '';   // colour is never the only signal; the minute announcements say it too
    el.classList.toggle('is-paused', T.paused(clock));
    replace(btn, icon(T.paused(clock) ? 'play' : 'pause', { size: 18 }), h('span', { class: 'sr-only' }, T.paused(clock) ? tx('resume') : tx('pause')));
    btn.setAttribute('aria-label', T.paused(clock) ? tx('resume') : tx('pause'));
    if (!countUp && !T.paused(clock)) for (const m of [10, 5, 1]) {
      if (leftMs <= m * 60e3 && leftMs > (m * 60e3) - 2000 && !said.has(m)) { said.add(m); announce(tx('minutesLeft', { n: m })); }
    }
    if (!quiet) onChange?.(T.paused(clock), leftMs);
  };
  const tick = () => {
    if (stopped) return;
    const now = Date.now();
    if (!T.paused(clock) && now - lastSave > 15e3) { clock = T.tick(clock, now); lastSave = now; save(); }
    draw();
  };
  const api = {
    el,
    get clock() { return clock; },
    paused: () => T.paused(clock),
    pause(auto = false) { if (stopped) return; clock = T.pause(clock, Date.now(), auto); save(); draw(); },
    resume() { if (stopped) return; clock = T.resume(clock, Date.now()); lastSave = Date.now(); save(); draw(); },
    elapsed: () => T.elapsed(clock, Date.now()),
    left: () => T.left(clock, Date.now(), minutes),
    /** Stop ticking. keep=false after a submit (the draft is gone); keep=true pauses and saves first. @param {boolean} keep */
    stop(keep) { if (stopped) return; if (keep) { clock = T.pause(clock, Date.now(), true); save(); } stopped = true; clearInterval(iv); removeEventListener('pagehide', onHide); },
  };
  btn.onclick = () => (T.paused(clock) ? api.resume() : api.pause());
  const onHide = () => { if (!stopped) { clock = T.pause(clock, Date.now(), true); save(); ctx.store.flush?.(); } };
  addEventListener('pagehide', onHide);
  const iv = setInterval(tick, 1000);
  draw(true);                 // the caller's onChange runs from the next tick on (its handle is not assigned yet)
  queueMicrotask(() => { if (!stopped) draw(); });
  return api;
}

/**
 * One answer option in a radio group (the exam's language). In review the learner's choice and the solution are
 * marked with text, so it reads without colour.
 * @param {{ name: string, value: string, label: any, badge?: string, answers: Record<string, any>, review?: boolean, correct?: string | null,
 *           onPick?: (v: string) => void, t: (k: string) => string }} o   t: the exam's strings (exam.tx)
 */
export function option({ name, value, label, badge, answers, review = false, correct = null, onPick, t }) {
  const chosen = String(answers[name] ?? '').toLowerCase() === value.toLowerCase();
  const isRight = correct != null && String(correct).toLowerCase() === value.toLowerCase();
  const tag = review ? (isRight ? (chosen ? t('yourRight') : t('solution')) : chosen ? t('yourWrong') : null) : null;
  const input = h('input', { type: 'radio', name, value, checked: chosen, disabled: review, onchange: () => onPick?.(value) });
  return h('label', { class: ['ex-opt', review && chosen && 'is-mine', review && isRight && 'is-right', review && chosen && !isRight && 'is-wrong'] },
    input, badge ? h('span', { class: 'ex-opt-badge' }, badge) : null, h('span', { class: 'ex-opt-text' }, label),
    tag ? h('span', { class: 'ex-opt-tag' }, tag) : null);
}

/**
 * Arrow keys for a row of tabs or radio buttons: Left/Right (and Up/Down) move to the next enabled one and select it,
 * as a tablist or radiogroup should; only the selected one is a Tab stop.
 * @param {HTMLElement} group @param {string} [sel] the buttons
 */
export function arrowKeys(group, sel = 'button') {
  const sync = () => {
    const bs = /** @type {HTMLButtonElement[]} */ ([...group.querySelectorAll(sel)]);
    const cur = bs.find(b => b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-checked') === 'true') || bs.find(b => !b.disabled);
    for (const b of bs) b.tabIndex = b === cur ? 0 : -1;
  };
  group.addEventListener('keydown', e => {
    const k = /** @type {KeyboardEvent} */ (e).key;
    const step = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const bs = /** @type {HTMLButtonElement[]} */ ([...group.querySelectorAll(sel)]).filter(b => !b.disabled);
    const i = bs.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (i < 0) return;
    e.preventDefault();
    const next = bs[(i + step + bs.length) % bs.length];
    next.click();
    // the group may have been redrawn by the click: focus the button in the same place
    const again = /** @type {HTMLButtonElement[]} */ ([...group.querySelectorAll(sel)]).find(b => b.textContent === next.textContent) || next;
    sync(); again.focus();
  });
  new MutationObserver(sync).observe(group, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-checked'] });
  sync();
}

/** Item number as printed in the exam. @param {number} n */
export const num = n => h('span', { class: 'ex-num tnum' }, String(n));

/**
 * An inline confirm panel (no native dialogs): title, lines, a primary and a quiet action.
 * @param {{ title: string, lines?: any[], yes: string, no: string, onYes: () => any, onNo: () => void, danger?: boolean, lang?: string, dir?: string }} o
 */
export function confirmPanel({ title, lines = [], yes, no, onYes, onNo, danger = false, lang, dir }) {
  // focus goes back to what opened the panel when it closes with "no"
  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  const yesBtn = h('button', { type: 'button', class: ['btn', danger ? 'btn-danger' : 'btn-primary', 'pressable'], onclick: async () => { yesBtn.disabled = true; try { await onYes(); } finally { yesBtn.disabled = false; } } }, yes);
  const el = h('div', { class: 'ex-confirm', role: 'alertdialog', 'aria-modal': 'false', 'aria-labelledby': 'ex-confirm-t', lang: lang || null, dir: dir || null },
    h('p', { class: 'ex-confirm-title', id: 'ex-confirm-t' }, title),
    lines.map(l => h('p', { class: 'caption' }, l)),
    h('div', { class: 'row-actions' }, yesBtn, h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { onNo(); if (opener && opener.isConnected) opener.focus(); } }, no)));
  setTimeout(() => yesBtn.focus(), 30);
  return el;
}

/** A small status line: score or state, with a "New" mark for unread feedback. @param {string} text @param {{tone?: string, fresh?: string | null}} [o] */
export const statusText = (text, { tone = '', fresh = null } = {}) => h('span', { class: ['ex-status', tone && `is-${tone}`] }, text, fresh ? h('span', { class: 'ex-new' }, fresh) : null);

/** The four-segment status of a test: done/pass, submitted without score, open. @param {(string | null)[]} states 'pass' | 'fail' | 'sub' | null */
export const statusBar = states => h('span', { class: 'ex-sbar', 'aria-hidden': 'true' }, states.map(s => h('i', { class: s ? `is-${s}` : null })));
