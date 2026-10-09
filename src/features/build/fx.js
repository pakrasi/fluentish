/* Word building's motion: thin wrappers over WAAPI with the kit's tokens (styles/motion.css), so every move here has
   the kit's reduced-motion rule built in: under reduced motion nothing travels and the end state is set at once.
   DESIGN.md: one primary motion per moment, translation and opacity only, input never blocked (a new tap cancels a
   running move and jumps to its end), nothing loops at rest. */
import { reduced, play } from '../../core/motion.js';

// play, finishAll, nudge and pop live in core/motion.js (round 8, one set of running moves for every component);
// they are re-exported here so the word building screens keep their imports.
export { reduced, play };
export { finishAll, nudge, pop } from '../../core/motion.js';

const root = document.documentElement;
/** A kit easing or duration token, read from CSS (springs are linear() curves). @param {string} name @param {string} [fallback] */
export const css = (name, fallback = 'ease-out') => getComputedStyle(root).getPropertyValue(name).trim() || fallback;

/** @param {number} ms */
export const wait = ms => (reduced() ? Promise.resolve() : new Promise(r => setTimeout(r, ms)));

/**
 * A copy of a chip flies to a target on a short arc: it lifts 18 px over its flight, scale 0.6 → 1 (translation and
 * scale only), and lands where the target's text is. Resolves when it has landed. The target is hidden meanwhile.
 * @param {Element} from @param {HTMLElement} to @param {string} text @param {{duration?: number, lift?: number, lang?: string}} [o]
 */
export async function flyText(from, to, text, { duration = 520, lift = 18, lang = 'de' } = {}) {
  if (reduced() || !from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const cs = getComputedStyle(to);
  const f = document.createElement('span');
  f.className = 'wb-flyer'; f.textContent = text; f.setAttribute('aria-hidden', 'true'); f.lang = lang;
  for (const k of /** @type {const} */ (['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'])) f.style[k] = cs[k];
  document.body.append(f);
  const fr = f.getBoundingClientRect();
  const sx = a.left + a.width / 2 - fr.width / 2, sy = a.top + a.height / 2 - fr.height / 2;
  const dx = b.left - sx, dy = b.top - sy;
  to.style.opacity = '0';
  await play(f, [
    { transform: `translate(${sx}px, ${sy}px) scale(0.6)`, opacity: 0.4 },
    { transform: `translate(${sx + dx * 0.5}px, ${sy + dy * 0.5 - lift}px) scale(0.9)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${b.left}px, ${b.top}px) scale(1)`, opacity: 1 },
  ], { duration, easing: css('--ease-out'), fill: 'none' });
  f.remove();
  to.style.opacity = '';
}

/** A crossfade (the reduced-motion version of a frame change). @param {Element | null} el */
export function crossfade(el) {
  if (!el || !(/** @type {any} */ (el).animate)) return;
  /** @type {HTMLElement} */ (el).animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}
