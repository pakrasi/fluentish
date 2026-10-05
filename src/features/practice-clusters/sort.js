/* Quick sort (#/practice/sort): words flash one at a time, big, and he sorts each with one of two big buttons.
     ?cluster=<type>:<id>     a Word cluster's words (the cluster page's Quick sort)
     ?level=A1                the word list's words of a level (Look up › Words, the spot check that failed)
     ?ids=<word id>,…&title=  words picked elsewhere (the Explore map's group sheet and List)
     &from=map|lookup|cluster|check|map/<type>/<id>   where Done goes back to (map/…: a group page)
   Only words that are not known yet and have no gap ("um … zu") come up, most useful first.

   Know (← or 1) marks the word known through data/known.js (S 60 days, one check in about 60 days, spread over the
   batch, never a new item of the day); Learn (→ or 2) leaves it as it is, so it comes into the rounds as a new word as
   usual. The meaning shows on demand (Space, or a tap on the word). Z undoes the last choice. About a second a word.
   Motion (core/motion.js fling): the word flies on a short arc into the Know or Learn button, whose count lands with
   the pop spring, while the next word rises in its place; reduced motion: the counts change, nothing flies.
   The summary is the shared done hero: "Marked 142 known, 38 to learn", Study the words to learn now, Done. */
import { wordMeta, wordPanel } from '../../core/wordpanel.js';
import { wordCard } from '../../domain/wordcard.js';
import { h, replace, announce } from '../../core/dom.js';
import { fling, reduced, haptic } from '../../core/motion.js';
import { doneHero } from '../shared/done-hero.js';
import { loadClusters, loadKnowledge } from '../shared/cluster-data.js';
import { form, groupBack } from '../shared/cluster-items.js';
import { sortList, sortSource } from './pick.js';
import { markWords, unmarkCards } from '../../data/known.js';
import { langAttr } from '../../core/lang.js';

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
  const src = sortSource(ctx.query);
  const backTo = backOf(ctx.query, src);
  document.body.dataset.chrome = 'off';
  document.body.classList.add('pr-in-round');
  const restore = () => { document.body.dataset.chrome = 'on'; document.body.classList.remove('pr-in-round'); };
  const page = (/** @type {any[]} */ ...kids) => h('div', { class: 'practice pr-done stack' }, ...kids);
  replace(el, page(h('h1', null, t('practice.sort.title')), h('p', { class: 'caption' }, t('practice.sort.loading'))));
  let data, k;
  try { [data, k] = await Promise.all([loadClusters(ctx), loadKnowledge(ctx)]); } catch {
    restore();
    replace(el, page(h('h1', null, t('practice.sort.title')), h('p', null, t('practice.sort.loadFailed')), h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn pressable', href: backTo }, t('practice.done')))));
    return restore;
  }
  const word = (/** @type {string} */ id) => data.ix.word(id);
  /** @type {string[]} */ let order = [];
  let name = t('practice.sort.words');
  if (src?.kind === 'cluster') {
    const cl = data.ix.byKey.get(src.key);
    if (cl) { order = cl.items; name = cl.label; }
  } else if (src?.kind === 'level') {
    order = data.words.filter((/** @type {any} */ w) => w.level === src.level).sort((/** @type {any} */ a, /** @type {any} */ b) => (b.zipf || 0) - (a.zipf || 0)).map((/** @type {any} */ w) => w.id);
    name = t('practice.sort.level', { level: src.level });
  } else if (src?.kind === 'ids') {
    order = src.ids || [];
    if (src.title) name = src.title;
  }
  const list = sortList(order, word, id => k.get(id));
  if (!list.length) {
    restore();
    replace(el, page(h('p', { class: 'label' }, t('practice.sort.titleOf', { name })), h('h1', null, t('practice.sort.none')), h('p', { class: 'lead' }, t('practice.sort.noneLead')),
      h('div', { class: 'pr-done-actions' }, h('a', { class: 'btn btn-primary pressable', href: backTo }, t('practice.done')))));
    return restore;
  }

  // ---------- layout ----------
  const total = list.length;
  /** @type {{id: string, choice: 'know' | 'learn', res: any}[]} */ const picks = [];
  let i = 0, showing = false, alive = true, finished = false;
  const tfill = h('span', { class: 'fill' });
  const count = h('span', { class: 'caption tnum' });
  const undoBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable qs-undo', onclick: () => undo(), disabled: true }, t('practice.sort.undo'), h('kbd', null, 'Z'));
  const endBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable pr-end', onclick: () => end() }, t('practice.sort.end'), h('kbd', null, 'Esc'));
  const top = h('div', { class: 'pr-top qs-top' }, h('div', { class: 'track qs-track', 'aria-hidden': 'true' }, tfill),
    h('div', { class: 'pr-top-row' }, h('span', { class: 'label qs-name' }, t('practice.sort.titleOf', { name })), count),
    h('div', { class: 'pr-top-row qs-tools' }, undoBtn, endBtn));
  const art = h('span', { class: 'qs-art' });
  const lemma = h('span', { class: 'qs-lemma' });
  const wordEl = h('button', { type: 'button', class: 'qs-word', lang: langAttr(), 'aria-describedby': 'qs-gloss', onclick: () => toggleMeaning() }, art, lemma);
  const gloss = h('p', { class: 'qs-gloss', id: 'qs-gloss', 'aria-live': 'polite' });
  const meaningBtn = h('button', { type: 'button', class: 'btn btn-quiet pressable qs-meaning', 'aria-expanded': 'false', onclick: () => toggleMeaning() }, t('practice.sort.meaning'), h('kbd', null, 'Space'));
  const level = h('div', { class: 'qs-level' });
  const panel = h('div', { class: 'qs-panel' });
  const stage = h('div', { class: 'qs-stage' }, level, wordEl, gloss, panel, meaningBtn);
  /** The word panel's card for a list word (domain/wordcard.js). @param {any} w */
  const cardOf = w => (data.fx ? wordCard(data.fx.ix, { lemma: w.w, pos: w.pos, id: `W:${w.id}`, zipf: w.zipf, level: w.level, verbs: data.fx.verbs }).card
    : { type: 'word', head: form(w), forms: null, pres: null, plural: null, pluralNote: null, level: w.level || null, zipf: w.zipf ?? null, ex: w.ex || null, exAt: null, exSrc: null, exEn: w.exen || null, conf: null });
  const knowN = h('span', { class: 'qs-n tnum' }, '0');
  const learnN = h('span', { class: 'qs-n tnum' }, '0');
  const knowBtn = h('button', { type: 'button', class: 'qs-btn is-know pressable', onclick: () => choose('know') },
    h('span', { class: 'qs-btn-top' }, h('kbd', null, '←'), h('span', { class: 'qs-btn-label' }, t('practice.sort.know'))), h('span', { class: 'qs-stack' }, knowN));
  const learnBtn = h('button', { type: 'button', class: 'qs-btn is-learn pressable', onclick: () => choose('learn') },
    h('span', { class: 'qs-btn-top' }, h('span', { class: 'qs-btn-label' }, t('practice.sort.learn')), h('kbd', null, '→')), h('span', { class: 'qs-stack' }, learnN));
  const how = h('p', { class: 'caption qs-how' }, t('practice.sort.how'));
  const actions = h('div', { class: 'qs-actions' }, h('div', { class: 'qs-btns' }, knowBtn, learnBtn), how);
  const box = h('div', { class: 'pr-round qs-round', role: 'region', 'aria-label': t('practice.sort.title') }, top, h('div', { class: 'pr-scroll qs-scroll' }, stage), actions);
  const h1 = h('h1', { class: 'sr-only' }, t('practice.sort.titleOf', { name }));
  replace(el, h1, box, h('p', { class: 'sr-only' }, t('practice.sort.keys')));
  const vv = window.visualViewport;
  const fit = () => { box.style.height = `${vv ? vv.height : innerHeight}px`; };
  vv?.addEventListener('resize', fit); addEventListener('resize', fit); fit();

  function drawWord(enter = true) {
    const w = word(list[i]);
    art.textContent = w.pos === 'noun' && /^(der|die|das)$/.test(w.art) ? `${w.art} ` : '';
    lemma.textContent = w.w;
    wordEl.setAttribute('aria-label', form(w));
    gloss.textContent = ''; showing = false; meaningBtn.setAttribute('aria-expanded', 'false');
    replace(meaningBtn, t('practice.sort.meaning'), h('kbd', null, 'Space'));
    replace(level, wordMeta(cardOf(w)));
    replace(panel);
    count.textContent = t('practice.sort.count', { n: i + 1, total });
    tfill.style.setProperty('--p', String(i / total));
    if (enter && !reduced()) { stage.classList.remove('fx-in-up'); void stage.offsetWidth; stage.classList.add('fx-in-up'); }
    announce(t('practice.sort.announceWord', { word: form(w), n: i + 1, total }));
  }
  function toggleMeaning() {
    if (finished) return;
    const w = word(list[i]);
    showing = !showing;
    gloss.textContent = showing ? (w.en || []).slice(0, 3).join('; ') : '';
    replace(panel, showing ? wordPanel(cardOf(w), { head: false }) : null);
    meaningBtn.setAttribute('aria-expanded', String(showing));
    replace(meaningBtn, t(showing ? 'practice.sort.hide' : 'practice.sort.meaning'), h('kbd', null, 'Space'));
  }
  /** @param {'know' | 'learn'} choice */
  function choose(choice) {
    if (finished || !alive) return;
    const id = list[i];
    // the copy of the word flies into its button while the next word takes its place
    void fling(wordEl, choice === 'know' ? knowN : learnN, { duration: 420 });
    const res = choice === 'know' ? markWords(ctx, [id], { batch: total }) : null;
    picks.push({ id, choice, res });
    haptic();
    const nk = picks.filter(p => p.choice === 'know').length;
    knowN.textContent = String(nk); learnN.textContent = String(picks.length - nk);
    undoBtn.disabled = false;
    i++;
    if (i >= total) { tfill.style.setProperty('--p', '1'); setTimeout(() => summary(), reduced() ? 0 : 440); finished = true; return; }
    drawWord();
  }
  function undo() {
    if (!picks.length || finished) return;
    const p = /** @type {{id: string, choice: string, res: any}} */ (picks.pop());
    if (p.res) unmarkCards(ctx, p.res.entries);
    i = list.indexOf(p.id);
    const nk = picks.filter(x => x.choice === 'know').length;
    knowN.textContent = String(nk); learnN.textContent = String(picks.length - nk);
    undoBtn.disabled = !picks.length;
    drawWord();
    announce(t('practice.sort.undone', { word: form(word(p.id)) }));
  }
  function end() {
    if (finished) return;
    finished = true;
    if (!picks.length) { cleanup(); ctx.go(backTo.slice(1)); return; }
    summary();
  }

  function summary() {
    cleanup();
    const known = picks.filter(p => p.choice === 'know'), learn = picks.filter(p => p.choice === 'learn');
    const left = total - picks.length;
    const studyIds = learn.map(p => p.id).slice(0, 12);
    const f0 = ctx.query.get('from') || '';
    const from = f0 === 'map' || groupBack(f0) ? `&from=${encodeURIComponent(f0)}` : '';
    const undoAll = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => {
      const n = known.reduce((s, p) => s + (p.res ? unmarkCards(ctx, p.res.entries) : 0), 0);
      undoAll.remove();
      ctx.toast(t('practice.sort.undoneAll', { n }));
    } }, t('practice.sort.undoAll'));
    const hero = doneHero({ label: t('practice.sort.titleOf', { name }), figure: known.length, of: t('practice.sort.ofKnown'),
      lines: [t('practice.sort.summary', { known: known.length, learn: learn.length }), learn.length ? t('practice.sort.learnNext', { n: learn.length }) : null,
        left ? t('practice.sort.left', { n: left }) : null] });
    replace(el, h('div', { class: 'practice pr-done stack qs-done' }, hero.el,
      h('div', { class: 'pr-done-actions' },
        studyIds.length ? h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=cluster%3Apick&ids=${encodeURIComponent(studyIds.join(','))}${from}` }, t('practice.sort.study', { n: studyIds.length })) : null,
        h('a', { class: ['btn', 'pressable', !studyIds.length && 'btn-primary'], href: backTo, id: 'qs-done' }, t('practice.done')),
        known.length ? undoAll : null)));
    const stop = hero.start();
    addEventListener('hashchange', stop, { once: true });
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || finished) return;
    if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); choose('know'); }
    else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); choose('learn'); }
    else if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); toggleMeaning(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
    else if (e.key === 'Escape') { e.preventDefault(); end(); }
  }
  document.addEventListener('keydown', onKey);
  function cleanup() {
    if (!alive) return;
    alive = false;
    document.removeEventListener('keydown', onKey);
    vv?.removeEventListener('resize', fit); removeEventListener('resize', fit);
  }
  drawWord(false);
  knowBtn.focus({ preventScroll: true });
  // test hook (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) /** @type {any} */ (window).__sort = { choose, undo, end, get i() { return i; }, list };
  return () => { cleanup(); restore(); };
}
