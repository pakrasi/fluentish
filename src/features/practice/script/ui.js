/* Script mode: small view pieces shared by the screens. Kit classes and tokens only; motion from core/motion.js. */
import { h, replace } from '../../../core/dom.js';
import { icon } from '../../../core/icons.js';
import { reduced } from '../../../core/motion.js';
import { label } from '../../../core/clock.js';
import { t as tr } from '../../../core/i18n.js';
import * as D8 from '../../../domain/days.js';
import { stepsFor, blank } from './ladder.js';

/** "‹ Scripts" back link. @param {string} href @param {string} text */
export const back = (href, text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);

/** "1,940" in the interface locale. @param {number} n */
export const num = n => new Intl.NumberFormat('en-GB').format(n);

/**
 * A bottom sheet (<dialog>, modal). Esc, the backdrop and close() dismiss it; focus returns to the opener.
 * @param {{title: string, children: any[], onClose?: () => void, label?: string, cls?: string}} o
 */
export function sheet({ title, children, onClose, cls }) {
  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  const head = h('div', { class: 'sc-sheet-head' }, h('h2', { class: 'sc-sheet-title', lang: cls === 'sc-word-sheet' ? 'de' : null }, title),
    h('button', { type: 'button', class: 'btn btn-quiet pressable sc-sheet-x', 'aria-label': tr('practice.script.close'), onclick: () => close() }, icon('close', { size: 18 })));
  const body = h('div', { class: 'sc-sheet-body' }, children);
  const d = /** @type {HTMLDialogElement} */ (h('dialog', { class: ['sc-sheet', cls], 'aria-label': title }, head, body));
  document.body.append(d);
  let open = true;
  function close() {
    if (!open) return; open = false;
    d.classList.remove('is-in');
    const gone = () => { try { d.close(); } catch { /* closed */ } d.remove(); opener?.focus?.({ preventScroll: true }); onClose?.(); };
    if (reduced()) gone(); else setTimeout(gone, 160);
  }
  d.addEventListener('cancel', e => { e.preventDefault(); close(); });
  d.addEventListener('click', e => { if (e.target === d) close(); });
  d.showModal();
  requestAnimationFrame(() => d.classList.add('is-in'));
  return { el: d, body, close, set: (/** @type {any[]} */ ...kids) => replace(body, ...kids) };
}

/**
 * The step segments of a section: done ink, the current one accent.
 * @param {any} section @param {any} prog section progress
 */
export function stepSegs(section, prog) {
  const p = blank(prog), steps = stepsFor(section), cur = steps.indexOf(p.step);
  const atCue = p.step === 'cue' && !!p.done.cue;
  const el = h('span', { class: 'segments sc-segs', style: { '--n': String(steps.length) }, role: 'img' });
  steps.forEach((s, i) => el.append(h('i', { class: atCue || i < cur ? 'is-done' : i === cur ? 'is-now' : null, dataset: { step: s } })));
  return el;
}

/**
 * The script field (§5.2): one row per section, one cell per sentence, cell width by its words. Not started: outlined;
 * learning; known; known today (accent). aria-hidden: the figure and the section list carry the data.
 * @param {{rows: any[]}} r readiness() @param {{strip?: boolean}} [o]
 */
export function scriptField(r, { strip = false } = {}) {
  if (strip) {
    const row = h('span', { class: 'sc-cells sc-strip' });
    for (const x of r.rows) for (const w of x.cells) row.append(cell(w, x.state));
    return h('span', { class: 'sc-field is-strip', 'aria-hidden': 'true' }, row);
  }
  return h('div', { class: 'sc-field', 'aria-hidden': 'true' }, r.rows.map(x => h('div', { class: 'sc-frow', dataset: { section: x.id } },
    h('span', { class: 'sc-cells' }, x.cells.map((/** @type {number} */ w) => cell(w, x.state))), h('span', { class: 'sc-flabel' }, x.title))));
}
/** @param {number} w words @param {string} state */
const cell = (w, state) => h('i', { class: `sc-cell is-${state}`, style: { flexGrow: String(Math.max(1, w)), minWidth: '6px' } });

/**
 * A section's row in the field lands in accent, cell by cell (the kit's ripple timing and spring; reduced motion
 * draws the final state).
 * @param {HTMLElement} field @param {string} sectionId
 */
export function landRow(field, sectionId) {
  const row = field.querySelector(`[data-section="${CSS.escape(sectionId)}"]`);
  if (!row) return;
  const cells = [...row.querySelectorAll('.sc-cell')];
  cells.forEach((c, i) => { c.className = 'sc-cell is-today'; if (!reduced()) { /** @type {HTMLElement} */ (c).style.setProperty('--i', String(Math.min(i, 24))); c.classList.add('is-land'); } });
}

/**
 * "Talk Thu 12 Nov · 40 days" / "No delivery date".
 * @param {any} s script @param {string} today @param {(k: string, v?: any) => string} t
 */
export function dateLine(s, today, t) {
  if (!s.deliverOn) return t('practice.script.noDate');
  const d = D8.diff(today, s.deliverOn);
  if (d < 0) return t('practice.script.delivered', { date: label(s.deliverOn) });
  // "Talk Thu 12 Nov" for a script said word for word, "Tell it Thu 12 Nov" when every section is retold
  const retell = s.sections?.length && s.sections.every((/** @type {any} */ x) => x.kind === 'retell');
  if (d === 0) return t(retell ? 'practice.script.dateToday.retell' : 'practice.script.dateToday');
  return t(retell ? 'practice.script.dateLine.retell' : 'practice.script.dateLine', { date: label(s.deliverOn), n: d });
}

/** "Talk", "Retell" or "Talk and retell" from the sections. @param {any} s @param {(k: string) => string} t */
export function kindLine(s, t) {
  const k = new Set(s.sections.map((/** @type {any} */ x) => x.kind || 'talk'));
  return k.size > 1 ? t('practice.script.kind.mixed') : t(`practice.script.kind.${[...k][0] || 'talk'}`);
}

/** "ihr", "Sie" or "ihr and Sie". @param {any} s @param {(k: string) => string} t */
export const registerLine = (s, t) => t(`practice.script.register.${s.register || 'both'}`);

const SVG = 'http://www.w3.org/2000/svg';
/** The kit's check (motion.css .check, drawn with the pop spring). */
export function checkMark() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'check'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.append(p);
  return svg;
}

/** "07:42". @param {number} ms */
export const clockTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** Chrome off for a full-screen flow; returns the function that turns it back on. */
export function fullScreen() {
  document.body.dataset.chrome = 'off';
  document.body.classList.add('sc-full');
  return () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('sc-full'); };
}
