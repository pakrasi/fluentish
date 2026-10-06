/* Study minutes (kv 'activity'): the one writer every feature calls. Each call names this device and the active
   course's language, and the kind of study (domain/activity.js KINDS: review, new, write, speak, read, talk, build,
   script, exam); a mixed round passes `split` ({review: n, new: m}) and its minutes are shared out by item count. */
import { addStudy } from '../domain/activity.js';
import { activeCourse } from './settings.js';

/**
 * Add minutes (and rounds) to a day's activity for this device.
 * @param {any} store @param {string} day
 * @param {{minutes: number, rounds?: number, kind?: string | null, split?: Record<string, number> | null}} o
 */
export function addActivity(store, day, { minutes, rounds = 0, kind = null, split = null }) {
  const lang = activeCourse(store.get('settings'))?.lang || null;
  const deviceId = store.device?.deviceId || null;
  store.update('activity', (/** @type {any} */ a) => addStudy(a, day, { minutes, rounds, kind, split, lang, deviceId }), {});
}
