/* Script mode: a script's overview (#/practice/scripts/<id>, SCRIPT-UX §3.6). The ready figure (one numeral, an
   odometer), the script field (one row per section, one cell per sentence), the words, the full runs, the sections
   with their ladder and Talk/Retell switch, long sentences, and one button: the next step. The menu (···) edits the
   text, the date and the audience form, pauses, archives or deletes. */
import { h, replace, announce } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { chipChoice, notice } from '../../core/ui.js';
import { odometer, reduced } from '../../core/motion.js';
import { label } from '../../core/clock.js';
import * as P from '../../domain/script/parse.js';
import * as St from '../../data/scripts.js';
import * as Lad from '../../domain/script/ladder.js';
import { nextStep, hrefOf, words as wordState, runMinutes, scriptPhase } from '../../domain/script/plan.js';
import { applyEdit } from './align.js';
import { take } from './moment.js';
import { back, sheet, scriptField, landRow, stepSegs, dateLine, registerLine, clockTime } from './ui.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {any} script0 */
export function mountOverview(el, ctx, script0) {
  const { t, store } = ctx;
  let alive = true;
  const moment = take(script0.id);

  function render(first = false) {
    const script = St.get(store, script0.id);
    if (!script) { ctx.go('/practice/scripts', { replace: true }); return; }
    const c = ctx.clock.ctx();
    const prog = St.progress(store, script.id);
    const cards = St.cardOf(store);
    const r = Lad.readiness(script, prog, id => cards(id)?.rec, c.today);
    const nothingMarked = !script.sections.some((/** @type {any} */ s) => prog.sections?.[s.id]?.marked);
    // the numeral waits until a section has reached Cue: before that it can only say 0 (UX P0-5)
    const noCue = !script.sections.some((/** @type {any} */ s) => prog.sections?.[s.id]?.done?.cue);
    const nx = nextStep(script, prog, cards, c);
    const ws = wordState(script, cards, c);
    const ph = scriptPhase(c.today, script.deliverOn);
    const archived = script.status === 'archived', paused = script.status === 'paused';

    // ---- figure ----
    const fig = h('span', { class: 'numeral sc-numeral' });
    const dayLabel = script.deliverOn && script.deliverOn >= c.today ? label(script.deliverOn) : null;
    const figure = nothingMarked || noCue ? h('div', { class: 'sc-first' }, h('p', { class: 'lead' }, nothingMarked ? t('practice.script.first') : t('practice.script.firstCue')))
      : h('button', { type: 'button', class: 'sc-figure pressable', onclick: () => explain(dayLabel), 'aria-label': t('practice.script.readyAria', { pct: r.pct }) },
        h('span', { class: 'sc-figure-top' }, fig, h('span', { class: 'sc-pct' }, '%')),
        h('span', { class: 'label' }, t('practice.script.readyLabel')),
        h('span', { class: 'caption sc-define' }, dayLabel ? t('practice.script.readyDef', { date: dayLabel }) : t('practice.script.readyDefToday')));
    const field = scriptField(r);

    // ---- facts ----
    const marked = new Set((script.marks || []).map((/** @type {any} */ m) => m.cardId));
    const waiting = new Set((script.marks || []).filter((/** @type {any} */ m) => !m.gloss || m.guess).map((/** @type {any} */ m) => m.cardId)).size;
    const runs = prog.runs || [];
    const lastRun = runs[runs.length - 1];
    const facts = h('div', { class: 'sc-facts' },
      h('p', null, h('span', { class: 'label' }, t('practice.script.words')), ' ', h('span', { class: 'tnum' }, t('practice.script.wordsLine', { n: marked.size, known: ws.known.length, due: ws.due.length })),
),
      waiting ? h('p', { class: 'caption sc-waiting' }, t('practice.script.wordsWaiting', { n: waiting })) : null,
      h('p', null, h('span', { class: 'label' }, t('practice.script.runs')), ' ', h('span', { class: 'tnum' }, lastRun ? t('practice.script.runsLine', { n: runs.length, last: clockTime(lastRun.ms), target: runMinutes(script) })
        : t('practice.script.runsNone', { target: runMinutes(script) }))));

    // ---- sections ----
    const rows = script.sections.map((/** @type {any} */ s, /** @type {number} */ i) => {
      const p = Lad.blank(prog.sections?.[s.id]);
      const x = cards(Lad.srId(script.id, s.id));
      let cap;
      if (!p.marked) cap = t('practice.script.row.notMarked');
      else if (p.step === 'cue' && p.done.cue) cap = x?.rec?.due && x.rec.due > c.today ? t('practice.script.row.cueNext', { date: label(x.rec.due) }) : t('practice.script.row.cueDue');
      else cap = p.at && p.at > c.today ? t('practice.script.row.stepNext', { step: t(`practice.script.step.${p.step}`), date: label(p.at) }) : t(`practice.script.step.${p.step}`);
      const href = p.marked ? `#/practice/scripts/${script.id}/rehearse/${s.id}?step=${p.step}` : `#/practice/scripts/${script.id}/mark/${s.id}`;
      // the kind is plain text here; it is switched from the menu (UX P1-15), so a stray tap never drops steps
      return h('li', { class: 'sc-secrow' },
        h('a', { class: 'sc-seclink pressable', href, 'aria-label': t('practice.script.kindAria', { section: s.title, kind: t(`practice.script.kind.${s.kind || 'talk'}`) }) + `. ${cap}` },
          h('span', { class: 'sc-secnum tnum' }, String(i + 1)),
          h('span', { class: 'sc-secmain' }, h('span', { class: 'row-title' }, s.title), h('span', { class: 'sc-secline' }, stepSegs(s, p),
            h('span', { class: 'caption' }, h('span', { class: 'sc-kindcap' }, t(`practice.script.kind.${s.kind || 'talk'}`)), ' · ', cap)))));
    });
    const long = script.sections.flatMap((/** @type {any} */ s) => s.sentences.filter((/** @type {any} */ x) => P.isLong(x.de)).map((/** @type {any} */ x) => ({ s, x })));

    // ---- states ----
    const banners = [];
    if (paused) banners.push(notice({ children: [h('p', null, t('practice.script.pausedNote')), h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: () => setStatus('active') }, t('practice.script.resume')))] }));
    if (archived) banners.push(notice({ children: [h('p', null, script.deliverOn ? t('practice.script.delivered', { date: label(script.deliverOn) }) : t('practice.script.archivedNote'))] }));
    if (!archived && ph === 'after') banners.push(notice({ children: [h('p', { class: 'notice-title' }, t('practice.script.after')),
      h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: () => setStatus('archived') }, t('practice.script.afterYes')),
        h('button', { type: 'button', class: 'btn pressable', onclick: () => changeDate() }, t('practice.script.afterMove')))] }));
    const examAhead = c.exam && ['week', 'lastNew', 'eve', 'day'].includes(c.phase) && !(script.deliverOn && script.deliverOn <= c.exam);
    if (examAhead && !archived) banners.push(notice({ children: [h('p', null, t('practice.script.examFirst', { date: label(c.exam) }))] }));

    const primary = archived ? null : nothingMarked ? { href: `#/practice/scripts/${script.id}/mark/${script.sections[0].id}`, text: t('practice.script.markWords') }
      : nx.kind === 'rest' ? null : { href: hrefOf(script, nx), text: actionText(nx) };

    const view = h('div', { class: ['practice', 'stack', 'sc-over', primary && 'has-dock'], 'data-title': t('practice.script.title') },
      h('div', { class: 'sc-headrow' }, back('#/practice/scripts', t('practice.script.title')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable sc-menu', 'aria-label': t('practice.script.menu'), 'aria-haspopup': 'dialog', onclick: () => menu() }, '···')),
      h('div', { class: 'page-head sc-over-head' }, h('h1', null, script.title)),
      h('p', { class: 'label sc-dateline' }, script.deliverOn || archived ? dateLine(script, c.today, t) : null,
        !script.deliverOn && !archived ? h('button', { type: 'button', class: 'btn btn-quiet pressable sc-adddate', onclick: () => changeDate() }, t('practice.script.addDate')) : null),
      h('p', { class: 'caption' }, t('practice.script.audience', { who: registerLine(script, t) })),
      banners, figure, field, nothingMarked ? null : facts,
      h('section', { class: 'section sc-sections', 'aria-labelledby': 'sc-sec-h' }, h('h2', { id: 'sc-sec-h' }, t('practice.script.sections')), h('ol', { class: 'sc-seclist' }, rows)),
      long.length && !archived ? h('a', { class: 'row pressable', href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); longSheet(long); } },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('practice.script.long', { n: long.length })), h('span', { class: 'row-detail' }, t('practice.script.long.detail'))), icon('next', { size: 16 })) : null,
      h('p', { class: 'caption sc-private' }, t('practice.script.private')),
      primary ? h('div', { class: 'pr-queue-btn sc-dock' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: primary.href, id: 'sc-next' }, primary.text)) : null);
    const h1 = el.querySelector('h1');
    const hadFocus = h1 && document.activeElement === h1;
    replace(el, view);
    if (hadFocus) view.querySelector('h1')?.focus({ preventScroll: true });
    if (!nothingMarked) {
      // the numeral rolls from the value last seen; a section that just became known lands in accent
      const from = prog.seenPct ?? 0;
      const land = first && moment && r.rows.find(x => x.id === moment.sectionId && x.ready);
      if (!noCue) {
        if (first && from !== r.pct && !reduced()) { odometer(fig, from, { label: `${from}` }); setTimeout(() => odometer(fig, r.pct, { label: `${r.pct}` }), land ? 380 : 60); }
        else odometer(fig, r.pct, { label: `${r.pct}` });
      }
      if (land) {
        const row = field.querySelector(`[data-section="${CSS.escape(moment.sectionId)}"]`);
        row?.querySelectorAll('.sc-cell').forEach(x => { x.className = 'sc-cell is-learning'; });
        requestAnimationFrame(() => landRow(field, moment.sectionId));
        announce(t('practice.script.landed', { section: land.title, pct: r.pct }));
      } else if (first && moment && !reduced()) {
        // after a Cue grade that did not make the section ready yet: its row fills with the runway spring
        field.querySelector(`[data-section="${CSS.escape(moment.sectionId)}"]`)?.querySelectorAll('.sc-cell').forEach((x, i) => {
          /** @type {HTMLElement} */ (x).style.setProperty('--i', String(Math.min(i, 24))); x.classList.add('is-fill');
        });
      }
      if (prog.seenPct !== r.pct) St.updateProgress(store, script.id, p => ({ ...p, seenPct: r.pct }));
    }
  }

  /** @param {any} nx */
  function actionText(nx) {
    if (nx.kind === 'mark') return t('practice.script.act.mark', { section: nx.section.title });
    if (nx.kind === 'words') return t('practice.script.act.words', { n: nx.n, min: nx.minutes });
    if (nx.kind === 'cue') return t('practice.script.act.cue', { section: nx.section.title });
    if (nx.kind === 'step') return t('practice.script.act.step', { step: t(`practice.script.step.${nx.step}`), section: nx.section.title, min: nx.minutes });
    return t('practice.script.act.run', { min: nx.minutes });
  }

  /** Switch a section between Talk and Retell, with Undo (the switch can drop the Letters and Gaps steps). @param {string} id @param {'talk' | 'retell'} kind */
  function switchKind(id, kind) {
    const s = St.get(store, script0.id); if (!s) return;
    const sec = s.sections.find((/** @type {any} */ x) => x.id === id);
    if (!sec || (sec.kind || 'talk') === kind) return;
    const prevProg = structuredClone(St.progress(store, s.id).sections?.[id] || null), prevKind = sec.kind || 'talk';
    St.put(store, { ...s, sections: s.sections.map((/** @type {any} */ x) => (x.id === id ? { ...x, kind } : x)) });
    St.updateProgress(store, s.id, p => ({ ...p, sections: { ...p.sections, [id]: Lad.rekind(p.sections[id], kind) } }));
    announce(t('practice.script.kindNow', { section: sec.title, kind: t(`practice.script.kind.${kind}`) }));
    ctx.toast(t('practice.script.kindNow', { section: sec.title, kind: t(`practice.script.kind.${kind}`) }), { action: t('practice.script.del.undo'), onAction: () => {
      const s2 = St.get(store, script0.id); if (!s2) return;
      St.put(store, { ...s2, sections: s2.sections.map((/** @type {any} */ x) => (x.id === id ? { ...x, kind: prevKind } : x)) });
      St.updateProgress(store, s2.id, p => ({ ...p, sections: { ...p.sections, [id]: prevProg } }));
    } });
  }
  function kinds() {
    const s = St.get(store, script0.id); if (!s) return;
    sheet({ title: t('practice.script.menu.kind'), children: [h('p', { class: 'field-hint' }, t('practice.script.paste.kindHint')),
      ...s.sections.map((/** @type {any} */ x) => chipChoice({ label: x.title, value: x.kind || 'talk', name: `kind-${x.id}`,
        options: [['talk', t('practice.script.kind.talk')], ['retell', t('practice.script.kind.retell')]], onChange: v => switchKind(x.id, /** @type {any} */ (v)) }))] });
  }
  /** @param {string} status */
  function setStatus(status) {
    const s = St.get(store, script0.id); if (!s) return;
    if (status === 'active' && s.status !== 'active' && !St.canActivate(store)) { ctx.toast(t('practice.script.tooMany')); return; }
    St.put(store, { ...s, status });
  }
  /** @param {string | null} dayLabel */
  function explain(dayLabel) {
    sheet({ title: t('practice.script.readyLabel'), children: [h('p', null, t('practice.script.explain1')), h('p', null, dayLabel ? t('practice.script.explain2', { date: dayLabel }) : t('practice.script.explain2Today')), h('p', { class: 'caption' }, t('practice.script.explain3'))] });
  }
  function changeDate() {
    const s = St.get(store, script0.id); if (!s) return;
    const c = ctx.clock.ctx();
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'date', value: s.deliverOn || '', min: c.today, 'aria-label': t('practice.script.paste.date') }));
    const sh = sheet({ title: t('practice.script.paste.date'), children: [input, h('p', { class: 'field-hint' }, t('practice.script.paste.dateHint')),
      h('div', { class: 'row-actions wrap' },
        h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => { St.put(store, { ...St.get(store, s.id), deliverOn: input.value || null, status: s.status === 'archived' ? 'active' : s.status }); sh.close(); } }, t('practice.script.save')),
        s.deliverOn ? h('button', { type: 'button', class: 'btn pressable', onclick: () => { St.put(store, { ...St.get(store, s.id), deliverOn: null }); sh.close(); } }, t('practice.script.noDateSet')) : null)] });
    input.focus();
  }
  function menu() {
    const s = St.get(store, script0.id); if (!s) return;
    const item = (/** @type {string} */ text, /** @type {() => void} */ fn, /** @type {string | null} */ cls = null) => h('button', { type: 'button', class: ['sc-menuitem', 'pressable', cls], onclick: () => { sh.close(); setTimeout(fn, 180); } }, text);
    const sh = sheet({ title: s.title, children: [
      h('div', { class: 'sc-menulist' },
        item(t('practice.script.menu.edit'), () => ctx.go(`/practice/scripts/${s.id}/edit`)),
        item(t('practice.script.menu.date'), () => changeDate()),
        item(t('practice.script.menu.kind'), () => kinds()),
        item(t('practice.script.menu.audience'), () => audience()),
        item(t('practice.script.menu.title'), () => rename()),
        s.status === 'paused' ? item(t('practice.script.resume'), () => setStatus('active')) : s.status === 'active' ? item(t('practice.script.menu.pause'), () => setStatus('paused')) : null,
        s.status === 'archived' ? item(t('practice.script.menu.unarchive'), () => setStatus(St.canActivate(store) ? 'active' : 'paused')) : item(t('practice.script.menu.archive'), () => setStatus('archived')),
        item(t('practice.script.menu.delete'), () => del(), 'is-bad'))] });
  }
  function audience() {
    const s = St.get(store, script0.id); if (!s) return;
    const sh = sheet({ title: t('practice.script.menu.audience'), children: [chipChoice({ label: t('practice.script.paste.register'), value: s.register || 'both', name: 'register',
      options: [['informal', 'ihr'], ['formal', 'Sie'], ['both', t('practice.script.register.bothShort')]], onChange: v => { St.put(store, { ...St.get(store, s.id), register: v }); setTimeout(() => sh.close(), 200); } }),
    h('p', { class: 'field-hint' }, t('practice.script.paste.registerHint'))] });
  }
  function rename() {
    const s = St.get(store, script0.id); if (!s) return;
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', value: s.title, maxlength: 80, 'aria-label': t('practice.script.paste.title') }));
    const sh = sheet({ title: t('practice.script.menu.title'), children: [input, h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary pressable',
      onclick: () => { if (input.value.trim()) St.put(store, { ...St.get(store, s.id), title: input.value.trim() }); sh.close(); } }, t('practice.script.save')))] });
    input.focus();
  }
  function del() {
    const s = St.get(store, script0.id); if (!s) return;
    const n = new Set((s.marks || []).map((/** @type {any} */ m) => m.cardId)).size;
    const box = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: 'sc-dropwords' }));
    const sh = sheet({ title: t('practice.script.del.title', { title: s.title }), children: [
      h('p', null, t('practice.script.del.body', { n })),
      n ? h('label', { class: 'sc-check', for: 'sc-dropwords' }, box, h('span', null, t('practice.script.del.words'))) : null,
      h('div', { class: 'row-actions wrap' },
        h('button', { type: 'button', class: 'btn pressable sc-bad', onclick: () => { sh.close(); remove(s, box.checked); } }, t('practice.script.del.yes')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => sh.close() }, t('practice.script.del.no')))] });
  }
  /** @param {any} s @param {boolean} dropWords */
  function remove(s, dropWords) {
    const at = new Date().toISOString();
    St.put(store, { ...s, deletedAt: at });
    let undone = false;
    ctx.toast(t('practice.script.del.done', { title: s.title }), { action: t('practice.script.del.undo'), onAction: () => { undone = true; St.put(store, { ...St.get(store, s.id) || s, ...s, deletedAt: null }); ctx.go(`/practice/scripts/${s.id}`); } });
    setTimeout(() => { if (!undone) St.purge(store, s.id, { dropWords, at }); }, 4300);
    ctx.go('/practice/scripts');
  }
  /** @param {{s: any, x: any}[]} long */
  function longSheet(long) {
    const body = h('div', { class: 'sc-longlist' });
    const draw = () => {
      const s = St.get(store, script0.id); if (!s) return;
      const now = s.sections.flatMap((/** @type {any} */ sec) => sec.sentences.filter((/** @type {any} */ x) => P.isLong(x.de)).map((/** @type {any} */ x) => ({ s: sec, x })));
      if (!now.length) { replace(body, h('p', { class: 'lead' }, t('practice.script.long.none'))); return; }
      replace(body, now.map(({ s: sec, x }) => {
        const parts = P.splitLocal(x.de);
        return h('div', { class: 'sc-longitem' }, h('p', { class: 'sc-longtext', lang: 'de' }, x.de), h('p', { class: 'caption' }, t('practice.script.long.words', { n: P.wordCount(x.de), section: sec.title })),
          parts ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn pressable', onclick: () => { split(sec.id, x.id, parts); draw(); } }, t('practice.script.long.split')),
            h('span', { class: 'caption sc-split-preview', lang: 'de' }, `${parts[0]} / ${parts[1]}`)) : h('p', { class: 'caption' }, t('practice.script.long.noSplit')));
      }));
    };
    draw();
    sheet({ title: t('practice.script.long', { n: long.length }), children: [h('p', { class: 'caption' }, t('practice.script.long.help')), body] });
  }
  /** @param {string} secId @param {string} sentId @param {[string, string]} parts */
  function split(secId, sentId, parts) {
    const s = St.get(store, script0.id); if (!s) return;
    const edits = s.sections.map((/** @type {any} */ sec) => ({ id: sec.id, title: sec.title, kind: sec.kind, note: sec.note,
      de: sec.sentences.map((/** @type {any} */ x) => (x.id === sentId ? `${parts[0]} ${parts[1]}` : x.de)).join(' ') }));
    const r = applyEdit(s, edits, { id: P.idMaker(s.sections.flatMap((/** @type {any} */ x) => [x.id, ...x.sentences.map((/** @type {any} */ y) => y.id)])), at: new Date().toISOString() });
    // the English line stays with the first half
    St.put(store, r.script);
    St.updateProgress(store, s.id, p => ({ ...p, sections: { ...p.sections, [secId]: Lad.textChanged(p.sections[secId], s.sections.find((/** @type {any} */ x) => x.id === secId)) } }));
  }

  render(true);
  const offs = [store.subscribe(St.KV, () => alive && render()), store.subscribe(St.PROGRESS, () => {}), store.subscribe('cards:script', () => alive && render())];
  return () => { alive = false; offs.forEach(f => f()); };
}

