/* Onboarding (UX §3.5, §4.12): language, level, exam (type, date, modules), minutes a day, then the derived plan.
   One question per screen; every step but the language can be skipped. Nothing is saved until Start, so leaving
   half-way leaves no half-made goal. A learner migrated from the old apps never sees this. */
import { h, replace } from '../../core/dom.js';
import { context, label } from '../../core/clock.js';
import { config } from '../../core/config.js';
import { markNode } from '../../core/brand.js';
import { segments } from '../../core/motion.js';
import { field, nextId } from '../../core/ui.js';
import { setSetting, setExamDate, examDateError, MODULES } from '../../data/settings.js';
import { isoWithOffset } from '../../data/ids.js';

const STEPS = ['language', 'level', 'exam', 'time', 'summary'];

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { t, store, bus, app } = ctx;
  const manifest = await ctx.content.manifest();
  const today = ctx.clock.today();
  const state = { step: 0, language: /** @type {string|null} */ (null), level: /** @type {string|null} */ (null), examType: /** @type {string|null} */ (null),
    date: '', modules: [...MODULES], minutes: config.defaults.minutesPerDay };
  /** @type {string | null} */ let error = null;

  const examsFor = (/** @type {string|null} */ lang) => manifest.exams.filter((/** @type {any} */ e) => e.language === lang);
  const examDef = () => manifest.exams.find((/** @type {any} */ e) => e.id === state.examType) || null;

  /**
   * A group of radio choices. @param {string} name @param {[string, string, string?, string?][]} opts value, label, detail, lang
   * @param {string|null} value @param {(v: string) => void} on
   */
  function choices(name, opts, value, on) {
    return h('div', { class: 'choices', role: 'radiogroup', 'aria-labelledby': 'step-q' }, opts.map(([v, text, detail, lang]) => {
      const id = nextId('c');
      return h('label', { class: 'choice pressable', for: id },
        h('input', { type: 'radio', name, id, value: v, checked: v === (value ?? ''), onchange: () => { on(v); error = null; render(); } }),
        h('span', { class: 'choice-main' }, h('span', { class: 'choice-title' }, text), detail ? h('span', { class: 'choice-detail', lang: lang || null }, detail) : null));
    }));
  }

  function body() {
    const step = STEPS[state.step];
    if (step === 'language') {
      return [h('h1', { id: 'step-q' }, t('welcome.language')),
        choices('language', manifest.languages.map((/** @type {any} */ l) => [l.id, l.name, l.native, langCode(l.id)]), state.language, v => {
          state.language = v;
          if (!examsFor(v).some((/** @type {any} */ e) => e.id === state.examType) && state.examType !== 'other') state.examType = null;
        })];
    }
    if (step === 'level') {
      return [h('h1', { id: 'step-q' }, t('welcome.level')),
        choices('level', [...config.levels.map(l => /** @type {[string, string, string]} */ ([l, l, t(`level.${l}`)])), ['', t('welcome.level.unsure'), t('welcome.level.unsureDetail')]], state.level ?? null, v => { state.level = v || null; })];
    }
    if (step === 'exam') {
      const opts = [...examsFor(state.language).map((/** @type {any} */ e) => /** @type {[string, string, string]} */ ([e.id, e.name, t('welcome.exam.mocks', { n: e.tests.length })])),
        ['other', t('goal.exam.other'), t('welcome.exam.otherDetail')], ['', t('goal.exam.none'), t('welcome.exam.noneDetail')]];
      const parts = [h('h1', { id: 'step-q' }, t('welcome.exam')), choices('exam', /** @type {any} */ (opts), state.examType ?? '', v => { state.examType = v || null; })];
      if (state.examType) {
        const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'date', name: 'exam-date', value: state.date, min: today,
          onchange: (/** @type {Event} */ e) => { state.date = /** @type {HTMLInputElement} */ (e.target).value; error = examDateError(state.date || null, today); render(); } }));
        const f = field({ label: t('goal.date'), input, hint: t('welcome.date.hint') });
        if (error) f.setError(t(error));
        parts.push(f);
        const def = examDef();
        if (def) {
          parts.push(h('div', { class: 'form-field' }, h('p', { class: 'field-label', id: 'mods' }, t('goal.modules')),
            h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'mods' }, def.modules.map((/** @type {any} */ m) => {
              const on = state.modules.includes(m.id);
              return h('button', { type: 'button', name: `module:${m.id}`, class: 'chip pressable', 'aria-pressed': String(on), onclick: () => {
                const next = on ? state.modules.filter(x => x !== m.id) : MODULES.filter(x => x === m.id || state.modules.includes(x));
                if (next.length) { state.modules = next; render(); }
              } }, m.name);
            }))));
        }
      }
      return parts;
    }
    if (step === 'time') {
      return [h('h1', { id: 'step-q' }, t('welcome.time')),
        choices('minutes', config.minutesOptions.map(n => /** @type {[string, string, string]} */ ([String(n), t('unit.min', { n }), t(`welcome.time.${n}`)])), String(state.minutes), v => { state.minutes = Number(v); })];
    }
    // summary: the plan that follows from the answers
    const lang = manifest.languages.find((/** @type {any} */ l) => l.id === state.language);
    const def = examDef();
    const c = context({ today, exam: state.examType && state.date && !error ? state.date : null });
    const lines = [];
    const examName = def ? def.name : state.examType === 'other' ? t('goal.exam.other') : null;
    lines.push(h('p', { class: 'summary-goal' }, examName || [lang?.name, state.level].filter(Boolean).join(' · ')));
    if (examName) lines.push(h('p', { class: 'caption' }, [lang?.name, state.level].filter(Boolean).join(' · ')));
    if (c.exam) lines.push(h('p', { class: 'summary-date' }, c.daysLeft === 0 ? t('welcome.sum.today', { date: label(c.exam) }) : t('welcome.sum.exam', { date: label(c.exam), n: c.daysLeft })));
    const list = [t('welcome.sum.round')];
    if (def && c.mocks) list.push(t('welcome.sum.mock'));
    if (def && (state.modules.includes('schreiben') || state.modules.includes('sprechen'))) list.push(t('welcome.sum.productive'));
    lines.push(h('p', null, t('welcome.sum.minutes', { n: state.minutes })), h('ul', { class: 'summary-list' }, list.map(x => h('li', null, x))));
    if (c.exam && c.phase === 'week') lines.push(h('p', { class: 'caption' }, t('welcome.sum.newStop', { date: label(/** @type {string} */ (c.lastNewDay)) })));
    if (!c.exam) lines.push(h('p', { class: 'caption' }, t('welcome.sum.noDate')));
    return [h('h1', { id: 'step-q' }, t('welcome.summary')), h('div', { class: 'summary stack' }, ...lines)];
  }

  function start() {
    const w = (/** @type {string} */ p, /** @type {any} */ v) => setSetting({ store, hlc: app.hlc, bus }, p, v);
    w('language', state.language);
    w('level', state.level);
    w('exam.type', state.examType);
    w('exam.modules', state.modules);
    w('minutesPerDay', state.minutes);
    if (state.examType && state.date && !examDateError(state.date, today)) setExamDate({ store, hlc: app.hlc, bus, clock: ctx.clock }, state.date);
    w('onboarded', isoWithOffset(new Date()));
    store.flush();
    ctx.refreshShell();
    ctx.go('/today');
  }

  function render() {
    const step = STEPS[state.step];
    const canNext = step !== 'language' || !!state.language;
    const progress = h('div', { class: 'segments', 'aria-label': t('welcome.progress', { n: state.step + 1, total: STEPS.length }) });
    const page = h('div', { class: 'welcome' },
      h('div', { class: 'welcome-brand' }, markNode({ title: '' }), h('span', { class: 'wordmark' }, 'Fluent', h('i', null, 'ish'))),
      progress,
      h('form', { class: 'welcome-step stack', onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); next(); } }, ...body(),
        h('div', { class: 'welcome-nav' },
          state.step > 0 ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { state.step--; error = null; render(); } }, t('welcome.back')) : h('span'),
          step === 'summary'
            ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: start }, t('welcome.start'))
            : h('span', { class: 'welcome-nav-end' },
              step !== 'language' ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: skip }, t('welcome.skip')) : null,
              h('button', { type: 'submit', class: 'btn btn-primary pressable', disabled: !canNext || !!error }, t('welcome.next'))))));
    replace(el, page);
    segments(progress, STEPS.map((_, i) => (i < state.step ? 'done' : i === state.step ? 'now' : '')));
    const focusTarget = /** @type {HTMLElement | null} */ (page.querySelector('input:checked') || page.querySelector('h1'));
    if (focusTarget && document.activeElement === document.body) focusTarget.focus({ preventScroll: true });
  }

  function next() {
    if (STEPS[state.step] === 'language' && !state.language) return;
    if (error) return;
    state.step = Math.min(STEPS.length - 1, state.step + 1);
    render();
    /** @type {HTMLElement | null} */ (el.querySelector('h1'))?.focus();
  }
  function skip() {
    const step = STEPS[state.step];
    if (step === 'level') state.level = null;
    if (step === 'exam') { state.examType = null; state.date = ''; error = null; }
    if (step === 'time') state.minutes = config.defaults.minutesPerDay;
    next();
  }

  render();
}

/** BCP 47 code for a language id, so names render with the right font and voice. @param {string} id */
function langCode(id) {
  return /** @type {Record<string, string>} */ ({ german: 'de', khasi: 'kha', hindi: 'hi', french: 'fr', swissgerman: 'gsw', bengali: 'bn', spanish: 'es', italian: 'it', portuguese: 'pt', arabic: 'ar' })[id] || null;
}
