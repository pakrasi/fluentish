/* Explore (Look up › Map, #/lookup/map): a map of every German word, phrase and grammar concept in the content, set as
   type, grouped by a chosen mode, inked by what the learner knows (DESIGN.md, Explore).
     #/lookup/map[?mode=topic|family|opp|level|type|source][&view=list][&at=<item id>]
   Positions come from content/atlas (built at build time) and never move as he learns. Tapping a word opens its card,
   with links to its opposite and its family that fly there; tapping a group opens its sheet, whose "Study" button
   starts a cluster round in Practice (#/practice/round?kind=cluster:…). The List view is the accessible alternative.
   Explore never writes a card; its own kv 'explore' keeps the mode, the gaps filter and what it already showed. */
import { h, replace, announce } from '../../core/dom.js';
import { seg } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { reduced } from '../../core/motion.js';
import { label as dayLabel } from '../../core/clock.js';
import { num } from '../../core/i18n.js';
import { MODES, summarise, nextUp, encode } from '../../domain/atlas.js';
import { loadAtlas, layoutOf, scores, loadDetails, prefs, setPrefs, fold, find } from './data.js';
import { createMap } from './map.js';

const STATES = /** @type {const} */ (['known', 'shaky', 'unknown', 'unseen']);
const CODE_STATE = ['unseen', 'unknown', 'shaky', 'known'];

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  const { t, store } = ctx;
  /** @type {(() => void)[]} */ const offs = [() => document.body.classList.remove('ex-page')];
  document.body.classList.add('ex-page');
  try { return await mountMap(el, ctx, offs); } catch (e) { offs.forEach(f => f()); throw e; }
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {(() => void)[]} offs */
async function mountMap(el, ctx, offs) {
  const { t, store } = ctx;
  let alive = true;
  const cleanup = () => { alive = false; offs.forEach(f => f()); };

  const h1 = h('h1', { class: 'ex-title' }, t('explore.title'));
  const status = h('p', { class: 'ex-status caption', 'aria-live': 'polite' }, t('explore.loading'));
  replace(el, h('div', { class: 'explore is-loading' }, h('div', { class: 'ex-head' }, backLink(t), h1), status));

  let A, K;
  try {
    [A] = await Promise.all([loadAtlas(ctx), loadFonts()]);
    K = await scores(ctx, A);
  } catch (e) {
    console.error(e);
    if (!alive) return cleanup;
    replace(status, t('explore.loadFailed'), ' ', h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => ctx.go('/lookup/map', { replace: true }) }, t('explore.retry')));
    return cleanup;
  }
  if (!alive) return cleanup;

  const pf = prefs(store);
  const q = ctx.query;
  /** @type {string} */ let mode = MODES.includes(/** @type {any} */ (q.get('mode'))) ? /** @type {string} */ (q.get('mode')) : MODES.includes(pf.mode) ? pf.mode : 'topic';
  let listOn = q.get('view') === 'list';
  let gaps = !!pf.gaps;
  const c = ctx.clock.ctx();

  /* ---------- layouts and group numbers ---------- */
  /** @type {Map<string, any>} */ const layouts = new Map();
  const layout = (/** @type {string} */ m) => { let l = layouts.get(m); if (!l) { l = layoutOf(A, m, K); layouts.set(m, l); } return l; };
  /** @type {any[]} */ let counts = [];
  let openItem = -1, openGroupIdx = -1;     // what the sheet shows
  const stateOf = (/** @type {string} */ id) => ({ state: /** @type {any} */ (CODE_STATE[K.st[/** @type {number} */ (A.index.get(id))]]), today: !!K.today[/** @type {number} */ (A.index.get(id))] });
  const weight = (/** @type {string} */ id) => A.F[/** @type {number} */ (A.index.get(id))] || 1;
  const idsOf = (/** @type {any} */ g) => g.items.map((/** @type {number} */ i) => A.ids[i]);
  function recount() { counts = layout(mode).groups.map((/** @type {any} */ g) => summarise(idsOf(g), stateOf, weight)); }
  recount();

  /** A group's name. @param {any} g */
  function labelOf(g) {
    const [type, id] = String(g.key).split(/:(.*)/);
    if (g.key === 'topic:grammar') return t('explore.group.grammar');
    if (type === 'type' || type === 'source') return t(`explore.group.${type}.${id}`);
    return g.label;
  }

  /* ---------- the page ---------- */
  const modeChips = h('div', { class: 'ex-modes', role: 'group', 'aria-label': t('explore.modes') },
    MODES.map(m => h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(m === mode), dataset: { mode: m }, onclick: () => (m === mode ? map.fit() : setMode(m)) }, t(`explore.mode.${m}`))));
  const viewSeg = seg({ label: t('explore.view'), value: listOn ? 'list' : 'map', options: [['map', t('explore.view.map')], ['list', t('explore.view.list')]], onChange: v => setView(v === 'list') });
  const findBtn = h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.find'), onclick: () => openSearch() }, icon('lookup', { size: 20 }));
  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ex-canvas', tabindex: '0', role: 'img' }));
  const hereEl = h('div', { class: 'ex-here', hidden: true }, h('b'), h('span', { class: 'tnum' }));
  const totalEl = h('span', { class: 'ex-total caption tnum' });
  const legend = h('div', { class: 'ex-legend', 'aria-label': t('explore.view.map') },
    ...(['known', 'shaky', 'unknown', 'unseen', 'today']).map(s => h('span', { class: `ex-key is-${s}` }, h('i', { lang: 'de', 'aria-hidden': 'true' }, 'Aa'), t(`explore.state.${s}`))));
  const gapsBtn = h('button', { type: 'button', class: 'chip pressable ex-gaps', 'aria-pressed': String(gaps), onclick: () => setGaps(!gaps) }, t('explore.gaps'));
  const zoom = h('div', { class: 'ex-zoom' },
    h('button', { type: 'button', class: 'ex-icon ex-fit pressable', 'aria-label': t('explore.fit'), onclick: () => map.fit() }, glyph('fit')),
    h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.zoomOut'), onclick: () => map.zoomBy(0.5) }, glyph('minus')),
    h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.zoomIn'), onclick: () => map.zoomBy(2) }, glyph('plus')));
  const hud = h('div', { class: 'ex-hud' }, legend, totalEl, h('div', { class: 'ex-ctl' }, gapsBtn, zoom));
  const listEl = h('div', { class: 'ex-list', hidden: true });
  const sheetBody = h('div', { class: 'ex-sheet-body' });
  const sheet = h('section', { class: 'ex-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ex-sheet-title', hidden: true },
    h('div', { class: 'ex-grab', 'aria-hidden': 'true' }),
    h('button', { type: 'button', class: 'ex-icon ex-close pressable', 'aria-label': t('explore.sheet.close'), onclick: () => closeSheet() }, icon('close', { size: 18 })), sheetBody);
  const findInput = /** @type {HTMLInputElement} */ (h('input', { type: 'search', class: 'ex-find-input', lang: 'de', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('explore.find.label'), placeholder: t('explore.find.label') }));
  findInput.setAttribute('autocorrect', 'off'); findInput.setAttribute('autocapitalize', 'off');
  const findList = h('ul', { class: 'ex-find-list', role: 'list' });
  const findEl = h('div', { class: 'ex-find', role: 'dialog', 'aria-label': t('explore.find'), hidden: true },
    h('div', { class: 'ex-find-row' }, findInput, h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.find.close'), onclick: () => closeSearch() }, icon('close', { size: 18 }))), findList);
  const stage = h('div', { class: 'ex-stage' }, canvas, hereEl, hud, listEl);
  const page = h('div', { class: 'explore' },
    h('div', { class: 'ex-head' }, backLink(t), h1, h('div', { class: 'ex-head-tools' }, viewSeg, findBtn)),
    modeChips, stage, findEl);
  replace(el, page);
  // where the map starts on screen, for the desktop card that sits over its top right
  const stageTop = () => document.documentElement.style.setProperty('--ex-stage-top', `${Math.round(stage.getBoundingClientRect().top)}px`);
  const ro = new ResizeObserver(stageTop); ro.observe(stage); stageTop();
  offs.push(() => { ro.disconnect(); document.documentElement.style.removeProperty('--ex-stage-top'); });
  // the sheet lives on the body, above the tab bar (the view is its own stacking context)
  sheet.classList.add('ex-sheet-root');
  document.body.append(sheet);
  offs.push(() => sheet.remove());

  /* ---------- the map ---------- */
  const map = createMap(canvas, {
    A, reduced,
    labelOf,
    countOf: gi => counts[gi] || { n: 0, known: 0, shaky: 0, unknown: 0, unseen: 0 },
    insets: () => ({ top: 8, bottom: hud.offsetHeight + 12 }),
    onWord: i => openWord(i),
    onGroup: (gi, far) => openGroup(gi, far),
    onEmpty: () => closeSheet(),
    onHere: gi => {
      hereEl.hidden = gi < 0 || listOn;
      if (gi < 0) return;
      const g = map.layout.groups[gi], cn = counts[gi];
      /** @type {HTMLElement} */ (hereEl.firstChild).textContent = labelOf(g);
      /** @type {HTMLElement} */ (hereEl.lastChild).textContent = t('explore.known', { k: num(cn.known), n: num(cn.n) });
    },
  });
  offs.push(() => map.destroy());
  // the focus ring shows when the map is reached with the keyboard, not on every tap
  canvas.addEventListener('pointerdown', () => { delete canvas.dataset.kbd; });
  canvas.addEventListener('keyup', e => { if (e.key === 'Tab') canvas.dataset.kbd = '1'; });
  map.setLayout(layout(mode));
  canvas.setAttribute('aria-label', t('explore.canvas', { mode: t(`explore.mode.${mode}`).toLowerCase() }));

  // learned today and not shown yet: these glow on arrival
  const shownToday = () => { const s = prefs(store).shown; return new Set(s && s.day === c.today ? s.ids : []); };
  const newlyLearned = () => { const seen = shownToday(), out = []; for (let i = 0; i < A.n; i++) if (K.today[i] && !seen.has(A.ids[i])) out.push(i); return out; };
  const markShown = (/** @type {number[]} */ idx) => { if (!idx.length) return; const ids = [...shownToday(), ...idx.map(i => A.ids[i])]; setPrefs(store, s => ({ ...s, shown: { day: c.today, ids } })); };
  const fresh = newlyLearned();
  map.setScores(K.st, K.today, fresh);
  markShown(fresh);
  if (fresh.length) announce(t('explore.learned', { n: fresh.length }));
  // a quiet reveal the first time the map opens on a day
  if (prefs(store).introDay !== c.today) { map.intro(); setPrefs(store, s => ({ ...s, introDay: c.today })); }
  if (gaps) map.setGaps(true);
  // the card details (word list, phrases, families) load while the map is being looked at
  const idle = setTimeout(() => { loadDetails(ctx, K.k.maps).catch(() => null); }, 900);
  offs.push(() => clearTimeout(idle));
  renderTotals();
  if (listOn) setView(true, true);
  const at = q.get('at');
  if (at && A.index.has(at)) { const i = A.index.get(at); if (map.has(i)) { map.camera = { x: map.layout.X[i] + A.W[i] / 2, y: map.layout.Y[i], k: 1.2 }; openWord(i, { fly: false }); } }

  /* ---------- live scores ---------- */
  let timer = 0;
  const off = ctx.bus.on('store:changed', (/** @type {any} */ e) => {
    const name = e && e.name;
    if (!name || !(String(name).startsWith('cards:') || name === 'lookup.seen' || name === 'words.exam')) return;
    clearTimeout(timer);
    timer = window.setTimeout(rescore, 400);
  });
  offs.push(() => { clearTimeout(timer); if (typeof off === 'function') off(); });
  async function rescore() {
    if (!alive) return;
    K = await scores(ctx, A);
    if (!alive) return;
    if (mode === 'source') { layouts.delete('source'); map.setLayout(layout('source')); }
    layouts.delete('source');
    recount();
    const nw = newlyLearned();
    map.setScores(K.st, K.today, nw); markShown(nw);
    renderTotals();
    if (listOn) renderList();
    if (openGroupIdx >= 0) openGroup(openGroupIdx, false, { fly: false });
    else if (openItem >= 0) openWord(openItem, { fly: false });
  }

  /* ---------- modes, view, filter ---------- */
  function setMode(/** @type {string} */ m) {
    if (m === mode) return;
    const keep = openItem;
    mode = m;
    closeSheet({ keepSelection: true });
    for (const b of modeChips.querySelectorAll('button')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.mode === m));
    const next = layout(m);
    recount();
    map.setLayout(next, { animate: true, follow: keep >= 0 && !Number.isNaN(next.X[keep]) ? keep : -1 });
    if (keep >= 0 && !Number.isNaN(next.X[keep])) map.select(keep); else map.clear();
    canvas.setAttribute('aria-label', t('explore.canvas', { mode: t(`explore.mode.${m}`).toLowerCase() }));
    setPrefs(store, s => ({ ...s, mode: m }));
    address();
    renderTotals();
    if (listOn) renderList();
    modeChips.querySelector(`[data-mode="${m}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function setView(/** @type {boolean} */ list, initial = false) {
    listOn = list;
    listEl.hidden = !list; canvas.hidden = list; hud.hidden = list; hereEl.hidden = true;
    page.classList.toggle('is-list', list);
    if (list) { closeSheet(); renderList(); } else map.resize();
    if (!initial) address();
  }
  function setGaps(/** @type {boolean} */ on) {
    gaps = on; gapsBtn.setAttribute('aria-pressed', String(on)); map.setGaps(on);
    setPrefs(store, s => ({ ...s, gaps: on }));
  }
  function address() {
    const sp = new URLSearchParams();
    if (mode !== 'topic') sp.set('mode', mode);
    if (listOn) sp.set('view', 'list');
    const s = sp.toString();
    history.replaceState(history.state, '', `#/lookup/map${s ? `?${s}` : ''}`);
  }
  function renderTotals() {
    let k = 0, n = 0;
    for (const cn of counts) { k += cn.known; n += cn.n; }
    totalEl.textContent = t('explore.total', { k: num(k), n: num(n) });
  }

  /* ---------- sheets ---------- */
  const isPhone = () => innerWidth < 720;
  function showSheet() {
    if (sheet.hidden) { sheet.hidden = false; sheet.classList.remove('is-in'); requestAnimationFrame(() => sheet.classList.add('is-in')); }
    sheetBody.scrollTop = 0;
  }
  function closeSheet({ keepSelection = false } = {}) {
    if (!keepSelection) map.clear();
    openItem = -1; openGroupIdx = -1;
    if (sheet.hidden) return;
    sheet.classList.remove('is-in');
    const done = () => { if (!sheet.classList.contains('is-in')) sheet.hidden = true; };
    if (reduced()) done(); else setTimeout(done, 170);
  }
  /** The desktop card's width over the right of the map. */
  const sheetRight = () => (isPhone() || sheet.hidden ? 0 : Math.max(0, stage.getBoundingClientRect().right - sheet.getBoundingClientRect().left + 16));
  /** How much of the stage the open sheet covers (a phone's bottom sheet; the desktop card sits beside the map). */
  const sheetBelow = () => { if (!isPhone() || sheet.hidden) return 0; const s = stage.getBoundingClientRect(), r = sheet.getBoundingClientRect(); return Math.max(0, s.bottom - r.top - 24); };

  /** @param {number} i @param {{fly?: boolean}} [opt] */
  async function openWord(i, { fly = true } = {}) {
    openItem = i; openGroupIdx = -1;
    map.select(i);
    const sc = K.score(i), kind = A.kind[i], id = A.ids[i];
    const L = map.layout, g = L.groups[L.G[i]];
    const enc = encode(/** @type {any} */ (CODE_STATE[K.st[i]]), !!K.today[i]);
    const title = h('h2', { id: 'ex-sheet-title', class: 'ex-word', lang: 'de' }, A.art[i] ? h('span', { class: 'ex-art' }, `${A.art[i]} `) : null, A.text[i]);
    const kindLabel = t(`explore.kind.${kind === 'c' ? 'phrase' : kind === 'g' ? 'grammar' : A.pos[i]}`);
    const meta = h('p', { class: 'ex-meta caption' }, h('span', null, `${kindLabel} · ${A.level[i]}`), g ? h('span', null, labelOf(g)) : null);
    const stateLine = h('p', { class: 'ex-state' },
      h('span', { class: ['ex-state-key', `is-${enc.today ? 'today' : enc.state}`], 'aria-hidden': 'true' }, 'Aa'),
      h('b', null, t(`explore.state.${enc.today ? 'today' : enc.state}`)),
      ' ', sc.state === 'unseen' ? t('explore.card.unseen')
        : [t('explore.card.recall', { p: Math.round((sc.recall || 0) * 100) }), sc.last ? (sc.last === c.today ? t('explore.card.lastToday') : t('explore.card.last', { date: dayLabel(sc.last) })) : null,
          kind === 'g' && sc.n ? t('explore.card.coverage', { seen: sc.seen, n: sc.n }) : null].filter(Boolean).join(', '));
    const from = (sc.sources || []).length ? h('p', { class: 'caption ex-from' }, t('explore.card.from', { list: t.list(sc.sources.map((/** @type {string} */ s) => t(`explore.group.source.${s}`))) })) : null;
    replace(sheetBody, meta, title, h('div', { class: 'ex-card-extra' }), stateLine, from, h('div', { class: 'ex-actions' }));
    showSheet();
    // details: the word list entry or the phrase, links and actions; the camera moves once the sheet has its height
    const D = await loadDetails(ctx, K.k.maps).catch(() => null);
    if (!alive || openItem !== i) return;
    if (!D) { if (fly) map.flyToItem(i, { below: sheetBelow(), right: sheetRight() }); return; }
    const extra = /** @type {HTMLElement} */ (sheetBody.querySelector('.ex-card-extra'));
    const actions = /** @type {HTMLElement} */ (sheetBody.querySelector('.ex-actions'));
    /** @type {any[]} */ const bits = [], links = [], acts = [];
    if (kind === 'w') {
      const wid = id.slice(2), w = D.words.get(wid);
      if (w && w.pl) bits.push(h('p', { class: 'caption', lang: 'de' }, t('explore.card.plural', { pl: w.pl })));
      if (w && w.en?.length) bits.push(h('p', { class: 'ex-en' }, w.en.slice(0, 3).join('; ')));
      if (w && w.ex) bits.push(h('p', { class: 'ex-ex', lang: 'de' }, w.ex), w.exen ? h('p', { class: 'ex-exen caption' }, w.exen) : null);
      const opp = D.ix ? D.ix.opposites(wid) : [];
      if (opp.length) links.push(linkRow(t('explore.card.opposite'), opp));
      const fam = D.famOf.get(wid), f = fam ? D.families.get(fam) : null;
      if (f) links.push(linkRow(t('explore.card.family'), f.members.filter((/** @type {string} */ m) => m !== wid).slice(0, 10)));
      if (!/[…()[\]]/.test(A.text[i])) acts.push(h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=cluster%3Apick&ids=${encodeURIComponent(wid)}&from=map` }, t('explore.card.practise')));
      acts.push(h('a', { class: 'btn pressable', href: `#/lookup/words/${encodeURIComponent(wid)}` }, t('explore.card.lookup')));
    } else if (kind === 'c') {
      const cid = id.slice(2), de = D.chunksDe[cid], en = D.chunksEn.get(cid);
      if (de && de.t !== A.text[i]) bits.push(h('p', { class: 'caption', lang: 'de' }, de.t));
      if (en) bits.push(h('p', { class: 'ex-en' }, en.pragmatic_function || en.chunk || ''));
      if (de && de.ex) bits.push(h('p', { class: 'ex-ex', lang: 'de' }, de.ex));
      acts.push(h('a', { class: 'btn pressable', href: `#/lookup/phrases?q=${encodeURIComponent(A.text[i].replace(/…/g, '').trim().split(/\s+/).slice(0, 3).join(' '))}` }, t('explore.card.lookup')));
    } else {
      const cid = id.slice(3), cc = D.concepts.get(cid), topic = D.topicOfConcept.get(cid);
      if (cc && cc.description) bits.push(h('p', { class: 'ex-en' }, cc.description));
      if (topic) acts.push(h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=topic%3A${encodeURIComponent(topic)}` }, t('explore.card.grammar')));
      acts.push(h('a', { class: 'btn pressable', href: `#/lookup/grammar?q=${encodeURIComponent(A.text[i])}` }, t('explore.card.lookup')));
    }
    replace(extra, ...bits, ...links);
    replace(actions, ...acts);
    if (fly) map.flyToItem(i, { below: sheetBelow(), right: sheetRight() });
  }
  /** @param {string} label @param {string[]} wordIds */
  function linkRow(label, wordIds) {
    const btns = wordIds.map(w => A.index.get(`W:${w}`)).filter(j => j != null).map(j => h('button', { type: 'button', class: 'ex-link pressable', lang: 'de', onclick: () => goTo(/** @type {number} */ (j)) },
      A.art[/** @type {number} */ (j)] ? h('span', { class: 'ex-art' }, `${A.art[/** @type {number} */ (j)]} `) : null, A.text[/** @type {number} */ (j)]));
    return btns.length ? h('div', { class: 'ex-links' }, h('span', { class: 'caption ex-links-label' }, label), ...btns) : null;
  }
  /** Fly to an item (switching to Topic when this mode does not show it) and open its card. @param {number} i */
  function goTo(i) {
    if (listOn) setView(false);
    if (!map.has(i)) setMode('topic');
    openWord(i, { fly: false });
    map.flyToItem(i, { k: Math.max(map.camera.k, 1.1), below: sheetBelow(), right: sheetRight() });
  }

  /** @param {number} gi @param {boolean} far @param {{fly?: boolean}} [opt] */
  function openGroup(gi, far, { fly = true } = {}) {
    openGroupIdx = gi; openItem = -1;
    map.selectGroup(gi);
    const L = map.layout, g = L.groups[gi], cn = counts[gi], ids = idsOf(g);
    const words = ids.filter((/** @type {string} */ x) => x.startsWith('W:'));
    const pool = words.length ? words : ids;
    const next = nextUp(pool, stateOf, weight, 10);
    const stack = h('div', { class: 'ex-stack', 'aria-hidden': 'true' },
      ...STATES.map(s => (cn[s] ? h('span', { class: `is-${s}`, style: { flexGrow: String(cn[s]) } }) : null)));
    const countsEl = h('p', { class: 'ex-counts caption tnum' }, ...STATES.map(s => h('span', null, t(`explore.sheet.${s}`, { n: num(cn[s]) }))));
    /** @type {any[]} */ const body = [
      h('p', { class: 'ex-meta caption' }, h('span', null, t(`explore.mode.${mode}`)), h('span', null, t('explore.sheet.score', { p: Math.round(cn.score * 100) }))),
      h('h2', { id: 'ex-sheet-title', class: 'ex-group-title' }, labelOf(g)),
      h('p', { class: 'ex-group-known' }, t('explore.known', { k: num(cn.known), n: num(cn.n) })),
      stack, countsEl,
    ];
    if (next.length) {
      const long = next.some(x => A.text[/** @type {number} */ (A.index.get(x))].length > 16);
      body.push(h('h3', { class: 'ex-next-title label' }, t('explore.sheet.next')),
        h('ul', { class: ['ex-next', long ? 'is-long' : ''], lang: 'de' }, ...next.map(x => {
          const j = /** @type {number} */ (A.index.get(x)), s = stateOf(x);
          return h('li', null, h('button', { type: 'button', class: ['ex-next-item', 'pressable', `is-${s.state}`], onclick: () => goTo(j) },
            A.art[j] ? h('span', { class: 'ex-art' }, `${A.art[j]} `) : null, h('span', { class: 'ex-w' }, A.text[j]), h('span', { class: 'sr-only', lang: 'en' }, `, ${t(`explore.state.${s.state}`)}`)));
        })));
      const studyIds = next.filter(x => x.startsWith('W:') && !/[…()[\]]/.test(A.text[/** @type {number} */ (A.index.get(x))])).map(x => x.slice(2));
      const acts = [];
      if (studyIds.length) acts.push(h('a', { class: 'btn btn-primary pressable', href: `#/practice/round?kind=cluster%3Apick&ids=${encodeURIComponent(studyIds.join(','))}&from=map` }, t('explore.sheet.study', { n: studyIds.length })));
      if (g.cluster) { const [ty, cid] = String(g.cluster).split(/:(.*)/); acts.push(h('a', { class: 'btn pressable', href: `#/practice/clusters/${ty}/${encodeURIComponent(cid)}` }, t('explore.sheet.cluster'))); }
      if (acts.length) body.push(h('div', { class: 'ex-actions' }, ...acts));
      if (!c.newItems && studyIds.length && studyIds.every(w => stateOf(`W:${w}`).state === 'unseen')) body.push(h('p', { class: 'caption' }, t('explore.sheet.noNew')));
      if (!words.length) body.push(h('p', { class: 'caption' }, t('explore.sheet.noWords')));
    } else body.push(h('p', { class: 'ex-allknown' }, t('explore.sheet.allKnown')));
    replace(sheetBody, ...body);
    showSheet();
    if (fly) map.flyToGroup(gi, { below: sheetBelow(), right: sheetRight() });
    void far;
  }

  /* ---------- search ---------- */
  /** @type {string[] | null} */ let folded = null;
  /** @type {string[]} */ let english = [];
  async function openSearch() {
    findEl.hidden = false; findInput.value = ''; replace(findList); findInput.focus();
    if (!folded) {
      folded = A.ids.map((/** @type {string} */ x, /** @type {number} */ i) => fold(`${A.art[i] ? `${A.art[i]} ` : ''}${A.text[i]}`));
      const D = await loadDetails(ctx, K.k.maps).catch(() => null);
      english = A.ids.map((/** @type {string} */ x, /** @type {number} */ i) => {
        if (!D) return '';
        if (A.kind[i] === 'w') return fold((D.words.get(x.slice(2))?.en || []).join('; '));
        if (A.kind[i] === 'c') return fold(D.chunksEn.get(x.slice(2))?.chunk || '');
        return '';
      });
      if (findInput.value) runSearch();
    }
  }
  function closeSearch() { findEl.hidden = true; findBtn.focus(); }
  function runSearch() {
    const hits = folded ? find(A, folded, english, findInput.value) : [];
    if (!findInput.value.trim()) { replace(findList); return; }
    if (!hits.length) { replace(findList, h('li', { class: 'ex-find-none caption' }, t('explore.find.none'))); return; }
    replace(findList, ...hits.map(i => h('li', null, h('button', { type: 'button', class: 'ex-find-hit pressable', onclick: () => { closeSearch(); goTo(i); } },
      h('span', { class: 'ex-find-de', lang: 'de' }, A.art[i] ? h('span', { class: 'ex-art' }, `${A.art[i]} `) : null, A.text[i]),
      h('span', { class: 'ex-find-meta caption' }, `${t(`explore.state.${K.today[i] ? 'today' : CODE_STATE[K.st[i]]}`)} · ${A.level[i]}`)))));
  }
  findInput.addEventListener('input', runSearch);
  findInput.addEventListener('keydown', e => { if (e.key === 'Enter') { /** @type {HTMLButtonElement | null} */ (findList.querySelector('button'))?.click(); } });

  /* ---------- the list (the accessible alternative) ---------- */
  function renderList() {
    const l = layout(mode);
    if (!l.groups.length) { replace(listEl, h('p', { class: 'ex-empty' }, t('explore.source.empty'))); return; }
    replace(listEl, h('h2', { class: 'sr-only' }, t(`explore.mode.${mode}`)), ...l.groups.map((/** @type {any} */ g, /** @type {number} */ gi) => {
      const cn = counts[gi];
      const d = h('details', { class: 'ex-lgroup' }, h('summary', { class: 'pressable' }, h('b', null, labelOf(g)), h('span', { class: 'caption tnum' }, t('explore.known', { k: num(cn.known), n: num(cn.n) }))));
      d.addEventListener('toggle', () => {
        if (!d.open || d.dataset.done) return;
        d.dataset.done = '1';
        d.append(h('ul', { class: 'ex-litems' }, ...g.items.map((/** @type {number} */ i) => h('li', null,
          h('button', { type: 'button', class: ['ex-litem', 'pressable', `is-${K.today[i] ? 'today' : CODE_STATE[K.st[i]]}`], lang: 'de', onclick: () => { setView(false); openWord(i); } },
            A.art[i] ? h('span', { class: 'ex-art' }, `${A.art[i]} `) : null, h('span', { class: 'ex-w' }, A.text[i])),
          h('span', { class: ['caption', `ex-lstate is-${K.today[i] ? 'today' : CODE_STATE[K.st[i]]}`], lang: 'en' }, t(`explore.state.${K.today[i] ? 'today' : CODE_STATE[K.st[i]]}`))))));
      });
      return d;
    }));
  }

  /* ---------- keys ---------- */
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== 'Escape') return;
    if (!findEl.hidden) closeSearch(); else if (!sheet.hidden) { closeSheet(); canvas.focus(); }
  };
  document.addEventListener('keydown', onKey);
  offs.push(() => document.removeEventListener('keydown', onKey));

  // benchmarks for the performance report (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    /** @type {any} */ (window).__explore = { map, setMode, bench: () => map.bench(), stats: () => map.stats(), A, K: () => K };
    offs.push(() => { delete /** @type {any} */ (window).__explore; });
  }
  return { unmount: cleanup };
}

/** The way back to Look up. @param {(k: string) => string} t */
const backLink = t => h('a', { class: 'ex-back pressable', href: '#/lookup' }, icon('prev', { size: 16 }), t('explore.back'));

/** Wait for the map font (both styles) before the first draw: the layout was built with its widths. */
async function loadFonts() {
  if (!document.fonts) return;
  await Promise.all(['400 16px "Fluentish Map"', 'italic 400 16px "Fluentish Map"', '600 13px Geist'].map(f => document.fonts.load(f).catch(() => null)));
}

/** Small control glyphs drawn as SVG lines (plus, minus, fit). @param {'plus'|'minus'|'fit'} name */
function glyph(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round');
  const d = name === 'plus' ? 'M4 10h12M10 4v12' : name === 'minus' ? 'M4 10h12' : 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4';
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p);
  return svg;
}
