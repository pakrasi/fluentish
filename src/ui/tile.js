/* Tile (round 8, design C §5): one tactile tile for the word games (Today's family hive, endings and articles first).
   Structure: a <button class="ui-tile"> that its container places (absolute + translate is fine on the button), with one
   child <span class="ui-tile-face"> that owns every transform. Press, pick, nudge and flip move the face, never the
   button, so a layout transform is never overwritten and the hit box never shrinks under the thumb.
     press   pointerdown: the face's `scale` goes to 0.94 in 60 ms (ease-out); release springs back (snappy, 240 ms).
             CSS (styles/ui.css), on the `scale` property, so it composes with any transform moving the face.
     pick    a click that leaves the tile pressed: fill crossfade 160 ms (CSS) and one swell 1 → 1.08 → 1 (420 ms); haptic.
     unpick  the fill crossfade only.
     settle  settleInto(slot): a copy of the face lands on the slot (translate + scale to the slot's height on the snappy
             spring, 380 ms), then the slot drops the last 3 px (160 ms). The tile itself stays where it is.
     nudge   the kit's wrong-pick nudge (-7, 5, -2, 0 px, 300 ms) on the face.
     flip    flipTo(): rotateX 0 → 90° (130 ms ease-in), the new state is set the moment that half ends, -90° → 0 (240 ms
             snappy); perspective(600px) is in the transform itself, so no parent needs one.
   Reduced motion: every state lands at once (a flip is a 140 ms opacity crossfade); press and pick swell are still.
   Every move goes through core/motion.js play(), so finishAll() (a new tap) jumps it to its end. */
import { play, animate, easing, reduced, nudge as kitNudge, haptic } from '../core/motion.js';

/** A flip's two halves, ms. */
export const FLIP_OUT = 130, FLIP_IN = 240;
/** The face's transform at a flip angle (perspective in the transform: works without a parent's). @param {number} deg */
const at = deg => `perspective(600px) rotateX(${deg}deg)`;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Flip an element to a new state: it turns away to edge-on, `apply()` sets the new state at that exact moment (in the
 * same task the first half ends in, before a frame is drawn), and it turns back in. If the first half is cut short
 * (finishAll() on a new tap), the state is set and the second half is skipped: the element stands still, done.
 * Reduced motion: apply() at once and a 140 ms opacity crossfade. Resolves when the element stands still.
 * @param {Element} el @param {() => void} apply @param {{delay?: number}} [o]
 * @returns {Promise<void>}
 */
export async function flipTo(el, apply, { delay = 0 } = {}) {
  if (reduced()) {
    apply();
    animate(el, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    return;
  }
  const t0 = now();
  await play(el, [{ transform: at(0) }, { transform: at(90) }], { duration: FLIP_OUT, delay, easing: easing('--ease-in', 'ease-in') });
  apply();
  // finished early: a new tap finished every move, so this one ends now too
  if (now() - t0 < delay + FLIP_OUT - 20) return;
  await play(el, [{ transform: at(-90) }, { transform: at(0) }], { duration: FLIP_IN, easing: easing('--spring-snappy') });
}

/**
 * Flip several elements one after another (the family board's check): each starts `stagger` ms after the last.
 * @param {{el: Element, apply: () => void}[]} items @param {{stagger?: number}} [o]
 */
export function flipAll(items, { stagger = 110 } = {}) {
  return Promise.all(items.map((x, i) => flipTo(x.el, x.apply, { delay: i * stagger }))).then(() => {});
}

/**
 * @typedef {'ok'|'other'|'no'} Verdict
 * @typedef {import('./index.js').UiBase & {
 *   text?: string, children?: (Node | string | null)[], label?: string | null, lang?: string | null, dir?: string | null,
 *   pressed?: boolean | null, disabled?: boolean, verdict?: Verdict | null, className?: string,
 *   attrs?: Record<string, string>, style?: Record<string, string> | null,
 *   onPick?: (e: MouseEvent) => void, onDown?: (e: PointerEvent) => void }} TileOpts
 *   pressed: true/false for a tile that is picked and unpicked (aria-pressed), null for a plain button.
 *   label: the accessible name (it must start with the visible text, WCAG 2.5.3). children: the face's content
 *   (default: text). onDown: the caller's pointerdown (e.g. keep focus in a field). attrs: extra attributes (data-*).
 * @typedef {import('./index.js').UiCreated<TileOpts> & {
 *   face: HTMLElement, set: (next: Partial<TileOpts>) => void, nudge: () => Promise<void>,
 *   flipTo: (verdict: Verdict, o?: {delay?: number}) => Promise<void>,
 *   settleInto: (slot: HTMLElement, o?: {from?: 'top'|'side'}) => Promise<void> }} Tile
 */

/**
 * A tile. The caller places `el` and keeps the handle; set({pressed}) follows the caller's state (the fill crossfades),
 * and a click that leaves the tile pressed swells it once.
 * @param {TileOpts} opts @returns {Tile}
 */
export function createTile(opts) {
  const o = { pressed: null, disabled: false, verdict: null, ...opts };
  const ac = new AbortController();
  const face = document.createElement('span');
  face.className = 'ui-tile-face';
  if (o.lang) face.lang = o.lang;
  if (o.dir) face.dir = o.dir;
  face.append(...(o.children || [o.text || '']).filter(c => c != null));
  const el = document.createElement('button');
  el.type = 'button';
  el.className = ['ui-tile', o.className].filter(Boolean).join(' ');
  if (o.label) el.setAttribute('aria-label', o.label);
  for (const [k, v] of Object.entries(o.style || {})) el.style.setProperty(k, v);
  for (const [k, v] of Object.entries(o.attrs || {})) el.setAttribute(k, v);
  el.append(face);
  /** @type {HTMLElement | null} */ let ghost = null;

  const draw = () => {
    if (o.pressed == null) el.removeAttribute('aria-pressed'); else el.setAttribute('aria-pressed', String(!!o.pressed));
    el.disabled = !!o.disabled;
    for (const v of /** @type {const} */ (['ok', 'other', 'no'])) el.classList.toggle(`is-${v}`, o.verdict === v);
  };
  draw();

  const up = () => el.classList.remove('is-pressed');
  const sig = { signal: ac.signal };
  el.addEventListener('pointerdown', e => {
    if (o.onDown) o.onDown(e);
    if (el.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    el.classList.add('is-pressed');
  }, sig);
  for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) el.addEventListener(t, up, sig);
  el.addEventListener('click', e => {
    up();
    if (o.onPick) o.onPick(e);
    // the caller has set the new state by now (set({pressed})): a pick swells, an unpick only changes its fill
    if (o.pressed === true && el.isConnected) {
      haptic();
      play(face, [{ transform: 'none', easing: easing('--ease-out') }, { transform: 'scale(1.08)', offset: 0.3, easing: easing('--spring-snappy') }, { transform: 'none' }], { duration: 420 });
    }
  }, sig);
  if (o.signal) o.signal.addEventListener('abort', () => destroy(), { once: true });

  /** @param {Partial<TileOpts>} next */
  function set(next) {
    Object.assign(o, next);
    draw();
  }

  /** @param {HTMLElement} slot @param {{from?: 'top'|'side'}} [so] */
  async function settleInto(slot, { from = 'top' } = {}) {
    if (reduced() || !slot.isConnected || !el.isConnected) return;
    const a = face.getBoundingClientRect(), b = slot.getBoundingClientRect();
    const w = face.offsetWidth, hh = face.offsetHeight;
    if (!a.width || !b.width || !hh) return;
    ghost?.remove();
    const g = /** @type {HTMLElement} */ (face.cloneNode(true));
    g.classList.add('ui-tile-ghost');
    g.setAttribute('aria-hidden', 'true');
    // the copy stands where the face is drawn (a press may still have it smaller) and grows to the slot's height
    const s0 = a.height / hh, s1 = b.height / hh;
    const x0 = a.left + a.width / 2 - w / 2, y0 = a.top + a.height / 2 - hh / 2;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const cs = getComputedStyle(face);
    Object.assign(g.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${hh}px`,
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing });
    document.body.append(g);
    ghost = g;
    slot.style.opacity = '0';
    try {
      await play(g, [{ transform: `scale(${s0})` }, { transform: `translate(${dx}px, ${dy}px) scale(${s1})` }], { duration: 380, easing: easing('--spring-snappy') });
    } finally {
      g.remove();
      if (ghost === g) ghost = null;
      slot.style.opacity = '';
    }
    if (!slot.isConnected) return;
    await play(slot, [{ transform: from === 'side' ? 'translateX(6px)' : 'translateY(-3px)' }, { transform: 'none' }], { duration: 160, easing: easing('--ease-out') });
  }

  function destroy() {
    ac.abort();
    for (const a of face.getAnimations?.() || []) a.cancel();
    ghost?.remove(); ghost = null;
  }

  return {
    el, face, update: set, set, destroy, settleInto,
    nudge: () => kitNudge(face),
    flipTo: (verdict, fo) => flipTo(face, () => set({ verdict }), fo),
  };
}
