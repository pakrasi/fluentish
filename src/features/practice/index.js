/* Practice (UX §4.2, §4.3, §4.9): the one review queue and the practice around it. Owns #/practice and below:
     #/practice                        hub (hub.js)
     #/practice/round[?kind=…]         a round, full screen (round.js); kind: missed, mistakes, warmup, situation,
                                       area:<speaking|reading|grammar|words>, topic:<grammar topic>
     #/practice/speak[/teil2|/aloud[/check|/go]]   speaking (speak.js)
     #/practice/words                  exam words from the private results repository
     #/practice/write[/id]             not built yet: a short note
   Pure logic: pool.js, grade.js, compose.js, session.js, words.js (tested in node). Storage and network: data.js. */
import { h, replace } from '../../core/dom.js';
import { notice } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { mountHub } from './hub.js';
import { mountRound } from './round.js';
import { mountSpeak } from './speak.js';
import { refreshWords, secrets, loadData, stateFor } from './data.js';
import { COLLECTION as WORDS, inQueue } from './words.js';
import * as RD from '../../domain/b1ready.js';
import { warmVoices } from './speech.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const parts = (ctx.params.rest || '').split('/').filter(Boolean);
  warmVoices();
  if (parts[0] === 'round') return mountRound(el, ctx);
  if (parts[0] === 'speak') return mountSpeak(el, ctx, parts.slice(1));
  if (parts[0] === 'words') return mountWords(el, ctx);
  if (parts[0] === 'write') return mountWrite(el, ctx);
  return mountHub(el, ctx);
}

const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);

/** Exam words: where they come from, how many are in the queue, and a words round. @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
async function mountWords(el, ctx) {
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
      const x = RD.compute({ pool: data.pool.filter((/** @type {any} */ it) => it.area === 'words'), store: s.cards, today: c.today, exam: c.exam, phase: c.phase, examSet: null }).areas.words;
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

/** Writing practice is not part of this build yet. @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
function mountWrite(el, ctx) {
  const { t } = ctx;
  replace(el, h('div', { class: 'practice stack' }, back('#/practice', t('practice.title')),
    h('div', { class: 'page-head' }, h('h1', null, t('practice.write.title'))),
    notice({ children: [h('p', null, t('practice.write.later'))] }),
    h('a', { class: 'btn pressable', href: '#/exam' }, t('practice.write.toExam'))));
}
