/* Word building's motion: thin wrappers over WAAPI with the kit's tokens (styles/motion.css), so every move here has
   the kit's reduced-motion rule built in: under reduced motion nothing travels and the end state is set at once.
   DESIGN.md: one primary motion per moment, translation and opacity only, input never blocked (a new tap cancels a
   running move and jumps to its end), nothing loops at rest. */
import { reduced } from '../../core/motion.js';

export { reduced };

const root = document.documentElement;
/** A kit easing or duration token, read from CSS (springs are linear() curves). @param {string} name @param {string} [fallback] */
export const css = (name, fallback = 'ease-out') => getComputedStyle(root).getPropertyValue(name).trim() || fallback;

/** Running animations, so a new moment can finish the last one at once. @type {Set<Animation>} */
const running = new Set();

/**
 * Animate unless motion is reduced; resolves when done (or at once). Keyframes are transform/opacity only.
 * @param {Element | null | undefined} el @param {Keyframe[]} frames @param {KeyframeAnimationOptions} [o]
 * @returns {Promise<void>}
 */
export function play(el, frames, o = {}) {
  if (!el || reduced() || !(/** @type {any} */ (el).animate)) return Promise.resolve();
  const a = /** @type {HTMLElement} */ (el).animate(frames, { fill: 'backwards', ...o });
  running.add(a);
  return a.finished.then(() => { running.delete(a); }, () => { running.delete(a); });
}

/** Jump every running move to its end (a tap during a flight). */
export function finishAll() { for (const a of [...running]) { try { a.finish(); } catch { /* already gone */ } } running.clear(); }

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
  const anim = f.animate([
    { transform: `translate(${sx}px, ${sy}px) scale(0.6)`, opacity: 0.4 },
    { transform: `translate(${sx + dx * 0.5}px, ${sy + dy * 0.5 - lift}px) scale(0.9)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${b.left}px, ${b.top}px) scale(1)`, opacity: 1 },
  ], { duration, easing: css('--ease-out') });
  running.add(anim);
  try { await anim.finished; } catch { /* finished early */ }
  running.delete(anim);
  f.remove();
  to.style.opacity = '';
}

/** A small damped nudge for a wrong pick (300 ms; none under reduced motion). @param {Element | null} el */
export const nudge = el => play(el, [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }], { duration: 300 });

/** The pop of a right pick: 1 → 1.12 → 1 on the pop spring. @param {Element | null} el @param {string} [base] the element's own transform */
export const pop = (el, base = '') => play(el, [{ transform: `${base} scale(1)` }, { transform: `${base} scale(1.12)` }, { transform: `${base} scale(1)` }], { duration: 420, easing: css('--spring-pop') });

/** A crossfade (the reduced-motion version of a frame change). @param {Element | null} el */
export function crossfade(el) {
  if (!el || !(/** @type {any} */ (el).animate)) return;
  /** @type {HTMLElement} */ (el).animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}
