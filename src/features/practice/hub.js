/* Practice hub (#/practice, UX §4.2, round-2 IA): one list grouped by exam module.
     the queue card: reviews due today in every deck and new items left today (the one allowance,
       features/allowance.js: the same numbers as Today), with Start round (the same rounds as Today's plan row:
       features/day.js composes both)
     For the exam: Schreiben (with its recall bar), Sprechen (situations, Teil 2 talk, say it aloud), then missed
       items and mistakes from corrections when there are any
     Words: word clusters, exam words
     Your own material: scripts ("After the exam on …" while an exam is ahead)
     Areas: recall bars for the Sprechen phrases, grammar and the Lesen phrases */
import { h, replace } from '../../core/dom.js';
import { section, linkRow, notice } from '../../core/ui.js';
import { composeDay } from '../day.js';
import { icon } from '../../core/icons.js';
import { fill, countTo } from '../../core/motion.js';
import { label, add } from '../../core/clock.js';
import * as RD from '../../domain/b1ready.js';
import { ROUND_MIN } from '../../domain/budget.js';
import * as C from './compose.js';
import { todayBudget, roundAction, simToday } from './plan.js';
import { DECK as SIM_DECK, KV as SIM_KV } from './sim.js';
import { refreshSimStats } from './sim-data.js';
import { resumable, savedRound } from './session.js';
import { loadData, stateFor, session, refreshWords, secrets, wordsState } from './data.js';
import { COLLECTION as WORDS } from './words.js';
import { clusterToday } from './plan.js';
import { hubRow as scriptsRow } from './script/hub.js';

const AREAS = ['speaking', 'grammar', 'reading'];
const pct = (/** @type {number} */ x) => new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(x || 0);

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
    const rd = RD.compute({ pool: data.pool.filter((/** @type {any} */ it) => it.area !== 'mistakes'), store: cards, today: c.today, exam: c.exam, phase: c.phase });
    const b = todayBudget({ store, c, settings: ctx.settings(), t, exam: null });
    // the same two numbers as Today: every deck's reviews due today, and the day's new items left
    const dueN = b.reviews.due, newN = b.newLeft;
    // the review row as Today shows it, after Today's cut: one count of rounds for the row, the dock and this button
    const day = await composeDay(ctx, { prepare: false }).catch(() => null);
    if (!alive) return;
    const planRow = day ? day.plan.rows.find((/** @type {any} */ r) => r.id === 'practice.round' && !r.done) || null : null;
    const sess = session(store);
    const main = savedRound(sess, 'today');
    const round = resumable(main, c.today, Date.now()) ? main : null;
    const firstTime = !Object.values(cards).some(r => r && r.hist && r.hist.length);
    const ids = round ? [] : C.compose(s);
    const left = round ? round.queue.length - round.i : 0;
    const nRound = round ? left : ids.length;
    const fc = RD.forecast(cards, c.today, 8, c);
    const tomorrow = fc[1]?.n || 0;

    // ---- queue card ----
    const dueEl = h('span', { class: 'figure tnum' }, String(dueN));
    const startLabel = round ? finishLabel(round, left) : c.phase === 'day' ? t('practice.startWarmup') : roundAction({ rounds: planRow ? planRow.rounds || 1 : b.rounds }, nRound, t);
    const startBtn = nRound ? h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/round', id: 'pr-start' }, startLabel) : null;
    const nextDue = Object.values(cards).filter(r => r && r.reps).map(r => RD.dueOn(r, c)).filter(d => d > c.today).sort()[0];
    const queue = h('div', { class: 'pr-queue' },
      h('div', { class: 'pr-queue-top' },
        h('p', { class: 'pr-due' }, dueEl, h('span', { class: 'label' }, t('practice.dueAll', { n: dueN }))),
        h('p', { class: 'label pr-new' }, c.newItems ? t('practice.newLeft', { n: newN }) : t('practice.noNew'))),
      nRound ? null : h('p', { class: 'pr-empty' }, nextDue ? t('practice.nothingNext', { date: label(nextDue) }) : t('practice.nothing')),
      // the one Start button: in the card on a wide screen, docked above the tab bar on a phone (CSS only, one element)
      startBtn ? h('div', { class: 'pr-queue-btn' }, startBtn) : null);

    // ---- notices ----
    const notices = [];
    const phaseKey = { lastNew: 'phase.lastNew', eve: 'practice.phase.eve', day: 'practice.phase.day' }[/** @type {string} */ (c.phase)];
    if (phaseKey) notices.push(notice({ children: [h('p', null, t(phaseKey, { n: dueN }))] }));
    if (!navigator.onLine) notices.push(notice({ children: [h('p', null, t('practice.offline'))] }));
    if (firstTime) notices.push(notice({ children: [h('p', { class: 'notice-title' }, t('practice.first.title')), h('p', null, t('practice.first.body')),
      matchMedia('(pointer: coarse)').matches ? h('p', null, t('practice.first.umlauts')) : null] }));

    // ---- rows, grouped by exam module ("Speaking and writing" without an exam goal) ----
    const examGroup = ctx.settings().exam?.type ? t('practice.group.exam') : t('practice.group.speakWrite');
    const missedN = C.missed(s).length;
    const mistakes = data.pool.filter((/** @type {any} */ it) => it.area === 'mistakes');
    const mistakesOpen = mistakes.filter((/** @type {any} */ it) => C.unseen(s, it) || C.due(s, it)).length;
    const wb = s.budget.writing;
    const wr = rd.areas.writing;
    const writeDetail = wb && wb.due + wb.newLeft ? t(wb.focus ? 'practice.writeRow.focus' : 'practice.writeRow.detail', { due: wb.due, n: wb.newLeft }) : t('practice.writeRow.idle');
    const writeRow = barRow({ href: '#/practice/write', title: t('practice.writeRow'), detail: writeDetail, x: wr });
    const x = simToday({ store, c, settings: ctx.settings() });
    const speakDetail = x.due && x.newLeft ? t('practice.sim.detail', { due: x.due, fresh: x.newLeft }) : x.due ? t('practice.sim.detailDue', { n: x.due })
      : x.newLeft ? t('practice.sim.detailFresh', { n: x.newLeft }) : t('practice.speak.detail');
    const speakRow = linkRow({ href: '#/practice/speak', title: t('practice.speak'), detail: speakDetail });
    const cl = clusterToday({ store, c });
    const wordsArea = rd.areas.words;
    const tok = !!secrets(store).githubToken, wc = store.get(WORDS, null);
    const examRows = [
      writeRow, speakRow,
      missedN ? linkRow({ href: '#/practice/round?kind=missed', title: t('practice.missed', { n: missedN }), detail: t('practice.missed.detail') }) : null,
      mistakes.length ? linkRow({ href: '#/practice/round?kind=mistakes', title: t('practice.mistakes', { n: mistakes.length }),
        detail: mistakesOpen ? t('practice.mistakes.open', { n: mistakesOpen }) : t('practice.mistakes.none') }) : null,
    ];
    const wordRows = [
      linkRow({ href: '#/practice/clusters', title: t('practice.clusters.title'), detail: cl.due ? t('practice.clusters.rowDue', { n: cl.due }) : t('practice.clusters.rowDetail') }),
      linkRow({ href: '#/practice/build', title: t('practice.wordbuild.row'), detail: t('practice.wordbuild.rowDetail') }),
      barRow({ href: '#/practice/words', title: t('practice.area.words'), x: wordsArea,
        detail: wordsArea && wordsArea.seen ? t('practice.area.trail', { pct: pct(wordsArea.recall), n: wordsArea.due })
          : tok ? (wc ? t('practice.words.status.none') : wordsState === 'error' ? t('practice.words.status.failed') : t('practice.words.status.loading')) : t('practice.words.status.notLinked') }),
    ];

    // ---- areas ----
    const areaRows = AREAS.map(a => {
      const x = rd.areas[a];
      const name = t(`practice.area.${a}`);
      const trail = x && x.seen ? t('practice.area.trail', { pct: pct(x.recall), n: x.due }) : t('practice.area.notStarted');
      return h('a', { class: 'pr-area pressable', href: `#/practice/round?kind=area:${a}`, 'aria-label': `${name}, ${trail}` },
        h('span', { class: 'pr-area-top' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-trail tnum' }, trail)),
        recallBar(x ? x.recall : 0, x ? x.coverage : 0, t('practice.area.bar', { recall: pct(x?.recall || 0), seen: pct(x?.coverage || 0) })), icon('next', { size: 16 }));
    });

    // ---- pace and load: the same budget as Today's plan row ----
    const foot = [];
    const pace = s.budget.pace;
    if (pace) {
      const date = label(pace.lastNew);
      foot.push(h('p', { class: 'caption' }, !pace.left ? t('practice.paceDone')
        : pace.fits ? t('practice.pace', { n: Math.max(1, s.budget.rounds), min: Math.max(1, s.budget.rounds) * ROUND_MIN, date })
          : t('practice.paceShort', { reach: pace.reach, date })));
    }
    const peak = fc.slice(1).filter(x => !c.exam || x.day < c.exam).sort((p, q) => q.n - p.n)[0];
    if (peak && peak.n >= 30 && c.phase !== 'after') foot.push(h('p', { class: 'caption' }, t('practice.peak', { date: label(peak.day), n: peak.n })));
    foot.push(h('p', { class: 'caption' }, tomorrow ? t('practice.tomorrow', { n: tomorrow, date: label(add(c.today, 1)) }) : t('practice.tomorrowNone', { date: label(add(c.today, 1)) })));

    const view = h('div', { class: ['practice', 'stack', startBtn && 'has-dock'] },
      h('div', { class: 'page-head' }, h('h1', null, t('practice.title'))),
      notices, queue,
      section(examGroup, h('nav', { class: 'pr-rows', 'aria-label': examGroup }, examRows)),
      section(t('practice.group.words'), h('nav', { class: 'pr-rows', 'aria-label': t('practice.group.words') }, wordRows)),
      section(t('practice.group.own'), h('nav', { class: 'pr-rows', 'aria-label': t('practice.group.own') }, scriptsRow(store, c, t))),
      section(t('practice.areas'), h('div', { class: 'pr-areas' }, areaRows)),
      h('div', { class: 'pr-foot stack' }, foot));
    const h1 = el.querySelector('h1');
    replace(el, view);
    if (h1 && document.activeElement === h1) view.querySelector('h1')?.focus({ preventScroll: true });
    countTo(dueEl, dueN, { from: 0, duration: 600 });
  }

  /** A row that carries its area's recall bar (Schreiben, exam words). @param {{href: string, title: string, detail: string, x: any}} o */
  function barRow({ href, title, detail, x }) {
    return h('a', { class: 'pr-area pr-barrow pressable', href, 'aria-label': `${title}, ${detail}` },
      h('span', { class: 'pr-area-top' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-detail' }, detail))),
      recallBar(x ? x.recall : 0, x ? x.coverage : 0, t('practice.area.bar', { recall: pct(x?.recall || 0), seen: pct(x?.coverage || 0) })), icon('next', { size: 16 }));
  }

  /** "Finish round · 11 questions left", with the kind for rounds that are not the daily one. @param {any} round @param {number} left */
  function finishLabel(round, left) {
    const kind = round.kind === 'today' ? null : round.kind === 'area' ? t(`practice.area.${round.area}`) : round.kind === 'topic' ? t('practice.kind.topic') : t(`practice.kind.${round.kind}`);   // write: Schreiben
    return kind ? t('practice.finishKind', { n: left, kind }) : t('practice.finish', { n: left });
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  await render();
  refreshSimStats(ctx);
  // exam words: at most one request every 10 minutes; a change rebuilds the pool
  if (secrets(store).githubToken) {
    refreshWords(ctx).then(res => {
      if (alive && res.state === 'error') rerender();
      if (!alive || res.state !== 'ok') return;
      if (res.added.length) ctx.toast(t('practice.words.addedToast', { n: res.added.length }));
    }).catch(() => {});
  }
  const offs = [store.subscribe('cards:b1', rerender), store.subscribe(`cards:${SIM_DECK}`, rerender), store.subscribe(SIM_KV, rerender), store.subscribe(WORDS, rerender), store.subscribe('mistakes', rerender), ctx.bus.on('settings:changed', rerender), store.subscribe('scripts', rerender)];
  return () => { alive = false; offs.forEach(f => f()); };
}
