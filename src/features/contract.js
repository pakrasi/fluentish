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
 * @property {any} settings                                 normalised settings@1 (settings.exam.date is the exam date)
 * @property {any | null} exam                              the exam definition from content/manifest.json, or null
 * @property {(key: string, vars?: Record<string, any>) => string} t
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
 * @property {(text: string, o?: {action?: string, onAction?: () => void}) => void} toast
 * @property {Record<string, string>} params                route params; params.rest is the sub-path under the feature
 * @property {URLSearchParams} query
 * @property {{ hlc: {tick: () => string}, device: any, profile: any, adapter: any }} app
 * @property {() => Promise<void>} refreshShell             re-render header and tabs (after a goal change)
 */

export {};
