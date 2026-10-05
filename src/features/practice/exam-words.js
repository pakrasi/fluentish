/* Exam words (#/practice/words): where they come from (the private results repository), how many are in the queue,
   and a words round. The hub's Words group starts the round straight away; this page is for linking and updating. */
import { h, replace } from '../../core/dom.js';
import { notice } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { refreshWords, secrets, loadData, stateFor } from '../shared/data.js';
import { COLLECTION as WORDS, inQueue } from '../shared/words.js';
import * as RD from '../../domain/b1ready.js';

const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);

/** Exam words: where they come from, how many are in the queue, and a words round. @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountWords(el, ctx) {
  const { t, store } = ctx;
  let alive = true;
  const status = h('p', { class: 'caption', 'aria-live': 'polite' });
  async function render() {
    const tok = !!secrets(store).githubToken;
    const wc = store.get(WORDS, null);
    const c = ctx.clock.ctx();
    const data = await loadData(ctx).catch(() => null);
    if (!alive) return;
    const n = wc ? wc.words.filter((/** @type {any} */ w) => inQueue(w, c.phase)).length : 0;
    let card = null;
    if (data && n) {
      const s = stateFor(ctx, data);
      const x = RD.compute({ pool: data.pool.filter((/** @type {any} */ it) => it.area === 'words'), store: s.cards, today: c.today, exam: c.exam, phase: c.phase }).areas.words;
      if (x) card = h('p', { class: 'label' }, t('practice.words.state', { seen: x.seen, n: x.n, due: x.due }));
    }
    replace(el, h('div', { class: 'practice stack' }, back('#/practice', t('practice.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('practice.area.words'))),
      !tok && !wc ? [h('p', { class: 'lead' }, t('practice.words.notLinked')), h('a', { class: 'btn btn-primary pressable', href: '#/profile/connections' }, t('practice.words.link'))]
        : [h('p', { class: 'lead' }, wc ? t('practice.words.about', { n, total: wc.total || wc.words.length }) : t('practice.words.loading')),
          c.phase === 'week' || c.phase === 'lastNew' || c.phase === 'eve' ? h('p', { class: 'caption' }, t('practice.words.triage')) : null,
          card, status,
          h('div', { class: 'pr-done-actions' },
            n ? h('a', { class: 'btn btn-primary pressable', href: '#/practice/round?kind=area:words' }, t('practice.words.round')) : null,
            tok ? h('button', { type: 'button', class: 'btn pressable', onclick: () => refresh(true) }, t('practice.words.update')) : null),
          !tok ? notice({ children: [h('p', null, t('practice.words.cachedNoToken'))] }) : null]));
  }
  async function refresh(force = false) {
    status.textContent = t('practice.words.checking');
    const res = await refreshWords(ctx, { force });
    if (!alive) return;
    await render();
    const wc = store.get(WORDS, null);
    status.textContent = res.state === 'error' ? t('practice.words.failed', { why: res.error || '' })
      : res.added.length ? t('practice.words.added', { n: res.added.length, test: wc?.addedTest || '?' })
        : wc ? t('practice.words.updated') : '';
  }
  await render();
  if (secrets(store).githubToken) refresh(false);
  return () => { alive = false; };
}

