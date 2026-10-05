/* The Exam tab (UX 4.4), a test's page (4.5) and the start panel (4.6). English chrome; test topics and the start
   panel (its lines from the exam definition, its words from the exam-locale) are in the exam's language. */
import { h, replace } from '../../core/dom.js';
import { label } from '../../core/clock.js';
import { section, notice } from '../../core/ui.js';
import { scoreLine, scoreNum, passes } from '../../domain/grade.js';
import { latest, allAttempts, feedbackFor, isStarted, draft, loadTest, sync, notSentCount, allowLegacy, linked, saveDraft, mediaUrl, sectionOf, kindOf } from './data.js';
import { at } from '../../domain/examdef.js';
import { backLink, statusBar, confirmPanel } from './parts.js';
import { nextModule, modulesFitting, scoreReader, draftTouched, RESUME_MS, planMinutes, minutesLabel } from './plan.js';
import * as T from './timer.js';
import { when } from './review.js';
import { fill } from '../../core/motion.js';
import { clip } from '../../services/audio.js';
import { langAttr, bcp47, dirAttr } from '../../core/lang.js';

/** @param {any} exam */
const modulesOf = exam => exam.modules.map((/** @type {any} */ m) => m.id);

/** Status of one module of one test, in words, for lists. @param {any} ctx @param {any} exam @param {any} def @param {any} a latest attempt or null @param {number} n */
export function moduleStatus(ctx, exam, def, a, n) {
  const { t, store } = ctx;
  if (!a) return { text: isStarted(store, n, def.id) ? t('exam.status.started') : t('exam.status.open'), state: null, fresh: false };
  const fb = feedbackFor(store, exam.id, a);
  const fresh = fb.cur.some(f => !f.seen);
  if (a.score != null) return { text: `${a.score} / ${a.max_score}`, state: passes(a.score, a.max_score, exam.def?.scoring?.passShare) ? 'pass' : 'fail', fresh };
  const num = fb.cur[0] ? scoreNum(scoreLine(fb.cur[0].body)) : null;
  if (num != null) return { text: t('exam.status.about', { n: num }), state: passes(num, 100, exam.def?.scoring?.passShare) ? 'pass' : 'fail', fresh };
  if (fb.cur.length) return { text: t('exam.corrected'), state: 'sub', fresh };
  return { text: kindOf(exam, def.id) === 'writing' ? t('exam.notCorrected') : t('exam.waiting'), state: 'sub', fresh };
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
  const readScore = scoreReader(store, exam.id);
  const fills = () => { for (const tr of el.querySelectorAll('.mbar .track')) fill(/** @type {HTMLElement} */ (tr), Number(/** @type {HTMLElement} */ (tr).dataset.p)); };
  const draw = () => { draw0(); fills(); };
  const draw0 = () => {
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
      const uncorrected = kindOf(exam, m.id) === 'writing' ? [...last.values()].filter(a => a.module === m.id && !feedbackFor(store, exam.id, a).cur.length).length : 0;
      const detail = !xs.length ? t('exam.sum.none')
        : [scored.length ? t('exam.sum.best', { n: Math.max(.../** @type {number[]} */ (scored)) }) : null, t('exam.sum.attempts', { n: xs.length }), uncorrected ? t('exam.sum.uncorrected', { n: uncorrected }) : null].filter(Boolean).join(' · ');
      // the same picture as Today's module bars: the latest score on a track with the pass tick
      const score = lastA ? readScore(lastA) : null;
      return h('li', { class: 'ex-sum' }, h('div', { class: 'mbar', role: 'group', 'aria-label': score == null ? t('today.moduleNone', { name: m.name }) : t('today.moduleScore', { name: m.name, score, max: m.max, pass: m.pass }) },
        h('span', { class: 'mbar-name' }, h('span', { lang: langAttr(), dir: dirAttr() }, m.name), h('span', { class: 'caption block' }, detail)),
        h('span', { class: ['track', score != null && score < m.pass && 'below'], dataset: { p: String(score == null ? 0 : score / m.max) } }, h('span', { class: 'fill' }), h('i', { class: 'pass', style: { '--at': `${(m.pass / m.max) * 100}%` } })),
        h('span', { class: ['mbar-val', 'tnum', score == null && 'none'] }, score == null ? (st && !uncorrected ? st.text : t('today.noScore')) : `${score}/${m.max}`)));
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
          h('span', { class: 'row-detail', lang: langAttr(), dir: dirAttr() }, topics[n] || ' '), statusBar(states.map((/** @type {any} */ x) => (x ? x.state : null)))),
        trail ? h('span', { class: 'row-trail tnum' }, trail) : null);
    });
    const after = c.phase === 'after';
    replace(el, h('div', { class: 'ex-home' },
      h('header', { class: 'page-head' }, h('h1', null, t('tab.exam')), h('p', { class: 'caption' }, [exam.short, c.exam ? (after ? t('exam.wasOn', { date: label(c.exam) }) : label(c.exam)) : null].filter(Boolean).join(' · '))),
      after ? h('div', { class: 'ex-upnext' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/profile/goal' }, t('plan.nextExam')))
      : next && nextDef && c.mocks
        ? h('div', { class: 'ex-upnext' }, h('p', { class: 'label' }, t('exam.upNext')),
          h('a', { class: 'btn btn-primary btn-wide pressable', href: `#/exam/${next.test}/${next.module}` },
            isStarted(store, next.test, next.module) ? t('exam.continueModule', { module: nextDef.name, n: next.test }) : t('exam.startModule', { module: nextDef.name, n: next.test, min: planMinutes(nextDef) })))
        : !c.mocks ? notice({ children: [h('p', null, c.phase === 'day' ? t('exam.noMockDay') : t('exam.noMockEve'))] }) : null,
      fit != null ? h('p', { class: 'caption ex-fit' }, fit > 0 ? t('exam.fit', { n: fit }) : t('exam.fitNone')) : null,
      syncLine(ctx, draw),
      section(t('today.modules'), h('p', { class: 'caption section-sub' }, t('today.modulesSub')), h('ul', { class: 'mbars ex-mbars' }, summary)),
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
      const uncorrected = kindOf(exam, m.id) === 'writing' && a && !a.remote && !feedbackFor(store, exam.id, a).cur.length;
      return h('li', { class: 'ex-mod' },
        h('div', { class: 'ex-mod-main' },
          h('p', { class: 'row-title' }, h('span', { lang: langAttr(), dir: dirAttr() }, m.name), h('span', { class: 'caption' }, ` · ${minutesLabel(m, t)}`)),
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
      h('header', { class: 'page-head ex-test-head' }, h('h1', null, t('exam.test', { n })), h('p', { class: 'lead', lang: langAttr(), dir: dirAttr() }, ex.topic)),
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
  const tx = exam.tx;
  const sec = sectionOf(exam, module);
  const d = draft(store, n, module);
  const back = backLink(`#/exam/${n}`, t('exam.backTest', { n }));
  if (d?.clock && T.stale(d.clock, Date.now())) {
    const confirmSlot = h('div');
    replace(el, h('div', { class: 'ex-start' }, back,
      h('h1', { lang: langAttr(), dir: dirAttr() }, def.name),
      h('div', { class: 'ex-start-card', lang: langAttr(), dir: dirAttr() },
        h('p', null, tx('staleStarted', { module: def.name, when: new Intl.DateTimeFormat(bcp47(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d.clock.start)) })),
        h('p', { class: 'caption' }, tx('staleRules')),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => { saveDraft(store, n, module, { clock: T.continueStale(/** @type {T.Clock} */ (d.clock), Date.now(), def.minutes) }); onStart(); } }, tx('continue')),
          h('button', { type: 'button', class: 'btn pressable', onclick: () => replace(confirmSlot, confirmPanel({
            lang: langAttr(), dir: dirAttr(), title: tx('restartQ', { module: def.name }), lines: [tx('restartDetail', { min: def.minutes })], yes: tx('restart'), no: tx('keepGoing'),
            onNo: () => replace(confirmSlot), onYes: () => { saveDraft(store, n, module, { clock: T.begin(Date.now()) }); onStart(); },
          })) }, tx('restart'))),
        confirmSlot)));
    return;
  }
  // the parts of the module, as the definition gives them: a summary, or the part's minutes; a writing task's time and
  // word target from the test
  const speaking = sec.kind === 'speaking';
  /** @type {[string, string][]} */ const lines = sec.parts.map((/** @type {any} */ p, /** @type {number} */ i) => (sec.kind === 'writing'
    ? [tx('aufgabe', { i: i + 1 }), tx('taskStart', { min: at(ex, p.task).minutes, words: at(ex, p.task).words })]
    : [tx('teil', { n: i + 1 }), p.summary ? tx(p.summary) : tx('minShort', { n: p.minutes })]));
  if (speaking) lines.unshift([tx('prep'), tx('minShort', { n: sec.prepMinutes })]);
  const info = { lines, rules: tx(sec.rules) };
  const retake = !!latest(store, exam.id).get(`${n}:${module}`);
  const go = () => { saveDraft(store, n, module, { clock: T.begin(Date.now()) }); onStart(); };
  /** @type {ReturnType<typeof clip> | null} */ let check = null;
  const soundCheck = sec.soundCheck ? h('button', { type: 'button', class: 'btn pressable', lang: langAttr(), dir: dirAttr(), onclick: () => {
    check?.stop();
    check = clip(mediaUrl(exam, n, sec.soundCheck));
    check.result.then(r => { if (r === 'blocked' || r === 'error') ctx.toast(tx('audioBlocked')); });
  } }, tx('soundCheck')) : null;
  replace(el, h('div', { class: 'ex-start' }, back,
    h('h1', { lang: langAttr(), dir: dirAttr() }, def.name),
    h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() }, speaking ? tx('startSpeaking', { topic: ex.topic, prep: sec.prepMinutes, min: def.minutes }) : tx('startMinutes', { topic: ex.topic, min: def.minutes })),
    h('div', { class: 'ex-start-card', lang: langAttr(), dir: dirAttr() },
      h('table', { class: 'ex-teile' }, h('tbody', null, info.lines.map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'tnum' }, b))))),
      h('p', { class: 'caption' }, info.rules),
      retake ? h('p', { class: 'caption' }, tx('retake')) : null,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-primary pressable ex-go', onclick: go },
          speaking ? tx('startPrep', { min: sec.prepMinutes }) : retake ? tx('newTry', { min: def.minutes }) : tx('startModule', { module: def.name, min: def.minutes })),
        soundCheck))));
  return () => { check?.stop(); };
}

