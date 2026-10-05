/* Script mode on Today (§6): the script rows Practice's plan adds, and the new script words counted into the B1 day
   budget. No DOM: the scripts' plan.js (features/practice-script) and domain/allowance.js import it; both run in node tests. */
import * as St from './store.js';
import { planRows, newShownToday } from './plan.js';

/**
 * Today's script rows (Practice's planItems adds them).
 * @param {{store: any, c: any, settings: any, t: (k: string, v?: any) => string}} ctx
 */
export function scriptPlanItems({ store, c, settings, t }) {
  try {
    return planRows({ scripts: St.active(store), progress: store.get(St.PROGRESS, {}) || {}, cardOf: St.cardOf(store), c, settings, t });
  } catch (e) { console.error('script plan', e); return []; }
}

/** New script words shown today, for the B1 budget's newShown. @param {any} store @param {string} today */
export const scriptNewShown = (store, today) => { try { return newShownToday(store.get(St.PROGRESS, {}) || {}, today); } catch { return 0; } };
