// Router lifecycle (arch F1): what createRouter does with the views it mounts and leaves. A small fake of the browser
// parts the router touches (location.hash, history.replaceState, hashchange, document.body, the view element) lets
// node drive real navigations, including two that overlap.
//
// Round 8 step 1 records today's behaviour as it is, including the overlap race: a slow mount that a newer navigation
// overtook still writes into the live #view, and the view it replaced is unmounted twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/core/router.js';

// ---------- a fake of the browser parts the router uses ----------

class El {
  /** @param {string} tag @param {string} [text] */
  constructor(tag, text = '') {
    this.tagName = tag.toUpperCase();
    this.text = text;
    this.className = '';
    /** @type {El[]} */ this.children = [];
    /** @type {El | null} */ this.parentNode = null;
    /** @type {Record<string, string>} */ this.attrs = {};
  }
  /** @param {El[]} kids */
  append(...kids) { for (const k of kids) { if (k.parentNode) k.parentNode.children = k.parentNode.children.filter(c => c !== k); k.parentNode = this; this.children.push(k); } }
  /** @param {El[]} kids */
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  /** tag selectors only @param {string} sel @returns {El | null} */
  querySelector(sel) {
    for (const c of this.children) {
      if (c.tagName === sel.toUpperCase()) return c;
      const d = c.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  /** @param {string} k @param {string} v */
  setAttribute(k, v) { this.attrs[k] = v; }
  focus() { env.focused = this; }
}

const env = {
  hash: '',
  /** @type {Function[]} */ hashListeners: [],
  /** @type {Promise<any>[]} */ renders: [],
  hashchanges: 0,
  scrolls: 0,
  /** @type {El | null} */ focused: null,
};

/** A fresh document with #view in it; returns the view element. */
function reset() {
  env.hash = ''; env.hashListeners = []; env.renders = []; env.hashchanges = 0; env.scrolls = 0; env.focused = null;
  const doc = new El('html');
  const view = new El('main');
  doc.append(view);
  const g = /** @type {any} */ (globalThis);
  g.location = {
    get hash() { return env.hash; },
    set hash(v) {
      const h = String(v).startsWith('#') ? String(v) : `#${v}`;
      if (h === env.hash) return;
      env.hash = h;
      // the browser queues hashchange as a task
      setTimeout(() => { env.hashchanges++; for (const f of env.hashListeners) env.renders.push(f()); }, 0);
    },
  };
  g.history = { state: null, replaceState(/** @type {any} */ _s, /** @type {string} */ _t, /** @type {string} */ h) { env.hash = h; } };
  g.addEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => { if (type === 'hashchange') env.hashListeners.push(fn); };
  g.window = { scrollTo() { env.scrolls++; } };
  g.document = { body: { dataset: {} }, createElement: (/** @type {string} */ tag) => new El(tag) };
  return view;
}

/** Let queued hashchanges, renders and resolved promises run (a pending gate stays pending). */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
}

function deferred() {
  /** @type {(v?: any) => void} */ let resolve = () => {};
  /** @type {(e?: any) => void} */ let reject = () => {};
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * A view module that records what happens to it. mount writes an <h1> with its name into the element it gets, after
 * `gate` resolves when one is given (a slow, async mount).
 * @param {string} name @param {{gate?: Promise<any>, canLeave?: () => any, throws?: boolean, fn?: boolean}} [o]
 */
function viewModule(name, o = {}) {
  const v = {
    name, mounts: 0, unmounts: 0,
    /** @type {El[]} */ els: [],
    /** @type {any[]} */ ctxs: [],
    /** @type {string[]} */ log: [],
    /** @param {El} el @param {any} ctx */
    async mount(el, ctx) {
      v.mounts++; v.els.push(el); v.ctxs.push(ctx);
      if (o.gate) await o.gate;
      if (o.throws) throw new Error(`${name} failed`);
      el.append(new El('h1', name));
      const unmount = () => { v.unmounts++; v.log.push(`unmount signal=${ctx.signal ? ctx.signal.aborted : 'none'}`); };
      return o.fn ? unmount : { unmount, canLeave: o.canLeave };
    },
  };
  return v;
}

/**
 * @param {El} view @param {Record<string, any>} views path → view module
 * @param {{transition?: (u: () => any) => Promise<void>, loads?: Record<string, Promise<any>>}} [o]
 */
function makeRouter(view, views, o = {}) {
  const errors = /** @type {{err: any, path: string}[]} */ ([]);
  const mounted = /** @type {string[]} */ ([]);
  const routes = Object.keys(views).map(path => ({
    path,
    load: async () => { if (o.loads?.[path]) await o.loads[path]; return views[path]; },
    chrome: path !== '/round' ? undefined : false,
  }));
  const router = createRouter({
    routes, view: /** @type {any} */ (view), home: '/x',
    makeCtx: (route, params, query) => ({ route: route.path, params, query }),
    transition: o.transition,
    onMounted: ({ path }) => { mounted.push(path); },
    onError: (err, path) => { errors.push({ err, path }); view.replaceChildren(new El('h1', 'error')); },
  });
  return { router, errors, mounted };
}

/** like core/motion.js swap() with View Transitions: the update runs a frame later, swap resolves when it is done */
const vt = async (/** @type {() => any} */ update) => { await new Promise(r => setTimeout(r, 0)); await update(); };

const shown = (/** @type {El} */ view) => view.textContent;

// ---------- basics ----------

test('start mounts the home route for an empty hash, focuses its h1 and reports it', async () => {
  const view = reset();
  const X = viewModule('X');
  const { router, mounted } = makeRouter(view, { '/x': X });
  await router.start();
  assert.equal(env.hash, '#/x');
  assert.equal(X.mounts, 1);
  assert.equal(shown(view), 'X');
  assert.equal(env.focused?.text, 'X');
  assert.equal(env.focused?.attrs.tabindex, '-1');
  assert.deepEqual(mounted, ['/x']);
  assert.equal(router.path, '/x');
});

test('an unknown path goes home', async () => {
  const view = reset();
  const X = viewModule('X');
  env.hash = '#/nope';
  const { router } = makeRouter(view, { '/x': X });
  await router.start();
  assert.equal(env.hash, '#/x');
  assert.equal(shown(view), 'X');
});

test('a navigation unmounts the old view once and mounts the new one; chrome follows the route', async () => {
  const view = reset();
  const X = viewModule('X'), R = viewModule('R', { fn: true });
  const { router, mounted } = makeRouter(view, { '/x': X, '/round': R });
  await router.start();
  assert.equal(/** @type {any} */ (globalThis).document.body.dataset.chrome, 'on');
  router.go('/round');
  await settle();
  assert.equal(X.unmounts, 1);
  assert.equal(R.mounts, 1);
  assert.equal(shown(view), 'R');
  assert.equal(/** @type {any} */ (globalThis).document.body.dataset.chrome, 'off');
  assert.deepEqual(mounted, ['/x', '/round']);
  router.go('/x');
  await settle();
  assert.equal(R.unmounts, 1, 'a cleanup function counts as unmount');
  assert.equal(X.mounts, 2);
});

test('go() to the current path mounts it again', async () => {
  const view = reset();
  const X = viewModule('X');
  const { router } = makeRouter(view, { '/x': X });
  await router.start();
  await router.go('/x');
  assert.equal(X.mounts, 2);
  assert.equal(X.unmounts, 1);
  assert.equal(shown(view), 'X');
});

// ---------- canLeave ----------

test('canLeave false: the view stays, is not unmounted, and the hash goes back', async () => {
  const view = reset();
  const X = viewModule('X', { canLeave: () => false }), Y = viewModule('Y');
  let loads = 0;
  const { router } = makeRouter(view, { '/x': X, '/y': { ...Y, mount: (/** @type {any} */ el, /** @type {any} */ c) => { loads++; return Y.mount(el, c); } } });
  await router.start();
  router.go('/y');
  await settle();
  assert.equal(env.hash, '#/x');
  assert.equal(X.unmounts, 0);
  assert.equal(loads, 0);
  assert.equal(shown(view), 'X');
  assert.equal(router.path, '/x');
  // today a view that stops on hashchange has stopped by now: the restore fires a second hashchange (arch F2)
  assert.equal(env.hashchanges, 2);
  // the restore's own hashchange is swallowed, and the next real navigation is asked again
  router.go('/y');
  await settle();
  assert.equal(env.hash, '#/x');
  assert.equal(X.unmounts, 0);
});

test('canLeave may answer later (a confirm sheet); true lets the navigation through', async () => {
  const view = reset();
  const answer = deferred();
  const X = viewModule('X', { canLeave: () => answer.promise }), Y = viewModule('Y');
  const { router } = makeRouter(view, { '/x': X, '/y': Y });
  await router.start();
  router.go('/y');
  await settle();
  assert.equal(shown(view), 'X');
  answer.resolve(true);
  await settle();
  assert.equal(X.unmounts, 1);
  assert.equal(shown(view), 'Y');
});

// ---------- errors ----------

test('mount throws: onError shows the error, the next navigation still works and nothing is unmounted twice', async () => {
  const view = reset();
  const X = viewModule('X'), B = viewModule('B', { throws: true });
  const { router, errors } = makeRouter(view, { '/x': X, '/b': B });
  await router.start();
  router.go('/b');
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, '/b');
  assert.equal(shown(view), 'error');
  assert.equal(X.unmounts, 1);
  router.go('/x');
  await settle();
  assert.equal(shown(view), 'X');
  assert.equal(X.unmounts, 1);
  assert.equal(X.mounts, 2);
});

test('load fails: onError runs; today the old view is not unmounted although its DOM is gone', async () => {
  const view = reset();
  const X = viewModule('X');
  const views = { '/x': X, '/y': viewModule('Y') };
  const fail = Promise.reject(new Error('offline'));
  fail.catch(() => {});
  const { router, errors } = makeRouter(view, views, { loads: { '/y': fail } });
  await router.start();
  router.go('/y');
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(shown(view), 'error');
  assert.equal(X.unmounts, 0, 'today: X keeps running behind the error view');
});

// ---------- replace navigations ----------

test('go(path, {replace: true}) fires no hashchange, but the old view is still unmounted', async () => {
  const view = reset();
  const X = viewModule('X'), Y = viewModule('Y');
  const { router } = makeRouter(view, { '/x': X, '/y': Y });
  await router.start();
  await router.go('/y', { replace: true });
  await settle();
  assert.equal(env.hashchanges, 0, 'a view that stops on hashchange never stops here (arch F2)');
  assert.equal(X.unmounts, 1);
  assert.equal(shown(view), 'Y');
});

// ---------- overlapping navigations ----------

test('a navigation that is still loading its module when a newer one starts never mounts', async () => {
  const view = reset();
  const slowLoad = deferred();
  const X = viewModule('X'), A = viewModule('A'), B = viewModule('B');
  const { router } = makeRouter(view, { '/x': X, '/a': A, '/b': B }, { loads: { '/a': slowLoad.promise } });
  await router.start();
  router.go('/a');
  await settle();
  router.go('/b');
  await settle();
  slowLoad.resolve();
  await settle();
  assert.equal(A.mounts, 0);
  assert.equal(B.mounts, 1);
  assert.equal(X.unmounts, 1);
  assert.equal(shown(view), 'B');
  assert.equal(router.path, '/b');
});

for (const withVT of [false, true]) {
  test(`overlap${withVT ? ' inside view transitions' : ''}: today the slow mount writes into the live view and the old view is unmounted twice`, async () => {
    const view = reset();
    const gate = deferred();
    const X = viewModule('X'), A = viewModule('A', { gate: gate.promise }), B = viewModule('B');
    const { router, mounted } = makeRouter(view, { '/x': X, '/a': A, '/b': B }, { transition: withVT ? vt : undefined });
    await router.start();
    router.go('/a');           // slow: its mount awaits content
    await settle();
    assert.equal(A.mounts, 1);
    router.go('/b');           // fast
    await settle();
    assert.equal(shown(view), 'B');
    gate.resolve();            // A's content arrives after B is on screen
    await settle();
    assert.equal(router.path, '/b');
    assert.deepEqual(mounted, ['/x', '/b']);
    assert.equal(A.unmounts, 1, 'A stops once');
    // the race (arch F1): A and B were given the same element, so A's late write lands in the live view
    assert.equal(A.els[0], B.els[0]);
    assert.equal(shown(view), 'BA');
    assert.equal(X.unmounts, 2, 'X is unmounted by A and again by B');
  });
}
