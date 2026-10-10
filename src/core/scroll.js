/* Back returns to where you were (round 8, lane U1; design review B1).

   Every history entry the router shows gets a key in history.state (`k`). When a view is left, the page's scrollY is
   kept for its key, in memory and (for a reload or an iOS tab that Safari brought back) as `y` in that entry's
   history.state. When the router arrives at an entry that already has a key and is not the view on screen (Back,
   Forward, a reload), it scrolls back to that y once the view has drawn. A new navigation, a `replace`, and a refresh of
   the same entry still start at the top.

   Restoring waits for the content: a view that draws its list after an async step makes the page tall enough later,
   so restore() keeps trying while the page grows (ResizeObserver) and stops when the y is reached, when the person
   scrolls, taps or types, when a text field has the focus (core/keyboard.js moves the page then), when the signal
   aborts (a newer navigation), or after `ms`.

   history.scrollRestoration is 'manual', so Safari and Chrome never scroll on their own on Back.
   Pure parts (memo, landing) are tested in tests/unit/scroll.test.mjs; restore() takes its browser parts as `env`. */

/**
 * The y per entry key, newest last; the oldest key goes when there are more than `max`.
 * @param {number} [max]
 */
export function createMemo(max = 60) {
  /** @type {Map<string, number>} */
  const ys = new Map();
  return {
    /** @param {string | null | undefined} key @param {number} y */
    save(key, y) {
      if (!key || !Number.isFinite(y)) return;
      ys.delete(key);
      ys.set(key, Math.max(0, Math.round(y)));
      while (ys.size > max) ys.delete(/** @type {string} */ (ys.keys().next().value));
    },
    /** @param {string | null | undefined} key @returns {number | undefined} */
    get(key) { return key ? ys.get(key) : undefined; },
    get size() { return ys.size; },
  };
}

/**
 * At most `n` calls in any `ms` (pure, `now` injected). Safari throws on the 101st replaceState in 10 s, and the router
 * and the views use replaceState too, so this module keeps to a share of that and skips a write past it (that entry
 * then starts at the top on Back, which is what every entry did before).
 * @param {number} n @param {number} ms @param {() => number} now
 */
export function budget(n, ms, now) {
  /** @type {number[]} */ const at = [];
  return () => {
    const t = now();
    while (at.length && t - at[0] >= ms) at.shift();
    if (at.length >= n) return false;
    at.push(t);
    return true;
  };
}

/** A key for a new history entry. */
export const newKey = () => Math.random().toString(36).slice(2, 10);

/**
 * Where an arrival lands (pure): the y to restore, or null for the top.
 * @param {{state: any, shownKey: string | null, memo: ReturnType<typeof createMemo>}} o
 *   state: the arriving entry's history.state; shownKey: the key of the view on screen when the navigation started
 * @returns {number | null}
 */
export function landing({ state, shownKey, memo }) {
  const k = state && typeof state.k === 'string' ? state.k : null;
  if (!k || k === shownKey) return null;           // a new entry, or the same one shown again
  const y = memo.get(k) ?? (typeof state.y === 'number' && Number.isFinite(state.y) ? state.y : null);
  return y != null && y > 0 ? y : null;
}

/**
 * @typedef {object} ScrollEnv
 * @property {() => number} y              the page's scrollY
 * @property {(y: number) => void} to      scroll there at once (no smooth scrolling)
 * @property {() => number} max            the furthest the page can scroll now
 * @property {(fn: () => void) => () => void} onGrow   call fn when the page's size changes; returns a stop
 * @property {(fn: () => void) => () => void} onInput  call fn when the person scrolls, taps or types; returns a stop
 * @property {() => boolean} typing        a text field has the focus (the keyboard owns the scroll then)
 * @property {(fn: () => void, ms: number) => () => void} after
 */

/**
 * Scroll to y now, and again while the page grows into it. Once there, it keeps watching until the page has been still
 * for `quiet` ms: a view that redraws (its list replaced after a data load) shrinks the page for a moment, the browser
 * clamps the scroll, and the redraw would otherwise leave the page higher up. Resolves with how it ended.
 * @param {number} y @param {{signal?: AbortSignal, env?: ScrollEnv, ms?: number, quiet?: number}} [o]
 * @returns {Promise<'reached' | 'input' | 'typing' | 'aborted' | 'timeout'>}
 */
export function restore(y, { signal, env = browserEnv(), ms = 2500, quiet = 400 } = {}) {
  return new Promise(resolve => {
    /** @type {(() => void)[]} */ const stops = [];
    let done = false;
    let stopQuiet = () => {};
    /** @param {'reached' | 'input' | 'typing' | 'aborted' | 'timeout'} why */
    const end = why => {
      if (done) return;
      done = true;
      stopQuiet();
      for (const s of stops) s();
      signal?.removeEventListener('abort', onAbort);
      resolve(why);
    };
    const onAbort = () => end('aborted');
    const step = () => {
      if (done) return;
      if (signal?.aborted) return end('aborted');
      if (env.typing()) return end('typing');
      const want = Math.min(y, env.max());
      if (Math.abs(env.y() - want) > 1) env.to(want);
      // there: end after a still moment (every change of size starts it again)
      stopQuiet();
      stopQuiet = env.max() >= y - 1 ? env.after(() => end('reached'), quiet) : () => {};
    };
    if (signal?.aborted) return end('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    step();
    if (done) return;
    stops.push(env.onGrow(step), env.onInput(() => end('input')), env.after(() => end('timeout'), ms));
  });
}

/** The browser's parts for restore(). @returns {ScrollEnv} */
export function browserEnv() {
  const doc = document.scrollingElement || document.documentElement;
  return {
    y: () => scrollY,
    to: y => scrollTo({ top: y, left: 0, behavior: 'instant' }),   // 'instant', not 'auto': that follows scroll-behavior
    max: () => Math.max(0, doc.scrollHeight - innerHeight),
    onGrow(fn) {
      if (typeof ResizeObserver !== 'function') return () => {};
      const ro = new ResizeObserver(() => fn());
      ro.observe(document.body);
      return () => ro.disconnect();
    },
    onInput(fn) {
      const ctrl = new AbortController();
      for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) addEventListener(type, fn, { capture: true, passive: true, signal: ctrl.signal });
      return () => ctrl.abort();
    },
    typing() {
      const a = /** @type {HTMLElement | null} */ (document.activeElement);
      return document.body.classList.contains('kb') || !!a && (a.tagName === 'TEXTAREA' || a.isContentEditable
        || (a.tagName === 'INPUT' && /^(|text|search|email|number|password|tel|url)$/i.test(a.getAttribute('type') || '')));
    },
    after(fn, ms) { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  };
}

/**
 * The browser side the router uses. An entry gets its key in history.state only once its page has been scrolled (a
 * page left at the top needs nothing kept), together with its y, at most every 300 ms and right before a tap or a
 * key press that may navigate. That keeps this module's replaceState calls few: Safari throws on the 101st in 10 s,
 * and the router and the views use it too.
 */
export function createScrollKeeper() {
  const memo = createMemo();
  /** the key of the entry whose view is on screen */
  let shown = /** @type {string | null} */ (null);
  /** a navigation has started and its view is not on screen yet: the current entry is not the shown view's */
  let moving = false;
  /** the arriving entry is new (no key yet: a link or a tab, not Back or Forward), and the hash of the view before it */
  let fresh = false, prevHash = /** @type {string | null} */ (null);
  /** entry key -> the hash of the page it was opened from, in memory (no extra replaceState: Safari allows 100 in 10 s) */
  const fromOf = new Map();
  let timer = 0;
  /* the y of the view on screen, from its scroll events. leave() uses this, not scrollY at the time: on Back and
     Forward WebKit has already moved the page (to the top) when hashchange fires. */
  let lastY = 0;
  const may = budget(40, 10_000, () => performance.now());
  const write = () => {
    if (timer) { clearTimeout(timer); timer = 0; }
    const st = history.state;
    const k = st && typeof st === 'object' && typeof st.k === 'string' ? st.k : null;
    if (!shown || moving || (k && k !== shown)) return;   // never one view's y into another entry
    if (k && st.y === lastY) return;
    if (!k && lastY === 0) return;
    if (!may()) return;
    try { history.replaceState({ ...(st && typeof st === 'object' ? st : {}), k: shown, y: lastY }, ''); } catch { /* sandbox: memory has it */ }
  };
  const keeper = {
    start() {
      try { history.scrollRestoration = 'manual'; } catch { /* old browser */ }
      addEventListener('scroll', () => {
        if (!shown || moving) return;
        lastY = Math.round(scrollY);
        if (!timer) timer = /** @type {any} */ (setTimeout(write, 300));
      }, { passive: true });
      // before a tap or a key that may navigate, and before iOS puts the tab away: the y written now
      const flush = () => { if (timer) write(); };
      for (const type of ['pointerdown', 'keydown', 'pagehide']) addEventListener(type, flush, { capture: true, passive: true });
    },
    /** The view on screen is being left: keep its y. */
    leave() { if (shown) memo.save(shown, lastY); },
    /** The key of the current entry (a new one for an entry that has none yet) and where it lands. @returns {{key: string, y: number | null}} */
    arrive() {
      if (timer) { clearTimeout(timer); timer = 0; }
      moving = true;
      const st = history.state;
      fresh = !(st && typeof st === 'object' && typeof st.k === 'string');
      const key = fresh ? newKey() : st.k;
      return { key, y: landing({ state: st, shownKey: shown, memo }) };
    },
    /**
     * A view is on screen now for this key. A new entry remembers the hash of the view it was opened from: an in-app
     * back link to that hash goes Back instead (core/ui.js backLink, cameFrom), and keeps its place. A replace keeps the
     * entry's key (router setHash keeps history.state), so it keeps its `from` too. @param {string} key
     */
    shown(key) {
      shown = key; moving = false; lastY = Math.round(scrollY);
      if (fresh && prevHash != null) fromOf.set(key, prevHash);
      fresh = false;
      prevHash = location.hash;
    },
    /** The hash the entry on screen was opened from, when this session saw it opened. */
    from() { return shown ? fromOf.get(shown) ?? null : null; },
    /** Scroll back to y once the view has drawn (see restore()). @param {number} y @param {AbortSignal} signal */
    restore(y, signal) { return restore(y, { signal }); },
    /** No view is on screen (the error view, or a mount in flight). */
    clear() { shown = null; },
    memo,
  };
  active = keeper;
  return keeper;
}

/** The app's keeper (main.js creates one). @type {{ from: () => string | null } | null} */
let active = null;
/** True when the entry on screen was opened from `hash` (a link or a tab on that page): Back goes there. @param {string} hash */
export function cameFrom(hash) {
  return !!hash && active?.from() === hash && history.length > 1;
}
