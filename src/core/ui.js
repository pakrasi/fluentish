/* Small view builders on top of h() and the kit classes, so screens read as structure, not markup. */
import { h } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './motion.js';

let uid = 0;
/** A unique id for label/input pairs. @param {string} [p] */
export const nextId = (p = 'f') => `${p}-${++uid}`;

/**
 * A titled section (hairline above, 40px gap: DESIGN.md Layout).
 * @param {string} title @param {...any} children
 */
export function section(title, ...children) {
  const id = nextId('s');
  return h('section', { class: 'section', 'aria-labelledby': id }, h('h2', { id }, title), ...children);
}

/**
 * Segmented control (kit .seg). Calls onChange(value) on a tap.
 * @param {{label: string, value: string, options: [string, string][], onChange: (v: string) => void}} o
 */
export function seg({ label, value, options, onChange }) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', { type: 'button', value: v, name: `${label}:${v}`, 'aria-pressed': String(v === value), class: 'pressable' }, text)));
  segmented(el, onChange);   // places the thumb again once the control has a size (ResizeObserver)
  return el;
}

/**
 * One choice from a few options as chips (kit .chip with aria-pressed). Used instead of <select>: WebKit's select
 * renders with an inline style that the CSP reports, and chips show every option at once on a phone.
 * @param {{label: string, value: string, options: [string, string, string?][], onChange: (v: string) => void, name?: string}} o
 *   options: value, text, optional lang for the text
 */
export function chipChoice({ label, value, options, onChange, name = label }) {
  const id = nextId('cc');
  const group = h('div', { class: 'chips', role: 'group', 'aria-labelledby': id },
    options.map(([v, text, lang]) => h('button', { type: 'button', class: 'chip pressable', name: `${name}:${v}`, lang: lang || null, 'aria-pressed': String(v === value),
      onclick: () => { for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(/** @type {HTMLButtonElement} */ (b).name === `${name}:${v}`)); onChange(v); } }, text)));
  return h('div', { class: 'form-field' }, h('p', { class: 'field-label', id }, label), group);
}

/**
 * A labelled form field with an optional hint and an error slot (aria-describedby wired).
 * @param {{label: string, input: HTMLElement, hint?: string | Node | null, id?: string}} o
 */
export function field({ label, input, hint = null, id = nextId() }) {
  input.id = input.id || id;
  const hintId = `${input.id}-hint`, errId = `${input.id}-err`;
  const err = h('p', { class: 'field-error', id: errId, role: 'alert', hidden: true });
  input.setAttribute('aria-describedby', [hint ? hintId : null, errId].filter(Boolean).join(' '));
  const wrap = h('div', { class: 'form-field' },
    h('label', { class: 'field-label', for: input.id }, label), input,
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null, err);
  return Object.assign(wrap, {
    /** @param {string | null} msg */
    setError(msg) { err.hidden = !msg; err.textContent = msg || ''; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); },
  });
}

/**
 * A row with a switch (input type=checkbox role=switch).
 * @param {{label: string, checked: boolean, hint?: string, onChange: (v: boolean) => void, disabled?: boolean}} o
 */
export function switchRow({ label, checked, hint, onChange, disabled = false }) {
  const id = nextId('sw');
  return h('div', { class: 'switch-row' },
    h('label', { for: id }, h('span', { class: 'switch-label' }, label), hint ? h('span', { class: 'caption' }, hint) : null),
    h('input', { type: 'checkbox', role: 'switch', id, class: 'switch', checked, disabled, onchange: (/** @type {Event} */ e) => onChange(/** @type {HTMLInputElement} */ (e.target).checked) }));
}

/**
 * A link row: title, detail, trailing text and a chevron.
 * @param {{href: string, title: string, detail?: string | null, trail?: string | null, lead?: Node | null}} o
 */
export function linkRow({ href, title, detail = null, trail = null, lead = null }) {
  return h('a', { class: 'row pressable', href },
    lead,
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), detail ? h('span', { class: 'row-detail' }, detail) : null),
    trail ? h('span', { class: 'row-trail tnum' }, trail) : null,
    icon('next', { size: 16 }));
}

/**
 * The back control at the top of a page, the same everywhere (round 8, B8): a chevron and the name of the page it
 * goes back to, on one line (an ellipsis when it is long), at least 44 px tall and wide. `narrow`: in a header that
 * shares its row with controls (the exam runner, the Map), below 400 px only the chevron shows and the name stays
 * the link's accessible name. Without href it is a button (onclick decides where it goes).
 * Style: styles/components.css "Back link".
 * @param {{href?: string, label: string, narrow?: boolean, onclick?: (e: MouseEvent) => void, onpointerdown?: (e: PointerEvent) => void}} o
 */
export function backLink({ href, label, narrow = false, onclick, onpointerdown }) {
  const attrs = { class: ['back-link', 'pressable', narrow && 'back-link-narrow'], 'aria-label': narrow ? label : null, onclick, onpointerdown };
  const kids = [icon('prev', { size: 16 }), h('span', { class: 'back-link-text' }, label)];
  return href ? h('a', { ...attrs, href }, ...kids) : h('button', { ...attrs, type: 'button' }, ...kids);
}

/**
 * A quiet inline notice with an icon (phase notes, import summary).
 * @param {{kind?: 'info' | 'warning', children: any[], id?: string}} o
 */
export function notice({ kind = 'info', children, id }) {
  return h('div', { class: `notice notice-${kind}`, role: 'note', id }, icon(kind === 'warning' ? 'warning' : 'info', { size: 18 }), h('div', { class: 'notice-body' }, ...children));
}

/** Initials for the avatar; empty name → null (an icon shows instead). @param {string} name */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** @param {{name: string}} profile @param {string} label */
export function avatar(profile, label) {
  const ini = initials(profile.name);
  return h('span', { class: 'avatar', 'aria-hidden': label ? null : 'true' }, ini || icon('user', { size: 18 }));
}
