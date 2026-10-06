/* Profile › Goals and week: the week editor (round 4 design review P0-2, spec §3A). The week reads as a week:
     - above, the same week strip as Today (brand.js weekStrip, plan mode): a bar per day, its height the day's minutes,
       its kind under it, so editing shows the shape Today will draw;
     - on a phone, seven 56 px rows ("Monday   45 min · Read  ›"); a row opens a bottom sheet with the minutes and the
       kinds as wrapped chips (the selected value is never scrolled out of sight), one line on the chosen kind, and
       ‹ Sunday / Tuesday › to step through the days without closing it;
     - from 720 px no sheet: the strip's columns are the days (a tab list) and the selected day's editor sits under it.
   A change writes at once and moves that column of the strip (brand.js weekStripUpdate: height on spring-soft, the
   label crossing over). Keyboard: the rows (or the columns) are one tab stop, the arrow keys move between days
   (roving tabindex), Home and End jump; Enter opens a day. The sheet is a modal <dialog>: Esc, the backdrop and × close
   it and the focus returns to the day's row. Every write goes through the page's setDay (data/settings.js). */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { reduced } from '../../core/motion.js';
import { weekStrip, weekStripUpdate } from '../../core/brand.js';
import { DAY_KINDS, LIVE_SLOTS, weekMinutes } from '../../domain/week.js';

/** The minute choices (a day's own value is added when it is not one of them). */
export const MINS = [0, 15, 20, 30, 45, 60, 90];
const WIDE = '(min-width: 720px)';

/**
 * @param {{t: (k: string, v?: any) => string, days: string[], week: () => {min: number[], kind: string[]},
 *   setDay: (i: number, change: {min?: number, kind?: string}) => void, fmt: (n: number) => string, onDone: () => void}} o
 *   days: the weekday names, Monday first; week(): the week as stored now; setDay writes one day; onDone: the editor's
 *   changes are settled (the sheet closed, or a change on a wide screen), so the page may refresh what depends on them
 * @returns {{el: HTMLElement, stop: () => void}}
 */
export function weekEditor({ t, days, week, setDay, fmt, onDone }) {
  const mq = matchMedia(WIDE);
  const later = (/** @type {string} */ k) => (k === 'read' || k === 'write' || k === 'talk') && !(/** @type {readonly string[]} */ (LIVE_SLOTS)).includes(k);
  const kindOf = (/** @type {{min: number[], kind: string[]}} */ w, /** @type {number} */ i) => (w.kind[i] === 'off' || !w.min[i] ? 'off' : w.kind[i]);
  const kindName = (/** @type {string} */ k) => t(`week.kind.${k}`);
  /** "45 min · Read", "Off", "45 min · Write (later)". */
  const dayText = (/** @type {{min: number[], kind: string[]}} */ w, /** @type {number} */ i) => {
    const k = kindOf(w, i);
    if (k === 'off') return kindName('off');
    return `${t('unit.min', { n: w.min[i] })} · ${kindName(k)}${later(k) ? ` ${t('week.laterShort')}` : ''}`;
  };

  let sel = 0;
  const strip = h('div', { class: 'runway wk-strip is-plan' });
  const sum = h('p', { class: 'label week-sum tnum', 'aria-live': 'polite' });
  const body = h('div', { class: 'week-ed-body' });
  const el = h('div', { class: 'week-ed' }, sum, h('div', { class: 'week-ed-strip' }, strip), body);
  /** @type {HTMLElement[]} */ let rows = [];
  /** @type {HTMLElement | null} */ let panel = null;

  const cols = () => {
    const w = week(), wide = mq.matches;
    return days.map((d, i) => {
      const k = kindOf(w, i);
      return { label: d.slice(0, wide ? 3 : 2), sub: wide ? (k === 'off' ? kindName('off') : `${w.min[i]} · ${kindName(k)}`) : k === 'off' || k === 'n' ? '' : kindName(k),
        plan: k === 'off' ? 0 : w.min[i], done: 0, today: false, aria: `${d}: ${dayText(w, i)}` };
    });
  };
  const sumText = () => t('week.sum', { t: fmt(weekMinutes(/** @type {any} */ (week()))) });

  function draw() {
    weekStrip(strip, cols(), { plan: true });
    sum.textContent = sumText();
    if (mq.matches) drawWide(); else drawRows();
  }

  /* ---------- phone: seven rows and a sheet ---------- */
  function drawRows() {
    strip.removeAttribute('role');
    strip.setAttribute('role', 'list');
    strip.setAttribute('aria-hidden', 'true');   // the rows say the same, in words
    const w = week();
    rows = days.map((d, i) => h('button', { type: 'button', class: 'week-row pressable', name: `week:day:${i}`, tabindex: i === sel ? '0' : '-1', 'aria-haspopup': 'dialog',
      onclick: () => { sel = i; roving(); openSheet(i); } },
      h('span', { class: 'week-row-day' }, d), h('span', { class: 'week-row-val tnum' }, dayText(w, i)), icon('next', { size: 16 })));
    const list = h('div', { class: 'week-rows', role: 'group', 'aria-label': t('week.title') }, rows);
    list.addEventListener('keydown', e => keys(e, rows, i => { sel = i; roving(); rows[i].focus(); }, ['ArrowDown', 'ArrowUp']));
    replace(body, list);
  }
  function roving() { rows.forEach((r, i) => { r.tabIndex = i === sel ? 0 : -1; }); }

  /** The arrow keys move between days. @param {KeyboardEvent} e @param {HTMLElement[]} items @param {(i: number) => void} go @param {string[]} [main] */
  function keys(e, items, go, main = ['ArrowRight', 'ArrowLeft']) {
    const i = items.indexOf(/** @type {HTMLElement} */ (e.target));
    if (i < 0) return;
    const next = e.key === main[0] || e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % items.length
      : e.key === main[1] || e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + items.length - 1) % items.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    go(next);
  }

  /** The chips of one day: minutes, then kinds, then a line on the kind. @param {number} i @param {() => void} after */
  function dayControls(i, after) {
    const w = week();
    const k = kindOf(w, i);
    const mins = [...new Set([...MINS, w.min[i]])].sort((a, b) => a - b);
    const change = (/** @type {{min?: number, kind?: string}} */ c) => {
      setDay(i, c);
      weekStripUpdate(strip, cols(), i);
      [...strip.children].forEach((c, k) => c.classList.toggle('is-sel', mq.matches && k === sel));
      sum.textContent = sumText();
      if (rows[i]) /** @type {HTMLElement} */ (rows[i].querySelector('.week-row-val')).textContent = dayText(week(), i);
      after();
    };
    return [
      h('p', { class: 'field-label', id: `wk-m-${i}` }, t('week.minutesLabel')),
      h('div', { class: 'chips week-chips', role: 'group', 'aria-labelledby': `wk-m-${i}` }, mins.map(m => h('button', { type: 'button', class: 'chip tnum pressable', name: `week:${i}:min:${m}`,
        'aria-pressed': String(k === 'off' ? m === 0 : w.min[i] === m), onclick: () => change({ min: m }) }, m ? t('unit.min', { n: m }) : kindName('off')))),
      k === 'off' ? null : h('p', { class: 'field-label', id: `wk-k-${i}` }, t('week.kindLabel')),
      k === 'off' ? null : h('div', { class: 'chips week-chips', role: 'group', 'aria-labelledby': `wk-k-${i}` }, DAY_KINDS.filter(x => x !== 'off').map(x => h('button', { type: 'button',
        class: ['chip', 'pressable', later(x) && 'is-later'], name: `week:${i}:kind:${x}`, 'aria-pressed': String(w.kind[i] === x), onclick: () => change({ kind: x }) },
      kindName(x), later(x) ? h('span', { class: 'week-later' }, ` ${t('week.laterShort')}`) : null))),
      h('p', { class: 'caption week-kind-line' }, later(k) ? t('week.later', { kind: kindName(k) }) : t(`week.kindHint.${k}`)),
    ];
  }

  /** The day's sheet (phone). @param {number} i0 */
  function openSheet(i0) {
    let i = i0, closing = false;
    const opener = rows[i0];
    const title = h('h2', { class: 'rs-title week-sheet-title', id: 'wk-sheet-t', tabindex: '-1' });
    const content = h('div', { class: 'week-sheet-body' });
    const prev = h('button', { type: 'button', class: 'btn btn-quiet pressable week-step', onclick: () => step(-1) });
    const next = h('button', { type: 'button', class: 'btn btn-quiet pressable week-step', onclick: () => step(1) });
    const x = h('button', { type: 'button', class: 'btn btn-quiet pressable week-sheet-x', 'aria-label': t('read.close'), onclick: () => close() }, icon('close', { size: 18 }));
    const panelEl = h('div', { class: 'rs-panel week-sheet' }, h('div', { class: 'rs-grab', 'aria-hidden': 'true' }),
      h('div', { class: 'week-sheet-head' }, title, x), content, h('div', { class: 'week-steps' }, prev, next));
    const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'rs-sheet', 'aria-labelledby': 'wk-sheet-t' }, panelEl));
    function fill() {
      title.textContent = days[i];
      replace(content, ...dayControls(i, () => fill()).filter(Boolean));
      const p = (i + 6) % 7, n = (i + 1) % 7;
      replace(prev, icon('prev', { size: 16 }), days[p]); prev.setAttribute('aria-label', t('week.stepTo', { day: days[p] }));
      replace(next, days[n], icon('next', { size: 16 })); next.setAttribute('aria-label', t('week.stepTo', { day: days[n] }));
    }
    function step(/** @type {number} */ d) {
      i = (i + d + 7) % 7; sel = i; roving();
      fill();
      announce(`${days[i]}: ${dayText(week(), i)}`);
    }
    function close() {
      if (closing) return;
      closing = true;
      dlg.classList.add('is-out');
      const done = () => { dlg.close(); dlg.remove(); (rows[i] || opener)?.focus({ preventScroll: true }); onDone(); };
      setTimeout(done, reduced() ? 0 : 160);
    }
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    fill();
    document.body.append(dlg);
    dlg.showModal();
    title.focus({ preventScroll: true });
  }

  /* ---------- from 720 px: the strip's columns are the days, the editor under it ---------- */
  function drawWide() {
    strip.removeAttribute('aria-hidden');
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', t('week.title'));
    const tabs = /** @type {HTMLElement[]} */ ([...strip.children]);
    tabs.forEach((c, i) => {
      c.setAttribute('role', 'tab');
      c.id = `wk-tab-${i}`;
      c.setAttribute('aria-controls', 'wk-panel');
      c.setAttribute('aria-selected', String(i === sel));
      c.tabIndex = i === sel ? 0 : -1;
      c.classList.toggle('is-sel', i === sel);
      c.onclick = () => pick(i);
    });
    strip.onkeydown = e => keys(e, tabs, i => { pick(i); tabs[i].focus(); });
    panel = h('div', { class: 'week-panel', id: 'wk-panel', role: 'tabpanel', 'aria-labelledby': `wk-tab-${sel}` });
    fillPanel();
    replace(body, panel);
  }
  function pick(/** @type {number} */ i) {
    sel = i;
    for (const [k, c] of [...strip.children].entries()) { c.setAttribute('aria-selected', String(k === i)); /** @type {HTMLElement} */ (c).tabIndex = k === i ? 0 : -1; c.classList.toggle('is-sel', k === i); }
    panel?.setAttribute('aria-labelledby', `wk-tab-${i}`);
    fillPanel();
  }
  function fillPanel() {
    if (!panel) return;
    const keep = /** @type {HTMLElement | null} */ (document.activeElement)?.getAttribute('name');
    replace(panel, h('p', { class: 'week-panel-title' }, days[sel]), ...dayControls(sel, () => { fillPanel(); onDone(); }).filter(Boolean));
    if (keep && panel.contains(document.activeElement) === false) /** @type {HTMLElement | null} */ (panel.querySelector(`[name="${CSS.escape(keep)}"]`))?.focus({ preventScroll: true });
  }

  const onMq = () => draw();
  mq.addEventListener('change', onMq);
  draw();
  return { el, stop: () => mq.removeEventListener('change', onMq) };
}
