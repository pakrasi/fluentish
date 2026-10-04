/* Exam: the mock-test library, the start panel, the timed runner and the reviews (UX 4.4 to 4.7).
   Routes (all under #/exam, parsed from ctx.params.rest):
     ''                              the Exam tab: modules, up next, tests 1 to 14 with scores
     '<n>'                           one test's four modules
     '<n>/<module>'                  start panel, then the runner (no app chrome while the clock runs)
     '<n>/<module>/review/<attempt>' the review with feedback ('?item=L2-3' opens one item)
   Data, sync and the hand-offs are in data.js; the Today provider is plan.js. */
import { h, replace } from '../../core/dom.js';
import { notice } from '../../core/ui.js';
import { examDef, loadTest, isStarted, findAttempt, draft } from './data.js';
import { examHome, testPage, startPanel } from './pages.js';
import { runObjective, reviewObjective } from './objective.js';
import { runSchreiben } from './writing.js';
import { runSprechen } from './speaking.js';
import { reviewSchreiben, reviewSprechen } from './review.js';
import * as T from './timer.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { t } = ctx;
  const exam = await examDef(ctx);
  const page = h('div', { class: 'exam' });
  replace(el, page);
  if (!exam) {
    replace(page, h('header', { class: 'page-head' }, h('h1', null, t('tab.exam'))),
      notice({ children: [h('p', null, t('exam.noGoal')), h('p', null, h('a', { href: '#/profile/goal' }, t('exam.setGoal')))] }));
    return;
  }
  const [a, b, c, d] = (ctx.params.rest || '').split('/').filter(Boolean);
  if (!a) return examHome(page, ctx, exam);
  const n = Number(a);
  const def = b ? exam.modules.find((/** @type {any} */ m) => m.id === b) : null;
  if (!exam.tests.includes(n) || (b && !def)) {
    replace(page, h('header', { class: 'page-head' }, h('h1', null, t('exam.notFound'))), h('p', null, h('a', { href: '#/exam' }, t('tab.exam'))));
    return;
  }
  if (!b) return testPage(page, ctx, exam, n);
  let ex;
  try { ex = await loadTest(ctx, exam, n); } catch (e) {
    console.error(e);
    replace(page, h('header', { class: 'page-head' }, h('h1', null, t('exam.test', { n }))), notice({ kind: 'warning', children: [h('p', null, t('exam.loadFailed'))] }));
    return;
  }
  if (c === 'review' && d) {
    const attempt = findAttempt(ctx.store, exam.id, decodeURIComponent(d));
    if (!attempt) {
      replace(page, h('header', { class: 'page-head' }, h('h1', null, t('exam.test', { n }))), notice({ children: [h('p', null, t('exam.attemptMissing'))] }), h('p', null, h('a', { href: `#/exam/${n}` }, t('exam.backTest', { n }))));
      return;
    }
    /** @type {any} */ let cleanup = null;
    // "Get correction" on Today and the test page links here with ?correct=1: the correction starts at once, once
    let autoCorrect = ctx.query.get('correct') === '1';
    const render = async () => {
      const fresh = findAttempt(ctx.store, exam.id, attempt.id) || attempt;
      if (typeof cleanup === 'function') cleanup();
      const auto = autoCorrect; autoCorrect = false;
      if (def.id === 'schreiben') cleanup = await reviewSchreiben(page, ctx, { exam, n, ex, def, attempt: fresh, autoCorrect: auto });
      else if (def.id === 'sprechen') cleanup = await reviewSprechen(page, ctx, { exam, n, ex, def, attempt: fresh });
      else cleanup = await reviewObjective(page, ctx, { exam, n, module: def.id, ex, def, attempt: fresh, focusItem: ctx.query.get('item') });
    };
    await render();
    // a correction arriving (one-click or from the Mac) re-renders the review with it
    let pending = false;
    const again = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; if (page.isConnected) render(); }, 60); };
    const offs = ['exams.feedbackLocal', 'exams.remote'].map(k => ctx.store.subscribe(k, again));
    return () => { offs.forEach(f => f()); if (typeof cleanup === 'function') cleanup(); };
  }
  if (c) { ctx.go(`/exam/${n}/${b}`, { replace: true }); return; }
  // start panel until the clock starts; then the runner
  /** @type {any} */ let handle = null;
  const run = () => {
    if (def.id === 'schreiben') handle = runSchreiben(page, ctx, { exam, n, ex, def });
    else if (def.id === 'sprechen') handle = runSprechen(page, ctx, { exam, n, ex, def });
    else handle = runObjective(page, ctx, { exam, n, module: def.id, ex, def });
    page.querySelector('h1')?.focus({ preventScroll: true });
  };
  const clock = draft(ctx.store, n, def.id)?.clock;
  if (isStarted(ctx.store, n, def.id) && clock && !T.stale(clock, Date.now())) run();
  else handle = { unmount: startPanel(page, ctx, { exam, n, module: def.id, ex, def, onStart: () => { handle?.unmount?.(); run(); } }) };
  return {
    canLeave: () => (handle?.canLeave ? handle.canLeave() : true),
    unmount: () => { handle?.unmount?.(); document.body.dataset.chrome = 'on'; },
  };
}
