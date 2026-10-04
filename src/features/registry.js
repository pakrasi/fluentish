/* The feature modules and their routes. Each feature owns everything under its path prefix and does its own
   sub-routing from ctx.params.rest, so stage-B work happens inside src/features/<id>/ without touching core.
   Contract: docs/CONTRIBUTING-FEATURES.md.

   view  () => import('./<id>/index.js')   exports mount(el, ctx)
   plan  () => import('./<id>/plan.js')    exports planItems(ctx), and optionally todayFeedback(ctx), todayModules(ctx)
   tab   the tab this feature lights up; null for pages reached from the avatar or links */

/**
 * @typedef {object} Feature
 * @property {string} id
 * @property {string[]} paths
 * @property {string | null} tab
 * @property {() => Promise<any>} view
 * @property {(() => Promise<any>) | null} plan
 * @property {boolean} [chrome]   false: no header and tab bar (full-screen flows)
 * @property {boolean} [needsExam] the tab shows only when the profile has an exam goal
 */

/** @type {Feature[]} */
export const FEATURES = [
  { id: 'today', paths: ['/today'], tab: 'today', view: () => import('./today/index.js'), plan: null },
  { id: 'practice', paths: ['/practice', '/practice/*'], tab: 'practice', view: () => import('./practice/index.js'), plan: () => import('./practice/plan.js') },
  { id: 'exam', paths: ['/exam', '/exam/*'], tab: 'exam', needsExam: true, view: () => import('./exam/index.js'), plan: () => import('./exam/plan.js') },
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
export const routes = () => FEATURES.flatMap(f => f.paths.map(path => ({ path, load: f.view, tab: f.tab, chrome: f.chrome !== false, feature: f.id })));

/** Every feature's plan module (for Today). */
export async function planProviders() {
  const mods = await Promise.all(FEATURES.filter(f => f.plan).map(async f => {
    try { return { id: f.id, mod: await /** @type {() => Promise<any>} */ (f.plan)() }; } catch (e) { console.error(`plan ${f.id}`, e); return null; }
  }));
  return mods.filter(Boolean);
}
