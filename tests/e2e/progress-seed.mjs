// A synthetic progress log (progress@1) for the Progress e2e and its screenshots: about seven months of study days
// ending today, estimated at the start, Igloo's placement as one labelled jump, a map release that grows the B2
// layer, two devices, minutes of every kind and a few weeks away. Generated from a seed; no real learner's data.
const LEVELS = 6;

/** @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** @param {string} d @param {number} n */
const add = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd + n)); return x.toISOString().slice(0, 10); };
const trim = (/** @type {number[]} */ a) => { let n = a.length; while (n && !a[n - 1]) n--; return a.slice(0, n); };

/**
 * @param {string} today 'YYYY-MM-DD' (the app's study day)
 * @param {{days?: number, seed?: number, course?: string, estimatedDays?: number}} [o]
 * @returns {Record<string, Record<string, any>>} kv: progress.<course>.<YYYY-MM> → month
 */
export function syntheticLog(today, { days = 210, seed = 7, course = 'de', estimatedDays = 45 } = {}) {
  const r = rng(seed);
  const start = add(today, -days);
  // the pool by level: words, phrases, grammar concepts
  const of = { w: [520, 640, 1100, 900, 420, 150], p: [240, 300, 600, 560, 220, 40], g: [12, 14, 18, 16, 6, 2] };
  const known = { w: [90, 40, 10, 0, 0, 0], p: [30, 10, 0, 0, 0, 0], g: [3, 1, 0, 0, 0, 0] };
  /** @type {Record<string, Record<string, any>>} */ const kv = {};
  const awayFrom = add(today, -95), awayTo = add(today, -82);
  let atlas = 'e2e0a1b2';
  // the Igloo jump and the map release land on the first study day on or after their day, so a skipped day never
  // drops them (which day is skipped depends on today's date)
  let jumped = false, released = false;
  for (let i = 0; i <= days; i++) {
    const day = add(start, i);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (day !== today && ((day >= awayFrom && day <= awayTo) || r() < (dow === 0 ? 0.55 : 0.18))) continue;
    /** @type {any} */ let jump = null;
    if (!jumped && i >= estimatedDays) {   // Igloo's placement results come in
      jumped = true;
      const before = [...known.w, ...known.p, ...known.g].reduce((a, b) => a + b, 0);
      for (let L = 0; L < 3; L++) { known.w[L] = Math.min(of.w[L], known.w[L] + [260, 180, 90][L]); known.p[L] = Math.min(of.p[L], known.p[L] + [120, 90, 30][L]); }
      jump = { from: 'igloo', known: [...known.w, ...known.p, ...known.g].reduce((a, b) => a + b, 0) - before };
    }
    if (!released && i >= 130) { released = true; of.w[3] += 220; of.p[3] += 80; of.g[3] += 6; atlas = 'e2e0c3d4'; }   // a map release grows B2
    const learnt = 4 + Math.floor(r() * 14), missed = Math.floor(r() * 4);
    for (let k = 0; k < learnt; k++) {
      const L = Math.min(LEVELS - 1, Math.floor(r() * (i > 70 ? 4.6 : 3.2)));
      const kind = r() < 0.62 ? 'w' : r() < 0.93 ? 'p' : 'g';
      if (known[kind][L] < of[kind][L]) known[kind][L]++;
    }
    for (let k = 0; k < missed; k++) { const L = Math.floor(r() * 3); if (known.w[L] > 0) known.w[L]--; }
    const total = Math.round(12 + r() * 58);
    const kinds = { review: Math.round(total * 0.45), new: Math.round(total * 0.25) };
    const rest = total - kinds.review - kinds.new;
    /** @type {Record<string, number>} */ const by = { ...kinds };
    if (rest > 0) by[['write', 'speak', 'read', 'talk', 'build', 'script', 'exam'][Math.floor(r() * 7)]] = rest;
    const two = r() < 0.25 && day >= add(today, -120);
    const dev = two ? { 'e2e-iph': { m: total - 10, by: { ...by, review: Math.max(0, by.review - 10) } }, 'e2e-mac': { m: 10, by: { review: 10 } } } : { 'e2e-iph': { m: total, by } };
    const estimated = i < estimatedDays;
    const counts = (/** @type {any} */ c) => ({ w: trim([...c.w]), p: trim([...c.p]), g: trim([...c.g]) });
    const shaky = { w: known.w.map(x => Math.round(x * 0.08)), p: known.p.map(x => Math.round(x * 0.06)), g: known.g.map(() => 0) };
    const seen = { w: known.w.map((x, L) => Math.min(of.w[L], Math.round(x * 1.2))), p: known.p.map((x, L) => Math.min(of.p[L], Math.round(x * 1.2))), g: known.g.map((x, L) => Math.min(of.g[L], x + 1)) };
    /** @type {any} */ const rec = {
      v: 1, at: `${day}T20:00:00Z`, dev: 'e2e-iph', src: day === today ? 'live' : estimated ? 'estimate' : 'replay', atlas,
      known: counts(known), shaky: counts(shaky), seen: counts(seen), of: counts(of),
      day: { new: learnt + 2, learnt, missed, reviews: 20 + Math.floor(r() * 40), again: missed + 1 },
      min: { total, rounds: 1 + Math.floor(total / 15), dev, by: two ? { ...by } : by },
    };
    if (estimated) rec.estimated = true; else if (day !== today) rec.fin = true;
    if (jump) rec.jump = jump;
    const key = `progress.${course}.${day.slice(0, 7)}`;
    (kv[key] || (kv[key] = {}))[day] = rec;
  }
  return kv;
}

/** A study hours file (hours-json@1) for the same span: more hours than the app's, in two projects. @param {string} today @param {{days?: number, seed?: number}} [o] */
export function syntheticHours(today, { days = 210, seed = 11 } = {}) {
  const r = rng(seed);
  /** @type {any[]} */ const entries = [];
  for (let i = 0; i <= days; i++) {
    const date = add(today, -days + i);
    if (r() < 0.3) continue;
    entries.push({ id: `e2e-german-${date}`, lang: 'german', hours: Math.round((0.5 + r() * 1.8) * 100) / 100, date, note: 'synthetic', source: 'toggl' });
    if (r() < 0.2) entries.push({ id: `e2e-other-${date}`, lang: 'khasi', hours: 0.5, date, note: 'synthetic', source: 'toggl' });
  }
  return { syncedAt: `${today}T03:00:00Z`, since: add(today, -days), timezone: 'Europe/Berlin', projects: ['german', 'khasi'], entries };
}
