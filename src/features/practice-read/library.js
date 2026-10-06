/* Reading: the library (#/practice/read). His texts, last opened first, each with its level and how much of it he
   knows; the graded texts of the content when there are any; the review round of the words he saved; New text. */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import * as R from '../shared/read-data.js';
import { todayBudget } from '../../domain/allowance.js';
import { back, pct } from './ui.js';
import { langOf } from './load.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountLibrary(el, ctx) {
  const { t, store } = ctx;
  const lang = langOf(ctx);
  const deck = R.readDeck(lang);
  /** @type {any[]} */ let graded = [];
  try {
    const m = await ctx.content.manifest();
    if ((m.files || []).some((/** @type {any} */ f) => f.id === `read.${lang}`)) graded = ((await ctx.content.load(`read.${lang}`)) || {}).texts || [];
  } catch { graded = []; }

  function render() {
    const c = ctx.clock.ctx();
    const list = R.listReads(store).filter(r => r.source?.kind !== 'graded');
    const words = R.savedWords(store);
    let b = null;
    try { b = todayBudget({ store, c, settings: ctx.settings() }); } catch { b = null; }
    const bk = R.readBuckets(store, c, deck, R.readNewLeft(/** @type {any} */ (b), ctx.settings(), c, R.shownToday(store, deck, c.today)));
    const fresh = Math.min(bk.fresh.length, bk.newLeft);
    const ctxs = Object.values(store.get(R.CTX, {}) || {});
    const savedIn = (/** @type {string} */ id) => ctxs.filter((/** @type {any} */ l) => (l || []).some((/** @type {any} */ x) => x.readId === id)).length;
    const card = (/** @type {any} */ r) => {
      const p = r.progress || {};
      const read = Math.round((p.share || 0) * 100);
      const n = savedIn(r.id);
      return h('a', { class: 'rd-card pressable', href: `#/practice/read/${r.id}` },
        h('span', { class: 'rd-card-top' }, h('span', { class: 'row-title rd-card-title', lang: langAttr(), dir: dirAttr() }, r.title),
          r.estimate ? h('span', { class: ['rd-badge', `is-${r.estimate.band}`] }, t('read.level.about', { level: r.estimate.level })) : null),
        r.estimate ? h('span', { class: 'caption' }, t('read.lib.cov', { pct: pct(r.estimate.coverage), band: t(`read.band.${r.estimate.band}`) })) : null,
        h('span', { class: 'rd-meter', 'aria-hidden': 'true' }, h('span', { class: 'rd-meter-fill', style: { transform: `scaleX(${Math.min(1, (p.share || 0)).toFixed(3)})` } })),
        h('span', { class: 'caption tnum' }, [p.done ? t('read.lib.done') : t('read.lib.read', { pct: read }), n ? t('read.lib.saved', { n }) : null].filter(Boolean).join(' · ')));
    };
    const due = bk.due.length;
    const reviewRow = due + fresh ? h('a', { class: 'row pressable rd-review', href: '#/practice/round?kind=read' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('read.round.row')), h('span', { class: 'row-detail' }, t('read.round.detail', { due, fresh }))), icon('next', { size: 16 })) : null;
    const refN = Object.values(words).filter(w => w && w.ref).length;
    const levels = [...new Set(graded.map((/** @type {any} */ x) => x.level))];
    replace(el, h('div', { class: 'practice stack rd-lib has-dock' },
      back('#/practice', t('practice.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('read.title'))),
      reviewRow,
      list.length ? h('div', { class: 'rd-list' }, list.map(card)) : h('p', { class: 'lead' }, t('read.empty')),
      graded.length ? h('section', { class: 'section', 'aria-labelledby': 'rd-graded' }, h('h2', { id: 'rd-graded' }, t('read.graded')),
        levels.map(lv => h('div', { class: 'rd-list' }, graded.filter((/** @type {any} */ x) => x.level === lv).map((/** @type {any} */ x) =>
          h('a', { class: 'row pressable', href: `#/practice/read/lib/${encodeURIComponent(String(x.id).split('/').pop() || '')}` },
            h('span', { class: 'row-main' }, h('span', { class: 'row-title', lang: langAttr(), dir: dirAttr() }, x.title), h('span', { class: 'row-detail' }, t('read.graded.detail', { level: x.level, n: x.words || 0 }))),
            icon('next', { size: 16 })))))) : null,
      refN ? h('p', { class: 'caption' }, t('read.lib.ref', { n: refN })) : null,
      h('p', { class: 'caption rd-private' }, t('read.private')),
      h('div', { class: 'pr-queue-btn rd-dock' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/read/new' }, t('read.new')))));
  }
  render();
  const offs = [store.subscribe(R.READS, render), store.subscribe(R.WORDS, render), store.subscribe(`cards:${deck}`, render)];
  return () => offs.forEach(f => f());
}
