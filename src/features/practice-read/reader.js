/* Reading: the reader (#/practice/read/<id>, a graded text at #/practice/read/lib/<slug>). The text front and centre
   in Newsreader; every word a tap target.

     Study (intensive)   the strongest unknown words dotted (at most 12 % of the words), phrase bands under the word
                         list's multi-word items, a full word sheet, Questions at the end
     Read on (extensive) no marks; a tap shows the meaning and "Add to review" only; Done at the end

   The word sheet: the dictionary form (a separable verb joined across its clause, both halves lit), its type, level
   and how common it is, his state, the meaning, the forms and the word list's example (core/wordpanel.js), his
   sentence with the word marked, Add to review, Translate sentence (Claude, with his key, after the line that says
   so) and Mark a phrase. Saving lifts the word into the tray at the bottom (core/motion.js fling).

   Saving (features/shared/read-data.js): the item goes to read.words, its sentence to read.ctx (device-only); an item
   with a card in another deck keeps that card, an item with none gets one in the reading deck when it is first
   reviewed; a rare word above his level is kept for reference. Time on this screen counts as reading (activity kind
   'read'); how far down he got is kept per text. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { seg } from '../../core/ui.js';
import { label } from '../../core/clock.js';
import { haptic } from '../../core/motion.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { wordMeta, wordPanel } from '../../core/wordpanel.js';
import { wordCard } from '../../domain/wordcard.js';
import { deckName } from '../../domain/decks.js';
import * as FS from '../../domain/fsrs.js';
import { idMaker } from '../../domain/script/parse.js';
import { ask } from '../../services/claude.js';
import { fill } from '../../services/prompts/index.js';
import { TEMPLATES } from '../../services/prompts/read.js';
import { config } from '../../core/config.js';
import { addActivity } from '../shared/data.js';
import { familyLink } from '../shared/family-link.js';
import * as R from '../shared/read-data.js';
import { textView, sheet, tray, hairline, quote } from '../shared/textview.js';
import * as L from './logic.js';
import { language, knowledgeNow, otherDecks, sectionsFor, gradedText } from './load.js';
import { back, pct, errLine } from './ui.js';
import { levelRank } from '../../domain/text/estimate.js';
import { claude, canAskClaude } from '../../data/credentials.js';

/** Minutes a visit to the reader counts at most (a phone left open on the page is not an hour of reading). */
const VISIT_MAX_MIN = 45;

/** A graded text, opened from the library: its record (an id and his place, no text) is made on first open. @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string} slug */
export async function mountGraded(el, ctx, slug) {
  const lang = ctx.settings().language === 'german' ? 'de' : (await language(ctx)).lang;
  const text = await gradedText(ctx, lang, slug);
  if (!text) {
    replace(el, h('div', { class: 'practice stack' }, back('#/practice/read', ctx.t('read.title')), h('div', { class: 'page-head' }, h('h1', null, ctx.t('read.gone'))),
      h('a', { class: 'btn pressable', href: '#/practice/read' }, ctx.t('read.toLibrary'))));
    return;
  }
  let read = R.listReads(ctx.store).find(r => r.source?.kind === 'graded' && r.source.textId === text.id);
  if (!read) {
    read = { id: idMaker()(), v: 1, lang, title: text.title, source: { kind: 'graded', label: null, textId: text.id }, mode: 'intensive', estimate: null, progress: {}, createdAt: new Date().toISOString(), opened: Date.now(), deletedAt: null };
    R.putRead(ctx.store, read);
  }
  return mountReader(el, ctx, read, { sections: L.gradedSections(text), graded: text });
}

/**
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} read0
 * @param {{sections: any[], graded: any | null}} [given]
 */
export async function mountReader(el, ctx, read0, given) {
  const { t, store } = ctx;
  replace(el, h('div', { class: 'practice stack rd-reader' }, back('#/practice/read', t('read.title')), h('h1', { class: 'rd-title' }, read0.title), h('p', { class: 'caption' }, t('read.loading'))));
  const src = given || await sectionsFor(ctx, read0);
  if (read0.source?.kind === 'graded' && !given) { ctx.go(`/practice/read/lib/${encodeURIComponent(String(read0.source.textId).split('/').pop() || '')}`, { replace: true }); return; }
  const [Lg, K] = await Promise.all([language(ctx), knowledgeNow(ctx)]);
  const { pack, idx, deck } = Lg;
  const c = ctx.clock.ctx();
  const settings = ctx.settings();
  const level = settings.level || 'B1';
  let read = { ...(R.getRead(store, read0.id) || read0), opened: Date.now() };
  const sentences = L.sentencesOf({ sections: src.sections });
  const b1 = store.cards('b1') || {};
  const rd = store.cards(deck) || {};
  const know = K ? (/** @type {string} */ id) => K.get(id).state : null;
  const card = (/** @type {string} */ id) => { const rec = b1[id] || rd[id]; return rec && rec.reps ? { r: FS.Ron(rec, c.today), lapses: rec.lapses || 0 } : null; };
  const has = (/** @type {string} */ id) => !!b1[id]?.reps;
  const view0 = K || { get: () => ({ state: /** @type {const} */ ('unseen') }) };

  // ---------- analysis ----------
  /** @param {boolean} marks */
  const analyse = marks => L.analyse(sentences, { pack, idx, lexicon: Lg.lexicon, level, know, card, has, wordmap: Lg.wordmap, suggest: marks });
  let an = analyse(read.mode !== 'extensive');
  const met = R.metSet(store);
  const est0 = read.estimate && read.estimate.ver === L.ESTIMATE_VER ? read.estimate : { ...L.estimate(analyse(false), { pack, idx, view: view0, level, met }), at: c.today };
  // a graded text has a reviewed level of its own; the estimate's level is for pasted texts (his coverage stays his)
  const est = src.graded && src.graded.level ? { ...est0, level: src.graded.level } : est0;
  read = { ...read, estimate: est };
  R.putRead(store, read);
  // each token's lemma candidates (lower case), for phrase bands and the sheet
  const lemmas = an.map(s => s.toks.map((tk, i) => (tk.w && !tk.num ? L.lemmasAt(pack, idx, s.toks, i).map(x => x.toLowerCase()) : [])));
  const bandsOf = an.map((_, si) => L.phrasesIn(lemmas[si], Lg.phrases));

  // ---------- saved items ----------
  const savedLemmas = () => new Set(Object.values(R.savedWords(store)).map(w => String(w.lemma).toLowerCase()));
  /** The items saved from this text, newest first. */
  const fromHere = () => {
    const ctxs = store.get(R.CTX, {}) || {};
    const ws = R.savedWords(store);
    return Object.keys(ctxs).filter(id => ws[id] && (ctxs[id] || []).some((/** @type {any} */ x) => x.readId === read.id))
      .sort((a, b) => String(ws[b].last).localeCompare(String(ws[a].last)) || 0).map(id => ({ id, w: ws[id] }));
  };

  // ---------- layout ----------
  const trayEl = tray({ onOpen: () => openTray() });
  const drawTray = (/** @type {boolean} */ animate = false) => trayEl.set(fromHere().map(x => x.w.head || x.w.lemma), { animate });
  const primary = h('a', { class: 'btn btn-primary pressable rd-dock-btn' });
  const textSlot = h('div', { class: 'rd-text' });
  /** @type {ReturnType<typeof textView>} */ let tv;
  function drawText() {
    const marks = read.mode !== 'extensive';
    const lit = savedLemmas();
    tv = textView({ sentences: an.map((s, si) => ({ id: sentences[si].id, p: sentences[si].p, toks: s.toks, cls: s.cls, bands: marks ? bandsOf[si].map(b => ({ id: b.phrase.id, at: b.at })) : [] })),
      marks, saved: lemma => lit.has(String(lemma).toLowerCase()), onWord, label: t('read.textLabel'), hint: t('read.textKeys') });
    replace(textSlot, tv.el);
    primary.textContent = marks ? t('read.questions') : t('read.done');
    primary.setAttribute('href', marks ? `#/practice/read/${read.id}/questions` : `#/practice/read/${read.id}/done`);
  }
  const modeSeg = seg({ label: t('read.mode'), value: read.mode === 'extensive' ? 'extensive' : 'intensive', options: [['intensive', t('read.mode.study')], ['extensive', t('read.mode.on')]],
    onChange: v => {
      read = { ...read, mode: v === 'extensive' ? 'extensive' : 'intensive' };
      R.putRead(store, read);
      an = analyse(read.mode !== 'extensive');
      drawText();
      announce(t(read.mode === 'extensive' ? 'read.mode.onNow' : 'read.mode.studyNow'));
    } });
  // the head: the title first, then one meta line and a 3 px meter (ink is known, the track the rest, so it needs no
  // legend); the band's advice only when it says something (a stretch or too hard), and "assumed" said plainly
  const known = Math.max(0, Math.min(1, est.coverage));
  const by = est.by || {};
  const assumed = (by.assumed || 0) + (by.read || 0);
  const source = read.source?.kind === 'graded'
    ? t(src.graded?.source ? 'read.meta.literature' : 'read.meta.graded', { level: src.graded?.level || est.level })
    : t('read.meta.pasted', { date: label(String(read.createdAt || c.today).slice(0, 10)) });
  const meta = [[source, t('read.paste.words', { n: est.words })].join(', '), t('read.meta.known', { pct: pct(known) })].join(' · ');
  const n1 = L.oneIn(est.coverage);
  const notes = [
    assumed > (est.known || 0) / 2 ? t('read.est.assumed') : null,
    est.band === 'hard' || est.band === 'stretch' ? [t(`read.band.${est.band}.hint`), n1 >= 5 ? ` ${t('read.est.line', { n: n1 })}` : ''].join('') : null,
  ].filter(Boolean);
  const bar = h('div', { class: 'rd-cov', role: 'img', 'aria-label': t('read.cov.aria', { pct: pct(known) }) },
    h('span', { class: 'rd-cov-known', style: { transform: `scaleX(${known.toFixed(3)})` } }));
  const line = h('div', { class: 'rd-head' }, back('#/practice/read', t('read.title')));
  const hair = hairline(textSlot, s => { share = Math.max(share, s); });
  let share = Number(read.progress?.share) || 0;
  replace(el, h('div', { class: 'practice rd-reader', 'data-title': t('read.title') },
    hair.el,
    line,
    h('header', { class: 'rd-top' },
      h('h1', { class: 'rd-title', lang: langAttr(), dir: dirAttr() }, read.title),
      h('p', { class: 'caption rd-meta tnum' }, meta),
      bar,
      notes.length ? h('p', { class: 'caption rd-note-line' }, notes.join(' ')) : null),
    textSlot,
    h('div', { class: 'rd-end' }, h('p', { class: 'caption' }, t('read.end')),
      h('a', { class: 'btn pressable', href: `#/practice/read/${read.id}/done` }, t('read.finish'))),
    h('div', { class: 'rd-dock' }, h('div', { class: 'rd-dock-in' }, h('div', { class: 'rd-dock-row' }, h('div', { class: 'rd-modes' }, modeSeg), trayEl.el, primary)))));
  drawText();
  drawTray();
  // back to where he stopped
  if (share > 0.05 && share < 0.97) requestAnimationFrame(() => { const r = textSlot.getBoundingClientRect(); scrollTo({ top: Math.max(0, scrollY + r.top + r.height * share - innerHeight * 0.85), behavior: 'instant' }); });

  // ---------- the word sheet ----------
  let looked = 0;
  /** The words he tapped (sentence:token), and their items: never counted as read without a look-up. */
  const tapped = new Set();
  /** @type {Set<string>} */ const looked_ids = new Set();
  /** @param {number} si @param {number} ti @param {HTMLElement} btn */
  function onWord(si, ti, btn) {
    looked++;
    tapped.add(`${si}:${ti}`);
    const e = an[si]?.cls[ti]?.entry;
    if (e && e.id) looked_ids.add(`W:${e.id}`);
    const band = read.mode !== 'extensive' ? bandsOf[si].find(b => b.at.includes(ti)) : null;
    if (band) openPhrase(si, ti, band, btn); else openWord(si, ti, btn);
  }

  /** The word-list entry of a lemma (lower case first), or null. @param {string} lemma */
  const entryOf = lemma => /** @type {any} */ ((idx.lemmas.get(String(lemma).toLowerCase()) || [])[0] || null);
  /** A listed word without its article ("die Branche" → "Branche"). @param {any} e */
  const own = e => String(e.w).replace(/^(der|die|das)\s+/i, '').trim();

  /** @param {number} si @param {number} ti @param {HTMLElement} btn */
  function openWord(si, ti, btn) {
    const s = an[si];
    const x = s.cls[ti];
    const P = L.partners(pack, idx, s.toks, ti);
    const lemma = P.lemma || x.lemma;
    const entry = (lemma.toLowerCase() === x.lemma.toLowerCase() && x.entry) || entryOf(lemma);
    const head0 = entry ? own(entry) : lemma;
    const cid = L.itemFor({ kind: 'word', lemma: head0, entry });
    const mine = R.savedWords(store)[cid];
    const wc = Lg.ix && entry ? wordCard(Lg.ix, { lemma: head0, pos: entry.pos, id: `W:${entry.id}`, zipf: entry.zipf ?? null, level: entry.level || null }) : null;
    const head = wc ? wc.card.head : head0;
    const state = K ? K.get(entry && entry.id ? `W:${entry.id}` : cid).state : 'unseen';
    const glossList = entry && Array.isArray(entry.en) && entry.en.length ? entry.en.slice(0, 3).join(', ') : null;
    let gloss = (mine && mine.gloss) || glossList;
    const from = mine && mine.gloss ? mine.from : glossList ? 'list' : null;
    tv.light(si, P.at);
    const ext = read.mode === 'extensive';
    const split = P.at.length > 1;
    const surface = split ? P.at.map(k => s.toks[k].t).join(' … ') : s.toks[ti].t;
    const meaningIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', autocomplete: 'off', placeholder: t('read.sheet.meaningPh'), 'aria-label': t('read.sheet.meaning') }));
    const status = h('p', { class: 'caption', 'aria-live': 'polite' });
    const trSlot = h('div', { class: 'rd-tr' });
    const add = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => {
      const g = gloss || meaningIn.value.trim() || null;
      saveItem({ kind: 'word', lemma: head0, head, entry, gloss: g, from: gloss ? from : g ? 'me' : null, si, at: P.at, surface, btn });
      sh.close();
    } }, mine ? t('read.sheet.saved') : t('read.sheet.add')));
    if (mine) add.disabled = true;
    const children = [
      h('div', { class: 'rd-sheet-meta' }, wordMeta({ type: wc ? wc.card.type : entry ? (entry.pos === 'phrase' ? 'phrase' : 'word') : 'word', level: entry?.level || null, zipf: entry?.zipf ?? null }),
        h('span', { class: ['rd-state', `is-${state}`] }, t(`read.state.${state}`))),
      gloss ? h('p', { class: 'rd-gloss' }, gloss) : h('label', { class: 'field-label' }, t('read.sheet.meaning'), meaningIn),
      h('p', { class: 'caption' }, gloss ? t(`read.sheet.from.${from || 'list'}`) : t('read.sheet.noMeaning')),
      entry && entry.id ? familyLink(ctx, entry.id, { from: 'read' }) : null,   // round 7: "Family: stellen ›"
      split ? h('p', { class: 'callout rd-note' }, t('read.sheet.separable', { parts: P.at.map(k => s.toks[k].t).join(' … ') })) : null,
      !ext && wc ? wordPanel(wc.card, { head: false }) : null,
      !ext ? quote(s.toks, P.at) : null,
      trSlot,
      mine && mine.ref ? h('p', { class: 'caption' }, t('read.sheet.isRef')) : null,
      h('div', { class: 'rd-sheet-actions' }, add,
        !ext ? translateBtn(si, trSlot) : null),
      !ext ? h('button', { type: 'button', class: 'btn btn-quiet pressable rd-phrase-btn', onclick: () => markPhrase(si, P.at, sh) }, t('read.sheet.phrase')) : null,
      status,
    ];
    const sh = sheet({ title: head, titleLang: true, cls: 'rd-word-sheet', children, onClose: () => tv.clear() });
  }

  /** The phrase band's sheet: the phrase first, "Just this word" for the word. @param {number} si @param {number} ti @param {{phrase: L.Phrase, at: number[]}} band @param {HTMLElement} btn */
  function openPhrase(si, ti, band, btn) {
    const s = an[si];
    const e = band.phrase.entry;
    const cid = `W:${e.id}`;
    const mine = R.savedWords(store)[cid];
    const gloss = (mine && mine.gloss) || (Array.isArray(e.en) ? e.en.slice(0, 3).join(', ') : null);
    tv.light(si, band.at);
    const state = K ? K.get(cid).state : 'unseen';
    const surface = band.at.map(k => s.toks[k].t).join(' ');
    const add = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', disabled: !!mine, onclick: () => {
      saveItem({ kind: 'phrase', lemma: e.w, head: e.w, entry: e, gloss, from: 'list', si, at: band.at, surface, btn });
      sh.close();
    } }, mine ? t('read.sheet.saved') : t('read.sheet.add')));
    const sh = sheet({ title: e.w, titleLang: true, cls: 'rd-word-sheet', onClose: () => tv.clear(), children: [
      h('div', { class: 'rd-sheet-meta' }, wordMeta({ type: 'phrase', level: e.level || null, zipf: e.zipf ?? null }), h('span', { class: ['rd-state', `is-${state}`] }, t(`read.state.${state}`))),
      gloss ? h('p', { class: 'rd-gloss' }, gloss) : null,
      h('p', { class: 'caption' }, t('read.sheet.from.list')),
      /** @type {any} */ (e).ex ? h('p', { class: 'caption', lang: langAttr(), dir: dirAttr() }, /** @type {any} */ (e).ex) : null,
      quote(s.toks, band.at),
      h('div', { class: 'rd-sheet-actions' }, add,
        h('button', { type: 'button', class: 'btn pressable', onclick: () => { sh.close(); setTimeout(() => openWord(si, ti, btn), 170); } }, t('read.sheet.justWord'))),
    ] });
  }

  /** Translate sentence: cached on this device; sent only on the tap. @param {number} si @param {HTMLElement} slot */
  function translateBtn(si, slot) {
    const sid = sentences[si].id;
    const cached = ((store.get(R.CACHE, {}) || {})[read.id] || {}).tr?.[sid] || null;
    const graded = /** @type {any} */ (sentences[si]).en || null;
    if (cached || graded) { replace(slot, h('p', { class: 'rd-en' }, cached || graded)); return null; }
    if (!canAskClaude(store)) return null;
    const b = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn pressable', onclick: async () => {
      b.disabled = true; b.textContent = t('read.sheet.translating');
      try {
        const res = await ask({ cred: claude(store), user: fill(TEMPLATES['read-translate@1'], { language: pack.name, sentence: sentences[si].de }), model: config.anthropic.models.check, maxTokens: 300, effort: null, fallback: false });
        const en = res.text.replace(/\s+/g, ' ').trim().slice(0, 400);
        store.update(R.CACHE, (/** @type {any} */ m) => { const cur = (m || {})[read.id] || {}; return { ...(m || {}), [read.id]: { ...cur, tr: { ...(cur.tr || {}), [sid]: en } } }; }, {});
        replace(slot, h('p', { class: 'rd-en' }, en));
        b.remove();
      } catch (err) {
        b.disabled = false; b.textContent = t('read.sheet.translate');
        replace(slot, h('p', { class: 'caption' }, errLine(err, t, t('read.err.other'))));
      }
    } }, t('read.sheet.translate')));
    replace(slot, h('p', { class: 'caption' }, t('read.sent.sentence')));
    return b;
  }

  /** Mark a phrase: the sentence's words as chips, the tapped one on; Save phrase. @param {number} si @param {number[]} at0 @param {{set: (...k: any[]) => void, close: () => void}} sh */
  function markPhrase(si, at0, sh) {
    const s = an[si];
    const on = new Set(at0);
    const words = s.toks.map((tk, i) => ({ tk, i })).filter(x => x.tk.w && !x.tk.num);
    const meaning = /** @type {HTMLInputElement} */ (h('input', { class: 'input', autocomplete: 'off', placeholder: t('read.sheet.meaningPh'), 'aria-label': t('read.sheet.meaning') }));
    const save = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => {
      const at = [...on].sort((a, b) => a - b);
      if (at.length < 2) { announce(t('read.phrase.two')); return; }
      const contiguous = at.every((k, j) => !j || words.findIndex(w => w.i === k) === words.findIndex(w => w.i === at[j - 1]) + 1);
      const text = at.map(k => s.toks[k].t).join(contiguous ? ' ' : ' … ');
      const g = meaning.value.trim() || null;
      saveItem({ kind: 'phrase', lemma: text, head: text, entry: null, gloss: g, from: g ? 'me' : null, si, at, surface: text, btn: tv.button(si, at[0]) });
      sh.close();
    } }, t('read.phrase.save')));
    const chips = h('div', { class: 'chips rd-chips', role: 'group', 'aria-label': t('read.phrase.pick'), lang: langAttr(), dir: dirAttr() }, words.map(({ tk, i }) =>
      h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(on.has(i)), onclick: (/** @type {Event} */ e) => {
        if (on.has(i)) on.delete(i); else on.add(i);
        /** @type {HTMLElement} */ (e.currentTarget).setAttribute('aria-pressed', String(on.has(i)));
        tv.light(si, [...on]);
      } }, tk.t)));
    sh.set(h('p', { class: 'caption' }, t('read.phrase.help')), chips, h('label', { class: 'field-label' }, t('read.sheet.meaning'), meaning), h('div', { class: 'rd-sheet-actions' }, save));
  }

  /**
   * Save an item: its entry and its sentence; one card per item; reference for a rare word; the word lifts into the
   * tray.
   * @param {{kind: 'word' | 'phrase', lemma: string, head: string, entry: any, gloss: string | null, from: any, si: number, at: number[], surface: string, btn: HTMLElement | null}} o
   */
  function saveItem({ kind, lemma, head, entry, gloss, from, si, at, surface, btn }) {
    const cardId = L.itemFor({ kind, lemma, entry });
    const homeDeck = L.homeOf(cardId, lemma, otherDecks(store, deck), K?.maps?.resolve || ((/** @type {string} */ id) => id), deckName) || deck;
    const lv = entry?.level || null, zipf = entry?.zipf ?? null;
    const ref = homeDeck === deck && L.triage({ zipf, level: lv, kind }, level) === 'ref';
    const sent = sentences[si];
    R.saveWord(store, { cardId, today: c.today, entry: { lemma, head, gloss, from, level: lv, zipf, kind, home: homeDeck, ref }, ctx: { readId: read.id, sentenceId: sent.id, de: sent.de, surface } });
    const bk = R.readBuckets(store, c, deck, Infinity);
    R.writeStats(store, deck, c.today, bk.fresh.length);
    const key = lemma.toLowerCase();
    tv.markSaved((a, b) => (a === si && at.includes(b)) || String(an[a]?.cls[b]?.lemma || '').toLowerCase() === key);
    haptic();
    trayEl.lift(btn).then(() => drawTray(true));
    announce(homeDeck !== deck ? t('read.saved.home', { word: head }) : ref ? t('read.saved.ref', { word: head }) : t('read.saved.one', { word: head }));
  }

  // ---------- the tray sheet ----------
  function openTray() {
    const body = h('div', { class: 'rd-traysheet' });
    const sh = sheet({ title: t('read.tray.title'), children: [body] });
    function draw() {
      const list = fromHere();
      const missing = list.filter(x => !x.w.gloss);
      const cards = store.cards(deck) || {};
      const key = canAskClaude(store);
      const st = h('p', { class: 'caption', 'aria-live': 'polite' });
      replace(body,
        list.length ? null : h('p', { class: 'lead' }, t('read.tray.empty')),
        missing.length ? h('div', { class: 'rd-missing' }, h('p', { class: 'label' }, t('read.tray.missing', { n: missing.length })),
          key ? [h('p', { class: 'caption' }, t('read.sent.words')), h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: (/** @type {Event} */ e) => getMeanings(/** @type {HTMLButtonElement} */ (e.currentTarget), missing, st, draw) }, t('read.tray.get')), st]
            : h('p', { class: 'caption' }, t('read.tray.noKey'))) : null,
        h('ul', { class: 'list rd-traylist' }, list.map(({ id, w }) => {
          const inp = /** @type {HTMLInputElement} */ (h('input', { class: 'input', value: w.gloss || '', placeholder: t('read.sheet.meaningPh'), 'aria-label': t('read.tray.meaningOf', { word: w.head || w.lemma }) }));
          inp.addEventListener('change', () => { R.patchWord(store, id, { gloss: inp.value.trim() || null, from: inp.value.trim() ? 'me' : null }); });
          const where = w.home !== deck ? t('read.tray.home') : w.ref ? t('read.tray.ref') : null;
          return h('li', { class: 'rd-trayitem' },
            h('div', { class: 'rd-trayitem-top' }, h('span', { class: 'rd-traylemma', lang: langAttr(), dir: dirAttr() }, w.head || w.lemma),
              w.ref ? h('button', { type: 'button', class: 'btn btn-quiet pressable rd-review-anyway', onclick: () => { R.patchWord(store, id, { ref: false }); draw(); } }, t('read.tray.reviewAnyway')) : null,
              !cards[id]?.reps ? h('button', { type: 'button', class: 'btn btn-quiet pressable rd-x', 'aria-label': t('read.tray.remove', { word: w.head || w.lemma }), onclick: () => { R.dropWord(store, id); drawTray(); draw(); } }, icon('close', { size: 16 })) : null),
            w.from === 'list' ? h('p', { class: 'caption' }, w.gloss) : inp,
            where ? h('p', { class: 'caption' }, where) : null);
        })));
    }
    draw();
    void sh;
  }

  /** "Get meanings": the saved words without one, in one call with his key. @param {HTMLButtonElement} b @param {{id: string, w: any}[]} missing @param {HTMLElement} st @param {() => void} redraw */
  async function getMeanings(b, missing, st, redraw) {
    b.disabled = true; b.textContent = t('read.tray.getting');
    const ctxs = store.get(R.CTX, {}) || {};
    const list = missing.map((m, i) => `${i + 1}. word: ${(ctxs[m.id] || [])[0]?.surface || m.w.lemma} | sentence: ${(ctxs[m.id] || [])[0]?.de || ''}`).join('\n');
    try {
      const res = await ask({ cred: claude(store), user: fill(TEMPLATES['read-gloss@1'], { language: pack.name, words: list }), model: config.anthropic.models.check, maxTokens: 80 + 40 * missing.length, effort: null, fallback: false });
      const j = (() => { try { const m = String(res.text).match(/\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : []; } catch { return []; } })();
      (Array.isArray(j) ? j : []).forEach((/** @type {any} */ r, /** @type {number} */ i) => {
        const n = Number.isInteger(r?.n) ? r.n - 1 : i;
        const m = missing[n];
        if (!m || typeof r?.en !== 'string' || /[<>{}]/.test(r.en)) return;
        const lemma = typeof r.lemma === 'string' && r.lemma.trim() && !/[<>{}]/.test(r.lemma) ? r.lemma.replace(/\s+/g, ' ').trim().slice(0, 60) : null;
        R.patchWord(store, m.id, { gloss: r.en.replace(/\s+/g, ' ').trim().slice(0, 80), from: 'claude', ...(lemma ? { head: lemma } : {}) });
      });
      drawTray(); redraw();
    } catch (err) {
      b.disabled = false; b.textContent = t('read.tray.get');
      st.textContent = errLine(err, t, t('read.err.other'));
    }
  }

  /** The item ids of the listed content words in the part he read, that he did not look up. @param {number} upTo share of the text */
  function readPast(upTo) {
    const ws = tv.words();
    const last = Math.floor(ws.length * Math.min(1, upTo));
    const top = levelRank(level) + 1;
    /** @type {Set<string>} */ const out = new Set();
    for (const [si, ti] of ws.slice(0, last)) {
      if (tapped.has(`${si}:${ti}`)) continue;
      const x = an[si]?.cls[ti];
      const e = x && x.entry;
      if (!e || !e.id || e.pos === 'phrase' || levelRank(e.level) > top) continue;
      out.add(`W:${e.id}`);
    }
    for (const id of looked_ids) out.delete(id);
    return [...out];
  }

  // ---------- time and place ----------
  const t0 = Date.now();
  let hidden0 = 0, hiddenMs = 0;
  const onVis = () => { if (document.hidden) hidden0 = Date.now(); else if (hidden0) { hiddenMs += Date.now() - hidden0; hidden0 = 0; } };
  document.addEventListener('visibilitychange', onVis);
  const offs = [store.subscribe(R.WORDS, () => drawTray())];
  return () => {
    hair.stop();
    offs.forEach(f => f());
    document.removeEventListener('visibilitychange', onVis);
    const ms = Math.max(0, Date.now() - t0 - hiddenMs);
    const min = Math.min(VISIT_MAX_MIN, ms / 60000);
    const words = Math.round(est.words * share);
    R.updateProgress(store, read.id, p => ({ ...p, share: Math.max(p.share || 0, share), ms: (p.ms || 0) + Math.min(ms, VISIT_MAX_MIN * 60000), looked: (p.looked || 0) + looked,
      words: Math.max(p.words || 0, words), last: c.today }));
    if (min >= 0.25) addActivity(store, ctx.clock.ctx().today, { minutes: min, kind: 'read' });
    // the listed words he read past without a look-up, up to one level above his: reading evidence for the estimate
    // (domain/text/estimate.js 'read'; coverage only, never a card or a known count)
    if (share > 0.2) R.addMet(store, c.today, readPast(share));
  };
}
