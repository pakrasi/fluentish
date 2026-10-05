/* The word panel: one look for every card whose item is a single word (exam words, Word clusters, word-list cards,
   Quick sort). Data from domain/wordcard.js wordCard(); this file only draws it.
     wordMeta(card)   before the answer: "noun · B1 · ▮▮▮▯▯ common"
     wordPanel(card)  after the answer: the dictionary form, its key forms, one example with the word marked and
                      where it is from
   Built with h() (no markup from strings). German text carries lang="de". */
import { h } from './dom.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { freq } from '../domain/wordcard.js';

/** The 5-bar frequency meter and its label. @param {{bars: number, band: string}} f */
function meter(f) {
  return h('span', { class: 'wp-freq', role: 'img', 'aria-label': t('word.freq.aria', { band: t(`word.freq.${f.band}`) }) },
    h('span', { class: 'wp-bars', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map(k => h('span', { class: ['wp-bar', k <= f.bars && 'is-on'] }))),
    h('span', { 'aria-hidden': 'true' }, t(`word.freq.${f.band}`)));
}

/**
 * The line over a prompt: word type, level and how common it is.
 * @param {{type: string, level?: string | null, zipf?: number | null}} card
 */
export function wordMeta(card) {
  const f = freq(card.zipf);
  const parts = [h('span', { class: 'wp-type' }, t(`word.type.${card.type}`)), card.level ? h('span', { class: 'wp-level tnum' }, card.level) : null, f ? meter(f) : null].filter(Boolean);
  /** @type {any[]} */ const kids = [];
  parts.forEach((p, i) => { if (i) kids.push(h('span', { class: 'wp-dot', 'aria-hidden': 'true' }, '·')); kids.push(p); });
  return h('p', { class: 'wp-meta' }, kids);
}

/**
 * The panel after the answer.
 * @param {import('../domain/wordcard.js').WordCard} card
 * @param {{play?: ((text: string) => void) | null, head?: boolean, keep?: (e: Event) => void}} [o]  head: show the dictionary form (a typed card already shows it as the answer)
 */
export function wordPanel(card, { play = null, head = true, keep } = {}) {
  /** @type {any[]} */ const rows = [];
  if (head && !card.forms) rows.push(h('p', { class: 'wp-head', lang: 'de' }, card.head));
  if (card.forms) rows.push(h('p', { class: 'wp-forms', lang: 'de' }, card.forms));
  if (card.pres) rows.push(h('p', { class: 'wp-sub' }, h('span', { class: 'caption' }, t('word.pres')), ' ', h('span', { lang: 'de' }, card.pres)));
  if (card.type === 'noun' && (card.plural || card.pluralNote)) rows.push(h('p', { class: 'wp-sub' }, h('span', { class: 'caption' }, t('word.plural')), ' ',
    card.plural ? h('span', { lang: 'de' }, card.plural) : t(card.pluralNote === 'only' ? 'word.pluralOnly' : 'word.noPlural')));
  if (card.ex) {
    const [a, b] = card.exAt || [0, 0];
    const text = card.ex;
    const sentence = b > a ? [text.slice(0, a), h('mark', { class: 'wp-hl' }, text.slice(a, b)), text.slice(b)] : [text];
    const btn = play ? h('button', { type: 'button', class: 'pr-play pressable', 'aria-label': t('practice.word.play'), onpointerdown: keep || null, onclick: () => play(text) }, icon('play', { size: 16 })) : null;
    rows.push(h('div', { class: 'wp-ex' }, btn, h('div', null, h('p', { class: 'wp-ex-de', lang: 'de' }, sentence),
      card.exEn ? h('p', { class: 'caption' }, card.exEn) : null,
      card.exSrc ? h('p', { class: 'caption wp-src' }, card.exSrc) : null)));
  }
  if (card.conf) rows.push(h('p', { class: 'caption' }, card.conf));
  return h('div', { class: 'wp' }, rows);
}

