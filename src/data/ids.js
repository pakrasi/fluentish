/* Identifiers and clocks for records that may one day sync to a server (review S15):
   - uuidv7(): time-ordered UUIDs, native in Postgres and Swift Foundation
   - isoWithOffset(): timestamps that keep the device's offset, so "which day was this" survives a time-zone change
   - createHlc(): a hybrid logical clock for per-field last-write-wins on settings
   - fnv1a(): a small sync hash for fingerprints (not for security) */

/** @param {number} [now] ms @param {(a: Uint8Array) => Uint8Array} [fill] random source (tests pass a seeded one) */
export function uuidv7(now = Date.now(), fill = a => crypto.getRandomValues(a)) {
  const b = fill(new Uint8Array(16));
  let ms = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i--) { b[i] = ms % 256; ms = Math.floor(ms / 256); }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Milliseconds encoded in a UUIDv7. @param {string} id */
export const uuidTime = id => parseInt(id.replace(/-/g, '').slice(0, 12), 16);

/** 'YYYY-MM-DDThh:mm:ss.sss±hh:mm' (local time with its offset). @param {Date} [d] */
export function isoWithOffset(d = new Date()) {
  const pad = (/** @type {number} */ n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** The device's IANA time zone, for event context. */
export const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/**
 * Hybrid logical clock: 'ms-counter-device', fixed width so plain string comparison orders them.
 * @param {string} deviceId @param {() => number} [now]
 */
export function createHlc(deviceId, now = Date.now) {
  let last = 0, count = 0;
  const fmt = () => `${String(last).padStart(13, '0')}-${String(count).padStart(4, '0')}-${deviceId}`;
  return {
    tick() {
      const t = now();
      if (t > last) { last = t; count = 0; } else count++;
      return fmt();
    },
    /** Move past a timestamp seen from another device. @param {string} remote */
    receive(remote) {
      const [ms, c] = String(remote).split('-').map(Number);
      const t = now();
      if (t > last && t > ms) { last = t; count = 0; } else if (ms > last) { last = ms; count = c + 1; } else if (ms === last) count = Math.max(count, c) + 1; else count++;
      return fmt();
    },
  };
}

/** FNV-1a 32-bit, hex. For change detection only. @param {string} s */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A short random device id (8 base-36 characters), the format the legacy apps used. */
export const newDeviceId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), v => (v % 36).toString(36)).join('');
