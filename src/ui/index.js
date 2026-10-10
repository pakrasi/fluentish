// src/ui/: self-contained DOM components (round 8). This file is the folder's README and its shared types; it is not a
// barrel. Import a component from its own file (mountMeter from src/ui/meter.js), so two lanes adding
// components never edit the same line. tests/unit/ui-lint.test.mjs enforces the rules marked (lint).
//
// Layer
//   - (lint) A component imports only src/ui, src/core and pure src/domain (and src/lang, which domain may use). Never
//     src/data, src/services, src/features or src/i18n. Haptics come through core/motion.js haptic().
//   - (lint) Nothing below the features imports src/ui: core, data, domain, services, lang and i18n stay unaware of it.
//   - (lint) Components never call t() and never import core/i18n.js: every visible or spoken string (labels, captions,
//     aria-label) is passed in by the caller from its own section of src/i18n/en.js.
//   - (lint) No storage or network: no localStorage, sessionStorage, indexedDB or fetch. A component shows state; the
//     feature owns reading and writing it.
//   - (lint) All motion through core/motion.js (play, animate, easing, reduced, nudge, pop, pulse, sequence, odometer):
//     no element.animate() here, so the WebKit easing guard, reduced motion and finishAll() cover every component.
//   - (lint) Every file in src/ui is on the strict type-check list (tsconfig.json "src/ui/**/*.js").
//
// API
//   - (lint) A component file exports `mountX(el, opts)` for a root the caller owns, or `createX(opts)` when it builds
//     its own root. Both return a UiHandle: `update(next)` takes a partial opts object and changes only what differs;
//     `destroy()` removes listeners, timers and running motion and is safe to call twice. createX also returns `el`.
//   - opts may carry `signal` (an AbortSignal, e.g. the router's ctx.signal): when it aborts the component destroys
//     itself. Listeners a component adds on document or window always pass a signal.
//   - Reduced motion: every state change still happens, at once; information carried by motion (a locus, a verdict)
//     still shows. Touch targets are 44 px. Text is logical (inline-start/end), so RTL works without extra rules.
//
// Styles
//   - One file, styles/ui.css (loaded after components.css), one section per component, marked
//     `/* ---- ui/<name> ---- */` ... `/* ---- end ui/<name> ---- */`. A component lane edits only its own section.
//   - (lint) Class names in ui.css start with `ui-` (the component's root and parts, e.g. .ui-tile, .ui-tile-face) or
//     `is-` (states); motion keyframes and tokens come from styles/motion.css and tokens.css. No new colours.
//
// Tests
//   - The pure part of a component (layout maths, diffing, state machines) lives in src/domain or in a function the
//     component exports, and is tested in node. One existing Playwright spec exercises the component in the app.

/**
 * What every mountX/createX returns.
 * @template O the component's options
 * @typedef {{ update: (next: Partial<O>) => void, destroy: () => void }} UiHandle
 */
/**
 * A UiHandle that also hands back the root it built (createX).
 * @template O
 * @typedef {UiHandle<O> & { el: HTMLElement }} UiCreated
 */
/** Options every component accepts. @typedef {{ signal?: AbortSignal }} UiBase */

export {};
