/* Profile › Goals and week (#/profile/goal, #/profile/week; round 4, L1c; MAINTENANCE-PLAN §5.3). It replaces the
   round 3 Goal section.
     Goals   the level he works towards (goal.level, an optional month goal.by), the exam (an optional goal he can add,
             move or remove: removing it hides the Exam tab and keeps every attempt), his time (the week plan's sum,
             or minutes a day without one), and the scripts that have a delivery date (practice-script's deliverOn).
     Week    minutes and a kind of day for each weekday (domain/week.js); a kind whose feature has not shipped
             (not in LIVE_SLOTS) is planned as a Normal day and says "coming later".
   Every write goes through data/settings.js: setCourse() for the course's fields, setExamDate() for the date (which
   writes through setCourse()), setSetting() for minutes a day. Nothing here writes a card. */
import { h } from '../../core/dom.js';
import { label, windowStart, parse } from '../../core/clock.js';
import { config } from '../../core/config.js';
import { section, seg, field, nextId, backLink } from '../../core/ui.js';
import { setSetting, setExamDate, setCourse, examDate, activeCourse, MODULES } from '../../data/settings.js';
import { defaultWeek, weekMinutes, courseWeek } from '../../domain/week.js';
import { courseGoal } from '../../domain/levels.js';
import { hasMockExam } from '../../domain/modules.js';
import * as St from '../../domain/script/store.js';
import { disclose } from '../../core/motion.js';
import { weekEditor } from './week-editor.js';

/** Exams a goal may name that have no mock tests in this build yet: date only (PLAN-REVIEW S9), per language. */
const DATE_ONLY = /** @type {Record<string, string[]>} */ ({ german: ['goethe-b2'] });
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TARGETS = ['B1', 'B2', 'C1'];
const nf = new Intl.NumberFormat('en-GB');

/** Minutes as he reads them: "45 min", "4 h 05". @param {(k: string, v?: any) => string} t @param {number} n */
function fmtMin(t, n) {
  const m = Math.max(0, Math.round(n));
  if (m < 60) return t('unit.min', { n: m });
  const hr = Math.floor(m / 60), r = m % 60;
  return r ? t('unit.hm', { h: hr, m: String(r).padStart(2, '0') }) : t('unit.h', { h: hr });
}
/** 'YYYY-MM' as "June 2027". @param {string} m */
const monthLabel = m => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(parse(`${m}-01`));

/**
 * The page. Returns its element; it rebuilds its own sections after each write.
 * @param {import('../contract.js').ViewCtx} ctx @param {{exams: any[], languages: any[], render: () => void}} o
 *   render: the profile page's own render (the courses list and the header line follow a goal change)
 */
export function goalsPage(ctx, { exams, languages }) {
  const { store, t, bus, app } = ctx;
  const appCtx = () => ({ store, hlc: app.hlc, bus, clock: ctx.clock });
  /** @type {'level' | 'exam' | 'remove' | 'add' | null} */ let open = null;
  /** @type {string | null} */ let addPick = null;
  let justOpened = false;
  /** @type {any} */ let gate = null;
  /** @type {{level: string, k: number, n: number}[] | null} */ let levels = null;

  const courseId = () => ctx.settings().activeCourse;
  /** @param {Record<string, any>} patch */
  const writeCourse = patch => {
    const id = courseId();
    if (id) setCourse(appCtx(), id, patch);
    else for (const [k, v] of Object.entries(patch)) if (k === 'goal.exam') setSetting(appCtx(), 'exam.type', v);
  };
  const examName = (/** @type {string | null} */ id) => (!id ? '' : id === 'other' ? t('goal.exam.other')
    : exams.find(x => x.id === id)?.name || (DATE_ONLY.german.includes(id) ? t(`goals.exam.name.${id}`) : id));

  /** The week editor of the page now (stopped when the page is rebuilt). @type {{el: HTMLElement, stop: () => void} | null} */ let editor = null;
  /** Rebuild the page in place and keep the focus on the same control (matched by name, else by id). */
  function rerender() {
    const a = /** @type {HTMLElement | null} */ (document.activeElement);
    const key = a?.getAttribute('name'), id = a?.id;
    editor?.stop(); editor = null;
    page.replaceChildren(...parts());
    const back = key ? page.querySelector(`[name="${CSS.escape(key)}"]`) : id ? page.querySelector(`#${CSS.escape(id)}`) : null;
    /** @type {HTMLElement | null} */ (back)?.focus({ preventScroll: true });
  }

  function parts() {
    const s = ctx.settings();
    return [
      backLink({ href: '#/profile', label: t('goals.back') }),
      h('header', { class: 'page-head' }, h('h1', null, t('goals.title'))),
      goals(s), weekPlan(s)];
  }

  /* ---------- goals ---------- */
  /** @param {any} s */
  function goals(s) {
    const c = ctx.clock.ctx();
    const lang = languages.find(l => l.id === s.language);
    const g = courseGoal(s);
    const by = activeCourse(s)?.goal?.by || null;
    const sec = section(t('goals.goals'), h('p', { class: 'caption section-sub' }, t('goals.sub', { lang: lang ? lang.name : t('profile.noLanguage') })));
    sec.id = 'profile-goal';
    sec.classList.add('goals');
    const cards = [];

    // the level goal
    if (g.goal || open === 'level') cards.push(levelCard(s, g, by));

    // the exam goal
    if (s.exam.type) cards.push(examCard(s, c));

    // time
    const week = courseWeek(s);
    // (no button: the week plan is the next section)
    cards.push(card('time', week ? t('goals.time.week', { t: fmtMin(t, weekMinutes(week)) }) : t('goals.time.day', { t: fmtMin(t, s.minutesPerDay) }), null,
      h('p', { class: 'goal-meta' }, week ? t('goals.time.metaWeek') : t('goals.time.metaDay'))));

    // scripts with a delivery date
    for (const sc of St.list(store).filter((/** @type {any} */ x) => x.deliverOn && x.status !== 'archived' && x.deliverOn >= c.today)) {
      cards.push(card('script', t('goals.script.what', { title: sc.title, date: label(sc.deliverOn) }),
        h('a', { class: 'btn pressable', href: `#/practice/scripts/${encodeURIComponent(sc.id)}`, 'aria-label': `${t('goals.script.open')}: ${sc.title}` }, t('goals.script.open')),
        h('p', { class: 'goal-meta' }, t('goals.script.meta'))));
    }

    // add a goal
    const add = [
      !s.exam.type ? h('button', { type: 'button', class: 'chip pressable', name: 'add:exam', 'aria-expanded': String(open === 'add'), 'aria-controls': 'goal-add-panel', onclick: () => { open = open === 'add' ? null : 'add'; justOpened = open === 'add'; addPick = null; rerender(); } }, t('goals.kind.exam')) : null,
      !g.goal && open !== 'level' ? h('button', { type: 'button', class: 'chip pressable', name: 'add:level', onclick: () => { open = 'level'; rerender(); } }, t('goals.kind.level')) : null,
    ].filter(Boolean);
    // (Element.append writes a null as the text "null")
    // the add-exam panel opens with the disclosure motion (motion.js disclose), as Practice's groups do
    /** @type {HTMLElement | null} */ let addPanel = null;
    if (open === 'add' && !s.exam.type) {
      addPanel = h('div', { class: 'reveal-answer goal-add-panel', id: 'goal-add-panel' }, h('div', null, addExam(s)));
      const btn = /** @type {HTMLElement | undefined} */ (add.find(b => b && b.getAttribute('name') === 'add:exam'));
      if (justOpened && btn) { justOpened = false; requestAnimationFrame(() => requestAnimationFrame(() => { if (addPanel) disclose(btn, addPanel, true); })); }
      else addPanel.classList.add('is-open');
    }
    sec.append(...[...cards,
      add.length ? h('div', { class: 'goal-add' }, h('p', { class: 'field-label' }, t('goals.add')), h('div', { class: 'chips' }, add)) : null,
      addPanel].filter(x => x != null));
    return sec;
  }

  /**
   * One goal: its kind, what it is, its action, and what follows from it.
   * @param {string} kind @param {string} what @param {HTMLElement | null} action @param {...any} rest
   */
  function card(kind, what, action, ...rest) {
    return h('div', { class: 'goal-card', dataset: { goal: kind } },
      h('p', { class: 'goal-kind' }, t(`goals.kind.${kind}`)),
      h('p', { class: 'goal-what' }, what),
      action ? h('div', { class: 'goal-action' }, action) : null,
      ...rest);
  }

  /** @param {any} s @param {{goal: string | null, level: string | null}} g @param {string | null} by */
  function levelCard(s, g, by) {
    const editing = open === 'level';
    const what = g.goal ? t(by ? 'goals.level.whatBy' : 'goals.level.what', { level: g.goal, month: by ? monthLabel(by) : '' }) : t('goals.level.edit');
    const x = g.goal && levels ? levels.find(l => l.level === g.goal) : null;
    const share = x ? h('p', { class: 'goal-meta' }, t('goals.level.share', { p: Math.round((x.k / x.n) * 100), level: g.goal, k: nf.format(x.k), n: nf.format(x.n) })) : null;
    const track = x ? h('span', { class: 'track goal-track', 'aria-hidden': 'true' }, h('span', { class: 'fill', style: { transform: `scaleX(${x.k / x.n})` } })) : null;
    const gateEl = g.goal && gate ? gateLines(gate) : null;
    const editBtn = g.goal ? h('button', { type: 'button', class: 'btn pressable', name: 'edit:level', 'aria-expanded': String(editing), 'aria-label': t('goals.level.editAria'), onclick: () => { open = editing ? null : 'level'; rerender(); } }, t('goals.edit')) : null;
    return card('level', what, editBtn,
      h('p', { class: 'goal-meta' }, g.level ? t('goals.level.now', { level: g.level }) : null), share, track, gateEl,
      editing ? levelEditor(s, g, by) : null);
  }

  /** @param {any} gt levelGate() */
  function gateLines(gt) {
    if (gt.reason === 'examWindow') return h('p', { class: 'goal-meta goal-gate' }, t('goal.gate.examWindow'));
    if (gt.reason) return null;
    // one row per strand: its name, its state, and a 4 px meter of how far the gate is (the share of the B1 items it
    // counts, against the half it needs), so "0 of 473" reads as a meter
    return h('div', { class: 'goal-gate' }, h('p', { class: 'goal-meta' }, h('b', null, t('goals.gate.title'))),
      // the B2 layer has grammar and phrases; B2 words reach him through Word clusters and reading (pool.js b2Layer
      // makes no word items), so the words strand is not listed as if it opened something (UX review #6)
      h('ul', { class: 'goal-gate-list' }, ['g', 'p'].filter(k => gt.strands && gt.strands[k]).map(k => {
        const st = gt.strands[k];
        const share = st.n ? Math.min(1, (st.seen || 0) / Math.max(1, Math.ceil(st.n / 2))) : 0;
        return h('li', { class: 'goal-gate-row' },
          h('span', { class: 'goal-gate-name' }, t(`goal.gate.strand.${k}`)),
          h('span', { class: 'goal-gate-state' }, st.state === 'open' ? t('goal.gate.open') : st.state === 'mix' ? t('goal.gate.mix') : t('goal.gate.closed', { seen: nf.format(st.seen), n: nf.format(st.n) })),
          st.state === 'closed' ? h('span', { class: 'track goal-gate-track', 'aria-hidden': 'true' }, h('span', { class: 'fill', style: { transform: `scaleX(${share.toFixed(3)})` } })) : null);
      })),
      h('p', { class: 'goal-meta' }, t('goal.gate.wordsNote')));
  }

  /** @param {any} s @param {{goal: string | null, level: string | null}} g @param {string | null} by */
  function levelEditor(s, g, by) {
    const targets = h('div', { class: 'form-field' }, h('p', { class: 'field-label', id: 'lg-l' }, t('goals.level.target')),
      h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'lg-l' }, TARGETS.map(L => h('button', { type: 'button', class: 'chip pressable', name: `goal-level:${L}`, 'aria-pressed': String(g.goal === L),
        onclick: () => { writeCourse({ 'goal.level': L }); refreshGate(); if (!levels) loadLevels(); rerender(); } }, L))));
    const byIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'month', name: 'goal-by', value: by || '', placeholder: 'YYYY-MM', inputmode: 'numeric' }));
    const byField = field({ label: t('goals.level.by'), input: byIn, hint: t('goals.level.byHint') });
    byIn.addEventListener('change', () => {
      const v = byIn.value.trim();
      if (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) { byField.setError(t('goals.level.byBad')); return; }
      byField.setError(null);
      if (!g.goal) return;
      writeCourse({ 'goal.by': v || null });
      rerender();
    });
    const now = h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('goals.level.current')),
      seg({ label: t('goals.level.current'), value: s.level || '', options: config.levels.map(l => /** @type {[string, string]} */ ([l, l])), onChange: v => { writeCourse({ level: v }); refreshGate(); rerender(); } }));
    return h('div', { class: 'goal-editor' }, targets, g.goal ? byField : null, now,
      g.goal ? h('button', { type: 'button', class: 'btn btn-quiet pressable', name: 'goal-level-remove', onclick: () => {
        writeCourse({ 'goal.level': null, 'goal.by': null }); open = null; ctx.toast(t('goals.level.removed')); refreshGate(); rerender();
      } }, t('goals.level.remove')) : null);
  }

  /** @param {any} s @param {any} c */
  function examCard(s, c) {
    const date = examDate(s);
    const name = examName(s.exam.type);
    const mocks = hasMockExam(s);
    const editing = open === 'exam', removing = open === 'remove';
    const what = date ? t('goals.exam.what', { exam: name, date: label(date) }) : t('goals.exam.noDate', { exam: name });
    const actions = h('div', { class: 'goal-actions' },
      h('button', { type: 'button', class: 'btn pressable', name: 'exam:move', 'aria-expanded': String(editing), onclick: () => { open = editing ? null : 'exam'; rerender(); } }, date ? t('goals.exam.move') : t('goals.exam.setDate')),
      h('button', { type: 'button', class: 'btn btn-quiet pressable', name: 'exam:remove', 'aria-expanded': String(removing), onclick: () => { open = removing ? null : 'remove'; rerender(); } }, t('goals.exam.remove')));
    return card('exam', what, actions,
      h('p', { class: 'goal-meta derived', 'aria-live': 'polite' }, derived(c)),
      mocks ? null : h('p', { class: 'goal-meta' }, t('goals.exam.dateOnly')),
      editing ? moveExam(s, c, mocks) : null,
      removing ? h('div', { class: 'goal-editor confirm', role: 'group', 'aria-labelledby': 'rm-q' },
        h('p', { id: 'rm-q' }, t('goals.exam.removeQ')),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-danger pressable', name: 'exam:remove-yes', onclick: () => {
            // the goal goes, the attempts stay (store.attempts and the synced results are never touched here)
            if (examDate(ctx.settings())) setExamDate(appCtx(), null);
            writeCourse({ 'goal.exam': null });
            open = null; ctx.refreshShell(); ctx.toast(t('goals.exam.removed')); rerender();
          } }, t('goals.exam.removeYes')),
          h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { open = null; rerender(); } }, t('data.delete.no')))) : null);
  }

  /** @param {any} s @param {any} c @param {boolean} mocks */
  function moveExam(s, c, mocks) {
    const date = examDate(s);
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'date', name: 'exam-date', value: date || '', min: c.today }));
    const f = field({ label: t('goal.date'), input, hint: t('goals.exam.effect.move') });
    input.addEventListener('change', () => {
      const r = setExamDate(appCtx(), input.value || null);
      if (!r.ok) { f.setError(t(/** @type {string} */ (r.error))); return; }
      f.setError(null);
      rerender();
    });
    const modules = mocks ? h('div', { class: 'form-field' }, h('p', { class: 'field-label', id: 'mods-l' }, t('goal.modules')),
      h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'mods-l' }, MODULES.map(m => {
        const def = exams.find(x => x.id === s.exam.type)?.modules.find((/** @type {any} */ x) => x.id === m);
        const on = s.exam.modules.includes(m);
        return h('button', { type: 'button', name: `module:${m}`, class: 'chip pressable', 'aria-pressed': String(on), onclick: () => {
          const next = on ? s.exam.modules.filter((/** @type {string} */ x) => x !== m) : MODULES.filter(x => x === m || s.exam.modules.includes(x));
          if (next.length) { setSetting(appCtx(), 'exam.modules', next); rerender(); }
        } }, def ? def.name : m);
      }))) : null;
    return h('div', { class: 'goal-editor' }, h('div', { class: 'date-row' }, f,
      date ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { setExamDate(appCtx(), null); ctx.toast(t('goal.date.cleared')); rerender(); } }, t('goal.date.clear')) : null),
    modules);
  }

  /** @param {any} s */
  function addExam(s) {
    const mockIds = exams.filter(x => x.language === s.language).map(x => x.id);
    const options = [...mockIds, ...(DATE_ONLY[s.language] || []).filter(id => !mockIds.includes(id)), 'other'];
    const pick = addPick || options[0];
    const withMocks = mockIds.includes(pick);
    const id = nextId('xa');
    const dateIn = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'date', name: 'exam-date-new', min: ctx.clock.today() }));
    const f = field({ label: t('goals.exam.dateOpt'), input: dateIn });
    return h('div', { class: 'goal-sheet', role: 'group', 'aria-labelledby': id },
      h('h3', { id, class: 'goal-sheet-title' }, t('goals.exam.add')),
      h('div', { class: 'chips', role: 'group', 'aria-label': t('goal.exam') }, options.map(x => h('button', { type: 'button', class: 'chip pressable', name: `add-exam:${x}`, 'aria-pressed': String(x === pick),
        onclick: () => { addPick = x; rerender(); } }, mockIds.includes(x) || x === 'other' ? (exams.find(e => e.id === x)?.short || examName(x)) : `${t(`goals.exam.short.${x}`)} (${t('goals.exam.later')})`))),
      f,
      h('ul', { class: 'goal-effects' },
        h('li', null, withMocks ? t('goals.exam.effect.tab') : t('goals.exam.effect.tabDateOnly')),
        h('li', null, t('goals.exam.effect.window')),
        h('li', null, t('goals.exam.effect.move')),
        h('li', null, t('goals.exam.effect.noDate'))),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-primary pressable', name: 'add-exam:save', onclick: () => {
          const d = dateIn.value || null;
          if (d) { const r = setExamDate(appCtx(), d); if (!r.ok) { f.setError(t(/** @type {string} */ (r.error))); return; } }
          writeCourse({ 'goal.exam': pick });
          if (withMocks) setSetting(appCtx(), 'exam.modules', [...MODULES]);
          open = null; addPick = null; ctx.refreshShell(); ctx.toast(t('goals.exam.added', { exam: examName(pick) })); rerender();
        } }, t('goals.exam.addShort')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { open = null; addPick = null; rerender(); } }, t('data.delete.no'))));
  }

  /** What the date controls, restated so a change shows at once (UX §4.11). @param {any} c */
  function derived(c) {
    if (c.phase === 'none' && c.exam) return t('goal.derived.far', { n: c.daysLeft, start: label(windowStart(c.exam)) });
    if (c.phase === 'none') return t('goal.derived.none');
    if (c.phase === 'after') return t('goal.derived.after', { date: label(c.exam) });
    if (c.phase === 'day') return t('goal.derived.day');
    if (c.phase === 'eve') return t('goal.derived.eve');
    if (c.phase === 'lastNew') return t('goal.derived.lastNew', { cap: label(c.capDay) });
    return t('goal.derived.week', { n: c.daysLeft, lastNew: label(c.lastNewDay), cap: label(c.capDay) });
  }

  /* ---------- the week plan ---------- */
  /** @param {any} s */
  function weekPlan(s) {
    const week = courseWeek(s);
    const c = ctx.clock.ctx();
    const sec = section(t('week.title'), h('p', { class: 'caption section-sub' }, t('week.sub')));
    sec.id = 'profile-week';
    sec.classList.add('week-plan');
    const inWindow = !!c.exam && ['week', 'lastNew', 'eve', 'day'].includes(/** @type {string} */ (c.phase));
    if (!week) {
      sec.append(
        h('p', { class: 'label' }, t('week.none', { t: fmtMin(t, s.minutesPerDay) })),
        h('div', { class: 'form-field' }, h('p', { class: 'field-label' }, t('goal.minutes')),
          seg({ label: t('goal.minutes'), value: String(s.minutesPerDay), options: config.minutesOptions.map(n => /** @type {[string, string]} */ ([String(n), t('unit.min', { n })])), onChange: v => { setSetting(appCtx(), 'minutesPerDay', Number(v)); rerender(); } })),
        h('div', { class: 'goal-editor' },
          h('button', { type: 'button', class: 'btn pressable', name: 'week:use', onclick: () => { writeCourse({ week: defaultWeek() }); rerender(); } }, t('week.use')),
          h('p', { class: 'field-hint' }, t('week.useHint'))));
      return sec;
    }
    /** Write one day (no page rebuild: the editor moves the strip and the row in place). @param {number} i @param {{min?: number, kind?: string}} change */
    const setDay = (i, change) => {
      const cur = /** @type {any} */ (courseWeek(ctx.settings())) || week;
      const w = { min: [...cur.min], kind: /** @type {any[]} */ ([...cur.kind]) };
      if (change.min != null) {
        w.min[i] = change.min;
        if (!change.min) w.kind[i] = 'off';
        else if (w.kind[i] === 'off') w.kind[i] = 'n';
      }
      if (change.kind) { w.kind[i] = change.kind; if (change.kind !== 'off' && !w.min[i]) w.min[i] = 30; }
      writeCourse({ week: w });
    };
    // the goals above show the week's total: refresh them when the editor's changes settle
    const refreshGoals = () => { const old = page.querySelector('#profile-goal'); if (old) old.replaceWith(goals(ctx.settings())); };
    editor = weekEditor({ t, days: DAYS, week: () => /** @type {any} */ (courseWeek(ctx.settings())) || week, setDay, fmt: n => fmtMin(t, n), onDone: refreshGoals, signal: ctx.signal });
    sec.append(...[
      inWindow ? h('p', { class: 'caption' }, t('week.examNote')) : null,
      editor.el,
      h('p', { class: 'callout week-away' }, t('week.away')),
      h('button', { type: 'button', class: 'btn btn-quiet pressable', name: 'week:remove', onclick: () => {
        writeCourse({ week: null }); ctx.toast(t('week.removed', { t: fmtMin(t, ctx.settings().minutesPerDay) })); rerender();
      } }, t('week.remove'))].filter(x => x != null));
    return sec;
  }

  /** The B2 gate and the level counts load with the content; the page draws first and fills them in. */
  async function refreshGate() {
    try {
      const { loadData, stateFor } = await import('../shared/data.js');
      gate = stateFor(ctx, await loadData(ctx)).gate || null;
    } catch { gate = null; }
    if (page.isConnected) rerender();
  }
  async function loadLevels() {
    try {
      const { roundOf, ensurePlacement } = await import('../shared/data.js');
      if (!roundOf(ctx).trainer) return;
      await ensurePlacement(ctx);
      const { loadAtlas, scores, byLevel } = await import('../../data/atlas.js');
      const A = await loadAtlas(ctx);
      levels = byLevel(A, await scores(ctx, A));
      if (page.isConnected) rerender();
    } catch { /* the share line waits for the content */ }
  }

  const page = h('div', { class: 'profile goals-page stack' });
  page.replaceChildren(...parts());
  if (courseGoal(ctx.settings()).goal) { refreshGate(); loadLevels(); }
  return page;
}
