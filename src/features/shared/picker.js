/* The round size picker: before a Practice round of a list, a bottom sheet with three choices (domain/roundsize.js).
     1 Recommended  the list's own round (due first, new within today's allowance), with one line on why: default
     2 Custom       a stepper "of N in this list", 1 … N
     3 Practice all N
   It never slows the default path: Enter (or one tap on Start) takes the selected choice; pressing and holding a list
   starts Recommended at once; Today's buttons and the hub's Start round skip the sheet. A list with a paused round
   resumes it. The last choice per list type is remembered on this device (sizes.js).

   Keys: 1 2 3 choose, arrows change the number (and choose Custom), Enter starts, Esc closes. The sheet springs in
   (kit tokens; a fade under reduced motion), the number ticks as it changes. The sheet is a modal <dialog>, so focus
   stays in it and returns to the list after. */
import { h, replace, announce } from '../../core/dom.js';
import { haptic } from '../../core/motion.js';
import * as RS from '../../domain/roundsize.js';
import { listOf, listInfo, remembered, remember, sizedHref } from './sizes.js';

const HOLD_MS = 500;

/**
 * Give the round links inside a view the picker: a tap opens the sheet, a long press starts Recommended. Delegated
 * on the view's root, so links drawn later get it too. Returns a function that removes it.
 * @param {import('../contract.js').ViewCtx} ctx @param {HTMLElement} root
 */
export function pickerLinks(ctx, root) {
  let timer = /** @type {any} */ (null), held = /** @type {HTMLAnchorElement | null} */ (null), x0 = 0, y0 = 0;
  const linkOf = (/** @type {EventTarget | null} */ t) => {
    const a = /** @type {HTMLElement} */ (t)?.closest?.('a[href]');
    return a && root.contains(a) && listOf(a.getAttribute('href') || '') ? /** @type {HTMLAnchorElement} */ (a) : null;
  };
  const onClick = (/** @type {MouseEvent} */ e) => {
    const a = linkOf(e.target);
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (held === a) { held = null; return; }   // the long press already started it
    openPicker(ctx, a.getAttribute('href') || '', a);
  };
  const onDown = (/** @type {PointerEvent} */ e) => {
    const a = linkOf(e.target);
    if (!a || e.button !== 0) return;
    held = null; x0 = e.clientX; y0 = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { held = a; haptic(); ctx.go(sizedHref(a.getAttribute('href') || '', 'rec').slice(1)); }, HOLD_MS);
  };
  const cancel = () => clearTimeout(timer);
  const onMove = (/** @type {PointerEvent} */ e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); };
  const onMenu = (/** @type {Event} */ e) => { if (linkOf(e.target)) e.preventDefault(); };   // no link preview on a long press
  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('contextmenu', onMenu);
  root.classList.add('has-picker');
  return () => {
    cancel();
    root.removeEventListener('click', onClick); root.removeEventListener('pointerdown', onDown); root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', cancel); root.removeEventListener('pointercancel', cancel); root.removeEventListener('contextmenu', onMenu);
  };
}

/** Minutes of today's goal not yet studied. @param {import('../contract.js').ViewCtx} ctx */
function minutesLeft(ctx) {
  const day = ((ctx.store.get('activity', {}) || {})[ctx.clock.ctx().today]) || { minutes: 0 };
  return Math.max(0, Math.round((ctx.settings().minutesPerDay || 60) - (day.minutes || 0)));
}

/**
 * Open the sheet for a round address. A list with a paused round, or one that cannot be read, goes straight to the
 * round.
 * @param {import('../contract.js').ViewCtx} ctx @param {string} href @param {HTMLElement | null} [opener]
 */
export async function openPicker(ctx, href, opener = null) {
  const { t } = ctx;
  /** @type {import('./sizes.js').ListInfo | null} */ let info = null;
  try { info = await listInfo(ctx, href); } catch { info = null; }
  if (!info || info.paused != null || RS.total(info.b) === 0) { ctx.go(href.slice(1)); return; }
  const opts = RS.options(info.b, info.rec);
  const N = opts.N;
  const init = RS.initial(remembered()[info.type], N, opts.rec.n);
  let mode = init.mode, n = init.n;
  const left = minutesLeft(ctx);

  // ---------- the sheet ----------
  const title = h('h2', { class: 'rs-title', id: 'rs-title' }, info.title);
  const sub = h('p', { class: 'caption rs-sub tnum' }, t('practice.size.inList', { n: N }), info.b.due.length || info.b.fresh.length ? ` · ${t('practice.size.listDue', { due: info.b.due.length, fresh: info.b.fresh.length })}` : null);
  const r = opts.rec;
  const why = r.n === 0 ? t('practice.size.noneRec')
    : [r.due && r.fresh ? t('practice.size.why', { due: r.due, fresh: r.fresh }) : r.due ? t('practice.size.whyDue', { n: r.due }) : r.fresh ? t('practice.size.whyNew', { n: r.fresh }) : t('practice.size.whyEarly', { n: r.early }),
      info.minutes(r.n, r.fresh) <= left ? t('practice.size.fits', { min: left }) : t('practice.size.over', { min: info.minutes(r.n, r.fresh), left })].join(' ');
  const opt = (/** @type {string} */ k, /** @type {number} */ key, /** @type {any[]} */ kids, disabled = false) => h('button', { type: 'button', role: 'radio', class: 'rs-opt pressable', 'data-k': k, disabled,
    'aria-checked': 'false', tabindex: '-1', onclick: () => choose(/** @type {any} */ (k)) }, h('kbd', { class: 'rs-key', 'aria-hidden': 'true' }, String(key)), kids);
  const recBtn = opt('rec', 1, [h('span', { class: 'rs-main' }, h('span', { class: 'rs-name' }, t('practice.size.rec')), h('span', { class: 'rs-why' }, why)), h('span', { class: 'rs-n tnum' }, String(r.n))], r.n === 0);
  const input = /** @type {HTMLInputElement} */ (h('input', { class: 'rs-input tnum', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', enterkeyhint: 'go', autocomplete: 'off',
    'aria-label': t('practice.size.number', { n: N }), value: String(n) }));
  const tickEl = h('span', { class: 'rs-tick' }, input);
  const less = h('button', { type: 'button', class: 'rs-step pressable', 'aria-label': t('practice.size.less'), onclick: () => step(-1) }, '−');
  const more = h('button', { type: 'button', class: 'rs-step pressable', 'aria-label': t('practice.size.more'), onclick: () => step(1) }, '+');
  const customBtn = opt('custom', 2, [h('span', { class: 'rs-main' }, h('span', { class: 'rs-name' }, t('practice.size.custom')))]);
  const custom = h('div', { class: 'rs-row' }, customBtn,
    h('div', { class: 'rs-stepper', role: 'group', 'aria-label': t('practice.size.custom') }, less, tickEl, more, h('span', { class: 'caption rs-of tnum' }, t('practice.size.of', { n: N }))));
  const allBtn = opt('all', 3, [h('span', { class: 'rs-main' }, h('span', { class: 'rs-name' }, t('practice.size.all', { n: N })))]);
  const warn = h('p', { class: 'rs-warn', 'aria-live': 'polite' });
  const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable rs-start', autofocus: true, onclick: () => start() });
  const panel = h('div', { class: 'rs-panel' },
    h('div', { class: 'rs-grab', 'aria-hidden': 'true' }), title, sub,
    h('div', { class: 'rs-opts', role: 'radiogroup', 'aria-labelledby': 'rs-title' }, recBtn, custom, allBtn),
    warn, startBtn, h('p', { class: 'caption rs-tip' }, t('practice.size.tip')));
  const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'rs-sheet', 'aria-labelledby': 'rs-title' }, panel));
  document.body.append(dlg);

  /** The round the current choice makes. */
  const current = () => (mode === 'rec' ? { ids: r.ids, due: r.due, fresh: r.fresh, early: r.early, over: 0 } : mode === 'all' ? opts.all : opts.custom(n));
  function draw(/** @type {number} */ dir = 0) {
    for (const b of [recBtn, customBtn, allBtn]) { const on = b.dataset.k === mode; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.closest('.rs-row, .rs-opts > .rs-opt')?.classList.toggle('is-on', on); }
    custom.classList.toggle('is-on', mode === 'custom');
    if (document.activeElement !== input) input.value = String(n);
    less.toggleAttribute('disabled', n <= 1); more.toggleAttribute('disabled', n >= N);
    if (dir) { tickEl.classList.remove('is-up', 'is-down'); void tickEl.offsetWidth; tickEl.classList.add(dir > 0 ? 'is-up' : 'is-down'); }
    const cur = current();
    const q = cur.ids.length;
    replace(startBtn, t('practice.size.start', { n: q, min: info ? info.minutes(q, cur.fresh + cur.over) : 0 }), h('kbd', null, 'Enter'));
    startBtn.toggleAttribute('disabled', q === 0);
    const b = /** @type {RS.Buckets} */ (info && info.b);
    const allow = Number.isFinite(b.newLeft) ? b.newLeft : 0;
    replace(warn, cur.over ? [t(allow === 0 ? 'practice.size.addsNone' : b.daily ? 'practice.size.adds' : 'practice.size.addsRound', { n: cur.over, left: allow }), ' ', t('practice.size.scheduled')] : null);
    warn.hidden = !cur.over;
  }
  function choose(/** @type {'rec' | 'custom' | 'all'} */ k) {
    if (k === 'rec' && r.n === 0) return;
    mode = k; draw();
    announce(k === 'rec' ? t('practice.size.rec') : k === 'all' ? t('practice.size.all', { n: N }) : `${t('practice.size.custom')} ${n}`);
  }
  function step(/** @type {number} */ d) {
    const was = n;
    n = RS.clamp(n + d, N); mode = 'custom';
    draw(Math.sign(n - was));
  }
  input.addEventListener('focus', () => { mode = 'custom'; draw(); input.select(); });
  input.addEventListener('input', () => {
    const v = parseInt(input.value.replace(/\D/g, ''), 10);
    if (Number.isFinite(v)) { const was = n; n = RS.clamp(v, N); mode = 'custom'; draw(Math.sign(n - was)); }
  });
  input.addEventListener('blur', () => { input.value = String(n); });

  function start() {
    const cur = current();
    if (!cur.ids.length) return;
    remember(info?.type || 'list', { mode, n });
    close(() => ctx.go(sizedHref(href, mode === 'rec' ? 'rec' : mode === 'all' ? 'all' : n).slice(1)));
  }
  let closing = false;
  function close(/** @type {(() => void) | null} */ then = null) {
    if (closing) return;
    closing = true;
    dlg.classList.add('is-out');
    const done = () => { dlg.close(); dlg.remove(); if (then) then(); else opener?.focus({ preventScroll: true }); };
    const ms = parseFloat(getComputedStyle(dlg).getPropertyValue('--rs-out')) || 160;
    setTimeout(done, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms);
  }
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });   // a tap on the backdrop
  dlg.addEventListener('keydown', e => {
    const inInput = e.target === input;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); start(); return; }
    if (!inInput && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); choose(/** @type {any} */ (['rec', 'custom', 'all'][+e.key - 1])); if (e.key === '2') input.focus(); return; }
    if (['ArrowUp', 'ArrowRight'].includes(e.key) && (inInput || e.target instanceof HTMLButtonElement)) { e.preventDefault(); step(e.shiftKey ? 5 : 1); return; }
    if (['ArrowDown', 'ArrowLeft'].includes(e.key) && (inInput || e.target instanceof HTMLButtonElement)) { e.preventDefault(); step(e.shiftKey ? -5 : -1); }
  });
  draw();
  dlg.showModal();
  startBtn.focus({ preventScroll: true });
  // test hook (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__picker = { get mode() { return mode; }, get n() { return n; }, current, opts };
}
