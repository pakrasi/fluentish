/* Page side of the service worker (sw.js at the app root; its scope is the app root, e.g. /fluentish/).

   - Off on dev servers (localhost). `?sw=on` turns it on there, for trying the built site.
   - Registers on boot and checks again whenever the page becomes visible. The old Igloo site's swKill
     (language-doors site.js) unregisters every registration on the origin, this one included; it simply comes back.
   - Updates: the browser installs a new sw.js in the background and it waits. It is told to take over only while
     Today is showing (atRest(true)); the page then reloads once, if it is still on Today. Never mid-round or mid-exam.
   - Kill switch: version.json {"sw":"off"} unregisters only the registration whose scope is this app's root and deletes
     only caches named fluentish-*. Nothing here touches another app's service worker or caches. */

/**
 * @param {{ root: string, dev: boolean, devOptIn?: boolean, log?: (where: string, e: any) => void,
 *   nav?: any, win?: any }} o
 */
export function createSw({ root, dev, devOptIn = false, log = () => {}, nav = globalThis.navigator, win = globalThis }) {
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
      if (had) {
        if (had !== reg) { reg = had; watch(reg); }
        reg.update().catch(() => {});   // offline: keep the installed one
      } else {
        reg = await container.register(root + 'sw.js', { scope: root, updateViaCache: 'none' });
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
  };
}
