/* Listeners, timers and frames that stop by themselves when a view is left.

   The router gives every view an AbortSignal (ctx.signal, aborted before unmount; see core/router.js). scope(signal)
   ties the usual leaks to it, so a view needs no hand-written stop and no hashchange {once} trick:

     const s = scope(ctx.signal);
     s.on(document, 'keydown', onKey);         // removed when the view is left
     s.timeout(() => hint.hidden = false, 800);
     s.interval(tick, 1000);
     s.raf(draw);                              // one frame; call again from draw() for a loop

   Each call also returns its own stop function, for a view that stops something earlier. On a signal that is
   already aborted (a mount that a newer navigation overtook) nothing is started at all. */

const noop = () => {};

/**
 * @typedef {object} Scope
 * @property {AbortSignal} signal
 * @property {(target: EventTarget, type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | Omit<AddEventListenerOptions, 'signal'>) => () => void} on
 * @property {(fn: () => void, ms?: number) => () => void} timeout
 * @property {(fn: () => void, ms: number) => () => void} interval
 * @property {(fn: FrameRequestCallback) => () => void} raf
 */

/** @param {AbortSignal} signal @returns {Scope} */
export function scope(signal) {
  /**
   * Call stop() once: when the signal aborts or when the returned function is called, whichever comes first.
   * @param {() => void} stop
   */
  const tie = (stop) => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', end);
      stop();
    };
    signal.addEventListener('abort', end, { once: true });
    return end;
  };

  return {
    signal,

    on(target, type, fn, opts) {
      if (signal.aborted) return noop;
      const o = typeof opts === 'boolean' ? { capture: opts } : { ...opts };
      if ('signal' in o) throw new TypeError('scope.on: the scope gives the signal');
      target.addEventListener(type, fn, { ...o, signal });
      return () => target.removeEventListener(type, fn, { capture: !!o.capture });
    },

    timeout(fn, ms = 0) {
      if (signal.aborted) return noop;
      /** @type {() => void} */ let end = noop;
      const id = setTimeout(() => { end(); fn(); }, ms);
      end = tie(() => clearTimeout(id));
      return end;
    },

    interval(fn, ms) {
      if (signal.aborted) return noop;
      const id = setInterval(fn, ms);
      return tie(() => clearInterval(id));
    },

    raf(fn) {
      if (signal.aborted) return noop;
      /** @type {() => void} */ let end = noop;
      const id = requestAnimationFrame(t => { end(); fn(t); });
      end = tie(() => cancelAnimationFrame(id));
      return end;
    },
  };
}
