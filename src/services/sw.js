/* Page side of the service worker (sw.js at the app root; its scope is the app root, e.g. /fluentish/).

   - Off on dev servers (localhost). `?sw=on` turns it on there, for trying the built site.
   - Registers on boot and checks again whenever the page becomes visible. The old Igloo site's swKill
     (language-doors site.js) unregisters every registration on the origin, this one included; it simply comes back.
   - Updates: the browser installs a new sw.js in the background and it waits. It is told to take over only while
     Today is showing (atRest(true)); the page then reloads once, if it is still on Today. Never mid-round or mid-exam.
   - Language packs (C3a): the worker precaches the shared content and the active course's language pack. The pack is
     named on the script URL (sw.js?packs=fr); German keeps the plain sw.js every registration had before courses, so
     his registration never changes. A course in another language registers the other URL, which installs a worker
     with that pack; it takes over like any update (only on Today).
   - Kill switch: version.json {"sw":"off"} unregisters only the registration whose scope is this app's root and deletes
     only caches named fluentish-*. Nothing here touches another app's service worker or caches. The same deploy
     publishes a sw.js that does this by itself (tools/stamp.mjs killSw), for when the page can't run. */

/**
 * @param {{ root: string, dev: boolean, devOptIn?: boolean, log?: (where: string, e: any) => void,
 *   nav?: any, win?: any, pack?: () => string | null }} o   pack: the active course's language pack id ('de')
 */
export function createSw({ root, dev, devOptIn = false, log = () => {}, nav = globalThis.navigator, win = globalThis, pack = () => null }) {
  const container = nav?.serviceWorker;
  const enabled = !!container && (!dev || devOptIn);
  let atToday = false, applying = false, started = false;
  /** @type {any} */ let reg = null;
  const state = { status: enabled ? 'starting' : (container ? 'off' : 'unsupported'), version: /** @type {string | null} */ (null) };

  /** This app's own registration, never one for a wider scope such as the origin root. */
  async function ours() {
    const r = await container.getRegistration(root);
    return r && r.scope === root ? r : null;
  }

  /** The worker's script URL for the active course's pack: plain sw.js for German (and before a course exists). */
  function scriptUrl() {
    const p = pack();
    return root + 'sw.js' + (p && p !== 'de' && /^[a-z]{2,3}$/.test(p) ? `?packs=${p}` : '');
  }

  /** The script URL a registration runs (its newest worker's). @param {any} r */
  const runs = r => (r.installing || r.waiting || r.active || {}).scriptURL || null;

  async function kill() {
    for (const r of await container.getRegistrations()) if (r.scope === root) await r.unregister();
    const caches = win.caches;
    if (caches) for (const k of await caches.keys()) if (k.startsWith('fluentish-')) await caches.delete(k);
    reg = null;
    state.status = 'killed';
  }

  function apply() {
    if (!atToday || !reg?.waiting || !container.controller) return;
    applying = true;
    reg.waiting.postMessage('skipWaiting');
  }

  function watch(/** @type {any} */ r) {
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') apply(); });
    });
  }

  async function ensure() {
    try {
      const v = await win.fetch(root + 'version.json', { cache: 'no-store' }).then((/** @type {Response} */ r) => (r.ok ? r.json() : null)).catch(() => null);
      if (v) state.version = v.sha || null;
      if (v?.sw === 'off') { await kill(); return; }
      const had = await ours();
      const want = scriptUrl();
      const at = had ? runs(had) : null;
      if (had && at && new URL(at, win.location?.href || root).href !== new URL(want, win.location?.href || root).href) {
        // another course's pack: register its URL, which installs a worker with that pack (it waits like an update)
        const r = await container.register(want, { scope: root, updateViaCache: 'none' });
        if (r !== reg) { reg = r; watch(reg); }
      } else if (had) {
        if (had !== reg) { reg = had; watch(reg); }
        reg.update().catch(() => {});   // offline: keep the installed one
      } else {
        reg = await container.register(want, { scope: root, updateViaCache: 'none' });
        watch(reg);
      }
      state.status = 'registered';
      apply();
    } catch (e) {
      state.status = 'error';
      log('sw', e);
    }
  }

  return {
    state,
    /** Register (or re-register) and keep checking for updates while the app is open. */
    start() {
      if (!enabled || started) return;
      started = true;
      container.addEventListener('controllerchange', () => {
        // only a takeover this page asked for reloads it; a first install or a re-registration after Igloo's swKill
        // takes control silently
        if (applying && atToday) { applying = false; win.location.reload(); }
      });
      win.document?.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible') ensure(); });
      ensure();
    },
    /** @param {boolean} today  true while Today is showing: the only place an update may take over */
    atRest(today) {
      atToday = today;
      if (enabled && today) apply();
    },
    kill: () => (container ? kill() : Promise.resolve()),
    /** The active course's language changed: precache its pack (a no-op while the worker is off or already has it). */
    repack() { if (enabled && started) ensure(); },
  };
}

/**
 * When a new version may take over (main.js onMounted): only from Today, and only once Today has settled. Since round 8
 * (P3) Today draws first and prepares the day after (loading content, writing the day's stats), and a takeover is a
 * reload, so it waits for Today's 'today:settled'; `ms` is the fallback so an update never stalls. Every mount closes
 * the window first: a settle or a fallback from an earlier mount does nothing, and leaving Today cancels the wait.
 * Not covered (docs/ARCHITECTURE.md): Today's later redraws prepare again without closing the window.
 * @param {{ bus: { once: (name: string, f: () => void) => () => void }, sw: { atRest: (today: boolean) => void },
 *   ms?: number, later?: (f: () => void, ms: number) => any, cancel?: (h: any) => void }} o
 * @returns {(path: string) => void} call on every mount with the route's path
 */
export function takeoverGate({ bus, sw, ms = 10_000, later = (f, t) => setTimeout(f, t), cancel = h => clearTimeout(h) }) {
  let gen = 0;
  /** @type {(() => void) | null} */ let off = null;
  /** @type {any} */ let timer = null;
  const stop = () => { off?.(); off = null; if (timer != null) cancel(timer); timer = null; };
  return path => {
    const mine = ++gen;
    stop();
    sw.atRest(false);
    if (path !== '/today') return;
    const ready = () => { if (mine !== gen) return; stop(); sw.atRest(true); };
    off = bus.once('today:settled', ready);
    timer = later(ready, ms);
  };
}
