/* The self-grade row (DESIGN.md components.grade4: Again / Hard / Good / Easy, one row of four, the interval under
   each). Word building's own copy of the kit control: features never import each other, so this mirrors Practice's
   selfgrade.js on the kit's classes (styles/components.css .grade4). Nothing is chosen before a tap; the suggestion
   is a small accent dot and takes the focus, so Enter picks it; keys 1 to 4 pick. */
import { h } from '../../core/dom.js';
import { haptic } from '../../core/motion.js';

/**
 * @param {{t: (k: string, v?: any) => string, label: string, when?: string[], suggest?: 1|2|3|4, onGrade: (g: 1|2|3|4) => void}} o
 */
export function gradeRow({ t, label, when = [], suggest = 3, onGrade }) {
  let locked = false;
  const name = (/** @type {number} */ g) => t(`build.grade.g${g}`);
  const btns = /** @type {HTMLButtonElement[]} */ ([1, 2, 3, 4].map(g => /** @type {HTMLButtonElement} */ (h('button', {
    type: 'button', class: ['grade4-b', 'pressable', g === suggest && 'is-suggested'], style: { '--i': String(g - 1) }, dataset: { g: String(g) },
    'aria-label': when[g - 1] ? t('build.grade.label', { grade: name(g), when: when[g - 1] }) : name(g),
    onclick: () => pick(/** @type {1|2|3|4} */ (g)),
  }, h('span', { class: 'grade4-name' }, name(g)), h('span', { class: 'grade4-when caption tnum' }, when[g - 1] || ''), h('kbd', null, String(g))))));
  const row = h('div', { class: 'grade4', role: 'group', 'aria-label': label }, btns);
  const el = h('div', { class: 'grade4-wrap' }, h('p', { class: 'label' }, label), row);
  // the buttons rise in on a stagger (styles/motion.css .grade4.is-in)
  requestAnimationFrame(() => requestAnimationFrame(() => row.classList.add('is-in')));
  /** @param {1|2|3|4} g */
  function pick(g) {
    if (locked) return;
    locked = true;
    haptic();
    btns.forEach((b, k) => { b.classList.toggle('is-picked', k === g - 1); b.classList.toggle('is-other', k !== g - 1); b.setAttribute('aria-pressed', String(k === g - 1)); if (k !== g - 1) b.disabled = true; });
    onGrade(g);
  }
  return {
    el,
    pick,
    focus() { btns[suggest - 1].focus({ preventScroll: true }); },
    /** Keys 1 to 4. @param {KeyboardEvent} e */
    key(e) { if (locked || !/^[1-4]$/.test(e.key) || e.metaKey || e.ctrlKey || e.altKey) return false; e.preventDefault(); pick(/** @type {1|2|3|4} */ (Number(e.key))); return true; },
    get locked() { return locked; },
  };
}
