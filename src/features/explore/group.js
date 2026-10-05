/* The group page (#/lookup/map/<type>/<id>): one page for a group of the map and for a Practice word cluster, the
   place to decide what to study in it. The map is where groups are browsed; its group sheet and List open this page,
   and the page goes back to the map on that group ("On the map"). Practice › Word clusters opens it too (its old
   address, #/practice/clusters/<type>/<id>, comes here).
     <type>   a map mode (topic, family, opp, level, type, source) or a cluster type (family, opp, prefix, suffix,
              topic, prep); the key is '<type>:<id>', the map group's and the cluster's key alike
   It shows the group's words, known of all (the map group's items: words, phrases or concepts; a cluster that is not
   on the map counts its words), the four states as a bar, the words as they are known (a cluster's own layout: a
   family's tree, opposite pairs, a block of type), its phrases, "Study next", and the actions:
     a cluster:   its typed round (#/practice/round?kind=cluster:<key>, with the round size picker), Say them aloud
     otherwise:   a round of the words to study next (kind=cluster:pick), of the phrases or of the concepts (kind=pick:)
     both:        Mark what you know (Quick sort, #/practice/sort), On the map
   Rounds carry from=map/<type>/<id>, so End and Done come back here. Motion: a disc from the map grows into the
   header (core/motion.js receive, inside the route's view transition); the known count ticks up from the last one
   shown (kv 'explore'.pageShown). Reduced motion gets the final state at once. */
import { h, replace } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { countTo, receive } from '../../core/motion.js';
import { num } from '../../core/i18n.js';
import { langAttr } from '../../core/lang.js';
import { MODES, summarise, nextUp } from '../../domain/atlas.js';
import { TYPES } from '../../domain/clusters.js';
import { roundMinutes } from '../../domain/today.js';
import { isDue } from '../../domain/b1ready.js';
import { skipsNew } from '../../domain/known.js';
import { marked } from '../../data/known.js';
import { loadAtlas, layoutOf, scores, loadDetails, prefs, setPrefs } from '../../data/atlas.js';
import { ensurePlacement } from '../shared/data.js';
import { loadClusters, recallOf, update as updateClusters, DECK } from '../shared/cluster-data.js';
import { cardIds, compose, zipfOf } from '../shared/cluster-items.js';
import { clusterLayout } from '../shared/cluster-layout.js';
import { pickerLinks } from '../shared/picker.js';
import { CODE_STATE, STATES, groupName, mapHref, fromPage, askable } from './groups.js';

const STUDY_N = 10;
/** Most items the block of type shows (a level group has over a thousand; the map shows them all). */
const BLOCK_MAX = 300;
const DE_TYPES = new Set(['family', 'prefix', 'suffix']);

/**
 * @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {string} type @param {string} id
 */
export async function mountGroup(el, ctx, type, id) {
  const { t, store } = ctx;
  const key = `${type}:${id}`;
  let alive = true;
  /** @type {(() => void)[]} */ const offs = [];
  const cleanup = () => { alive = false; offs.forEach(f => f()); };
  const onMap = MODES.includes(/** @type {any} */ (type));
  const isCluster = TYPES.includes(/** @type {any} */ (type));
  const backLink = (/** @type {string} */ href, /** @type {string} */ text) => h('a', { class: 'pr-backlink pressable', href }, icon('prev', { size: 16 }), text);
  const back0 = onMap ? backLink(mapHref(key), t('explore.title')) : backLink(`#/practice/clusters/${type}`, t('practice.clusters.title'));
  replace(el, h('div', { class: 'practice cl cl-page gp stack' }, back0, h('h1', null, id), h('p', { class: 'caption', role: 'status' }, t('explore.loading'))));

  /* ---------- data ---------- */
  /** @type {any} */ let A;   // loadAtlas()
  /** @type {any} */ let K;   // scores()
  /** @type {any} */ let CL = null;   // loadClusters()
  /** @type {any} */ let D = null;    // loadDetails()
  try {
    await ensurePlacement(ctx);
    [A, CL] = await Promise.all([loadAtlas(ctx), isCluster ? loadClusters(ctx).catch(() => null) : null]);
    K = await scores(ctx, A);
    D = await loadDetails(ctx, K.k.maps).catch(() => null);
  } catch (e) {
    console.error(e);
    if (alive) replace(el, h('div', { class: 'practice cl gp stack' }, back0, h('h1', null, id), h('p', null, t('explore.loadFailed'))));
    return cleanup;
  }
  if (!alive) return cleanup;
  const g = onMap ? layoutOf(A, type, K).groups.find((/** @type {any} */ x) => x.key === key) || null : null;
  /** @type {any} */ const cl = CL ? CL.ix.byKey.get(key) || null : null;
  if (!g && !cl) {
    replace(el, h('div', { class: 'practice cl gp stack' }, back0, h('h1', null, t('explore.page.notFound')), h('a', { class: 'btn pressable', href: '#/lookup/map' }, t('explore.page.toMap'))));
    return cleanup;
  }
  // a cluster that is also a map group goes back to the map; one that is not (a prefix, an ending) to Word clusters
  const back = g ? backLink(mapHref(key), t('explore.title')) : back0;

  /* ---------- the items and their states ---------- */
  const ids = g ? g.items.map((/** @type {number} */ i) => A.ids[i]) : (cl.items || []).map((/** @type {string} */ w) => `W:${w}`);
  /** @param {string} x @returns {{state: any, today: boolean}} */
  const stateOf = x => {
    const i = A.index.get(x);
    if (i != null) return { state: CODE_STATE[K.st[i]], today: !!K.today[i] };
    const s = K.k.get(x); return { state: s.state, today: !!s.today };
  };
  const weight = (/** @type {string} */ x) => { const i = A.index.get(x); return i != null ? A.F[i] || 1 : (CL?.ix.word(x.slice(2))?.zipf || 1); };
  const textOf = (/** @type {string} */ x) => { const i = A.index.get(x); return i != null ? A.text[i] : (CL?.ix.word(x.slice(2))?.w || x.slice(2)); };
  const cn = summarise(ids, stateOf, weight);
  const words = ids.filter((/** @type {string} */ x) => x.startsWith('W:'));
  const phrases = ids.filter((/** @type {string} */ x) => x.startsWith('K:'));
  const concepts = ids.filter((/** @type {string} */ x) => x.startsWith('GC:'));
  const pool = words.length ? words : phrases.length ? phrases : ids;
  const next = nextUp(pool, stateOf, weight, STUDY_N);
  const name = g ? groupName(t, g) : cl.label;
  const lang = DE_TYPES.has(type) ? langAttr() : null;
  const from = fromPage(key);

  /* ---------- header: the disc from the map lands here ---------- */
  const shown = (prefs(store).pageShown || {})[key];
  const countEl = h('span', { class: 'figure tnum' }, num(shown ?? cn.known));
  const stack = h('div', { class: 'ex-stack', 'aria-hidden': 'true' }, ...STATES.map(s => (cn[s] ? h('span', { class: `is-${s}`, style: { flexGrow: String(cn[s]) } }) : null)));
  const swatch = (/** @type {string} */ s) => h('i', { class: `ex-sw is-${s}`, 'aria-hidden': 'true' });
  const head = h('header', { class: 'gp-head' },
    h('p', { class: 'label cl-eyebrow' }, onMap ? t(`explore.mode.${type}`) : t(`practice.clusters.types.${type}`)),
    h('h1', { lang }, name),
    h('p', { class: 'cl-count' }, countEl, h('span', { class: 'label' }, t('explore.page.knownOf', { n: num(cn.n) }))),
    stack,
    h('p', { class: 'ex-counts caption tnum' }, ...STATES.map(s => h('span', null, swatch(s), t(`explore.sheet.${s}`, { n: num(cn[s]) })))));

  /* ---------- the words as they are known ---------- */
  /** @type {any[]} */ const body = [];
  /** @type {HTMLElement | null} */ let lead = null;
  if (cl && CL) {
    const lay = clusterLayout(cl, CL.ix, CL.c, K.k, t);
    lay.place(K.k);
    lead = cl.type === 'family' && cl.note ? h('p', { class: 'lead' }, t('practice.clusters.familyLead', { note: cl.note }))
      : cl.note ? h('p', { class: 'lead cl-note' }, cl.note) : null;
    body.push(legend(), lay.el);
    // a map group is more than its cluster's words: its phrases (Topic) as a list
    const extra = g ? ids.filter((/** @type {string} */ x) => !x.startsWith('W:') || !cl.items.includes(x.slice(2))) : [];
    if (extra.length) body.push(h('section', { class: 'gp-sec' }, h('h2', { class: 'label' }, t('explore.page.phrases', { n: num(extra.length) })), itemList(extra)));
  } else {
    const shownIds = ids.slice(0, BLOCK_MAX);
    body.push(legend(), h('p', { class: 'cl-block gp-block' }, ...shownIds.flatMap((/** @type {string} */ x, /** @type {number} */ k) => [k ? ' ' : null, chip(x)])));
    if (ids.length > shownIds.length) body.push(h('p', { class: 'caption' }, t('explore.page.more', { k: num(shownIds.length), n: num(ids.length) })));
  }

  // what to study next comes first, above the group's words
  if (next.length) {
    body.unshift(h('section', { class: 'gp-sec' }, h('h2', { class: 'label' }, t('explore.sheet.next')),
      h('ul', { class: 'ex-next', lang: langAttr() }, ...next.map(x => {
        const s = stateOf(x), k = s.today ? 'today' : s.state;
        return h('li', null, h('a', { class: 'ex-next-item pressable', href: `#/lookup/map?mode=${encodeURIComponent(onMap ? type : 'topic')}&at=${encodeURIComponent(x)}` },
          swatch(k), h('span', { class: 'ex-w' }, wordOf(x)), h('span', { class: 'sr-only', lang: 'en' }, `, ${t(`explore.state.${k}`)}`)));
      }))));
  } else body.unshift(h('p', { class: 'ex-allknown' }, t('explore.sheet.allKnown')));

  /* ---------- actions ---------- */
  /** @type {HTMLElement | null} */ let primary = null, say = null;
  if (cl && CL) {
    const c = ctx.clock.ctx(), mk = marked(store);
    const plan = compose({ ids: cardIds(cl, CL.ix), cards: store.cards(DECK) || {}, c, isDue: rec => isDue(rec, c.today, /** @type {any} */ (c)), recall: recallOf(c), skip: x => skipsNew(mk, x), zipf: zipfOf(CL.ix) });
    const n = plan.ids.length;
    if (n) {
      primary = h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=${encodeURIComponent(`cluster:${key}`)}&from=${encodeURIComponent(from)}` },
        plan.extra ? t('practice.clusters.ahead', { n }) : t('practice.clusters.typed', { n, min: roundMinutes(n) }));
      say = h('a', { class: 'btn pressable', href: `#/practice/clusters/${type}/${encodeURIComponent(id)}/say` }, t('practice.clusters.say'));
    }
  }
  if (!primary && next.length) {
    if (pool === words) {
      const studyIds = next.filter(x => askable(textOf(x))).map(x => x.slice(2));
      if (studyIds.length) primary = h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=cluster%3Apick&ids=${encodeURIComponent(studyIds.join(','))}&from=${encodeURIComponent(from)}` }, t('explore.sheet.study', { n: studyIds.length }));
    } else if (D && pool === phrases) {
      const qs = nextUp(phrases.filter((/** @type {string} */ x) => D.roundId(x)), stateOf, weight, STUDY_N).map(x => D.roundId(x));
      if (qs.length) primary = h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=${encodeURIComponent(`pick:${qs.join(',')}`)}&from=${encodeURIComponent(from)}` }, t('explore.sheet.studyPhrases', { n: qs.length }));
      else body.push(h('p', { class: 'caption ex-note' }, t('explore.sheet.phrasesNotInRounds')));
    } else if (D && concepts.length) {
      const cids = next.map(x => x.slice(3)), gids = grammarIds(cids);
      const nC = new Set(gids.map(x => cids.find(cid => (K.k.maps.concepts[cid] || []).includes(x)))).size;
      if (gids.length) primary = h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=${encodeURIComponent(`pick:${gids.join(',')}`)}&from=${encodeURIComponent(from)}` }, t('explore.sheet.studyGrammar', { n: nC }));
    }
  }
  if (!ctx.clock.ctx().newItems && next.length && next.every(x => stateOf(x).state === 'unseen')) body.push(h('p', { class: 'caption ex-note' }, t('explore.sheet.noNew')));
  const sortIds = words.filter((/** @type {string} */ x) => stateOf(x).state !== 'known' && askable(textOf(x))).map((/** @type {string} */ x) => x.slice(2));
  const sortHref = cl ? `#/practice/sort?cluster=${encodeURIComponent(key)}&from=${encodeURIComponent(from)}`
    : `#/practice/sort?ids=${encodeURIComponent(sortIds.join(','))}&title=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`;
  const links = h('p', { class: 'cl-links' },
    sortIds.length > 1 ? h('a', { class: 'btn btn-quiet pressable cl-map', href: sortHref }, t('explore.page.sort', { n: sortIds.length })) : null,
    g ? h('a', { class: 'btn btn-quiet pressable cl-map', href: mapHref(key) }, icon('next', { size: 16 }), t('explore.page.onMap')) : null);

  const view = h('div', { class: ['practice', 'cl', 'cl-page', 'gp', 'stack', primary && 'has-dock'] }, back, head, lead, ...body, links,
    primary ? h('div', { class: 'cl-dock pr-queue-btn' }, primary, say) : null);
  replace(el, view);
  receive(head, 'fx-disc');
  offs.push(pickerLinks(ctx, el));
  setPrefs(store, s => ({ ...s, pageShown: { ...(s.pageShown || {}), [key]: cn.known } }));
  // the cluster studied last feeds Today's cluster row (practice-clusters/plan.js)
  if (cl) updateClusters(store, s => ({ ...s, last: key }));
  if (shown != null && shown !== cn.known) countTo(countEl, cn.known, /** @type {any} */ ({ from: shown, duration: 700, format: (/** @type {number} */ x) => num(Math.round(x)) }));
  return cleanup;

  /* ---------- helpers ---------- */
  function legend() {
    return h('p', { class: 'caption cl-legend' }, ...['known', 'shaky', 'unknown', 'unseen'].flatMap((s, k) => [k ? ' ' : null, h('span', { class: `cl-w is-${s}` }, t(`practice.clusters.legend.${s}`))]));
  }
  /** An item as written, the noun's article lighter. @param {string} x */
  function wordOf(x) {
    const i = A.index.get(x);
    if (i == null) return textOf(x);
    return [A.art[i] ? h('span', { class: 'cl-art' }, `${A.art[i]} `) : null, A.text[i]];
  }
  /** An item as type in its state (the cluster page's encoding). @param {string} x */
  function chip(x) {
    const s = stateOf(x);
    return h('span', { class: ['cl-w', `is-${s.state}`, s.today && 'is-today'], lang: langAttr() }, wordOf(x));
  }
  /** Items as a list with their state square (DESIGN.md › Explore, Lists). @param {string[]} xs */
  function itemList(xs) {
    return h('ul', { class: 'ex-next gp-list', lang: langAttr() }, ...xs.slice(0, BLOCK_MAX).map(x => {
      const s = stateOf(x), k = s.today ? 'today' : s.state;
      return h('li', null, h('a', { class: 'ex-next-item pressable', href: `#/lookup/map?mode=${encodeURIComponent(onMap ? type : 'topic')}&at=${encodeURIComponent(x)}` },
        swatch(k), h('span', { class: 'ex-w' }, wordOf(x)), h('span', { class: 'sr-only', lang: 'en' }, `, ${t(`explore.state.${k}`)}`)));
    }));
  }
  /** The B1 grammar items of concepts that a round can ask, least known first, at most two a concept. @param {string[]} cids */
  function grammarIds(cids) {
    /** @type {string[]} */ const out = [];
    for (const cid of cids) {
      const items = (K.k.maps.concepts[cid] || []).filter((/** @type {string} */ x) => D.roundId(x));
      items.sort((/** @type {string} */ a, /** @type {string} */ b) => (K.k.get(a).recall || 0) - (K.k.get(b).recall || 0));
      out.push(...items.slice(0, 2));
      if (out.length >= 12) break;
    }
    return out.slice(0, 12);
  }
}
