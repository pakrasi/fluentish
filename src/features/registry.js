/* The feature modules and their routes. Each feature owns everything under its path prefix and does its own
   sub-routing from ctx.params.rest, so stage-B work happens inside src/features/<id>/ without touching core.
   Contract: docs/CONTRIBUTING-FEATURES.md.

   view  () => import('./<id>/index.js')   exports mount(el, ctx)
   plan  () => import('./<id>/plan.js')    exports planItems(ctx), and optionally todayFeedback(ctx), todayModules(ctx)
   tab   the tab this feature lights up; null for pages reached from the avatar or links
   boot  () => import('./<id>/boot.js')    exports start(app): work the feature does once after the app has started
         (main.js runs it through startFeatures(), so core never imports a feature)

   A path is a pattern ('/practice/write/*') or {path, when}: a route that matches only when the query passes too.
   Order matters: the first match wins, so a feature that narrows another's path is listed before it.

   Features never import each other (tests/unit/feature-graph.test.mjs scans the import graph). Practice is a group
   of sibling features under #/practice (round, write, speak, script, clusters, build, and the hub); what they share
   lives in features/shared/ (a library: no routes, no plan, never imports a feature) and domain/. */

/**
 * @typedef {object} Feature
 * @property {string} id
 * @property {(string | {path: string, when: (q: URLSearchParams) => boolean})[]} paths
 * @property {string | null} tab
 * @property {() => Promise<any>} view
 * @property {(() => Promise<any>) | null} plan
 * @property {boolean} [chrome]   false: no header and tab bar (full-screen flows)
 * @property {boolean} [needsExam] the tab shows only when the profile has an exam goal
 * @property {() => Promise<any>} [boot]   a module whose start(app) runs once after the app has started
 */

/** A script's words round is #/practice/round?kind=script:<id> (the scripts own it, ahead of practice-round). */
const scriptRound = { path: '/practice/round', when: (/** @type {URLSearchParams} */ q) => /^script:/.test(q.get('kind') || '') };
/** Reading's review round is #/practice/round?kind=read (practice-read owns it, ahead of practice-round; round 4). */
const readRound = { path: '/practice/round', when: (/** @type {URLSearchParams} */ q) => q.get('kind') === 'read' };

/** @type {Feature[]} */
export const FEATURES = [
  { id: 'today', paths: ['/today'], tab: 'today', view: () => import('./today/index.js'), plan: null },
  { id: 'today-progress', paths: ['/today/progress'], tab: 'today', view: () => import('./today/progress/index.js'), plan: null },
  // Practice: sibling features under #/practice, listed before the hub so their paths win the match
  { id: 'build', paths: ['/practice/build', '/practice/build/*'], tab: 'practice', view: () => import('./build/index.js'), plan: () => import('./build/plan.js') },
  { id: 'practice-script', paths: [scriptRound, '/practice/scripts', '/practice/scripts/*'], tab: 'practice', view: () => import('./practice-script/index.js'), plan: () => import('./practice-script/plan.js') },
  { id: 'practice-conversation', paths: ['/practice/conversation', '/practice/conversation/*'], tab: 'practice', view: () => import('./practice-conversation/index.js'), plan: () => import('./practice-conversation/plan.js') },
  { id: 'practice-read', paths: [readRound, '/practice/read', '/practice/read/*'], tab: 'practice', view: () => import('./practice-read/index.js'), plan: () => import('./practice-read/plan.js'), boot: () => import('./practice-read/boot.js') },
  { id: 'practice-round', paths: ['/practice/round'], tab: 'practice', view: () => import('./practice-round/index.js'), plan: () => import('./practice-round/plan.js') },
  { id: 'practice-write', paths: ['/practice/write', '/practice/write/*'], tab: 'practice', view: () => import('./practice-write/index.js'), plan: () => import('./practice-write/plan.js') },
  { id: 'practice-speak', paths: ['/practice/speak', '/practice/speak/*', '/practice/situations', '/practice/situations/*', '/practice/teil2'], tab: 'practice', view: () => import('./practice-speak/index.js'), plan: () => import('./practice-speak/plan.js') },
  { id: 'practice-clusters', paths: ['/practice/clusters', '/practice/clusters/*', '/practice/sort', '/practice/known', '/practice/known/*'], tab: 'practice', view: () => import('./practice-clusters/index.js'), plan: () => import('./practice-clusters/plan.js') },
  { id: 'practice', paths: ['/practice', '/practice/*'], tab: 'practice', view: () => import('./practice/index.js'), plan: null },
  { id: 'exam', paths: ['/exam', '/exam/*'], tab: 'exam', needsExam: true, view: () => import('./exam/index.js'), plan: () => import('./exam/plan.js'), boot: () => import('./exam/boot.js') },
  // Explore lives under Look up (#/lookup/map); listed before lookup so its paths win the match
  { id: 'explore', paths: ['/lookup/map', '/lookup/map/*'], tab: 'lookup', view: () => import('./explore/index.js'), plan: null },
  { id: 'lookup', paths: ['/lookup', '/lookup/*'], tab: 'lookup', view: () => import('./lookup/index.js'), plan: null },
  { id: 'profile', paths: ['/profile', '/profile/*'], tab: null, view: () => import('./profile/index.js'), plan: null },
  { id: 'welcome', paths: ['/welcome'], tab: null, chrome: false, view: () => import('./welcome/index.js'), plan: null },
];

/** Tabs in bar order (UX §3.1). */
export const TABS = [
  { id: 'today', href: '#/today', icon: 'today', label: 'tab.today' },
  { id: 'practice', href: '#/practice', icon: 'practice', label: 'tab.practice' },
  { id: 'exam', href: '#/exam', icon: 'exam', label: 'tab.exam', needsExam: true },
  { id: 'lookup', href: '#/lookup', icon: 'lookup', label: 'tab.lookup' },
];

/** Router table built from the features. */
export const routes = () => FEATURES.flatMap(f => f.paths.map(p => ({ ...(typeof p === 'string' ? { path: p } : p), load: f.view, tab: f.tab, chrome: f.chrome !== false, feature: f.id })));

/**
 * Run every feature's boot module once the app has started (main.js). A failing one is logged and skipped.
 * @param {{store: any, bus: any, t: (k: string, v?: any) => string, toast: (text: string) => void, log: (where: string, e: unknown) => void}} app
 */
export async function startFeatures(app) {
  await Promise.all(FEATURES.filter(f => f.boot).map(async f => {
    try { await (await /** @type {() => Promise<any>} */ (f.boot)()).start(app); } catch (e) { app.log(`boot ${f.id}`, e); }
  }));
}

/** Every feature's plan module (for Today). */
export async function planProviders() {
  const mods = await Promise.all(FEATURES.filter(f => f.plan).map(async f => {
    try { return { id: f.id, mod: await /** @type {() => Promise<any>} */ (f.plan)() }; } catch (e) { console.error(`plan ${f.id}`, e); return null; }
  }));
  return mods.filter(Boolean);
}
