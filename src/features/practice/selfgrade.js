/* The one self-grade control (DESIGN.md components.grade4): Again / Hard / Good / Easy in one row of four, each
   with when the card comes back. Used by Speaking situations, Word clusters (say it aloud) and Scripts.

   - Nothing looks chosen before a tap: the suggestion (Good by default) is a small accent dot, and it takes the
     focus when the row appears, so Enter or Space picks it.
   - Keys 1 to 4 pick; the caller routes its keydown to row.key(e).
   - A pick runs the kit's pop spring on that button and steps the others back to 0.3; the row is then disabled
     until reset().
   - An optional caption line above the row says what the focused or hovered grade means (Scripts: "Stuck more
     than twice"). */
import { h } from '../../core/dom.js';
import { haptic } from '../../core/motion.js';

/**
 * @param {{t: (k: string, v?: any) => string, label: string, suggest?: 1|2|3|4, onGrade: (g: 1|2|3|4) => void,
 *   describe?: ((g: 1|2|3|4) => string) | null, names?: (g: 1|2|3|4) => string}} o
 */
export function gradeRow({ t, label, suggest = 3, onGrade, describe = null, names }) {
  const name = names || (g => t(`practice.grade.g${g}`));
  let sug = suggest, locked = false;
  const btns = /** @type {HTMLButtonElement[]} */ ([1, 2, 3, 4].map(g => /** @type {HTMLButtonElement} */ (h('button', {
    type: 'button', class: 'grade4-b pressable', style: { '--i': String(g - 1) }, dataset: { g: String(g) },
    onclick: () => pick(/** @type {1|2|3|4} */ (g)),
    onfocus: () => explain(/** @type {1|2|3|4} */ (g)), onpointerenter: () => explain(/** @type {1|2|3|4} */ (g)),
  }, h('span', { class: 'grade4-name' }, name(/** @type {1|2|3|4} */ (g))), h('span', { class: 'grade4-when caption tnum' }), h('kbd', null, String(g))))));
  const cap = describe ? h('p', { class: 'caption grade4-what', 'aria-live': 'polite' }) : null;
  const row = h('div', { class: 'grade4', role: 'group', 'aria-label': label }, btns);
  const el = h('div', { class: 'grade4-wrap', hidden: true }, cap, row);

  /** @param {1|2|3|4} g */
  function explain(g) { if (cap && describe) cap.textContent = describe(g); }

  /** @param {1|2|3|4} g */
  function pick(g) {
    if (locked || el.hidden) return;
    locked = true;
    haptic();
    btns.forEach((b, k) => { b.classList.toggle('is-picked', k === g - 1); b.classList.toggle('is-other', k !== g - 1); b.setAttribute('aria-pressed', String(k === g - 1)); });
    // keep the picked button focusable until the next card, so focus never drops to <body>
    btns.forEach((b, k) => { if (k !== g - 1) b.disabled = true; });
    onGrade(g);
  }

  return {
    el,
    /** The interval under each grade ("This round", "11 days"), and the accessible name. @param {string[]} when */
    set(when) {
      btns.forEach((b, k) => {
        /** @type {HTMLElement} */ (b.querySelector('.grade4-when')).textContent = when[k] || '';
        b.setAttribute('aria-label', when[k] ? t('practice.grade.label', { grade: name(/** @type {1|2|3|4} */ (k + 1)), when: when[k] }) : name(/** @type {1|2|3|4} */ (k + 1)));
      });
    },
    /** Show the row (buttons rise in on a stagger) and focus the suggestion. @param {{focus?: boolean, suggest?: 1|2|3|4}} [o] */
    show({ focus = true, suggest: s } = {}) {
      if (s) sug = s;
      btns.forEach((b, k) => b.classList.toggle('is-suggested', k === sug - 1));
      el.hidden = false;
      explain(sug);
      requestAnimationFrame(() => {
        row.classList.add('is-in');
        if (focus) btns[sug - 1].focus({ preventScroll: true });
      });
    },
    hide() { el.hidden = true; row.classList.remove('is-in'); },
    /** Back to unpicked and hidden, for the next card. */
    reset() {
      locked = false;
      btns.forEach(b => { b.classList.remove('is-picked', 'is-other'); b.removeAttribute('aria-pressed'); b.disabled = false; });
      this.hide();
    },
    pick,
    /** Route a keydown: 1 to 4 pick; returns true when handled. @param {KeyboardEvent} e */
    key(e) {
      if (el.hidden || locked || !/^[1-4]$/.test(e.key)) return false;
      e.preventDefault();
      pick(/** @type {1|2|3|4} */ (Number(e.key)));
      return true;
    },
    get open() { return !el.hidden && !locked; },
    get suggested() { return sug; },
    focus() { btns[sug - 1].focus({ preventScroll: true }); },
  };
}
