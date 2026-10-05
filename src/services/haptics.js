/* Haptics (Arch #8): one light tap for a right answer or a grade, behind one interface, so the iOS shell can use the
   Taptic Engine (Capacitor Haptics) with setHaptics() and the callers stay as they are. core/motion.js haptic() calls
   tap(); features keep calling haptic().

   The web version: Android has the Vibration API. Safari on iOS 18+ has none, but toggling a hidden
   <input type=checkbox switch> through its label plays the system haptic, so tap() clicks such a label (and gives the
   focus straight back, so an answer field keeps it and the iPhone keyboard stays up). It must be called from a user
   gesture on iOS. It does nothing anywhere else. */

/** @typedef {{ tap: () => void }} Haptics */

/** @returns {Haptics} */
export function webHaptics() {
  /** @type {HTMLLabelElement | null} */ let label = null;
  return {
    tap() {
      try {
        if (typeof navigator === 'undefined') return;
        if (typeof navigator.vibrate === 'function') { navigator.vibrate(8); return; }
        if (!/iP(hone|ad)/.test(navigator.userAgent) || typeof document === 'undefined') return;
        if (!label) {
          label = document.createElement('label');
          label.setAttribute('aria-hidden', 'true');
          label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
          const input = document.createElement('input');
          input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
          label.append(input); document.body.append(label);
        }
        const had = /** @type {HTMLElement | null} */ (document.activeElement);
        label.click();
        if (had && had !== document.activeElement && typeof had.focus === 'function') had.focus({ preventScroll: true });
      } catch { /* no haptics */ }
    },
  };
}

/** @type {Haptics | null} */ let impl = null;
/** For the iOS shell and tests (null: the web one again). @param {Haptics | null} h */
export function setHaptics(h) { impl = h; }
/** One light haptic tap. */
export function tap() { (impl || (impl = webHaptics())).tap(); }
