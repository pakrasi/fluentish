/* Today › Where you stand (docs/ARCHITECTURE.md › Where you stand): per exam module the latest mock score against its
   pass line, the module's practice items known and one next action; then words and phrases known, the same count as
   the map's (shared/data.js wordsKnown: data/atlas.js totals over the same knowledge score). Without an exam ahead the module actions
   go and "This week" says what was learnt and what lapsed.

   The section draws at once from the composed plan (the module scores come with it); the counts that need content
   (the pool, the knowledge score, the map) fill in when they are loaded. */
import { h } from '../../core/dom.js';
import { section } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { disclose, fill as fillTo } from '../../core/motion.js';
import { label, diff } from '../../core/clock.js';
import { modulesStanding, weakest, week, knownOf } from '../../domain/standing.js';
import { loadKnowledge, knowledgeDecks } from '../../data/knowledge.js';
import { scopeItem } from '../../domain/itemids.js';
import { at } from '../../domain/progress.js';
import { add as addDays } from '../../domain/days.js';
import { recorded } from '../../data/progress.js';
import { activeCourse } from '../../data/settings.js';
import { points } from './progress/model.js';


const AHEAD = new Set(['week', 'lastNew', 'eve']);
const nf = new Intl.NumberFormat('en-GB');

/**
 * The next action of each module while the exam is ahead, from the rows the plan composed (in the plan or under "If
 * you have time"), else the page that trains it.
 * @param {any} plan composeToday() @param {any[]} ms modulesStanding() @param {(k: string, v?: any) => string} t
 * @returns {Record<string, {href: string, text: string} | null>}
 */
export function nextActions(plan, ms, t) {
  const all = [...plan.rows, ...(plan.extra || [])].filter((/** @type {any} */ r) => !r.done && r.kind !== 'setup');
  const row = (/** @type {string} */ id) => all.find((/** @type {any} */ r) => r.id === id) || null;
  const mock = (/** @type {string} */ m) => all.find((/** @type {any} */ r) => r.mock && r.module === m) || null;
  const as = (/** @type {any} */ r) => (r ? { href: r.href, text: r.minutes ? `${r.title} · ${t('unit.min', { n: r.minutes })}` : r.title } : null);
  /** @type {Record<string, {href: string, text: string} | null>} */ const out = {};
  for (const m of ms) {
    if (m.id === 'schreiben') out[m.id] = as(row('practice.schreiben') || row('practice.correction') || (m.status !== 'pass' ? mock('schreiben') : null) || row('practice.writing')) || { href: '#/practice/write', text: t('stand.act.write') };
    else if (m.id === 'sprechen') out[m.id] = as(row('practice.situations') || (m.status === 'none' ? mock('sprechen') : null) || row('practice.teil2')) || { href: '#/practice/speak', text: t('stand.act.speak') };
    else if (m.id === 'lesen') out[m.id] = m.status === 'none' ? as(mock('lesen')) || { href: '#/exam', text: t('stand.act.mock', { module: m.name }) } : { href: '#/practice/round?kind=area%3Areading', text: t('stand.act.lesen') };
    else out[m.id] = m.status === 'none' ? as(mock('hoeren')) || { href: '#/exam', text: t('stand.act.mock', { module: m.name }) } : as(mock('hoeren'));
  }
  return out;
}

/**
 * The counts that need content: per module the practice items known, words and phrases known (the map's count), and
 * this week's change. Never throws; null when the content is not there.
 * @param {any} ctx @param {any[]} modules plan.modules
 */
export async function standingCounts(ctx, modules) {
  try {
    const { loadData } = await import('../shared/data.js');
    // the pool first: loading it runs Igloo's placement import once, so every count below sees its marks
    const data = await loadData(ctx);
    // a course in another language (C3b) has no map: its words and phrases known are its course's items, scoped by
    // its language (domain/itemids.js)
    const course = data.course || null;
    const [k, map] = await Promise.all([loadKnowledge(ctx), course ? null : mapCounts(ctx)]);
    const mapWords = map ? map.words : null;
    const get = (/** @type {string} */ id) => k.get(course ? scopeItem(course, k.maps.resolve(id, 'core') || id) : k.maps.resolve(id, 'b1') || id);
    const words = course ? knownOf(data.pool.map((/** @type {any} */ it) => it.id), get) : mapWords;
    const ms = modulesStanding({ modules, pool: data.pool, get });
    const c = ctx.clock.ctx();
    const decks = Object.fromEntries(knowledgeDecks(ctx.store).map(d => [d, ctx.store.cards(d) || {}]));   // the active course's
    return { ms, words, week: week(decks, c.today, diff), known: knownOf, levels: map ? withGain(map.levels, ctx.store, c.today) : null };
  } catch { return null; }
}

/**
 * The map's items known, in all and by level, from one scoring pass (the count the map and Where you stand share);
 * null for a course without a map. @param {any} ctx
 */
async function mapCounts(ctx) {
  const { roundOf, ensurePlacement } = await import('../shared/data.js');
  if (!roundOf(ctx).trainer) return null;
  await ensurePlacement(ctx);
  const { loadAtlas, scores, totals, byLevel } = await import('../../data/atlas.js');
  /** @type {any} */ const A = await /** @type {Promise<any>} */ (loadAtlas(ctx)).catch(() => null);
  if (!A) return null;
  const K = await scores(ctx, A);
  return { words: totals(A, K), levels: byLevel(A, K) };
}

/**
 * Each level's gain over the last 4 weeks, from the progress log (the record of 28 days ago or the latest before it;
 * none while the log is younger). @param {{level: string, k: number, n: number}[]} levels @param {any} store @param {string} today
 */
function withGain(levels, store, today) {
  const course = activeCourse(store.get('settings'));
  const then = course ? recorded(store, course.id).filter(([d]) => d <= addDays(today, -28)).pop() : null;
  if (!then) return levels.map(x => ({ ...x, was: null }));
  const r = then[1];
  return levels.map(x => ({ ...x, was: at(r.known, 'w', x.level) + at(r.known, 'p', x.level) + at(r.known, 'g', x.level) }));
}

const NS = 'http://www.w3.org/2000/svg';
/**
 * Known over the last 12 weeks from the progress log, for the Progress row's sparkline, and the change over the last
 * 4 weeks. Null with fewer than two records. @param {any} store @param {string} today
 * @returns {{pts: {day: string, v: number}[], gain: number | null} | null}
 */
export function sparkOf(store, today) {
  const course = activeCourse(store.get('settings'));
  if (!course) return null;
  const all = points(recorded(store, course.id));
  const from = addDays(today, -84);
  const pts = all.filter(p => p.day >= from && p.day <= today).map(p => ({ day: p.day, v: p.known }));
  if (pts.length < 2) return null;
  const then = all.filter(p => p.day <= addDays(today, -28)).pop();
  return { pts, gain: then ? pts[pts.length - 1].v - then.known : null };
}

/**
 * A 96×28 sparkline: a 2 px ink line, the accent end dot. It shares a view-transition name with the Progress page's
 * known line, so opening Progress morphs the one into the other (reduced motion: the route's crossfade).
 * @param {{day: string, v: number}[]} pts
 */
function sparkline(pts) {
  const W = 96, H = 28, P = 3;
  const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  const x0 = Date.parse(pts[0].day), x1 = Date.parse(pts[pts.length - 1].day);
  const X = (/** @type {string} */ d) => P + ((Date.parse(d) - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
  const Y = (/** @type {number} */ v) => H - P - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ class: 'stand-spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  const line = document.createElementNS(NS, 'path');
  line.setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.day).toFixed(1)},${Y(p.v).toFixed(1)}`).join(''));
  line.setAttribute('class', 'stand-spark-line');
  const end = document.createElementNS(NS, 'circle');
  const last = pts[pts.length - 1];
  for (const [k, v] of Object.entries({ cx: X(last.day).toFixed(1), cy: Y(last.v).toFixed(1), r: 2.75, class: 'stand-spark-end' })) end.setAttribute(k, String(v));
  svg.append(line, end);
  return svg;
}

/**
 * The section. Returns the element and a fill(counts) for the counts that come later.
 *   rows 'open' (an exam in its window, or up to 14 days after it): per module the latest mock score, the items known
 *     and one next action, then words and phrases known (as before round 4).
 *   rows 'folded' or 'none' (maintenance): words and phrases known as a figure, known by level (the accent is what
 *     was learnt in the last 4 weeks, from the progress log), the level goal, and the mock results folded behind one
 *     button ('folded') or left out ('none').
 * @param {{plan: any, c: any, t: (k: string, v?: any) => string, course?: boolean, rows?: 'open' | 'folded' | 'none',
 *   goal?: {level: string, month: string | null} | null, examName?: string, spark?: ReturnType<typeof sparkOf>}} o
 *   spark: known over the last 12 weeks, for the Progress row; course: a course in another language
 *   than German, whose words line counts its course's items and opens Practice (there is no map for it)
 */
export function renderStanding({ plan, c, t, course = false, rows: mode = 'open', goal = null, examName = '', spark = null }) {
  const ahead = !!c.exam && AHEAD.has(c.phase);
  const ms0 = modulesStanding({ modules: plan.modules, pool: [], get: () => ({ state: 'unseen' }) });
  // one next action per module while there are study days left before the exam (not on the eve: reviews only)
  const acts = ahead && c.phase !== 'eve' ? nextActions(plan, ms0, t) : {};
  const weak = ahead ? weakest(ms0) : null;
  /** @type {Record<string, HTMLElement>} */ const itemsEl = {};
  const rows = ms0.map(m => {
    const p = m.score == null ? 0 : m.score / m.max;
    const act = acts[m.id];
    itemsEl[m.id] = h('span', { class: 'caption stand-items' });
    return h('li', { class: ['stand-row', m.id === weak && 'is-weakest'] },
      h('a', { class: 'mbar pressable', href: '#/exam', 'aria-label': m.score == null ? t('today.moduleNone', { name: m.name }) : t('today.moduleScore', { name: m.name, score: m.score, max: m.max, pass: m.pass }) },
        h('span', { class: 'mbar-name' }, m.name),
        h('span', { class: ['track', m.score != null && m.score < m.pass && 'below'], dataset: { p: String(p) } }, h('span', { class: 'fill' }), h('i', { class: 'pass', style: { '--at': `${(m.pass / m.max) * 100}%` } })),
        h('span', { class: ['mbar-val', 'tnum', m.score == null && 'none'] }, m.score == null ? t('today.noScore') : `${m.score}/${m.max}`)),
      h('p', { class: 'stand-meta' }, m.id === weak ? h('b', { class: 'stand-weak' }, t('stand.weakest')) : null, itemsEl[m.id]),
      act ? h('a', { class: 'btn btn-quiet pressable stand-act', href: act.href }, t('stand.next', { what: act.text })) : null);
  });
  const weekEl = h('p', { class: 'caption stand-week', hidden: true });
  const def = h('p', { class: 'caption stand-def' }, t('stand.def'));
  // Today › Progress (L5): the long view from the progress log. A 64 px row: the title, the last 4 weeks' change, a
  // sparkline of known over 12 weeks and the chevron the plan rows use (design review round 4, P1-8)
  const progress = () => h('a', { class: 'stand-progress pressable', href: '#/today/progress' },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('pg.link')),
      spark && spark.gain != null ? h('span', { class: 'row-detail tnum' }, t('stand.progressGain', { d: `${spark.gain >= 0 ? '+' : '−'}${nf.format(Math.abs(spark.gain))}` })) : null),
    spark ? sparkline(spark.pts) : null,
    icon('next', { size: 16 }));
  if (mode === 'open' || course) {
    const wordsEl = h('span', { class: 'tnum' }, '…');
    const sub = ahead ? t('stand.sub', { date: label(/** @type {string} */ (c.exam)) }) : c.phase === 'after' && c.exam ? t('stand.subAfter', { date: label(c.exam) }) : null;
    const sec = section(t('stand.title'),
      sub && mode === 'open' ? h('p', { class: 'caption section-sub' }, sub) : null,
      rows.length && mode === 'open' ? h('ul', { class: 'mbars stand-list' }, rows) : null,
      h('a', { class: 'stand-words pressable', href: course ? '#/practice' : '#/lookup/map' },
        h('span', { class: 'row-title' }, t('stand.words')), h('span', { class: 'row-trail' }, wordsEl)),
      weekEl, def, progress());
    sec.classList.add('today-stand');
    return {
      el: sec,
      /** @param {Awaited<ReturnType<typeof standingCounts>>} n */
      fill(n) {
        if (!n) { wordsEl.textContent = ''; return; }
        fillItems(n);
        wordsEl.textContent = n.words ? t('stand.wordsOf', { k: nf.format(n.words.known), n: nf.format(n.words.n) }) : '';
        if (!ahead && (n.week.learnt || n.week.lapsed)) { weekEl.textContent = t('stand.week', { learnt: n.week.learnt, lapsed: n.week.lapsed }); weekEl.hidden = false; }
      },
    };
  }
  /** @param {any} n */
  function fillItems(n) {
    for (const m of n.ms) {
      const el = itemsEl[m.id]; if (!el) continue;
      el.textContent = m.items.n ? t(`stand.items.${m.id}`, { k: nf.format(m.items.known), n: nf.format(m.items.n) }) : t('stand.items.none');
    }
  }

  // maintenance
  const figure = h('span', { class: 'figure tnum-no' }, '…');
  const ofEl = h('span', { class: 'label' });
  const levelsEl = h('ul', { class: 'stand-levels', 'aria-label': t('stand.byLevel') });
  const keyEl = h('p', { class: 'caption stand-key', hidden: true }, h('i', { class: 'stand-key-swatch', 'aria-hidden': 'true' }), t('stand.gainKey'));
  const goalShare = h('p', { class: 'caption' });
  const goalCard = goal ? h('div', { class: 'stand-goal' },
    h('p', { class: 'label' }, goal.month ? t('stand.goalBy', { level: goal.level, month: goal.month }) : t('stand.goal', { level: goal.level })),
    goalShare,
    h('p', { class: 'caption' }, t('stand.goalNoEstimate'))) : null;
  /** @type {HTMLElement | null} */ let mocks = null;
  if (mode === 'folded' && rows.length) {
    const panel = h('div', { class: 'reveal-answer stand-mocks-panel', id: 'stand-mocks' }, h('div', null, h('ul', { class: 'mbars stand-list' }, rows)));
    panel.inert = true;
    const btn = h('button', { type: 'button', class: 'stand-mocks-btn pressable', 'aria-expanded': 'false', 'aria-controls': 'stand-mocks',
      onclick: () => disclose(btn, panel, btn.getAttribute('aria-expanded') !== 'true') },
    h('span', { class: 'row-title' }, t('stand.mocks', { exam: examName })), icon('next', { size: 16 }));
    mocks = h('div', { class: 'stand-mocks' }, btn, panel);
  }
  const sec = section(t('stand.title'),
    h('a', { class: 'stand-figure pressable', href: '#/lookup/map' }, figure, ofEl),
    weekEl,
    progress(),
    levelsEl, keyEl,
    goalCard,
    mocks,
    def);
  sec.classList.add('today-stand', 'is-calm');
  return {
    el: sec,
    /** @param {Awaited<ReturnType<typeof standingCounts>>} n */
    fill(n) {
      if (!n) { figure.textContent = ''; return; }
      fillItems(n);
      if (n.words) { figure.textContent = nf.format(n.words.known); ofEl.textContent = t('stand.knownOf', { n: nf.format(n.words.n) }); } else figure.textContent = '';
      if (n.week.learnt || n.week.lapsed) { weekEl.textContent = t('stand.week', { learnt: n.week.learnt, lapsed: n.week.lapsed }); weekEl.hidden = false; }
      const levels = n.levels || [];
      // nothing known yet: one sentence instead of six empty tracks
      const none = levels.length > 0 && levels.every(x => !x.k);
      if (none && levelsEl.isConnected) levelsEl.replaceWith(h('p', { class: 'caption stand-none' }, t('stand.noneKnown')));
      let gained = false;
      levelsEl.replaceChildren(...(none ? [] : levels).map(x => {
        const gain = x.was != null && x.k > x.was ? x.k - x.was : 0;
        if (gain) gained = true;
        const base = (x.k - gain) / x.n, add = gain / x.n;
        return h('li', { class: 'stand-level', 'aria-label': gain ? t('stand.levelGain', { level: x.level, k: nf.format(x.k), n: nf.format(x.n), d: nf.format(gain) }) : t('stand.levelAria', { level: x.level, k: nf.format(x.k), n: nf.format(x.n) }) },
          h('span', { class: 'stand-level-name', 'aria-hidden': 'true' }, x.level),
          h('span', { class: 'track lv-track', 'aria-hidden': 'true' },
            h('span', { class: 'fill lv-known', dataset: { p: String(base) } }),
            gain ? h('span', { class: 'lv-gain', style: { insetInlineStart: `${base * 100}%`, width: `${add * 100}%` } }) : null),
          h('span', { class: 'caption tnum', 'aria-hidden': 'true' }, t('stand.level', { k: nf.format(x.k), n: nf.format(x.n) })));
      }));
      keyEl.hidden = !gained;
      for (const f of levelsEl.querySelectorAll('.lv-known')) fillTo(/** @type {HTMLElement} */ (f), Number(/** @type {HTMLElement} */ (f).dataset.p));
      if (goal) {
        const x = levels.find(l => l.level === goal.level);
        goalShare.textContent = x ? t('stand.goalShare', { p: Math.round((x.k / x.n) * 100), level: goal.level, k: nf.format(x.k), n: nf.format(x.n) }) : '';
      }
    },
  };
}
