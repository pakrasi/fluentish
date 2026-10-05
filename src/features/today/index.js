/* Today: what to do now and how long it takes (UX §4.1).
   Order: countdown hero with the day runway (or, without an exam ahead, today's reviews from every deck and the study
   days), the phase notice, the import notice, feedback to read, the plan from every feature (composed by
   domain/today.js; every deck's reviews counted, and said plainly when they do not fit), Where you stand
   (today/standing.js: per module and words and phrases, one definition), and a sticky button for the first
   unfinished row. Every number comes from the one daily allowance (domain/allowance.js), the same as Practice's.
   Re-renders when the settings, cards, attempts or activity change. */
import { h, replace } from '../../core/dom.js';
import { label, parse, add, iso } from '../../core/clock.js';
import { icon } from '../../core/icons.js';
import { notice, section, nextId } from '../../core/ui.js';
import { odometer, fill, reveal } from '../../core/motion.js';
import { runway, studyDays, atmosphere } from '../../core/brand.js';
import { composeDay } from '../day.js';
import { summaryText } from '../../data/migrate.js';
import { previewText } from '../../data/cutover.js';
import { dueTomorrow } from '../../domain/allowance.js';
import { dayAllowance, firstWeek } from '../../domain/allowance.js';
import { results } from '../../data/sync/index.js';
import { config } from '../../core/config.js';
import { renderStanding, standingCounts } from './standing.js';

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { store, t, bus } = ctx;
  /** @type {any} */ let atmo = null;
  let alive = true, gen = 0;
  let pending = /** @type {Promise<void> | null} */ (null);

  async function render() {
    const { plan, exam, lang, c, settings: s, activity } = await composeDay(ctx);
    if (!alive) return;
    const my = ++gen;
    const allow = dayAllowance({ store, c, settings: s });

    const examName = exam ? exam.short : t('exam.generic');
    const hero = renderHero({ s, c, plan, activity, examName, lang, allow });
    const feedbackSec = plan.feedback.length ? section(t('today.feedback'),
      h('ul', { class: 'list' }, plan.feedback.map(f => h('li', { class: 'list-item' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, f.title), h('span', { class: 'row-detail' }, f.status)),
        f.action ? h('a', { class: 'btn pressable', href: f.href, 'aria-label': f.label || null }, f.action) : null))),
      plan.feedbackMore ? h('p', { class: 'caption more' }, t('today.feedbackMore', { n: plan.feedbackMore })) : null) : null;
    const stand = s.language ? renderStanding({ plan, c, t }) : null;
    const page = h('div', { class: 'today' },
      h('header', { class: 'page-head' }, h('h1', null, t('today.title')), h('p', { class: 'caption' }, label(c.today))),
      h('div', { class: 'today-grid' },
        h('div', { class: 'today-a' }, hero.el, phaseNotice(c), importNotice()),
        h('div', { class: 'today-b' }, feedbackSec, renderPlan(plan, c, allow)),
        stand ? h('div', { class: 'today-c' }, stand.el) : null),
      plan.primary ? h('div', { class: 'dock' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: fromToday(plan.primary.href) }, primaryLabel(plan.primary))) : null);
    replace(el, page);
    page.classList.toggle('has-dock', !!plan.primary);
    hero.after();
    if (stand) standingCounts(ctx, plan.modules).then(n => { if (alive && my === gen) stand.fill(n); });
    reveal(page);
    for (const tr of page.querySelectorAll('.mbar .track')) fill(/** @type {HTMLElement} */ (tr), Number(/** @type {HTMLElement} */ (tr).dataset.p));
    const atmoEl = /** @type {HTMLElement | null} */ (page.querySelector('.atmo'));
    if (atmo) { atmo.destroy(); atmo = null; }
    if (atmoEl) atmosphere(atmoEl).then(a => { if (alive) atmo = a; else a.destroy(); }).catch(() => {});
  }

  /** @param {any} o */
  function renderHero({ s, c, plan, activity, examName, lang, allow }) {
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
    // no date, or after the exam: today's reviews from every deck are the number (Practice shows the same), new items
    // for a learner with no reviews yet; the last 28 days below it once he has studied for a week
    const fresh = !allow.reviews.due && !Object.keys(store.cards('b1')).length;
    const value = fresh ? allow.newLeft : allow.reviews.due;
    const num = h('span', { class: 'numeral' }, String(value));
    const daysEl = h('div', { class: 'days' });
    const lead = c.phase === 'after'
      ? t('today.examWas', { exam: examName, date: label(/** @type {string} */ (c.exam)) })
      : [lang ? lang.name : null, s.level].filter(Boolean).join(' · ') || t('today.noGoal');
    const studied = Object.values(activity).some((/** @type {any} */ a) => (a?.minutes || 0) > 0) && !firstWeek(store, c.today);
    const runText = h('p', { class: 'caption hero-date' });
    const el = h('section', { class: 'hero today-hero', 'aria-label': t('today.summary') }, atmoEl,
      h('p', { class: 'label' }, lead),
      h('div', { class: 'hero-count' }, num, h('span', { class: 'unit' }, fresh ? t('unit.newToday') : t('unit.due'))),
      fresh ? null : h('p', { class: 'caption hero-def' }, t('today.dueAll')),
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
    const unsent = linked && !ui.sendLegacy ? results(store).legacyCount() : 0;
    const close = (/** @type {boolean} */ send) => {
      store.update('ui', (/** @type {any} */ u) => ({ ...(u || {}), importSeen: true, ...(meta.preview ? { previewSeen: true } : {}) }), {});
      if (send) results(store).allowLegacy();
      store.flush();
      n.remove();
      bus.emit('sync:request', { force: true });   // uploads were held until now (data/sync/index.js)
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

  /** @param {any} plan @param {any} c @param {any} allow the day's allowance */
  function renderPlan(plan, c, allow) {
    const work = plan.rows.filter(r => r.kind !== 'setup');
    const head = plan.state === 'done'
      ? h('p', { class: 'plan-done' }, icon('check', { size: 18 }), t('today.done', { n: dueTomorrow({ store, c, settings: null, exam: null, t }) }))
      : plan.state === 'empty' ? h('p', { class: 'plan-empty' }, t('today.empty')) : null;
    const m = plan.minutes;
    const sub = m.mock ? t('today.planOver', { n: m.planned, budget: m.budget, module: String(m.mock.title).split(' · ')[0], min: m.mock.minutes })
      : m.cut ? t('today.planCut', { n: m.planned, budget: m.budget }) : t('today.planMinutes', { n: m.planned, budget: m.budget });
    // reviews are never hidden: when the day cannot fit them all, say how many wait and that the least urgent go last
    const rv = plan.reviews;
    const reviewsLine = rv && rv.left > 0 ? h('p', { class: 'caption plan-note' }, t('today.reviewsLeft', { left: rv.left, due: rv.due, budget: m.budget })) : null;
    // side decks pause their new items while the exam is ahead
    const paused = allow && allow.mode === 'exam' && (allow.started.build || allow.started.clusters) && c.exam
      ? h('p', { class: 'caption plan-note' }, t('today.paused', { date: label(c.exam) })) : null;
    return section(t('today.plan'),
      work.length ? h('p', { class: 'caption section-sub' }, sub) : null,
      head, reviewsLine,
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
          icon('next', { size: 16 })))))) : null,
      paused);
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  await render();
  const offs = [
    bus.on('settings:changed', rerender),
    store.subscribe('cards:b1', rerender), store.subscribe('attempts', rerender), store.subscribe('activity', rerender), store.subscribe('mistakes', rerender),
  ];
  return { unmount() { alive = false; offs.forEach(f => f()); atmo?.destroy(); } };
}
