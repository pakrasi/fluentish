/* Look up (UX §4.10): reference with one search. Sections: Words (My words, the captured exam words with their
   glosses, examples and details from the private results repository; and the B1 word list), Phrases (the chunk
   bank), Grammar (B1 topics, then Igloo's grammar layer in the word-tile role colours, and the notes) and Frames
   (Sprechen frames and verb frames).

   Owns #/lookup and everything under it (route.js): a section, ?q= (results from every section, or one section's),
   words/<lemma> (word sheet), grammar/<topic> (a B1 topic). Search and sub-filters update the address in place with
   history.replaceState, so typing never remounts the view and a copied link reopens the same results.
   Content and the search index are built once per session (data.js); long lists render in pages (ui.js paged). */
import { h, replace, on, announce } from '../../core/dom.js';
import { label } from '../../core/clock.js';
import { notice, seg } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { num } from '../../core/i18n.js';
import { dueOn } from '../../domain/b1ready.js';
import * as D from './data.js';
import { parseRoute, hashFor } from './route.js';
import { search } from './search.js';
import { LANGS, langFor, TABS, PHRASE_CATS, GRAMMAR_SUBS, FRAME_SUBS, NOTE_KEYS, tenseGrid, dictHead } from './sources.js';
import { triage, cardId, headword, examples, details, freqBand, sources, frequent } from './words.js';
import { hl, glyph, paged, markForm, caption } from './ui.js';
import { play, stop, prefetchAudio } from '../../services/audio.js';
import { markSeen } from '../../data/seen.js';

const UI_KEY = 'lookup.ui';
const DEBOUNCE_MS = 120;
const ALL_LIMIT = 5;
const LEVELS = ['A1', 'A2', 'B1', 'B2'];

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { t, store } = ctx;
  const route = parseRoute(ctx.params.rest, ctx.query);
  const lang = langFor(route.opts.lang || ctx.settings().language);
  /** @type {(() => void)[]} */ const offs = [];
  /** @type {{stop: () => void}[]} */ let pagers = [];
  let alive = true;
  const cleanup = () => { alive = false; stop(); offs.forEach(f => f()); pagers.forEach(p => p.stop()); };
  const today = () => ctx.clock.ctx();
  /** lemma → [word id, level], for the card ids of captured words (shared with Practice through domain/itemids.js) */
  const wordmap = await D.wordmap(ctx.content);
  const testsTotal = (await ctx.content.manifest().catch(() => null))?.exams?.find((/** @type {any} */ e) => e.language === lang)?.tests?.length || 14;

  /* ---------- shared row builders ---------- */

  const de = (/** @type {any} */ text, cls = '') => h('span', { lang: 'de', class: cls || null }, text);

  /** @param {string} text @param {string} [what] */
  const sayBtn = (text, what = text) => h('button', { type: 'button', class: 'lk-say pressable', 'aria-label': t('lookup.listen', { text: what }),
    onclick: async (/** @type {Event} */ e) => { e.stopPropagation(); if (!(await play(ctx.content, text, ctx.store))) ctx.toast(t('lookup.noAudio')); } }, glyph('speaker', 20));

  /** My words state: waiting, a review date, after the exam, new. @param {any} g */
  function wordState(g) {
    const c = today();
    const tri = triage(g, c.phase, wordmap);
    if (tri === 'waiting') return { cls: 'is-waiting', text: t('lookup.state.waiting') };
    const cards = store.cards('b1');
    const card = cards[cardId(g, wordmap, (/** @type {string} */ id) => !!cards[id]?.reps)];
    if (card && card.reps) { const due = dueOn(card, c); return due <= c.today ? { cls: 'is-due', text: t('lookup.state.due') } : { cls: '', text: t('lookup.state.dueOn', { date: label(due) }), date: due }; }
    if (tri === 'later') return { cls: 'is-later', text: t('lookup.state.later') };
    if (tri === 'reference') return { cls: 'is-later', text: t('lookup.state.reference') };
    return { cls: '', text: t('lookup.state.new') };
  }

  /** @param {any} g @param {string} q */
  function mineRow(g, q) {
    const s = wordState(g);
    return h('li', { class: 'lk-item' },
      h('a', { class: 'lk-row pressable', href: hashFor({ tab: 'words', id: g.lemma, opts: langOpt() }) },
        h('span', { class: 'lk-main' },
          de(hl(headword(g), q), 'lk-title'),
          g.gloss ? h('span', { class: 'lk-sub' }, hl(g.gloss, q)) : h('span', { class: 'lk-sub is-muted' }, t('lookup.state.waiting'))),
        h('span', { class: ['lk-trail', s.cls] }, s.cls === 'is-waiting' ? null : s.text)),
      sayBtn(headword(g)));
  }

  /** @param {any} r @param {string} q */
  function dictRow(r, q) {
    return h('li', { class: 'lk-item' },
      h('a', { class: 'lk-row pressable', href: hashFor({ tab: 'words', id: r.id, opts: langOpt() }) },
        h('span', { class: 'lk-main' }, de(hl(dictHead(r), q), 'lk-title'), h('span', { class: 'lk-sub' }, hl(r.en.slice(0, 3).join(', '), q))),
        h('span', { class: 'lk-trail lk-level' }, r.level || '')),
      sayBtn(dictHead(r)));
  }

  /** An expandable row: head button + details. @param {{head: Node[], body: () => Node[], trail?: any, cls?: string}} o */
  function disclosure({ head, body, trail = null, cls = '' }) {
    const det = h('div', { class: 'lk-detail', hidden: true });
    let filled = false;
    const btn = h('button', { type: 'button', class: 'lk-row lk-toggle pressable', 'aria-expanded': 'false',
      onclick: () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        if (open && !filled) { replace(det, ...body()); filled = true; }
        det.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      } }, h('span', { class: 'lk-main' }, ...head), trail, glyph('caret', 16));
    return h('li', { class: ['lk-item', 'lk-x', cls] }, btn, det);
  }

  /** A phrase with its open slots ([Infinitiv], [Satz]) as gap tiles, the chunk language of the grammar layer. @param {string} text @param {string} q */
  const slotted = (text, q) => String(text).split(/(\[[^\]]+\])/).filter(Boolean)
    .map(p => (/^\[.+\]$/.test(p) ? h('span', { class: 'tile gap lk-slot' }, p.slice(1, -1)) : hl(p, q)));

  /** @param {any} r @param {string} q */
  const phraseRow = (r, q) => disclosure({
    head: [de(slotted(r.de, q), 'lk-title'), h('span', { class: 'lk-sub' }, hl(r.en, q))],
    trail: h('span', { class: 'lk-trail lk-level' }, r.level || ''),
    body: () => [
      (markSeen(store, `K:${r.id}`, today().today), null),
      r.ex ? h('p', { class: 'lk-ex' }, sayBtn(r.ex), de(hl(r.ex, q))) : null,
      r.note ? h('p', { class: 'lk-note' }, r.note) : null,
      h('p', { class: 'caption' }, [t(`lookup.phrases.cat.${r.cat}`), r.fn, r.prio === 1 ? t('lookup.phrases.exam') : null].filter(Boolean).join(', ')),
      r.enEx ? h('p', { class: 'lk-note is-en' }, r.enEx) : null,
    ],
  });

  /**
   * A pattern as a sentence of tiles: '___' is an open gap tile, the words between are tiles in the role colour, an
   * instruction in brackets is the mono role label under the tile before it, ' / ' separates alternatives.
   * "___, weil ___ (Verb am Ende) / ___, denn ___" → [gap] [, weil] [gap · Verb am Ende]  /  [gap] [, denn] [gap]
   * @param {string} text @param {string} role @param {string} q
   */
  function tilesOf(text, role, q) {
    /** @type {any[]} */ const out = [];
    for (const [i, alt] of String(text).split(/\s+\/\s+/).entries()) {
      if (i) out.push(h('span', { class: 'lk-or', 'aria-hidden': 'true' }, '/'));
      for (const part of alt.split(/(___|\([^)]*\))/)) {
        const p = part.trim();
        if (!p) continue;
        if (p === '___') out.push(h('span', { class: 'tile gap' }, h('span', { class: 'sr-only' }, 'gap'), '\u2003'));
        else if (/^\(.*\)$/.test(p) && out.length && out[out.length - 1].classList?.contains('tile')) out[out.length - 1].append(h('small', null, p.slice(1, -1)));
        else out.push(h('span', { class: `tile ${role}` }, hl(p, q)));
      }
    }
    return h('span', { class: 'tiles lk-tiles', lang: 'de' }, out);
  }

  /** A grammar-layer item: the German as a sentence of word tiles in its role colour. @param {any} r @param {string} q */
  const layerRow = (r, q) => disclosure({
    cls: 'lk-layer',
    head: [tilesOf(r.de, r.role, q), h('span', { class: 'lk-sub' }, hl(r.en, q))],
    trail: h('span', { class: 'lk-trail lk-level' }, r.level || ''),
    body: () => [
      r.gloss && r.gloss !== r.en ? h('p', { class: 'lk-note is-en' }, r.gloss) : null,
      r.example ? h('div', { class: 'lk-ex' }, sayBtn(r.example.de), h('div', null, de(hl(r.example.de, q)), r.example.en ? h('div', { class: 'lk-sub' }, r.example.en) : null)) : null,
      r.slot ? h('p', { class: 'caption' }, t('lookup.grammar.gap', { slot: r.slot })) : null,
      r.note ? h('p', { class: 'lk-note' }, r.note) : null,
      r.about ? h('p', { class: 'lk-note' }, r.about) : null,
    ],
  });

  /** @param {any} tp @param {string} q */
  const topicRow = (tp, q) => h('li', { class: 'lk-item' },
    h('a', { class: 'lk-row pressable', href: hashFor({ tab: 'grammar', id: tp.id, opts: langOpt() }) },
      h('span', { class: 'lk-rank mono', 'aria-hidden': 'true' }, String(tp.rank)),
      h('span', { class: 'lk-main' }, h('span', { class: 'lk-title' }, hl(tp.name, q)),
        h('span', { class: 'lk-sub' }, [t('lookup.grammar.rules', { n: tp.rules.length }), tp.trap ? t('lookup.grammar.trap') : null].filter(Boolean).join(' · '))),
      glyph('caret', 16)));

  /** @param {any} r @param {any} g @param {string} q */
  const frameRow = (r, g, q) => h('li', { class: 'lk-item lk-frame' },
    h('div', { class: 'lk-row' }, h('span', { class: 'lk-main' }, de(hl(r.de, q), 'lk-title'), g && q ? h('span', { class: 'lk-sub' }, hl(g.en, q)) : null)));

  /** One search hit, drawn like its section's row. @param {any} d @param {string} q */
  function hitRow(d, q) {
    const ref = d.ref;
    if (ref.kind === 'mine') return mineRow(ref.g, q);
    if (ref.kind === 'dict') return dictRow(ref.r, q);
    if (ref.kind === 'phrase') return phraseRow(ref.r, q);
    if (ref.kind === 'layer') return layerRow(ref.r, q);
    if (ref.kind === 'topic') return topicRow(ref.t, q);
    return frameRow(ref.r, ref.g, q);
  }

  const langOpt = () => (lang !== 'german' ? { lang } : {});
  const loading = () => h('p', { class: 'caption lk-loading', role: 'status' }, t('lookup.loading'));
  /** @param {() => void} retry */
  const failed = retry => notice({ kind: 'warning', children: [h('p', null, t('lookup.loadError')), h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: retry }, t('lookup.retry')))] });
  const moreText = (/** @type {number} */ n, /** @type {number} */ left) => t('lookup.more', { n: num(n), left: num(left) });
  /** @param {any[]} items @param {(x: any) => Node} row @param {string} [tag] */
  const list = (items, row, tag = 'ul') => { const p = paged(items, row, { more: moreText, tag }); pagers.push(p); return p.el; };
  const back = (/** @type {string} */ href) => h('a', { class: 'lk-back pressable', href }, glyph('caret', 16), t('lookup.back'));

  /* ---------- word sheet: #/lookup/words/<lemma or id> ---------- */

  if (route.tab === 'words' && route.id) {
    const id = route.id;
    replace(el, h('div', { class: 'lookup lk-sheet' }, back(hashFor({ tab: 'words', opts: langOpt() })), h('h1', null, de(id)), loading()));
    const [mine, dict] = await Promise.all([D.myWords(store), D.dictionary(ctx.content, lang).catch(() => null)]);
    if (!alive) return cleanup;
    const rows = dict ? dict.rows : [];
    const r = rows.find(x => x.id === id) || rows.find(x => x.w === id) || rows.find(x => x.w.toLowerCase() === id.toLowerCase()) || null;
    const g = mine.groups.find(x => x.key === id.toLowerCase()) || (r ? mine.groups.find(x => x.key === r.w.toLowerCase()) : null) || null;
    replace(el, wordSheet(id, g, r));
    prefetchAudio(ctx.content, ctx.store);
    return cleanup;
  }

  /** The article lighter than the noun ("der Termin"). @param {any} g @param {any} r @param {string} hw */
  function headParts(g, r, hw) {
    const m = /^(der|die|das)\s+(.+)$/.exec(hw);
    return m ? [h('span', { class: 'lk-art' }, m[1]), ' ', m[2]] : hw;
  }

  /** @param {string} id @param {any} g captured group @param {any} r word-list row */
  function wordSheet(id, g, r) {
    const wrap = h('div', { class: 'lookup lk-sheet' }, back(hashFor({ tab: 'words', opts: { ...langOpt(), w: g ? null : 'all' } })));
    if (!g && !r) {
      wrap.append(h('h1', null, de(id)), h('p', { class: 'lk-empty' }, t('lookup.sheet.notFound', { id })));
      return wrap;
    }
    // a view counts as "seen" for the knowledge score (data/seen.js)
    markSeen(store, g ? cardId(g, wordmap, (/** @type {string} */ x) => !!store.cards('b1')[x]?.reps) : `W:${r.id}`, today().today);
    const hw = g ? headword(g) : dictHead(r);
    const band = freqBand(g ? g.zipf : r.zipf);
    const plural = g ? g.plural : r.pl;
    const facts = [
      g?.pos || r?.pos || null,
      plural && plural !== '–' ? [t('lookup.sheet.pluralLabel'), ' ', de(plural)] : null,
      r?.level ? t('lookup.sheet.level', { level: r.level }) : null,
    ].filter(Boolean);
    wrap.append(
      h('div', { class: 'lk-sheet-head' }, h('h1', null, de(headParts(g, r, hw))), sayBtn(hw)),
      facts.length ? h('p', { class: 'lk-facts' }, facts.map((f, i) => [i ? ', ' : null, f])) : null);
    const meaning = g?.gloss || (r ? r.en.join(', ') : null);
    const fromList = !!(g && !g.gloss && r);   // a captured word still waiting: the word list already knows its meaning
    wrap.append(meaning ? h('p', { class: 'lk-meaning' }, meaning) : h('p', { class: 'lk-meaning is-muted' }, t('lookup.sheet.waiting')),
      fromList ? h('p', { class: 'caption' }, t('lookup.sheet.fromList')) : null);
    if (g?.note) wrap.append(h('p', { class: 'lk-note' }, de(g.note)));
    const stats = [g?.exam_days ? t('lookup.sheet.tests', { n: g.exam_days, total: testsTotal }) : null, band ? t(`lookup.sheet.freq.${band}`) : null].filter(Boolean);
    if (g) {
      const s = wordState(g);
      const state = fromList && s.cls === 'is-waiting' ? null : s;
      wrap.append(h('div', { class: 'lk-status' },
        state ? h('span', { class: ['lk-state', state.cls] }, state.text) : null, stats.length ? h('span', { class: 'caption' }, stats.join(', ')) : null));
      if (g.gloss) wrap.append(h('div', { class: 'row-actions' }, h('a', { class: 'btn pressable', href: '#/practice/round?kind=area:words' }, t('lookup.sheet.practise'))));
    } else if (stats.length) wrap.append(h('p', { class: 'caption' }, stats.join(', ')));

    const exs = g ? examples(g) : r?.ex ? [{ de: r.ex, en: r.exen, form: r.w }] : [];
    if (exs.length) wrap.append(h('section', { class: 'lk-sec' }, h('h2', null, t('lookup.sheet.examples')),
      h('ul', { class: 'lk-exs' }, exs.map(x => h('li', { class: 'lk-ex' }, sayBtn(x.de), h('div', null, de(markForm(x.de, x.form)), x.en ? h('div', { class: 'lk-sub' }, x.en) : null,
        x.exam ? h('div', { class: 'caption' }, t('lookup.sheet.inTest')) : null))))));

    if (g) {
      const src = sources(g, n => t('exam.test', { n }));
      wrap.append(h('section', { class: 'lk-sec' }, h('h2', null, t('lookup.sheet.fromTest')),
        h('ul', { class: 'lk-plain' }, src.map(s => h('li', null, s))),
        g.forms.length ? h('p', { class: 'lk-note' }, t('lookup.sheet.seen'), ': ', de(g.forms.join(', '))) : null));
      const d = details(g);
      const pairs = (/** @type {any[]} */ xs) => xs && xs.length ? h('ul', { class: 'lk-exs' }, xs.map(x => h('li', { class: 'lk-ex' }, sayBtn(x.de), h('div', null, de(x.de), x.en ? h('div', { class: 'lk-sub' }, x.en) : null)))) : null;
      const part = (/** @type {string} */ k, /** @type {any} */ body) => body ? h('div', { class: 'lk-part' }, h('h3', null, t(`lookup.sheet.${k}`)), body) : null;
      const parts = [
        part('usage', d.usage ? h('p', null, d.usage) : null),
        part('colloquial', pairs(d.colloquial)),
        part('chunks', pairs(d.chunks)),
        part('family', pairs(d.family)),
        part('etymology', d.etymology ? h('p', null, d.etymology) : null),
        part('confusions', d.confusions ? h('p', null, d.confusions) : null),
      ].filter(Boolean);
      wrap.append(h('section', { class: 'lk-sec' }, h('h2', null, t('lookup.sheet.details')), parts.length ? parts : h('p', { class: 'lk-empty' }, t('lookup.sheet.noDetails'))));
    }
    const otherMeaning = g && r && r.en.join(', ') !== g.gloss ? r.en.join(', ') : null;
    if (r && (r.forms || otherMeaning)) {
      wrap.append(h('section', { class: 'lk-sec' }, h('h2', null, t('lookup.sheet.wordList')),
        r.forms ? h('p', null, h('span', { class: 'caption' }, t('lookup.sheet.forms'), ' '), de(r.forms)) : null,
        otherMeaning ? h('p', { class: 'lk-note is-en' }, otherMeaning) : null));
    }
    return wrap;
  }

  /* ---------- B1 topic: #/lookup/grammar/<id> ---------- */

  if (route.tab === 'grammar' && route.id) {
    const id = route.id;
    replace(el, h('div', { class: 'lookup lk-sheet' }, back(hashFor({ tab: 'grammar', opts: langOpt() })), h('h1', null, t('lookup.grammar.topics')), loading()));
    let gr;
    try { gr = await D.grammar(ctx.content, lang); } catch { if (alive) replace(el, h('div', { class: 'lookup' }, h('h1', null, t('lookup.title')), failed(() => ctx.go(`/lookup/grammar/${id}`)))); return cleanup; }
    if (!alive) return cleanup;
    const tp = gr.topics.find((/** @type {any} */ x) => x.id === id);
    const wrap = h('div', { class: 'lookup lk-sheet' }, back(hashFor({ tab: 'grammar', opts: langOpt() })));
    if (!tp) { wrap.append(h('h1', null, t('lookup.grammar.topics')), h('p', { class: 'lk-empty' }, t('lookup.grammar.notFound', { id }))); replace(el, wrap); return cleanup; }
    const conf = tp.confusable.map((/** @type {string} */ c) => gr.topics.find((/** @type {any} */ x) => x.id === c)).filter(Boolean);
    wrap.append(
      h('h1', null, tp.name),
      h('p', { class: 'caption' }, t('lookup.grammar.rules', { n: tp.rules.length })),
      tp.trap ? notice({ kind: 'warning', children: [h('p', { class: 'notice-title' }, t('lookup.grammar.trap')), h('p', null, tp.trap.rule),
        tp.trap.wrong_example ? h('p', null, h('span', { class: 'caption' }, t('lookup.grammar.wrong'), ' '), h('s', { lang: 'de' }, tp.trap.wrong_example)) : null] }) : null,
      h('ol', { class: 'lk-rules' }, tp.rules.map((/** @type {any} */ x) => h('li', { class: 'lk-rule' },
        h('p', { class: 'lk-rule-text' }, x.rule),
        h('p', { class: 'lk-model', lang: 'de' }, x.de),
        x.wrong ? h('p', { class: 'lk-wrong' }, h('span', { class: 'caption' }, t('lookup.grammar.wrong'), ' '), h('s', { lang: 'de' }, x.wrong)) : null))),
      conf.length ? h('section', { class: 'lk-sec' }, h('h2', null, t('lookup.grammar.confusable')),
        h('ul', { class: 'lk-list' }, conf.map((/** @type {any} */ c) => topicRow(c, '')))) : null,
      h('div', { class: 'row-actions' }, h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=topic:${encodeURIComponent(tp.id)}` }, t('lookup.grammar.practise'))));
    replace(el, wrap);
    return cleanup;
  }

  /* ---------- the sections and the search ---------- */

  const ui = store.get(UI_KEY, {}) || {};
  const hasWords = () => !!((store.get('secrets', {}) || {}).githubToken || (store.get('vocab.local', []) || []).length);
  const st = { tab: route.tab, q: route.q, opts: { ...route.opts } };
  if (!st.tab) st.tab = st.q ? 'all' : (TABS.includes(ui.tab) ? ui.tab : hasWords() ? 'words' : 'phrases');
  const sync = () => {
    history.replaceState(history.state, '', hashFor(st));
    if (st.tab !== 'all' && ui.tab !== st.tab) { ui.tab = st.tab; store.set(UI_KEY, { ...ui }); }
  };
  sync();

  const input = /** @type {HTMLInputElement} */ (h('input', { type: 'search', class: 'lk-input', value: st.q, placeholder: t('lookup.searchPh'), 'aria-label': t('lookup.search'),
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search', maxlength: '120' }));
  const clearBtn = h('button', { type: 'button', class: 'lk-clear pressable', 'aria-label': t('lookup.clear'), hidden: !st.q,
    onclick: () => { input.value = ''; setQuery(''); input.focus(); } }, glyph('clear', 20));
  const nav = h('nav', { class: 'lk-tabs', 'aria-label': t('lookup.sections') });
  const body = h('div', { class: 'lk-body' });
  replace(el, h('div', { class: 'lookup' },
    h('div', { class: 'lk-top' },
      h('h1', null, t('lookup.title')),
      h('a', { class: 'lk-map pressable', href: '#/lookup/map' }, mapArt(),
        h('span', { class: 'lk-map-text' }, h('span', { class: 'lk-map-title' }, t('lookup.map')), h('span', { class: 'lk-map-detail' }, t('lookup.map.detail'))), icon('next', { size: 18 })),
      (route.opts.lang && !LANGS[route.opts.lang]) || (ctx.settings().language && !LANGS[ctx.settings().language]) ? notice({ children: [h('p', null, t('lookup.langOnly'))] }) : null,
      h('div', { class: 'lk-search' }, h('label', { class: 'lk-field' }, glyph('search', 20), input, clearBtn)),
      nav),
    body));

  /** @type {Record<string, number> | null} */ let counts = null;
  function drawNav() {
    const keys = st.q ? ['all', ...TABS] : TABS;
    replace(nav, ...keys.map(k => h('a', { href: hashFor({ tab: k, q: st.q, opts: langOpt() }), class: 'lk-tab pressable', 'aria-current': k === st.tab ? 'page' : null,
      onclick: (/** @type {MouseEvent} */ e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setTab(k); } },
      t(`lookup.tab.${k}`), counts && st.q ? h('span', { class: 'lk-n tnum' }, num(counts[k] || 0)) : null)));
  }

  /** @param {string} k */
  function setTab(k) {
    if (k === st.tab) return;
    st.tab = k;
    st.opts = { ...langOpt() };
    sync(); drawNav(); draw();
    window.scrollTo(0, 0);
  }

  let timer = /** @type {any} */ (null);
  /** @param {string} q */
  function setQuery(q) {
    clearTimeout(timer);
    const was = st.q;
    st.q = q.trim();
    clearBtn.hidden = !input.value;
    // a new search starts on All (every section's hits); picking a section while searching keeps it
    if (st.q && (!st.tab || !was)) st.tab = 'all';
    if (!st.q && st.tab === 'all') st.tab = TABS.includes(ui.tab) ? ui.tab : 'phrases';
    sync(); draw();
  }
  offs.push(on(input, 'input', () => { clearBtn.hidden = !input.value; clearTimeout(timer); timer = setTimeout(() => setQuery(input.value), DEBOUNCE_MS); }));
  offs.push(on(input, 'keydown', e => {
    const k = /** @type {KeyboardEvent} */ (e).key;
    if (k === 'Escape' && input.value) { e.preventDefault(); input.value = ''; setQuery(''); }
    if (k === 'Enter') { setQuery(input.value); input.blur(); }
  }));
  offs.push(on(document, 'keydown', e => {
    const ke = /** @type {KeyboardEvent} */ (e);
    const tg = /** @type {HTMLElement} */ (ke.target);
    if (ke.key === '/' && !ke.metaKey && !ke.ctrlKey && !tg.closest?.('input, textarea, [contenteditable]')) { ke.preventDefault(); input.focus(); input.select(); }
  }));
  offs.push(() => clearTimeout(timer));
  offs.push(store.subscribe('secrets', () => { D.resetMyWords(); if (st.tab === 'words' || st.q) draw(); }));
  // a results sync may have sent words saved here: show them as sent
  offs.push(ctx.bus.on('sync:status', () => { D.resetMyWords(); if (st.tab === 'words' && !st.q) draw(); }));

  let token = 0;
  async function draw() {
    const mine = ++token;
    pagers.forEach(p => p.stop()); pagers = [];
    const slow = setTimeout(() => { if (mine === token) replace(body, loading()); }, 150);
    let out;
    try { out = st.q ? await drawSearch() : await drawSection(); }
    catch (e) { console.error('lookup', e); out = failed(() => draw()); }
    clearTimeout(slow);
    if (!alive || mine !== token) return;
    replace(body, out);
    drawNav();
  }

  /* ----- search ----- */
  async function drawSearch() {
    const q = st.q;
    const [[dict, phr, gr], mine] = await Promise.all([D.allContent(ctx.content, lang), D.myWords(store)]);
    const hits = {
      words: [...search(mine.index, q), ...search(dict.index, q)],
      phrases: search(phr.index, q),
      grammar: search(gr.index, q, { tab: 'grammar' }),
      frames: search(gr.index, q, { tab: 'frames' }),
    };
    counts = Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.length]));
    counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
    announce(t('lookup.results', { n: counts.all }));
    if (st.tab === 'all') {
      const secs = TABS.filter(k => hits[/** @type {keyof typeof hits} */ (k)].length).map(k => {
        const hs = hits[/** @type {keyof typeof hits} */ (k)];
        return h('section', { class: 'lk-sec lk-results' },
          h('h2', null, t(`lookup.tab.${k}`), ' ', h('span', { class: 'lk-n tnum' }, num(hs.length))),
          h('ul', { class: 'lk-list' }, hs.slice(0, ALL_LIMIT).map(d => hitRow(d, q))),
          hs.length > ALL_LIMIT ? h('a', { class: 'btn btn-quiet lk-all pressable', href: hashFor({ tab: k, q, opts: langOpt() }), onclick: (/** @type {MouseEvent} */ e) => { e.preventDefault(); st.tab = k; sync(); draw(); window.scrollTo(0, 0); } },
            t('lookup.showAll', { n: num(hs.length) })) : null);
      });
      return secs.length ? h('div', null, ...secs) : h('p', { class: 'lk-empty' }, t('lookup.noMatch', { q }));
    }
    const hs = hits[/** @type {keyof typeof hits} */ (st.tab)] || [];
    if (!hs.length) return h('p', { class: 'lk-empty' }, t('lookup.noMatchHere', { q, section: t(`lookup.tab.${st.tab}`) }));
    return h('div', null, caption(t('lookup.results', { n: num(hs.length) })), list(hs, d => hitRow(d, q)));
  }

  /* ----- sections without a search ----- */
  async function drawSection() {
    counts = null;
    if (st.tab === 'words') return drawWords();
    if (st.tab === 'phrases') return drawPhrases();
    if (st.tab === 'grammar') return drawGrammar();
    return drawFrames();
  }

  /** @param {string} key @param {string} value */
  const setOpt = (key, value) => { if (value) st.opts[key] = value; else delete st.opts[key]; sync(); draw(); };

  /** A row of chips for one choice. @param {string} labelText @param {string} key @param {[string, string][]} options @param {string} value */
  function chips(labelText, key, options, value) {
    return h('div', { class: 'lk-chips lk-scroll', role: 'group', 'aria-label': labelText },
      options.map(([v, text]) => h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(v === value), onclick: () => setOpt(key, v) }, text)));
  }

  async function drawWords() {
    const w = st.opts.w === 'all' ? 'all' : 'mine';
    const toggle = seg({ label: t('lookup.words.view'), value: w, options: [['mine', t('lookup.words.mine')], ['all', t('lookup.words.all')]], onChange: v => setOpt('w', v === 'mine' ? '' : v) });
    toggle.classList.add('lk-seg');
    if (w === 'all') {
      const dict = await D.dictionary(ctx.content, lang);
      const level = LEVELS.includes(st.opts.level) ? st.opts.level : '';
      const rows = level ? dict.rows.filter(r => r.level === level) : dict.rows;
      prefetchAudio(ctx.content, ctx.store);
      return h('div', null, toggle,
        chips(t('lookup.words.level'), 'level', [['', t('lookup.words.levelAll')], ...LEVELS.map(l => /** @type {[string, string]} */ ([l, l]))], level),
        caption(t('lookup.words.listCount', { n: num(rows.length) })),
        list(rows, r => dictRow(r, '')));
    }
    const mw = await D.myWords(store);
    const out = h('div', null, toggle);
    if (mw.status === 'nolink' || mw.status === 'auth') {
      out.append(notice({ kind: mw.status === 'auth' ? 'warning' : 'info', children: [
        h('p', { class: 'notice-title' }, t('lookup.words.link.title')),
        h('p', null, t(mw.status === 'auth' ? 'lookup.words.auth' : 'lookup.words.link.body')),
        h('div', { class: 'notice-actions' }, h('a', { class: 'btn pressable', href: '#/profile/connections' }, t('lookup.words.link.action')))] }));
    } else if (mw.status !== 'ok') {
      out.append(notice({ kind: 'warning', children: [h('p', null, t('lookup.words.net')),
        h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: async () => { await D.myWords(store, { force: true }); draw(); } }, t('lookup.retry')))] }));
    }
    if (!mw.groups.length) {
      if (mw.status === 'ok') out.append(h('p', { class: 'lk-empty' }, t('lookup.words.empty')));
      return out;
    }
    prefetchAudio(ctx.content, ctx.store);
    const phase = today().phase;
    const tests = [...new Set(mw.groups.flatMap(g => g.days))].sort((a, b) => a - b);
    const test = tests.includes(Number(st.opts.test)) ? Number(st.opts.test) : 0;
    const freqOnly = st.opts.freq === '1';
    const rows = mw.groups.filter(g => (!test || g.days.includes(test)) && (!freqOnly || frequent(g)));
    const waiting = mw.groups.filter(g => !g.gloss).length;
    const later = mw.groups.filter(g => triage(g, phase, wordmap) === 'later').length;
    out.append(
      caption([t('lookup.words.count', { n: mw.groups.length, count: num(mw.groups.length) }), waiting ? t('lookup.words.waiting', { n: waiting }) : null].filter(Boolean).join(' · ')),
      later || mw.local ? caption([later ? t('lookup.words.later', { n: later }) : null, mw.local ? t('lookup.words.local', { n: mw.local }) : null].filter(Boolean).join(', ')) : null,
      h('div', { class: 'lk-filters' },
        tests.length > 1 ? chips(t('lookup.words.tests'), 'test', [['', t('lookup.words.allTests')], ...tests.map(n => /** @type {[string, string]} */ ([String(n), t('exam.test', { n })]))], test ? String(test) : '') : null,
        h('div', { class: 'lk-chips', role: 'group', 'aria-label': t('lookup.words.frequent') },
          h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(freqOnly), onclick: () => setOpt('freq', freqOnly ? '' : '1') }, t('lookup.words.frequent')))),
      rows.length ? list(rows, g => mineRow(g, '')) : h('p', { class: 'lk-empty' }, t('lookup.words.emptyFilter')));
    return out;
  }

  async function drawPhrases() {
    const phr = await D.phrases(ctx.content, lang);
    const cat = PHRASE_CATS.includes(st.opts.cat) ? st.opts.cat : '';
    const rows = cat ? phr.rows.filter((/** @type {any} */ r) => r.cat === cat) : phr.rows;
    prefetchAudio(ctx.content, ctx.store);
    return h('div', null,
      chips(t('lookup.phrases.kind'), 'cat', [['', t('lookup.phrases.all')], ...PHRASE_CATS.map(c => /** @type {[string, string]} */ ([c, t(`lookup.phrases.cat.${c}`)]))], cat),
      caption(t('lookup.phrases.count', { n: rows.length, count: num(rows.length) })),
      list(rows, r => phraseRow(r, '')));
  }

  async function drawGrammar() {
    const gr = await D.grammar(ctx.content, lang);
    const subs = GRAMMAR_SUBS.filter(([id, layer]) => id === 'notes' ? NOTE_KEYS.some(k => gr.notes[k]) : id === 'topics' ? gr.topics.length : gr.layers.some((/** @type {any} */ r) => r.layer === layer));
    const sub = subs.find(([id]) => id === st.opts.g) || subs[0];
    const head = chips(t('lookup.grammar.part'), 'g', subs.map(([id]) => /** @type {[string, string]} */ ([id === subs[0][0] ? '' : id, t(`lookup.grammar.${id}`)])), sub[0] === subs[0][0] ? '' : sub[0]);
    if (sub[0] === 'topics') return h('div', null, head, caption(t('lookup.grammar.topicsSub')), h('ol', { class: 'lk-list' }, gr.topics.map((/** @type {any} */ x) => topicRow(x, ''))));
    if (sub[0] === 'notes') return h('div', null, head, notes(gr));
    const rows = gr.layers.filter((/** @type {any} */ r) => r.layer === sub[1]);
    return h('div', null, head, caption(t('lookup.grammar.count', { n: rows.length })), list(rows, r => layerRow(r, '')));
  }

  /** @param {any} gr */
  function notes(gr) {
    const grid = tenseGrid(gr.turns, lang);
    const marked = (/** @type {any} */ c) => {
      const out = []; let i = 0;
      for (const [a, b] of c.marks) { if (a > i) out.push(c.de.slice(i, a)); out.push(h('mark', { class: 'lk-turn' }, c.de.slice(a, b))); i = b; }
      out.push(c.de.slice(i));
      return out;
    };
    return h('div', { class: 'lk-notes' },
      NOTE_KEYS.filter(k => gr.notes[k]).map(k => h('section', { class: 'lk-note-sec' }, h('h2', null, t(`lookup.notes.${k}`)), h('p', null, gr.notes[k]))),
      grid ? h('section', { class: 'lk-sec' }, h('h2', null, t('lookup.notes.go')), h('p', { class: 'caption' }, t('lookup.notes.goSub')),
        h('div', { class: 'lk-grid-scroll' }, h('table', { class: 'lk-grid' },
          h('thead', null, h('tr', null, h('td'), ['past', 'present', 'future'].map(x => h('th', { scope: 'col' }, t(`lookup.notes.${x}`))))),
          h('tbody', null, grid.map(row => h('tr', null, h('th', { scope: 'row' }, t(`lookup.notes.${row.aspect}`)),
            row.cells.map(c => h('td', null, h('div', { lang: 'de', class: 'lk-grid-de' }, marked(c)), h('div', { class: 'lk-sub' }, c.en),
              c.status !== 'form' ? h('div', { class: 'caption' }, t(c.status === 'none' ? 'lookup.notes.none' : 'lookup.notes.workaround')) : null)))))))) : null);
  }

  async function drawFrames() {
    const gr = await D.grammar(ctx.content, lang);
    const has = gr.sprechen.length ? FRAME_SUBS : ['verbs'];
    const f = has.includes(st.opts.f) ? st.opts.f : has[0];
    const toggle = has.length > 1 ? seg({ label: t('lookup.frames.part'), value: f, options: has.map(x => /** @type {[string, string]} */ ([x, t(`lookup.frames.${x}`)])), onChange: v => setOpt('f', v === has[0] ? '' : v) }) : null;
    toggle?.classList.add('lk-seg');
    if (f === 'sprechen') {
      return h('div', null, toggle, caption(t('lookup.frames.sprechenSub')),
        gr.sprechen.map((/** @type {any} */ T) => h('section', { class: 'lk-sec lk-teil' }, h('h2', null, T.name),
          T.groups.map((/** @type {any} */ g) => h('div', { class: 'lk-part' }, h('h3', null, g.en), h('ul', { class: 'lk-list' }, g.rows.map((/** @type {any} */ r) => frameRow(r, g, ''))))))));
    }
    const rows = gr.layers.filter((/** @type {any} */ r) => r.layer === 'door');
    return h('div', null, toggle, caption(t('lookup.frames.verbsSub')), list(rows, r => layerRow(r, '')));
  }

  drawNav();
  await draw();

  // warm the other sections while the phone is idle, so the first search is instant
  const idle = /** @type {any} */ (globalThis).requestIdleCallback || ((/** @type {() => void} */ f) => setTimeout(f, 400));
  idle(() => { if (alive) D.allContent(ctx.content, lang).catch(() => {}); });

  return cleanup;
}

/** The way into Explore's map: a few groups as rings, partly inked, like the map at overview. */
function mapArt() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'lk-map-art'); svg.setAttribute('aria-hidden', 'true');
  for (const [x, y, r, k] of [[30, 30, 15, 0.7], [50, 17, 9, 0.45], [12, 47, 8, 0.85], [48, 46, 11, 0.3], [13, 15, 7, 0.6], [30, 55, 6, 0.5]]) {
    const c = 2 * Math.PI * r;
    const base = document.createElementNS(NS, 'circle');
    base.setAttribute('cx', String(x)); base.setAttribute('cy', String(y)); base.setAttribute('r', String(r));
    base.setAttribute('fill', 'none'); base.setAttribute('stroke', 'var(--hairline-strong)'); base.setAttribute('stroke-width', '1.5');
    const arc = /** @type {SVGCircleElement} */ (base.cloneNode());
    arc.setAttribute('stroke', 'var(--ink)'); arc.setAttribute('stroke-dasharray', `${(c * k).toFixed(1)} ${c.toFixed(1)}`);
    arc.setAttribute('transform', `rotate(-90 ${x} ${y})`);
    svg.append(base, arc);
    for (let j = 0; j < Math.floor(r / 3.5); j++) {
      const w = (r * 1.2) * (1 - Math.abs(j - (r / 7)) / (r / 2.2));
      const line = document.createElementNS(NS, 'rect');
      line.setAttribute('x', (x - w / 2).toFixed(1)); line.setAttribute('y', (y - r / 2 + j * 3.4).toFixed(1)); line.setAttribute('width', Math.max(2, w).toFixed(1)); line.setAttribute('height', '1.4');
      line.setAttribute('fill', j % 3 === 2 ? 'var(--accent)' : 'var(--ink-3)'); line.setAttribute('rx', '0.7');
      svg.append(line);
    }
  }
  return svg;
}
