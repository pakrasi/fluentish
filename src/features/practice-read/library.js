/* Reading: the library (#/practice/read). In order: the review round of the words he saved, his own texts (last
   opened first), then the graded texts of the content, one level at a time (B1 · B2 · C1, his goal level first),
   each with its level, length and how much of it he knows on a 3 px meter, sorted by how well it fits him (fit.js:
   unread first, his study band first) with a check on the ones he has read. Literature (Kafka) says so. New text
   is the dock's button. */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { seg } from '../../core/ui.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import * as R from '../shared/read-data.js';
import { todayBudget } from '../../domain/allowance.js';
import { courseGoal } from '../../domain/levels.js';
import { back, pct } from './ui.js';
import { langOf } from './load.js';
import { fits, gradedTexts, slugOf } from './fit.js';

/** The graded level shown last (kept for the session). @type {string | null} */
let shownLevel = null;

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountLibrary(el, ctx) {
  const { t, store } = ctx;
  const lang = langOf(ctx);
  const deck = R.readDeck(lang);
  const graded = await gradedTexts(ctx, lang);
  /** @type {import('./fit.js').Fit[] | null} */ let fit = null;
  let alive = true;

  function render() {
    const c = ctx.clock.ctx();
    const s = ctx.settings();
    const list = R.listReads(store).filter(r => r.source?.kind !== 'graded');
    const words = R.savedWords(store);
    let b = null;
    try { b = todayBudget({ store, c, settings: s }); } catch { b = null; }
    const bk = R.readBuckets(store, c, deck, R.readNewLeft(/** @type {any} */ (b)));
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
    replace(el, h('div', { class: 'practice stack rd-lib has-dock' },
      back('#/practice', t('practice.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('read.title'))),
      reviewRow,
      list.length ? h('section', { class: 'section rd-own', 'aria-labelledby': 'rd-own' }, h('h2', { id: 'rd-own' }, t('read.own')), h('div', { class: 'rd-list' }, list.map(card)))
        : graded.length ? null : h('p', { class: 'lead' }, t('read.empty')),
      graded.length ? gradedSection(s) : null,
      list.length || !graded.length ? null : h('p', { class: 'caption' }, t('read.emptyOwn')),
      refN ? h('p', { class: 'caption' }, t('read.lib.ref', { n: refN })) : null,
      h('p', { class: 'caption rd-private' }, t('read.private')),
      h('div', { class: 'pr-queue-btn' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/read/new' }, t('read.new')))));
  }

  /** The graded texts of one level, sorted by fit. @param {any} s */
  function gradedSection(s) {
    const levels = /** @type {string[]} */ ([...new Set(graded.map((/** @type {any} */ x) => x.level))]).sort();
    const goal = courseGoal(s).goal;
    const level = shownLevel && levels.includes(shownLevel) ? shownLevel : levels.includes(goal || '') ? /** @type {string} */ (goal) : levels.includes(s.level) ? s.level : levels[0];
    const rows = fit ? fit.filter(f => f.level === level) : graded.filter((/** @type {any} */ x) => x.level === level).map((/** @type {any} */ x) => ({ id: x.id, slug: slugOf(x), title: x.title, level: x.level, words: x.words || 0, lit: !!x.source, coverage: null, band: null, read: false }));
    const below = ['A1', 'A2'].includes(String(s.level || '').toUpperCase());
    const row = (/** @type {any} */ f) => h('a', { class: ['row pressable rd-text-row', f.read && 'is-read'], href: `#/practice/read/lib/${encodeURIComponent(f.slug)}` },
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title', lang: langAttr(), dir: dirAttr() }, f.title),
        h('span', { class: 'row-detail tnum' }, [t(f.lit ? 'read.lib.lit' : 'read.lib.meta', { level: f.level, n: f.words }), f.coverage != null ? t('read.meta.known', { pct: pct(f.coverage) }) : null].filter(Boolean).join(' · ')),
        h('span', { class: 'rd-meter', 'aria-hidden': 'true' }, h('span', { class: 'rd-meter-fill', style: { transform: `scaleX(${(f.coverage ?? 0).toFixed(3)})` } }))),
      f.read ? h('span', { class: 'rd-read-mark' }, icon('check', { size: 16 }), h('span', { class: 'sr-only' }, t('read.lib.done'))) : null,
      icon('next', { size: 16 }));
    return h('section', { class: 'section rd-graded', 'aria-labelledby': 'rd-graded' },
      h('div', { class: 'rd-graded-head' }, h('h2', { id: 'rd-graded' }, t('read.graded')),
        levels.length > 1 ? seg({ label: t('read.lib.level'), value: level, options: levels.map(l => /** @type {[string, string]} */ ([l, l])), onChange: v => { shownLevel = v; render(); } }) : null),
      below ? h('p', { class: 'caption section-sub' }, t('read.lib.above', { level: s.level })) : fit ? h('p', { class: 'caption section-sub' }, t('read.lib.order')) : null,
      h('div', { class: 'rd-rows' }, rows.map(row)));
  }

  render();
  fits(ctx).then(f => { if (!alive) return; fit = f; render(); }).catch(() => {});
  const offs = [store.subscribe(R.READS, render), store.subscribe(R.WORDS, render), store.subscribe(`cards:${deck}`, render)];
  return () => { alive = false; offs.forEach(f => f()); };
}
