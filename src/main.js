/* Boot: open storage → profile (migrating legacy progress once) → apply device prefs → render the shell → route. */
import { docTitle } from './core/title.js';
import { bus } from './core/bus.js';
import { createClock } from './core/clock.js';
import { config, isDev } from './core/config.js';
import { t, setLocale } from './core/i18n.js';
import { h, replace, $ } from './core/dom.js';
import { icon } from './core/icons.js';
import { markNode } from './core/brand.js';
import { swap, toast as kitToast } from './core/motion.js';
import { startKeyboard } from './core/keyboard.js';
import { createRouter } from './core/router.js';
import { avatar } from './core/ui.js';
import { log, installErrorLog, attachLogStore } from './core/log.js';
import { createIdbAdapter } from './data/adapters/idb.js';
import { createMemoryAdapter } from './data/adapters/memory.js';
import { openSession } from './data/session.js';
import { normalizeSettings, defaultPrefs, examDate } from './data/settings.js';
import { createContent } from './data/content.js';
import { sync, restore, backup, backupFiles } from './data/sync/index.js';
import { startProgress } from './data/progress.js';
import { TABS, routes, startFeatures } from './features/registry.js';
import { createSw } from './services/sw.js';
import { loadRecordSchemas, recordChecker } from './data/records.js';
import { takeLink } from './core/link.js';
import { migrateConnections, resultsRepo, validRepo, connect, applyOwnerLink, OWNER } from './data/connection.js';
import { checkToken, keepCheck, recheck } from './data/sync/token-check.js';
import { setLanguage, language } from './core/lang.js';
import { hasMockExam } from './domain/modules.js';

// first, before anything can log or navigate: a device-link token in the address is taken out of it (core/link.js)
const link = takeLink();
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
  // the browser chrome follows the app's theme, not only the system's
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    if (prefs.theme === 'light' || prefs.theme === 'dark') m.setAttribute('content', canvas); else m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? '#0d0e11' : '#f4f4f1');
  }
  try { localStorage.setItem(config.keys.boot, JSON.stringify({ theme: prefs.theme, motion: prefs.motion })); } catch { /* private mode */ }
}

/** Review A3: a deployed site runs in shadow mode until the cutover marks this device migrated. */
function shadowByDefault() {
  if (isDev() || !config.deployShadow) return false;
  try { return !localStorage.getItem(config.keys.migrated); } catch { return true; }
}

async function main() {
  const q = new URLSearchParams(location.search);
  let adapter, durable = true;
  try { adapter = await createIdbAdapter(); } catch (e) { log('storage', e); adapter = createMemoryAdapter(); durable = false; }
  await attachLogStore(adapter);   // the error log survives a reload (core/log.js)
  // development only (a dev server or the e2e server, which serve schemas/records): every record written is checked
  // against its schema, and a mismatch is a console error (data/records.js). The deployed app loads no schema, and
  // neither does a page a service worker controls (?sw=on on localhost tries the built app as it ships, offline too).
  const check = isDev() && !navigator.serviceWorker?.controller ? await loadRecordSchemas(config.root).then(s => (s ? recordChecker(s) : null)) : null;
  if (check) {
    const put = adapter.putProfile.bind(adapter);
    adapter.putProfile = (/** @type {any} */ p) => { check('profile', 'profile', p); return put(p); };
  }

  /** @type {any} */ let store = null;
  const settings = () => normalizeSettings(store?.get('settings'));
  const clock = createClock({
    exam: () => examDate(settings()),   // the active course's goal.date (data/settings.js)
    now: () => new Date(),
    forcedToday: isDev() ? q.get('today') : null,   // ?today=YYYY-MM-DD on localhost only
  });
  const session = await openSession({
    adapter, legacyStorage: legacyStorage(), clock, bus,
    channel: () => ('BroadcastChannel' in self ? new BroadcastChannel('fluentish') : null),
    kind: q.has('shadow') || shadowByDefault() ? 'shadow' : 'local',
  });
  store = session.store;
  store.check = check;
  store.onWriteError = (/** @type {string} */ what) => toast(t('error.save', { what }));
  store.onDeleted = () => location.reload();   // "Delete all" in another tab
  applyPrefs(store.get('prefs'));
  bus.on('prefs:changed', () => applyPrefs(store.get('prefs')));
  setLanguage(settings().language);
  bus.on('settings:changed', ({ key }) => { if (key === 'language') setLanguage(settings().language); });
  // the owner's devices keep their repository and study hours file (data/connection.js; once per profile, additive)
  migrateConnections({ store, hlc: session.hlc, bus });
  // the device link from b1-token.py: checked with GitHub first, then stored through the secrets path (device scope,
  // never exported or synced); see docs/SHARING.md
  const linkOutcome = link ? await linkDevice(link) : null;
  /**
   * Link this device from a link: the token must reach the repository (the link's repo=, else the profile's, else the
   * owner's for a profile that connects none yet) and pass the token check. Returns the outcome's message key.
   * @param {{token: string, repo: string | null, expired: boolean}} l @returns {Promise<string>}
   */
  async function linkDevice(l) {
    if (l.expired) return 'expired';
    if (!l.token) return 'bad';
    const own = resultsRepo(store);
    const repo = l.repo && validRepo(l.repo) ? l.repo : own || OWNER.results;
    if (own && repo !== own) return 'otherRepo';   // a link never moves a profile to another repository
    /** @type {import('./data/sync/token-check.js').TokenCheck | null} */ let c = null;
    try {
      c = await Promise.race([checkToken({ token: l.token, repo, api: config.github.api }), new Promise(r => setTimeout(() => r(null), 12_000))]);
    } catch { c = null; }
    if (!c || c.status === 'offline') return 'offline';
    if (c.status !== 'ok') return c.status;   // 'refused' or 'denied': nothing is stored
    const a = { store, hlc: session.hlc, bus };
    if (repo === OWNER.results) applyOwnerLink(a);
    connect(a, repo, l.token);
    await keepCheck(store, l.token, c, clock.today());
    return c.warnings.includes('broad') || c.warnings.includes('noExpiry') ? 'okWarn' : 'ok';
  }
  const flush = () => { store.flush(); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  if (durable) navigator.storage?.persist?.().then(ok => { session.device.persisted = ok; }).catch(() => {});

  const content = createContent({ base: config.contentBase });
  const toast = (/** @type {string} */ text, /** @type {any} */ o = {}) => kitToast(text, o);
  const sw = createSw({ root: config.root, dev: isDev(), devOptIn: q.get('sw') === 'on', log, pack: () => language().code });
  // a course in another language: its pack is precached (after setLanguage above has made it active)
  bus.on('settings:changed', ({ key }) => { if (key === 'language') sw.repack(); });
  const app = { sw, hlc: session.hlc, device: session.device, profile: session.profile, adapter, durable, migration: session.migration };

  // ---------- shell ----------
  const navFor = (/** @type {string} */ where) => {
    const s = settings();
    // the Exam tab: an exam goal with mock tests (a date-only goal such as 'other' has the countdown, not the tab)
    const tabs = TABS.filter(tb => !tb.needsExam || hasMockExam(s));
    return h('nav', { class: `tabs tabs-${where}`, 'aria-label': t('nav.main'), style: { '--n': tabs.length } },
      tabs.map(tb => h('a', { href: tb.href, dataset: { tab: tb.id }, class: 'pressable' }, icon(tb.icon, { size: 22 }), h('span', null, t(tb.label)))),
      // the phone tab bar's accent dash is one element that slides under the current tab (styles/components.css)
      where === 'bottom' ? h('i', { class: 'tabs-dash', 'aria-hidden': 'true' }) : null);
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
  // The automatic merge of the other devices' backups (after the opt-in in Profile › Data) changes cards, so it runs
  // only while the app is at rest on Today or Profile, never mid-round or mid-exam; at most every 30 minutes.
  let atRest = false;
  const autoMerge = () => {
    if (!atRest || !navigator.onLine || !restore(store).autoMergeOn()) return;
    restore(store).merge().then(r => {
      const n = r ? r.counts.added + r.counts.updated + r.counts.removed : 0;
      if (r && r.applied) toast(t('restore.merged', { n }));
    }).catch((/** @type {any} */ e) => log('merge', e));
  };
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
  // leaving shadow mode (data/session.js keepPreview): the preview's work was merged; Today's notice has the counts
  if (session.previewKept) toast(t('preview.keptToast'), { ms: 8000 });
  if (session.cutoverError) toast(t('preview.retry'), { ms: 10000 });
  // a restore from the backup cut off last time was put back (data/restore.js)
  if (session.restoreRecovered === 'rolledBack') toast(t('restore.rolledBack'), { ms: 10000 });
  if (linkOutcome) toast(t(`conn.link.${linkOutcome}`), { ms: linkOutcome === 'ok' ? 6000 : 10000 });

  // the on-screen keyboard: --vv-h, --vv-top, --kb and body.kb for every typing screen (core/keyboard.js)
  startKeyboard({ bus });

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
      store, clock, settings, content, bus, t, toast, params, query, app, refreshShell, route: route.path,
      go: (/** @type {string} */ p, /** @type {any} */ o) => router.go(p, o),
    }),
    transition: update => swap(update, { kind: 'view', fallbackEl: /** @type {HTMLElement} */ ($('#view')) }),
    onMounted: ({ route }) => {
      markTab(route.tab || (route.path.startsWith('/profile') ? 'profile' : null));
      sw.atRest(route.path === '/today');   // a new version applies only from Today, never mid-round or mid-exam
      atRest = route.path === '/today' || route.path.startsWith('/profile');
      if (atRest) autoMerge();
      const h1 = $('#view h1');
      // a view that shows private text in its h1 (a script) names itself with data-title instead
      const custom = $('#view [data-title]')?.getAttribute('data-title') || null;
      document.title = docTitle({ h1: h1 ? h1.textContent : null, custom, path: route.path, name: config.name });
    },
    onError: (err, path) => {
      log('route', err);
      replace(/** @type {HTMLElement} */ ($('#view')), h('div', { class: 'stack page-pad' }, h('h1', null, t('error.title')), h('p', null, t('error.view', { path })), h('a', { class: 'btn', href: '#/today' }, t('error.home'))));
    },
  });
  await router.start();
  document.documentElement.classList.add('booted');
  sw.start();

  // what features do once the app has started (the exam keeps a Sprechen take a reload cut off)
  startFeatures({ store, bus, t, toast, log, clock, settings, content, app });

  // ---------- progress log ----------
  // one record per study day (data/progress.js): the past once per device (with the backup when this device is
  // linked), missed days, then today after study
  startProgress({ store, clock, content, bus, log, files: () => (backup(store).linked() && backup(store).allowed() && navigator.onLine ? backupFiles(store) : null) });

  // ---------- results sync ----------
  // On start and whenever the page becomes visible again, at most once a minute. sync() skips by itself when
  // the device is not linked or the profile is a shadow, uploads nothing until a migration's import notice has been
  // seen, and sends old unsent items only after the learner's tap. Its status reaches the views through the bus.
  const SYNC_EVERY_MS = 60_000;
  let lastSync = -Infinity;
  const autoSync = () => {
    if (!navigator.onLine || performance.now() - lastSync < SYNC_EVERY_MS) return;
    lastSync = performance.now();
    sync(store, { emit: (type, data) => bus.emit(type, data) })
      .catch((/** @type {any} */ e) => log('sync', e)).finally(autoMerge);
  };
  autoSync();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });
  addEventListener('online', autoSync);
  // the token on this device, checked with GitHub at most once a study day: scope, expiry (data/sync/token-check.js)
  if (navigator.onLine) recheck(store, { api: config.github.api, today: clock.today() })
    .then(c => { if (c?.status === 'refused') toast(t('conn.check.removedToast'), { ms: 12000 }); })
    .catch((/** @type {any} */ e) => log('token-check', e));
  bus.on('sync:request', () => { lastSync = performance.now(); sync(store, { force: true, emit: (type, data) => bus.emit(type, data) }).catch((/** @type {any} */ e) => log('sync', e)); });
}

main().catch(err => {
  log('boot', err);
  const v = document.getElementById('view');
  if (v) replace(v, h('div', { class: 'stack page-pad' }, h('h1', null, t('error.title')), h('p', null, t('error.boot'))));
});
