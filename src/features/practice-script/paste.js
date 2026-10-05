/* Script mode: a new script (#/practice/scripts/new, SCRIPT-UX §3.3). Phase 1 takes German, or German with English
   (EN/DE pairs); writing the German from English or notes is phase 2, so English input gets a plain notice. Detection
   runs locally on every change. Words he set in bold arrive marked. */
import { h, replace } from '../../core/dom.js';
import { field, chipChoice, notice } from '../../core/ui.js';
import * as P from '../../domain/script/parse.js';
import * as St from '../../data/scripts.js';
import { lexicon } from './lexicon.js';
import { lemmaOf, glossOf, headOf } from './lemma.js';
import { cardId } from './suggest.js';
import { MAX_CHARS, LONG_SCRIPT_WORDS, MIN_WORDS, DEFAULT_SECTION_KIND, DEFAULT_REGISTER } from '../../domain/script/config.js';
import { back, num } from './ui.js';
import { langAttr, dirAttr } from '../../core/lang.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export function mountPaste(el, ctx) {
  const { t, store } = ctx;
  const c = ctx.clock.ctx();
  let kind = /** @type {'talk' | 'retell'} */ (DEFAULT_SECTION_KIND), register = DEFAULT_REGISTER, forced = /** @type {string | null} */ (null), kindTouched = false;
  const title = /** @type {HTMLInputElement} */ (h('input', { class: 'input', name: 'script-title', autocomplete: 'off', maxlength: 80 }));
  const text = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input sc-paste', name: 'script-text', rows: 10, lang: langAttr(), dir: dirAttr(), spellcheck: 'false', autocapitalize: 'off',
    placeholder: t('practice.script.paste.ph') }));
  text.setAttribute('autocorrect', 'off');
  const textField = field({ label: t('practice.script.paste.text'), input: text });
  const found = h('div', { class: 'sc-detect', 'aria-live': 'polite' });
  const date = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'date', name: 'deliver-on', min: c.today }));
  // an empty date is a quiet button until he wants one, so an empty field never looks filled (design P1-24)
  const dateField = field({ label: t('practice.script.paste.date'), input: date, hint: t('practice.script.paste.dateHint') });
  dateField.hidden = true;
  const addDate = h('button', { type: 'button', class: 'btn btn-quiet pressable sc-adddate', 'aria-expanded': 'false', onclick: () => {
    dateField.hidden = false; addDate.hidden = true; date.focus(); try { /** @type {any} */ (date).showPicker?.(); } catch { /* not allowed */ } } }, t('practice.script.addDate'));
  const dateBox = h('div', { class: 'sc-datebox' }, addDate, dateField);
  const go = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable', disabled: true, onclick: () => create() }, t('practice.script.continue')));
  const kindChips = h('div', null);
  const drawKind = () => replace(kindChips, chipChoice({ label: t('practice.script.paste.kind'), value: kind, name: 'kind',
    options: [['talk', t('practice.script.kind.talk')], ['retell', t('practice.script.kind.retell')]], onChange: v => { kind = /** @type {any} */ (v); kindTouched = true; } }),
  h('p', { class: 'field-hint' }, t('practice.script.paste.kindHint')));
  drawKind();

  /** @type {ReturnType<typeof P.detect> | null} */ let det = null;
  function check() {
    const raw = text.value;
    det = raw.trim() ? P.detect(raw) : null;
    const fmt = forced || det?.format;
    if (det && !kindTouched) { const k = fmt === 'notes' ? 'retell' : DEFAULT_SECTION_KIND; if (k !== kind) { kind = k; drawKind(); } }
    if (det && !title.value.trim()) { const p = P.parseScript(raw, { format: fmt === 'en' ? 'de' : /** @type {any} */ (fmt), id: P.counterIds() }); if (p.title) title.placeholder = p.title; }
    let msg = null, ok = !!det;
    textField.setError(null);
    if (raw.length > MAX_CHARS) { textField.setError(t('practice.script.paste.tooLong')); ok = false; }
    else if (det && fmt === 'en') { msg = notice({ children: [h('p', null, t('practice.script.paste.english'))] }); ok = false; }
    else if (det && det.words < MIN_WORDS) { msg = h('p', { class: 'caption' }, t('practice.script.paste.short')); ok = false; }
    else if (det && det.words > LONG_SCRIPT_WORDS) msg = h('p', { class: 'caption' }, t('practice.script.paste.long', { min: Math.round(det.words / 110) }));
    replace(found, det ? [
      h('p', { class: 'sc-detect-line' }, h('span', null, t(`practice.script.fmt.${fmt}`), ' · ', fmt === 'en' ? t('practice.script.paste.wordsOnly', { words: num(det.words) }) : t('practice.script.paste.found', { n: det.sections, words: num(det.words) })),
        h('button', { type: 'button', class: 'btn btn-quiet pressable sc-change', 'aria-expanded': 'false', onclick: (/** @type {Event} */ e) => toggleFormats(/** @type {HTMLElement} */ (e.currentTarget)) }, t('practice.script.change'))),
      h('div', { class: 'sc-formats', hidden: true }, chipChoice({ label: t('practice.script.paste.format'), value: String(fmt), name: 'fmt',
        options: [['de', t('practice.script.fmt.de')], ['pairs', t('practice.script.fmt.pairs')], ['notes', t('practice.script.fmt.notes')]],
        onChange: v => { forced = v; check(); } })),
      msg] : null);
    go.disabled = !ok;
  }
  function toggleFormats(/** @type {HTMLElement} */ b) {
    const f = /** @type {HTMLElement} */ (found.querySelector('.sc-formats'));
    f.hidden = !f.hidden; b.setAttribute('aria-expanded', String(!f.hidden));
  }
  let timer = 0;
  text.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(check, 180); });

  async function create() {
    if (go.disabled) return;
    go.disabled = true;
    const raw = text.value;
    const fmt = /** @type {any} */ (forced || det?.format || 'de');
    const p = P.parseScript(raw, { format: fmt, id: P.idMaker(), kind });
    const id = P.idMaker()();
    const now = new Date().toISOString();
    const L = await lexicon(ctx).catch(() => null);
    const make = P.idMaker();
    /** @type {any[]} */ const marks = [];
    const seen = new Set();
    for (const b of p.bold) {
      const sent = p.sections.flatMap(s => s.sentences).find(s => s.id === b.sentenceId);
      if (!sent) continue;
      for (const surface of b.surface.split(/\s+/)) {
        const tok = P.tokenize(sent.de).find(x => x.w && x.t === surface.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''));
        if (!tok) continue;
        const lem = L ? lemmaOf(tok.t, L.idx, { start: tok.k === 0 }) : { lemma: tok.t, entry: null, how: 'guess' };
        const key = lem.lemma.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        marks.push({ id: make(), kind: 'word', sentenceId: sent.id, start: tok.k, end: tok.k, surface: tok.t, lemma: lem.lemma,
          head: headOf(lem.entry, lem.lemma), level: lem.entry?.level || null, gloss: glossOf(lem.entry), glossFrom: lem.entry ? 'list' : null,
          cardId: cardId(lem.lemma, lem.entry?.id ? lem.entry : null, L?.wordmap || {}, id => !!store.cards('b1')?.[id]?.reps), guess: !!(/** @type {any} */ (lem).guess) });
      }
    }
    const status = St.canActivate(store) ? 'active' : 'paused';
    const script = { id, v: 1, profileId: ctx.app?.profile?.id || null, title: title.value.trim() || p.title || t('practice.script.untitled'), register,
      deliverOn: date.value || null, targetMin: null, status, source: { format: fmt, wording: null }, sections: p.sections, marks, unmarked: [], forced: [],
      names: p.names.map(x => x.toLowerCase()), analysis: {}, flagged: [], createdAt: now, deletedAt: null };
    St.put(store, script);
    if (status === 'paused') ctx.toast(t('practice.script.tooMany'));
    ctx.go(`/practice/scripts/${id}/mark/${p.sections[0].id}`);
  }

  replace(el, h('div', { class: 'practice stack sc-new' },
    h('div', { class: 'sc-headrow' }, back('#/practice/scripts', t('practice.script.title')), h('span', { class: 'caption' }, t('practice.script.stepOf', { n: 1, total: 2 }))),
    h('div', { class: 'page-head' }, h('h1', null, t('practice.script.new'))),
    field({ label: t('practice.script.paste.title'), input: title }),
    textField, found,
    kindChips,
    chipChoice({ label: t('practice.script.paste.register'), value: register, name: 'register',
      options: [['informal', 'ihr'], ['formal', 'Sie'], ['both', t('practice.script.register.bothShort')]], onChange: v => { register = /** @type {any} */ (v); } }),
    h('p', { class: 'field-hint' }, t('practice.script.paste.registerHint')),
    dateBox,
    h('p', { class: 'caption sc-private' }, t('practice.script.paste.private')),
    h('div', { class: 'sc-actions' }, go)));
}
