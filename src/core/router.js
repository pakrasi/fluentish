/* Hash router. Paths are shaped like an iOS navigation stack (#/exam/3/lesen), so a deep link maps one to one.

   parseHash, matchRoute and mapLegacy are pure and tested in node. createRouter adds the browser part: it listens to
   hashchange, maps old Igloo and B1 exam app links, runs the guard, asks the current view whether it may be left,
   loads the next view's module and mounts it (inside a view transition when one is given), then moves focus to the
   view's <h1> for screen readers.

   A view module exports mount(el, ctx). mount may be async and may return a cleanup function or
   { unmount?(), canLeave?(): boolean | Promise<boolean> }. See docs/CONTRIBUTING-FEATURES.md. */

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
 * @param {object} o
 * @param {Route[]} o.routes
 * @param {HTMLElement} o.view                       the element views mount into
 * @param {(r: Route, params: Record<string,string>, query: URLSearchParams) => any} o.makeCtx
 * @param {(path: string, r: Route | null) => string | null} [o.guard]  return a path to redirect to
 * @param {string} o.home                            path for '#/' and unknown paths
 * @param {(update: () => any) => Promise<void>} [o.transition]
 * @param {(info: {path: string, route: Route, params: Record<string,string>}) => void} [o.onMounted]
 * @param {(err: unknown, path: string) => void} [o.onError]
 */
export function createRouter({ routes, view, makeCtx, guard, home, transition, onMounted, onError }) {
  /** @type {{path: string, hash: string, cleanup: null | {unmount?: () => void, canLeave?: () => any}} | null} */
  let current = null;
  let token = 0;
  let restoring = false;

  const setHash = (/** @type {string} */ h) => { history.replaceState(history.state, '', h); };

  async function render() {
    if (restoring) { restoring = false; return; }
    const mine = ++token;
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
    let mod;
    try { mod = await hit.route.load(); } catch (e) { onError?.(e, path); return; }
    if (mine !== token) return;   // a newer navigation started while this one was loading
    const { route, params } = hit;
    const ctx = makeCtx(route, params, query);
    const update = async () => {
      try { current?.cleanup?.unmount?.(); } catch (e) { console.error(e); }
      view.replaceChildren();
      document.body.dataset.chrome = route.chrome === false ? 'off' : 'on';
      let ret;
      try { ret = await mod.mount(view, ctx); } catch (e) { onError?.(e, path); }
      const cleanup = typeof ret === 'function' ? { unmount: ret } : ret || null;
      // a newer navigation mounted while this mount was pending: this view is already gone, so it stops now
      if (mine !== token) { try { cleanup?.unmount?.(); } catch (e) { console.error(e); } return; }
      current = { path, hash: location.hash, cleanup };
    };
    if (transition && current) await transition(update); else await update();
    if (mine !== token) return;
    const h1 = view.querySelector('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
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
    get path() { return current?.path ?? null; },
  };
}
