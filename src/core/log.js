/* A small in-memory error log (the last 100 entries) that Profile > Diagnostics shows and "Copy report" copies.
   Stage A keeps it in memory; persisting it and the daily scrubbed upload (review A16) come with the sync work. */

/** @type {{at: string, where: string, message: string}[]} */
const ring = [];

/** @param {string} where @param {unknown} err */
export function log(where, err) {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  ring.push({ at: new Date().toISOString(), where, message });
  if (ring.length > 100) ring.shift();
  console.error(`[${where}]`, err);
}

export const entries = () => [...ring];

export function installErrorLog() {
  addEventListener('error', e => {
    // a benign browser notice (a resize observer that settled a frame later), not an error of the app
    if (/ResizeObserver loop/.test(String(e.message || ''))) return;
    log('error', e.error || e.message);
  });
  addEventListener('unhandledrejection', e => log('promise', e.reason));
}
