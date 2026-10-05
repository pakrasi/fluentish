/* Today: what to do now and how long it takes (UX §4.1).
   Order: countdown hero with the day runway (or the queue and study days without a date), the phase notice, the
   import notice, feedback to read, the plan from every feature (composed by domain/today.js), readiness as the field
   (the brand idea: one cell per exam item, filling like a line of text), the module bars, and a sticky button for the
   first unfinished row. Re-renders when the settings, cards, attempts or activity change. */
import { h, replace } from '../../core/dom.js';
import { label, parse, add, iso } from '../../core/clock.js';
import { icon } from '../../core/icons.js';
import { notice, section, nextId } from '../../core/ui.js';
import { odometer, fill, reveal } from '../../core/motion.js';
import { runway, studyDays, atmosphere, Field } from '../../core/brand.js';
import { isDue } from '../../domain/b1ready.js';
import { composeDay } from '../day.js';
import { summaryText } from '../../data/migrate.js';
import { previewText } from '../../data/cutover.js';
import { dueTomorrow, todayBudget } from '../practice/plan.js';
import { readinessFor } from '../practice/field.js';
import { legacyJobs, allowLegacy } from '../../data/sync/github-b1exam.js';
import { config } from '../../core/config.js';

/** "11%" in the interface language. @param {number} x */
const pct = x => new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(x || 0);

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { store, t, bus } = ctx;
  /** @type {any} */ let atmo = null;
  /** @type {Field | null} */ let field = null;
  let alive = true;
  let pending = /** @type {Promise<void> | null} */ (null);

  async function render() {
    const { plan, exam, lang, c, settings: s, activity } = await composeDay(ctx);
    const readyNow = await readinessFor(ctx);
    if (!alive) return;

    const examName = exam ? exam.short : t('exam.generic');
    const hero = renderHero({ s, c, plan, activity, examName, lang });
    const feedbackSec = plan.feedback.length ? section(t('today.feedback'),
      h('ul', { class: 'list' }, plan.feedback.map(f => h('li', { class: 'list-item' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, f.title), h('span', { class: 'row-detail' }, f.status)),
        f.action ? h('a', { class: 'btn pressable', href: f.href, 'aria-label': f.label || null }, f.action) : null))),
      plan.feedbackMore ? h('p', { class: 'caption more' }, t('today.feedbackMore', { n: plan.feedbackMore })) : null) : null;
    const readySec = readyNow && readyNow.n ? renderReadiness(readyNow, c) : null;
    const page = h('div', { class: 'today' },
      h('header', { class: 'page-head' }, h('h1', null, t('today.title')), h('p', { class: 'caption' }, label(c.today))),
      h('div', { class: 'today-grid' },
        h('div', { class: 'today-a' }, hero.el, phaseNotice(c), importNotice()),
        h('div', { class: 'today-b' }, feedbackSec, renderPlan(plan, c), readySec ? readySec.el : null),
        plan.modules.length ? h('div', { class: 'today-c' }, renderModules(plan.modules)) : null),
      plan.primary ? h('div', { class: 'dock' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: fromToday(plan.primary.href) }, primaryLabel(plan.primary))) : null);
    field?.destroy(); field = null;
    replace(el, page);
    page.classList.toggle('has-dock', !!plan.primary);
    hero.after();
    if (readySec) field = readySec.after();
    reveal(page);
    for (const tr of page.querySelectorAll('.mbar .track')) fill(/** @type {HTMLElement} */ (tr), Number(/** @type {HTMLElement} */ (tr).dataset.p));
    const atmoEl = /** @type {HTMLElement | null} */ (page.querySelector('.atmo'));
    if (atmo) { atmo.destroy(); atmo = null; }
    if (atmoEl) atmosphere(atmoEl).then(a => { if (alive) atmo = a; else a.destroy(); }).catch(() => {});
  }

  /** @param {any} o */
  function renderHero({ s, c, plan, activity, examName, lang }) {
    const countdown = c.phase === 'week' || c.phase === 'lastNew' || c.phase === 'eve' || c.phase === 'day';
    const minutesLine = c.phase === 'day' ? h('p', { class: 'label' }, t('today.warmupOnly'))
      : h('p', { class: 'label' }, h('b', { class: 'tnum ink' }, String(Math.round(plan.minutes.done))), ' ', t('today.minutesOf', { n: s.minutesPerDay }));
    const heroBtn = plan.primary ? h('a', { class: 'btn btn-primary pressable hero-btn', href: fromToday(plan.primary.href) }, primaryLabel(plan.primary)) : null;
    const atmoEl = h('div', { class: 'atmo', 'aria-hidden': 'true' });
    if (countdown) {
      const num = h('span', { class: 'numeral' }, String(c.daysLeft));
      const runEl = h('div', { class: 'runway' });
      const head = c.phase === 'day'
        ? h('p', { class: 'figure hero-today' }, t('today.examToday'))
        : h('div', { class: 'hero-count' }, num, h('span', { class: 'unit' }, t('unit.days', { n: c.daysLeft })));
      // the countdown is the way to the date that drives it
      const dateText = c.phase === 'eve' ? t('today.tomorrowOn', { date: label(c.exam) }) : label(/** @type {string} */ (c.exam));
      const link = h('a', { class: 'hero-link', href: '#/profile/goal', 'aria-label': t('today.changeDate', { n: c.daysLeft, date: label(/** @type {string} */ (c.exam)) }) },
        h('p', { class: 'label' }, t('today.examLabel', { exam: examName })),
        head,
        h('p', { class: 'caption hero-date' }, dateText, h('span', { class: 'hero-edit' }, ` · ${t('today.editDate')}`)));
      const el = h('section', { class: 'hero today-hero', 'aria-label': t('today.countdown') }, atmoEl, link, runEl,
        h('div', { class: 'hero-foot' }, minutesLine, heroBtn));
      return {
        el,
        after() {
          const ex = /** @type {string} */ (c.exam);
          const planned = (/** @type {string} */ d) => (d === add(ex, -1) ? Math.min(s.minutesPerDay, 30) : s.minutesPerDay);
          runway(runEl, {
            exam: parse(ex), today: parse(c.today), past: 2, locale: 'en-GB',
            plan: d => planned(iso(d)), done: d => (activity[iso(d)]?.minutes || 0),
            examLabel: t('today.runway.exam'), minLabel: (d, p) => t('today.runway.min', { d, p }),
          });
          if (c.phase !== 'day') odometer(num, c.daysLeft, { label: t('today.daysLeftLabel', { n: c.daysLeft }) });
        },
      };
    }
    // no date, or after the exam: the review queue is the number (new items for a learner with no reviews yet);
    // the last 28 days below it once there is a day to show
    const due = Object.values(store.cards('b1')).filter(r => isDue(r, c.today, c)).length;
    const fresh = !Object.keys(store.cards('b1')).length;
    const value = fresh ? todayBudget({ store, c, settings: s, t, exam: null }).newLeft : due;
    const num = h('span', { class: 'numeral' }, String(value));
    const daysEl = h('div', { class: 'days' });
    const lead = c.phase === 'after'
      ? t('today.examWas', { exam: examName, date: label(/** @type {string} */ (c.exam)) })
      : [lang ? lang.name : null, s.level].filter(Boolean).join(' · ') || t('today.noGoal');
    const studied = Object.values(activity).some((/** @type {any} */ a) => (a?.minutes || 0) > 0);
    const runText = h('p', { class: 'caption hero-date' });
    const el = h('section', { class: 'hero today-hero', 'aria-label': t('today.summary') }, atmoEl,
      h('p', { class: 'label' }, lead),
      h('div', { class: 'hero-count' }, num, h('span', { class: 'unit' }, fresh ? t('unit.newToday') : t('unit.due'))),
      studied ? runText : null,
      studied ? h('div', { class: 'hero-days' }, daysEl) : null,
      h('div', { class: 'hero-foot' }, minutesLine, heroBtn));
    return {
      el,
      after() {
        if (studied) {
          const hist = Array.from({ length: 28 }, (_, i) => (activity[add(c.today, i - 27)]?.minutes || 0) > 0);
          const run = studyDays(daysEl, hist);
          const n = hist.filter(Boolean).length;
          runText.textContent = run >= 2 ? `${t('today.studied', { n })} ${t('today.inARow', { n: run })}` : t('today.studied', { n });
        }
        odometer(num, value, { label: fresh ? t('today.newLabel', { n: value }) : t('today.dueLabel', { n: value }) });
      },
    };
  }

  /** Readiness: the figure, the field, the legend and what the number means. @param {any} r @param {any} c */
  function renderReadiness(r, c) {
    const ahead = c.exam && c.phase !== 'after' && c.phase !== 'none';
    const canvas = h('canvas', { class: 'field' });
    const sec = section(t('today.readiness'),
      h('p', { class: 'ready-figure' }, h('span', { class: 'figure tnum' }, pct(r.recall)),
        h('span', { class: 'label' }, ahead ? t('practice.readyFor', { date: label(r.day) }) : t('practice.readyNow'))),
      canvas,
      h('div', { class: 'legend', 'aria-hidden': 'true' },
        h('span', { style: { '--k': 'var(--cell-known)' } }, t('field.known')),
        h('span', { style: { '--k': 'var(--accent)' } }, t('field.today')),
        h('span', { style: { '--k': 'var(--cell-learning)' } }, t('field.learning')),
        h('span', { class: 'is-empty', style: { '--k': 'var(--cell-empty)' } }, t('field.notStarted'))),
      h('p', { class: 'caption ready-def' }, ahead ? t('today.readyDef', { n: r.n, date: label(r.day) }) : t('today.readyDefNow', { n: r.n }), ' ',
        t('today.readySeen', { seen: r.seen, n: r.n, known: r.states.filter((/** @type {number} */ x) => x >= 2).length })));
    sec.classList.add('today-ready');
    return {
      el: sec,
      after() {
        const f = new Field(/** @type {HTMLCanvasElement} */ (canvas), r.states, { label: null });
        // the intro runs once a day, so coming back to Today is instant; cells that became known since the last visit
        // land in accent with the wave
        const ui = store.get('ui', {}) || {};
        const last = ui.field && ui.field.day === c.today ? ui.field.known : null;
        if (ui.fieldIntro !== c.today) f.intro();
        else if (last != null && r.knownToday > last) {
          let i = r.states.length; while (i-- > 0) if (r.states[i] === 3) break;
          if (i >= 0) setTimeout(() => f.ripple(i), 420);
        }
        if (ui.fieldIntro !== c.today || last !== r.knownToday) store.update('ui', (/** @type {any} */ u) => ({ ...(u || {}), fieldIntro: c.today, field: { day: c.today, known: r.knownToday } }), {});
        return f;
      },
    };
  }

  /** A round started here comes back here when it ends. @param {string} href */
  const fromToday = href => (href.startsWith('#/practice/round') ? `${href}${href.includes('?') ? '&' : '?'}from=today` : href);
  /** @param {any} it */
  const primaryLabel = it => it.action || (it.minutes ? `${it.title} · ${t('unit.min', { n: it.minutes })}` : it.title);
  /** @param {any} r */
  const rowDetail = r => (r.cut ? (r.rounds === 1 ? t('plan.review.cutOne') : t('plan.review.cut', { n: r.rounds })) : r.detail);

  function importNotice() {
    const meta = store.get('meta', {}) || {};
    const ui = store.get('ui', {}) || {};
    const preview = meta.preview && !ui.previewSeen ? meta.preview : null;   // kept from the preview (data/cutover.js)
    if (!(meta.summary && !ui.importSeen) && !preview) return null;
    const s = ctx.settings();
    const id = nextId('imp');
    const linked = !!(store.get('secrets', {}) || {}).githubToken;
    const unsent = linked && !ui.sendLegacy ? legacyJobs(store).length : 0;
    const close = (/** @type {boolean} */ send) => {
      store.update('ui', (/** @type {any} */ u) => ({ ...(u || {}), importSeen: true, ...(meta.preview ? { previewSeen: true } : {}) }), {});
      if (send) allowLegacy(store);
      store.flush();
      n.remove();
      bus.emit('sync:request', { force: true });   // uploads were held until now (data/sync/github-b1exam.js)
      if (send) ctx.toast(t('import.sending'));
      /** @type {HTMLElement | null} */ (el.querySelector('#view h1, h1'))?.focus({ preventScroll: true });
    };
    const n = notice({ id, children: [
      h('p', { class: 'notice-title' }, preview ? t('import.titlePreview') : t('import.title')),
      preview ? h('p', null, previewText(/** @type {any} */ (preview), t)) : null,
      meta.summary ? h('p', null, summaryText(meta.summary, t, { afterPreview: !!preview })) : null,
      h('p', null, s.exam.date ? t('import.examDate', { date: label(s.exam.date) }) : t('import.noDate')),
      meta.summary && Number.isInteger(meta.summary.newPerDay) && !s.rev?.newPerDay ? h('p', null, t('import.newPerDay', { n: meta.summary.newPerDay })) : null,
      preview && linked && preview.toSend ? h('p', null, t('preview.toSend', { n: preview.toSend, repo: config.resultsRepo })) : null,
      unsent ? h('p', null, t('import.unsent', { n: unsent, repo: config.resultsRepo })) : null,
      h('div', { class: 'notice-actions' },
        unsent ? h('button', { type: 'button', class: 'btn btn-primary pressable', onclick: () => close(true) }, t('import.sendLegacy', { n: unsent })) : null,
        h('a', { class: 'btn pressable', href: '#/profile/goal' }, t('import.change')),
        h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => close(false) }, t('import.dismiss'))),
    ] });
    return n;
  }

  /** The notice adds only what the hero does not say: what to do in this phase. @param {any} c */
  function phaseNotice(c) {
    const key = { lastNew: 'phase.lastNew', eve: 'phase.eve', day: 'phase.day', after: 'phase.after' }[/** @type {string} */ (c.phase)];
    if (!key) return null;
    return notice({ children: [h('p', null, t(key))] });
  }

  /** @param {any} plan @param {any} c */
  function renderPlan(plan, c) {
    const work = plan.rows.filter(r => r.kind !== 'setup');
    const head = plan.state === 'done'
      ? h('p', { class: 'plan-done' }, icon('check', { size: 18 }), t('today.done', { n: dueTomorrow({ store, c, settings: null, exam: null, t }) }))
      : plan.state === 'empty' ? h('p', { class: 'plan-empty' }, t('today.empty')) : null;
    const m = plan.minutes;
    const sub = m.mock ? t('today.planOver', { n: m.planned, budget: m.budget, module: String(m.mock.title).split(' · ')[0], min: m.mock.minutes })
      : m.cut ? t('today.planCut', { n: m.planned, budget: m.budget }) : t('today.planMinutes', { n: m.planned, budget: m.budget });
    return section(t('today.plan'),
      work.length ? h('p', { class: 'caption section-sub' }, sub) : null,
      head,
      plan.rows.length ? h('ol', { class: 'plan' }, plan.rows.map(r => h('li', { class: ['plan-item', r.done && 'is-done', r.kind === 'setup' && 'is-setup'] },
        h('a', { class: 'plan-row pressable', href: fromToday(r.href) },
          h('span', { class: 'plan-state', 'aria-hidden': 'true' }, r.done ? icon('check', { size: 14 }) : r.kind === 'setup' ? icon('calendar', { size: 14 }) : null),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.title, r.done ? h('span', { class: 'sr-only' }, `, ${t('today.doneRow')}`) : null), rowDetail(r) ? h('span', { class: 'row-detail' }, rowDetail(r)) : null),
          r.minutes ? h('span', { class: 'row-trail tnum' }, t('unit.min', { n: r.minutes })) : null,
          icon('next', { size: 16 }))))) : null,
      plan.extra.length ? h('div', { class: 'plan-extra' }, h('h3', { class: 'label' }, t('today.more')),
        h('ul', { class: 'list' }, plan.extra.map(r => h('li', null, h('a', { class: 'plan-row plan-extra-row pressable', href: fromToday(r.href) },
          h('span', { class: 'plan-state', 'aria-hidden': 'true' }),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.title), r.detail ? h('span', { class: 'row-detail' }, r.detail) : null),
          r.minutes ? h('span', { class: 'row-trail tnum' }, t('unit.min', { n: r.minutes })) : h('span'),
          icon('next', { size: 16 })))))) : null);
  }

  /** @param {any[]} modules */
  function renderModules(modules) {
    return section(t('today.modules'),
      h('p', { class: 'caption section-sub' }, t('today.modulesSub')),
      h('ul', { class: 'mbars' }, modules.map(m => {
        const p = m.score == null ? 0 : m.score / m.max;
        return h('li', null, h('a', { class: 'mbar pressable', href: m.href || '#/exam', 'aria-label': m.score == null ? t('today.moduleNone', { name: m.name }) : t('today.moduleScore', { name: m.name, score: m.score, max: m.max, pass: m.pass }) },
          h('span', { class: 'mbar-name' }, m.name),
          h('span', { class: ['track', m.score != null && m.score < m.pass && 'below'], dataset: { p: String(p) } }, h('span', { class: 'fill' }), h('i', { class: 'pass', style: { '--at': `${(m.pass / m.max) * 100}%` } })),
          h('span', { class: ['mbar-val', 'tnum', m.score == null && 'none'] }, m.score == null ? t('today.noScore') : `${m.score}/${m.max}`)));
      })));
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  await render();
  const offs = [
    bus.on('settings:changed', rerender),
    store.subscribe('cards:b1', rerender), store.subscribe('attempts', rerender), store.subscribe('activity', rerender),
  ];
  return { unmount() { alive = false; offs.forEach(f => f()); atmo?.destroy(); field?.destroy(); } };
}
