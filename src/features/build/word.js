/* The word in the middle of the compass (and on the verb cards): a prefix and a stem as two pieces. A separable verb
   shows a joint (a thin line where it comes apart) and the stress dot under the prefix's vowel; an inseparable verb
   shows a weld (a line drawn under both pieces) and the dot under the stem's first vowel. Joint and weld are lines,
   never colour; the word's accessible name says where the stress is.

   Motion (PREFIX-DESIGN §8): the prefix flies from its chip onto the root (520 ms, ease-out, an 18 px arc). Separable:
   it lands with a 3 px settle (240 ms, spring-snappy) and the dot pops (420 ms, spring-pop). Inseparable: the 6 px gap
   closes (160 ms, ease-in), the weld line draws (240 ms, delay 120) and the dot pops (delay 260). Reduced motion: the
   word appears assembled. */
import { h } from '../../core/dom.js';
import { play, css, flyText } from './fx.js';
import { langAttr, dirAttr } from '../../core/lang.js';

const VOWELS = /(äu|au|ei|eu|ie|aa|ee|oo|[aeiouäöüy])/i;

/** Text with its first vowel group wrapped, so the stress dot sits under the stressed syllable. @param {string} s */
function stressed(s) {
  const m = VOWELS.exec(s);
  if (!m) return [s];
  return [s.slice(0, m.index), h('span', { class: 'wb-sv' }, m[0], h('span', { class: 'wb-dot', 'aria-hidden': 'true' })), s.slice(m.index + m[0].length)];
}

/**
 * @param {{pre?: string | null, stem: string, kind?: 's'|'i'|null, t: (k: string, v?: any) => string, big?: boolean}} o
 * @returns {HTMLElement}
 */
export function wordNode({ pre = null, stem, kind = null, t, big = false }) {
  if (!pre) return h('span', { class: ['wb-word', big && 'is-big'], lang: langAttr(), dir: dirAttr() }, h('span', { class: 'wb-pc wb-stem' }, stem));
  const sep = kind === 's';
  const label = t(sep ? 'build.word.stressPre' : 'build.word.stressStem', { word: `${pre}${stem}`, pre });
  return h('span', { class: ['wb-word', sep ? 'is-sep' : 'is-ins', big && 'is-big'], lang: langAttr(), dir: dirAttr(), role: 'img', 'aria-label': label },
    h('span', { class: 'wb-pc wb-pre', 'aria-hidden': 'true' }, sep ? stressed(pre) : pre),
    h('span', { class: 'wb-pc wb-stem', 'aria-hidden': 'true' }, sep ? stem : stressed(stem)),
    sep ? h('span', { class: 'wb-joint', 'aria-hidden': 'true' }) : h('span', { class: 'wb-weld', 'aria-hidden': 'true' }));
}

/**
 * The prefix flies from its chip onto the word and joins it (joint or weld). Resolves when it has landed.
 * @param {Element | null} from the chip @param {HTMLElement} word a wordNode with a prefix
 */
export async function joinFrom(from, word) {
  const pre = /** @type {HTMLElement | null} */ (word.querySelector('.wb-pre'));
  const dot = /** @type {HTMLElement | null} */ (word.querySelector('.wb-dot'));
  if (!pre) return;
  if (from) await flyText(from, pre, pre.textContent || '');
  if (word.classList.contains('is-sep')) {
    play(pre, [{ transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 240, easing: css('--spring-snappy') });
    play(dot, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, easing: css('--spring-pop') });
  } else weld(word);
}

/** The inseparable join: the gap closes, the weld line draws under both pieces, the dot pops on the stem. @param {HTMLElement} word */
export function weld(word) {
  play(word.querySelector('.wb-pre'), [{ transform: 'translateX(-6px)' }, { transform: 'none' }], { duration: 160, easing: css('--ease-in') });
  play(word.querySelector('.wb-weld'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 240, delay: 120, easing: css('--ease-out') });
  play(word.querySelector('.wb-dot'), [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, delay: 260, easing: css('--spring-pop') });
}

/**
 * An example sentence with the split-off particle underlined (separable verbs in a main clause).
 * @param {{ex: string, pre: string, kind: string}} v
 */
export function exampleNode(v) {
  const p = h('p', { class: 'wb-ex', lang: langAttr(), dir: dirAttr() });
  if (v.kind === 's') {
    const m = new RegExp(`(^|\\s)(${v.pre})([.!?,])`, 'u').exec(v.ex);
    if (m) {
      const i = m.index + m[1].length;
      p.append(v.ex.slice(0, i), h('span', { class: 'wb-part' }, v.pre), v.ex.slice(i + v.pre.length));
      return p;
    }
  }
  p.append(v.ex);
  return p;
}
