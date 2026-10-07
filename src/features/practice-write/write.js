/* Practice › Schreiben (#/practice/write) and Build an email (#/practice/write/build/<task>).

   The Schreiben page: the Schreiben phrases' own queue (rounds of kind write, FSRS, the same round runner), the three
   Aufgaben with their recall and the phrases by function (a read-through), and the Build an email tasks.

   Build an email: a mock task's greeting, one line per point built on a frame with a connector, the closing line and
   the sign-off, one part at a time. Each part is checked like a round item (build.js checkPart). A right line moves
   from the card into the email (kit flip()), its connectors light up in the glue role colour, and the next part comes
   in (kit swap()). At the end the whole email stands next to the model, with the word count; then he can write it
   from memory and ask for a correction (services/claude.js correctTask, the generic grader: nothing personal is
   sent). Builds, the free text and its correction stay on this device (kv practice.write). The correction's lines
   become mistake cards (data/mistakes.js, F:W-<task>-<time>), reviewed in the mistakes round like an exam's. */
import { h, replace, announce } from '../../core/dom.js';
import { linkRow, notice, section, seg } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { correct as fxCorrect, wrong as fxWrong, resetAnswer, segments, swap, reduced, countTo, haptic, wait } from '../../core/motion.js';
import { label } from '../../core/clock.js';
import * as Match from '../../domain/match.js';
import * as RD from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { ROUND } from '../../domain/budget.js';
import { correctTask, ClaudeError } from '../../services/claude.js';
import { addMistakes, freeWriteMistakes, listMistakes, backfillContext, COLLECTION as MISTAKES } from '../../data/mistakes.js';
import * as B from './build.js';
import * as S from '../shared/session.js';
import { loadData, stateFor, session, secrets } from '../shared/data.js';
import { recallBar } from '../shared/recall-bar.js';
import { checkMark } from '../shared/check-mark.js';
import { doneHero } from '../shared/done-hero.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { keep } from '../../core/keyboard.js';

export const COLLECTION = 'practice.write';
const pct = (/** @type {number} */ x) => new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(x || 0);
const back = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);

/** @param {any} store */
const kv = store => store.get(COLLECTION, {}) || {};
/** @param {any} store @param {(v: any) => any} fn */
const putKv = (store, fn) => store.update(COLLECTION, (/** @type {any} */ v) => fn(v || {}), {});

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string[]} parts rest after 'write' */
export async function mountWrite(el, ctx, parts) {
  const { t } = ctx;
  replace(el, h('div', { class: 'practice stack' }, back('#/practice', t('practice.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.write.title'))), h('p', { class: 'caption' }, t('practice.loading'))));
  let data;
  try { data = await loadData(ctx); } catch {
    replace(el, h('div', { class: 'practice stack' }, back('#/practice', t('practice.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.write.title'))), notice({ kind: 'warning', children: [h('p', null, t('practice.loadFailed'))] })));
    return;
  }
  if (!data.writing) {
    replace(el, h('div', { class: 'practice stack' }, back('#/practice', t('practice.title')), h('div', { class: 'page-head' }, h('h1', null, t('practice.write.title'))), notice({ children: [h('p', null, t('practice.loadFailed'))] })));
    return;
  }
  if (parts[0] === 'build') {
    const task = data.writing.tasks.find((/** @type {any} */ x) => x.id === parts[1]);
    if (task) return mountBuild(el, ctx, data, task);
    ctx.go('/practice/write', { replace: true });
    return;
  }
  return mountPage(el, ctx, data);
}

/* ---------------------------------------------------------------- the Schreiben page */

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} data */
function mountPage(el, ctx, data) {
  const { t, store } = ctx;
  let alive = true;
  function render() {
    if (!alive) return;
    const s = stateFor(ctx, data), c = s.c, cards = s.cards;
    const wb = s.budget.writing;
    const pool = data.pool.filter((/** @type {any} */ it) => it.area === 'writing');
    const rd = RD.compute({ pool, store: cards, today: c.today, exam: c.exam, phase: c.phase });
    const all = rd.areas.writing;
    const saved = S.savedRound(session(store), 'write');
    const round = S.resumable(saved, c.today, Date.now()) ? saved : null;
    const n = round ? round.queue.length - round.i : Math.min(ROUND, wb ? wb.n : 0);
    const dueEl = h('span', { class: 'figure tnum' }, String(wb ? wb.due : 0));
    const start = n ? h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/round?kind=write', id: 'wr-start' },
      round ? t('practice.write.finish', { n }) : t('practice.write.start', { n, min: roundMinutes(n) })) : null;
    const nextDue = pool.map((/** @type {any} */ it) => cards[it.id]).filter((/** @type {any} */ r) => r && r.reps).map((/** @type {any} */ r) => RD.dueOn(r, c)).filter((/** @type {string} */ d) => d > c.today).sort()[0];
    const queue = h('div', { class: 'pr-queue' },
      h('div', { class: 'pr-queue-top' },
        h('p', { class: 'pr-due' }, dueEl, h('span', { class: 'label' }, t('practice.dueToday', { n: wb ? wb.due : 0 }))),
        h('p', { class: 'label pr-new' }, c.newItems ? t('practice.newLeft', { n: wb ? wb.newLeft : 0 }) : t('practice.noNew'))),
      all ? h('div', { class: 'pr-ready' },
        h('p', { class: 'pr-ready-top' }, h('span', { class: 'label' }, t('practice.write.recall')), h('b', { class: 'tnum' }, pct(all.recall))),
        recallBar(all.recall, all.coverage, t('practice.area.bar', { recall: pct(all.recall), seen: pct(all.coverage) })),
        h('p', { class: 'caption' }, t('practice.write.seen', { seen: all.seen, n: all.n }))) : null,
      wb && wb.focus && c.exam ? h('p', { class: 'caption' }, t('practice.write.focus', { date: label(c.exam) })) : null,
      n ? null : h('p', { class: 'pr-empty' }, nextDue ? t('practice.nothingNext', { date: label(nextDue) }) : t('practice.nothing')),
      start ? h('div', { class: 'pr-queue-btn' }, start) : null);

    // Build an email, and each task written from memory
    const builds = kv(store).builds || {};
    const written = /** @type {Record<string, string>} */ (kv(store).written || {});
    const aufName = (/** @type {string} */ a) => data.writing.aufgaben.find((/** @type {any} */ x) => x.id === a);
    const taskRows = data.writing.tasks.map((/** @type {any} */ task) => {
      const b = builds[task.id];
      return h('div', { class: 'wr-taskrow' },
        linkRow({ href: `#/practice/write/build/${task.id}`, title: task.title,
          detail: t('practice.build.rowDetail', { aufgabe: task.aufgabe.slice(1), kind: aufName(task.aufgabe)?.short || '', to: task.to }),
          trail: b ? t('practice.build.rowDone', { right: b.right, total: b.total }) : null }),
        h('a', { class: 'btn btn-quiet pressable wr-free-link', href: `#/practice/write/build/${task.id}/free`, 'aria-label': t('practice.build.writeTask', { title: task.title }) },
          t('practice.build.writeYourself'), written[task.id] ? h('span', { class: 'caption' }, ` · ${t('practice.build.writtenOn', { date: label(written[task.id]) })}`) : null));
    });
    /** The Aufgabe's next task to write from memory: one not written yet, else the one written longest ago. @param {string} aid */
    const nextTask = aid => data.writing.tasks.filter((/** @type {any} */ x) => x.aufgabe === aid)
      .sort((/** @type {any} */ x, /** @type {any} */ y) => (written[x.id] || '').localeCompare(written[y.id] || ''))[0] || null;

    // the Aufgaben: recall, a round of that Aufgabe, the phrases by function
    const aufs = data.writing.aufgaben.map((/** @type {any} */ a) => {
      const g = rd.groups[`writing/${a.teil}`];
      const items = pool.filter((/** @type {any} */ it) => it.group === a.teil).sort((/** @type {any} */ x, /** @type {any} */ y) => (x.rank ?? 99) - (y.rank ?? 99));
      const fns = data.writing.functions.filter((/** @type {any} */ f) => f.aufgabe === a.id);
      return section(a.name,
        g ? h('div', { class: 'pr-ready' },
          h('p', { class: 'pr-ready-top' }, h('span', { class: 'label' }, t('practice.write.aufgabeSeen', { seen: g.seen, n: g.n })), h('b', { class: 'tnum' }, pct(g.recall))),
          recallBar(g.recall, g.coverage, t('practice.area.bar', { recall: pct(g.recall), seen: pct(g.coverage) }))) : null,
        h('p', { class: 'wr-about' }, a.about),
        h('div', { class: 'pr-done-actions' },
          nextTask(a.id) ? h('a', { class: 'btn btn-primary pressable wr-memory', href: `#/practice/write/build/${nextTask(a.id).id}/free` }, t('practice.write.fromMemory', { n: a.id.slice(1), min: a.minutes || 20 })) : null,
          h('a', { class: 'btn pressable', href: `#/practice/round?kind=write:${a.teil}` }, t('practice.write.practiseAufgabe', { n: a.id.slice(1) }))),
        h('details', { class: 'wr-fns' }, h('summary', { class: 'pressable' }, t('practice.write.byFunction', { n: items.length })),
          fns.map((/** @type {any} */ f) => {
            const its = items.filter((/** @type {any} */ it) => it.wfn === f.id);
            if (!its.length) return null;
            return h('div', { class: 'wr-fn' }, h('h3', null, f.name),
              h('ul', { class: 'list' }, its.map((/** @type {any} */ it) => h('li', { class: 'list-item wr-phrase' },
                h('span', { lang: langAttr(), dir: dirAttr() }, it.model), h('span', { class: 'caption' }, it.hl || it.prompt)))));
          })));
    });

    const view = h('div', { class: ['practice', 'stack', 'wr-page', start && 'has-dock'] },
      back('#/practice', t('practice.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('practice.write.title'))),
      h('p', { class: 'lead' }, t('practice.write.lead')),
      queue,
      section(t('practice.build.title'), h('p', { class: 'caption' }, t('practice.build.about')), h('nav', { class: 'pr-rows', 'aria-label': t('practice.build.title') }, taskRows)),
      aufs);
    const h1 = el.querySelector('h1');
    replace(el, view);
    if (h1 && document.activeElement === h1) view.querySelector('h1')?.focus({ preventScroll: true });
    countTo(dueEl, wb ? wb.due : 0, { from: 0, duration: 600 });
  }
  render();
  const offs = [store.subscribe('cards:b1', render), store.subscribe(COLLECTION, render)];
  return () => { alive = false; offs.forEach(f => f()); };
}

/* ---------------------------------------------------------------- Build an email */

/** His line with its capital, umlaut and typo slips put right. @param {string} typed @param {{start: number, end: number, expected: string}[]} slips */
function applySlips(typed, slips) {
  let out = '', p = 0;
  for (const m of [...slips].sort((a, b) => a.start - b.start)) { if (m.start < p) continue; out += typed.slice(p, m.start) + m.expected; p = m.end; }
  return out + typed.slice(p);
}

/** Run a scroll and wait until the page stops moving (at most 420 ms). @param {() => void} go */
async function settleScroll(go) {
  go();
  if (reduced()) return;
  let last = -1, still = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 420) {
    await new Promise(r => requestAnimationFrame(r));
    const y = scrollY;
    still = y === last ? still + 1 : 0; last = y;
    if (still >= 2) return;
  }
}

/** "Greeting", "Point 2 of 3" … @param {any} part @param {any} task @param {(k: string, v?: any) => string} t */
function partLabel(part, task, t) {
  if (part.point) return t('practice.build.point', { n: part.point, total: task.points.length });
  return t(`practice.build.part.${part.key}`);
}

/** Text with ranges wrapped in an element. @param {string} text @param {{start: number, end: number}[]} ranges @param {(s: string) => Node} wrap */
function marked(text, ranges, wrap) {
  /** @type {any[]} */ const out = []; let p = 0;
  for (const r of ranges) { if (r.start < p) continue; out.push(text.slice(p, r.start), wrap(text.slice(r.start, r.end))); p = r.end; }
  out.push(text.slice(p));
  return out;
}
/** A line with its connectors as glue marks. @param {string} text */
const glueLine = text => marked(text, B.connectorsIn(text), s => h('mark', { class: 'wr-glue' }, s));

/** The frame as tiles: glue words in the glue role colour. @param {any} part */
function frameTiles(part) {
  if (!part.frame) return null;
  const f = String(part.frame), glue = (part.glue || []).map((/** @type {string} */ g) => g.toLowerCase());
  const pieces = marked(f, B.connectorsIn(f).filter(r => glue.includes(r.word.toLowerCase())), s => h('span', { class: 'tile glue', lang: langAttr(), dir: dirAttr() }, s));
  // the frame reads as a sentence: plain words, the connector as a glue tile
  return h('p', { class: 'wr-frame', lang: langAttr(), dir: dirAttr() }, pieces.filter(x => x !== '').map(x => (typeof x === 'string' ? h('span', { class: 'wr-frame-text' }, x) : x)));
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} data @param {any} task */
function mountBuild(el, ctx, data, task) {
  const { t, store } = ctx;
  const aufgabe = data.writing.aufgaben.find((/** @type {any} */ a) => a.id === task.aufgabe);
  /** @type {Record<string, string>} */ const lines = {};
  /** @type {Record<string, {first: boolean, ok: boolean, shown?: boolean}>} */ const results = {};
  /** @type {Record<string, {right: string | null, rule: string | null}>} */ const fixes = {};
  let i = 0, state = 'answer', tries = 0, alive = true;
  const total = task.parts.length;

  // ---------- the letter: one slot per part, filled as he goes ----------
  // an empty line is a quiet rule at the text's baseline with a small label at its end ("1", "Closing line"); the
  // current one is an accent rule (you, now); a filled one is the line itself
  const slots = new Map(task.parts.map((/** @type {any} */ p) => [p.key, h('li', { class: ['wr-line', `is-${p.key}`, p.point && 'is-point'], 'data-key': p.key },
    h('span', { class: 'wr-slot', 'aria-label': partLabel(p, task, t) }, h('span', { class: 'wr-slot-label', 'aria-hidden': 'true' }, p.point ? String(p.point) : t(`practice.build.part.${p.key}`))))]));
  const letter = h('ol', { class: ['wr-letter', task.aufgabe === 'A2' && 'is-post'], 'aria-label': t('practice.build.yourEmail'), lang: langAttr(), dir: dirAttr() }, [...slots.values()]);
  // with the keyboard up the letter folds to one line: how many of its lines are written (styles: .wr-prog)
  const prog = h('span', { class: 'caption tnum wr-prog', 'aria-hidden': 'true' });
  const letterBox = h('section', { class: 'wr-letterbox', 'aria-live': 'polite' }, h('p', { class: 'label' }, task.aufgabe === 'A2' ? t('practice.build.yourPost') : t('practice.build.yourEmail'), ' ', prog), letter);

  // ---------- the task ----------
  const points = h('ol', { class: 'wr-points', lang: langAttr(), dir: dirAttr() }, task.points.map((/** @type {string} */ p, /** @type {number} */ k) => h('li', { 'data-point': String(k + 1) }, p)));
  const taskBox = h('details', { class: 'wr-task', open: true },
    h('summary', { class: 'pressable' }, t('practice.build.task')),
    h('p', { class: 'wr-situation', lang: langAttr(), dir: dirAttr() }, task.situation),
    task.quote ? h('blockquote', { class: 'wr-quote', lang: langAttr(), dir: dirAttr() }, task.quote) : null,
    points,
    h('p', { class: 'caption' }, t('practice.write.aufgabeAbout', { words: aufgabe?.words || '', min: aufgabe?.minutes || '', register: task.aufgabe === 'A1' ? 'du' : task.aufgabe === 'A3' ? 'Sie' : t('practice.write.noRegister') })));

  // ---------- the part card ----------
  const segs = h('div', { class: 'segments wr-segs', 'aria-label': t('practice.build.progress') });
  const meta = h('span', { class: 'label' });
  const count = h('span', { class: 'caption tnum' });
  const pointEl = h('p', { class: 'wr-point', lang: langAttr(), dir: dirAttr() });
  const cueEl = h('p', { class: 'wr-cue' });
  const frameEl = h('div', { class: 'wr-framebox' });
  const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', rows: 2, lang: langAttr(), dir: dirAttr(), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
    enterkeyhint: 'go', 'aria-label': t('practice.build.answerLabel') }));
  input.setAttribute('autocorrect', 'off');
  const answerEl = h('div', { class: 'answer wr-answer' }, input, checkMark());
  const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb));
  const secondary = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => onSecondary() });
  const primary = h('button', { type: 'button', class: 'btn btn-primary pressable', onpointerdown: keep, onclick: () => onPrimary() });
  // with the keyboard up the card's buttons sit on the keyboard (styles/app.css .kb-dock)
  const card = h('article', { class: 'card wr-card' }, h('div', { class: 'card-meta' }, meta, count), pointEl, cueEl, frameEl, answerEl, reveal,
    h('div', { class: 'card-actions kb-dock' }, secondary, primary));
  const work = h('div', { class: 'wr-work stack' }, segs, card);

  const page = h('div', { class: 'practice stack wr-build' },
    back('#/practice/write', t('practice.write.title')),
    h('div', { class: 'page-head' }, h('p', { class: 'label' }, t('practice.build.label', { n: task.aufgabe.slice(1) })), h('h1', null, task.title)),
    taskBox, letterBox, work);
  replace(el, page);

  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 6 * 24 + 16)}px`; };
  input.addEventListener('input', () => { grow(); if (state === 'retry') { answerEl.classList.remove('is-wrong'); state = 'answer'; setButtons(); } });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onPrimary(); }
    if (e.key === 'Escape') { e.preventDefault(); ctx.go('/practice/write'); }
  });

  function dots() {
    prog.textContent = t('practice.build.linesDone', { n: Object.values(results).filter(r => r.ok).length, total });
    segments(segs, task.parts.map((/** @type {any} */ p, /** @type {number} */ k) => {
      const r = results[p.key];
      if (r) return r.first && r.ok ? 'done' : r.ok ? 'done' : 'miss';
      return k === i ? 'now' : '';
    }));
  }
  function setButtons() {
    primary.textContent = state === 'done-part' ? (i + 1 >= total ? t('practice.build.seeEmail') : t('practice.next')) : t('practice.check');
    primary.append(h('kbd', null, state === 'done-part' ? '↵' : 'Enter'));
    secondary.hidden = state === 'done-part';
    secondary.textContent = state === 'retry' ? t('practice.build.useModel') : t('practice.build.showModel');
  }
  function fill() {
    const p = task.parts[i];
    state = 'answer'; tries = 0;
    resetAnswer(answerEl, reveal); answerEl.classList.remove('is-wrong');
    replace(fb);
    replace(meta, partLabel(p, task, t));
    count.textContent = t('practice.count', { n: i + 1, total });
    pointEl.textContent = p.point ? task.points[p.point - 1] : '';
    pointEl.hidden = !p.point;
    cueEl.textContent = p.cue;
    replace(frameEl, frameTiles(p));
    input.value = ''; grow();
    input.placeholder = p.kind === 'free' ? t('practice.build.ph.free') : t('practice.ph.german');
    for (const li of points.children) li.classList.toggle('is-now', !!p.point && li.getAttribute('data-point') === String(p.point));
    slots.forEach((li, key) => li.classList.toggle('is-now', key === p.key));
    dots(); setButtons();
  }

  // ---------- checking ----------
  function onPrimary() {
    if (state === 'done-part') return nextPart();
    const typed = input.value.trim();
    if (!typed) { input.focus(); return; }
    submit(typed);
  }
  function onSecondary() { if (state === 'answer' || state === 'retry') useModel(); }

  function submit(/** @type {string} */ typed) {
    const p = task.parts[i];
    const r = B.checkPart(task, p, typed, data);
    tries++;
    if (r.ok) return right(p, typed, r);
    wrongAnswer(p, typed, r);
  }
  async function right(/** @type {any} */ p, /** @type {string} */ typed, /** @type {any} */ r) {
    if (!results[p.key]) results[p.key] = { first: tries === 1, ok: true };
    results[p.key].ok = true;
    // accepted with a note: the finished email marks the line and shows the right form on a tap
    const slips = [...(r.g.capMiss || []), ...(r.g.umlautMiss || []), ...(r.g.typos || [])];
    if (slips.length || r.punctMiss.length) fixes[p.key] = { right: slips.length ? applySlips(typed, slips) : null,
      rule: r.punctMiss.length ? r.punctMiss.map((/** @type {any} */ m) => t(`practice.punct.${m.code}`, { word: m.word || '' })).join(' ') : null };
    state = 'done-part';
    const notes = [];
    if (r.partial && r.g.rest) notes.push(h('p', { class: 'pr-res is-warn' }, t('practice.build.rightButWord')),
      r.g.rest.ref ? h('p', { class: 'pr-diff answer-key', lang: langAttr(), dir: dirAttr() }, h('span', { class: 'caption' }, t('practice.partial.situation')), ' ', r.g.rest.ref) : null);
    else if (r.punctMiss.length) notes.push(h('p', { class: 'pr-res is-warn' }, t('practice.right.punct')), h('p', { class: 'pr-rule' }, r.punctMiss.map((/** @type {any} */ m) => t(`practice.punct.${m.code}`, { word: m.word || '' })).join(' ')));
    else if (r.g.capMiss.length || r.g.umlautMiss.length) notes.push(h('p', { class: 'pr-res is-warn' }, r.g.umlautMiss.length ? t('practice.right.umlaut', { list: r.g.umlautMiss.map((/** @type {any} */ x) => x.expected).join(', ') }) : t('practice.right.cap')));
    else notes.push(h('p', { class: 'pr-res is-ok' }, tries === 1 ? t('practice.build.rightFirst') : t('practice.build.rightNow')));
    if (p.kind === 'free' || r.partial || r.punctMiss.length) notes.push(h('p', { class: 'caption' }, t('practice.build.oneModel')), h('p', { class: 'answer-key', lang: langAttr(), dir: dirAttr() }, glueLine(B.modelLine(p))));
    replace(fb, notes);
    reveal.classList.add('is-open');
    announce(`${t('practice.build.rightFirst')} ${typed}`);
    setButtons();
    await fxCorrect(answerEl, { hold: 260 });
    if (!alive) return;
    await place(p, typed);
  }
  function wrongAnswer(/** @type {any} */ p, /** @type {string} */ typed, /** @type {any} */ r) {
    if (!results[p.key]) results[p.key] = { first: false, ok: false };
    results[p.key].first = false;
    state = 'retry';
    const right = r.g.right || B.modelLine(p);
    const d = Match.diffWords(typed, right);
    /** @type {any[]} */ const you = []; let pos = 0;
    for (const w of d.wrong) { you.push(typed.slice(pos, w.start), h('s', { class: 'pr-wrongword' }, typed.slice(w.start, w.end))); pos = w.end; }
    you.push(typed.slice(pos));
    const kids = [h('p', { class: 'pr-res is-bad' }, t('practice.wrong'))];
    if (r.g.det) kids.push(h('p', { class: 'pr-hint' }, String(r.g.det.hint).split(/\*([^*]+)\*/).map((x, k) => (k % 2 ? h('i', null, x) : x))));
    kids.push(h('p', { class: 'pr-diff', lang: langAttr(), dir: dirAttr() }, h('span', { class: 'caption' }, t('practice.you')), ' ', you),
      h('p', { class: 'pr-diff answer-key', lang: langAttr(), dir: dirAttr() }, h('span', { class: 'caption' }, p.kind === 'free' ? t('practice.build.oneWay') : t('practice.rightIs')), ' ', glueLine(p.kind === 'free' ? B.modelLine(p) : right)));
    if (p.rule) kids.push(h('p', { class: 'pr-rule' }, p.rule));
    kids.push(h('p', { class: 'caption' }, t('practice.build.tryAgain')));
    replace(fb, kids);
    fxWrong(answerEl, { revealEl: reveal });
    announce(`${t('practice.wrong')}. ${r.g.det ? r.g.det.hint.replace(/\*/g, '') : ''}`);
    setButtons();
    dots();
  }
  function useModel() {
    const p = task.parts[i];
    if (!results[p.key]) results[p.key] = { first: false, ok: false };
    results[p.key].first = false; results[p.key].shown = true; results[p.key].ok = true;
    state = 'done-part';
    replace(fb, h('p', { class: 'caption' }, t('practice.build.modelIn')), h('p', { class: 'answer-key', lang: langAttr(), dir: dirAttr() }, glueLine(B.modelLine(p))));
    reveal.classList.add('is-open');
    setButtons();
    place(p, B.modelLine(p), true);
  }

  // the line moves from the card into the email (DESIGN.md motion.earned.line-landing): the page scrolls first and
  // settles, then the line flies by translation only (no scaling of the text) on a small arc, the slot's rule gives way
  // to it, its connectors light up, the task point is ticked; then the card's action row scrolls back into view
  async function place(/** @type {any} */ p, /** @type {string} */ text, /** @type {boolean} */ shown = false) {
    lines[p.key] = text;
    const slot = /** @type {HTMLElement} */ (slots.get(p.key));
    const line = h('span', { class: ['wr-text', shown && 'is-model'] }, glueLine(text));
    const fly = h('span', { class: 'wr-fly' }, line);
    answerEl.append(fly);
    input.blur();
    if (i === 0) taskBox.open = false;
    await settleScroll(() => slot.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }));
    if (!alive) return;
    const a = fly.getBoundingClientRect();
    replace(slot, fly); slot.classList.add('is-filled'); slot.classList.remove('is-now');
    if (!reduced()) {
      const b = fly.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      const ease = getComputedStyle(document.documentElement).getPropertyValue('--spring-soft').trim() || 'ease-out';
      await fly.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: `translate(${dx / 2}px, ${dy / 2 - 6}px)`, offset: 0.5 }, { transform: 'none' }],
        { duration: 520, easing: ease }).finished.catch(() => {});
      if (!alive) return;
    }
    const marks = [...slot.querySelectorAll('.wr-glue')];
    marks.forEach((m, k) => setTimeout(() => m.classList.add('is-lit'), reduced() ? 0 : k * 90));
    if (p.point) { const li = points.children[p.point - 1]; li?.classList.add('is-done'); if (!reduced()) li?.classList.add('land'); }
    dots();
    if (!reduced() && !shown) await wait(160 + marks.length * 90);
    if (!alive) return;
    await settleScroll(() => primary.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' }));
    primary.focus({ preventScroll: true });
  }
  function nextPart() {
    if (i + 1 >= total) return finish();
    i++;
    swap(() => fill(), { kind: 'forward', fallbackEl: card }).then(() => { input.focus({ preventScroll: true }); card.scrollIntoView({ block: 'nearest' }); });
  }

  // ---------- done: the whole email, next to the model ----------
  function finish() {
    const sc = B.score(results);
    putKv(store, v => ({ ...v, builds: { ...(v.builds || {}), [task.id]: { day: ctx.clock.today(), right: sc.right, total: sc.total } } }));
    haptic();
    const mine = B.assemble(task, lines);
    const model = B.modelEmail(task);
    const words = B.wordCount(B.asText(mine));
    const wordsEl = h('span', { class: 'tnum' }, '0');
    // his lines; one accepted with a note is marked, and a tap shows its right form
    const lineNode = (/** @type {{key: string, text: string}} */ l, /** @type {boolean} */ mineView) => {
      const f = mineView && l.key ? fixes[l.key] : null;
      if (!f) return l.text ? h('span', { class: 'wr-text' }, glueLine(l.text)) : null;
      const note = h('span', { class: 'wr-fixnote caption', hidden: true }, f.right ? [t('practice.build.rightForm'), ' ', h('span', { lang: langAttr(), dir: dirAttr() }, f.right)] : f.rule);
      return [h('button', { type: 'button', class: 'wr-text wr-fixme', 'aria-expanded': 'false',
        onclick: (/** @type {Event} */ e) => { const b = /** @type {HTMLElement} */ (e.currentTarget); note.hidden = !note.hidden; b.setAttribute('aria-expanded', String(!note.hidden)); } }, glueLine(l.text)), note];
    };
    const showLetter = (/** @type {{key: string, text: string}[]} */ ls, mineView = true) => ls.map((l, k) => h('li', { class: ['wr-line', 'is-filled', l.key ? `is-${l.key}` : 'is-gap', 'wr-in'], style: { '--i': String(k) } }, lineNode(l, mineView)));
    const out = h('ol', { class: ['wr-letter', task.aufgabe === 'A2' && 'is-post'], lang: langAttr(), dir: dirAttr() }, showLetter(mine));
    const used = [...new Map(B.connectorsIn(B.asText(mine)).map(c => [c.word.toLowerCase(), c.word])).values()];
    const lead = reduced() ? 0 : 420 + mine.length * 70;
    const usedEl = h('p', { class: 'tiles wr-used' }, used.map((w, k) => h('span', { class: 'tile glue land', lang: langAttr(), dir: dirAttr(), style: { animationDelay: `${reduced() ? 0 : lead + k * 70}ms` } }, w)));
    const toggle = seg({ label: t('practice.build.compare'), value: 'mine', options: [['mine', task.aufgabe === 'A2' ? t('practice.build.yourPost') : t('practice.build.yourEmail')], ['model', t('practice.build.model')]],
      onChange: v => replace(out, showLetter(v === 'model' ? model : mine, v !== 'model')) });
    const target = aufgabe?.words || 80;
    const hero = doneHero({ label: task.aufgabe === 'A2' ? t('practice.build.donePost') : t('practice.build.doneEmail'), figure: sc.right, of: t('practice.build.ofRight', { n: sc.total }),
      lines: [h('p', { class: 'caption' }, wordsEl, ' ', t('practice.build.words', { target })), Object.keys(fixes).length ? t('practice.build.marked') : null],
      data: h('div', { class: 'wr-done-data' }, h('div', { class: 'wr-compare' }, toggle), h('section', { class: 'wr-letterbox' }, out),
        used.length ? h('div', { class: 'wr-usedbox' }, h('p', { class: 'label' }, t('practice.build.connectors')), usedEl) : null) });
    const view = h('div', { class: 'practice stack wr-build wr-done' },
      back('#/practice/write', t('practice.write.title')),
      hero.el,
      h('div', { class: 'pr-done-actions' },
        h('a', { class: 'btn btn-primary pressable', href: `#/practice/write/build/${task.id}/free` }, t('practice.build.writeYourself')),
        h('a', { class: 'btn pressable', href: '#/practice/write' }, t('practice.build.another'))));
    replace(el, view);
    scrollTo(0, 0);
    cleanups.push(hero.start());
    countTo(wordsEl, words, { from: 0, duration: 700 });
  }

  /** @type {(() => void)[]} */ const cleanups = [];
  // a build is full screen: no tab bar under the card's buttons (as in a round)
  document.body.dataset.chrome = 'off';
  cleanups.push(() => { document.body.dataset.chrome = 'on'; });
  // after a right line the keyboard is down: Return (or Space) goes on, as the Next button does
  const onDocKey = (/** @type {KeyboardEvent} */ e) => {
    if (state !== 'done-part' || document.activeElement === input || /** @type {HTMLElement} */ (e.target).closest?.('a,button,textarea,input,summary')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextPart(); }
  };
  document.addEventListener('keydown', onDocKey);
  cleanups.push(() => document.removeEventListener('keydown', onDocKey));
  fill();
  // "Write it yourself": #/practice/write/build/<id>/free opens the free text right away
  if (location.hash.endsWith('/free')) cleanups.push(drawFree(el, ctx, task, aufgabe));
  else input.focus({ preventScroll: true });
  // test hook (localhost only): the browser checks read the current part and drive the builder
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    /** @type {any} */ (window).__build = { get state() { return state; }, get part() { return task.parts[i]; }, input, onPrimary, onSecondary };
  }
  return () => { alive = false; cleanups.forEach(f => f()); };
}

/* ---------------------------------------------------------------- Write it yourself */

/** The correction's lines, rendered as text (never as markup). @param {string} body */
export function correctionNodes(body) {
  /** @type {any[]} */ const out = [];
  /** @type {HTMLElement | null} */ let list = null;
  const inline = (/** @type {string} */ s) => String(s).split(/\*\*([^*]+)\*\*/).map((x, k) => (k % 2 ? h('b', null, x) : x));
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    let m;
    if (line.startsWith('! ')) { out.push(h('p', { class: 'wr-score' }, line.slice(2))); continue; }
    if (line.startsWith('## ')) { out.push(h('h3', null, line.slice(3))); continue; }
    if ((m = /^~~(.+?)~~\s*→\s*==(.+?)==\s*$/.exec(line))) { out.push(h('p', { class: 'wr-fix', lang: langAttr(), dir: dirAttr() }, h('s', { class: 'pr-wrongword' }, m[1]), ' → ', h('mark', null, m[2]))); continue; }
    if ((m = /^_(.+)_$/.exec(line))) { out.push(h('p', { class: 'caption wr-why', lang: langAttr(), dir: dirAttr() }, inline(m[1]))); continue; }
    if (line.startsWith('- ')) { if (!list) { list = h('ul', { class: 'pr-bullets', lang: langAttr(), dir: dirAttr() }); out.push(list); } list.append(h('li', null, inline(line.slice(2)))); continue; }
    out.push(h('p', { lang: langAttr(), dir: dirAttr(), class: line.startsWith('→') ? 'wr-good' : null }, inline(line)));
  }
  return out;
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} task @param {any} aufgabe @returns {() => void} the cleanup */
function drawFree(el, ctx, task, aufgabe) {
  const { t, store } = ctx;
  const target = aufgabe?.words || 80;
  const saved = kv(store);
  const draft = (saved.drafts || {})[task.id] || '';
  const corr = (saved.corrections || {})[task.id] || null;
  const area = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input wr-free', id: 'wr-free', rows: 10, lang: langAttr(), dir: dirAttr(), spellcheck: 'false', autocapitalize: 'sentences' }));
  area.value = draft;
  const today = ctx.clock.today();
  // the task counts as written today once the text reaches most of its length, or when it is sent for a correction
  const save = () => putKv(store, v => ({ ...v, drafts: { ...(v.drafts || {}), [task.id]: area.value },
    ...(words() >= Math.round(target * 0.7) ? { written: { ...(v.written || {}), [task.id]: today } } : {}) }));
  const wc = h('p', { class: 'caption tnum', 'aria-live': 'polite' });
  const result = h('div', { class: 'wr-correction', 'aria-live': 'polite' });
  const hasKey = !!secrets(store).anthropicKey;
  const btn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', disabled: !hasKey, onclick: () => run() }, t('feedback.correct')));
  // with the keyboard up: one slim row on the keyboard with the word count, the clock and Correct (its twin)
  const wcKb = h('span', { class: 'caption tnum wr-kbcount', 'aria-hidden': 'true' });
  const clockKb = h('span', { class: 'caption tnum wr-clock', 'aria-hidden': 'true' });
  const btnKb = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', disabled: !hasKey, onpointerdown: keep, onclick: () => run() }, t('feedback.correct')));
  const kbBar = h('div', { class: 'kb-dock kb-only wr-kbbar' }, wcKb, clockKb, btnKb);
  let timer = /** @type {any} */ (null);
  const words = () => B.wordCount(area.value);
  const showCount = () => { wc.textContent = t('practice.build.wordsNow', { n: words(), target }); wcKb.textContent = wc.textContent; };
  area.addEventListener('input', () => {
    showCount();
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  // the last keystrokes are kept when he leaves (the debounce would drop them)
  const flush = () => { if (timer) { clearTimeout(timer); timer = null; save(); } };
  addEventListener('pagehide', flush);
  async function run() {
    const text = area.value.trim();
    if (!text) { area.focus(); return; }
    btn.disabled = true; btn.textContent = t('exam.correct.running'); btnKb.disabled = true; btnKb.textContent = btn.textContent;
    replace(result, h('p', { class: 'caption' }, t('practice.build.correcting')));
    try {
      const res = await correctTask({ key: secrets(store).anthropicKey, task, text, words: target });
      const at = Date.now();
      putKv(store, v => ({ ...v, drafts: { ...(v.drafts || {}), [task.id]: area.value }, corrections: { ...(v.corrections || {}), [task.id]: { body: res.body, text, at } },
        written: { ...(v.written || {}), [task.id]: today } }));
      replace(result, correctionNodes(res.body), practiseRow(queue({ body: res.body, at, text })));
    } catch (e) {
      replace(result, h('p', { class: 'pr-res is-bad' }, t(`exam.correct.err.${e instanceof ClaudeError ? e.code : 'other'}`)));
    }
    btn.disabled = false; btn.textContent = t('feedback.correct'); btnKb.disabled = false; btnKb.textContent = btn.textContent;
  }
  /**
   * The correction's lines become mistake cards (once per correction; a correction he already turned into cards and
   * then deleted them from is left alone). Returns how many of its mistakes are live.
   * @param {{body: string, at: number, text?: string}} cr @param {boolean} [onlyNew] a correction made before this was added
   */
  function queue(cr, onlyNew = false) {
    const o = freeWriteMistakes({ taskId: task.id, at: cr.at, label: t('practice.build.mistakeLabel', { n: task.aufgabe.slice(1), title: task.title }), body: cr.body, text: cr.text || null });
    const known = Object.values(store.get(MISTAKES, {}) || {}).some((/** @type {any} */ m) => m && m.source && m.source.attemptId === o.attemptId);
    if (!(onlyNew && known) && o.items.length) addMistakes(store, o);
    // mistakes made before round 5: the words around them, from this saved text
    else if (known) backfillContext(store);
    return listMistakes(store).filter(m => m.source.attemptId === o.attemptId).length;
  }
  /** "Practise these 4 mistakes · 2 min" after a correction. @param {number} n */
  function practiseRow(n) {
    return n ? h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: '#/practice/round?kind=mistakes' }, t('practice.build.practise', { n, min: roundMinutes(Math.min(ROUND, n)) }))) : null;
  }
  const model = B.asText(B.modelEmail(task));
  // an optional exam clock: the Aufgabe's minutes, counting down; nothing happens at zero except the line saying so
  const mins = aufgabe?.minutes || 20;
  const clock = h('span', { class: 'caption tnum wr-clock', 'aria-live': 'off' });
  let tick = /** @type {any} */ (null);
  const timeBtn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'chip pressable wr-time', 'aria-pressed': 'false', onclick: () => toggleTime() }, t('practice.build.timeIt', { min: mins })));
  function toggleTime() {
    if (tick) { clearInterval(tick); tick = null; timeBtn.setAttribute('aria-pressed', 'false'); clock.textContent = ''; clockKb.textContent = ''; return; }
    const end = Date.now() + mins * 60e3;
    timeBtn.setAttribute('aria-pressed', 'true');
    const draw = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      clockKb.textContent = clock.textContent = left ? t('practice.build.timeLeft', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) : t('practice.build.timeUp');
      if (!left) { clearInterval(tick); tick = null; timeBtn.setAttribute('aria-pressed', 'false'); announce(t('practice.build.timeUp')); }
    };
    draw(); tick = setInterval(draw, 1000);
    area.focus();
  }
  const view = h('div', { class: 'practice stack wr-build wr-freepage' },
    back('#/practice/write', t('practice.write.title')),
    h('div', { class: 'page-head' }, h('p', { class: 'label' }, t('practice.build.label', { n: task.aufgabe.slice(1) })), h('h1', null, t('practice.build.writeYourself'))),
    h('details', { class: 'wr-task', open: true }, h('summary', { class: 'pressable' }, t('practice.build.task')),
      h('p', { class: 'wr-situation', lang: langAttr(), dir: dirAttr() }, task.situation), task.quote ? h('blockquote', { class: 'wr-quote', lang: langAttr(), dir: dirAttr() }, task.quote) : null,
      h('ol', { class: 'wr-points', lang: langAttr(), dir: dirAttr() }, task.points.map((/** @type {string} */ p) => h('li', null, p)))),
    h('p', { class: 'caption' }, t('practice.build.freeAbout')),
    h('div', { class: 'wr-freehead' }, h('label', { class: 'label', for: 'wr-free' }, t('practice.build.freeLabel')), h('span', { class: 'wr-timebox' }, clock, timeBtn)),
    area, wc, kbBar,
    h('div', { class: 'pr-done-actions' }, btn, h('a', { class: 'btn pressable', href: `#/practice/write/build/${task.id}` }, t('practice.build.again'))),
    hasKey ? h('p', { class: 'caption' }, t('practice.build.privacy')) : notice({ children: [h('p', null, t('exam.correct.needKey')), h('p', null, h('a', { href: '#/profile/connections' }, t('exam.correct.addKey')))] }),
    result,
    h('details', { class: 'wr-modeltext' }, h('summary', { class: 'pressable' }, t('practice.build.model')), h('p', { class: 'wr-model', lang: langAttr(), dir: dirAttr() }, model)));
  replace(el, view);
  if (corr) replace(result, h('p', { class: 'caption' }, t('practice.build.lastCorrection')), correctionNodes(corr.body), practiseRow(corr.at ? queue(corr, true) : 0));
  showCount();
  view.querySelector('h1')?.setAttribute('tabindex', '-1');
  return () => { flush(); removeEventListener('pagehide', flush); clearInterval(tick); };
}
