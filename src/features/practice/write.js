/* Practice › Schreiben (#/practice/write) and Build an email (#/practice/write/build/<task>).

   The Schreiben page: the Schreiben phrases' own queue (rounds of kind write, FSRS, the same round runner), the three
   Aufgaben with their recall and the phrases by function (a read-through), and the Build an email tasks.

   Build an email: a mock task's greeting, one line per point built on a frame with a connector, the closing line and
   the sign-off, one part at a time. Each part is checked like a round item (build.js checkPart). A right line moves
   from the card into the email (kit flip()), its connectors light up in the glue role colour, and the next part comes
   in (kit swap()). At the end the whole email stands next to the model, with the word count; then he can write it
   from memory and ask for a correction (services/claude.js correctTask, the generic grader: nothing personal is
   sent). Builds, the free text and its correction stay on this device (kv practice.write). */
import { h, replace, announce } from '../../core/dom.js';
import { linkRow, notice, section, seg } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { correct as fxCorrect, wrong as fxWrong, resetAnswer, segments, swap, flip, reduced, countTo, haptic, wait } from '../../core/motion.js';
import { atmosphere } from '../../core/brand.js';
import { label } from '../../core/clock.js';
import * as Match from '../../domain/match.js';
import * as RD from '../../domain/b1ready.js';
import { roundMinutes } from '../../domain/today.js';
import { ROUND } from '../../domain/budget.js';
import { correctTask, ClaudeError } from '../../services/claude.js';
import * as B from './build.js';
import * as S from './session.js';
import { loadData, stateFor, session, secrets } from './data.js';
import { recallBar } from './hub.js';
import { checkMark } from './round.js';

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

    // Build an email
    const builds = kv(store).builds || {};
    const aufName = (/** @type {string} */ a) => data.writing.aufgaben.find((/** @type {any} */ x) => x.id === a);
    const taskRows = data.writing.tasks.map((/** @type {any} */ task) => {
      const b = builds[task.id];
      return linkRow({ href: `#/practice/write/build/${task.id}`, title: task.title,
        detail: t('practice.build.rowDetail', { aufgabe: task.aufgabe.slice(1), kind: aufName(task.aufgabe)?.short || '', to: task.to }),
        trail: b ? t('practice.build.rowDone', { right: b.right, total: b.total }) : null });
    });

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
        h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn pressable', href: `#/practice/round?kind=write:${a.teil}` }, t('practice.write.practiseAufgabe', { n: a.id.slice(1) }))),
        h('details', { class: 'wr-fns' }, h('summary', { class: 'pressable' }, t('practice.write.byFunction', { n: items.length })),
          fns.map((/** @type {any} */ f) => {
            const its = items.filter((/** @type {any} */ it) => it.wfn === f.id);
            if (!its.length) return null;
            return h('div', { class: 'wr-fn' }, h('h3', null, f.name),
              h('ul', { class: 'list' }, its.map((/** @type {any} */ it) => h('li', { class: 'list-item wr-phrase' },
                h('span', { lang: 'de' }, it.model), h('span', { class: 'caption' }, it.hl || it.prompt)))));
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
  const pieces = marked(f, B.connectorsIn(f).filter(r => glue.includes(r.word.toLowerCase())), s => h('span', { class: 'tile glue', lang: 'de' }, s));
  // the frame reads as a sentence: plain words, the connector as a glue tile
  return h('p', { class: 'wr-frame', lang: 'de' }, pieces.filter(x => x !== '').map(x => (typeof x === 'string' ? h('span', { class: 'wr-frame-text' }, x) : x)));
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} data @param {any} task */
function mountBuild(el, ctx, data, task) {
  const { t, store } = ctx;
  const aufgabe = data.writing.aufgaben.find((/** @type {any} */ a) => a.id === task.aufgabe);
  /** @type {Record<string, string>} */ const lines = {};
  /** @type {Record<string, {first: boolean, ok: boolean, shown?: boolean}>} */ const results = {};
  let i = 0, state = 'answer', tries = 0, alive = true;
  const total = task.parts.length;

  // ---------- the letter: one slot per part, filled as he goes ----------
  const slots = new Map(task.parts.map((/** @type {any} */ p) => [p.key, h('li', { class: ['wr-line', `is-${p.key}`], 'data-key': p.key },
    h('span', { class: 'wr-slot' }, partLabel(p, task, t)))]));
  const letter = h('ol', { class: ['wr-letter', task.aufgabe === 'A2' && 'is-post'], 'aria-label': t('practice.build.yourEmail'), lang: 'de' }, [...slots.values()]);
  const letterBox = h('section', { class: 'wr-letterbox', 'aria-live': 'polite' }, h('p', { class: 'label' }, task.aufgabe === 'A2' ? t('practice.build.yourPost') : t('practice.build.yourEmail')), letter);

  // ---------- the task ----------
  const points = h('ol', { class: 'wr-points', lang: 'de' }, task.points.map((/** @type {string} */ p, /** @type {number} */ k) => h('li', { 'data-point': String(k + 1) }, p)));
  const taskBox = h('details', { class: 'wr-task', open: true },
    h('summary', { class: 'pressable' }, t('practice.build.task')),
    h('p', { class: 'wr-situation', lang: 'de' }, task.situation),
    task.quote ? h('blockquote', { class: 'wr-quote', lang: 'de' }, task.quote) : null,
    points,
    h('p', { class: 'caption' }, t('practice.write.aufgabeAbout', { words: aufgabe?.words || '', min: aufgabe?.minutes || '', register: task.aufgabe === 'A1' ? 'du' : task.aufgabe === 'A3' ? 'Sie' : t('practice.write.noRegister') })));

  // ---------- the part card ----------
  const segs = h('div', { class: 'segments wr-segs', 'aria-label': t('practice.build.progress') });
  const meta = h('span', { class: 'label' });
  const count = h('span', { class: 'caption tnum' });
  const pointEl = h('p', { class: 'wr-point', lang: 'de' });
  const cueEl = h('p', { class: 'wr-cue' });
  const frameEl = h('div', { class: 'wr-framebox' });
  const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', rows: 2, lang: 'de', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
    enterkeyhint: 'go', 'aria-label': t('practice.build.answerLabel') }));
  input.setAttribute('autocorrect', 'off');
  const answerEl = h('div', { class: 'answer wr-answer' }, input, checkMark());
  const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb));
  const secondary = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => onSecondary() });
  const primary = h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => onPrimary() });
  const card = h('article', { class: 'card wr-card' }, h('div', { class: 'card-meta' }, meta, count), pointEl, cueEl, frameEl, answerEl, reveal,
    h('div', { class: 'card-actions' }, secondary, primary));
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
    state = 'done-part';
    const notes = [];
    if (r.partial && r.g.rest) notes.push(h('p', { class: 'pr-res is-warn' }, t('practice.build.rightButWord')),
      r.g.rest.ref ? h('p', { class: 'pr-diff answer-key', lang: 'de' }, h('span', { class: 'caption' }, t('practice.partial.situation')), ' ', r.g.rest.ref) : null);
    else if (r.punctMiss.length) notes.push(h('p', { class: 'pr-res is-warn' }, t('practice.right.punct')), h('p', { class: 'pr-rule' }, r.punctMiss.map((/** @type {any} */ m) => t(`practice.punct.${m.code}`, { word: m.word || '' })).join(' ')));
    else if (r.g.capMiss.length || r.g.umlautMiss.length) notes.push(h('p', { class: 'pr-res is-warn' }, r.g.umlautMiss.length ? t('practice.right.umlaut', { list: r.g.umlautMiss.map((/** @type {any} */ x) => x.expected).join(', ') }) : t('practice.right.cap')));
    else notes.push(h('p', { class: 'pr-res is-ok' }, tries === 1 ? t('practice.build.rightFirst') : t('practice.build.rightNow')));
    if (p.kind === 'free' || r.partial || r.punctMiss.length) notes.push(h('p', { class: 'caption' }, t('practice.build.oneModel')), h('p', { class: 'answer-key', lang: 'de' }, glueLine(B.modelLine(p))));
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
    kids.push(h('p', { class: 'pr-diff', lang: 'de' }, h('span', { class: 'caption' }, t('practice.you')), ' ', you),
      h('p', { class: 'pr-diff answer-key', lang: 'de' }, h('span', { class: 'caption' }, p.kind === 'free' ? t('practice.build.oneWay') : t('practice.rightIs')), ' ', glueLine(p.kind === 'free' ? B.modelLine(p) : right)));
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
    replace(fb, h('p', { class: 'caption' }, t('practice.build.modelIn')), h('p', { class: 'answer-key', lang: 'de' }, glueLine(B.modelLine(p))));
    reveal.classList.add('is-open');
    setButtons();
    place(p, B.modelLine(p), true);
  }

  // the line moves from the card into the email; its connectors light up there
  async function place(/** @type {any} */ p, /** @type {string} */ text, /** @type {boolean} */ shown = false) {
    lines[p.key] = text;
    const slot = /** @type {HTMLElement} */ (slots.get(p.key));
    const line = h('span', { class: ['wr-text', shown && 'is-model'] }, glueLine(text));
    const fly = h('span', { class: 'wr-fly' }, line);
    answerEl.append(fly);
    // the keyboard goes down and the email comes into view, so the line can be seen landing
    input.blur();
    if (i === 0) taskBox.open = false;
    letterBox.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    if (!reduced()) await wait(260);
    if (!alive) return;
    await flip([fly], () => { replace(slot, fly); slot.classList.add('is-filled'); });
    const marks = [...slot.querySelectorAll('.wr-glue')];
    marks.forEach((m, k) => setTimeout(() => m.classList.add('is-lit'), reduced() ? 0 : 120 + k * 90));
    if (p.point) points.children[p.point - 1]?.classList.add('is-done');
    dots();
    if (!reduced() && !shown) await wait(160);
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
    const atmoEl = h('div', { class: 'atmo', 'aria-hidden': 'true' });
    const wordsEl = h('span', { class: 'tnum' }, '0');
    const showLetter = (/** @type {{key: string, text: string}[]} */ ls) => ls.map(l => h('li', { class: ['wr-line', 'is-filled', l.key ? `is-${l.key}` : 'is-gap'] }, l.text ? h('span', { class: 'wr-text' }, glueLine(l.text)) : null));
    const out = h('ol', { class: ['wr-letter', task.aufgabe === 'A2' && 'is-post'], lang: 'de' }, showLetter(mine));
    const used = [...new Map(B.connectorsIn(B.asText(mine)).map(c => [c.word.toLowerCase(), c.word])).values()];
    const usedEl = h('p', { class: 'tiles wr-used' }, used.map((w, k) => h('span', { class: 'tile glue land', lang: 'de', style: { animationDelay: `${reduced() ? 0 : 300 + k * 70}ms` } }, w)));
    const toggle = seg({ label: t('practice.build.compare'), value: 'mine', options: [['mine', task.aufgabe === 'A2' ? t('practice.build.yourPost') : t('practice.build.yourEmail')], ['model', t('practice.build.model')]],
      onChange: v => swap(() => replace(out, showLetter(v === 'model' ? model : mine)), { kind: 'view', fallbackEl: out }) });
    const target = aufgabe?.words || 80;
    const view = h('div', { class: 'practice stack wr-build wr-done' },
      back('#/practice/write', t('practice.write.title')),
      h('section', { class: 'hero pr-done-hero' }, atmoEl,
        h('p', { class: 'label' }, task.aufgabe === 'A2' ? t('practice.build.donePost') : t('practice.build.doneEmail')),
        h('h1', null, h('span', { class: 'figure tnum' }, String(sc.right)), ' ', h('span', { class: 'pr-done-of' }, t('practice.build.ofRight', { n: sc.total }))),
        h('p', { class: 'caption' }, wordsEl, ' ', t('practice.build.words', { target }))),
      used.length ? h('div', { class: 'wr-usedbox' }, h('p', { class: 'label' }, t('practice.build.connectors')), usedEl) : null,
      h('div', { class: 'wr-compare' }, toggle),
      h('section', { class: 'wr-letterbox' }, out),
      h('div', { class: 'pr-done-actions' },
        h('a', { class: 'btn btn-primary pressable', href: `#/practice/write/build/${task.id}/free` }, t('practice.build.writeYourself')),
        h('a', { class: 'btn pressable', href: '#/practice/write' }, t('practice.build.another'))));
    replace(el, view);
    scrollTo(0, 0);
    view.querySelector('h1')?.setAttribute('tabindex', '-1');
    /** @type {HTMLElement | null} */ (view.querySelector('h1'))?.focus({ preventScroll: true });
    countTo(wordsEl, words, { from: 0, duration: 700 });
    let atmo = /** @type {any} */ (null);
    atmosphere(atmoEl).then(x => { atmo = x; if (alive) x.breathe(); else x.destroy(); }).catch(() => {});
    cleanups.push(() => atmo?.destroy());
  }

  /** @type {(() => void)[]} */ const cleanups = [];
  // after a right line the keyboard is down: Return (or Space) goes on, as the Next button does
  const onDocKey = (/** @type {KeyboardEvent} */ e) => {
    if (state !== 'done-part' || document.activeElement === input || /** @type {HTMLElement} */ (e.target).closest?.('a,button,textarea,input,summary')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextPart(); }
  };
  document.addEventListener('keydown', onDocKey);
  cleanups.push(() => document.removeEventListener('keydown', onDocKey));
  fill();
  // "Write it yourself": #/practice/write/build/<id>/free opens the free text right away
  if (location.hash.endsWith('/free')) drawFree(el, ctx, task, aufgabe);
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
    if ((m = /^~~(.+?)~~\s*→\s*==(.+?)==\s*$/.exec(line))) { out.push(h('p', { class: 'wr-fix', lang: 'de' }, h('s', { class: 'pr-wrongword' }, m[1]), ' → ', h('mark', null, m[2]))); continue; }
    if ((m = /^_(.+)_$/.exec(line))) { out.push(h('p', { class: 'caption wr-why', lang: 'de' }, inline(m[1]))); continue; }
    if (line.startsWith('- ')) { if (!list) { list = h('ul', { class: 'pr-bullets', lang: 'de' }); out.push(list); } list.append(h('li', null, inline(line.slice(2)))); continue; }
    out.push(h('p', { lang: 'de', class: line.startsWith('→') ? 'wr-good' : null }, inline(line)));
  }
  return out;
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} task @param {any} aufgabe */
function drawFree(el, ctx, task, aufgabe) {
  const { t, store } = ctx;
  const target = aufgabe?.words || 80;
  const saved = kv(store);
  const draft = (saved.drafts || {})[task.id] || '';
  const corr = (saved.corrections || {})[task.id] || null;
  const area = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input wr-free', rows: 10, lang: 'de', spellcheck: 'false', autocapitalize: 'sentences', 'aria-label': t('practice.build.freeLabel') }));
  area.value = draft;
  const wc = h('p', { class: 'caption tnum', 'aria-live': 'polite' });
  const result = h('div', { class: 'wr-correction', 'aria-live': 'polite' });
  const hasKey = !!secrets(store).anthropicKey;
  const btn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', disabled: !hasKey, onclick: () => run() }, t('feedback.correct')));
  let timer = /** @type {any} */ (null);
  const words = () => B.wordCount(area.value);
  const showCount = () => { wc.textContent = t('practice.build.wordsNow', { n: words(), target }); };
  area.addEventListener('input', () => {
    showCount();
    clearTimeout(timer);
    timer = setTimeout(() => putKv(store, v => ({ ...v, drafts: { ...(v.drafts || {}), [task.id]: area.value } })), 600);
  });
  async function run() {
    const text = area.value.trim();
    if (!text) { area.focus(); return; }
    btn.disabled = true; btn.textContent = t('exam.correct.running');
    replace(result, h('p', { class: 'caption' }, t('practice.build.correcting')));
    try {
      const res = await correctTask({ key: secrets(store).anthropicKey, task, text, words: target });
      putKv(store, v => ({ ...v, drafts: { ...(v.drafts || {}), [task.id]: area.value }, corrections: { ...(v.corrections || {}), [task.id]: { body: res.body, text, at: Date.now() } } }));
      replace(result, correctionNodes(res.body));
    } catch (e) {
      replace(result, h('p', { class: 'pr-res is-bad' }, t(`exam.correct.err.${e instanceof ClaudeError ? e.code : 'other'}`)));
    }
    btn.disabled = false; btn.textContent = t('feedback.correct');
  }
  const model = B.asText(B.modelEmail(task));
  const view = h('div', { class: 'practice stack wr-build wr-freepage' },
    back('#/practice/write', t('practice.write.title')),
    h('div', { class: 'page-head' }, h('p', { class: 'label' }, t('practice.build.label', { n: task.aufgabe.slice(1) })), h('h1', null, t('practice.build.writeYourself'))),
    h('details', { class: 'wr-task' }, h('summary', { class: 'pressable' }, t('practice.build.task')),
      h('p', { class: 'wr-situation', lang: 'de' }, task.situation), task.quote ? h('blockquote', { class: 'wr-quote', lang: 'de' }, task.quote) : null,
      h('ol', { class: 'wr-points', lang: 'de' }, task.points.map((/** @type {string} */ p) => h('li', null, p)))),
    h('p', { class: 'caption' }, t('practice.build.freeAbout')),
    area, wc,
    h('div', { class: 'pr-done-actions' }, btn, h('a', { class: 'btn pressable', href: `#/practice/write/build/${task.id}` }, t('practice.build.again'))),
    hasKey ? h('p', { class: 'caption' }, t('practice.build.privacy')) : notice({ children: [h('p', null, t('exam.correct.needKey')), h('p', null, h('a', { href: '#/profile/connections' }, t('exam.correct.addKey')))] }),
    result,
    h('details', { class: 'wr-modeltext' }, h('summary', { class: 'pressable' }, t('practice.build.model')), h('p', { class: 'wr-model', lang: 'de' }, model)));
  replace(el, view);
  if (corr) replace(result, h('p', { class: 'caption' }, t('practice.build.lastCorrection')), correctionNodes(corr.body));
  showCount();
  view.querySelector('h1')?.setAttribute('tabindex', '-1');
}
