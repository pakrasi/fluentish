/* Hash router. Paths are shaped like an iOS navigation stack (#/exam/3/lesen), so a deep link maps one to one.

   parseHash, matchRoute and mapLegacy are pure and tested in node. createRouter adds the browser part: it listens to
   hashchange, maps old Igloo and B1 exam app links, runs the guard, asks the current view whether it may be left,
   loads the next view's module and mounts it (inside a view transition when one is given), then moves focus to the
   view's <h1> for screen readers.

   A view module exports mount(el, ctx). mount may be async and may return a cleanup function or
   { unmount?(), canLeave?(): boolean | Promise<boolean> }. See docs/CONTRIBUTING-FEATURES.md.

   Lifecycle (tests/unit/router-lifecycle.test.mjs):
   - every mount gets a fresh host element inside the view, so a slow mount that a newer navigation overtook writes
     into a detached node and never into the view on screen;
   - ctx.signal is aborted when the view is left, before its unmount runs, and as soon as a newer navigation starts
     while its mount is still in flight;
   - unmount runs exactly once, also for a mount that was overtaken (when it resolves);
   - canLeave() false keeps the view: its signal stays live and unmount does not run. */

/**
 * @typedef {object} Route
 * @property {string} path            '/today', '/exam/:test/:module', '/practice/*'
 * @property {() => Promise<any>} load  dynamic import of the view module
 * @property {string} [tab]           which tab is current while this route shows
 * @property {boolean} [chrome]       false hides the header and tab bar (rounds, the exam runner)
 * @property {string} [title]         i18n key for document.title
 * @property {(query: URLSearchParams) => boolean} [when]  matches only when the query passes too (listed before the
 *                                    route it narrows: '/practice/round' with kind=script:… goes to the scripts)
 */

/** @param {string} hash @returns {{path: string, query: URLSearchParams}} */
export function parseHash(hash) {
  let h = String(hash || '').replace(/^#/, '');
  const qi = h.indexOf('?');
  const query = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  if (qi >= 0) h = h.slice(0, qi);
  let path = '/' + h.replace(/^\/+/, '').replace(/\/+$/, '');
  try { path = decodeURI(path); } catch { /* keep as is */ }
  return { path, query };
}

/** @param {string} pattern */
function compile(pattern) {
  /** @type {string[]} */
  const keys = [];
  const src = pattern.replace(/\/$/, '').split('/').map(seg => {
    if (seg === '*') { keys.push('rest'); return '(?:/(.*))?'; }
    if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '/([^/]+)'; }
    return seg ? '/' + seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&') : '';
  }).join('');
  return { re: new RegExp(`^${src || '/'}$`), keys };
}

/** @type {WeakMap<object, ReturnType<typeof compile>>} */
const cache = new WeakMap();

/**
 * @param {Route[]} routes @param {string} path @param {URLSearchParams} [query]
 * @returns {{route: Route, params: Record<string, string>} | null}
 */
export function matchRoute(routes, path, query = new URLSearchParams()) {
  for (const route of routes) {
    if (route.when && !route.when(query)) continue;
    let c = cache.get(route);
    if (!c) { c = compile(route.path); cache.set(route, c); }
    const m = c.re.exec(path);
    if (m) {
      /** @type {Record<string, string>} */
      const params = {};
      c.keys.forEach((k, i) => { if (m[i + 1] != null) params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

const AREAS = /** @type {Record<string, string>} */ ({ words: 'words', sprechen: 'speaking', speaking: 'speaking', lesen: 'reading', reading: 'reading', grammar: 'grammar', situations: 'speaking' });
const LOOKUP = /** @type {Record<string, string>} */ ({ phrases: 'phrases', frames: 'frames?f=verbs', grammar: 'grammar', linking: 'grammar?g=linking', notes: 'grammar?g=notes' });

/**
 * Old links from Igloo (language-doors/app.html#…, index.html#…), from the B1 exam app (b1-exam/app/#/…) and from the
 * first plan's route names. Returns the new hash, or null when the hash is not a legacy one.
 * @param {string} hash
 * @returns {string | null}
 */
export function mapLegacy(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  // ---- B1 exam app: #/tag/N[/module][?review=ID], German section names ----
  let m = /^\/tag\/(\d+)(?:\/([a-z]+))?\/?(?:\?(.*))?$/.exec(raw);
  if (m) {
    const review = new URLSearchParams(m[3] || '').get('review');
    if (m[2] && review) return `#/exam/${m[1]}/${m[2]}/review/${encodeURIComponent(review)}`;
    return m[2] ? `#/exam/${m[1]}/${m[2]}` : `#/exam/${m[1]}`;
  }
  m = /^\/woerter(?:\/[a-z]*)?\/?(?:\?(.*))?$/.exec(raw);
  if (m) { const tag = new URLSearchParams(m[1] || '').get('tag'); return tag && /^\d+$/.test(tag) ? `#/lookup/words?test=${tag}` : '#/lookup/words'; }
  if (/^\/training(\/|$)/.test(raw)) return '#/practice/write';
  if (/^\/fortschritt\/?$/.test(raw)) return '#/exam';
  if (/^\/einstellungen\/?$/.test(raw)) return '#/profile';
  if (/^\/export\/?$/.test(raw)) return '#/profile/data';
  // ---- the first plan's names (never shipped, but cheap to keep working) ----
  m = /^\/(exams|library|settings|progress)(\/.*)?$/.exec(raw);
  if (m) return { exams: `#/exam${m[2] || ''}`, library: `#/lookup${m[2] || ''}`, settings: `#/profile${m[2] || ''}`, progress: '#/exam' }[m[1]] || null;
  if (raw.startsWith('/')) return null;
  // ---- Igloo: no leading slash ----
  m = /^b1(?:\/([^/?]+))?(?:\/([^/?]+))?/.exec(raw);
  if (m) {
    const [, a, b] = m;
    if (!a) return '#/practice';
    if (a === 'round') return '#/practice/round';
    if (a === 'missed') return '#/practice/round?kind=missed';
    if (a === 'aloud' || a === 'teil2') return `#/practice/speak/${a}`;
    if (a === 'frames') return '#/lookup/frames';
    if (a === 'grammar' && b && b !== 'round') return `#/practice/round?kind=topic:${encodeURIComponent(b)}`;
    if (AREAS[a]) return `#/practice/round?kind=area:${AREAS[a]}`;
    return '#/practice';
  }
  m = /^write(?:\/([^/?]+))?/.exec(raw);
  if (m) return m[1] ? `#/practice/write/${m[1]}` : '#/practice/write';
  m = /^lookup(?:\/([^/?]+))?/.exec(raw);
  if (m) return m[1] && LOOKUP[m[1]] ? `#/lookup/${LOOKUP[m[1]]}` : '#/lookup';
  if (/^(drill|test|practice)(\/|$)/.test(raw)) return '#/practice';
  if (/^(reference|chunks)(\/|$)/.test(raw)) return '#/lookup';
  if (/^(how|framework)$/.test(raw)) return '#/today';
  return null;
}

/**
 * @typedef {{unmount?: () => void, canLeave?: () => boolean | Promise<boolean>}} Cleanup
 * @typedef {{path: string, hash: string, cleanup: Cleanup | null, ctrl: AbortController}} Shown
 */

/**
 * A deep link kept through onboarding (#/welcome?next=…): only a path inside this app, never another site, never
 * Welcome itself. Returns the path with its query, or null.
 * @param {string | null | undefined} next
 * @returns {string | null}
 */
export function safeNext(next) {
  const n = String(next ?? '');
  if (!n || n.length > 512 || !n.startsWith('/') || n.startsWith('//') || /[\\\s]/.test(n) || /[\u0000-\u001f]/.test(n)) return null;
  const { path } = parseHash(n);
  if (path === '/' || path === '/welcome' || path.startsWith('/welcome/')) return null;
  return n;
}

/**
 * @typedef {{leave(): void, arrive(): {key: string, y: number | null}, shown(key: string): void, clear(): void,
 *   restore(y: number, signal: AbortSignal): Promise<unknown>}} ScrollKeeper
 */

/**
 * @param {object} o
 * @param {Route[]} o.routes
 * @param {HTMLElement} o.view                       the element views mount into (each mount gets a fresh child of it)
 * @param {(r: Route, params: Record<string,string>, query: URLSearchParams) => any} o.makeCtx   the router adds `signal`
 * @param {(path: string, r: Route | null) => string | null} [o.guard]  return a path to redirect to
 * @param {string} o.home                            path for '#/' and unknown paths
 * @param {(update: () => any) => Promise<void>} [o.transition]
 * @param {(info: {path: string, route: Route, params: Record<string,string>}) => void} [o.onMounted]
 * @param {(err: unknown, path: string) => void} [o.onError]
 * @param {ScrollKeeper} [o.scroll]                  Back returns to where you were (core/scroll.js); without it
 *                                                   every view starts at the top
 */
export function createRouter({ routes, view, makeCtx, guard, home, transition, onMounted, onError, scroll }) {
  /** the view on screen; null between leaving one view and the next mount resolving @type {Shown | null} */
  let current = null;
  /** the mount in flight; aborted as soon as a newer navigation starts @type {AbortController | null} */
  let pending = null;
  let token = 0;
  let restoring = false;

  const setHash = (/** @type {string} */ h) => { history.replaceState(history.state, '', h); };

  /** Leave a view: abort its signal first, then run its unmount. Callers take it out of `current` first, so a view is
      left exactly once. @param {{ctrl: AbortController, cleanup: Cleanup | null} | null} v */
  function leave(v) {
    if (!v) return;
    v.ctrl.abort();
    try { v.cleanup?.unmount?.(); } catch (e) { console.error(e); }
  }

  async function render() {
    if (restoring) {
      // canLeave kept the view: the hash went back in a new entry, which is the view's entry now
      restoring = false;
      if (scroll && current) scroll.shown(scroll.arrive().key);
      return;
    }
    // the view on screen is being left: keep its scroll position for Back (only while a view is on screen; during a
    // mount in flight the page shows the new host, not the old view)
    if (scroll && current) scroll.leave();
    const mine = ++token;
    // a mount still in flight will never be shown now: tell it to stop at once
    if (pending) { pending.abort(); pending = null; }
    const legacy = mapLegacy(location.hash);
    if (legacy) setHash(legacy);
    let { path, query } = parseHash(location.hash);
    if (path === '/') { setHash(`#${home}`); path = home; }
    let hit = matchRoute(routes, path, query);
    const redirect = guard ? guard(path, hit ? hit.route : null) : null;
    if (redirect && redirect !== path) { setHash(`#${redirect}`); return render(); }
    if (!hit) { setHash(`#${home}`); return render(); }
    if (current && current.cleanup && current.cleanup.canLeave && current.hash !== location.hash) {
      const ok = await current.cleanup.canLeave();
      if (!ok) { restoring = true; location.hash = current.hash; return; }
    }
    // a key on this history entry, and where it lands: Back and Forward return to the y it was left at
    const land = scroll ? scroll.arrive() : null;
    let mod;
    try { mod = await hit.route.load(); } catch (e) {
      if (mine !== token) return;
      // the error view replaces the old view's DOM, so the old view stops too
      const prev = current; current = null; leave(prev);
      scroll?.clear();
      onError?.(e, path);
      window.scrollTo(0, 0);
      return;
    }
    if (mine !== token) return;   // a newer navigation started while this one was loading
    const { route, params } = hit;
    const ctrl = new AbortController();
    pending = ctrl;
    const ctx = { ...makeCtx(route, params, query), signal: ctrl.signal };
    const update = async () => {
      // a newer navigation started before this ran (a view transition calls it a frame later): the screen is its now
      if (mine !== token) return;
      const prev = current; current = null; leave(prev);
      scroll?.clear();
      // a fresh host per mount: a mount that a newer navigation overtakes writes into a detached node, never the live view
      const host = document.createElement('div');
      host.className = 'view-host';
      view.replaceChildren(host);
      document.body.dataset.chrome = route.chrome === false ? 'off' : 'on';
      let ret;
      try { ret = await mod.mount(host, ctx); } catch (e) { if (mine === token) onError?.(e, path); }
      /** @type {Cleanup | null} */
      const cleanup = typeof ret === 'function' ? { unmount: ret } : ret || null;
      // a newer navigation took over while this mount was pending: its host is already detached, so it stops now
      if (mine !== token) { leave({ ctrl, cleanup }); return; }
      if (pending === ctrl) pending = null;
      current = { path, hash: location.hash, cleanup, ctrl };
      // inside the update, so a view transition's new state already shows the place; restore() keeps trying while
      // the view draws the rest after its first async step
      if (land && land.y != null) void scroll?.restore(land.y, ctrl.signal); else window.scrollTo(0, 0);
      if (land) scroll?.shown(land.key);
    };
    if (transition && current) await transition(update); else await update();
    if (mine !== token) return;
    const h1 = view.querySelector('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    onMounted?.({ path, route, params });
  }

  return {
    start() { addEventListener('hashchange', render); return render(); },
    /** @param {string} path @param {{replace?: boolean}} [o] */
    go(path, { replace = false } = {}) {
      const h = `#${path}`;
      if (location.hash === h) return render();
      if (replace) { setHash(h); return render(); }
      location.hash = h;
    },
    refresh: render,
    /** the path of the view on screen; null while a mount is in flight */
    get path() { return current?.path ?? null; },
  };
}
