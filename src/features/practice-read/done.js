/* Reading: the finish screen (#/practice/read/<id>/done). What he read (words, minutes, look-ups), the questions'
   score, the items he saved from this text, and what next: the reading round, "Learn to say it" (a copy of the text
   as a Retell script in Scripts, which turns it into something he can say), the library. A pasted text can be
   deleted here (features/shared/read-data.js deleteRead). */
import { h, replace } from '../../core/dom.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import * as St from '../../data/scripts.js';
import { idMaker } from '../../domain/script/parse.js';
import { doneHero } from '../shared/done-hero.js';
import * as R from '../shared/read-data.js';
import * as L from './logic.js';
import { sectionsFor, langOf } from './load.js';

/**
 * A reading text as a new Retell script (Scripts' record, data/scripts.js): a copy, so editing one never changes the
 * other. Returns the script id.
 * @param {any} store @param {any} read @param {any[]} sections @param {{profileId?: string | null, untitled: string}} o
 */
export function toScript(store, read, sections, { profileId = null, untitled }) {
  const id = idMaker()();
  const script = { id, v: 1, profileId, title: read.title || untitled, register: 'both', deliverOn: null, targetMin: null, status: St.canActivate(store) ? 'active' : 'paused',
    source: { format: 'de', wording: null }, sections: sections.map(s => ({ id: s.id, title: s.title || '', note: null, kind: 'retell',
      sentences: (s.sentences || []).map((/** @type {any} */ x) => ({ id: x.id, de: x.de, en: x.en || null, ...(x.p ? { p: true } : {}) })) })),
    marks: [], unmarked: [], forced: [], names: [], analysis: {}, flagged: [], createdAt: new Date().toISOString(), deletedAt: null };
  St.put(store, script);
  return id;
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} read */
export async function mountDone(el, ctx, read) {
  const { t, store } = ctx;
  const c = ctx.clock.ctx();
  const { sections } = await sectionsFor(ctx, read);
  R.updateProgress(store, read.id, p => ({ ...p, done: p.done || c.today, share: 1 }));
  const r = R.getRead(store, read.id) || read;
  const p = r.progress || {};
  const words = L.wordsIn({ sections });
  const ctxs = store.get(R.CTX, {}) || {};
  const ws = R.savedWords(store);
  const saved = Object.keys(ctxs).filter(id => ws[id] && (ctxs[id] || []).some((/** @type {any} */ x) => x.readId === r.id)).map(id => ws[id]);
  const deck = R.readDeck(langOf(ctx));
  const toReview = R.readBuckets(store, c, deck, Infinity);
  const list = saved.length ? h('ul', { class: 'rd-saved', lang: langAttr(), dir: dirAttr() }, saved.map((w, k) => h('li', { class: 'rd-saved-w', style: { '--i': String(Math.min(k, 12)) } }, w.head || w.lemma))) : null;
  const hero = doneHero({ label: t('read.done.label'), figure: words, of: t('read.done.of', { n: words }), level: 'h1', atmo: true,
    lines: [t('read.done.time', { min: Math.max(1, Math.round((p.ms || 0) / 60000)), looked: p.looked || 0 }), p.q ? t('read.q.score', { n: p.q.right, of: p.q.of }) : null,
      saved.length ? t('read.done.saved', { n: saved.length }) : null], data: list });
  const say = h('button', { type: 'button', class: 'btn pressable', onclick: () => {
    const id = toScript(store, r, sections, { profileId: ctx.app?.profile?.id || null, untitled: t('read.untitled') });
    ctx.go(`/practice/scripts/${id}`);
  } }, t('read.done.say'));
  replace(el, h('div', { class: 'practice pr-done stack rd-done', 'data-title': t('read.title') }, hero.el,
    h('div', { class: 'pr-done-actions' },
      toReview.due.length + toReview.fresh.length ? h('a', { class: 'btn btn-primary pressable', href: '#/practice/round?kind=read' }, t('read.round.start')) : null,
      say,
      h('a', { class: 'btn btn-quiet pressable', href: '#/practice/read' }, t('read.toLibrary'))),
    h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() }, r.title),
    h('p', { class: 'caption' }, t('read.done.sayHint')),
    // a pasted text can be deleted (its sentences leave this device and the error log; the saved words stay)
    r.source?.kind !== 'graded' ? h('div', { class: 'rd-tail' }, h('button', { type: 'button', class: 'btn btn-quiet pressable rd-delete', onclick: (/** @type {Event} */ e) => {
      const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = t('read.delete.sure'); return; }
      R.deleteRead(store, r.id);
      ctx.toast(t('read.delete.done'));
      ctx.go('/practice/read');
    } }, t('read.delete'))) : null));
  const stop = hero.start();
  requestAnimationFrame(() => list?.classList.add('is-in'));
  return () => stop();
}
