/* Script mode: mark the words you don't know (#/practice/scripts/<id>/mark/<section>, SCRIPT-UX §3.5).

   One section at a time in Newsreader, every word a 44 px tap target. Suggested words carry a dotted underline;
   "Mark N suggested" marks them all. A tap marks a word: the accent underline sweeps in, a copy of the word lifts and
   flies into the tray at the bottom, the count ticks (motion moment 1). A tap on a marked word opens its sheet
   (lemma, meaning, level, unmark), so a stray tap never loses a meaning. Names and English terms are not tappable; a
   long press makes one tappable. The tray lists every marked word; "Get meanings" asks Claude for the ones the word
   list has no meaning for (the only Claude call of phase 1). */
import { h, replace, announce } from '../../../core/dom.js';
import { icon } from '../../../core/icons.js';
import { flip, countTo, haptic, reduced } from '../../../core/motion.js';
import * as FS from '../../../domain/fsrs.js';
import * as P from './parse.js';
import * as St from './store.js';
import { lexicon } from './lexicon.js';
import { classify, cardId } from './suggest.js';
import { lemmaOf, glossOf, headOf } from './lemma.js';
import { getMeanings } from './meanings.js';
import { say, hasVoice } from './voice.js';
import { back, sheet, fullScreen } from './ui.js';

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {any} script0 @param {string | null} sectionId */
export async function mountMark(el, ctx, script0, sectionId) {
  const { t, store } = ctx;
  const restore = fullScreen();
  let script = script0;
  const secIndex = Math.max(0, script.sections.findIndex((/** @type {any} */ s) => s.id === sectionId));
  const section = script.sections[secIndex];
  if (!sectionId || sectionId !== section.id) { ctx.go(`/practice/scripts/${script.id}/mark/${section.id}`, { replace: true }); return restore; }
  replace(el, h('div', { class: 'practice stack sc-mark' }, h('p', { class: 'caption' }, t('practice.loading'))));
  const L = await lexicon(ctx);
  const c = ctx.clock.ctx();
  const settings = ctx.settings();
  const cards = St.cardOf(store);
  const card = (/** @type {string} */ id) => { const x = cards(id); return x && x.rec && x.rec.reps ? { r: FS.Ron(x.rec, c.today), lapses: x.rec.lapses || 0 } : null; };
  const save = () => { St.put(store, script); };
  const markedLemmas = () => new Set((script.marks || []).map((/** @type {any} */ m) => String(m.lemma).toLowerCase()));

  // ---------- the text ----------
  /** @type {Map<HTMLElement, {sent: any, tok: any, cls: any}>} */ const words = new Map();
  const textEl = h('div', { class: 'sc-text', lang: 'de' });
  function drawText() {
    words.clear();
    const marked = markedLemmas();
    const ctxS = { idx: L.idx, lexicon: L.lexicon, level: settings.level || 'B1', names: new Set(script.names || []), unmarked: new Set(script.unmarked || []),
      forced: new Set(script.forced || []), card, wordmap: L.wordmap };
    const sugSeen = new Set();
    /** @type {any[]} */ const paras = [];
    let para = /** @type {any[]} */ ([]);
    section.sentences.forEach((/** @type {any} */ sent, /** @type {number} */ si) => {
      if (sent.p && para.length) { paras.push(para); para = []; }
      const toks = P.tokenize(sent.de);
      const cls = classify(toks, ctxS);
      const kids = toks.map((tok, i) => {
        const x = cls[i];
        const space = tok.sp ? ' ' : '';
        if (x.type === 'skip') return space + tok.t;
        if (x.type === 'name') {
          const s = h('span', { class: 'sc-name', title: t('practice.script.mark.nameHint') }, tok.t);
          longPress(s, () => { script = { ...script, forced: [...new Set([...(script.forced || []), tok.t.toLowerCase()])] }; save(); drawText(); announce(t('practice.script.mark.nowTappable', { word: tok.t })); });
          return [space, s];
        }
        const key = x.lemma.toLowerCase();
        const isMarked = marked.has(key);
        const sug = !isMarked && x.suggest && !sugSeen.has(key);
        if (sug) sugSeen.add(key);
        const b = h('button', { type: 'button', class: ['sc-w', isMarked && 'is-marked', sug && 'is-sug'], dataset: { lemma: key },
          'aria-pressed': String(isMarked), onclick: () => onWord(b) }, tok.t);
        words.set(b, { sent, tok, cls: x });
        return [space, b];
      });
      para.push(h('span', { class: 'sc-sent', dataset: { s: String(si) } }, kids), ' ');
    });
    if (para.length) paras.push(para);
    replace(textEl, paras.map(p => h('p', { class: 'sc-para' }, p)));
    drawActions();
  }

  // ---------- tray ----------
  const countEl = h('b', { class: 'tnum sc-tray-n' }, '0');
  const peekList = h('span', { class: 'sc-tray-list' });
  const trayBtn = h('button', { type: 'button', class: 'sc-tray pressable', 'aria-haspopup': 'dialog', onclick: () => openTray() },
    icon('next', { size: 16 }), h('span', { class: 'sc-tray-text' }, countEl, ' ', h('span', { class: 'sc-tray-label' }, t('practice.script.mark.marked')), peekList));
  function drawTray(/** @type {string | null} */ added = null) {
    const ms = script.marks || [];
    const n = new Set(ms.map((/** @type {any} */ m) => m.cardId)).size;
    countTo(countEl, n, { duration: 600 });
    const recent = [...ms].reverse().map((/** @type {any} */ m) => m.lemma).filter((/** @type {string} */ x, /** @type {number} */ i, /** @type {string[]} */ a) => a.indexOf(x) === i).slice(0, 3);
    replace(peekList, recent.map((l, i) => h('span', { class: ['sc-tray-lemma', added && i === 0 && l === added && !reduced() && 'fx-rise'], lang: 'de' }, l)));
    trayBtn.setAttribute('aria-label', t('practice.script.mark.trayLabel', { n }));
  }

  // ---------- actions ----------
  const sugBtn = h('button', { type: 'button', class: 'btn pressable sc-sugbtn', onclick: () => markSuggested() });
  const last = secIndex === script.sections.length - 1;
  const nextBtn = h('button', { type: 'button', class: ['btn', 'pressable', 'sc-next', last && 'btn-primary'], onclick: () => finish() },
    last ? t('practice.script.mark.done') : [t('practice.script.mark.next'), icon('next', { size: 16 })]);
  function drawActions() {
    const n = [...words.keys()].filter(b => b.classList.contains('is-sug')).length;
    sugBtn.hidden = !n;
    sugBtn.textContent = t('practice.script.mark.markSuggested', { n });
    sugBtn.classList.toggle('btn-primary', !!n);
    nextBtn.classList.toggle('btn-primary', !n || last);
  }

  // ---------- marking ----------
  /** @param {HTMLElement} b */
  function onWord(b) {
    const w = words.get(b);
    if (!w) return;
    if (b.classList.contains('is-marked')) { openWord(w.cls.lemma.toLowerCase()); return; }
    haptic();
    mark([b]);
  }
  /** @param {HTMLElement[]} list */
  function mark(list) {
    const marked = markedLemmas();
    /** @type {any[]} */ const add = [];
    const make = P.idMaker((script.marks || []).map((/** @type {any} */ m) => m.id));
    for (const b of list) {
      const w = words.get(b);
      if (!w) continue;
      const key = w.cls.lemma.toLowerCase();
      if (marked.has(key)) continue;
      marked.add(key);
      const L1 = w.cls.entry ? { lemma: w.cls.lemma, entry: w.cls.entry } : lemmaOf(w.tok.t, L.idx, { start: w.tok.k === 0 });
      add.push({ id: make(), kind: 'word', sentenceId: w.sent.id, start: w.tok.k, end: w.tok.k, surface: w.tok.t, lemma: L1.lemma, head: headOf(L1.entry, L1.lemma),
        level: L1.entry?.level || null, gloss: glossOf(L1.entry), glossFrom: L1.entry && glossOf(L1.entry) ? 'list' : null, cardId: cardId(L1.lemma, L1.entry, L.wordmap) });
    }
    if (!add.length) return;
    script = { ...script, marks: [...(script.marks || []), ...add], unmarked: (script.unmarked || []).filter((/** @type {string} */ x) => !add.some(a => a.lemma.toLowerCase() === x)) };
    save();
    // every occurrence of the lemma in this section shows as marked; the tapped ones lift into the tray
    const keys = new Set(add.map(a => a.lemma.toLowerCase()));
    for (const [b] of words) if (keys.has(String(b.dataset.lemma))) { b.classList.remove('is-sug'); b.classList.add('is-marked'); b.setAttribute('aria-pressed', 'true'); }
    list.slice(0, 8).forEach((b, i) => setTimeout(() => lift(b), reduced() ? 0 : i * 28));
    drawTray(add[add.length - 1].lemma);
    drawActions();
    announce(add.length === 1 ? t('practice.script.mark.markedOne', { word: add[0].lemma }) : t('practice.script.mark.markedN', { n: add.length }));
  }
  function markSuggested() {
    const list = [...words.keys()].filter(b => b.classList.contains('is-sug'));
    if (list.length) { haptic(); mark(list); }
  }
  /** A copy of the word rises 8 px and flies into the tray (flip, card duration, snappy spring), shrinking and fading. @param {HTMLElement} b */
  function lift(b) {
    if (reduced()) return;
    const r = b.getBoundingClientRect(), to = countEl.getBoundingClientRect();
    if (!r.width || !to.width) return;
    const clone = h('span', { class: 'sc-lift', lang: 'de', 'aria-hidden': 'true', style: { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` } }, b.textContent);
    document.body.append(clone);
    requestAnimationFrame(() => {
      clone.classList.add('is-up');
      setTimeout(() => {
        flip([clone], () => {
          clone.classList.remove('is-up'); clone.classList.add('is-gone');
          clone.style.left = `${to.left + to.width / 2 - r.width / 2}px`; clone.style.top = `${to.top + to.height / 2 - r.height / 2}px`;
        });
        setTimeout(() => clone.remove(), 460);
      }, 110);
    });
  }

  // ---------- the word sheet ----------
  /** @param {string} key lower-case lemma */
  function openWord(key) {
    const m = (script.marks || []).find((/** @type {any} */ x) => String(x.lemma).toLowerCase() === key);
    if (!m) return;
    const count = script.sections.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.sentences.reduce((/** @type {number} */ k, /** @type {any} */ x) =>
      k + P.tokenize(x.de).filter(tk => tk.w && lemmaOf(tk.t, L.idx).lemma.toLowerCase() === key).length, 0), 0);
    const lemmaIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', value: m.lemma, lang: 'de', autocomplete: 'off', 'aria-label': t('practice.script.word.lemma') }));
    const lemmaRow = h('div', { class: 'sc-lemma-edit', hidden: true }, lemmaIn,
      h('button', { type: 'button', class: 'btn pressable', onclick: () => { changeLemma(m, lemmaIn.value.trim()); sh.close(); } }, t('practice.script.save')));
    const meaning = /** @type {HTMLInputElement} */ (h('input', { class: 'input', value: m.gloss || '', autocomplete: 'off', placeholder: t('practice.script.word.meaningPh'), 'aria-label': t('practice.script.word.meaning') }));
    meaning.addEventListener('change', () => setGloss(m.cardId, meaning.value.trim() || null, 'me'));
    const sh = sheet({ title: m.head || m.lemma, cls: 'sc-word-sheet', children: [
      h('div', { class: 'sc-word-head' },
        hasVoice() ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => say(m.lemma) }, icon('play', { size: 18 }), t('practice.script.word.play')) : null,
        h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-expanded': 'false', onclick: (/** @type {Event} */ e) => { lemmaRow.hidden = !lemmaRow.hidden; /** @type {HTMLElement} */ (e.currentTarget).setAttribute('aria-expanded', String(!lemmaRow.hidden)); if (!lemmaRow.hidden) lemmaIn.focus(); } }, t('practice.script.change'))),
      lemmaRow,
      h('label', { class: 'field-label' }, t('practice.script.word.meaning'), meaning),
      h('p', { class: 'caption' }, m.level ? h('span', { class: 'sc-level' }, m.level) : null, m.level ? ' ' : null,
        t('practice.script.word.count', { n: Math.max(1, count) }), m.glossFrom === 'claude' ? ` · ${t('practice.script.word.fromClaude')}` : ''),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn pressable sc-unmark', onclick: () => { unmark(key); sh.close(); } }, t('practice.script.word.unmark'))),
    ] });
  }
  /** @param {string} id card id @param {string | null} gloss @param {string} from */
  function setGloss(id, gloss, from) {
    script = { ...script, marks: script.marks.map((/** @type {any} */ x) => (x.cardId === id ? { ...x, gloss, glossFrom: gloss ? from : null } : x)) };
    save(); drawTray();
  }
  /** @param {any} m @param {string} next */
  function changeLemma(m, next) {
    if (!next || next === m.lemma) return;
    const entry = (L.idx.lemmas.get(next.toLowerCase()) || [])[0] || null;
    const hasReviews = !!cards(m.cardId)?.rec?.reps;
    const id = hasReviews ? m.cardId : cardId(next, entry, L.wordmap);   // a card with reviews keeps its id
    script = { ...script, marks: script.marks.map((/** @type {any} */ x) => (x.cardId === m.cardId ? { ...x, lemma: next, head: headOf(entry, next), level: entry?.level || x.level,
      gloss: x.gloss || glossOf(entry), glossFrom: x.gloss ? x.glossFrom : (glossOf(entry) ? 'list' : null), cardId: id } : x)) };
    save(); drawText(); drawTray();
  }
  /** @param {string} key */
  function unmark(key) {
    script = { ...script, marks: (script.marks || []).filter((/** @type {any} */ x) => String(x.lemma).toLowerCase() !== key), unmarked: [...new Set([...(script.unmarked || []), key])] };
    save(); drawText(); drawTray();
    announce(t('practice.script.word.unmarked'));
  }

  // ---------- the tray sheet ----------
  function openTray() {
    const body = h('div', { class: 'sc-traysheet' });
    const sh = sheet({ title: t('practice.script.tray.title'), children: [body] });
    function draw() {
      const byCard = new Map();
      for (const m of script.marks || []) if (!byCard.has(m.cardId)) byCard.set(m.cardId, m);
      const list = [...byCard.values()];
      const missing = list.filter(m => !m.gloss);
      const key = !!(store.get('secrets', {}) || {}).anthropicKey;
      const status = h('p', { class: 'caption', 'aria-live': 'polite' });
      replace(body,
        list.length ? null : h('p', { class: 'lead' }, t('practice.script.tray.empty')),
        missing.length ? h('div', { class: 'sc-missing' },
          h('p', { class: 'label' }, t('practice.script.tray.missing', { n: missing.length })),
          key ? [h('p', { class: 'caption' }, t('practice.script.tray.sent')),
            h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: async (/** @type {Event} */ e) => {
              const b = /** @type {HTMLButtonElement} */ (e.currentTarget); b.disabled = true; b.textContent = t('practice.script.tray.getting');
              try {
                const ws = missing.map(m => ({ surface: m.surface, lemma: m.lemma, sentence: sentenceOf(m.sentenceId) }));
                const res = await getMeanings({ key: store.get('secrets', {}).anthropicKey, words: ws });
                missing.forEach((m, i) => {
                  const r = res.get(i + 1); if (!r) return;
                  const entry = (L.idx.lemmas.get(r.lemma.toLowerCase()) || [])[0] || null;
                  const keep = !!cards(m.cardId)?.rec?.reps;
                  const id = keep ? m.cardId : cardId(r.lemma, entry, L.wordmap);
                  script = { ...script, marks: script.marks.map((/** @type {any} */ x) => (x.cardId === m.cardId ? { ...x, lemma: r.lemma, head: r.art ? `${r.art} ${r.lemma}` : headOf(entry, r.lemma), gloss: r.en, glossFrom: 'claude', cardId: id } : x)) };
                });
                save(); drawTray(); drawText(); draw();
                const left = (script.marks || []).filter((/** @type {any} */ m) => !m.gloss).length;
                announce(left ? t('practice.script.tray.partly', { n: left }) : t('practice.script.tray.got'));
              } catch (err) {
                b.disabled = false; b.textContent = t('practice.script.tray.get');
                status.textContent = t(`practice.script.err.${/** @type {any} */ (err)?.code || 'other'}`);
              }
            } }, t('practice.script.tray.get')), status]
            : h('p', { class: 'caption' }, t('practice.script.tray.noKey'))) : null,
        h('ul', { class: 'list sc-traylist' }, list.map(m => {
          const inp = /** @type {HTMLInputElement} */ (h('input', { class: 'input', value: m.gloss || '', placeholder: t('practice.script.word.meaningPh'), 'aria-label': t('practice.script.tray.meaningOf', { word: m.lemma }) }));
          inp.addEventListener('change', () => { setGloss(m.cardId, inp.value.trim() || null, 'me'); });
          return h('li', { class: 'sc-trayitem' }, h('div', { class: 'sc-trayitem-top' }, h('span', { class: 'sc-traylemma', lang: 'de' }, m.head || m.lemma),
            h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-label': t('practice.script.tray.unmarkOf', { word: m.lemma }), onclick: () => { unmark(String(m.lemma).toLowerCase()); draw(); } }, icon('close', { size: 16 }))),
          m.glossFrom === 'list' ? h('p', { class: 'caption' }, m.gloss) : inp);
        })));
    }
    draw();
    void sh;
  }
  /** @param {string} id */
  const sentenceOf = id => script.sections.flatMap((/** @type {any} */ s) => s.sentences).find((/** @type {any} */ s) => s.id === id)?.de || '';

  function finish() {
    St.updateProgress(store, script.id, p => ({ ...p, sections: { ...p.sections, [section.id]: { ...(p.sections[section.id] || {}), marked: c.today } } }));
    const next = script.sections[secIndex + 1];
    ctx.go(next ? `/practice/scripts/${script.id}/mark/${next.id}` : `/practice/scripts/${script.id}`);
  }

  const view = h('div', { class: 'practice sc-mark' },
    h('div', { class: 'sc-headrow' }, back(`#/practice/scripts/${script.id}`, script.title), h('span', { class: 'caption tnum' }, t('practice.script.sectionOf', { n: secIndex + 1, total: script.sections.length }))),
    h('h1', { class: 'sc-mark-title' }, section.title),
    h('p', { class: 'caption sc-mark-help' }, t('practice.script.mark.help')),
    textEl,
    h('div', { class: 'sc-mark-dock' }, h('div', { class: 'sc-mark-actions' }, sugBtn, nextBtn), trayBtn));
  replace(el, view);
  drawText(); drawTray();
  return () => { restore(); document.querySelectorAll('.sc-lift').forEach(x => x.remove()); };
}

/** Long press (500 ms, no movement) on an element. @param {HTMLElement} el @param {() => void} fn */
function longPress(el, fn) {
  let timer = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', () => { cancel(); timer = window.setTimeout(fn, 500); });
  el.addEventListener('pointerup', cancel); el.addEventListener('pointerleave', cancel); el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); fn(); });
}
