/* A family form drawn as a word: the article lighter (72 %, ink-3), a separable verb's joint (a thin line where it
   comes apart), an inseparable verb's weld (a line under the word), and the stress dot under the stressed vowel.
   Joints and welds are drawn on verbs only: a noun never splits. The marks are aria-hidden; the word's name says
   them ("ausstellen, stress on aus, splits off"). Shared by the family view and Today's family. */
import { h } from '../../core/dom.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { piecesOf } from '../../domain/wordbuild-family.js';

const VOWELS = /(äu|au|ei|eu|ie|aa|ee|oo|[aeiouäöüy])/i;

/** Text with its first vowel group wrapped, so the stress dot sits under it (CSS, no measuring). @param {string} s */
export function stressed(s) {
  const m = VOWELS.exec(s);
  if (!m) return [s];
  return [s.slice(0, m.index), h('span', { class: 'fw-sv' }, m[0], h('span', { class: 'fw-dot', 'aria-hidden': 'true' })), s.slice(m.index + m[0].length)];
}

/** The word's accessible name. @param {import('../../domain/wordbuild-family.js').Form} f @param {(k: string, v?: any) => string} t */
export function wordName(f, t) {
  const pc = piecesOf(f);
  const at = f.stress === 'pre' && pc.pre.length ? pc.pre[pc.pre.length - 1].toLowerCase() : null;
  const parts = [`${f.art ? `${f.art} ` : ''}${f.word}`, at ? t('build.family.stressOn', { pre: at }) : null,
    f.cls === 'verb' && f.join === 's' ? t('build.family.splits') : f.cls === 'verb' && f.join === 'i' ? t('build.family.stays') : null];
  return parts.filter(Boolean).join(', ');
}

/**
 * @param {import('../../domain/wordbuild-family.js').Form} f
 * @param {{t: (k: string, v?: any) => string, cls?: string, marks?: boolean}} o  marks: joint, weld and stress dot
 */
export function formWord(f, { t, cls = '', marks = true }) {
  const pc = piecesOf(f);
  const verb = f.cls === 'verb';
  const sep = marks && verb && f.join === 's' && pc.pre.length > 0;
  const weld = marks && verb && f.join === 'i' && pc.pre.length > 0;
  const onPre = marks && f.stress === 'pre' && pc.pre.length > 0;
  const preText = pc.pre.join('');
  const rest = pc.base + pc.tail + pc.suf.join('');
  return h('span', { class: ['fw', sep && 'is-sep', weld && 'is-weld', cls], lang: langAttr(), dir: dirAttr(), role: 'img', 'aria-label': wordName(f, t) },
    f.art ? h('span', { class: 'fw-art', 'aria-hidden': 'true' }, f.art) : null,
    h('span', { class: 'fw-in', 'aria-hidden': 'true' },
      preText ? h('span', { class: 'fw-pre' }, onPre ? stressed(preText) : preText) : null,
      h('span', { class: 'fw-rest' }, marks && !onPre ? stressed(rest) : rest),
      weld ? h('span', { class: 'fw-weld' }) : null));
}
