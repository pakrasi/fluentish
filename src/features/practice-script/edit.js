/* Script mode: edit the text (#/practice/scripts/<id>/edit[/<section>], SCRIPT-UX §3.11). Sections as a list; tap one
   to change its title, its German (and its English, one line per sentence, when the script has English), whether it
   is Talk or Retell; add, delete and move sections with buttons. Save aligns old and new sentences (align.js) so ids,
   marks and schedules stay; a section whose text changed goes back to Gaps; the toast says what changed. */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { chipChoice } from '../../core/ui.js';
import * as P from '../../domain/script/parse.js';
import * as St from '../../data/scripts.js';
import * as Lad from '../../domain/script/ladder.js';
import { applyEdit } from './align.js';
import { lexicon } from './lexicon.js';
import { lemmaOf } from './lemma.js';
import { back } from './ui.js';
import { langAttr, dirAttr } from '../../core/lang.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} script @param {string | null} sectionId */
export async function mountEdit(el, ctx, script, sectionId) {
  const { t, store } = ctx;
  const hasEn = script.sections.some((/** @type {any} */ s) => s.sentences.some((/** @type {any} */ x) => x.en));
  /** @type {{id: string | null, title: string, kind: 'talk' | 'retell', note: string | null, de: string, en: string, open: boolean}[]} */
  let draft = script.sections.map((/** @type {any} */ s) => ({ id: s.id, title: s.title, kind: s.kind || 'talk', note: s.note, open: s.id === sectionId,
    de: s.sentences.map((/** @type {any} */ x) => x.de).join(' '), en: s.sentences.map((/** @type {any} */ x) => x.en || '').join('\n') }));
  let dirty = false;
  const L = await lexicon(ctx).catch(() => null);
  const list = h('ol', { class: 'sc-editlist' });

  function draw() {
    replace(list, draft.map((d, i) => {
      if (!d.open) {
        return h('li', { class: 'sc-edititem' },
          h('button', { type: 'button', class: 'row pressable sc-editrow', 'aria-expanded': 'false', onclick: () => { d.open = true; draw(); } },
            h('span', { class: 'sc-secnum tnum' }, String(i + 1)),
            h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, d.title || t('practice.script.edit.untitled')),
              h('span', { class: 'row-detail' }, t('practice.script.edit.words', { n: P.wordCount(d.de) }))), icon('next', { size: 16 })));
      }
      const title = /** @type {HTMLInputElement} */ (h('input', { class: 'input', value: d.title, maxlength: 80, 'aria-label': t('practice.script.edit.title') }));
      title.addEventListener('input', () => { d.title = title.value; dirty = true; });
      const de = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input sc-edit-de', rows: 8, lang: langAttr(), dir: dirAttr(), spellcheck: 'false', 'aria-label': t('practice.script.edit.german') }, d.de));
      de.value = d.de;
      de.addEventListener('input', () => { d.de = de.value; dirty = true; });
      const en = hasEn ? /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input', rows: 6, lang: 'en', 'aria-label': t('practice.script.edit.english') })) : null;
      if (en) { en.value = d.en; en.addEventListener('input', () => { d.en = en.value; dirty = true; }); }
      return h('li', { class: 'sc-edititem is-open' },
        h('div', { class: 'sc-edithead' }, h('span', { class: 'sc-secnum tnum' }, String(i + 1)), title,
          h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-label': t('practice.script.edit.close'), onclick: () => { d.open = false; draw(); } }, icon('close', { size: 16 }))),
        h('label', { class: 'field-label' }, t('practice.script.edit.german')), de,
        en ? [h('label', { class: 'field-label' }, t('practice.script.edit.english')), en, h('p', { class: 'field-hint' }, t('practice.script.edit.englishHint'))] : null,
        chipChoice({ label: t('practice.script.edit.kind'), value: d.kind, name: `kind-${i}`, options: [['talk', t('practice.script.kind.talk')], ['retell', t('practice.script.kind.retell')]], onChange: v => { d.kind = /** @type {any} */ (v); dirty = true; } }),
        h('div', { class: 'row-actions wrap' },
          h('button', { type: 'button', class: 'btn pressable', disabled: i === 0, onclick: () => swap(i, i - 1) }, t('practice.script.edit.up')),
          h('button', { type: 'button', class: 'btn pressable', disabled: i === draft.length - 1, onclick: () => swap(i, i + 1) }, t('practice.script.edit.down')),
          h('button', { type: 'button', class: 'btn btn-quiet pressable sc-bad', disabled: draft.length === 1, onclick: () => { draft.splice(i, 1); dirty = true; draw(); } }, icon('trash', { size: 16 }), t('practice.script.edit.delete'))));
    }));
  }
  /** @param {number} a @param {number} b */
  function swap(a, b) { [draft[a], draft[b]] = [draft[b], draft[a]]; dirty = true; draw(); }
  function save() {
    const edits = draft.filter(d => d.de.trim()).map(d => ({ id: d.id, title: d.title.trim(), kind: d.kind, note: d.note, de: d.de, en: hasEn ? d.en : null }));
    if (!edits.length) return;
    const taken = script.sections.flatMap((/** @type {any} */ s) => [s.id, ...s.sentences.map((/** @type {any} */ x) => x.id)]);
    const r = applyEdit(script, edits, { id: P.idMaker(taken), at: new Date().toISOString(), lemma: s => (L ? lemmaOf(s, L.idx).lemma.toLowerCase() : s.toLowerCase()) });
    r.script.sections.forEach((/** @type {any} */ s, /** @type {number} */ i) => { if (!s.title) s.title = t('practice.script.edit.sectionN', { n: i + 1 }); });
    St.put(store, r.script);
    const changed = new Set(r.sections.map(x => x.id));
    St.updateProgress(store, script.id, p => {
      const sections = { ...p.sections };
      for (const s of r.script.sections) {
        const was = script.sections.find((/** @type {any} */ x) => x.id === s.id);
        if (was && (was.kind || 'talk') !== s.kind) sections[s.id] = Lad.rekind(sections[s.id], s.kind);
        if (changed.has(s.id) && sections[s.id]) sections[s.id] = Lad.textChanged(sections[s.id], s);
      }
      return { ...p, sections };
    });
    const msg = [];
    for (const x of r.sections) if (x.changed || x.removed) msg.push(t('practice.script.edit.changed', { n: x.changed + x.removed + x.added, section: x.title }));
    if (r.marksRemoved.length) msg.push(t('practice.script.edit.marksRemoved', { n: r.marksRemoved.length, list: r.marksRemoved.join(', ') }));
    dirty = false;
    ctx.go(`/practice/scripts/${script.id}`);
    setTimeout(() => ctx.toast(msg.length ? msg.join(' ') : t('practice.script.edit.saved'), { ms: 6000 }), 60);
  }

  replace(el, h('div', { class: 'practice stack sc-edit' },
    back(`#/practice/scripts/${script.id}`, script.title),
    h('div', { class: 'page-head' }, h('h1', null, t('practice.script.edit.heading'))),
    h('p', { class: 'caption' }, t('practice.script.edit.help')),
    list,
    h('button', { type: 'button', class: 'btn pressable', onclick: () => { draft.push({ id: null, title: '', kind: 'talk', note: null, de: '', en: '', open: true }); dirty = true; draw(); } }, t('practice.script.edit.add')),
    h('div', { class: 'sc-actions' }, h('button', { type: 'button', class: 'btn btn-primary btn-wide pressable', onclick: () => save() }, t('practice.script.save')))));
  draw();
  return { unmount() {}, canLeave() { return !dirty || confirm(t('practice.script.edit.leave')); } };
}
