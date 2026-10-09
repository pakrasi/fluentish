/* Today › Progress (#/today/progress): the long view, from the progress log (data/progress.js, one record per study
   day). A child page of Today: Today's tab stays current and "Today" leads back.

   One range row (12 weeks, 6 months, All) scopes every chart and number under it; the level goal and the milestones
   read the whole log and say so. Every chart has a readout on hover and with the arrow keys, and a table twin.
   Time per week shows either the app's minutes or the study hours file (Toggl), never the two added together: the
   file already includes the time spent here.

   Motion: on the first open of a day the known line draws in and the columns rise; the summary numbers tick. A range
   switch crossfades and does not draw again. Reduced motion shows the end state. */
import { h, replace } from '../../../core/dom.js';
import { label } from '../../../core/clock.js';
import { icon } from '../../../core/icons.js';
import { section, seg, field } from '../../../core/ui.js';
import { countTo, reduced, toast, receive } from '../../../core/motion.js';
import { activeCourse, normalizeSettings, setSetting, langIdOf } from '../../../data/settings.js';
import { recorded } from '../../../data/progress.js';
import { monthKey, LEVELS } from '../../../domain/progress.js';
import { courseWeek, weekMinutes } from '../../../domain/week.js';
import * as D8 from '../../../domain/days.js';
import * as M from './model.js';
import * as C from './charts.js';
import { hoursSource, loadHours, cached } from './hours.js';

const nf = new Intl.NumberFormat('en-GB');
const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
/** The day the charts last drew in (once a day). */
let drawnOn = '';

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { t, store } = ctx;
  const today = ctx.clock.today();
  const course = activeCourse(store.get('settings'));
  /** @type {M.Range} */ let range = /** @type {any} */ (M.RANGES.includes(/** @type {any} */ (ctx.query.get('r'))) ? ctx.query.get('r') : '6m');
  let hours = ctx.query.get('h') === 'tracked' ? 'tracked' : 'app';
  /** @type {(() => void)[]} */ let stops = [];
  const tip = C.makeTip();
  const app = { store, hlc: ctx.app.hlc, bus: ctx.bus };

  /** Minutes as "3 h 05", "4 h" or "25 min". @param {number} min */
  const hm = min => {
    const m = Math.round(min);
    if (m < 60) return t('pg.min', { m });
    const hh = Math.floor(m / 60), mm = m % 60;
    return mm ? t('pg.hm', { h: hh, m: String(mm).padStart(2, '0') }) : t('pg.h', { h: hh });
  };
  /** Hours on an axis. @param {number} v */
  const hAxis = v => t('pg.h', { h: Number.isInteger(v) ? v : v.toFixed(1) });
  const signed = (/** @type {number} */ n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf.format(Math.abs(n))}`;
  const monthOf = (/** @type {string} */ d) => (D8.parse(d).getDate() <= 7 ? new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(D8.parse(d)).replace(/^Sept$/, 'Sep') : null);

  const back = h('a', { class: 'pg-back pressable', href: '#/today' }, icon('back', { size: 16 }), t('pg.back'));
  const page = h('div', { class: 'progress' });
  const body = h('div', { class: 'pg-body' });

  /** Write the range and the hours choice into the address without a new route (the page stays mounted). */
  const remember = () => {
    const q = new URLSearchParams();
    if (range !== '6m') q.set('r', range);
    if (hours !== 'app') q.set('h', hours);
    try { history.replaceState(history.state, '', `#/today/progress${q.size ? `?${q}` : ''}`); } catch { /* a sandboxed frame */ }
  };

  function render({ animate = false, fade = false } = {}) {
    for (const s of stops) s();
    stops = [];
    const ps = course ? M.points(recorded(store, course.id)) : [];
    if (ps.length < 2) {
      // the Words known frame, empty: axes and the grid, so the page shows what will fill in
      const fr = C.frame(C.emptyLine({ text: t('pg.firstWeek'), aria: t('pg.emptyAria') }));
      stops.push(fr.stop);
      replace(page, back, h('header', { class: 'page-head' }, h('h1', null, t('pg.title'))),
        h('p', { class: 'pg-empty' }, t(ps.length ? 'pg.one' : 'pg.empty')),
        h('section', { class: 'section pg-sec pg-empty-sec', 'aria-label': t('pg.known.title') }, h('p', { class: 'pg-empty-title', 'aria-hidden': 'true' }, t('pg.known.title')), fr.el), tip.el);
      return;
    }
    const first = ps[0].day;
    const from = M.rangeStart(range, today, first);
    const inRange = ps.filter(p => p.day >= from);
    const sum = M.summary(ps, from);
    const ws = M.weeks(ps, from, today);
    const exactFrom = ps.find(p => !p.est)?.day || null;
    const all = M.milestones(ps);

    const rangeSeg = seg({ label: t('pg.range'), value: range, options: M.RANGES.map(r => [r, t(`pg.range.${r}`)]),
      onChange: v => { range = /** @type {M.Range} */ (v); remember(); render({ fade: true }); } });
    const kpi = (/** @type {number} */ v, /** @type {(n: number) => string} */ fmt, /** @type {string} */ lab) => {
      const n = h('span', { class: 'pg-kpi-v tnum-no' }, fmt(v));
      if (animate) { n.textContent = fmt(0); queueMicrotask(() => countTo(n, v, /** @type {any} */ ({ from: 0, format: (/** @type {number} */ x) => fmt(Math.round(x)) }))); }
      return h('div', { class: 'pg-kpi' }, n, h('span', { class: 'pg-kpi-l' }, lab));
    };
    const kpis = h('div', { class: 'pg-kpis' },
      kpi(sum.net, signed, t('pg.kpi.net')),
      kpi(sum.learnt, x => nf.format(x), t('pg.kpi.learnt')),
      kpi(sum.min, x => hm(x), t('pg.kpi.time')));

    // rows that compare sit side by side from 960 px: how much I know; the two weekly columns; study days across;
    // the goal and the milestones. On a phone they stack in the same order.
    const kinds = kindSection(ws);
    replace(body,
      h('div', { class: 'pg-row' }, knownSection(ps, inRange, from, exactFrom, all, animate), levelsSection(inRange, ws, from)),
      h('div', { class: 'pg-row pg-row-weekly' }, learntSection(ws, sum, animate), timeSection(ws, from, animate)),
      daysSection(ps, from),
      kinds,
      h('div', { class: 'pg-row' }, goalSection(ps, exactFrom), milestonesSection(all, exactFrom)),
      logSection(ws));
    replace(page, back,
      h('header', { class: 'page-head' }, h('h1', null, t('pg.title'))),
      h('div', { class: 'pg-filter' }, rangeSeg, h('span', { class: 'caption tnum' }, t('pg.span', { from: label(D8.max(from, first)) }))),
      kpis, body, tip.el);
    if (fade && !reduced()) body.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }

  /* ---------- words and phrases known ---------- */
  function knownSection(/** @type {M.Point[]} */ ps, /** @type {M.Point[]} */ inRange, /** @type {string} */ from, /** @type {string | null} */ exactFrom, /** @type {M.Milestone[]} */ all, /** @type {boolean} */ animate) {
    const last = ps[ps.length - 1];
    const start = inRange[0]?.day || from;
    /** @type {C.LineMark[]} */ const marks = [];
    for (const m of all) if (m.on && m.how !== 'estimated' && m.on >= start && !m.id.startsWith('hours-') && m.id.startsWith('known-')) marks.push({ day: m.on, kind: 'milestone', text: msText(m) });
    for (const p of inRange) if (p.jump) marks.push({ day: p.day, kind: 'jump', text: t('pg.known.igloo', { n: nf.format(p.jump) }) });
    for (const c of M.poolChanges(ps)) if (c.day >= start) marks.push({ day: c.day, kind: 'pool', text: t('pg.known.pool', { n: signed(c.delta) }) });
    const pts = inRange.map(p => ({ day: p.day, v: p.known, est: p.est }));
    const fr = C.frame(C.lineChart({
      points: pts, from: start, to: today, yFormat: v => nf.format(v), marks, tipEl: tip, endLabel: p => nf.format(p.v),
      tip: p => [{ value: t(p.est ? 'pg.known.tipEst' : 'pg.known.tip', { n: nf.format(p.v) }), label: label(p.day) }],
      aria: t('pg.known.aria', { from: label(start), to: label(last.day), a: nf.format(pts[0]?.v ?? 0), b: nf.format(last.known) }),
    }));
    stops.push(fr.stop);
    if (animate) requestAnimationFrame(() => C.drawIn(fr.svg()));
    // opened from Today's Progress row: its sparkline was handed off, and this chart receives it (the small line morphs
    // into this one; motion.js takes the name off again when the route's transition ends)
    fr.el.classList.add('pg-known-frame');
    receive(fr.el, 'pg-known');
    const est = inRange.some(p => p.est);
    const key = (/** @type {string} */ cls) => { const v = C.s('svg', { class: 'pg-key', viewBox: '0 0 22 10', width: 22, height: 10, 'aria-hidden': 'true' }); v.append(cls === 'est' ? C.s('line', { class: 'pg-line pg-est', x1: 2, x2: 20, y1: 5, y2: 5 }) : C.s('rect', { class: 'pg-diamond', x: 7, y: 1.5, width: 7, height: 7, transform: 'rotate(45 10.5 5)' })); return v; };
    const sec = section(t('pg.known.title'),
      h('p', { class: 'caption section-sub' }, t('pg.known.sub', { k: nf.format(last.known), n: nf.format(last.of) })),
      fr.el,
      est && exactFrom ? h('p', { class: 'caption pg-note' }, key('est'), t('pg.known.est', { day: label(exactFrom) })) : null,
      marks.some(m => m.kind === 'milestone') ? h('p', { class: 'caption pg-note' }, key('ms'), t('pg.known.milestone')) : null,
      C.tableTwin(t('pg.table'), t('pg.known.caption'), [t('pg.th.day'), t('pg.th.known'), t('pg.th.learnt'), t('pg.th.missed')],
        inRange.slice().reverse().map(p => [p.est ? `${label(p.day)} (${t('pg.estimated')})` : label(p.day), nf.format(p.known), p.learnt, p.missed]), { numeric: [1, 2, 3] }));
    sec.classList.add('pg-sec');
    return sec;
  }

  /* ---------- by level: small multiples, share 0 to 100% ---------- */
  function levelsSection(/** @type {M.Point[]} */ inRange, /** @type {M.Week[]} */ ws, /** @type {string} */ from) {
    const last = inRange[inRange.length - 1], firstP = inRange[0];
    const start = firstP.day;
    const cells = LEVELS.map((L, i) => {
      if (!last.ln[i]) return null;
      const pts = inRange.filter(p => p.ln[i] > 0).map(p => ({ day: p.day, v: p.lk[i] / p.ln[i], est: p.est }));
      const fr = C.frame(C.lineChart({
        points: pts, from: start, to: today, yMax: 1, yFormat: v => `${Math.round(v * 100)}%`, compact: true, tipEl: tip,
        tip: p => [{ value: t('pg.levels.tip', { p: Math.round(p.v * 100), level: L }), label: label(p.day) }],
        aria: t('pg.levels.aria', { level: L, a: Math.round((pts[0]?.v || 0) * 100), b: Math.round((pts[pts.length - 1]?.v || 0) * 100) }),
      }), { min: 120 });
      stops.push(fr.stop);
      return h('div', { class: 'pg-multiple' },
        h('p', { class: 'pg-m-head' }, h('b', null, L, ' ', h('span', { class: 'pg-m-share tnum' }, `${Math.round((last.lk[i] / last.ln[i]) * 100)}%`)), h('span', { class: 'caption tnum' }, t('pg.levels.of', { k: nf.format(last.lk[i]), n: nf.format(last.ln[i]) }))),
        fr.el,
        h('p', { class: 'caption tnum' }, t('pg.levels.change', { d: signed(last.lk[i] - firstP.lk[i]) })));
    }).filter(Boolean);
    const shown = LEVELS.filter((_, i) => last.ln[i] > 0);
    const at = (/** @type {M.Week} */ w) => inRange.filter(p => p.day <= w.sun).pop();
    const sec = section(t('pg.levels.title'),
      h('p', { class: 'caption section-sub' }, t('pg.levels.sub')),
      h('div', { class: 'pg-multiples' }, cells),
      C.tableTwin(t('pg.table'), t('pg.levels.caption'), [t('pg.th.week'), ...shown],
        ws.filter(w => w.sun >= from).slice().reverse().map(w => { const p = at(w); return [label(w.mon), ...shown.map(L => { const i = LEVELS.indexOf(L); return p && p.ln[i] ? `${Math.round((p.lk[i] / p.ln[i]) * 100)}%` : ''; })]; }),
        { numeric: shown.map((_, i) => i + 1) }));
    sec.classList.add('pg-sec');
    return sec;
  }

  /* ---------- learnt per week ---------- */
  function learntSection(/** @type {M.Week[]} */ ws, /** @type {ReturnType<typeof M.summary>} */ sum, /** @type {boolean} */ animate) {
    const cols = ws.map(w => ({ key: w.mon, v: w.learnt, partial: w.partial, label: label(w.mon) }));
    const avg = M.weeklyAverage(ws.map(w => ({ min: w.learnt, partial: w.partial })), 8);
    const fr = C.frame(C.columns({
      cols, yFormat: v => nf.format(v), tipEl: tip, xLabel: c => monthOf(c.key), soFar: t('pg.soFar'),
      avg: avg ? { v: avg, text: t('pg.avg', { v: nf.format(avg) }) } : null,
      tip: c => [{ value: t('pg.learnt.tip', { n: nf.format(c.v) }), label: `${t('pg.log.week', { day: c.label })}${c.partial ? `, ${t('pg.soFar')}` : ''}` }],
      aria: t('pg.learnt.aria', { n: ws.length, total: nf.format(sum.learnt) }),
    }));
    stops.push(fr.stop);
    if (animate) requestAnimationFrame(() => C.riseIn(fr.svg()));
    const sec = section(t('pg.learnt.title'),
      h('p', { class: 'caption section-sub' }, t('pg.learnt.sub', { m: nf.format(sum.missed) })),
      fr.el,
      C.tableTwin(t('pg.table'), t('pg.learnt.caption'), [t('pg.th.week'), t('pg.th.learnt'), t('pg.th.missed')],
        ws.slice().reverse().map(w => [label(w.mon) + (w.partial ? ` (${t('pg.soFar')})` : ''), w.learnt, w.missed]), { numeric: [1, 2] }));
    sec.classList.add('pg-sec');
    return sec;
  }

  /* ---------- time per week: the app's minutes, or the study hours file, never both ---------- */
  function timeSection(/** @type {M.Week[]} */ ws, /** @type {string} */ from, /** @type {boolean} */ animate) {
    const holder = h('div', { class: 'pg-time' });
    // "All tracked" exists only once the learner entered a study hours file of their own (no default: docs/SHARING.md)
    const hasSource = !!hoursSource(normalizeSettings(store.get('settings')));
    if (!hasSource) hours = 'app';
    const sourceSeg = !hasSource ? null : seg({ label: t('pg.time.source'), value: hours, options: [['app', t('pg.time.app')], ['tracked', t('pg.time.tracked')]],
      onChange: v => { hours = v === 'tracked' ? 'tracked' : 'app'; remember(); fill(false); } });
    const fill = (/** @type {boolean} */ anim) => {
      if (hours === 'app') { replace(holder, ...appTime(ws, anim)); if (!hasSource) holder.append(addSource()); }
      else trackedTime(holder, from, anim);
    };
    fill(animate);
    const sec = section(t('pg.time.title'), holder);
    sec.classList.add('pg-sec', 'pg-time-sec');
    // the source switch sits in the heading's row, so this chart's plot lines up with Learnt per week beside it
    const head = h('div', { class: 'pg-sec-head' });
    const h2 = /** @type {HTMLElement} */ (sec.querySelector('h2'));
    h2.replaceWith(head);
    head.append(h2);
    if (sourceSeg) head.append(h('div', { class: 'pg-seg-row' }, sourceSeg));
    return sec;
  }

  function appTime(/** @type {M.Week[]} */ ws, /** @type {boolean} */ animate) {
    const groups = /** @type {string[]} */ ([...M.GROUPS, 'other']).filter(g => ws.some(w => w.groups[g] > 0));
    const settings = normalizeSettings(store.get('settings'));
    const week = courseWeek(settings);
    const plan = week ? weekMinutes(week) : 0;
    const avg = M.weeklyAverage(ws.map(w => ({ min: w.min, partial: w.partial })), 8);
    const cols = ws.map(w => ({ key: w.mon, v: w.min / 60, partial: w.partial, label: label(w.mon) }));
    const byMon = new Map(ws.map(w => [w.mon, w]));
    const fr = C.frame(C.columns({
      cols, yFormat: hAxis, tipEl: tip, xLabel: c => monthOf(c.key), ref: plan ? { v: plan / 60, text: t('pg.time.plan', { t: hm(plan) }) } : null,
      soFar: t('pg.soFar'), avg: avg != null ? { v: avg / 60, text: t('pg.avg', { v: hm(avg) }) } : null,
      tip: c => { const w = /** @type {M.Week} */ (byMon.get(c.key)); return [{ value: t('pg.time.tip', { t: hm(w.min), d: w.days }), label: `${t('pg.log.week', { day: c.label })}${c.partial ? `, ${t('pg.soFar')}` : ''}` }]; },
      aria: t('pg.time.aria', { n: ws.length }),
    }));
    stops.push(fr.stop);
    if (animate) requestAnimationFrame(() => C.riseIn(fr.svg()));
    return [
      h('p', { class: 'caption section-sub' }, t('pg.time.appSub'), ' ', avg != null ? t('pg.time.avg', { t: hm(avg) }) : null),
      fr.el,
      plan ? h('p', { class: 'caption pg-note' }, t('pg.time.planNote', { t: hm(plan) })) : null,
      C.tableTwin(t('pg.table'), t('pg.time.caption'), [t('pg.th.week'), t('pg.th.time'), ...groups.map(g => t(`pg.group.${g}`)), t('pg.th.days'), t('pg.th.devices')],
        ws.slice().reverse().map(w => [label(w.mon) + (w.partial ? ` (${t('pg.soFar')})` : ''), hm(w.min), ...groups.map(g => hm(w.groups[g])), w.days, w.devices]),
        { numeric: Array.from({ length: groups.length + 3 }, (_, i) => i + 1) }),
    ];
  }

  /* ---------- time in Fluentish by kind: small multiples on one scale, across the page from 960 px ---------- */
  function kindSection(/** @type {M.Week[]} */ ws) {
    const groups = /** @type {string[]} */ ([...M.GROUPS, 'other']).filter(g => ws.some(w => w.groups[g] > 0));
    if (!groups.length) return null;
    const top = Math.max(0, ...ws.flatMap(w => groups.map(g => w.groups[g] / 60)));
    const multiples = groups.map(g => {
      const total = ws.reduce((n, w) => n + w.groups[g], 0);
      const kfr = C.frame(C.columns({
        cols: ws.map(w => ({ key: w.mon, v: w.groups[g] / 60, partial: w.partial, label: label(w.mon) })), yMax: top, compact: true, yFormat: hAxis, tipEl: tip,
        tip: c => [{ value: hm(c.v * 60), label: `${t(`pg.group.${g}`)}, ${t('pg.log.week', { day: c.label })}` }],
        aria: t('pg.time.kindAria', { kind: t(`pg.group.${g}`), t: hm(total) }),
      }), { min: 120 });
      stops.push(kfr.stop);
      return h('div', { class: 'pg-multiple' },
        h('p', { class: 'pg-m-head' }, h('b', null, t(`pg.group.${g}`)), h('span', { class: 'caption tnum' }, hm(total))), kfr.el);
    });
    const sec = section(t('pg.time.byKind'),
      h('p', { class: 'caption section-sub' }, t('pg.time.byKindSub'), groups.includes('practice') ? ` ${t('pg.group.practiceSub')}` : ''),
      h('div', { class: 'pg-multiples pg-multiples-kind' }, multiples));
    sec.classList.add('pg-sec', 'pg-kind-sec');
    return sec;
  }

  /** The study hours file: read once a day (a copy stays on the device), drawn on its own. */
  function trackedTime(/** @type {HTMLElement} */ holder, /** @type {string} */ from, /** @type {boolean} */ animate) {
    const settings = normalizeSettings(store.get('settings'));
    const src = hoursSource(settings);
    if (!src) { hours = 'app'; remember(); render(); return; }
    const lang = src.lang || langIdOf(course?.lang || 'de') || 'german';
    const url = M.hoursUrl(src);
    const have = url ? cached(store, url) : null;
    // Every branch ends in the chart or a status line, never an empty holder. The first draw runs before the holder is
    // in the page (a range switch builds the section first), so only a late answer checks that it is still shown.
    const draw = (/** @type {import('./hours.js').Cached | null} */ data, /** @type {string | null} */ error, /** @type {boolean} */ loading, late = false) => {
      if (late && !holder.isConnected) return;
      /** @type {any[]} */ const parts = [h('p', { class: 'caption section-sub' }, t('pg.hours.sub', { lang: cap(lang) }))];
      if (data) {
        const byDay = M.hoursByDay({ entries: data.entries }, lang);
        const hw = M.hoursWeeks(byDay, from, today);
        if (error) parts.push(h('p', { class: 'caption pg-warn', role: 'status' }, t('pg.hours.stale', { when: label(data.day) })));
        if (!hw.some(w => w.min > 0)) parts.push(h('p', { class: 'caption' }, t('pg.hours.none', { lang: cap(lang) })));
        else {
          const avg = M.weeklyAverage(hw, 8);
          if (avg != null) parts.push(h('p', { class: 'caption' }, t('pg.time.avg', { t: hm(avg) })));
          const byMon = new Map(hw.map(w => [w.mon, w]));
          const fr = C.frame(C.columns({
            cols: hw.map(w => ({ key: w.mon, v: w.min / 60, partial: w.partial, label: label(w.mon) })), yFormat: hAxis, tipEl: tip, xLabel: c => monthOf(c.key),
            soFar: t('pg.soFar'), avg: avg != null ? { v: avg / 60, text: t('pg.avg', { v: hm(avg) }) } : null,
            tip: c => { const w = /** @type {any} */ (byMon.get(c.key)); return [{ value: t('pg.hours.tip', { t: hm(w.min), d: w.days }), label: `${t('pg.log.week', { day: c.label })}${c.partial ? `, ${t('pg.soFar')}` : ''}` }]; },
            aria: t('pg.hours.aria', { n: hw.length }),
          }));
          stops.push(fr.stop);
          if (animate) requestAnimationFrame(() => C.riseIn(fr.svg()));
          parts.push(fr.el, C.tableTwin(t('pg.table'), t('pg.hours.caption'), [t('pg.th.week'), t('pg.th.hours'), t('pg.th.days')],
            hw.slice().reverse().map(w => [label(w.mon) + (w.partial ? ` (${t('pg.soFar')})` : ''), hm(w.min), w.days]), { numeric: [1, 2] }));
        }
      } else if (loading) parts.push(h('p', { class: 'caption', role: 'status' }, t('pg.hours.loading')));
      else parts.push(h('p', { class: 'caption pg-warn', role: 'status' }, t('pg.hours.error')));
      parts.push(h('p', { class: 'caption pg-note' }, t('pg.hours.note')));
      parts.push(sourceRow(src, data, holder, from));
      replace(holder, ...parts);
    };
    draw(have, null, !have || have.day !== today);
    if (!have || have.day !== today) loadHours(ctx, src).then(r => { if (hours === 'tracked') draw(r.data, r.error, false, true); });
  }

  /** No study hours file yet: a quiet button that opens the form for one. */
  function addSource() {
    const add = h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-expanded': 'false', onclick: () => {
      add.setAttribute('aria-expanded', 'true');
      add.hidden = true;
      form.hidden = false;
      /** @type {HTMLElement | null} */ (form.querySelector('input'))?.focus();
    } }, t('pg.hours.add'));
    const form = sourceForm(null, () => { hours = 'tracked'; remember(); render(); }, () => { form.hidden = true; add.hidden = false; add.setAttribute('aria-expanded', 'false'); add.focus(); });
    return h('div', { class: 'pg-source' }, h('p', { class: 'caption' }, t('pg.hours.addHint')), h('div', { class: 'row-actions' }, add), form);
  }

  /**
   * The form for the study hours file: repository, path and project. Saving writes settings.connections.hours.
   * @param {import('./hours.js').HoursSource | null} src @param {() => void} saved @param {() => void} cancel
   */
  function sourceForm(src, saved, cancel) {
    const repo = h('input', { type: 'text', class: 'input', value: src?.repo || '', placeholder: 'owner/name', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const path = h('input', { type: 'text', class: 'input', value: src?.path || '', placeholder: 'data/hours.json', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const langIn = h('input', { type: 'text', class: 'input', value: src?.lang || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const repoF = field({ label: t('pg.hours.repo'), input: repo, hint: t('pg.hours.hint') });
    const form = h('form', { class: 'pg-source-form', hidden: true, onsubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      const next = { repo: /** @type {HTMLInputElement} */ (repo).value.trim(), path: /** @type {HTMLInputElement} */ (path).value.trim(), lang: /** @type {HTMLInputElement} */ (langIn).value.trim().toLowerCase() || null };
      if (!M.hoursUrl(next) || !/\.json$/i.test(next.path)) { repoF.setError(t('pg.hours.bad')); return; }
      setSetting(app, 'connections.hours', next);
      toast(t('pg.hours.saved'));
      saved();
    } },
    repoF, field({ label: t('pg.hours.path'), input: path }), field({ label: t('pg.hours.lang'), input: langIn, hint: t('pg.hours.langHint') }),
    h('div', { class: 'row-actions' },
      h('button', { type: 'submit', class: 'btn btn-primary pressable' }, t('pg.hours.save')),
      h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: cancel }, t('pg.hours.cancel')),
      src ? h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => { setSetting(app, 'connections.hours', null); toast(t('pg.hours.removed')); hours = 'app'; remember(); render(); } }, t('pg.hours.remove')) : null));
    return form;
  }

  /** Where the hours come from, with Read again and Change source. */
  function sourceRow(/** @type {import('./hours.js').HoursSource} */ src, /** @type {any} */ data, /** @type {HTMLElement} */ holder, /** @type {string} */ from) {
    const line = h('p', { class: 'caption' }, data ? t('pg.hours.from', { repo: src.repo, path: src.path, when: label(data.day) }) : t('pg.hours.fromNever', { repo: src.repo, path: src.path }));
    const again = h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: async () => {
      /** @type {HTMLButtonElement} */ (again).disabled = true;
      await loadHours(ctx, src, { force: true });
      if (holder.isConnected) trackedTime(holder, from, false);
    } }, t('pg.hours.refresh'));
    const edit = h('button', { type: 'button', class: 'btn btn-quiet pressable', 'aria-expanded': 'false', onclick: () => {
      edit.setAttribute('aria-expanded', 'true');
      edit.hidden = true;
      form.hidden = false;
      /** @type {HTMLElement | null} */ (form.querySelector('input'))?.focus();
    } }, t('pg.hours.change'));
    const form = sourceForm(src, () => trackedTime(holder, from, false), () => { form.hidden = true; edit.hidden = false; edit.setAttribute('aria-expanded', 'false'); edit.focus(); });
    return h('div', { class: 'pg-source' }, line, h('div', { class: 'row-actions' }, again, edit), form);
  }

  /* ---------- study days ---------- */
  function daysSection(/** @type {M.Point[]} */ ps, /** @type {string} */ from) {
    const cal = M.calendar(ps, from, today);
    const avg = M.daysPerWeek(ps, today, 12);
    const since = D8.max(from, cal.first || from);
    const weekdays = t('pg.days.weekdays').split(',');
    const tipOf = (/** @type {{day: string, min: number, studied: boolean}} */ d) => [{ value: !d.studied ? t('pg.days.tipNone') : d.min > 0 ? t('pg.days.tipMin', { m: Math.round(d.min) }) : t('pg.days.tipUnknown'), label: label(d.day) }];
    const fr = C.frame(C.calendarChart({ days: cal.days, today, tip: tipOf, tipEl: tip, weekdays, aria: t('pg.days.aria', { from: label(since), k: cal.studied, n: cal.total }) }), { min: 200 });
    stops.push(fr.stop);
    const sw = (/** @type {number} */ k) => h('span', { class: 'pg-swatch-item' }, h('i', { class: `pg-swatch pg-k${k}`, 'aria-hidden': 'true' }), t(`pg.days.k${k}`));
    const sec = section(t('pg.days.title'),
      h('p', { class: 'caption section-sub' }, t('pg.days.sub', { k: cal.studied, n: cal.total, day: label(since) }), avg != null ? ` ${t('pg.days.avg', { n: avg })}` : ''),
      h('div', { class: 'pg-cal-wrap' }, fr.el),
      h('p', { class: 'pg-legend caption' }, [0, 1, 2, 3].map(sw)),
      C.tableTwin(t('pg.table'), t('pg.days.caption'), [t('pg.th.day'), t('pg.th.time')],
        cal.days.filter(d => d.studied && !d.before).reverse().map(d => [label(d.day), d.min > 0 ? hm(d.min) : t('pg.days.tipUnknown')]), { numeric: [1] }));
    sec.classList.add('pg-sec');
    return sec;
  }

  /* ---------- the level goal: a range, never a promise ---------- */
  function goalSection(/** @type {M.Point[]} */ ps, /** @type {string | null} */ exactFrom) {
    const goal = /** @type {any} */ (course)?.goal || {};
    const level = typeof goal.level === 'string' ? goal.level : null;
    if (!level) {
      const sec = section(t('pg.goal.titleNone'), h('p', { class: 'caption' }, t('pg.goal.none'), ' ', h('a', { href: '#/profile/goal' }, t('pg.goal.set'))));
      sec.classList.add('pg-sec');
      return sec;
    }
    const by = typeof goal.by === 'string' && /^\d{4}-\d\d$/.test(goal.by) ? goal.by : null;
    const byDay = by ? D8.add(`${D8.add(`${by}-01`, 32).slice(0, 7)}-01`, -1) : null;
    const eta = M.levelEta(ps, level, today);
    const last = ps[ps.length - 1], li = LEVELS.indexOf(level);
    const n = li >= 0 ? last.ln[li] : 0, k = li >= 0 ? last.lk[li] : 0;
    /** @type {any[]} */ const parts = [];
    if (n) parts.push(h('p', { class: 'caption section-sub' }, t('pg.goal.share', { p: Math.round((k / n) * 100), level, k: nf.format(k), n: nf.format(n), need: nf.format(Math.ceil(n * M.ETA_SHARE)) })));
    if (eta.state === 'ok') {
      const fr = C.frame(C.rangeStrip({ today, from: eta.from, mid: eta.mid, to: eta.to, by: byDay, text: { today: t('pg.goal.today'), by: t('pg.goal.by') },
        aria: t('pg.goal.aria', { a: label(eta.from), b: eta.to ? label(eta.to) : '', c: label(eta.mid) }) }));
      stops.push(fr.stop);
      parts.push(h('p', { class: 'pg-goal-range' }, eta.to ? t('pg.goal.range', { a: MONTH_YEAR.format(D8.parse(eta.from)), b: MONTH_YEAR.format(D8.parse(eta.to)) }) : t('pg.goal.rangeOpen', { a: MONTH_YEAR.format(D8.parse(eta.from)) })),
        fr.el,
        h('p', { class: 'caption' }, t('pg.goal.pace', { n: nf.format(eta.pace), level })),
        h('p', { class: 'caption pg-note' }, t('pg.goal.how', { level, day: label(exactFrom || ps[0].day) })));
    } else if (eta.state === 'young') parts.push(h('p', { class: 'caption' }, t('pg.goal.young', { n: eta.weeks })));
    else if (eta.state === 'flat') parts.push(h('p', { class: 'caption' }, t('pg.goal.flat', { level })));
    else if (eta.state === 'reached') parts.push(h('p', { class: 'caption' }, t('pg.goal.reached', { level })));
    const sec = section(by ? t('pg.goal.titleBy', { level, month: MONTH_YEAR.format(D8.parse(`${by}-01`)) }) : t('pg.goal.title', { level }), ...parts);
    sec.classList.add('pg-sec', 'pg-goal');
    return sec;
  }

  /* ---------- milestones ---------- */
  /** @param {M.Milestone} m */
  function msText(m) {
    const v = /** @type {Record<string, any>} */ ({ ...m.vars });
    if (typeof v.n === 'number') v.n = nf.format(v.n);
    return t(m.key, v);
  }
  function milestonesSection(/** @type {M.Milestone[]} */ all, /** @type {string | null} */ exactFrom) {
    const { reached, next } = M.milestoneList(all);
    const when = (/** @type {M.Milestone} */ m) => (m.how === 'estimated' ? t('pg.ms.before', { day: label(exactFrom || today) })
      : m.how === 'igloo' ? t('pg.ms.igloo', { day: label(/** @type {string} */ (m.on)) }) : label(/** @type {string} */ (m.on)));
    const row = (/** @type {M.Milestone} */ m) => h('li', null, h('span', { class: 'pg-ms-tick', 'aria-hidden': 'true' }), h('span', null, msText(m)), h('span', { class: 'caption tnum' }, when(m)));
    const nextText = (/** @type {M.Milestone} */ m) => (m.id.startsWith('hours-') ? t('pg.ms.nextH', { k: nf.format(Math.floor(m.have / 60)), n: nf.format(m.need / 60) }) : t('pg.ms.next', { k: nf.format(m.have), n: nf.format(m.need) }));
    const FIRST_MS = 6;
    const list = h('ul', { class: 'pg-ms' },
      next.map(m => h('li', { class: 'is-next' }, h('span', { class: 'pg-ms-tick', 'aria-hidden': 'true' }), h('span', null, msText(m)), h('span', { class: 'caption tnum' }, nextText(m)))),
      reached.slice(0, FIRST_MS).map(row));
    const more = h('button', { type: 'button', class: 'btn btn-quiet pressable pg-more', onclick: () => { list.append(...reached.slice(FIRST_MS).map(row)); more.remove(); } },
      t('pg.ms.all', { n: reached.length - FIRST_MS }));
    const sec = section(t('pg.ms.title'),
      h('p', { class: 'caption section-sub' }, t('pg.ms.sub')),
      list,
      reached.length > FIRST_MS ? more : null,
      reached.length ? null : h('p', { class: 'caption' }, t('pg.ms.none')));
    sec.classList.add('pg-sec');
    return sec;
  }

  /* ---------- the weekly log ---------- */
  function logSection(/** @type {M.Week[]} */ ws) {
    const list = h('ol', { class: 'pg-log' });
    const rows = ws.slice().reverse();
    let shown = 0;
    const more = h('button', { type: 'button', class: 'btn btn-quiet pressable pg-more', onclick: () => add(8) });
    const add = (/** @type {number} */ n) => {
      for (const w of rows.slice(shown, shown + n)) list.append(logRow(w));
      shown = Math.min(rows.length, shown + n);
      const left = rows.length - shown;
      more.hidden = left <= 0;
      more.textContent = t('pg.log.more', { n: Math.min(8, left) });
    };
    add(8);
    const sec = section(t('pg.log.title'), h('p', { class: 'caption section-sub' }, t('pg.log.sub')), list, more);
    sec.classList.add('pg-sec', 'pg-log-sec');
    return sec;
  }
  function logRow(/** @type {M.Week} */ w) {
    const kinds = [...M.GROUPS, 'other'].filter(g => w.groups[g] > 0).map(g => t('pg.log.kind', { kind: t(`pg.group.${g}`), t: hm(w.groups[g]) }));
    return h('li', { class: 'pg-log-row' },
      h('p', { class: 'row-title' }, t('pg.log.week', { day: label(w.mon) }), w.partial ? h('span', { class: 'caption' }, ` (${t('pg.soFar')})`) : null),
      w.days ? h('p', { class: 'caption tnum' }, `${t('pg.log.time', { t: hm(w.min), n: w.days })}. ${t('pg.log.counts', { l: nf.format(w.learnt), m: nf.format(w.missed) })}${w.devices > 1 ? ` ${t('pg.log.devices', { n: w.devices })}` : ''}`) : h('p', { class: 'caption' }, t('pg.log.none')),
      kinds.length ? h('p', { class: 'caption' }, kinds.join(', ')) : null);
  }

  const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

  el.append(page);
  const animate = drawnOn !== today;
  drawnOn = today;
  render({ animate });
  // a new record of today (written 20 s after study) shows without drawing again
  const off = course ? store.subscribe(monthKey(course.id, today), () => render()) : () => {};
  return { unmount() { off(); for (const s of stops) s(); tip.hide(); } };
}
