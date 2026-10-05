/* Review pages: the head with the score, feedback per attempt (Fritz's and one-click corrections), "Correct now"
   for Schreiben through services/claude.js, "Practise these mistakes", and the next step. The Schreiben and Sprechen
   reviews live here too; Lesen and Hören are in objective.js. */
import { h, replace } from '../../core/dom.js';
import { today as studyDay, label } from '../../core/clock.js';
import { corrections, scoreLine, wordCount, stampMs } from '../../domain/grade.js';
import { correctSchreiben, ClaudeError } from '../../services/claude.js';
import { render as md } from './md.js';
import { backLink } from './parts.js';
import { feedbackFor, markSeen, saveCorrection, learnerNotes, queueMistakes, mistakesQueued, allAttempts, recordings, linked } from './data.js';
import { nextModule, scoreReader } from './plan.js';
import { langAttr } from '../../core/lang.js';

/** "Sat 3 Oct, 20:15" for a stamp (local time). @param {string} iso @param {boolean} [utc] */
export function when(iso, utc = false) {
  const ms = stampMs(iso, utc);
  if (!ms) return '';
  const d = new Date(ms);
  return `${label(studyDay(d, 0))}, ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d)}`;
}

/** Minutes for a duration, or nothing when the clock obviously kept running. @param {number | null | undefined} s @param {any} t */
const minutes = (s, t) => (s && s < 4 * 3600 ? t('unit.min', { n: Math.max(1, Math.round(s / 60)) }) : null);

/**
 * @param {{ ctx: any, n: number, def: any, attempt: any, score: number | null, max: number, pass: boolean, topic: string, status?: string | null }} o
 */
export function reviewHead({ ctx, n, def, attempt, score, max, pass, topic, status = null }) {
  const { t } = ctx;
  return h('header', { class: 'ex-rhead' },
    backLink(`#/exam/${n}`, t('exam.backTest', { n })),
    h('h1', null, h('span', { lang: langAttr() }, def.name), ` · ${t('exam.test', { n })}`),
    h('p', { class: 'caption', lang: langAttr() }, topic),
    score != null
      ? h('p', { class: 'ex-score' }, h('span', { class: 'figure tnum' }, String(score)), h('span', { class: 'ex-score-of tnum' }, ` / ${max}`),
        h('span', { class: ['ex-verdict', pass ? 'is-ok' : 'is-bad'] }, pass ? t('exam.passed', { pass: def.pass }) : t('exam.belowPass', { pass: def.pass })))
      : status ? h('p', { class: 'ex-score-text' }, status) : null,
    h('p', { class: 'caption' }, [t('exam.submittedAt', { when: when(attempt.submitted_at, attempt.source === 'remote' && !/[+-]\d\d:\d\d$|Z$/.test(attempt.submitted_at)) }), minutes(attempt.duration_s, t)].filter(Boolean).join(' · ')));
}

/** One feedback entry. @param {any} ctx @param {any} f */
function feedbackEntry(ctx, f) {
  const { t } = ctx;
  return h('article', { class: 'ex-fb' },
    h('p', { class: 'ex-fb-meta caption' }, f.source === 'fritz-app' ? t('exam.fb.instant') : t('exam.fb.tutor'), ' · ', when(f.created_at), !f.seen ? h('span', { class: 'ex-new' }, t('exam.new')) : null),
    md(f.body));
}

/**
 * Feedback for an attempt: the current entries, then older attempts' behind a disclosure. For Schreiben, "Correct now"
 * when nothing is there yet, and "Practise these mistakes" once corrections exist.
 * @param {{ ctx: any, exam: any, attempt: any, fb: {cur: any[], older: any[]}, ex?: any, autoCorrect?: boolean }} o
 */
export function feedbackBlock({ ctx, exam, attempt, fb, ex = null, autoCorrect = false }) {
  const { t, store } = ctx;
  const box = h('section', { class: 'ex-feedback', 'aria-labelledby': 'ex-fb-h' }, h('h2', { id: 'ex-fb-h' }, t('exam.fb.title')));
  if (fb.cur.length) {
    box.append(...fb.cur.map(f => feedbackEntry(ctx, f)));
    const mistakes = fb.cur.reduce((n, f) => n + corrections(f.body).length, 0);
    if (mistakes) box.append(mistakesButton(ctx, attempt, fb.cur, mistakes));
    if (attempt.module === 'schreiben' && !attempt.remote) box.append(h('div', { class: 'ex-recorrect' }, correctionBlock({ ctx, exam, attempt, ex, again: true })));
  } else if (attempt.module === 'schreiben') {
    box.append(correctionBlock({ ctx, exam, attempt, ex, auto: autoCorrect }));
  } else if (attempt.module === 'sprechen') {
    box.append(h('p', { class: 'caption' }, linked(store) ? t('exam.fb.sprechenWait') : t('exam.fb.sprechenNotLinked')));
  } else {
    return fb.older.length ? h('section', { class: 'ex-feedback' }, older(ctx, fb.older)) : null;
  }
  if (fb.older.length) box.append(older(ctx, fb.older));
  return box;
}

/** @param {any} ctx @param {any[]} list */
const older = (ctx, list) => h('details', { class: 'ex-older' }, h('summary', null, ctx.t('exam.fb.older', { n: list.length })), list.map(f => feedbackEntry(ctx, f)));

/** @param {any} ctx @param {any} attempt @param {any[]} cur @param {number} n */
function mistakesButton(ctx, attempt, cur, n) {
  const { t, store } = ctx;
  const wrap = h('div', { class: 'ex-mistakes' });
  const draw = () => {
    const queued = mistakesQueued(store, attempt);
    replace(wrap, queued
      ? h('p', { class: 'caption' }, t('exam.mistakes.queued', { n: queued }), ' ', h('a', { href: '#/practice' }, t('exam.mistakes.open')))
      : h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable', onclick: () => {
        const k = queueMistakes(store, { attempt, feedback: cur });
        ctx.toast(t('exam.mistakes.added', { n: k }));
        draw();
      } }, t('exam.mistakes.practise', { n })));
  };
  draw();
  return wrap;
}

/* ---------- one-click Schreiben correction ---------- */

/** Running corrections, by attempt id; they keep going when the page is left. @type {Map<string, {status: string, error: string | null, subs: Set<() => void>}>} */
const jobs = new Map();

/** @param {any} ctx @param {any} exam @param {any} attempt @param {any} ex */
async function runCorrection(ctx, exam, attempt, ex) {
  const { store, t } = ctx;
  const k = String(attempt.id);
  const job = jobs.get(k) || { status: 'idle', error: null, subs: new Set() };
  if (job.status === 'running') return;
  job.status = 'running'; job.error = null; jobs.set(k, job);
  job.subs.forEach(f => f());
  try {
    const key = (store.get('secrets', {}) || {}).anthropicKey;
    const test = ex || await ctx.content.load(`exam.${exam.id}.${String(attempt.day).padStart(2, '0')}`);
    const texts = Object.fromEntries((attempt.writings || []).map((/** @type {any} */ w) => [w.aufgabe, w.text]));
    const res = await correctSchreiben({ key, ex: test, texts, learnerNotes: learnerNotes(store) });
    saveCorrection(ctx, { attempt, body: res.body, model: res.model, promptVersion: res.promptVersion });
    job.status = 'done';
    if (!location.hash.includes(`/review/${attempt.id}`)) ctx.toast(t('exam.correct.done', { n: attempt.day }));
  } catch (e) {
    job.status = 'error';
    job.error = t(`exam.correct.err.${e instanceof ClaudeError ? e.code : 'other'}`);
  }
  job.subs.forEach(f => f());
}

/**
 * "Get correction" for one Schreiben attempt. auto: start it at once (the learner already asked on Today or the test
 * page). A reply that is not a correction is never saved: the error shows with Try again and the attempt stays
 * "not corrected".
 * @param {{ ctx: any, exam: any, attempt: any, ex?: any, again?: boolean, auto?: boolean }} o
 */
export function correctionBlock({ ctx, exam, attempt, ex = null, again = false, auto = false }) {
  const { t, store } = ctx;
  const box = h('div', { class: 'ex-correct', 'aria-live': 'polite' });
  const k = String(attempt.id);
  const job = jobs.get(k) || { status: 'idle', error: null, subs: new Set() };
  jobs.set(k, job);
  const sub = () => { if (!box.isConnected && job.status !== 'running') { job.subs.delete(sub); return; } draw(); };
  job.subs.add(sub);
  const draw = () => {
    const hasKey = !!(store.get('secrets', {}) || {}).anthropicKey;
    const running = job.status === 'running';
    if (job.status === 'done' && !again) { replace(box); return; }   // the store change re-renders the review with the feedback
    if (again) {
      replace(box, h('button', { type: 'button', class: 'btn btn-quiet pressable', disabled: running, onclick: () => runCorrection(ctx, exam, attempt, ex) }, running ? t('exam.correct.running') : t('exam.correct.again')),
        job.error ? h('p', { class: 'field-error', role: 'alert' }, job.error) : null);
      return;
    }
    const words = (attempt.writings || []).filter((/** @type {any} */ w) => /^aufgabe/.test(w.aufgabe)).map((/** @type {any} */ w) => w.word_count ?? wordCount(w.text));
    const written = (attempt.writings || []).filter((/** @type {any} */ w) => /^aufgabe/.test(w.aufgabe) && String(w.text || '').trim()).length;
    replace(box,
      h('p', null, running ? t('exam.correct.runningLong', { n: written }) : t('exam.correct.none')),
      words.length ? h('p', { class: 'caption' }, t('exam.correct.words', { list: words.join(' / ') })) : null,
      job.error ? h('p', { class: 'field-error', role: 'alert' }, job.error) : null,
      hasKey
        ? h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable', disabled: running, onclick: () => runCorrection(ctx, exam, attempt, ex) },
          running ? t('exam.correct.running') : job.error ? t('exam.correct.retry') : t('exam.correct.now'))
        : h('p', { class: 'caption' }, t('exam.correct.needKey'), ' ', h('a', { href: '#/profile/connections' }, t('exam.correct.addKey'))),
      running ? h('p', { class: 'caption' }, t('exam.correct.canLeave')) : null);
  };
  draw();
  if (auto && job.status === 'idle' && (store.get('secrets', {}) || {}).anthropicKey) {
    history.replaceState(history.state, '', location.hash.replace(/[?&]correct=1/, ''));
    runCorrection(ctx, exam, attempt, ex);
  }
  return box;
}

/* ---------- next step ---------- */

/** "Next: Sprechen · Test 2" and the way back to Today. @param {any} ctx @param {any} exam @param {number} n */
export async function nextCard(ctx, exam, n) {
  const { t, store } = ctx;
  const s = ctx.settings();
  const next = nextModule({ exam, modules: s.exam.modules?.length ? s.exam.modules : exam.modules.map((/** @type {any} */ m) => m.id), attempts: allAttempts(store, exam.id), drafts: store.get('exams.drafts', {}), scoreOf: scoreReader(store, exam.id) });
  const def = next ? exam.modules.find((/** @type {any} */ m) => m.id === next.module) : null;
  return h('nav', { class: 'ex-next', 'aria-label': t('exam.next') },
    next && def ? h('a', { class: 'btn btn-primary pressable', href: `#/exam/${next.test}/${next.module}` }, t('exam.nextModule', { module: def.name, n: next.test })) : null,
    h('a', { class: 'btn pressable', href: '#/today' }, t('exam.toToday')),
    next && next.test !== n ? null : h('a', { class: 'btn btn-quiet pressable', href: `#/exam/${n}` }, t('exam.backTest', { n })));
}

/* ---------- Schreiben and Sprechen reviews ---------- */

/**
 * @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, ex: any, def: any, attempt: any, autoCorrect?: boolean }} o
 */
export async function reviewSchreiben(el, ctx, { exam, n, ex, def, attempt, autoCorrect = false }) {
  const { store, t } = ctx;
  const S = ex.schreiben;
  const fb = feedbackFor(store, exam.id, attempt);
  markSeen(store, fb.cur.filter(f => !f.seen).map(f => f.id));
  const sl = fb.cur[0] ? scoreLine(fb.cur[0].body) : null;
  const texts = Object.fromEntries((attempt.writings || []).map((/** @type {any} */ w) => [w.aufgabe, w.text]));
  const task = (/** @type {string} */ k, /** @type {number} */ i) => h('section', { class: 'ex-block', lang: langAttr() },
    h('p', { class: 'label' }, `Aufgabe ${i} · ca. ${S[k].words} Wörter`),
    h('p', { class: 'caption' }, S[k].situation),
    h('div', { class: 'ex-written' }, texts[k] ? String(texts[k]).split(/\n+/).map(p => h('p', null, p)) : h('p', { class: 'caption', lang: 'en' }, t('exam.nothingWritten'))),
    h('p', { class: 'caption tnum' }, t('exam.words', { n: wordCount(texts[k]), target: S[k].words })));
  replace(el, h('div', { class: 'ex-review' },
    reviewHead({ ctx, n, def, attempt, score: null, max: 100, pass: false, topic: ex.topic, status: sl ? sl.split(' · ')[0].replace(/^circa/, t('exam.about')) : t('exam.notCorrected') }),
    feedbackBlock({ ctx, exam, attempt, fb, ex, autoCorrect }),
    h('section', { class: 'ex-texts', 'aria-labelledby': 'ex-texts-h' }, h('h2', { id: 'ex-texts-h' }, t('exam.yourTexts')), ['aufgabe1', 'aufgabe2', 'aufgabe3'].map((k, i) => task(k, i + 1))),
    await nextCard(ctx, exam, n)));
}

/**
 * @param {HTMLElement} el @param {any} ctx @param {{ exam: any, n: number, ex: any, def: any, attempt: any }} o
 */
export async function reviewSprechen(el, ctx, { exam, n, ex, def, attempt }) {
  const { store, t } = ctx;
  const fb = feedbackFor(store, exam.id, attempt);
  markSeen(store, fb.cur.filter(f => !f.seen).map(f => f.id));
  const utc = attempt.source === 'remote' && !/[+-]\d\d:\d\d$|Z$/.test(String(attempt.submitted_at));
  const t0 = stampMs(attempt.started_at, utc) - 60e3, t1 = stampMs(attempt.submitted_at, utc) + 60e3;
  const all = recordings(store, n);
  let takes = all.filter(v => { const x = stampMs(v.created_at); return x >= t0 && x <= t1; });
  const fallback = !takes.length && all.length > 0;
  if (fallback) takes = all;
  /** @type {string[]} */ const urls = [];
  const take = async (/** @type {any} */ v, /** @type {number} */ i, /** @type {number} */ count) => {
    const blob = v.blobRef ? await store.adapter.getBlob(v.blobRef).catch(() => null) : null;
    const url = blob ? URL.createObjectURL(blob) : null;
    if (url) urls.push(url);
    return h('div', { class: 'ex-take' },
      h('p', { class: 'caption' }, [count > 1 ? t('exam.take', { n: i + 1 }) : null, when(v.created_at), v.sent ? t('exam.rec.sent') : t('exam.rec.notSent')].filter(Boolean).join(' · ')),
      url ? h('audio', { class: 'ex-raudio', controls: true, preload: 'metadata', src: url }) : null,
      v.transcript ? h('p', { class: 'ex-transcript', lang: langAttr() }, v.transcript) : h('p', { class: 'caption' }, t('exam.rec.noTranscript')));
  };
  const TEILE = [['teil1', 'Teil 1 · Gemeinsam etwas planen'], ['teil2', 'Teil 2 · Präsentation'], ['teil3', 'Teil 3 · Fragen']];
  const sections = await Promise.all(TEILE.map(async ([p, name]) => {
    const xs = takes.filter(v => v.part === p);
    return h('section', { class: 'ex-block' }, h('p', { class: 'label', lang: langAttr() }, name), xs.length ? await Promise.all(xs.map((v, i) => take(v, i, xs.length))) : h('p', { class: 'caption' }, t('exam.rec.none')));
  }));
  const notes = (attempt.writings || []).find((/** @type {any} */ w) => w.aufgabe === 'sprechen-notizen');
  const meta = attempt.meta && typeof attempt.meta === 'object' ? attempt.meta : {};
  replace(el, h('div', { class: 'ex-review' },
    reviewHead({ ctx, n, def, attempt, score: null, max: 100, pass: false, topic: [ex.topic, meta.topic].filter(Boolean).join(' · '), status: fb.cur.length ? t('exam.corrected') : t('exam.waiting') }),
    feedbackBlock({ ctx, exam, attempt, fb }),
    h('section', { 'aria-labelledby': 'ex-rec-h' }, h('h2', { id: 'ex-rec-h' }, t('exam.recordings')),
      fallback ? h('p', { class: 'caption' }, t('exam.rec.fallback')) : null, sections),
    notes?.text ? h('section', { class: 'ex-block' }, h('p', { class: 'label' }, t('exam.yourNotes')), h('div', { class: 'ex-written', lang: langAttr() }, String(notes.text).split('\n').map(l => h('p', null, l)))) : null,
    await nextCard(ctx, exam, n)));
  return () => urls.forEach(u => URL.revokeObjectURL(u));
}

