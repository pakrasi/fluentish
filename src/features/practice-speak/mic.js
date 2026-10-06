/* The microphone's pieces shared by the situations' "Check with the mic" and the mic check: the level meter, hold to
   talk, the loud-room line and the device-only log of attempts. Nothing here touches the microphone: services/speech.js
   does, and hands over levels (0..1), the room (domain/hearing.js ambient) and what it heard.

   meter()                     a bar under the mic button (the kit's .track .fill); with reduced motion it moves at
                               most four times a second and without its spring
   holdable(btn, o)            hold to talk on a button: pointer down starts, up or cancel stops; a click (keyboard,
                               or a tap in tap mode) still goes to o.onClick
   logAttempt(store, e)        kv speech.log, device-only (store.js DEVICE_SCOPE, never exported, never in a snapshot):
                               numbers and flags only, never a transcript or audio */
import { h } from '../../core/dom.js';
import { fill, reduced } from '../../core/motion.js';

export const LOG = 'speech.log';
const LOG_MAX = 200;

/** The level meter. aria-hidden: the live line already says "Listening"; this is for the eye. */
export function meter() {
  const bar = h('div', { class: 'track pr-meter', 'aria-hidden': 'true', hidden: true }, h('span', { class: 'fill' }));
  let last = 0;
  return {
    el: bar,
    /** @param {number} x 0..1 */
    set(x) {
      const now = performance.now();
      if (reduced() && now - last < 250) return;
      last = now;
      fill(bar, x);
    },
    /** @param {boolean} on */
    show(on) { bar.hidden = !on; if (!on) fill(bar, 0); bar.classList.toggle('is-still', reduced()); },
  };
}

/**
 * Hold to talk. While o.isHold() is true, pressing the button starts and letting go stops; the click that follows a
 * hold is swallowed. Otherwise every click goes to o.onClick.
 * @param {HTMLElement} btn
 * @param {{ isHold: () => boolean, onDown: () => void, onUp: () => void, onClick: () => void }} o
 */
export function holdable(btn, o) {
  let held = false, swallow = false;
  btn.addEventListener('pointerdown', e => {
    if (!o.isHold() || e.button !== 0) return;
    e.preventDefault();
    held = true; swallow = true;
    try { btn.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    o.onDown();
  });
  const up = () => { if (!held) return; held = false; o.onUp(); };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('contextmenu', e => { if (o.isHold()) e.preventDefault(); });   // a long press opens no menu
  btn.addEventListener('click', () => {
    if (swallow) { swallow = false; return; }
    o.onClick();
  });
}

/**
 * Log one attempt, device-only. Numbers and flags only.
 * @param {any} store
 * @param {{ where: 'sim' | 'check', heard?: any, unsure?: boolean, why?: string[], misheard?: boolean, typed?: boolean }} e
 */
export function logAttempt(store, { where, heard = null, unsure = false, why = [], misheard = false, typed = false }) {
  const a = heard?.ambient || null;
  const entry = {
    at: Date.now(), where,
    noisy: !!(a && a.noisy), db: a ? a.db : null, peak: a ? a.peak : null, floor: heard?.floor ?? null,
    conf: heard?.confidence == null ? null : Math.round(heard.confidence * 100) / 100,
    alts: heard?.alts ? heard.alts.length : 0, restarts: heard?.restarts || 0, hold: !!heard?.hold,
    unsure, why, misheard, typed,
  };
  try { store.update(LOG, (/** @type {any} */ l) => ({ v: 1, entries: [...((l && l.entries) || []), entry].slice(-LOG_MAX) }), { v: 1, entries: [] }); } catch { /* a log never breaks practice */ }
}
