/* The feature-module contract, as types. Prose and examples: docs/CONTRIBUTING-FEATURES.md.

   A feature lives in src/features/<id>/ and is listed once in registry.js. It may export:
     index.js  mount(el, ctx: ViewCtx) → void | cleanup | { unmount?, canLeave? }    (required)
     plan.js   planItems(ctx: PlanCtx) → PlanItem[] | Promise<PlanItem[]>            (optional, for Today)
               todayFeedback(ctx: PlanCtx) → FeedbackRow[]                            (optional)
               todayModules(ctx: PlanCtx) → ModuleBar[]                               (optional)
   Features never import each other. They talk through the store, the bus and links (hrefs). */

/**
 * What Today passes to a plan provider. Everything is already loaded; providers stay synchronous and pure over it.
 * @typedef {object} PlanCtx
 * @property {import('../data/store.js').Store} store
 * @property {import('../core/clock.js').ClockCtx} c       today, exam date, phase, daysLeft, lastNewDay, capDay, …
 * @property {any} settings                                 normalised settings@1 (the exam date: data/settings.js examDate(), the active course's goal.date)
 * @property {any | null} exam                              the exam definition from content/manifest.json, or null
 * @property {(key: string, vars?: Record<string, any>) => string} t
 * @property {ReturnType<typeof import('../domain/allowance.js').todayPlan>} day  today's plan from the week (domain/allowance.js
 *                                                          todayPlan): kind, minutes, the practice slot and its minutes fitted
 *                                                          to today's reviews, why new items are fewer (round 4, L1b). A Normal
 *                                                          day of minutesPerDay with planned false when the course has no week.
 *                                                          A slot provider shows its row when day.slot is its kind.
 */

/**
 * What a view's mount() receives.
 * @typedef {object} ViewCtx
 * @property {import('../data/store.js').Store} store
 * @property {ReturnType<typeof import('../core/clock.js').createClock>} clock   clock.ctx() for the current context
 * @property {() => any} settings                           normalised settings, read fresh
 * @property {ReturnType<typeof import('../data/content.js').createContent>} content
 * @property {import('../core/bus.js').Bus} bus
 * @property {(key: string, vars?: Record<string, any>) => string} t
 * @property {(path: string, o?: {replace?: boolean}) => void} go
 * @property {(text: string, o?: {action?: string, onAction?: () => void, ms?: number, signal?: AbortSignal}) => void} toast   pass signal: ctx.signal when the action belongs to this page
 * @property {Record<string, string>} params                route params; params.rest is the sub-path under the feature
 * @property {URLSearchParams} query
 * @property {string} route                               the registry path that matched ('/practice/situations/*'), for a
 *                                                          feature that owns more than one path prefix
 * @property {{ hlc: {tick: () => string}, device: any, profile: any, adapter: any }} app
 * @property {() => Promise<void>} refreshShell             re-render header and tabs (after a goal change)
 * @property {AbortSignal} signal                           aborted when the router leaves this view (before unmount runs)
 *                                                          or when a newer navigation overtakes a mount still in flight.
 *                                                          Pass it to addEventListener({signal}) and fetch.
 *                                                          canLeave() false keeps it live.
 */

export {};
