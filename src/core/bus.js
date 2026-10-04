/* A tiny publish/subscribe bus for app-wide events. Feature modules listen here instead of reaching into each other.

   Events in use (payload in parentheses):
     settings:changed  ({ key, value, prev })   a profile setting changed; the clock context may have changed with it
     prefs:changed     ({ key, value })         theme, motion or locale on this device
     store:changed     ({ name })               a collection changed (this tab or another one)
     route:changed     ({ path, route })        after a view is mounted
     sync:status       ({ pending, error })     outbox state (stage C)
     sync:request      ({ force })              flush the results sync now (e.g. after the import notice is closed) */

/** @typedef {(detail: any) => void} Handler */

export function createBus() {
  /** @type {Map<string, Set<Handler>>} */
  const map = new Map();
  return {
    /** @param {string} type @param {Handler} fn @returns {() => void} unsubscribe */
    on(type, fn) {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn);
      return () => { set.delete(fn); };
    },
    /** @param {string} type @param {any} [detail] */
    emit(type, detail) {
      for (const fn of [...(map.get(type) || [])]) {
        try { fn(detail); } catch (e) { console.error(`bus ${type}:`, e); }
      }
    },
    /** @param {string} type @param {Handler} fn */
    once(type, fn) {
      const off = this.on(type, d => { off(); fn(d); });
      return off;
    },
  };
}

/** @typedef {ReturnType<typeof createBus>} Bus */

/** The app's bus. Tests create their own with createBus(). */
export const bus = createBus();
