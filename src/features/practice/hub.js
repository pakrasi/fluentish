/* Practice hub (#/practice, UX §4.2): the queue card with Start round, missed items, mistakes from corrections,
   speaking, and the four areas with their recall bars. */
import { h, replace } from '../../core/dom.js';
import { section, linkRow, notice } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { fill, countTo } from '../../core/motion.js';
import { label, add, diff } from '../../core/clock.js';
import * as RD from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import * as C from './compose.js';
import { resumable } from './session.js';
import { loadData, stateFor, session, refreshWords, secrets, wordsState } from './data.js';
import { COLLECTION as WORDS } from './words.js';

const AREAS = ['speaking', 'grammar', 'reading', 'words'];
const pct = (/** @type {number} */ x) => `${Math.round(100 * (x || 0))} %`;

/** A recall bar: seen (quiet) under recall (ink). @param {number} recall @param {number} coverage @param {string} name */
export function recallBar(recall, coverage, name) {
  const r = Math.max(0, Math.min(1, recall || 0)), c = Math.max(r, Math.min(1, coverage || 0));
  const el = h('span', { class: 'track pr-bar', role: 'img', 'aria-label': name },
    h('span', { class: 'pr-seen', style: { '--p': String(c) } }), h('span', { class: 'fill' }));
  requestAnimationFrame(() => fill(el, r));
  return el;
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountHub(el, ctx) {
  const { t, store } = ctx;
  let alive = true, pending = /** @type {Promise<void> | null} */ (null);
  replace(el, h('div', { class: 'practice stack' }, h('div', { class: 'page-head' }, h('h1', null, t('practice.title'))), h('p', { class: 'caption' }, t('practice.loading'))));

  async function render() {
    let data;
    try { data = await loadData(ctx); } catch {
      if (alive) replace(el, h('div', { class: 'practice stack' }, h('div', { class: 'page-head' }, h('h1', null, t('practice.title'))), notice({ kind: 'warning', children: [h('p', null, t('practice.loadFailed'))] })));
      return;
    }
    if (!alive) return;
    const s = stateFor(ctx, data);
    const c = s.c, cards = s.cards;
    const rd = RD.compute({ pool: data.pool.filter((/** @type {any} */ it) => it.area !== 'mistakes'), store: cards, today: c.today, exam: c.exam, phase: c.phase, examSet: s.examSet });
    const dueN = s.dueN, newN = C.newLeft(s);
    const sess = session(store);
    const round = resumable(sess.round, c.today, Date.now()) ? sess.round : null;
    const firstTime = !Object.values(cards).some(r => r && r.hist && r.hist.length);
    const ids = round ? [] : C.compose(s);
    const left = round ? round.queue.length - round.i : 0;
    const nRound = round ? left : ids.length;
    const fc = RD.forecast(cards, c.today, 8);
    const tomorrow = fc[1]?.n || 0;

    // ---- queue card ----
    const dueEl = h('span', { class: 'figure tnum' }, String(dueN));
    const startLabel = round ? t('practice.finish', { n: left }) : c.phase === 'day' ? t('practice.startWarmup') : t('practice.start', { n: nRound, min: roundMinutes(nRound) });
    const startBtn = nRound ? h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/round', id: 'pr-start' }, startLabel) : null;
    const nextDue = Object.values(cards).filter(r => r && r.reps && r.due > c.today).map(r => r.due).sort()[0];
    const queue = h('div', { class: 'pr-queue' },
      h('div', { class: 'pr-queue-top' },
        h('p', { class: 'pr-due' }, dueEl, h('span', { class: 'label' }, t('practice.dueToday', { n: dueN }))),
        h('p', { class: 'label pr-new' }, c.newItems ? t('practice.newLeft', { n: newN }) : t('practice.noNew'))),
      c.phase !== 'none' || Object.keys(cards).length ? readyLine(rd, c) : null,
      nRound ? null : h('p', { class: 'pr-empty' }, nextDue ? t('practice.nothingNext', { date: label(nextDue) }) : t('practice.nothing')),
      startBtn ? h('div', { class: 'pr-queue-btn' }, startBtn) : null);

    // ---- notices ----
    const notices = [];
    const phaseKey = { lastNew: 'phase.lastNew', eve: 'practice.phase.eve', day: 'practice.phase.day' }[/** @type {string} */ (c.phase)];
    if (phaseKey) notices.push(notice({ children: [h('p', null, t(phaseKey, { n: dueN }))] }));
    if (!navigator.onLine) notices.push(notice({ children: [h('p', null, t('practice.offline'))] }));
    if (firstTime) notices.push(notice({ children: [h('p', { class: 'notice-title' }, t('practice.first.title')), h('p', null, t('practice.first.body')),
      matchMedia('(pointer: coarse)').matches ? h('p', null, t('practice.first.umlauts')) : null] }));

    // ---- rows ----
    const missedN = C.missed(s).length;
    const mistakes = data.pool.filter((/** @type {any} */ it) => it.area === 'mistakes');
    const mistakesOpen = mistakes.filter((/** @type {any} */ it) => C.unseen(s, it) || C.due(s, it)).length;
    const rows = [
      missedN ? linkRow({ href: '#/practice/round?kind=missed', title: t('practice.missed', { n: missedN }), detail: t('practice.missed.detail') }) : null,
      mistakes.length ? linkRow({ href: '#/practice/round?kind=mistakes', title: t('practice.mistakes', { n: mistakes.length }),
        detail: mistakesOpen ? t('practice.mistakes.open', { n: mistakesOpen }) : t('practice.mistakes.none') }) : null,
      linkRow({ href: '#/practice/speak', title: t('practice.speak'), detail: t('practice.speak.detail') }),
    ];

    // ---- areas ----
    const wc = store.get(WORDS, null);
    const areaRows = AREAS.map(a => {
      const x = rd.areas[a];
      const name = t(`practice.area.${a}`);
      if (a === 'words' && !x) {
        const tok = !!secrets(store).githubToken;
        return h('a', { class: 'pr-area pressable', href: '#/practice/words' },
          h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-trail tnum' }, tok ? (wc ? t('practice.words.status.none') : wordsState === 'error' ? t('practice.words.status.failed') : t('practice.words.status.loading')) : t('practice.words.status.notLinked'))),
          recallBar(0, 0, name), icon('next', { size: 16 }));
      }
      const trail = x && x.seen ? t('practice.area.trail', { pct: pct(x.recall), n: x.due }) : t('practice.area.notStarted');
      return h('a', { class: 'pr-area pressable', href: a === 'words' ? '#/practice/words' : `#/practice/round?kind=area:${a}`, 'aria-label': `${name}, ${trail}` },
        h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-trail tnum' }, trail)),
        recallBar(x ? x.recall : 0, x ? x.coverage : 0, t('practice.area.bar', { recall: pct(x?.recall || 0), seen: pct(x?.coverage || 0) })), icon('next', { size: 16 }));
    });

    // ---- pace and load ----
    const foot = [];
    if (c.phase === 'week' || c.phase === 'lastNew') {
      const starLeft = C.priorityLeft(s, s.examSet);
      const newDays = Math.max(1, diff(c.today, /** @type {string} */ (c.lastNewDay)) + 1);
      const rounds = Math.max(1, Math.ceil(Math.min(starLeft / newDays, s.newPerDay) / 4 + dueN / C.ROUND));
      foot.push(h('p', { class: 'caption' }, starLeft ? t('practice.pace', { n: rounds, min: rounds * 4, date: label(/** @type {string} */ (c.lastNewDay)) }) : t('practice.paceDone')));
    }
    const peak = fc.slice(1).filter(x => !c.exam || x.day < c.exam).sort((p, q) => q.n - p.n)[0];
    if (peak && peak.n >= 30 && c.phase !== 'after') foot.push(h('p', { class: 'caption' }, t('practice.peak', { date: label(peak.day), n: peak.n })));
    foot.push(h('p', { class: 'caption' }, t('practice.tomorrow', { n: tomorrow, date: label(add(c.today, 1)) })));

    const view = h('div', { class: ['practice', 'stack', startBtn && 'has-dock'] },
      h('div', { class: 'page-head' }, h('h1', null, t('practice.title')), h('span', { class: 'caption' }, t('practice.sub'))),
      notices, queue,
      h('nav', { class: 'pr-rows', 'aria-label': t('practice.more') }, rows),
      section(t('practice.areas'), h('div', { class: 'pr-areas' }, areaRows)),
      h('div', { class: 'pr-foot stack' }, foot),
      startBtn ? h('div', { class: 'dock' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/round', tabindex: '-1', 'aria-hidden': 'true' }, startLabel)) : null);
    const h1 = el.querySelector('h1');
    replace(el, view);
    if (h1 && document.activeElement === h1) view.querySelector('h1')?.focus({ preventScroll: true });
    countTo(dueEl, dueN, { from: 0, duration: 600 });
  }

  function readyLine(/** @type {any} */ rd, /** @type {any} */ c) {
    const exam = c.exam && c.phase !== 'after' && c.phase !== 'none';
    const name = exam ? t('practice.readyFor', { date: label(c.exam) }) : t('practice.readyNow');
    return h('div', { class: 'pr-ready' },
      h('p', { class: 'pr-ready-top' }, h('span', { class: 'label' }, name), h('b', { class: 'tnum' }, pct(rd.overall.recall))),
      recallBar(rd.overall.recall, rd.overall.coverage, t('practice.area.bar', { recall: pct(rd.overall.recall), seen: pct(rd.overall.coverage) })),
      h('p', { class: 'caption' }, t('practice.readySub', { seen: rd.overall.seen, n: rd.overall.n })));
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  await render();
  // exam words: at most one request every 10 minutes; a change rebuilds the pool
  if (secrets(store).githubToken) {
    refreshWords(ctx).then(res => {
      if (alive && res.state === 'error') rerender();
      if (!alive || res.state !== 'ok') return;
      if (res.added.length) ctx.toast(t('practice.words.addedToast', { n: res.added.length }));
    }).catch(() => {});
  }
  const offs = [store.subscribe('cards:b1', rerender), store.subscribe(WORDS, rerender), store.subscribe('mistakes', rerender), ctx.bus.on('settings:changed', rerender)];
  return () => { alive = false; offs.forEach(f => f()); };
}
