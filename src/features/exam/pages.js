/* The Exam tab (UX 4.4), a test's page (4.5) and the start panel (4.6). English chrome; test topics and the start
   panel's task lines are German. */
import { h, replace } from '../../core/dom.js';
import { label } from '../../core/clock.js';
import { section, notice } from '../../core/ui.js';
import { scoreLine, scoreNum, passes } from '../../domain/grade.js';
import { latest, allAttempts, feedbackFor, isStarted, draft, loadTest, sync, notSentCount, linked, saveDraft, mediaUrl } from './data.js';
import { allowLegacy } from '../../data/sync/github-b1exam.js';
import { backLink, statusBar, confirmPanel } from './parts.js';
import { nextModule, modulesFitting, scoreReader, draftTouched, RESUME_MS } from './plan.js';
import * as T from './timer.js';
import { when } from './review.js';

/** @param {any} exam */
const modulesOf = exam => exam.modules.map((/** @type {any} */ m) => m.id);

/** Status of one module of one test, in words, for lists. @param {any} ctx @param {any} exam @param {any} def @param {any} a latest attempt or null @param {number} n */
export function moduleStatus(ctx, exam, def, a, n) {
  const { t, store } = ctx;
  if (!a) return { text: isStarted(store, n, def.id) ? t('exam.status.started') : t('exam.status.open'), state: null, fresh: false };
  const fb = feedbackFor(store, exam.id, a);
  const fresh = fb.cur.some(f => !f.seen);
  if (a.score != null) return { text: `${a.score} / ${a.max_score}`, state: passes(a.score, a.max_score) ? 'pass' : 'fail', fresh };
  const num = fb.cur[0] ? scoreNum(scoreLine(fb.cur[0].body)) : null;
  if (num != null) return { text: t('exam.status.about', { n: num }), state: passes(num, 100) ? 'pass' : 'fail', fresh };
  if (fb.cur.length) return { text: t('exam.corrected'), state: 'sub', fresh };
  return { text: def.id === 'schreiben' ? t('exam.notCorrected') : t('exam.waiting'), state: 'sub', fresh };
}

/** The sync line: "3 not sent · Send now", or how to link the device. @param {any} ctx @param {() => void} redraw */
function syncLine(ctx, redraw) {
  const { t, store } = ctx;
  if (!linked(store)) return h('p', { class: 'caption ex-sync' }, t('exam.sync.notLinked'), ' ', h('a', { href: '#/profile/connections' }, t('exam.sync.link')));
  const n = notSentCount(store);
  const st = store.get('exams.syncStatus', null);
  const btn = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: async () => {
    btn.setAttribute('disabled', '');
    allowLegacy(store);   // "Send now" is the learner's say-so for old unsent items too
    const r = await sync(ctx, true);
    ctx.toast(r.error ? t('exam.sync.failed', { why: r.error }) : t('exam.sync.allSent'));
    redraw();
  } }, t('exam.sync.sendNow'));
  return h('p', { class: ['caption ex-sync', n && 'is-pending'] },
    n ? t('exam.sync.notSent', { n }) : t('exam.sync.allSentAt', { when: st?.at ? when(st.at) : t('exam.sync.never') }),
    st?.error && n ? h('span', null, ` ${t('exam.sync.lastError', { why: st.error })}`) : null, n ? btn : null);
}

/* ---------- the Exam tab ---------- */

/** @param {HTMLElement} el @param {any} ctx @param {any} exam */
export async function examHome(el, ctx, exam) {
  const { t, store } = ctx;
  const s = ctx.settings();
  const c = ctx.clock.ctx();
  const mods = s.exam.modules?.length ? s.exam.modules : modulesOf(exam);
  const topics = /** @type {Record<number, string>} */ ({});
  const draw = () => {
    const attempts = allAttempts(store, exam.id);
    const last = latest(store, exam.id);
    const next = nextModule({ exam, modules: mods, attempts, drafts: store.get('exams.drafts', {}), scoreOf: scoreReader(store, exam.id) });
    const nextDef = next ? exam.modules.find((/** @type {any} */ m) => m.id === next.module) : null;
    const fit = modulesFitting(c, attempts);
    // module summary: latest, best, pass line, attempts
    const summary = exam.modules.filter((/** @type {any} */ m) => mods.includes(m.id)).map((/** @type {any} */ m) => {
      const xs = attempts.filter(a => a.module === m.id);
      const scored = xs.map(a => (a.score != null ? a.score : (() => { const f = feedbackFor(store, exam.id, a).cur[0]; return f ? scoreNum(scoreLine(f.body)) : null; })())).filter(x => x != null);
      const lastA = [...last.values()].filter(a => a.module === m.id).sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];
      const st = lastA ? moduleStatus(ctx, exam, m, lastA, lastA.day) : null;
      const uncorrected = m.id === 'schreiben' ? [...last.values()].filter(a => a.module === 'schreiben' && !feedbackFor(store, exam.id, a).cur.length).length : 0;
      const detail = !xs.length ? t('exam.sum.none')
        : [uncorrected ? null : st?.text, scored.length ? t('exam.sum.best', { n: Math.max(.../** @type {number[]} */ (scored)) }) : null, t('exam.sum.attempts', { n: xs.length }), uncorrected ? t('exam.sum.uncorrected', { n: uncorrected }) : null].filter(Boolean).join(' · ');
      return h('li', { class: 'list-item ex-sum' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title', lang: 'de' }, m.name), h('span', { class: 'row-detail' }, detail)),
        h('span', { class: 'row-trail tnum' }, t('exam.sum.pass', { n: m.pass, max: m.max })));
    });
    const tests = exam.tests.map((/** @type {number} */ n) => {
      const states = mods.map((/** @type {string} */ m) => {
        const a = last.get(`${n}:${m}`);
        const def = exam.modules.find((/** @type {any} */ x) => x.id === m);
        return a ? moduleStatus(ctx, exam, def, a, n) : null;
      });
      const L = last.get(`${n}:lesen`), H = last.get(`${n}:hoeren`);
      const fresh = states.some((/** @type {any} */ x) => x && x.fresh);
      const started = mods.some((/** @type {string} */ m) => !last.get(`${n}:${m}`) && isStarted(store, n, m));
      const trail = [L?.score != null ? `L ${L.score}` : null, H?.score != null ? `H ${H.score}` : null].filter(Boolean).join(' · ') || (started ? t('exam.status.started') : '');
      return h('a', { class: 'row pressable ex-testrow', href: `#/exam/${n}` },
        h('span', { class: 'ex-testno tnum' }, String(n)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('exam.test', { n }), fresh ? h('span', { class: 'ex-new' }, t('exam.new')) : null),
          h('span', { class: 'row-detail', lang: 'de' }, topics[n] || ' '), statusBar(states.map((/** @type {any} */ x) => (x ? x.state : null)))),
        trail ? h('span', { class: 'row-trail tnum' }, trail) : null);
    });
    replace(el, h('div', { class: 'ex-home' },
      h('header', { class: 'page-head' }, h('h1', null, t('tab.exam')), h('p', { class: 'caption' }, [exam.short, c.exam ? label(c.exam) : null].filter(Boolean).join(' · '))),
      next && nextDef && c.mocks
        ? h('div', { class: 'ex-upnext' }, h('p', { class: 'label' }, t('exam.upNext')),
          h('a', { class: 'btn btn-primary btn-wide pressable', href: `#/exam/${next.test}/${next.module}` },
            isStarted(store, next.test, next.module) ? t('exam.continueModule', { module: nextDef.name, n: next.test }) : t('exam.startModule', { module: nextDef.name, n: next.test, min: nextDef.minutes })))
        : !c.mocks ? notice({ children: [h('p', null, c.phase === 'day' ? t('exam.noMockDay') : t('exam.noMockEve'))] }) : null,
      fit != null ? h('p', { class: 'caption ex-fit' }, fit > 0 ? t('exam.fit', { n: fit }) : t('exam.fitNone')) : null,
      syncLine(ctx, draw),
      section(t('today.modules'), h('ul', { class: 'list' }, summary)),
      section(t('exam.tests'), h('div', { class: 'ex-tests' }, tests))));
  };
  draw();
  // topics load in the background (14 files, cached for the session)
  let alive = true;
  Promise.all(exam.tests.map(async (/** @type {number} */ n) => { try { topics[n] = (await loadTest(ctx, exam, n)).topic; } catch { /* offline */ } }))
    .then(() => { if (alive) draw(); });
  const offs = ['attempts', 'exams.remote', 'exams.feedbackLocal', 'exams.syncStatus', 'outbox'].map(k => store.subscribe(k, () => { if (alive) draw(); }));
  sync(ctx).then(() => { if (alive) draw(); });
  return () => { alive = false; offs.forEach(f => f()); };
}

/* ---------- a test's page ---------- */

/** @param {HTMLElement} el @param {any} ctx @param {any} exam @param {number} n */
export async function testPage(el, ctx, exam, n) {
  const { t, store } = ctx;
  const ex = await loadTest(ctx, exam, n);
  const confirmSlot = h('div');
  const draw = () => {
    const last = latest(store, exam.id);
    const firstOpen = exam.modules.find((/** @type {any} */ m) => !last.get(`${n}:${m.id}`))?.id;
    const rows = exam.modules.map((/** @type {any} */ m) => {
      const a = last.get(`${n}:${m.id}`) || null;
      const st = moduleStatus(ctx, exam, m, a, n);
      const started = isStarted(store, n, m.id);
      const reviewHref = a ? `#/exam/${n}/${m.id}/review/${encodeURIComponent(a.id)}` : null;
      const old = started && Date.now() - draftTouched((store.get('exams.drafts', {}) || {})[`${n}:${m.id}`]) > RESUME_MS;
      const main = started ? { href: `#/exam/${n}/${m.id}`, text: old ? t('exam.resumeDraft') : t('exam.continue') } : a ? { href: reviewHref, text: t('exam.review') } : { href: `#/exam/${n}/${m.id}`, text: t('exam.start') };
      const uncorrected = m.id === 'schreiben' && a && !a.remote && !feedbackFor(store, exam.id, a).cur.length;
      return h('li', { class: 'ex-mod' },
        h('div', { class: 'ex-mod-main' },
          h('p', { class: 'row-title' }, h('span', { lang: 'de' }, m.name), h('span', { class: 'caption' }, ` · ${t('unit.min', { n: m.minutes })}`)),
          h('p', { class: ['ex-status', st.state && `is-${st.state}`] }, st.text, st.fresh ? h('span', { class: 'ex-new' }, t('exam.new')) : null),
          a ? h('p', { class: 'caption' }, when(a.submitted_at)) : null),
        h('div', { class: 'ex-mod-actions' },
          h('a', { class: ['btn pressable', (started || m.id === firstOpen) && !a ? 'btn-primary' : null], href: main.href }, main.text),
          uncorrected ? h('a', { class: 'btn pressable', href: `${reviewHref}?correct=1` }, t('feedback.correct')) : null,
          started && a ? h('a', { class: 'btn btn-quiet pressable', href: reviewHref }, t('exam.lastResult')) : null,
          a && !started ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => replace(confirmSlot, confirmPanel({
            title: t('exam.again.q', { module: m.name, n }), lines: [t('exam.again.detail')], yes: t('exam.again.yes'), no: t('exam.again.no'),
            onNo: () => replace(confirmSlot), onYes: () => ctx.go(`/exam/${n}/${m.id}`),
          })) }, t('exam.again')) : null));
    });
    replace(el, h('div', { class: 'ex-test' },
      backLink('#/exam', t('tab.exam')),
      h('header', { class: 'page-head ex-test-head' }, h('h1', null, t('exam.test', { n })), h('p', { class: 'lead', lang: 'de' }, ex.topic)),
      h('ul', { class: 'list ex-mods' }, rows), confirmSlot,
      h('p', { class: 'caption' }, t('exam.lastCounts'))));
  };
  draw();
  const offs = ['attempts', 'exams.remote', 'exams.feedbackLocal'].map(k => store.subscribe(k, draw));
  return () => offs.forEach(f => f());
}

/* ---------- start panel ---------- */

/**
 * The start panel: the timer starts on the button, not on opening the page. A clock idle for 3 hours asks first.
 * @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, module: string, ex: any, def: any, onStart: () => void }} o
 */
export function startPanel(el, ctx, { exam, n, module, ex, def, onStart }) {
  const { t, store } = ctx;
  const d = draft(store, n, module);
  const back = backLink(`#/exam/${n}`, t('exam.backTest', { n }));
  if (d?.clock && T.stale(d.clock, Date.now())) {
    const confirmSlot = h('div');
    replace(el, h('div', { class: 'ex-start' }, back,
      h('h1', { lang: 'de' }, def.name),
      h('div', { class: 'ex-start-card', lang: 'de' },
        h('p', null, t('exam.de.staleStarted', { module: def.name, when: new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d.clock.start)) })),
        h('p', { class: 'caption' }, t('exam.de.staleRules')),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => { saveDraft(store, n, module, { clock: T.continueStale(/** @type {T.Clock} */ (d.clock), Date.now(), def.minutes) }); onStart(); } }, t('exam.de.continue')),
          h('button', { type: 'button', class: 'btn pressable', onclick: () => replace(confirmSlot, confirmPanel({
            lang: 'de', title: t('exam.de.restartQ', { module: def.name }), lines: [t('exam.de.restartDetail', { min: def.minutes })], yes: t('exam.de.restart'), no: t('exam.de.keepGoing'),
            onNo: () => replace(confirmSlot), onYes: () => { saveDraft(store, n, module, { clock: T.begin(Date.now()) }); onStart(); },
          })) }, t('exam.de.restart'))),
        confirmSlot)));
    return;
  }
  const S = ex.schreiben;
  const info = /** @type {Record<string, {lines: [string, string][], rules: string}>} */ ({
    lesen: { lines: [['Teil 1', '10 Min.'], ['Teil 2', '20 Min.'], ['Teil 3', '10 Min.'], ['Teil 4', '15 Min.'], ['Teil 5', '10 Min.']], rules: t('exam.de.rulesLesen') },
    hoeren: { lines: [['Teil 1', '5 kurze Texte, je zweimal'], ['Teil 2', 'ein Vortrag, einmal'], ['Teil 3', 'ein Gespräch, einmal'], ['Teil 4', 'eine Diskussion, zweimal']], rules: t('exam.de.rulesHoeren') },
    schreiben: { lines: ['aufgabe1', 'aufgabe2', 'aufgabe3'].map((k, i) => [`Aufgabe ${i + 1}`, `${S[k].minutes} Min. · ca. ${S[k].words} Wörter`]), rules: t('exam.de.rulesSchreiben') },
    sprechen: { lines: [['Vorbereitung', '15 Min.'], ['Teil 1', 'Gemeinsam etwas planen'], ['Teil 2', 'Ein Thema präsentieren'], ['Teil 3', 'Fragen zur Präsentation']], rules: t('exam.de.rulesSprechen') },
  })[module];
  const retake = !!latest(store, exam.id).get(`${n}:${module}`);
  const go = () => { saveDraft(store, n, module, { clock: T.begin(Date.now()) }); onStart(); };
  /** @type {HTMLAudioElement | null} */ let check = null;
  const soundCheck = module === 'hoeren' ? h('button', { type: 'button', class: 'btn pressable', lang: 'de', onclick: () => {
    try { check?.pause(); } catch { /* none */ }
    check = new Audio(mediaUrl(exam, n, 's1-1.mp3'));
    check.play().catch(() => ctx.toast(t('exam.audioBlocked')));
  } }, t('exam.de.soundCheck')) : null;
  replace(el, h('div', { class: 'ex-start' }, back,
    h('h1', { lang: 'de' }, def.name),
    h('p', { class: 'caption', lang: 'de' }, module === 'sprechen' ? `${ex.topic} · 15 Min. Vorbereitung, ca. 15 Min. Prüfung` : `${ex.topic} · ${def.minutes} Minuten`),
    h('div', { class: 'ex-start-card', lang: 'de' },
      h('table', { class: 'ex-teile' }, h('tbody', null, info.lines.map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'tnum' }, b))))),
      h('p', { class: 'caption' }, info.rules),
      retake ? h('p', { class: 'caption' }, t('exam.de.retake')) : null,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-primary pressable ex-go', onclick: go },
          module === 'sprechen' ? t('exam.de.startPrep') : retake ? t('exam.de.newTry', { min: def.minutes }) : t('exam.de.startModule', { module: def.name, min: def.minutes })),
        soundCheck))));
  return () => { try { check?.pause(); } catch { /* none */ } };
}

