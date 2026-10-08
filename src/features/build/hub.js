/* Word building hub (#/practice/build): four rows in the order he learns in (Prefixes, Verbs, Sentences, Suffixes),
   each with known of total and a field strip of its items, the 60-second game, the deck's daily new cap, and one
   Review button (due and new, all card types, the normal way in). Knowledge comes from the one knowledge score
   (data/knowledge.js): a verb he learnt in a word cluster counts here (PD/PV → W:<lemma>). */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { Field } from '../../core/brand.js';
import { countTo } from '../../core/motion.js';
import { cardIds, conceptItems, CORE } from '../../domain/wordbuild.js';
import { FRAME_GATE, SUFFIX_GATE, REST_GATE, firstGood } from '../../domain/wordbuild-plan.js';
import { dayAllowance } from '../../domain/allowance.js';
import { backLink } from './compass.js';
import { loadContent, knowledge, today as todayOf } from './data.js';
import { writeStats } from './plan.js';
import { familiesOf, todayBoard, ensureFamilies } from './family-data.js';
import { foundCount } from '../../domain/wordbuild-family.js';
import { langAttr, dirAttr } from '../../core/lang.js';

const CELL = /** @type {Record<string, number>} */ ({ known: 2, shaky: 1, unknown: 1, unseen: 0 });

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mountHub(el, ctx) {
  const { t, store } = ctx;
  let alive = true;
  /** @type {Field[]} */ let fields = [];
  replace(el, h('div', { class: 'wb stack' }, backLink('#/practice', t('practice.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.title'))), h('p', { class: 'caption' }, t('build.loading'))));
  /** @type {any} */
  let d;
  /** @type {any} */
  let k;
  try { [d, k] = await Promise.all([loadContent(ctx).then(x => ensureFamilies(ctx, x)), knowledge(ctx).catch(() => null)]); } catch {
    replace(el, h('div', { class: 'wb stack' }, backLink('#/practice', t('practice.title')), h('div', { class: 'page-head' }, h('h1', null, t('build.title'))), h('p', null, t('build.loadFailed'))));
    return () => {};
  }
  if (!alive) return () => {};

  function draw() {
    fields.forEach(f => f.destroy()); fields = [];
    const st = todayOf(ctx, d, k);
    writeStats(store, st);
    const ids = cardIds(d.c);
    const get = (/** @type {string} */ id) => (k ? k.get(/** @type {string} */ (d.resolve(id))) : { state: 'unseen' });
    // the items of each row: prefix concepts, verbs (as items), sentence cards, suffix and word cards
    const pre = d.c.prefixes.map((/** @type {any} */ p) => k ? k.concept(`PC:${p.id}`, conceptItems(d.c, p.id, d.resolve)) : { state: 'unseen' });
    const verbs = d.c.verbs.map((/** @type {any} */ v) => get(`PD:${v.id}`));
    const sent = ids.filter(id => id.startsWith('PS:')).map(get);
    const suf = ids.filter(id => /^(SX|PW):/.test(id)).map(get);
    const seenVerbs = d.c.verbs.filter((/** @type {any} */ v) => st.cards[`PD:${v.id}`]?.reps).length;
    const coreGood = CORE.filter(p => firstGood(st.cards[`PX:${p}.see`])).length;
    const row = (/** @type {string} */ href, /** @type {string} */ title, /** @type {any[]} */ items, /** @type {string} */ detail, /** @type {string} */ open) => {
      const known = items.filter(s => s.state === 'known').length;
      const canvas = h('canvas', { class: 'field wb-strip' });
      const a = h('a', { class: 'wb-hrow pressable', href, 'aria-label': `${title}: ${t('build.hub.known', { n: known, total: items.length })}. ${detail}` },
        h('span', { class: 'wb-hrow-top' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-trail tnum' }, t('build.hub.known', { n: known, total: items.length })), icon('next', { size: 16 })),
        canvas, h('span', { class: 'row-detail' }, detail), open ? h('span', { class: 'row-detail wb-open' }, open) : null);
      requestAnimationFrame(() => { if (alive) fields.push(new Field(/** @type {HTMLCanvasElement} */ (canvas), items.map(s => CELL[s.state] ?? 0), { cell: 6, gap: 2, label: null })); });
      return a;
    };
    const n = (/** @type {string[]} */ l) => l.length;
    const rows = h('nav', { class: 'wb-hrows', 'aria-label': t('build.hub.rows') },
      row('#/practice/build/prefixes', t('build.prefixes'), pre, t('build.hub.prefixes'), n(st.open.px) ? t('build.hub.open', { n: n(st.open.px) }) : ''),
      row('#/practice/build/table', t('build.verbs'), verbs, t('build.hub.verbs'), coreGood ? (n(st.open.verbs) ? t('build.hub.open', { n: n(st.open.verbs) }) : '') : t('build.hub.verbsLock')),
      row('#/practice/build/machine', t('build.sentences'), sent, t('build.hub.sentences'), n(st.open.ps) ? t('build.hub.open', { n: n(st.open.ps) }) : t('build.hub.sentencesLock', { n: FRAME_GATE })),
      row('#/practice/build/suffixes', t('build.suffixes'), suf, t('build.hub.suffixes'), seenVerbs >= SUFFIX_GATE ? (n(st.open.sx) ? t('build.hub.open', { n: n(st.open.sx) }) : '') : t('build.hub.suffixesLock', { n: SUFFIX_GATE - seenVerbs })));
    // the share itself is set in Profile › Practice (one allowance, one place to change it)
    const capRow = h('div', { class: 'wb-field' },
      h('p', { class: 'caption' }, st.budget.paused || !st.c.newItems ? t('build.hub.capPaused') : t('build.hub.capNote', { n: dayAllowance({ store, c: st.c, settings: ctx.settings() }).newPerDay, left: st.budget.newLeft })),
      h('a', { class: 'btn btn-quiet pressable', href: '#/profile/practice' }, t('build.hub.capChange')));
    const b = st.budget;
    const what = b.due && b.newLeft ? t('build.hub.dueNew', { due: b.due, n: b.newLeft }) : b.due ? t('build.hub.due', { n: b.due }) : b.newLeft ? t('build.hub.new', { n: b.newLeft }) : '';
    const start = b.n ? h('a', { class: 'btn btn-primary btn-wide pressable', href: '#/practice/build/round?kind=review' }, t('build.hub.review', { what, min: b.minutes })) : null;
    const dueEl = h('b', { class: 'tnum' }, '0');
    // round 7: Today's family at the top (the day's root, how much of it he knows, play and see)
    const fday = todayBoard(ctx, d, familiesOf(d), k);
    const fdone = fday ? fday.cards.every(id => (fday.done || {})[id]) : false;
    const famTop = fday ? h('section', { class: 'wb-famtop', 'aria-labelledby': 'wb-famtop-h' },
      h('p', { class: 'label', id: 'wb-famtop-h' }, t('build.hub.familyTitle')),
      h('p', { class: 'wb-famtop-root' }, h('span', { lang: langAttr(), dir: dirAttr() }, fday.root),
        h('span', { class: 'caption tnum' }, fdone || Object.keys(fday.done || {}).length ? t('build.hub.familyDone', { n: foundCount(fday, fday.done || {}), total: fday.cards.length }) : fday.stats ? t('build.hub.familyKnown', { k: fday.stats.known, n: fday.stats.n }) : '')),
      h('div', { class: 'wb-famtop-acts' },
        fdone ? null : h('a', { class: 'btn btn-primary pressable', href: '#/practice/build/today' }, t('build.hub.familyPlay')),
        h('a', { class: ['btn', 'pressable', fdone && 'btn-primary'], href: `#/practice/build/family/${encodeURIComponent(fday.root)}` }, t('build.hub.familySee'))))
      : h('section', { class: 'wb-famtop' }, h('a', { class: 'btn pressable', href: '#/practice/build/family' }, t('build.hub.families')));
    const gameRow = h('a', { class: 'wb-hrow pressable wb-gamerow', href: '#/practice/build/game' },
      h('span', { class: 'wb-hrow-top' }, h('span', { class: 'row-title' }, t('build.game.title')), icon('next', { size: 16 })), h('span', { class: 'row-detail' }, t('build.hub.game')));
    replace(el, h('div', { class: ['wb', 'stack', start && 'has-dock'] },
      backLink('#/practice', t('practice.title')),
      h('div', { class: 'page-head' }, h('h1', null, t('build.title'))),
      famTop,
      h('p', { class: 'wb-lead' }, t('build.hub.lead')),
      h('p', { class: 'wb-hub-count' }, dueEl, ' ', b.n ? t('build.hub.today', { due: b.due, n: b.newLeft }) : t('build.hub.none')),
      rows,
      gameRow,
      h('section', { class: 'section' }, capRow),
      start ? h('div', { class: 'dock' }, start) : null));
    countTo(dueEl, b.n, { from: 0, duration: 600 });
  }
  draw();
  const off = ctx.bus.on('settings:changed', () => { if (alive) draw(); });
  return () => { alive = false; fields.forEach(f => f.destroy()); if (typeof off === 'function') off(); };
}
