/* Quick sort (#/practice/sort): words come one at a time, big, and he sorts each into Know or Learn.
     ?cluster=<type>:<id>     a Word cluster's words (the cluster page's Quick sort)
     ?level=A1                the word list's words of a level (Look up › Words, the spot check that failed)
     ?ids=<word id>,…&title=  words picked elsewhere (the Explore map's group sheet and List)
     ?recheck=1               Recheck by typing: the words he sorted to Learn before (domain/checks.js recheckList)
     &from=map|lookup|cluster|check|sort|map/<type>/<id>   where Done goes back to (map/…: a group page)
   Only words that are not known yet and have no gap ("um … zu") come up, most useful first.

   A mode switch at the top (session.js has the rules; remembered on this device, localStorage):
     Recognise   the German word; Know (← or 1) marks it known through data/known.js (S 60 days, one check in about
                 60 days, spread over the batch, never a new item of the day); Learn (→ or 2) leaves the card as it
                 is (it comes into the rounds as a new word) and records the Learn pick (data/checks.js), so the
                 Recheck list can offer it again. The meaning shows on demand (Space, or a tap on the word).
     Produce     the English meaning, the word type and, for a noun, "with der, die or das"; he types the German and
                 Enter checks it with Practice's grader. Right first time: marked known. Wrong: the answer shows and
                 the word goes to Learn, with "I knew it, typo" (⌥T) to mark it known after all. Skip (⌥S) leaves it
                 untouched; Learn (⌥L) without typing sends it to Learn.
   With nothing remembered it opens in Produce while any word of the list has no right typed answer yet.
   Undo (Z, ⌥Z while typing) takes back the last choice. Recheck runs Produce only; a wrong answer there changes
   nothing but the check record.
   Motion (core/motion.js fling): the word flies on a short arc into the Know or Learn stack, whose count lands with
   the pop spring, while the next word rises in its place; reduced motion: the counts change, nothing flies.
   The summary is the shared done hero: "Marked 142 known, 38 to learn", Study the words to learn now, Recheck by
   typing, Done. */
import { wordMeta, wordPanel } from '../../core/wordpanel.js';
import { wordCard } from '../../domain/wordcard.js';
import { h, replace, announce } from '../../core/dom.js';
import { seg } from '../../core/ui.js';
import { fling, reduced, haptic, correct as fxCorrect, wrong as fxWrong, resetAnswer } from '../../core/motion.js';
import { doneHero } from '../shared/done-hero.js';
import { loadClusters, loadKnowledge } from '../shared/cluster-data.js';
import { form, groupBack, itemFor } from '../shared/cluster-items.js';
import { gradeAnswer } from '../shared/grade.js';
import { loadData } from '../shared/data.js';
import { sortList, sortSource, gradeProduce } from './pick.js';
import { sortSession } from './session.js';
import { markWords, unmarkCards } from '../../data/known.js';
import { recordCheck, undoChecks, checksOf } from '../../data/checks.js';
import { startMode, produced, isMode } from '../../domain/checks.js';
import { recheckWords } from '../shared/recheck.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { keep, fitToKeyboard, keyboardOpen, reveal as revealEl, fitPrompt } from '../../core/keyboard.js';

const MODE_KEY = 'fluentish.sortMode';
/** The mode remembered on this device (it may be missing or blocked). */
const rememberedMode = () => { try { return globalThis.localStorage?.getItem(MODE_KEY) || null; } catch { return null; } };
/** @param {string} m */
const rememberMode = m => { try { globalThis.localStorage?.setItem(MODE_KEY, m); } catch { /* private mode */ } };

/** Where Done goes. @param {URLSearchParams} q @param {any} src */
function backOf(q, src) {
  const from = q.get('from');
  if (from === 'map') return '#/lookup/map';
  const page = groupBack(from);
  if (page) return `#${page}`;
  if (from === 'lookup') return `#/lookup/words?w=all${src?.level ? `&level=${src.level}` : ''}`;
  if (src?.kind === 'cluster') { const [ty, id] = src.key.split(':'); return `#/lookup/map/${ty}/${encodeURIComponent(id)}`; }
  if (from === 'check') return '#/lookup/map';
  return '#/practice/clusters';
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountSort(el, ctx) {
  const { t, store } = ctx;
  const recheck = ctx.query.get('recheck') === '1';
  const src = recheck ? null : sortSource(ctx.query);
  const backTo = recheck ? '#/lookup/words?w=all' : backOf(ctx.query, src);
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  const page = (/** @type {any[]} */ ...kids) => h('div', { class: 'practice pr-done stack' }, ...kids);
  const title = t(recheck ? 'practice.sort.recheckTitle' : 'practice.sort.title');
  replace(el, page(h('h1', null, title), h('p', { class: 'caption' }, t('practice.sort.loading'))));
  /** @type {any} */ let data;
  /** @type {any} */ let k;
  /** @type {any} */ let gdata;
  try { [data, k, gdata] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx), loadData(ctx)]); } catch {
    restore();
    replace(el, page(h('h1', null, title), h('p', null, t('practice.sort.loadFailed')), h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn pressable', href: backTo }, t('practice.done')))));
    return restore;
  }
  const word = (/** @type {string} */ id) => data.ix.word(id);
  /** @type {string[]} */ let order = [];
  let name = t('practice.sort.words');
  if (recheck) {
    order = recheckWords(store, k, word);
    name = t('practice.sort.recheckName');
  } else if (src?.kind === 'cluster') {
    const cl = data.ix.byKey.get(src.key);
    if (cl) { order = cl.items; name = cl.label; }
  } else if (src?.kind === 'level') {
    order = data.words.filter((/** @type {any} */ w) => w.level === src.level).sort((/** @type {any} */ a, /** @type {any} */ b) => (b.zipf || 0) - (a.zipf || 0)).map((/** @type {any} */ w) => w.id);
    name = t('practice.sort.level', { level: src.level });
  } else if (src?.kind === 'ids') {
    order = src.ids || [];
    if (src.title) name = src.title;
  }
  // a recheck keeps his order (latest Learn first); a sort puts the most common words first
  const list = recheck ? order.filter((id, j) => order.indexOf(id) === j).slice(0, 400) : sortList(order, word, id => k.get(id));
  if (!list.length) {
    restore();
    replace(el, page(h('p', { class: 'label' }, t('practice.sort.titleOf', { name })), h('h1', null, t('practice.sort.none')), h('p', { class: 'lead' }, t(recheck ? 'practice.sort.recheckNone' : 'practice.sort.noneLead')),
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo }, t('practice.done')))));
    return restore;
  }

  // ---------- the session ----------
  const total = list.length;
  const cardsOf = (/** @type {string} */ id) => [store.cards('clusters')[`W:${id}`], store.cards('b1')[`W:${id}`], store.cards('clusters')[`CF:${id}`]].filter(Boolean);
  const checks0 = checksOf(store);
  const mode0 = startMode(rememberedMode(), list.map(id => produced(checks0, `W:${id}`, cardsOf(id))));
  /** @type {Map<string, any>} */ const items = new Map();
  const itemOf = (/** @type {string} */ id) => { if (!items.has(id)) items.set(id, itemFor(`W:${id}`, data.ix, data.c, { t, fx: data.fx })); return items.get(id); };
  const S = sortSession({ list, mode: mode0, recheck, deps: {
    mark: id => markWords(ctx, [id], { batch: total }),
    unmark: res => unmarkCards(ctx, res.entries),
    check: x => recordCheck(ctx, x),
    uncheck: tokens => undoChecks(ctx, tokens),
    grade: (id, typed) => { const it = itemOf(id); return it ? gradeProduce(it, typed, gdata, gradeAnswer) : { ok: false, right: form(word(id)) }; },
  } });

  // ---------- layout ----------
  let showing = false, alive = true, finished = false, busy = false;
  const tfill = h('span', { class: 'fill' });
  const count = h('span', { class: 'caption tnum' });
  const undoKbd = h('kbd', null, 'Z');
  const undoBtn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-quiet pressable qs-undo', onpointerdown: keep, onclick: () => undo(), disabled: true }, t('practice.sort.undo'), undoKbd));
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onpointerdown: keep, onclick: () => end() }, t('practice.sort.end'), h('kbd', null, 'Esc'));
  const modeSeg = recheck ? null : seg({ label: t('practice.sort.mode'), value: S.mode, options: [['recognise', t('practice.sort.recognise')], ['produce', t('practice.sort.produce')]], onChange: v => setMode(v) });
  modeSeg?.classList.add('qs-mode');
  // with the keyboard up the tiles give way: their counts become this tally in the header row (aria-hidden: the
  // tiles' counts are announced)
  const knowT = h('b', { class: 'tnum' }, '0'), learnT = h('b', { class: 'tnum' }, '0');
  const knowTL = h('span'), learnTL = h('span');
  const tally = h('span', { class: 'caption qs-tally', 'aria-hidden': 'true' }, h('span', null, knowTL, ' ', knowT), h('span', null, learnTL, ' ', learnT));
  const top = h('div', { class: 'pr-top qs-top' }, h('div', { class: 'track qs-track', 'aria-hidden': 'true' }, tfill),
    h('div', { class: 'pr-top-row' }, h('span', { class: 'label qs-name' }, t('practice.sort.titleOf', { name })), count, tally),
    h('div', { class: 'pr-top-row qs-tools' }, modeSeg, undoBtn, endBtn));
  // Recognise: the German word
  const art = h('span', { class: 'qs-art' });
  const lemma = h('span', { class: 'qs-lemma' });
  const wordEl = h('button', { type: 'button', class: 'qs-word', lang: langAttr(), dir: dirAttr(), 'aria-describedby': 'qs-gloss', onclick: () => toggleMeaning() }, art, lemma);
  const gloss = h('p', { class: 'qs-gloss', id: 'qs-gloss', 'aria-live': 'polite' });
  const meaningBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable qs-meaning', 'aria-expanded': 'false', onclick: () => toggleMeaning() }, t('practice.sort.meaning'), h('kbd', null, 'Space'));
  // Produce: the English meaning, typed answer, feedback
  const task = h('p', { class: 'pr-task qs-task' });
  const prompt = h('p', { class: 'qs-prompt kb-clamp kb-flip', lang: 'en', dir: 'ltr' });
  const input = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'answer-input', id: 'qs-input', rows: 1, lang: langAttr(), dir: dirAttr(), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('practice.answerLabel'), placeholder: t('practice.ph.german') }));
  input.setAttribute('autocorrect', 'off');
  const answerEl = h('div', { class: 'answer qs-answer kb-flip' }, input);
  const fb = h('div', { class: 'pr-fb', 'aria-live': 'polite' });
  const typoBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable qs-typo', onpointerdown: keep, onclick: () => typo(), hidden: true }, t('practice.sort.typo'), h('kbd', null, '⌥T'));
  const skipBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable qs-skip', onpointerdown: keep, onclick: () => skip() }, t('practice.sort.skip'), h('kbd', null, '⌥S'));
  const reveal = h('div', { class: 'reveal-answer' }, h('div', null, fb, typoBtn));
  const produceBox = h('div', { class: 'qs-produce' }, task, prompt, answerEl, reveal, skipBtn);
  const level = h('div', { class: 'qs-level' });
  const panel = h('div', { class: 'qs-panel' });
  const recogniseBox = h('div', { class: 'qs-recognise' }, wordEl, gloss);
  const stage = h('div', { class: 'qs-stage' }, level, recogniseBox, produceBox, panel, meaningBtn);
  /** The word panel's card for a list word (domain/wordcard.js). @param {any} w */
  const cardOf = w => (data.fx ? wordCard(data.fx.ix, { lemma: w.w, pos: w.pos, id: `W:${w.id}`, zipf: w.zipf, level: w.level, verbs: data.fx.verbs }).card
    : { type: 'word', head: form(w), forms: null, pres: null, plural: null, pluralNote: null, level: w.level || null, zipf: w.zipf ?? null, ex: w.ex || null, exAt: null, exSrc: null, exEn: w.exen || null, conf: null });
  const knowN = h('span', { class: 'qs-n tnum' }, '0');
  const learnN = h('span', { class: 'qs-n tnum' }, '0');
  const knowLabel = h('span', { class: 'qs-btn-label' });
  const learnLabel = h('span', { class: 'qs-btn-label' });
  const knowKbd = h('kbd', null, '←');
  const learnKbd = h('kbd', null, '→');
  const knowBtn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'qs-btn is-know pressable', onpointerdown: keep, onclick: () => left() },
    h('span', { class: 'qs-btn-top' }, knowKbd, knowLabel), h('span', { class: 'qs-stack' }, knowN)));
  const learnBtn = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'qs-btn is-learn pressable', onpointerdown: keep, onclick: () => right() },
    h('span', { class: 'qs-btn-top' }, learnLabel, learnKbd), h('span', { class: 'qs-stack' }, learnN)));
  const how = h('p', { class: 'caption qs-how kb-fade' });
  const actions = h('div', { class: 'qs-actions' }, h('div', { class: 'qs-btns' }, knowBtn, learnBtn), how);
  // Produce with the keyboard up (AUDIT §5.5): one row on the keyboard, Skip and Learn quiet, Check (Next) primary
  const skipKb = h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => skip() }, t('practice.sort.skip'));
  const learnKb = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-quiet pressable', onpointerdown: keep, onclick: () => right() }));
  const checkKb = h('button', { type: 'button', class: 'btn btn-primary pressable', onpointerdown: keep, onclick: () => left() });
  const kbRow = h('div', { class: 'card-actions qs-kbrow' }, skipKb, learnKb, checkKb);
  const box = h('div', { class: 'pr-round qs-round', role: 'region', 'aria-label': title }, top, h('div', { class: 'pr-scroll qs-scroll' }, stage), actions, kbRow);
  const h1 = h('h1', { class: 'sr-only' }, t('practice.sort.titleOf', { name }));
  const keysEl = h('p', { class: 'sr-only' });
  replace(el, h1, box, keysEl);
  // the router focuses the page's h1 after mount; in Produce the answer field keeps the focus (and the keyboard)
  h1.addEventListener('focus', () => { if (alive && produce() && !finished) input.focus({ preventScroll: true }); });
  // the box follows the visual viewport, so the row sits on the keyboard (core/keyboard.js)
  const unfit = fitToKeyboard(box);

  const produce = () => S.mode === 'produce';
  /** The labels and hints of the mode. */
  function drawMode() {
    box.classList.toggle('is-produce', produce());
    recogniseBox.hidden = produce(); meaningBtn.hidden = produce(); produceBox.hidden = !produce();
    knowLabel.textContent = t(produce() ? 'practice.sort.check' : 'practice.sort.know');
    learnLabel.textContent = t(recheck ? 'practice.sort.notYet' : 'practice.sort.learn');
    knowTL.textContent = knowLabel.textContent; learnTL.textContent = learnLabel.textContent;
    checkKb.textContent = knowLabel.textContent; learnKb.textContent = learnLabel.textContent;
    knowKbd.textContent = produce() ? '↵' : '←';
    learnKbd.textContent = produce() ? '⌥L' : '→';
    undoKbd.textContent = produce() ? '⌥Z' : 'Z';
    how.textContent = t(recheck ? 'practice.sort.howRecheck' : produce() ? 'practice.sort.howProduce' : 'practice.sort.how');
    keysEl.textContent = t(produce() ? 'practice.sort.keysProduce' : 'practice.sort.keys');
  }
  function drawCounts() {
    const n = S.counts();
    knowN.textContent = String(n.know); learnN.textContent = String(recheck ? n.stay : n.learn);
    knowT.textContent = knowN.textContent; learnT.textContent = learnN.textContent;
    undoBtn.disabled = !S.picks.length;
  }
  function drawWord(enter = true) {
    const id = /** @type {string} */ (S.id);
    const w = word(id);
    drawMode();
    showing = false; meaningBtn.setAttribute('aria-expanded', 'false');
    replace(meaningBtn, t('practice.sort.meaning'), h('kbd', null, 'Space'));
    replace(level, wordMeta(cardOf(w)));
    replace(panel);
    count.textContent = t('practice.sort.count', { n: S.i + 1, total });
    tfill.style.setProperty('--p', String(S.i / total));
    if (produce()) {
      const it = itemOf(id);
      task.textContent = it?.task || '';
      prompt.textContent = it?.prompt || (w.en || []).slice(0, 3).join('; ');
      fitPrompt(prompt);   // a short prompt uses the band above the field (keyboard mode)
      resetAnswer(answerEl, reveal); replace(fb); typoBtn.hidden = true; skipBtn.hidden = false; skipKb.hidden = false;
      input.value = '';
      knowBtn.disabled = false; learnBtn.disabled = false; learnKb.hidden = false;
      input.focus({ preventScroll: true });
      announce(t('practice.sort.announcePrompt', { prompt: `${task.textContent} ${prompt.textContent}`.trim(), n: S.i + 1, total }));
    } else {
      art.textContent = w.pos === 'noun' && /^(der|die|das)$/.test(w.art) ? `${w.art} ` : '';
      lemma.textContent = w.w;
      wordEl.setAttribute('aria-label', form(w));
      gloss.textContent = '';
      knowBtn.disabled = false; learnBtn.disabled = false;
      announce(t('practice.sort.announceWord', { word: form(w), n: S.i + 1, total }));
    }
    if (enter && !reduced()) { stage.classList.remove('fx-in-up'); void stage.offsetWidth; stage.classList.add('fx-in-up'); }
  }
  function toggleMeaning() {
    if (finished || produce()) return;
    const w = word(/** @type {string} */ (S.id));
    showing = !showing;
    gloss.textContent = showing ? (w.en || []).slice(0, 3).join('; ') : '';
    replace(panel, showing ? wordPanel(cardOf(w), { head: false }) : null);
    meaningBtn.setAttribute('aria-expanded', String(showing));
    replace(meaningBtn, t(showing ? 'practice.sort.hide' : 'practice.sort.meaning'), h('kbd', null, 'Space'));
  }
  /** @param {string} v */
  function setMode(v) {
    if (!isMode(v) || finished || busy) return;
    if (S.phase !== 'answer') { modeSeg?.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.value === S.mode))); return; }
    S.setMode(v);
    rememberMode(v);
    drawWord(false);
    announce(t(v === 'produce' ? 'practice.sort.produceOn' : 'practice.sort.recogniseOn'));
  }
  const flyFrom = () => (produce() ? prompt : wordEl);
  // with the keyboard up the counts are the header's tally
  const knowTo = () => (keyboardOpen() ? knowT : knowN), learnTo = () => (keyboardOpen() ? learnT : learnN);
  /** Move on after a choice: the next word, or the summary. */
  function after() {
    drawCounts();
    if (S.done) { tfill.style.setProperty('--p', '1'); finished = true; setTimeout(() => summary(), reduced() ? 0 : 440); return; }
    drawWord();
  }
  /** The left tile: Know (Recognise) or Check (Produce), or Next after a miss. */
  function left() {
    if (finished || !alive || busy) return;
    if (!produce()) { void fling(wordEl, knowN, { duration: 420 }); S.know(); haptic(); after(); return; }
    if (S.phase === 'feedback') { next(); return; }
    submit();
  }
  /** The right tile: Learn (Recognise and Produce), Not yet (Recheck). */
  function right() {
    if (finished || !alive || busy || S.phase !== 'answer') return;
    void fling(flyFrom(), learnTo(), { duration: 420 });
    S.learn(); haptic(); after();
  }
  function submit() {
    const v = S.submit(input.value);
    if (!v) return;
    // the field stays writable and focused (a read-only field can drop the iPhone keyboard): a key moves on (onKey)
    skipBtn.hidden = true; skipKb.hidden = true;
    learnBtn.disabled = true; learnKb.hidden = true;
    const w = word(S.list[S.i]);
    if (v.ok) {
      busy = true;
      replace(fb, h('p', { class: 'pr-res is-ok' }, t('practice.check.right')));
      reveal.classList.add('is-open');
      void fxCorrect(answerEl, { hold: 0 });
      void fling(prompt, knowTo(), { duration: 420 });
      drawCounts();
      announce(t('practice.sort.rightMarked', { word: form(w) }));
      const i0 = S.i;   // typing may already have moved on (onKey): only this word's hold ends here
      setTimeout(() => { if (S.i !== i0) return; busy = false; if (alive && S.phase === 'feedback') next(); }, reduced() ? 250 : 650);
      return;
    }
    replace(fb, h('p', { class: 'pr-res is-bad' }, t('practice.wrong')),
      h('p', { class: 'pr-diff answer-key', lang: langAttr(), dir: dirAttr() }, h('span', { class: 'caption' }, t('practice.rightIs')), ' ', v.right),
      h('p', { class: 'caption' }, t(recheck ? 'practice.sort.wrongRecheck' : 'practice.sort.wrongLearn')));
    replace(panel, wordPanel(cardOf(w), { head: false }));
    typoBtn.hidden = false;
    fxWrong(answerEl, { revealEl: /** @type {any} */ (reveal) });
    reveal.classList.add('is-open');
    knowLabel.textContent = t('practice.sort.next'); checkKb.textContent = knowLabel.textContent;
    void fling(prompt, learnTo(), { duration: 420 });
    // the answer, the word panel and "I knew it, typo" open above the field: into view
    const show = () => { if (alive) revealEl(reveal, { block: 'end', avoid: answerEl }); };
    requestAnimationFrame(show); setTimeout(show, 320);
    drawCounts();
    announce(`${t('practice.wrong')}. ${t('practice.rightIs')} ${v.right}. ${t(recheck ? 'practice.sort.wrongRecheck' : 'practice.sort.wrongLearn')}`);
  }
  function typo() {
    if (!S.typo()) return;
    typoBtn.hidden = true;
    replace(fb, h('p', { class: 'pr-res is-ok' }, t('practice.sort.typoMarked')));
    drawCounts();
    haptic();
    announce(t('practice.sort.typoMarked'));
    next();
  }
  function next() {
    if (!S.next()) { drawCounts(); tfill.style.setProperty('--p', '1'); finished = true; summary(); return; }
    drawWord();
  }
  function skip() {
    if (finished || busy || !S.skip()) return;
    after();
  }
  function undo() {
    if (finished || busy) return;
    const p = S.undo();
    if (!p) return;
    drawCounts();
    drawWord();
    announce(t('practice.sort.undone', { word: form(word(p.id)) }));
  }
  function end() {
    if (finished) return;
    finished = true;
    if (!S.picks.some(p => p.choice !== 'skip')) { cleanup(); ctx.go(backTo.slice(1)); return; }
    summary();
  }

  function summary() {
    cleanup();
    const n = S.counts();
    const known = S.picks.filter(p => p.choice === 'know'), learn = S.picks.filter(p => p.choice === 'learn');
    const studyIds = learn.map(p => p.id).slice(0, 12);
    const f0 = ctx.query.get('from') || '';
    const from = f0 === 'map' || groupBack(f0) ? `&from=${encodeURIComponent(f0)}` : '';
    const undoAll = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => {
      const m = known.reduce((s, p) => s + (p.res ? unmarkCards(ctx, p.res.entries) : 0), 0);
      undoAll.remove();
      ctx.toast(t('practice.sort.undoneAll', { n: m }));
    } }, t('practice.sort.undoAll'));
    // the words he can recheck by typing now: the Learn picks of this sort and of earlier ones
    const again = recheck ? [] : recheckWords(store, k, word).filter(id => !known.some(p => p.id === id));
    const lines = recheck
      ? [t('practice.sort.recheckSummary', { known: n.know, stay: n.stay }), n.stay ? t('practice.sort.recheckStay', { n: n.stay }) : null]
      : [t('practice.sort.summary', { known: n.know, learn: n.learn }), n.typed ? t('practice.sort.typed', { n: n.typed }) : null,
        learn.length ? t('practice.sort.learnNext', { n: learn.length }) : null];
    if (n.skip) lines.push(t('practice.sort.skipped', { n: n.skip }));
    if (n.left) lines.push(t('practice.sort.left', { n: n.left }));
    const hero = doneHero({ label: t('practice.sort.titleOf', { name }), figure: known.length, of: t('practice.sort.ofKnown'), lines });
    replace(el, h('div', { class: 'practice pr-done stack qs-done' }, hero.el,
      h('div', { class: 'pr-done-actions' },
        studyIds.length ? h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=cluster%3Apick&ids=${encodeURIComponent(studyIds.join(','))}${from}` }, t('practice.sort.study', { n: studyIds.length })) : null,
        again.length ? h('a', { class: 'btn pressable', id: 'qs-recheck', href: `#/practice/sort?recheck=1&from=${f0 === 'lookup' ? 'lookup' : 'sort'}` }, t('practice.sort.recheck', { n: again.length })) : null,
        h('a', { class: ['btn', 'pressable', !studyIds.length && 'btn-primary'], href: backTo, id: 'qs-done' }, t('practice.done')),
        known.length ? undoAll : null)));
    const stop = hero.start();
    addEventListener('hashchange', stop, { once: true });
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || finished || e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); end(); return; }
    if (produce()) {
      // the answer field has the focus: letters are the answer, so the other keys take ⌥ (e.code: ⌥ changes e.key on a Mac)
      if (e.altKey) {
        const act = { KeyZ: undo, KeyS: skip, KeyT: typo, KeyL: right }[e.code];
        if (act) { e.preventDefault(); act(); }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); left(); return; }
      // after a check, typing moves on (the key lands in the next answer); during the hold after a right answer too
      if (S.phase === 'feedback' && e.key.length === 1) { busy = false; next(); }
      return;
    }
    if (e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('.qs-mode')) return;
    if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); left(); }
    else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); right(); }
    else if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); toggleMeaning(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
  }
  document.addEventListener('keydown', onKey);
  function cleanup() {
    if (!alive) return;
    alive = false;
    document.removeEventListener('keydown', onKey);
    unfit();
  }
  drawWord(false);
  drawCounts();
  if (!produce()) knowBtn.focus({ preventScroll: true });
  // test hook (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__sort = { get i() { return S.i; }, get mode() { return S.mode; }, list, model: (/** @type {string} */ id) => itemOf(id)?.model, undo, end };
  return () => { cleanup(); restore(); };
}
