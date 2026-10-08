/* Word building, once the app has started (round 7): a word's family as a sheet over a round. A word sheet inside a
   round ("Family: stellen ›", features/shared/family-link.js) emits 'family:open' {root, form} on the bus; this opens
   the family view in a bottom sheet with that form open, so the round keeps its state and Esc or the grab handle
   returns to it. main.js runs this through the registry (startFeatures), so core never imports a feature. */
import { sheet } from '../shared/textview.js';

/** @param {{store: any, bus: any, t: (k: string, v?: any) => string, toast: (text: string) => void, log: (where: string, e: unknown) => void, clock?: any, settings?: () => any, content?: any, app?: any}} app */
export async function start(app) {
  if (!app.bus || !app.content || !app.clock || !app.settings) return;
  /** @type {(() => void) | null} */ let open = null;
  app.bus.on('family:open', async (/** @type {{root: string, form: string | null}} */ hit) => {
    if (open || !hit || !hit.root) return;
    const host = document.createElement('div');
    /** @type {any} */ let cleanup = null;
    const sh = sheet({ title: app.t('build.family.title'), cls: 'fam-sheet', children: [host], onClose: () => { open = null; if (typeof cleanup === 'function') cleanup(); } });
    open = sh.close;
    try {
      const { mountFamily } = await import('./family.js');
      const query = new URLSearchParams(hit.form ? { w: hit.form } : {});
      const ctx = { store: app.store, clock: app.clock, settings: app.settings, content: app.content, bus: app.bus, t: app.t, toast: app.toast, app: app.app,
        params: { rest: hit.root }, query, go: () => {}, refreshShell: () => {}, route: '/practice/build/*' };
      cleanup = await mountFamily(host, /** @type {any} */ (ctx), hit.root, { sheet: true, close: sh.close });
    } catch (e) { app.log('family sheet', e); sh.close(); }
  });
}
