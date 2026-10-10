/* Today: what to do now and how long it takes (UX §4.1).
   Order: countdown hero with the day runway (or, without an exam ahead, today's reviews from every deck and the study
   days), the phase notice, the import notice, feedback to read, the plan from every feature (composed by
   domain/today.js; every deck's reviews counted, and said plainly when they do not fit), Where you stand
   (today/standing.js: per module and words and phrases, one definition), and a sticky button for the first
   unfinished row. Every number comes from the one daily allowance (domain/allowance.js), the same as Practice's.
   Re-renders when the settings, cards, attempts or activity change. */
import { h, replace } from '../../core/dom.js';
import { label, parse, add, iso, weekdayShort } from '../../core/clock.js';
import { icon } from '../../core/icons.js';
import { notice, section, nextId } from '../../core/ui.js';
import { odometer, fill, reveal, countTo, reduced } from '../../core/motion.js';
import { runway, weekStrip, weekStripUpdate, atmosphere } from '../../core/brand.js';
import { composeDay, prepareDay, statsFresh } from '../day.js';
import { summaryText } from '../../data/migrate.js';
import { examDate, activeCourse } from '../../data/settings.js';
import { previewText } from '../../data/cutover.js';
import { dueTomorrow } from '../../domain/allowance.js';
import { dayAllowance, ANYWAY_KV, studyAnyway } from '../../domain/allowance.js';
import { courseWeek, dayPlan } from '../../domain/week.js';
import { courseGoal } from '../../domain/levels.js';
import { fmtMin, weekDays, weekTotals, laterThisWeek, kindLine, whyLine, examRows } from './week.js';
import { results } from '../../data/sync/index.js';
import { connected, resultsRepo } from '../../data/connection.js';
import { renderStanding, standingCounts, sparkOf } from './standing.js';

/** What the hero showed last (kept across visits to Today in one session): the week strip fills from it. */
const shown = /** @type {{week: string | null, ratios: number[], done: number | null, kind: string | null, welcome: string | null}} */ ({ week: null, ratios: [], done: null, kind: null, welcome: null });
const COUNTDOWN = new Set(['week', 'lastNew', 'eve', 'day']);
/** "Wednesday" of a day. @param {string} d */
const weekdayLong = d => new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(parse(d));

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { store, t, bus } = ctx;
  /** @type {any} */ let atmo = null;
  let alive = true, gen = 0;
  let pending = /** @type {Promise<void> | null} */ (null);
  /** "Study anyway" was just tapped: the next render changes the hero in place instead of drawing it again. */
  let anywayNext = false;

  /** Every compose that draws (render, or the first visit's) takes a number; the background one draws only if none
   *  started after it. */
  let req = 0;
  /** What is on screen (the plan and the allowance it was drawn with), so the background compose redraws only on a change. */
  let drawnKey = '';
  /** The features' prepare on this visit (set before the first draw), then a turn of the event loop. */
  let prepared = /** @type {Promise<unknown>} */ (Promise.resolve());
  /** @param {any} day composeDay's result @param {any} allow */
  const keyOf = (day, allow) => JSON.stringify({ plan: day.plan, allow });

  async function render() {
    ++req;
    const day = await composeDay(ctx);
    if (!alive) return;
    draw(day);
  }

  /** @param {Awaited<ReturnType<typeof composeDay>>} day */
  function draw(day) {
    const { plan, c, settings: s } = day;
    const my = ++gen;
    const { hero, allow, examName, primary } = heroOf(day);
    drawnKey = keyOf(day, allow);
    const feedbackSec = plan.feedback.length ? section(t('today.feedback'),
      h('ul', { class: 'list' }, plan.feedback.map(f => h('li', { class: 'list-item' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, f.title), h('span', { class: 'row-detail' }, f.status)),
        f.action ? h('a', { class: 'btn pressable', href: f.href, 'aria-label': f.label || null }, f.action) : null))),
      plan.feedbackMore ? h('p', { class: 'caption more' }, t('today.feedbackMore', { n: plan.feedbackMore })) : null) : null;
    const goalLevel = courseGoal(s).goal;
    const goalBy = activeCourse(s)?.goal?.by || null;
    const rows = examRows(c, (plan.modules || []).some((/** @type {any} */ m) => m.score != null));
    const stand = s.language ? renderStanding({ plan, c, t, rows, examName, goal: goalLevel ? { level: goalLevel, month: goalBy ? monthLabel(goalBy) : null } : null, spark: sparkOf(store, c.today),
      ...(s.language !== 'german' ? { course: true } : {}) }) : null;
    const page = h('div', { class: 'today' },
      h('header', { class: 'page-head' }, h('h1', null, t('today.title')), h('p', { class: 'caption' }, label(c.today))),
      h('div', { class: 'today-grid' },
        h('div', { class: 'today-a' }, hero.el, phaseNotice(c), importNotice()),
        h('div', { class: 'today-b' }, feedbackSec, renderPlan(plan, c, allow)),
        stand ? h('div', { class: 'today-c' }, stand.el) : null),
      primary ? h('div', { class: 'dock' }, h('a', { class: 'btn btn-primary btn-wide pressable', href: fromToday(primary.href) }, primaryLabel(primary))) : null);
    // Study anyway (design review P1-4): keep the atmosphere and the week strip that are on screen, so the background
    // does not mount again and today's column rises from its baseline; the plan discloses; the numeral does not roll
    const morph = anywayNext && !!el.querySelector('.today-hero');
    anywayNext = false;
    const oldAtmo = morph ? el.querySelector('.today-hero .atmo') : null;
    const oldStrip = morph ? /** @type {HTMLElement | null} */ (el.querySelector('.today-hero .wk-strip')) : null;
    if (oldAtmo) page.querySelector('.today-hero .atmo')?.replaceWith(oldAtmo);
    replace(el, page);
    page.classList.toggle('has-dock', !!primary);
    hero.after(morph ? { strip: oldStrip } : null);
    if (morph && !reduced()) {
      const list = /** @type {HTMLElement | null} */ (page.querySelector('.today-b .section ol.plan'));
      if (list) {
        const panel = h('div', { class: 'reveal-answer plan-disclose' });
        list.replaceWith(panel); panel.append(h('div', null, list));
        requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('is-open')));
      }
    }
    // (after the features' prepare: both load the same pool, and counting in the same task as the plan's stats would make
    // one long task of the two)
    // the counts are display only: if their content cannot load (offline, or a reload cancelled the fetch) the rows keep
    // their quiet state; never an unhandled rejection
    if (stand) prepared.then(() => (alive && my === gen ? standingCounts(ctx, plan.modules) : null)).then(n => { if (n && alive && my === gen) stand.fill(n); }).catch(() => {});
    reveal(page);
    for (const tr of page.querySelectorAll('.mbar .track')) fill(/** @type {HTMLElement} */ (tr), Number(/** @type {HTMLElement} */ (tr).dataset.p));
    if (oldAtmo) return;
    const atmoEl = /** @type {HTMLElement | null} */ (page.querySelector('.atmo'));
    if (atmo) { atmo.destroy(); atmo = null; }
    if (atmoEl) atmosphere(atmoEl).then(a => { if (alive) atmo = a; else a.destroy(); }).catch(() => {});
  }

  /** The hero of a composed day, with the allowance it reads. @param {Awaited<ReturnType<typeof composeDay>>} day */
  function heroOf({ plan, exam, lang, c, settings: s, activity }) {
    const allow = dayAllowance({ store, c, settings: s });
    const examName = exam ? exam.short : t('exam.generic');
    // an Off day in maintenance has no rows to start (Study anyway brings them)
    const primary = !COUNTDOWN.has(c.phase) && allow.plan?.kind === 'off' ? null : plan.primary;
    return { hero: renderHero({ s, c, plan, activity, examName, lang, allow, primary }), allow, examName, primary };
  }

  /** @param {any} o */
  function renderHero({ s, c, plan, activity, examName, lang, allow, primary }) {
    const countdown = c.phase === 'week' || c.phase === 'lastNew' || c.phase === 'eve' || c.phase === 'day';
    const minutesLine = c.phase === 'day' ? h('p', { class: 'label' }, t('today.warmupOnly'))
      : h('p', { class: 'label' }, h('b', { class: 'tnum ink' }, String(Math.round(plan.minutes.done))), ' ', t('today.minutesOf', { n: plan.minutes.budget }));
    const heroBtn = primary ? h('a', { class: 'btn btn-primary pressable hero-btn', href: fromToday(primary.href) }, primaryLabel(primary)) : null;
    const atmoEl = h('div', { class: 'atmo', 'aria-hidden': 'true' });
    // Today's family while it is in today's plan and not done: one line in the hero, so the daily game is in view
    // without scrolling (its plan row keeps its place after the core work; round 7 review)
    const famRow = plan.rows.find((/** @type {any} */ r) => r.id === 'build.family' && !r.done);
    const famEl = famRow ? h('a', { class: 'hero-fam pressable', href: famRow.href },
      h('span', { class: 'hero-fam-t' }, famRow.title), h('span', { class: 'hero-fam-d' }, famRow.detail), icon('next', { size: 16 })) : null;
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
        h('div', { class: 'hero-foot' }, minutesLine, heroBtn), famEl);
      return {
        el,
        after() {
          const ex = /** @type {string} */ (c.exam);
          // each day's own minutes from the week plan (minutes a day without one), as the plan below counts them
          const mins = (/** @type {string} */ d) => dayPlan(s, { today: d, phase: c.phase }).minutes;
          const planned = (/** @type {string} */ d) => (d === add(ex, -1) ? Math.min(mins(d), 30) : mins(d));
          runway(runEl, {
            exam: parse(ex), today: parse(c.today), past: 2, locale: 'en-GB',
            plan: d => planned(iso(d)), done: d => (activity[iso(d)]?.minutes || 0),
            examLabel: t('today.runway.exam'), minLabel: (d, p) => t('today.runway.min', { d, p }),
          });
          if (c.phase !== 'day') odometer(num, c.daysLeft, { label: t('today.daysLeftLabel', { n: c.daysLeft }) });
        },
      };
    }
    // no exam ahead in its window (maintenance): today's reviews from every deck are the number (Practice shows the
    // same), new items for a learner with no reviews yet; under it this week's strip (planned and done minutes per
    // day) and, with a week plan, the kind of day. There is no count of days in a row: a missed day costs only the
    // reviews it carried, and the week is the measure.
    const fresh = !allow.reviews.due && !Object.keys(store.cards('b1')).length;
    // the hero states today's job, never a debt (design review round 4, P1-6): on an Off day "Day off" with what waits
    // for tomorrow; after a break the reviews today takes (the capped number), with the rest said under it
    const dayOff = allow.plan?.kind === 'off';
    const capped = !fresh && allow.plan?.why === 'break' && Number.isFinite(allow.plan.reviewsToday) && allow.plan.reviewsToday < allow.reviews.due ? allow.plan.reviewsToday : null;
    const value = fresh ? allow.newLeft : capped ?? allow.reviews.due;
    const num = h('span', { class: 'numeral' }, String(value));
    const goal = courseGoal(s);
    const by = activeCourse(s)?.goal?.by || null;
    const name = lang ? lang.name : null;
    const recentExam = c.phase === 'after' && c.exam && examRows(c, true) === 'open';
    const lead = recentExam ? t('today.examWas', { exam: examName, date: label(/** @type {string} */ (c.exam)) })
      : name && goal.goal ? t(by ? 'today.leadGoalBy' : 'today.leadGoal', { lang: name, level: goal.goal, month: monthLabel(by) })
        : [name, s.level].filter(Boolean).join(' · ') || t('today.noGoal');
    const anyway = studyAnyway(store, c);
    const days = weekDays({ settings: s, today: c.today, activity, anyway });
    const tot = weekTotals(days);
    const hasWeek = !!courseWeek(s);
    const stripEl = h('div', { class: 'runway' });
    const kl = kindLine(allow.plan, { anyway });
    // (on an Off day the numeral's place says "Day off": no kind line under it)
    const kindEl = kl && allow.plan?.kind !== 'off' ? h('p', { class: 'label hero-kind', dataset: { kind: allow.plan.kind } }, t(kl.key, kl.vars && kl.vars.kind ? { kind: t(`week.kind.${kl.vars.kind}`) } : kl.vars)) : null;
    const off = allow.plan?.kind === 'off';
    const todayLine = off ? null : h('p', { class: 'label' }, h('b', { class: 'tnum ink' }, String(Math.round(plan.minutes.done))), ' ', t('today.minutesOf', { n: plan.minutes.budget }));
    const doneEl = h('b', { class: 'tnum' }, fmtMin(t, tot.done));
    const weekLine = h('div', { class: 'hero-weekline' },
      h('p', { class: 'label' }, ...(tot.plan ? splitAround(t('today.week.of', { done: '\u0000', plan: fmtMin(t, tot.plan) }), doneEl) : splitAround(t('today.week.done', { done: '\u0000' }), doneEl))),
      h('a', { class: 'caption hero-edit-week', href: '#/profile/week' }, hasWeek ? t('today.week.edit') : t('today.week.set')));
    // "Welcome back" after 3 days or more away (UX review #8), in the hero under the kind of day: one sentence, no box;
    // it rises once a day
    const away = allow.plan?.away;
    const welcomeEl = Number.isFinite(away) && away >= 3 ? h('p', { class: 'hero-welcome' }, t('today.welcomeBack', { d: away })) : null;
    const countEl = dayOff
      ? h('div', { class: 'hero-count is-off' }, h('span', { class: 'hero-dayoff' }, t('week.day.off')))
      : h('div', { class: 'hero-count' }, num, h('span', { class: 'unit' }, fresh ? t('unit.newToday') : capped != null ? t('unit.today') : t('unit.due')));
    const defText = fresh ? null : dayOff ? (allow.reviews.due ? t('today.offWait', { n: allow.reviews.due }) : null)
      : capped != null ? t('today.breakOf', { n: allow.reviews.due }) : t('today.dueAll');
    const el = h('section', { class: ['hero', 'today-hero', dayOff && 'is-off'], 'aria-label': t('today.summary') }, atmoEl,
      h('p', { class: 'label' }, lead),
      countEl,
      defText ? h('p', { class: 'caption hero-def' }, defText) : null,
      fresh ? null : h('div', { class: 'hero-week' }, stripEl),
      fresh ? null : weekLine,
      kindEl,
      welcomeEl,
      h('div', { class: 'hero-foot' }, todayLine, heroBtn), famEl);
    return {
      el,
      /** @param {{strip: HTMLElement | null} | null} [patch] Study anyway: the strip on screen to change in place */
      after(patch = null) {
        if (!fresh) {
          const cols = days.map(d => {
            const dayName = label(d.day);
            const text = d.plan ? t('today.week.day', { day: dayName, kind: t(`week.kind.${d.kind === 'off' ? 'n' : d.kind}`), done: d.done, plan: d.plan })
              : d.done ? t('today.week.dayOffDone', { day: dayName, done: d.done }) : t('today.week.dayOff', { day: dayName });
            // an Off day he studies anyway says so under its column (P2-3)
            const sub = d.today && anyway && d.kind === 'off' ? t('week.kind.anyway') : d.kind === 'n' || !hasWeek ? '' : t(`week.kind.${d.kind}`);
            return { label: weekdayShort(d.day), sub, plan: d.plan, done: d.done, today: d.today, past: d.past, aria: d.today ? t('today.week.today', { text }) : text };
          });
          // the columns fill from what was shown last time (back from a round, only the round's minutes fill)
          const key = days[0].day;
          const from = shown.week === key ? shown.ratios : [];
          // Study anyway: the strip already on screen changes in place, so today's column rises from its baseline
          if (patch && patch.strip) { weekStripUpdate(patch.strip, cols, days.findIndex(d => d.today)); stripEl.replaceWith(patch.strip); shown.week = key; }
          else { shown.week = key; shown.ratios = weekStrip(stripEl, cols, { from }); }
          const prev = shown.done;
          shown.done = tot.done;
          countTo(doneEl, tot.done, /** @type {any} */ ({ from: prev ?? 0, duration: 600, format: (/** @type {number} */ n) => fmtMin(t, n) }));
        }
        // the kind of day crosses over when it changes ("Study anyway")
        if (kindEl && shown.kind && shown.kind !== kindEl.textContent && !reduced()) kindEl.classList.add('is-new');
        shown.kind = kindEl ? kindEl.textContent : null;
        if (welcomeEl && shown.welcome !== c.today) { shown.welcome = c.today; if (!reduced()) welcomeEl.classList.add('fx-rise'); }
        if (dayOff) return;
        // the number is the odometer's only when it changes: Study anyway shows the count without a roll
        if (patch) { num.textContent = String(value); num.setAttribute('aria-label', fresh ? t('today.newLabel', { n: value }) : t('today.dueLabel', { n: value })); if (!reduced()) countEl.classList.add('is-new'); }
        else odometer(num, value, { label: fresh ? t('today.newLabel', { n: value }) : t('today.dueLabel', { n: value }) });
      },
    };
  }

  /** 'YYYY-MM' as "June 2027". @param {string | null} m */
  const monthLabel = m => (m ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(parse(`${m}-01`)) : '');
  /** A string with one placeholder (U+0000) around an element. @param {string} text @param {HTMLElement} node */
  const splitAround = (text, node) => { const [a, b = ''] = text.split('\u0000'); return [a, node, b].filter(x => x !== ''); };

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
    const linked = connected(store), repo = resultsRepo(store);
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
      h('p', null, examDate(s) ? t('import.examDate', { date: label(/** @type {string} */ (examDate(s))) }) : t('import.noDate')),
      meta.summary && Number.isInteger(meta.summary.newPerDay) && !s.rev?.newPerDay ? h('p', null, t('import.newPerDay', { n: meta.summary.newPerDay })) : null,
      preview && linked && preview.toSend ? h('p', null, t('preview.toSend', { n: preview.toSend, repo })) : null,
      unsent ? h('p', null, t('import.unsent', { n: unsent, repo })) : null,
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
    const s = ctx.settings();
    const calm = !COUNTDOWN.has(/** @type {string} */ (c.phase));
    // with a week plan in maintenance: the days still to come this week (Things' short list)
    const later = calm && courseWeek(s) ? laterThisWeek(weekDays({ settings: s, today: c.today, activity: store.get('activity', {}) || {} })) : [];
    const laterEl = later.length ? h('div', { class: 'plan-later' }, h('h3', { class: 'label' }, t('today.next')),
      h('ul', { class: 'list' }, later.map(d => h('li', { class: 'plan-later-row' },
        h('span', { class: 'plan-later-day' }, weekdayLong(d.day)),
        h('span', { class: 'caption' }, d.plan ? t('today.next.day', { kind: d.as === 'n' ? t('today.next.normal') : t(`week.day.${d.as}`), min: d.plan }) : t('today.next.off')))))) : null;
    // an Off day: no rows; the reviews wait for tomorrow, and "Study anyway" makes today a normal day
    if (calm && allow.plan && allow.plan.kind === 'off') {
      const due = allow.reviews.due;
      return section(t('today.plan'),
        h('div', { class: 'plan-off' },
          h('p', null, due ? t('week.why.off', { n: due }) : t('today.offNone')),
          h('button', { type: 'button', class: 'btn pressable', onclick: () => { anywayNext = true; store.set(ANYWAY_KV, { day: c.today }); rerender(); } }, t('week.studyAnyway'))),
        laterEl);
    }
    // inside the exam window the exam plans the day (code audit P0-1): an Off or Light day still has its reviews and a
    // few new items, and "Study anyway" makes an Off day a Normal one; no new items while the reviews fill the day
    const winKind = !calm && allow.plan && (allow.plan.kind === 'off' || allow.plan.kind === 'light') && c.phase !== 'day' ? allow.plan.kind : null;
    const examFull = !calm && (allow.why === 'reviewsDue' || allow.plan?.why === 'reviewsDue');
    const why = calm ? whyLine(allow.plan, allow.reviews.due) : examFull ? { key: 'week.why.reviewsDue' } : winKind ? { key: winKind === 'off' ? 'week.why.offWindow' : 'week.why.lightWindow' } : null;
    const anywayBtn = winKind === 'off' ? h('button', { type: 'button', class: 'btn pressable', onclick: () => { anywayNext = true; store.set(ANYWAY_KV, { day: c.today }); rerender(); } }, t('week.studyAnyway')) : null;
    const whyEl = !why ? null : anywayBtn ? h('div', { class: 'plan-off' }, h('p', { class: 'caption plan-note plan-why' }, t(why.key, why.vars)), anywayBtn)
      : h('p', { class: 'caption plan-note plan-why' }, t(why.key, why.vars));
    const work = plan.rows.filter(r => r.kind !== 'setup');
    const head = plan.state === 'done'
      ? h('p', { class: 'plan-done' }, icon('check', { size: 18 }), t('today.done', { n: dueTomorrow({ store, c, settings: ctx.settings(), exam: null, t }) }))
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
      whyEl, head, reviewsLine,
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
      paused, laterEl);
  }

  /**
   * The day's first visit (the stats are yesterday's): the page head and notices, the hero's card drawn from the stats
   * it has with its contents hidden (it only holds its height: the week strip and runway are drawn, nothing can be read
   * or tapped), and the plan's first rows as empty space, until the plan is composed. @param {Awaited<ReturnType<typeof composeDay>>} day
   */
  function shell(day) {
    const { c, settings: s } = day;
    const { hero, allow } = heroOf(day);
    // Today's family line: the day's board is made by prepare (build/plan.js), so on the day's first visit it is not
    // in the hero yet; hold its line where it comes as a rule (German, past the first week, no exam in its window: with
    // one, the board waits until he has seen six forms of a root, which only the content can tell)
    if (s.language === 'german' && !COUNTDOWN.has(c.phase) && allow.mode !== 'start' && !hero.el.querySelector('.hero-fam')) {
      hero.el.append(h('div', { class: 'hero-fam' }, h('span', { class: 'hero-fam-t' }, '\u00a0'), h('span', { class: 'hero-fam-d' }, '\u00a0')));
    }
    hero.el.classList.add('is-wait');
    hero.el.setAttribute('aria-hidden', 'true');
    hero.el.inert = true;
    // the card shows, empty: what is in it is hidden (the atmosphere starts with the real draw)
    for (const child of hero.el.children) /** @type {HTMLElement} */ (child).style.visibility = 'hidden';
    // rows the height of a plan row (app.css .plan-row: 60 px and a hairline), held by the CSSOM, never a .plan-row
    const row = () => h('div', { 'aria-hidden': 'true', style: { minHeight: '60px', borderBottom: '1px solid var(--hairline)' } });
    replace(el, h('div', { class: 'today is-loading', 'aria-busy': 'true' },
      h('header', { class: 'page-head' }, h('h1', null, t('today.title')), h('p', { class: 'caption' }, label(c.today))),
      h('p', { class: 'sr-only', role: 'status' }, t('today.loading')),
      h('div', { class: 'today-grid' },
        h('div', { class: 'today-a' }, hero.el, phaseNotice(c), importNotice()),
        h('div', { class: 'today-b' }, section(t('today.plan'), h('p', { class: 'caption section-sub', 'aria-hidden': 'true' }, '\u00a0'), h('div', { class: 'today-wait' }, [row(), row(), row(), row()]))))));
    // the strip and runway take their height; what the hero remembers for the real draw's motion is left as it was
    const keep = { ...shown, ratios: [...shown.ratios] };
    hero.after(null);
    Object.assign(shown, keep);
  }

  const rerender = () => { if (!pending) pending = render().finally(() => { pending = null; }); };
  // Draw at once from the stats the features wrote today (no content loaded), then let the features refresh them
  // (prepareDay loads the content) and compose again: the plan then is the one composeDay(ctx) gives in one call, and
  // it is drawn again only if it changed. On the day's first visit the page waits for it behind a quiet shell.
  const early = await composeDay(ctx, { prepare: false });
  const ready = statsFresh(store, early.c, early.settings);
  /** @type {unknown} */ let failed = null;
  prepared = prepareDay(ctx).catch(e => { failed = e || new Error('prepare'); }).then(() => new Promise(r => setTimeout(r)));
  if (ready) draw(early); else shell(early);
  const at = req;
  prepared.then(() => { if (failed) throw failed; return composeDay(ctx, { prepare: false }); }).then(day => {
    if (!alive || at !== req) return;   // a render since (settings, cards …) has drawn a newer plan
    if (!ready || keyOf(day, dayAllowance({ store, c: day.c, settings: day.settings })) !== drawnKey) draw(day);
  }).catch(e => {
    console.error('today: prepare', e);
    if (alive && at === req && !ready) draw(early);   // as offline: the plan from the last stats
  }).finally(() => { if (alive) bus.emit('today:settled'); });   // main.js: a new version may take over from here
  const offs = [
    bus.on('settings:changed', rerender),
    store.subscribe('cards:b1', rerender), store.subscribe('attempts', rerender), store.subscribe('activity', rerender), store.subscribe('mistakes', rerender),
  ];
  return { unmount() { alive = false; offs.forEach(f => f()); atmo?.destroy(); } };
}
