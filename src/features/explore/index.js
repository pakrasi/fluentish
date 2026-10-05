/* Explore (Look up › Map, #/lookup/map): a map of every German word, phrase and grammar concept in the content, set as
   type, grouped by a chosen mode, inked by what the learner knows (DESIGN.md, Explore).
     #/lookup/map[?mode=topic|family|opp|level|type|source][&view=list|3d][&at=<item id>][&g=<group key>][&cluster=<type>:<id>]
   Positions come from content/atlas (built at build time) and never move as he learns. Tapping a word opens its card,
   with links to its opposite and its family that fly there; tapping a group opens its sheet, whose "Study" button
   starts a round in Practice (#/practice/round?kind=cluster:pick… for words, kind=pick:… for phrases and grammar).
   ?g= opens a group's sheet; ?cluster= opens the map group of a Practice word cluster (the cluster page links here).
   After a study round the map comes back to the group it started from, with its sheet open.
   The List view is the accessible alternative: every group with the sheet's counts and study action, every item with
   its state in words. On the canvas, Tab steps through the groups and Enter opens one.
   The 3D view (palace/, loaded with import() when the 3D segment opens) is the same map raised: the same layout, the
   same sheets and study actions, its own camera; a word that became known plays the learned moment there once.
   Explore writes cards only in select mode (select.js: tap the words you know, through data/known.js); its own kv
   'explore' keeps the mode, the gaps filter, what it already showed and the group a study round started from. */
import { h, replace, announce } from '../../core/dom.js';
import { seg } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { reduced } from '../../core/motion.js';
import { label as dayLabel } from '../../core/clock.js';
import { num } from '../../core/i18n.js';
import { MODES, summarise, nextUp, encode } from '../../domain/atlas.js';
import { loadAtlas, layoutOf, scores, loadDetails, prefs, setPrefs, fold, find, totals } from '../../data/atlas.js';
import { createMap } from './map.js';
import { createSelect } from './select.js';
import { momentQueue, nextRecord, idsKey, decodeStates } from '../../domain/palace.js';

const STATES = /** @type {const} */ (['known', 'shaky', 'unknown', 'unseen']);
const CODE_STATE = ['unseen', 'unknown', 'shaky', 'known'];
const RETURN_MS = 3 * 3600e3;          // a study round started from the map comes back to its group within 3 hours
const STUDY_N = 10;
let mounts = 0;

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx */
export async function mount(el, ctx) {
  /** @type {(() => void)[]} */ const offs = [() => document.body.classList.remove('ex-page')];
  document.body.classList.add('ex-page');
  try { return await mountMap(el, ctx, offs); } catch (e) { offs.forEach(f => f()); throw e; }
}

/** @param {HTMLElement} el @param {import('../contract.js').ViewCtx} ctx @param {(() => void)[]} offs */
async function mountMap(el, ctx, offs) {
  const { t, store } = ctx;
  let alive = true;
  const cleanup = () => { alive = false; offs.forEach(f => f()); };
  // a newer mount into the same element (a second navigation while this one loads) wins; this one stops at its next await
  const gen = String(++mounts);
  el.dataset.exGen = gen;
  const stale = () => !alive || el.dataset.exGen !== gen;

  const h1 = h('h1', { class: 'ex-title' }, t('explore.title'));
  const status = h('p', { class: 'ex-status caption', 'aria-live': 'polite' }, t('explore.loading'));
  replace(el, h('div', { class: 'explore is-loading' }, h('div', { class: 'ex-head' }, backLink(t), h1), status));

  let A, K;
  try {
    [A] = await Promise.all([loadAtlas(ctx), loadFonts()]);
    K = await scores(ctx, A);
  } catch (e) {
    console.error(e);
    if (stale()) return cleanup;
    replace(status, t('explore.loadFailed'), ' ', h('button', { type: 'button', class: 'btn btn-quiet pressable', onclick: () => ctx.go('/lookup/map', { replace: true }) }, t('explore.retry')));
    return cleanup;
  }
  if (stale()) { cleanup(); return cleanup; }

  const pf = prefs(store);
  const q = ctx.query;
  const c = ctx.clock.ctx();
  // where to open: ?cluster= (a Practice word cluster's group), else a study round coming back, else ?mode=, else the saved mode
  const back = !q.get('at') && !q.get('g') && !q.get('cluster') && pf.ret && Date.now() - pf.ret.at < RETURN_MS ? pf.ret : null;
  if (pf.ret) setPrefs(store, s => { const { ret, ...rest } = s; void ret; return rest; });
  const target = q.get('cluster') ? clusterGroup(A, String(q.get('cluster'))) : q.get('g') ? { mode: q.get('mode') || 'topic', key: String(q.get('g')) } : back;
  /** @type {string} */ let mode = target && MODES.includes(/** @type {any} */ (target.mode)) ? target.mode
    : MODES.includes(/** @type {any} */ (q.get('mode'))) ? /** @type {string} */ (q.get('mode')) : MODES.includes(pf.mode) ? pf.mode : 'topic';
  /** @type {'map' | '3d' | 'list'} */
  let view = q.get('view') === 'list' ? 'list' : q.get('view') === '3d' || (!q.get('view') && !q.get('at') && pf.view === '3d') ? '3d' : 'map';
  let listOn = view === 'list';
  let gaps = !!pf.gaps;

  /* ---------- layouts and group numbers ---------- */
  /** @type {Map<string, any>} */ const layouts = new Map();
  const layout = (/** @type {string} */ m) => { let l = layouts.get(m); if (!l) { l = layoutOf(A, m, K); layouts.set(m, l); } return l; };
  /** @type {any[]} */ let counts = [];
  let openItem = -1, openGroupIdx = -1;     // what the sheet shows
  const stateOf = (/** @type {string} */ id) => ({ state: /** @type {any} */ (CODE_STATE[K.st[/** @type {number} */ (A.index.get(id))]]), today: !!K.today[/** @type {number} */ (A.index.get(id))] });
  const weight = (/** @type {string} */ id) => A.F[/** @type {number} */ (A.index.get(id))] || 1;
  const idsOf = (/** @type {any} */ g) => g.items.map((/** @type {number} */ i) => A.ids[i]);
  const stateKey = (/** @type {number} */ i) => (K.today[i] ? 'today' : CODE_STATE[K.st[i]]);
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
    MODES.map(m => h('button', { type: 'button', class: 'chip pressable', 'aria-pressed': String(m === mode), dataset: { mode: m }, onclick: () => (m === mode ? cur().fit() : setMode(m)) }, t(`explore.mode.${m}`))));
  const viewSeg = seg({ label: t('explore.view'), value: view, options: [['map', t('explore.view.map')], ['3d', t('explore.view.3d')], ['list', t('explore.view.list')]],
    onChange: v => { void setView(/** @type {'map' | '3d' | 'list'} */ (v)); } });
  const findBtn = h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.find'), onclick: () => openSearch() }, icon('lookup', { size: 20 }));
  const keysHelp = h('p', { class: 'sr-only', id: 'ex-keys' }, t('explore.keys'));
  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ex-canvas', tabindex: '0', role: 'application', 'aria-roledescription': t('explore.mapRole'), 'aria-describedby': 'ex-keys' }));
  const hereEl = h('div', { class: 'ex-here', hidden: true }, h('b'), h('span', { class: 'tnum' }));
  const totalEl = h('span', { class: 'ex-total caption tnum' });
  const legend = h('div', { class: 'ex-legend', id: 'ex-legend', role: 'group', 'aria-label': t('explore.key') },
    ...(['known', 'shaky', 'unknown', 'unseen', 'today']).map(s => h('span', { class: `ex-key is-${s}` }, h('i', { lang: 'de', 'aria-hidden': 'true' }, 'Aa'), t(`explore.state.${s}`))));
  const keyBtn = h('button', { type: 'button', class: 'chip pressable ex-keybtn', 'aria-expanded': 'false', 'aria-controls': 'ex-legend', onclick: () => toggleKey() }, t('explore.key'));
  const gapsBtn = h('button', { type: 'button', class: 'chip pressable ex-gaps', 'aria-pressed': String(gaps), onclick: () => setGaps(!gaps) }, t('explore.gaps'));
  const zoom = h('div', { class: 'ex-zoom' },
    h('button', { type: 'button', class: 'ex-icon ex-fit pressable', 'aria-label': t('explore.fit'), onclick: () => cur().fit() }, glyph('fit')),
    h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.zoomOut'), onclick: () => cur().zoomBy(0.5) }, glyph('minus')),
    h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.zoomIn'), onclick: () => cur().zoomBy(2) }, glyph('plus')));
  // 3D: the districts list is the keyboard and screen-reader way around the city
  const distList = h('ul', { class: 'pl-dist-list', role: 'list' });
  const distPanel = h('div', { class: 'pl-dist', id: 'pl-dist', role: 'group', 'aria-label': t('explore.3d.districts'), hidden: true }, h('p', { class: 'label pl-dist-title' }, t('explore.3d.goTo')), distList);
  const distBtn = h('button', { type: 'button', class: 'chip pressable pl-distbtn', 'aria-expanded': 'false', 'aria-controls': 'pl-dist', onclick: () => toggleDistricts() }, t('explore.3d.districts'));
  legend.append(h('span', { class: 'ex-key pl-height' }, t('explore.3d.height')));
  const hud = h('div', { class: 'ex-hud' }, totalEl, h('div', { class: 'ex-ctl' }, keyBtn, gapsBtn, distBtn), legend);
  const keys3 = h('p', { class: 'sr-only', id: 'pl-keys' }, t('explore.3d.keys'));
  const labels3 = h('div', { class: 'pl-labels', 'aria-hidden': 'true' });
  /** @type {HTMLCanvasElement | null} */ let canvas3 = null;
  const listEl = h('div', { class: 'ex-list', hidden: true });
  const sheetBody = h('div', { class: 'ex-sheet-body' });
  const grab = h('button', { type: 'button', class: 'ex-grab', 'aria-label': t('explore.sheet.expand'), 'aria-expanded': 'false', onclick: () => { if (!dragged) setDetent(detent === 'full' ? 'peek' : 'full'); } }, h('i', { 'aria-hidden': 'true' }));
  const sheet = h('section', { class: 'ex-sheet is-peek', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ex-sheet-title', hidden: true },
    grab, h('button', { type: 'button', class: 'ex-icon ex-close pressable', 'aria-label': t('explore.sheet.close'), onclick: () => closeSheet({ restore: true }) }, icon('close', { size: 18 })), sheetBody);
  const findInput = /** @type {HTMLInputElement} */ (h('input', { type: 'search', class: 'ex-find-input', lang: 'de', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('explore.find.label'), placeholder: t('explore.find.label') }));
  findInput.setAttribute('autocorrect', 'off'); findInput.setAttribute('autocapitalize', 'off');
  const findList = h('ul', { class: 'ex-find-list', role: 'list' });
  const findEl = h('div', { class: 'ex-find', role: 'dialog', 'aria-label': t('explore.find'), hidden: true },
    h('div', { class: 'ex-find-row' }, findInput, h('button', { type: 'button', class: 'ex-icon pressable', 'aria-label': t('explore.find.close'), onclick: () => closeSearch() }, icon('close', { size: 18 }))), findList);
  const stage = h('div', { class: 'ex-stage' }, canvas, keysHelp, keys3, labels3, hereEl, hud, distPanel, listEl);
  const page = h('div', { class: 'explore' },
    h('div', { class: 'ex-head' }, backLink(t), h1, h('div', { class: 'ex-head-tools' }, viewSeg, findBtn)),
    h('div', { class: 'ex-chiprow' }, modeChips, zoom), stage, findEl);
  replace(el, page);
  // select mode (select.js): tap the words you know to mark them known; the List is not re-drawn while it is on
  const sel = createSelect({ ctx, A, page, score: i => K.score(i), rescore: () => rescore(), stateKey: i => stateKey(i), onOff: () => { if (listOn) renderList(); } });
  // in the chip row next to zoom (the head row at 390 px holds back, title, Map · 3D · List and Find at 44 px each);
  // select mode is a 2D tool: the button hides in 3D, and opening 3D ends it
  zoom.before(sel.btn);
  stage.append(sel.bar);
  // where the map starts on screen (the desktop card sits over its top right) and how tall a phone sheet's peek is
  const measure = () => {
    const r = stage.getBoundingClientRect(), root = document.documentElement.style;
    root.setProperty('--ex-stage-top', `${Math.round(r.top)}px`);
    root.setProperty('--ex-peek', `${Math.round(r.height * 0.46 + Math.max(0, innerHeight - r.bottom))}px`);
  };
  // a ResizeObserver callback that changes layout can loop; measure on the next frame instead
  let measureRaf = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(measureRaf); measureRaf = requestAnimationFrame(measure); }); ro.observe(stage); measure();
  offs.push(() => { cancelAnimationFrame(measureRaf); ro.disconnect(); ['--ex-stage-top', '--ex-peek'].forEach(k => document.documentElement.style.removeProperty(k)); });
  // the sheet lives on the body, above the tab bar (the view is its own stacking context)
  sheet.classList.add('ex-sheet-root');
  document.body.append(sheet);
  offs.push(() => sheet.remove());
  const chipIntoView = (/** @type {boolean} */ smooth) => /** @type {HTMLElement | null} */ (modeChips.querySelector('[aria-pressed="true"]'))
    ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  requestAnimationFrame(() => chipIntoView(false));

  /* ---------- the map ---------- */
  const map = createMap(canvas, {
    A, reduced,
    labelOf,
    countOf: gi => counts[gi] || { n: 0, known: 0, shaky: 0, unknown: 0, unseen: 0 },
    insets: () => ({ top: 8, bottom: hud.offsetHeight + 8 }),
    onWord: i => (sel.on ? void sel.toggle(i) : openWord(i, { opener: canvas })),
    onGroup: (gi, far) => openGroup(gi, far, { opener: canvas }),
    onEmpty: () => closeSheet(),
    onHere: gi => {
      hereEl.hidden = gi < 0 || listOn;
      if (gi < 0) return;
      const g = layout(mode).groups[gi], cn = counts[gi];
      /** @type {HTMLElement} */ (hereEl.firstChild).textContent = labelOf(g);
      /** @type {HTMLElement} */ (hereEl.lastChild).textContent = t('explore.known', { k: num(cn.known), n: num(cn.n) });
    },
    onKbGroup: gi => {
      const g = layout(mode).groups[gi], cn = counts[gi];
      announce(t('explore.kbGroup', { name: labelOf(g), k: num(cn.known), n: num(cn.n) }));
    },
  });
  offs.push(() => map.destroy());
  // the focus ring shows when the map is reached with the keyboard, not on every tap
  canvas.addEventListener('pointerdown', () => { delete canvas.dataset.kbd; closeKey(); });
  canvas.addEventListener('keyup', e => { if (e.key === 'Tab') canvas.dataset.kbd = '1'; });
  map.setLayout(layout(mode));
  canvas.setAttribute('aria-label', t('explore.canvas', { mode: t(`explore.mode.${mode}`).toLowerCase() }));

  // learned today and not shown yet: these glow on arrival (after the flight back to a group, when coming back)
  const shownToday = () => { const s = prefs(store).shown; return new Set(s && s.day === c.today ? s.ids : []); };
  const newlyLearned = () => { const seen = shownToday(), out = []; for (let i = 0; i < A.n; i++) if (K.today[i] && !seen.has(A.ids[i])) out.push(i); return out; };
  const markShown = (/** @type {number[]} */ idx) => { if (!idx.length) return; const ids = [...shownToday(), ...idx.map(i => A.ids[i])]; setPrefs(store, s => ({ ...s, shown: { day: c.today, ids } })); };
  const tgi = target ? map.layout.groups.findIndex((/** @type {any} */ g) => g.key === target.key) : -1;
  const fresh = view === '3d' ? [] : newlyLearned();
  map.setScores(K.st, K.today, fresh, { delay: tgi >= 0 ? 900 : 0 });
  markShown(fresh);
  if (fresh.length) announce(t('explore.learned', { n: fresh.length }));
  // a quiet reveal the first time the map opens on a day
  if (tgi < 0 && view !== '3d' && prefs(store).introDay !== c.today) { map.intro(); setPrefs(store, s => ({ ...s, introDay: c.today })); }
  if (gaps) map.setGaps(true);
  // the card details (word list, phrases, families, what rounds ask) load while the map is being looked at
  const idle = setTimeout(() => { loadDetails(ctx, K.k.maps).catch(() => null); }, tgi >= 0 ? 0 : 900);
  offs.push(() => clearTimeout(idle));
  renderTotals();

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
    if (mode === 'source' && palace) palace.setLayout(layout('source'));
    recount();
    if (view === '3d' && palace && !palace.lost) {
      map.setScores(K.st, K.today, []);
      const mq = queueMoments();
      palace.setScores(K.st, K.today, K.S, { hold: mq.from });
      if (mq.play.length) { if (sheet.hidden) void playMoments(mq); else pendingMoments = mq; }
    } else {
      const nw = newlyLearned();
      map.setScores(K.st, K.today, nw); markShown(nw);
    }
    renderTotals();
    if (listOn && !sel.on) renderList();
    if (openGroupIdx >= 0) openGroup(openGroupIdx, false, { fly: false, keep: true });
    else if (openItem >= 0) openWord(openItem, { fly: false, keep: true });
  }

  /* ---------- the 3D view (palace/) ---------- */
  /** @type {any} */ let palace = null;
  /** @type {Promise<any> | null} */ let palaceP = null;
  /** @type {{play: number[], from: Map<number, number>, soft: Set<number>} | null} */ let pendingMoments = null;
  let viewTurn = 0;
  /** The view that is showing: the 3D city or the 2D map (both take the same calls). */
  const cur = () => (view === '3d' && palace && !palace.lost ? palace : map);
  /** Can this device show 3D? If not, say so in one line and stay on the map. */
  function can3d() {
    let why = '';
    if (matchMedia('(forced-colors: active)').matches) why = t('explore.3d.forced');
    else if (!webgl2()) why = t('explore.3d.none');
    if (why) { ctx.toast(why); announce(why); }
    return !why;
  }
  /** Load the 3D module and build the city (once a mount). */
  function openPalace() {
    if (!palaceP) {
      status3d(true);
      performance.mark('palace-start');
      palaceP = import('./palace/index.js').then(async P => {
        canvas3 = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ex-canvas pl-canvas', tabindex: '0', role: 'application', 'aria-roledescription': t('explore.3d.role'), 'aria-describedby': 'pl-keys', 'aria-label': t('explore.3d.canvas'), hidden: true }));
        stage.insertBefore(canvas3, keysHelp);
        canvas3.addEventListener('pointerdown', () => { if (canvas3) delete canvas3.dataset.kbd; closeKey(); closeDistricts(); });
        canvas3.addEventListener('keyup', e => { if (e.key === 'Tab' && canvas3) canvas3.dataset.kbd = '1'; });
        const p = await P.createPalace(canvas3, {
          A, layout: layout(mode), st: K.st, today: K.today, S: K.S, reduced, labels: labels3,
          labelOf, countText: gi => t('explore.known', { k: num(counts[gi]?.known || 0), n: num(counts[gi]?.n || 0) }),
          countOf: gi => counts[gi] || { n: 0, known: 0, shaky: 0, unknown: 0, unseen: 0 },
          insets: () => ({ top: 8, bottom: hud.offsetHeight + 8 }),
          onWord: i => openWord(i, { opener: canvas3 }),
          onGroup: gi => openGroup(gi, true, { opener: canvas3 }),
          onEmpty: () => closeSheet(),
          onHere: gi => {
            hereEl.hidden = gi < 0 || view !== '3d';
            if (gi < 0) return;
            const g = layout(mode).groups[gi], cn = counts[gi];
            /** @type {HTMLElement} */ (hereEl.firstChild).textContent = labelOf(g);
            /** @type {HTMLElement} */ (hereEl.lastChild).textContent = t('explore.known', { k: num(cn.known), n: num(cn.n) });
          },
          onKbGroup: gi => { const g = layout(mode).groups[gi], cn = counts[gi]; announce(t('explore.kbGroup', { name: labelOf(g), k: num(cn.known), n: num(cn.n) })); },
          onLost: () => {
            // the graphics context was taken away (memory pressure, a GPU reset): the 2D map takes over
            if (view === '3d') { canvas.hidden = false; if (canvas3) canvas3.hidden = true; view = 'map'; listOn = false; selectSeg('map'); page.classList.remove('is-3d'); closeDistricts(); map.resize(); map.setScores(K.st, K.today, []); address(); }
            ctx.toast(t('explore.3d.lost')); announce(t('explore.3d.lost'));
          },
        });
        offs.push(() => p.destroy());
        if (!alive) { p.destroy(); return null; }
        palace = p;
        performance.mark('palace-ready');
        status3d(false);
        return p;
      }).catch(e => {
        console.error(e);
        palaceP = null; status3d(false);
        if (alive) { const why = t(e && e.code === 'nowebgl2' ? 'explore.3d.none' : 'explore.3d.failed'); ctx.toast(why); announce(why); if (view === '3d') void setView('map'); }
        return null;
      });
    }
    return palaceP;
  }
  /** While the 3D module loads, the map stays and the total line says so. @param {boolean} on */
  function status3d(on) { totalEl.classList.toggle('is-loading3d', on); if (on) totalEl.textContent = t('explore.3d.loading'); else renderTotals(); }
  /** 3D → 2D: settle the city into the plan, then hand the camera to the 2D map. @param {boolean} animate */
  async function leave3d(animate) {
    if (!palace || palace.lost) { if (canvas3) canvas3.hidden = true; return; }
    const cam = await palace.leave({ animate, to: palace.atOverview() ? map.fitCamera() : null });
    if (view === '3d') return;          // 3D was asked for again while it settled
    map.setScores(K.st, K.today, []);
    map.camera = cam;
    canvas.hidden = false; map.resize();
    requestAnimationFrame(() => { if (view !== '3d' && canvas3) canvas3.hidden = true; });
  }
  /** A short crossfade of the 3D canvas around a change it cannot animate (a mode switch). @param {() => void} fn */
  function fade3d(fn) {
    if (!canvas3 || reduced()) { fn(); return; }
    canvas3.classList.add('is-fading');
    setTimeout(() => { fn(); requestAnimationFrame(() => canvas3?.classList.remove('is-fading')); }, 150);
  }
  /** The items whose learned moment should play now; the device record is brought up to date at once. */
  function queueMoments() {
    const rec = store.get('palace', null);
    const key = palaceKey;
    const L = layout(mode);
    const { play } = momentQueue(rec, { ids: A.ids, key, st: K.st, today: K.today, day: c.today, order: i => (L.G[i] < 0 ? 1e9 : L.G[i] * 1e6 + L.Y[i] * 100 + L.X[i] / 100) });
    const prev = rec && rec.ver === key && rec.st ? decodeStates(rec.st, A.n) : null;
    const shown = play.filter(i => !Number.isNaN(L.X[i]));
    const from = new Map(shown.map(i => [i, prev ? prev[i] : 1]));
    // words he marked known himself (select mode, Quick sort) get the softer moment
    const soft = new Set(shown.filter(i => K.score(i)?.marked));
    store.set('palace', nextRecord(rec, { ids: A.ids, key, st: K.st, day: c.today }, shown));
    return { play: shown, from, soft };
  }
  /**
   * Play queued moments (closing the sheet: an effect under a sheet did not happen), then say how many: a toast, or
   * only the announcement when a sheet opens next (the toast would cover its buttons).
   * @param {{play: number[], from: Map<number, number>, soft: Set<number>}} mq @param {{sheetNext?: boolean}} [opt]
   */
  async function playMoments(mq, { sheetNext = false } = {}) {
    if (!palace || !mq.play.length) return;
    closeSheet();
    const shown = await palace.playMoments(mq.play, mq.from, mq.soft);
    if (!alive) return;
    markShown(mq.play);
    const msg = t('explore.3d.learned', { n: mq.play.length });
    if (shown.length && !reduced() && !sheetNext) ctx.toast(msg);
    announce(msg);
  }
  /** The ids a group's sheet lists under "Study next". @param {number} gi */
  function studyNext(gi) {
    const g = layout(mode).groups[gi], ids = idsOf(g);
    const words = ids.filter((/** @type {string} */ x) => x.startsWith('W:')), phrases = ids.filter((/** @type {string} */ x) => x.startsWith('K:'));
    return nextUp(words.length ? words : phrases.length ? phrases : ids, stateOf, weight, STUDY_N);
  }
  /** The districts list: every group as a button that flies there and opens its sheet. */
  function buildDistricts() {
    const L = layout(mode);
    replace(distList, ...L.groups.map((/** @type {any} */ g, /** @type {number} */ gi) => h('li', null, h('button', { type: 'button', class: 'pl-dist-item pressable', onclick: () => { closeDistricts(); openGroup(gi, true, { opener: distBtn }); } },
      h('b', null, labelOf(g)), h('span', { class: 'caption tnum' }, t('explore.known', { k: num(counts[gi].known), n: num(counts[gi].n) }))))));
  }
  function toggleDistricts() {
    if (!distPanel.hidden) { closeDistricts(); distBtn.focus(); return; }
    closeKey(); closeSheet(); buildDistricts();
    distPanel.hidden = false; distBtn.setAttribute('aria-expanded', 'true');
    /** @type {HTMLElement | null} */ (distList.querySelector('button'))?.focus();
  }
  function closeDistricts() { distPanel.hidden = true; distBtn.setAttribute('aria-expanded', 'false'); }
  const palaceKey = `${idsKey(A.ids)}|${ctx.app?.profile?.id || ''}`;

  /* ---------- modes, view, filter, key ---------- */
  function setMode(/** @type {string} */ m) {
    if (m === mode) return;
    const keep = openItem;
    mode = m;
    closeSheet({ keepSelection: true });
    for (const b of modeChips.querySelectorAll('button')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.mode === m));
    const next = layout(m);
    recount();
    if (view === '3d' && palace) {
      map.setLayout(next);
      fade3d(() => { palace?.setLayout(next); buildDistricts(); if (keep >= 0 && !Number.isNaN(next.X[keep])) { palace?.select(keep); void palace?.flyToItem(keep); } else void palace?.fit(); });
    } else {
      map.setLayout(next, { animate: true, follow: keep >= 0 && !Number.isNaN(next.X[keep]) ? keep : -1 });
      if (keep >= 0 && !Number.isNaN(next.X[keep])) map.select(keep); else map.clear();
    }
    canvas.setAttribute('aria-label', t('explore.canvas', { mode: t(`explore.mode.${m}`).toLowerCase() }));
    setPrefs(store, s => ({ ...s, mode: m }));
    address();
    renderTotals();
    if (listOn) renderList();
    chipIntoView(true);
    // when the words have settled, the chip that caused it lands, so cause and effect connect
    const chip = /** @type {HTMLElement | null} */ (modeChips.querySelector(`[data-mode="${m}"]`));
    if (chip && !reduced()) { chip.classList.remove('is-landed'); setTimeout(() => { if (alive && mode === m) { void chip.offsetWidth; chip.classList.add('is-landed'); } }, listOn ? 0 : 1000); }
  }
  /**
   * Map, 3D or List. 3D loads its module the first time (the 2D map stays on screen meanwhile, since the plan view is
   * the Atlas), then tilts up from exactly where the map is. Leaving 3D settles the city back into the plan.
   * @param {'map' | '3d' | 'list'} v @param {boolean} [initial] @param {{target?: number}} [opt]
   */
  async function setView(v, initial = false, { target: tg = -1 } = {}) {
    const prev = initial ? 'map' : view;
    if (v === prev && !initial) return;
    if (v === '3d' && sel.on) sel.set(false);
    if (v === '3d' && !can3d()) {
      view = prev === '3d' ? 'map' : prev; listOn = view === 'list'; selectSeg(view); page.classList.remove('is-3d');
      if (initial) { address(); if (tg >= 0) requestAnimationFrame(() => openGroup(tg, true)); }
      return;
    }
    const myTurn = ++viewTurn;
    view = v; listOn = v === 'list';
    selectSeg(v);
    page.classList.toggle('is-list', listOn); page.classList.toggle('is-3d', v === '3d');
    listEl.hidden = !listOn; hud.hidden = listOn; hereEl.hidden = true;
    closeKey(); closeDistricts(); closeSheet();
    if (v !== 'list') setPrefs(store, s => ({ ...s, view: v }));
    if (!initial) address();
    if (listOn) {
      if (prev === '3d') await leave3d(false);
      canvas.hidden = true; renderList();
      return;
    }
    if (v === 'map') {
      if (prev === '3d') await leave3d(!reduced());
      canvas.hidden = false; map.resize();
      return;
    }
    // 3D
    canvas.hidden = false;
    if (prev === 'list') map.resize();
    const p = await openPalace();
    if (!p || !alive || myTurn !== viewTurn || view !== '3d') return;
    const mq = queueMoments();
    p.setScores(K.st, K.today, K.S, { hold: mq.from });
    p.setLayout(layout(mode));
    const fitK = map.fitK(), cam = map.camera;
    const tilt = !reduced() && (!initial || prefs(store).tiltDay !== c.today);
    if (tilt) setPrefs(store, s => ({ ...s, tiltDay: c.today }));
    // the 3D canvas comes in transparent, sized, and shows once it has drawn the same picture as the map
    /** @type {HTMLCanvasElement} */ (canvas3).classList.add('is-fading');
    /** @type {HTMLCanvasElement} */ (canvas3).hidden = false;
    p.resize();
    const entering = p.enter(cam, { overview: !fitK || cam.k <= fitK * 1.15, animate: tilt });
    // the 2D map hides once the 3D canvas has drawn its first frame (it starts as the same picture)
    requestAnimationFrame(() => requestAnimationFrame(() => { if (view === '3d') canvas.hidden = true; canvas3?.classList.remove('is-fading'); }));
    buildDistricts();
    await entering;
    if (!alive || view !== '3d') return;
    if (mq.play.length) await playMoments(mq, { sheetNext: tg >= 0 });
    if (!alive || view !== '3d') return;
    if (tg >= 0) openGroup(tg, true);
  }
  function selectSeg(/** @type {string} */ v) {
    for (const b of viewSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(/** @type {HTMLButtonElement} */ (b).value === v));
    const b = /** @type {HTMLElement | null} */ (viewSeg.querySelector('button[aria-pressed="true"]')), th = /** @type {HTMLElement | null} */ (viewSeg.querySelector('.seg-thumb'));
    if (b && th) { th.style.width = `${b.offsetWidth}px`; th.style.transform = `translateX(${b.offsetLeft}px)`; }
  }
  function setGaps(/** @type {boolean} */ on) {
    gaps = on; gapsBtn.setAttribute('aria-pressed', String(on)); map.setGaps(on);
    setPrefs(store, s => ({ ...s, gaps: on }));
  }
  function toggleKey() { if (legend.classList.contains('is-open')) closeKey(); else { legend.classList.add('is-open'); keyBtn.setAttribute('aria-expanded', 'true'); } }
  function closeKey() { legend.classList.remove('is-open'); keyBtn.setAttribute('aria-expanded', 'false'); }
  function address() {
    const sp = new URLSearchParams();
    if (mode !== 'topic') sp.set('mode', mode);
    if (view !== 'map') sp.set('view', view);
    const s = sp.toString();
    history.replaceState(history.state, '', `#/lookup/map${s ? `?${s}` : ''}`);
  }
  // the whole map, every item once whatever the mode: the same count as Today's Where you stand (data/atlas.js totals)
  function renderTotals() {
    const x = totals(A, K);
    totalEl.textContent = t('explore.total', { k: num(x.known), n: num(x.n) });
  }

  /* ---------- sheets ---------- */
  const isPhone = () => innerWidth < 720;
  /** @type {'peek' | 'full'} */ let detent = 'peek';
  /** @type {HTMLElement | null} */ let opener = null;
  /** The phone sheet's two heights: peek (46 % of the map, the card's word, meaning, example and buttons) and full. @param {'peek' | 'full'} d */
  function setDetent(d) {
    detent = d;
    sheet.classList.toggle('is-peek', d === 'peek'); sheet.classList.toggle('is-full', d === 'full');
    grab.setAttribute('aria-expanded', String(d === 'full'));
    grab.setAttribute('aria-label', t(d === 'full' ? 'explore.sheet.collapse' : 'explore.sheet.expand'));
  }
  /** @param {HTMLElement | null} [from] what had focus (focus goes back there when the sheet closes) */
  function showSheet(from) {
    if (from !== undefined) opener = from || /** @type {HTMLElement | null} */ (document.activeElement);
    if (sheet.hidden) { setDetent('peek'); sheet.hidden = false; sheet.classList.remove('is-in'); requestAnimationFrame(() => sheet.classList.add('is-in')); }
    sheetBody.scrollTop = 0;
    // focus moves into the sheet, to its title, so a screen reader reads what opened
    const title = /** @type {HTMLElement | null} */ (sheetBody.querySelector('h2'));
    // (after a tap on the map, a beat later: the tap's own compatibility mousedown would focus the canvas again)
    if (title && from !== undefined) { title.tabIndex = -1; setTimeout(() => { if (title.isConnected) title.focus({ preventScroll: true }); }, opener === canvas ? 80 : 0); }
  }
  /** @param {{keepSelection?: boolean, restore?: boolean}} [o] */
  function closeSheet({ keepSelection = false, restore = false } = {}) {
    if (!keepSelection) cur().clear();
    openItem = -1; openGroupIdx = -1;
    if (pendingMoments && view === '3d') { const mq = pendingMoments; pendingMoments = null; setTimeout(() => { if (alive && sheet.hidden) void playMoments(mq); }, 200); }
    if (sheet.hidden) return;
    sheet.classList.remove('is-in');
    const done = () => { if (!sheet.classList.contains('is-in')) sheet.hidden = true; };
    if (reduced()) done(); else setTimeout(done, 170);
    if (restore) {
      const back = opener && opener.isConnected && opener.offsetParent !== null ? opener : listOn ? listEl : view === '3d' && canvas3 ? canvas3 : canvas;
      back.focus({ preventScroll: true });
    }
    opener = null;
  }
  /** The desktop card's width over the right of the map. */
  const sheetRight = () => (isPhone() || sheet.hidden ? 0 : Math.max(0, stage.getBoundingClientRect().right - sheet.getBoundingClientRect().left + 16));
  /** How much of the stage the open sheet covers (a phone's bottom sheet; the desktop card sits beside the map). */
  const sheetBelow = () => { if (!isPhone() || sheet.hidden) return 0; const s = stage.getBoundingClientRect(), r = sheet.getBoundingClientRect(); return Math.max(0, s.bottom - r.top - 24); };
  /** New content in the sheet crosses in (a short fade and rise; reduced motion: no move). */
  const crossfade = () => { if (reduced()) return; sheetBody.classList.remove('is-swap'); void sheetBody.offsetWidth; sheetBody.classList.add('is-swap'); };

  // drag the grab handle: up to full, down to peek, further down to close
  let dragY = -1, dragged = false;
  grab.addEventListener('pointerdown', e => { if (!isPhone()) return; dragY = e.clientY; dragged = false; grab.setPointerCapture(e.pointerId); sheet.classList.add('is-drag'); });
  grab.addEventListener('pointermove', e => { if (dragY < 0) return; const dy = e.clientY - dragY; if (Math.abs(dy) > 6) dragged = true; sheet.style.setProperty('--ex-drag', `${Math.max(-120, dy)}px`); });
  const endDrag = (/** @type {PointerEvent} */ e) => {
    if (dragY < 0) return;
    const dy = e.clientY - dragY; dragY = -1;
    sheet.classList.remove('is-drag'); sheet.style.removeProperty('--ex-drag');
    if (!dragged) return;
    if (dy < -40) setDetent('full');
    else if (dy > 60) { if (detent === 'full') setDetent('peek'); else closeSheet({ restore: true }); }
    setTimeout(() => { dragged = false; }, 0);
  };
  grab.addEventListener('pointerup', endDrag); grab.addEventListener('pointercancel', endDrag);

  /** The text of an item as read (the map's slot "[Satz]" is "…"). @param {number} i */
  const word = i => [A.art[i] ? h('span', { class: 'ex-art' }, `${A.art[i]} `) : null, A.text[i]];
  /** A small square in the item's map state (lists and sheets; the state is in words for screen readers). @param {string} s */
  const swatch = s => h('i', { class: `ex-sw is-${s}`, 'aria-hidden': 'true' });

  /** @param {number} i @param {{fly?: boolean, opener?: HTMLElement | null, keep?: boolean}} [opt] */
  async function openWord(i, { fly = true, opener: from, keep = false } = {}) {
    openItem = i; openGroupIdx = -1;
    cur().select(i);
    const sc = K.score(i), kind = A.kind[i], id = A.ids[i];
    const L = layout(mode), g = L.groups[L.G[i]];
    const enc = encode(/** @type {any} */ (CODE_STATE[K.st[i]]), !!K.today[i]);
    const title = h('h2', { id: 'ex-sheet-title', class: 'ex-word', lang: 'de' }, ...word(i));
    const kindLabel = t(`explore.kind.${kind === 'c' ? 'phrase' : kind === 'g' ? 'grammar' : A.pos[i]}`);
    const meta = h('p', { class: 'ex-meta caption' }, h('span', null, `${kindLabel} · ${A.level[i]}`), g ? h('span', null, labelOf(g)) : null);
    const stateLine = h('p', { class: 'ex-state' },
      h('span', { class: ['ex-state-key', `is-${enc.today ? 'today' : enc.state}`], 'aria-hidden': 'true' }, 'Aa'),
      h('b', null, t(`explore.state.${enc.today ? 'today' : enc.state}`)),
      ' ', sc.state === 'unseen' ? t('explore.card.unseen')
        : [t('explore.card.recall', { p: Math.round((sc.recall || 0) * 100) }), sc.last ? (sc.last === c.today ? t('explore.card.lastToday') : t('explore.card.last', { date: dayLabel(sc.last) })) : null,
          kind === 'g' && sc.n ? t('explore.card.coverage', { seen: sc.seen, n: sc.n }) : null].filter(Boolean).join(', '));
    const from2 = (sc.sources || []).length ? h('p', { class: 'caption ex-from' }, t('explore.card.from', { list: t.list(sc.sources.map((/** @type {string} */ s) => t(`explore.group.source.${s}`))) })) : null;
    const extra = h('div', { class: 'ex-card-extra' }), actions = h('div', { class: 'ex-actions' });
    replace(sheetBody, meta, title, extra, actions, stateLine, from2);
    if (!keep) crossfade();
    showSheet(keep ? undefined : from === undefined ? null : from);
    // details: the word list entry or the phrase, links and actions; the camera moves once the sheet has its height
    const D = await loadDetails(ctx, K.k.maps).catch(() => null);
    if (!alive || openItem !== i) return;
    if (!D) { if (fly) void cur().flyToItem(i, { below: sheetBelow(), right: sheetRight() }); return; }
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
      if (!/[…()[\]]/.test(A.text[i])) acts.push(studyLink(`#/practice/round?kind=cluster%3Apick&ids=${encodeURIComponent(wid)}&from=map`, t('explore.card.practise'), true));
      acts.push(h('a', { class: 'btn pressable', href: `#/lookup/words/${encodeURIComponent(wid)}` }, t('explore.card.lookup')));
    } else if (kind === 'c') {
      const cid = id.slice(2), de = D.chunksDe[cid], en = D.chunksEn.get(cid);
      if (en) bits.push(h('p', { class: 'ex-en' }, en.pragmatic_function || en.chunk || ''));
      if (de && de.ex) bits.push(h('p', { class: 'ex-ex', lang: 'de' }, de.ex));
      const rid = D.roundId(id);
      if (rid) acts.push(studyLink(`#/practice/round?kind=${encodeURIComponent(`pick:${rid}`)}&from=map`, t('explore.card.practise'), true));
      acts.push(h('a', { class: ['btn', 'pressable', !rid && 'btn-primary'], href: `#/lookup/phrases?q=${encodeURIComponent(A.text[i].replace(/…/g, '').trim().split(/\s+/).slice(0, 3).join(' '))}` }, t('explore.card.lookup')));
      if (!rid) bits.push(h('p', { class: 'caption ex-note' }, t('explore.card.notInRounds')));
    } else {
      const cid = id.slice(3), cc = D.concepts.get(cid), topic = D.topicOfConcept.get(cid);
      if (cc && cc.description) bits.push(h('p', { class: 'ex-en' }, cc.description));
      const gids = grammarIds([cid], D);
      if (gids.length) acts.push(studyLink(`#/practice/round?kind=${encodeURIComponent(`pick:${gids.join(',')}`)}&from=map`, t('explore.card.grammar'), true));
      else if (topic) acts.push(studyLink(`#/practice/round?kind=topic%3A${encodeURIComponent(topic)}&from=map`, t('explore.card.grammar'), true));
      acts.push(h('a', { class: ['btn', 'pressable', !gids.length && !topic && 'btn-primary'], href: `#/lookup/grammar?q=${encodeURIComponent(A.text[i])}` }, t('explore.card.lookup')));
    }
    replace(extra, ...bits, ...links);
    replace(actions, ...acts);
    if (fly) void cur().flyToItem(i, { below: sheetBelow(), right: sheetRight() });
  }
  /** @param {string} label @param {string[]} wordIds */
  function linkRow(label, wordIds) {
    const btns = wordIds.map(w => A.index.get(`W:${w}`)).filter(j => j != null).map(j => h('button', { type: 'button', class: 'ex-link pressable', lang: 'de', onclick: () => goTo(/** @type {number} */ (j)) },
      ...word(/** @type {number} */ (j))));
    return btns.length ? h('div', { class: 'ex-links' }, h('span', { class: 'caption ex-links-label' }, label), ...btns) : null;
  }
  /**
   * Fly to an item (switching to Topic when this mode does not show it) and open its card. On a phone the sheet first
   * drops to its peek, so the flight is seen; the word lands with an accent ring and a plate.
   * @param {number} i
   */
  async function goTo(i) {
    if (listOn) { openWord(i, { fly: false, opener: /** @type {HTMLElement | null} */ (document.activeElement) }); return; }
    const wasOpen = !sheet.hidden;
    if (isPhone() && wasOpen && detent === 'full') { setDetent('peek'); if (!reduced()) await new Promise(r => setTimeout(r, 240)); }
    if (!alive) return;
    if (!map.has(i)) setMode('topic');
    openWord(i, { fly: false, opener: wasOpen ? opener : /** @type {HTMLElement | null} */ (document.activeElement) });
    if (view === '3d' && palace) void palace.flyToItem(i, { below: sheetBelow(), right: sheetRight() });
    else map.flyToItem(i, { k: Math.max(map.camera.k, 1.1), below: sheetBelow(), right: sheetRight(), mark: true });
  }

  /** The B1 grammar items of concepts that a round can ask, least known first, at most two a concept. @param {string[]} cids @param {any} D */
  function grammarIds(cids, D) {
    /** @type {string[]} */ const out = [];
    for (const cid of cids) {
      const items = (K.k.maps.concepts[cid] || []).filter((/** @type {string} */ x) => D.roundId(x));
      items.sort((/** @type {string} */ a, /** @type {string} */ b) => (K.k.get(a).recall || 0) - (K.k.get(b).recall || 0));
      out.push(...items.slice(0, 2));
      if (out.length >= 12) break;
    }
    return out.slice(0, 12);
  }

  /**
   * A study button: remembers the group it was started from, so the map comes back to it after the round.
   * @param {string} href @param {string} text @param {boolean} primary
   */
  function studyLink(href, text, primary) {
    return h('a', { class: ['btn', 'pressable', primary && 'btn-primary'], href, onclick: () => {
      const L = layout(mode), gi = openGroupIdx >= 0 ? openGroupIdx : openItem >= 0 ? L.G[openItem] : -1;
      const key = gi >= 0 ? L.groups[gi]?.key : null;
      if (key) setPrefs(store, s => ({ ...s, ret: { mode, key, at: Date.now() } }));
    } }, text);
  }

  /**
   * What a group offers to study: the counts, "Study next" in map states, and the study and cluster buttons. Shared by
   * the sheet and the List view.
   * @param {number} gi @param {any} D loadDetails() or null @param {boolean} inList
   */
  function groupParts(gi, D, inList) {
    const L = layout(mode), g = L.groups[gi], cn = counts[gi], ids = idsOf(g);
    const words = ids.filter((/** @type {string} */ x) => x.startsWith('W:'));
    const phrases = ids.filter((/** @type {string} */ x) => x.startsWith('K:'));
    const concepts = ids.filter((/** @type {string} */ x) => x.startsWith('GC:'));
    const pool = words.length ? words : phrases.length ? phrases : ids;
    const next = nextUp(pool, stateOf, weight, STUDY_N);
    const stack = h('div', { class: 'ex-stack', 'aria-hidden': 'true' },
      ...STATES.map(s => (cn[s] ? h('span', { class: `is-${s}`, style: { flexGrow: String(cn[s]) } }) : null)));
    const countsEl = h('p', { class: 'ex-counts caption tnum' }, ...STATES.map(s => h('span', null, swatch(s), t(`explore.sheet.${s}`, { n: num(cn[s]) }))));
    /** @type {any[]} */ const out = [stack, countsEl];
    /** @type {any[]} */ const acts = [];
    if (next.length) {
      if (!inList) {
        out.push(h('h3', { class: 'ex-next-title label' }, t('explore.sheet.next')),
          h('ul', { class: 'ex-next', lang: 'de' }, ...next.map(x => {
            const j = /** @type {number} */ (A.index.get(x)), s = stateOf(x), k = s.today ? 'today' : s.state;
            return h('li', null, h('button', { type: 'button', class: 'ex-next-item pressable', onclick: () => goTo(j) },
              swatch(k), h('span', { class: 'ex-w' }, ...word(j)), h('span', { class: 'sr-only', lang: 'en' }, `, ${t(`explore.state.${k}`)}`)));
          })));
      }
      if (pool === words) {
        const studyIds = next.filter(x => !/[…()[\]]/.test(A.text[/** @type {number} */ (A.index.get(x))])).map(x => x.slice(2));
        if (studyIds.length) acts.push(studyLink(`#/practice/round?kind=cluster%3Apick&ids=${encodeURIComponent(studyIds.join(','))}&from=map`, t('explore.sheet.study', { n: studyIds.length }), true));
        // Quick sort (Practice): every word of the group not known yet, Know or Learn one at a time
        const sortIds = words.filter((/** @type {string} */ x) => stateOf(x).state !== 'known' && !/[…()[\]]/.test(A.text[/** @type {number} */ (A.index.get(x))])).map((/** @type {string} */ x) => x.slice(2));
        if (sortIds.length > 1) acts.push(studyLink(`#/practice/sort?ids=${encodeURIComponent(sortIds.join(','))}&title=${encodeURIComponent(labelOf(g))}&from=map`, t('explore.sheet.sort', { n: sortIds.length }), false));
        if (!c.newItems && studyIds.length && studyIds.every(w => stateOf(`W:${w}`).state === 'unseen')) out.push(h('p', { class: 'caption ex-note' }, t('explore.sheet.noNew')));
      } else if (D && pool === phrases) {
        const askable = nextUp(phrases.filter((/** @type {string} */ x) => D.roundId(x)), stateOf, weight, STUDY_N).map(x => D.roundId(x));
        if (askable.length) acts.push(studyLink(`#/practice/round?kind=${encodeURIComponent(`pick:${askable.join(',')}`)}&from=map`, t('explore.sheet.studyPhrases', { n: askable.length }), true));
        else out.push(h('p', { class: 'caption ex-note' }, t('explore.sheet.phrasesNotInRounds')));
      } else if (D && concepts.length) {
        const cids = next.map(x => x.slice(3)), gids = grammarIds(cids, D);
        const nC = new Set(gids.map(x => cids.find(cid => (K.k.maps.concepts[cid] || []).includes(x)))).size;
        if (gids.length) acts.push(studyLink(`#/practice/round?kind=${encodeURIComponent(`pick:${gids.join(',')}`)}&from=map`, t('explore.sheet.studyGrammar', { n: nC }), true));
      }
    } else out.push(h('p', { class: 'ex-allknown' }, t('explore.sheet.allKnown')));
    if (g.cluster) { const [ty, cid] = String(g.cluster).split(/:(.*)/); acts.push(h('a', { class: ['btn', 'pressable', !acts.length && 'btn-primary'], href: `#/practice/clusters/${ty}/${encodeURIComponent(cid)}` }, t('explore.sheet.cluster'))); }
    return { parts: out, actions: acts.length ? h('div', { class: 'ex-actions' }, ...acts) : null };
  }

  /** @param {number} gi @param {boolean} far @param {{fly?: boolean, opener?: HTMLElement | null, keep?: boolean}} [opt] */
  async function openGroup(gi, far, { fly = true, opener: from, keep = false } = {}) {
    openGroupIdx = gi; openItem = -1;
    cur().selectGroup(gi);
    const g = layout(mode).groups[gi], cn = counts[gi];
    const head = [h('p', { class: 'ex-meta caption' }, h('span', null, t(`explore.mode.${mode}`))),
      h('h2', { id: 'ex-sheet-title', class: 'ex-group-title' }, labelOf(g)),
      h('p', { class: 'ex-group-known' }, t('explore.known', { k: num(cn.known), n: num(cn.n) }))];
    const draw = (/** @type {any} */ D) => { const p = groupParts(gi, D, false); replace(sheetBody, ...head, p.actions, ...p.parts); };
    draw(null);
    if (!keep) crossfade();
    showSheet(keep ? undefined : from === undefined ? null : from);
    if (fly) void cur().flyToGroup(gi, { below: sheetBelow(), right: sheetRight() });
    // 3D: the words to study next get the open tile hovering over them
    if (view === '3d' && palace) palace.studyTiles(studyNext(gi).map(x => /** @type {number} */ (A.index.get(x))));
    void far;
    const D = await loadDetails(ctx, K.k.maps).catch(() => null);
    if (alive && openGroupIdx === gi && D) {
      const had = document.activeElement && sheet.contains(document.activeElement);
      draw(D);
      if (had) /** @type {HTMLElement | null} */ (sheetBody.querySelector('h2'))?.focus({ preventScroll: true });
    }
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
  let sayTimer = 0;
  offs.push(() => clearTimeout(sayTimer));
  function runSearch() {
    const hits = folded ? find(A, folded, english, findInput.value) : [];
    clearTimeout(sayTimer);
    if (!findInput.value.trim()) { replace(findList); return; }
    sayTimer = window.setTimeout(() => announce(t('explore.find.count', { n: hits.length })), 700);
    if (!hits.length) { replace(findList, h('li', { class: 'ex-find-none caption' }, t('explore.find.none'))); return; }
    replace(findList, ...hits.map(i => h('li', null, h('button', { type: 'button', class: 'ex-find-hit pressable', onclick: () => { closeSearch(); goTo(i); } },
      h('span', { class: 'ex-find-de', lang: 'de' }, ...word(i)),
      h('span', { class: 'ex-find-meta caption' }, `${t(`explore.state.${stateKey(i)}`)} · ${A.level[i]}`)))));
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
      d.addEventListener('toggle', async () => {
        if (!d.open || d.dataset.done) return;
        d.dataset.done = '1';
        const body = h('div', { class: 'ex-lbody' });
        const items = h('ul', { class: 'ex-litems' }, ...g.items.map((/** @type {number} */ i) => {
          const k = stateKey(i);
          return h('li', null,
            h('button', { type: 'button', class: 'ex-litem pressable', lang: 'de', onclick: (/** @type {Event} */ e) => (sel.on ? void sel.toggle(i, /** @type {HTMLElement} */ (e.currentTarget)) : openWord(i, { fly: false, opener: /** @type {HTMLElement} */ (e.currentTarget) })) },
              swatch(k), h('span', { class: 'ex-w' }, ...word(i))),
            h('span', { class: ['caption', `ex-lstate is-${k}`], lang: 'en' }, t(`explore.state.${k}`)));
        }));
        const fill = (/** @type {any} */ D) => { const p = groupParts(gi, D, true); replace(body, ...p.parts, p.actions); };
        fill(null);
        d.append(body, items);
        const D = await loadDetails(ctx, K.k.maps).catch(() => null);
        if (alive && D) fill(D);
      });
      return d;
    }));
  }

  /* ---------- keys ---------- */
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== 'Escape') return;
    if (!findEl.hidden) closeSearch();
    else if (!distPanel.hidden) { closeDistricts(); distBtn.focus(); }
    else if (legend.classList.contains('is-open')) { closeKey(); keyBtn.focus(); }
    else if (!sheet.hidden) closeSheet({ restore: true });
    else if (sel.on) sel.set(false);
  };
  document.addEventListener('keydown', onKey);
  offs.push(() => document.removeEventListener('keydown', onKey));
  const onDown = (/** @type {PointerEvent} */ e) => {
    const tg = /** @type {Node} */ (e.target);
    if (legend.classList.contains('is-open') && !legend.contains(tg) && !keyBtn.contains(tg)) closeKey();
    if (!distPanel.hidden && !distPanel.contains(tg) && !distBtn.contains(tg)) closeDistricts();
  };
  document.addEventListener('pointerdown', onDown);
  offs.push(() => document.removeEventListener('pointerdown', onDown));

  /* ---------- what the address asks to open ---------- */
  const at = q.get('at');
  if (at && A.index.has(at)) { const i = A.index.get(at); if (map.has(i)) { map.camera = { x: map.layout.X[i] + A.W[i] / 2, y: map.layout.Y[i], k: 1.2 }; openWord(i, { fly: false }); } }
  else if (tgi >= 0) {
    if (listOn) { const d = /** @type {HTMLDetailsElement | null} */ (listEl.querySelectorAll('details')[tgi]); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }
    else if (view === 'map') requestAnimationFrame(() => openGroup(tgi, true));
    // in 3D the group opens after the tilt and the learned moments (setView)
  }
  if (q.get('cluster') || q.get('g')) address();
  // List or 3D from the address or the saved view (3D tilts up once a day, else it opens raised)
  if (view !== 'map') void setView(view, true, { target: tgi });

  // benchmarks for the performance report (localhost only)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    /** @type {any} */ (window).__explore = { map, setMode, setView, bench: () => map.bench(), stats: () => map.stats(), A, K: () => K, get palace() { return palace; }, openGroup, openWord, queueMoments, playMoments,
      /** the device's 3D record (get, or set with an argument) */ record: (/** @type {any} */ v) => (v === undefined ? store.get('palace', null) : store.set('palace', v)) };
    offs.push(() => { delete /** @type {any} */ (window).__explore; });
  }
  return { unmount: cleanup };
}

/**
 * The map group of a Practice word cluster ('family:fallen', 'opp:place', 'topic:home'): its mode and group key.
 * @param {any} A loadAtlas() @param {string} cluster @returns {{mode: string, key: string} | null}
 */
function clusterGroup(A, cluster) {
  for (const m of ['family', 'opp', 'topic']) {
    const g = (A.modes[m] || []).find((/** @type {any} */ x) => x.cluster === cluster);
    if (g) return { mode: m, key: g.key };
  }
  return null;
}

/** The way back to Look up (a chevron on a phone). @param {(k: string) => string} t */
const backLink = t => h('a', { class: 'ex-back pressable', href: '#/lookup', 'aria-label': t('explore.back') }, icon('prev', { size: 16 }), h('span', { class: 'ex-back-text' }, t('explore.back')));

/** Is WebGL2 there (without loading the 3D module)? */
function webgl2() {
  try { const gl = document.createElement('canvas').getContext('webgl2'); /** @type {any} */ (gl)?.getExtension('WEBGL_lose_context')?.loseContext(); return !!gl; } catch { return false; }
}

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
