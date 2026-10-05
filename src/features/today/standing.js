/* Today › Where you stand (docs/ARCHITECTURE.md › Where you stand): per exam module the latest mock score against its
   pass line, the module's practice items known and one next action; then words and phrases known, the same count as
   the map's (data/atlas.js totals over the same knowledge score). Without an exam ahead the module actions
   go and "This week" says what was learnt and what lapsed.

   The section draws at once from the composed plan (the module scores come with it); the counts that need content
   (the pool, the knowledge score, the map) fill in when they are loaded. */
import { h } from '../../core/dom.js';
import { section } from '../../core/ui.js';
import { label, diff } from '../../core/clock.js';
import { modulesStanding, weakest, week, knownOf } from '../../domain/standing.js';
import { loadKnowledge, DECKS } from '../../data/knowledge.js';

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
    const [{ loadData }, ex] = await Promise.all([import('../shared/data.js'), import('../../data/atlas.js')]);
    const [data, k, A] = await Promise.all([loadData(ctx), loadKnowledge(ctx), ex.loadAtlas(ctx).catch(() => null)]);
    const get = (/** @type {string} */ id) => k.get(k.maps.resolve(id, 'b1') || id);
    const ms = modulesStanding({ modules, pool: data.pool, get });
    const words = A ? ex.totals(A, await ex.scores(ctx, A)) : null;
    const c = ctx.clock.ctx();
    const decks = Object.fromEntries(DECKS.map(d => [d, ctx.store.cards(d) || {}]));
    return { ms, words, week: week(decks, c.today, diff), known: knownOf };
  } catch { return null; }
}

/**
 * The section. Returns the element and a fill(counts) for the counts that come later.
 * @param {{plan: any, c: any, t: (k: string, v?: any) => string}} o
 */
export function renderStanding({ plan, c, t }) {
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
  const wordsEl = h('span', { class: 'tnum' }, '…');
  const weekEl = h('p', { class: 'caption stand-week', hidden: true });
  const sub = ahead ? t('stand.sub', { date: label(/** @type {string} */ (c.exam)) }) : c.phase === 'after' && c.exam ? t('stand.subAfter', { date: label(c.exam) }) : null;
  const sec = section(t('stand.title'),
    sub ? h('p', { class: 'caption section-sub' }, sub) : null,
    rows.length ? h('ul', { class: 'mbars stand-list' }, rows) : null,
    h('a', { class: 'stand-words pressable', href: '#/lookup/map' },
      h('span', { class: 'row-title' }, t('stand.words')), h('span', { class: 'row-trail' }, wordsEl)),
    weekEl,
    h('p', { class: 'caption stand-def' }, t('stand.def')));
  sec.classList.add('today-stand');
  return {
    el: sec,
    /** @param {Awaited<ReturnType<typeof standingCounts>>} n */
    fill(n) {
      if (!n) { wordsEl.textContent = ''; return; }
      for (const m of n.ms) {
        const el = itemsEl[m.id]; if (!el) continue;
        el.textContent = m.items.n ? t(`stand.items.${m.id}`, { k: nf.format(m.items.known), n: nf.format(m.items.n) }) : t('stand.items.none');
      }
      wordsEl.textContent = n.words ? t('stand.wordsOf', { k: nf.format(n.words.known), n: nf.format(n.words.n) }) : '';
      if (!ahead && (n.week.learnt || n.week.lapsed)) { weekEl.textContent = t('stand.week', { learnt: n.week.learnt, lapsed: n.week.lapsed }); weekEl.hidden = false; }
    },
  };
}
