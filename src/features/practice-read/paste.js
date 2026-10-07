/* Reading: a new text (#/practice/read/new). Title, an optional source note, and the text: an article, a transcript,
   or subtitles (SRT, VTT, a copied YouTube transcript). Before it is saved, the estimate: its words, its level and how
   much of it he knows. It stays on this device. */
import { h, replace } from '../../core/dom.js';
import { field } from '../../core/ui.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { idMaker } from '../../domain/script/parse.js';
import * as R from '../shared/read-data.js';
import * as L from './logic.js';
import { language, knowledgeNow } from './load.js';
import { back, levelLine } from './ui.js';
import { enterMovesTo } from '../../core/keyboard.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountPaste(el, ctx) {
  const { t, store } = ctx;
  const title = /** @type {HTMLInputElement} */ (h('input', { class: 'input', autocomplete: 'off', maxlength: '120', lang: langAttr(), dir: dirAttr() }));
  const note = /** @type {HTMLInputElement} */ (h('input', { class: 'input', autocomplete: 'off', maxlength: '120', placeholder: t('read.paste.notePh') }));
  const text = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input rd-paste', rows: 10, lang: langAttr(), dir: dirAttr(), autocomplete: 'off', spellcheck: 'false', placeholder: t('read.paste.textPh') }));
  // Return in the title and the note moves on to the next field
  enterMovesTo(title, () => note); enterMovesTo(note, () => text);
  const est = h('p', { class: 'caption rd-est', 'aria-live': 'polite' });
  const go = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary pressable', disabled: true, onclick: () => save() }, t('read.paste.save')));
  /** @type {any} */ let last = null;

  const L0 = language(ctx);
  const K0 = knowledgeNow(ctx);

  /** The estimate of what is in the box now. */
  async function check() {
    const raw = text.value;
    const { text: clean, format } = L.cleanPaste(raw);
    go.disabled = !clean.trim();
    if (!clean.trim()) { est.textContent = ''; last = null; return; }
    const [Lg, K] = await Promise.all([L0, K0]);
    const r = L.makeRead({ raw, title: '', id: 'x', lang: Lg.lang, now: '', untitled: '' });
    const an = L.analyse(L.sentencesOf(r), { pack: Lg.pack, idx: Lg.idx, lexicon: Lg.lexicon, level: ctx.settings().level || 'B1', suggest: false });
    const e = L.estimate(an, { pack: Lg.pack, idx: Lg.idx, view: K || { get: () => ({ state: 'unseen' }) }, level: ctx.settings().level || 'B1', met: R.metSet(ctx.store) });
    last = e;
    est.textContent = [format !== 'de' ? t(`read.paste.format.${format}`) : null, t('read.paste.words', { n: e.words }), levelLine(e, t)].filter(Boolean).join(' · ');
  }
  let timer = 0;
  text.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => { check().catch(() => { est.textContent = ''; }); }, 220); });

  async function save() {
    if (go.disabled) return;
    go.disabled = true;
    const Lg = await L0;
    const r = L.makeRead({ raw: text.value, title: title.value, note: note.value, id: idMaker()(), lang: Lg.lang, profileId: ctx.app?.profile?.id || null, now: new Date().toISOString(), untitled: t('read.untitled') });
    if (!r.sections.length) { go.disabled = false; return; }
    if (!last) await check().catch(() => {});
    const e = last ? { ...last, at: ctx.clock.today() } : null;
    // a text he knows 98 % of opens in Read on (extensive): read for the story, tap only when stuck
    R.putRead(store, { ...r, estimate: e, mode: e && e.band === 'easy' ? 'extensive' : 'intensive' });
    ctx.go(`/practice/read/${r.id}`);
  }

  replace(el, h('div', { class: 'practice stack rd-new' },
    back('#/practice/read', t('read.title')),
    h('div', { class: 'page-head' }, h('h1', null, t('read.new'))),
    field({ label: t('read.paste.title'), input: title }),
    field({ label: t('read.paste.note'), input: note, hint: t('read.paste.noteHint') }),
    field({ label: t('read.paste.text'), input: text, hint: t('read.paste.textHint') }),
    est,
    h('p', { class: 'caption rd-private' }, t('read.paste.private')),
    h('div', { class: 'rd-actions' }, go)));
  return () => clearTimeout(timer);
}
