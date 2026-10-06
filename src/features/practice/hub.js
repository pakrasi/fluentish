/* Practice hub (#/practice, UX §4.2; round 3, journey #8): what to do now, then three groups.
     the now card: the next row of today's plan (features/day.js composes it for Today and here, from the one daily
       allowance in domain/allowance.js) with its button; reviews due today in every deck and new items left today;
       the review round one tap away when the plan's next row is something else; a half-done round comes first
     Exam modules ("Skills" without an exam goal): Schreiben, Sprechen, Lesen phrases, grammar (the old Areas; the
       Sprechen phrases moved to the Sprechen page), then misses and mistakes from corrections when there are any
     Words: word clusters, Word building, exam words (a round; the list itself is in Look up)
     Your own material: scripts ("After the exam on …" while an exam is ahead)
   Each group opens and closes under its heading, with its due count beside it. A group with work today opens by
   itself; Words stays closed in the exam weeks unless cards are due (its new items pause then). */
import { h, replace } from '../../core/dom.js';
import { linkRow, notice, nextId } from '../../core/ui.js';
import { composeDay } from '../day.js';
import { recallBar } from '../shared/recall-bar.js';
import { icon } from '../../core/icons.js';
import { countTo, disclose } from '../../core/motion.js';
import { label, add } from '../../core/clock.js';
import * as RD from '../../domain/b1ready.js';
import { ROUND_MIN } from '../../domain/budget.js';
import * as C from '../shared/compose.js';
import { todayBudget, roundAction, simToday, clusterToday } from '../../domain/allowance.js';
import { DECK as SIM_DECK, KV as SIM_KV } from '../../domain/sim.js';
import { refreshSimStats } from '../shared/sim-data.js';
import { resumable, savedRound } from '../shared/session.js';
import { loadData, stateFor, session, refreshWords, secrets, wordsState, roundOf } from '../shared/data.js';
import { COLLECTION as WORDS } from '../shared/words.js';
import { hubRow as scriptsRow } from '../shared/script-row.js';
import { readRow, listReads } from '../shared/read-data.js';
import * as St from '../../domain/script/store.js';

const pct = (/** @type {number} */ x) => new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(x || 0);


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
    const rd0 = RD.compute({ pool: data.pool.filter((/** @type {any} */ it) => it.area !== 'mistakes'), store: cards, today: c.today, exam: c.exam, phase: c.phase });
    const rd = { ...rd0, areas: /** @type {Record<string, any>} */ (rd0.areas) };
    const b = todayBudget({ store, c, settings: ctx.settings() });
    // the same two numbers as Today: every deck's reviews due today, and the day's new items left
    const dueN = b.reviews.due, newN = b.newLeft;
    // the review row as Today shows it, after Today's cut: one count of rounds for the row, the dock and this button
    const day = await composeDay(ctx, { prepare: false }).catch(() => null);
    if (!alive) return;
    const planRow = day ? day.plan.rows.find((/** @type {any} */ r) => r.id === 'practice.round' && !r.done) || null : null;
    const sess = session(store, data.course ? roundOf(ctx).kv : 'b1.session');
    const main = savedRound(sess, 'today');
    const round = resumable(main, c.today, Date.now()) ? main : null;
    const firstTime = !Object.values(cards).some(r => r && r.hist && r.hist.length);
    const ids = round ? [] : C.compose(s);
    const left = round ? round.queue.length - round.i : 0;
    const nRound = round ? left : ids.length;
    const fc = RD.forecast(cards, c.today, 8, c);
    const tomorrow = fc[1]?.n || 0;

    // ---- what to do now: the next row of today's plan (features/day.js, the same plan Today shows) ----
    const prim = day && day.plan.primary ? day.plan.primary : null;
    // before his first answer the day's new items are the number (as on Today); after it, the reviews due
    const fresh = firstTime && !dueN && c.newItems;
    const figureN = fresh ? newN : dueN;
    const dueEl = h('span', { class: 'figure tnum' }, String(figureN));
    const roundLabel = round ? finishLabel(round, left) : c.phase === 'day' ? t('practice.startWarmup') : roundAction({ rounds: planRow ? planRow.rounds || 1 : b.rounds }, nRound, t);
    // the plan's next row leads unless a round is half done (finish it first) or the next row is the review round
    const lead = !round && prim && prim.id !== 'practice.round' && c.phase !== 'day' ? prim : null;
    const startBtn = lead
      ? h('a', { class: 'btn btn-primary btn-wide pressable', href: lead.href, id: 'pr-next' }, lead.action || (lead.minutes ? `${lead.title} · ${t('unit.min', { n: lead.minutes })}` : lead.title))
      : nRound ? h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/round', id: 'pr-start' }, roundLabel) : null;
    const nextDue = Object.values(cards).filter(r => r && r.reps).map(r => RD.dueOn(r, c)).filter(d => d > c.today).sort()[0];
    const queue = h('div', { class: 'pr-queue' },
      lead ? h('div', { class: 'pr-next' },
        h('p', { class: 'label' }, t('practice.now.next')),
        h('p', { class: 'pr-next-title' }, lead.title),
        lead.detail ? h('p', { class: 'caption' }, lead.detail) : null) : null,
      h('div', { class: 'pr-queue-top' },
        h('p', { class: 'pr-due' }, dueEl, h('span', { class: 'label' }, fresh ? t('practice.newFirst', { n: newN }) : t('practice.dueAll', { n: dueN }))),
        fresh ? null : h('p', { class: 'label pr-new' }, c.newItems ? t('practice.newLeft', { n: newN }) : t('practice.noNew'))),
      // the review round stays one tap away when the plan's next row is something else
      lead && nRound ? h('a', { class: 'btn btn-quiet pressable pr-round-link', href: '#/practice/round', id: 'pr-start' }, roundLabel) : null,
      nRound ? null : h('p', { class: 'pr-empty' }, nextDue ? t('practice.nothingNext', { date: label(nextDue) }) : t('practice.nothing')),
      // the one primary button: in the card on a wide screen, docked above the tab bar on a phone (CSS only, one element)
      startBtn ? h('div', { class: 'pr-queue-btn' }, startBtn) : null);

    // ---- notices ----
    const notices = [];
    const phaseKey = { lastNew: 'phase.lastNew', eve: 'practice.phase.eve', day: 'practice.phase.day' }[/** @type {string} */ (c.phase)];
    if (phaseKey) notices.push(notice({ children: [h('p', null, t(phaseKey, { n: dueN }))] }));
    if (!navigator.onLine) notices.push(notice({ children: [h('p', null, t('practice.offline'))] }));
    if (firstTime) notices.push(notice({ children: [h('p', { class: 'notice-title' }, t('practice.first.title')), h('p', null, t('practice.first.body')),
      matchMedia('(pointer: coarse)').matches && !data.course ? h('p', null, t('practice.first.umlauts')) : null] }));

    /** Put the page in, keeping focus on the heading, and count the figure up. @param {HTMLElement} view */
    const show = view => {
      const h1 = el.querySelector('h1');
      replace(el, view);
      if (h1 && document.activeElement === h1) view.querySelector('h1')?.focus({ preventScroll: true });
      countTo(dueEl, figureN, { from: 0, duration: 600 });
    };

    // ---- a course in another language (C3b): its review round, its phrases and words, the misses; the exam modules,
    //      the German word practice and scripts are German content ----
    if (data.course) {
      const opened = /** @type {Record<string, boolean>} */ ({ ...((store.get('ui', {}) || {}).practiceGroups || {}) });
      const areaRow = (/** @type {string} */ a, /** @type {string} */ key) => {
        const ar = rd.areas[a];
        return ar && ar.n ? barRow({ href: `#/practice/round?kind=area:${a}`, title: t(key), x: ar,
          detail: ar.seen ? t('practice.area.trail', { pct: pct(ar.recall), n: ar.due }) : t('practice.area.notStarted') }) : null;
      };
      const missedN = C.missed(s).length;
      const rows = [areaRow('speaking', 'course.area.phrases'), areaRow('words', 'course.area.words'),
        missedN ? linkRow({ href: '#/practice/round?kind=missed', title: t('practice.missed', { n: missedN }), detail: t('practice.missed.detail') }) : null];
      const due = (rd.areas.speaking?.due || 0) + (rd.areas.words?.due || 0);
      const foot = [h('p', { class: 'caption' }, tomorrow ? t('practice.tomorrow', { n: tomorrow, date: label(add(c.today, 1)) }) : t('practice.tomorrowNone', { date: label(add(c.today, 1)) })),
        h('p', { class: 'caption' }, t('course.germanParts'))];
      const view = h('div', { class: ['practice', 'stack', startBtn && 'has-dock'] },
        h('div', { class: 'page-head' }, h('h1', null, t('practice.title'))),
        notices, queue,
        practiceGroup({ id: 'course', title: t('course.group'), trail: due ? t('practice.group.due', { n: due }) : null, open: opened.course ?? true, rows }),
        h('div', { class: 'pr-foot stack' }, foot));
      show(view);
      return;
    }

    // ---- group 1, exam modules ("Skills" without an exam goal): Schreiben, Sprechen, Lesen phrases and grammar
    //      (the old Areas), then misses and mistakes from corrections when there are any ----
    const examGroup = ctx.settings().exam?.type ? t('practice.group.exam') : t('practice.group.speakWrite');
    const missedN = C.missed(s).length;
    const mistakes = data.pool.filter((/** @type {any} */ it) => it.area === 'mistakes');
    const mistakesOpen = mistakes.filter((/** @type {any} */ it) => C.unseen(s, it) || C.due(s, it)).length;
    const wb = s.budget.writing;
    const wr = rd.areas.writing;
    const writeDetail = wb && wb.due + wb.newLeft ? t(wb.focus ? 'practice.writeRow.focus' : 'practice.writeRow.detail', { due: wb.due, n: wb.newLeft }) : t('practice.writeRow.idle');
    const x = simToday({ store, c, settings: ctx.settings() });
    const speakDetail = x.due && x.newLeft ? t('practice.sim.detail', { due: x.due, fresh: x.newLeft }) : x.due ? t('practice.sim.detailDue', { n: x.due })
      : x.newLeft ? t('practice.sim.detailFresh', { n: x.newLeft }) : t('practice.speak.detail');
    // Conversation (round 4, practice-conversation): how many this week, read from its sessions (no import of the feature)
    const convRow = () => {
      const week = add(c.today, -6);
      const n = Object.values(store.get('conv.sessions', {}) || {}).filter((/** @type {any} */ x) => x && !x.deletedAt && x.turns > 0 && String(x.day || '') >= week).length;
      return linkRow({ href: '#/practice/conversation', title: t('conv.row'), detail: n ? t('conv.row.week', { n }) : t('conv.row.detail') });
    };
    const areaRow = (/** @type {string} */ a) => {
      const ar = rd.areas[a];
      return barRow({ href: `#/practice/round?kind=area:${a}`, title: t(`practice.area.${a}`), x: ar,
        detail: ar && ar.seen ? t('practice.area.trail', { pct: pct(ar.recall), n: ar.due }) : t('practice.area.notStarted') });
    };
    const examRows = [
      barRow({ href: '#/practice/write', title: t('practice.writeRow'), detail: writeDetail, x: wr }),
      linkRow({ href: '#/practice/speak', title: t('practice.speak'), detail: speakDetail }),
      convRow(),
      areaRow('reading'), areaRow('grammar'),
      missedN ? linkRow({ href: '#/practice/round?kind=missed', title: t('practice.missed', { n: missedN }), detail: t('practice.missed.detail') }) : null,
      mistakes.length ? linkRow({ href: '#/practice/round?kind=mistakes', title: t('practice.mistakes', { n: mistakes.length }),
        detail: mistakesOpen ? t('practice.mistakes.open', { n: mistakesOpen }) : t('practice.mistakes.none') }) : null,
    ];
    const examDue = (wb ? wb.due : 0) + x.due + (rd.areas.reading?.due || 0) + (rd.areas.grammar?.due || 0) + (rd.areas.speaking?.due || 0) + mistakesOpen;

    // ---- group 2, words: clusters, Word building, exam words (a round straight away; the list is in Look up) ----
    const cl = clusterToday({ store, c, settings: ctx.settings() });
    const bd = b.decks.build ? b.decks.build.due : 0;
    const wordsArea = rd.areas.words;
    const tok = !!secrets(store).githubToken, wc = store.get(WORDS, null);
    const examWords = wc ? (wc.words || []).length : 0;
    const wordsRow = !tok && !wc ? null   // nothing linked and nothing saved: no row (Profile › Connections links it)
      : examWords && wordsArea && wordsArea.n
        ? barRow({ href: '#/practice/round?kind=area:words', title: t('practice.area.words'), x: wordsArea,
          detail: wordsArea.seen ? t('practice.area.trail', { pct: pct(wordsArea.recall), n: wordsArea.due }) : t('practice.words.status.none', { n: examWords }) })
        : linkRow({ href: '#/lookup/words', title: t('practice.area.words'),
          detail: wc ? t('practice.words.status.none', { n: examWords }) : wordsState === 'error' ? t('practice.words.status.failed') : t('practice.words.status.loading') });
    const wordRows = [
      linkRow({ href: '#/practice/clusters', title: t('practice.clusters.title'), detail: cl.due ? t('practice.clusters.rowDue', { n: cl.due }) : t('practice.clusters.rowDetail') }),
      linkRow({ href: '#/practice/build', title: t('practice.wordbuild.row'), detail: bd ? t('practice.wordbuild.rowDue', { n: bd }) : t('practice.wordbuild.rowDetail') }),
      wordsRow,
    ];
    const wordsDue = cl.due + bd + (wordsArea ? wordsArea.due : 0);

    // ---- group 3, your own material: scripts ----
    const scriptsN = St.list(store).filter((/** @type {any} */ x) => x.status !== 'archived').length;

    // a group opens by itself when it has work today; the side decks rest while the exam is ahead (their new items
    // pause, domain/budget.js), so Words opens then only with cards due. His own choice on this device wins.
    const opened = /** @type {Record<string, boolean>} */ ({ ...((store.get('ui', {}) || {}).practiceGroups || {}) });
    const auto = { exam: true, words: wordsDue > 0 || b.mode !== 'exam', own: scriptsN > 0 || listReads(store).length > 0 || b.mode === 'maintenance' };
    const group = (/** @type {'exam' | 'words' | 'own'} */ id, /** @type {string} */ title, /** @type {number} */ due, /** @type {any[]} */ rows) =>
      practiceGroup({ id, title, trail: due ? t('practice.group.due', { n: due }) : null, open: opened[id] ?? auto[id], rows });

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
      group('exam', examGroup, examDue, examRows),
      group('words', t('practice.group.words'), wordsDue, wordRows),
      group('own', t('practice.group.own'), 0, [scriptsRow(store, c, t), linkRow(readRow(store, t))]),
      h('div', { class: 'pr-foot stack' }, foot));
    show(view);
  }

  /**
   * One group of rows under a heading that opens and closes it (kit motion: the rows grow in as the answer reveal
   * does; at once with reduced motion). The choice is kept on this device ('ui'.practiceGroups).
   * @param {{id: string, title: string, trail: string | null, open: boolean, rows: any[]}} o
   */
  function practiceGroup({ id, title, trail, open, rows }) {
    const panelId = nextId('prg');
    const panel = h('div', { class: ['reveal-answer', 'pr-group-panel', open && 'is-open'], id: panelId, inert: !open },
      h('div', null, h('nav', { class: 'pr-rows', 'aria-label': title }, rows)));
    const btn = h('button', { type: 'button', class: 'pr-group-head pressable', 'aria-expanded': String(open), 'aria-controls': panelId,
      onclick: () => {
        const now = btn.getAttribute('aria-expanded') !== 'true';
        disclose(btn, panel, now);
        store.update('ui', (/** @type {any} */ u) => ({ ...(u || {}), practiceGroups: { ...((u || {}).practiceGroups || {}), [id]: now } }), {});
      } },
      h('span', { class: 'pr-group-title' }, title),
      h('span', { class: 'row-trail tnum' }, trail || ''),
      icon('next', { size: 16 }));
    return h('section', { class: ['section', 'pr-group'], 'data-group': id }, h('h2', null, btn), panel);
  }

  /** A row that carries its area's recall bar (Schreiben, exam words). @param {{href: string, title: string, detail: string, x: any}} o */
  function barRow({ href, title, detail, x }) {
    return h('a', { class: 'pr-area pr-barrow pressable', href, 'aria-label': `${title}, ${detail}` },
      h('span', { class: 'pr-area-top' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-detail' }, detail))),
      recallBar(x ? x.recall : 0, x ? x.coverage : 0, t('practice.area.bar', { recall: pct(x?.recall || 0), seen: pct(x?.coverage || 0) })), icon('next', { size: 16 }));
  }

  /** "Finish round · 11 questions left", with the kind for rounds that are not the daily one. @param {any} round @param {number} left */
  function finishLabel(round, left) {
    const kind = round.kind === 'today' ? null : round.kind === 'area' ? t(roundOf(ctx).trainer ? `practice.area.${round.area}` : round.area === 'words' ? 'course.area.words' : 'course.area.phrases') : round.kind === 'topic' ? t('practice.kind.topic') : t(`practice.kind.${round.kind}`);   // write: Schreiben
    return kind ? t('practice.finishKind', { n: left, kind }) : t('practice.finish', { n: left });
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  await render();
  const own = roundOf(ctx);
  if (own.trainer) refreshSimStats(ctx);
  // exam words: at most one request every 10 minutes; a change rebuilds the pool
  if (own.trainer && secrets(store).githubToken) {
    refreshWords(ctx).then(res => {
      if (alive && res.state === 'error') rerender();
      if (!alive || res.state !== 'ok') return;
      if (res.added.length) ctx.toast(t('practice.words.addedToast', { n: res.added.length }));
    }).catch(() => {});
  }
  const offs = [store.subscribe('cards:b1', rerender), ...(own.trainer ? [] : [store.subscribe(`cards:${own.deck}`, rerender)]), store.subscribe(`cards:${SIM_DECK}`, rerender), store.subscribe(SIM_KV, rerender), store.subscribe(WORDS, rerender), store.subscribe('mistakes', rerender), ctx.bus.on('settings:changed', rerender), store.subscribe('scripts', rerender), store.subscribe('reads', rerender)];
  return () => { alive = false; offs.forEach(f => f()); };
}
