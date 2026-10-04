/* Boot: open storage → profile (migrating legacy progress once) → apply device prefs → render the shell → route. */
import { bus } from './core/bus.js';
import { createClock } from './core/clock.js';
import { config, isDev } from './core/config.js';
import { t, setLocale } from './core/i18n.js';
import { h, replace, $ } from './core/dom.js';
import { icon } from './core/icons.js';
import { markNode } from './core/brand.js';
import { swap, toast as kitToast } from './core/motion.js';
import { createRouter } from './core/router.js';
import { avatar } from './core/ui.js';
import { log, installErrorLog } from './core/log.js';
import { createIdbAdapter } from './data/adapters/idb.js';
import { createMemoryAdapter } from './data/adapters/memory.js';
import { openSession } from './data/session.js';
import { normalizeSettings, defaultPrefs } from './data/settings.js';
import { createContent } from './data/content.js';
import { TABS, routes } from './features/registry.js';

installErrorLog();

/** localStorage for reading the legacy keys; null when the browser blocks it. */
function legacyStorage() {
  try { const s = window.localStorage; s.length; return s; } catch { return null; }
}

/** Theme, motion and locale on <html>; mirrored to localStorage so src/boot.js can set them before first paint. */
export function applyPrefs(p) {
  const prefs = { ...defaultPrefs(), ...(p || {}) };
  const root = document.documentElement;
  if (prefs.theme === 'light' || prefs.theme === 'dark') root.dataset.theme = prefs.theme; else delete root.dataset.theme;
  if (prefs.motion === 'reduce' || prefs.motion === 'full') root.dataset.motion = prefs.motion; else delete root.dataset.motion;
  setLocale(prefs.locale);
  try { localStorage.setItem(config.keys.boot, JSON.stringify({ theme: prefs.theme, motion: prefs.motion })); } catch { /* private mode */ }
}

async function main() {
  const q = new URLSearchParams(location.search);
  let adapter, durable = true;
  try { adapter = await createIdbAdapter(); } catch (e) { log('storage', e); adapter = createMemoryAdapter(); durable = false; }

  /** @type {any} */ let store = null;
  const settings = () => normalizeSettings(store?.get('settings'));
  const clock = createClock({
    exam: () => settings().exam.date,
    now: () => new Date(),
    forcedToday: isDev() ? q.get('today') : null,   // ?today=YYYY-MM-DD on localhost only
  });
  const session = await openSession({
    adapter, legacyStorage: legacyStorage(), clock, bus,
    channel: () => ('BroadcastChannel' in self ? new BroadcastChannel('fluentish') : null),
    kind: q.has('shadow') ? 'shadow' : 'local',
  });
  store = session.store;
  store.onWriteError = (/** @type {string} */ what) => toast(t('error.save', { what }));
  applyPrefs(store.get('prefs'));
  bus.on('prefs:changed', () => applyPrefs(store.get('prefs')));
  const flush = () => { store.flush(); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  if (durable) navigator.storage?.persist?.().then(ok => { session.device.persisted = ok; }).catch(() => {});

  const content = createContent({ base: config.contentBase });
  const toast = (/** @type {string} */ text, /** @type {any} */ o = {}) => kitToast(text, o);
  const app = { hlc: session.hlc, device: session.device, profile: session.profile, adapter, durable, migration: session.migration };

  // ---------- shell ----------
  const navFor = (/** @type {string} */ where) => {
    const s = settings();
    const tabs = TABS.filter(tb => !tb.needsExam || s.exam.type);
    return h('nav', { class: `tabs tabs-${where}`, 'aria-label': t('nav.main'), style: { '--n': tabs.length } },
      tabs.map(tb => h('a', { href: tb.href, dataset: { tab: tb.id }, class: 'pressable' }, icon(tb.icon, { size: 22 }), h('span', null, t(tb.label)))));
  };
  async function refreshShell() {
    const bar = /** @type {HTMLElement} */ ($('#bar-inner'));
    replace(bar,
      h('a', { class: 'brand', href: '#/today', 'aria-label': t('nav.home') }, markNode({ title: '' }), h('span', { class: 'wordmark', 'aria-hidden': 'true' }, 'Fluent', h('i', null, 'ish'))),
      navFor('top'),
      h('a', { class: 'avatar-link pressable', href: '#/profile', 'aria-label': t('nav.profile') }, avatar(session.profile, '')));
    replace(/** @type {HTMLElement} */ ($('#tabs-slot')), navFor('bottom'));
    if (session.profile.kind === 'shadow') {
      replace(/** @type {HTMLElement} */ ($('#banner')), h('p', { class: 'banner' }, t('shadow.banner')));
    }
    markTab(currentTab);
  }
  let currentTab = /** @type {string | null} */ (null);
  const markTab = (/** @type {string | null} */ id) => {
    currentTab = id;
    for (const a of document.querySelectorAll('.tabs a')) {
      if (/** @type {HTMLElement} */ (a).dataset.tab === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    const av = document.querySelector('.avatar-link');
    if (av) { if (id === 'profile') av.setAttribute('aria-current', 'page'); else av.removeAttribute('aria-current'); }
  };
  await refreshShell();
  bus.on('settings:changed', ({ key }) => { if (/^(exam|language|level)/.test(key)) refreshShell(); });
  bus.on('profile:changed', () => refreshShell());
  if (!durable) toast(t('error.noStorage'), { ms: 8000 });

  // ---------- router ----------
  const router = createRouter({
    routes: routes(),
    view: /** @type {HTMLElement} */ ($('#view')),
    home: '/today',
    guard: (path) => {
      const onboarded = !!settings().onboarded;
      if (!onboarded && path !== '/welcome') return '/welcome';
      if (onboarded && path === '/welcome') return '/today';
      return null;
    },
    makeCtx: (route, params, query) => ({
      store, clock, settings, content, bus, t, toast, params, query, app, refreshShell,
      go: (/** @type {string} */ p, /** @type {any} */ o) => router.go(p, o),
    }),
    transition: update => swap(update, { kind: 'view', fallbackEl: /** @type {HTMLElement} */ ($('#view')) }),
    onMounted: ({ route }) => {
      markTab(route.tab || (route.path.startsWith('/profile') ? 'profile' : null));
      const h1 = $('#view h1');
      document.title = h1 && route.path !== '/today' ? `${h1.textContent} · ${config.name}` : config.name;
    },
    onError: (err, path) => {
      log('route', err);
      replace(/** @type {HTMLElement} */ ($('#view')), h('div', { class: 'stack page-pad' }, h('h1', null, t('error.title')), h('p', null, t('error.view', { path })), h('a', { class: 'btn', href: '#/today' }, t('error.home'))));
    },
  });
  await router.start();
  document.documentElement.classList.add('booted');
}

main().catch(err => {
  log('boot', err);
  const v = document.getElementById('view');
  if (v) replace(v, h('div', { class: 'stack page-pad' }, h('h1', null, t('error.title')), h('p', null, t('error.boot'))));
});
