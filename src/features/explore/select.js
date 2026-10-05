/* Explore's select mode (Look up › Map and List): tap the words you know to mark them known, tap again to undo.
   The writes go through data/known.js (the one way to mark something known: S 60 days, one check in about 60 days,
   never a new item of the day); the map re-inks from the knowledge score as for any other change. The bar under the
   map has the level shortcuts, "All A1 known" and "All A2 known", which open Practice's spot check
   (#/practice/known/<level>?from=map: 10 random words typed; more than 2 misses and nothing is marked).
   Only words (W:) without a gap can be marked here. Index.js asks .on before it opens a word, and calls toggle(). */
import { h, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { num } from '../../core/i18n.js';
import { markWords, unmarkItems } from '../../data/known.js';

/**
 * @param {{ctx: any, A: any, page: HTMLElement, score: (i: number) => any, rescore: () => Promise<void> | void, stateKey: (i: number) => string, onOff?: () => void}} o
 *   score(i): the item's knowledge score; stateKey(i): its state for the lists ('known', 'today', …), after a rescore
 */
export function createSelect({ ctx, A, page, score, rescore, stateKey, onOff }) {
  const { t } = ctx;
  let on = false, n = 0;
  const btn = h('button', { type: 'button', class: 'ex-icon ex-selbtn pressable', 'aria-pressed': 'false', 'aria-label': t('explore.select.on'), title: t('explore.select.on'), onclick: () => set(!on) },
    icon('check', { size: 20 }));
  const countEl = h('span', { class: 'caption tnum ex-sel-count' });
  const levelLink = (/** @type {string} */ lv) => h('a', { class: 'btn pressable ex-sel-level', href: `#/practice/known/${lv}?from=map` }, t('explore.select.level', { level: lv }));
  const bar = h('div', { class: 'ex-selbar', role: 'group', 'aria-label': t('explore.select.on'), hidden: true },
    h('p', { class: 'ex-sel-top' }, h('b', null, t('explore.select.hint')), countEl),
    h('div', { class: 'ex-sel-actions' }, levelLink('A1'), levelLink('A2'), h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => set(false) }, t('explore.select.done'))));
  const draw = () => { countEl.textContent = n ? t('explore.select.count', { n, count: num(n) }) : ''; };

  /** @param {boolean} v */
  function set(v) {
    on = v;
    btn.setAttribute('aria-pressed', String(v));
    bar.hidden = !v;
    page.classList.toggle('is-select', v);
    if (v) { n = 0; draw(); announce(t('explore.select.hint')); }
    else onOff?.();
  }

  /**
   * Mark or unmark the word at index i. el: the List row's button, updated in place (the list is not re-drawn while
   * selecting, so open groups stay open).
   * @param {number} i @param {HTMLElement | null} [el]
   */
  async function toggle(i, el = null) {
    const id = A.ids[i];
    if (!id.startsWith('W:')) { ctx.toast(t('explore.select.wordsOnly')); return; }
    if (/[…()[\]]/.test(A.text[i])) { ctx.toast(t('explore.select.slot')); return; }
    const word = `${A.art[i] ? `${A.art[i]} ` : ''}${A.text[i]}`;
    const s = score(i);
    if (s && s.marked) {
      unmarkItems(ctx, [id]);
      n = Math.max(0, n - 1);
      announce(t('explore.select.unmarked', { word }));
    } else {
      // a few taps spread their checks over about ten days from day 60, so they never land on one day
      const res = markWords(ctx, [id.slice(2)], { batch: 200 });
      if (res.n) { n++; announce(t('explore.select.marked', { word })); }
    }
    draw();
    await rescore();
    if (el && el.isConnected) {
      const k = stateKey(i);
      el.setAttribute('aria-pressed', String(!!score(i)?.marked));
      const sw = el.querySelector('.ex-sw'); if (sw) sw.className = `ex-sw is-${k}`;
      const st = el.parentElement?.querySelector('.ex-lstate');
      if (st) { st.className = `caption ex-lstate is-${k}`; st.textContent = score(i)?.marked ? t('explore.state.marked') : t(`explore.state.${k}`); }
    }
  }

  return { btn, bar, toggle, set, get on() { return on; } };
}
