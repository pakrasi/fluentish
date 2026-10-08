/* One knowledge score per item: what the learner knows, however he met it. Pure (no storage, no clock reads); tested in
   node (tests/unit/knowledge.test.mjs). The Explore map, the cluster counts in Practice and the word cards all read it.

   Items are the things he learns, keyed by item id: a word 'W:<word id>' (or 'BW:<slug>' for a lemma that is not in
   the word list), a phrase 'K:<chunk id>', a grammar item 'G:<id>', a B1 item (BP:, BL:, BG:, BT:, BR:, BS:), a mistake
   (F:) or a speaking situation without a chunk (SS:). A grammar concept is 'GC:<concept id>', scored from its items.

   Cards map onto items (resolver()), so the same lemma reached from any source is one item:
     deck b1        every card is its own item, except W:/BW: (the lemma) and B1 phrases that are a chunk's twin (K:)
     deck speak     SS:<id> → K:<chunk> when the situation names its chunk, else itself
     deck script    W:<id> as is, SW:<slug> → W:<id> when the lemma is in the word list, else BW:<slug>; SR: (section
                    rehearsals) are not items
     deck clusters  W:<id> as is, CO:<a>~<b> → W:<b> (the opposite he types), CF:<id> → W:<id>, CP:<gap> → the gap's
                    preposition
     deck build     PX:<p>.see|say → PX:<p> (the prefix); PD:/PV:<verb> → W:<lemma> when the verb is in the word list,
                    else PV:<verb>; PW:<word> and PF:<form> → W:<id> likewise; PS: and SX: as they are (domain/wordbuild.js)
   Evidence from outside the schedule:
     Igloo          doors.know.v1 (Test results: known / shaky / unknown on a day) and doors.srs.v1 (Drill's SM-2
                    intervals), keyed '<lang>|<item id>', days as epoch days; read-only legacy data
     exam words     the words he captured in mock exams (words.exam): seen there, so at least "not known"
     Look up        items whose word sheet or phrase he opened (lookup.seen): seen, so at least "not known"

   The score (Explore's legend, DESIGN-EXPLORE-SECTION):
     recall    predicted recall now: the highest FSRS R(today) of the item's graduated cards (out of the learning
               steps), Igloo intervals read as FSRS stability (an SM-2 interval is the FSRS S at 90 %), and a Test
               result as an observation on its day (known: S = 7 days, shaky: R 0.8, unknown: R 0.3)
     stability S in days of the card that gives that recall
     state     'known'   recall ≥ 0.90 and no lapse in the last 7 days (a lapse: Again on any card, or a Test result
                         other than known, within 7 days). A lapse counts from the next study day: on the day itself
                         the round brings the item back until he types it right, so studying never lowers today's
                         state (Where you stand, docs/ARCHITECTURE.md). A study step on a new item (Show me, flag v)
                         is never a lapse.
               'shaky'   recall ≥ 0.70, or known with such a lapse
               'unknown' anything else that has a record: recall < 0.70, cards only in their learning steps, words
                         only seen in an exam or in Look up ("not known" in the legend)
               'unseen'  no record anywhere
     today     practised today with Good or Easy (the accent on the map)
     sources   where the item was met: exam, speech, practice, lookup, script, test, read, conversation (a card's src,
               or origin() for cards made before src was recorded; Igloo data is test; exam words exam; Look up lookup;
               evidence without a card by its origin, Input.evidence), and self for an item he marked known
               (domain/known.js; Igloo's placement marks count as test)
     marked    'self' | 'igloo' while a mark waits for its check, else null. A marked card is S 60 days, reviewed the
               day it was marked, so its recall is about 1 and it reads as known at once
   A concept: recall = the mean recall of its items (unseen items count 0), coverage = share of items seen; 'known'
   when the mean over its graduated items (out of their learning steps) is ≥ 0.90 and at least half are seen,
   'shaky' from 0.70 (or known with less than half seen), 'unknown' below, 'unseen' when none is seen. Items still in
   their first learning steps count for coverage only, so starting a new item never lowers its concept.

   Nothing here changes a card. Where you stand (domain/standing.js) and the map's known count read this score. */
import * as FS from './fsrs.js';
import * as D8 from './days.js';
import { tagOf, slug, origin, scopeItem, ORIGINS } from './itemids.js';
import { deckName, deckLang } from './decks.js';
import { itemResolver } from './wordbuild.js';

export const KNOWN_R = 0.9;
export const SHAKY_R = 0.7;
export const LAPSE_DAYS = 7;
const TEST = /** @type {Record<string, {R: number, S: number}>} */ ({ known: { R: 0.95, S: 7 }, shaky: { R: 0.8, S: 2 }, unknown: { R: 0.3, S: 0.5 } });

/** @typedef {'known'|'shaky'|'unknown'|'unseen'} State */
/** @typedef {import('./itemids.js').Origin} Origin */
/**
 * @typedef {object} Score
 * @property {string} id
 * @property {State} state
 * @property {number} recall        0..1, predicted recall now
 * @property {number} stability     days (0 without a graduated card)
 * @property {string | null} last   the last day he practised it ('YYYY-MM-DD'), or null
 * @property {boolean} today        practised today with Good or Easy
 * @property {'self' | 'igloo' | null} marked   marked known (domain/known.js) and not checked yet: by whom
 * @property {Origin[]} sources
 * @property {string[]} cards       the card ids that feed it ('<deck>/<card id>')
 * @property {boolean} [grad]       it has a graduated card (out of the learning steps), or Igloo evidence
 */

/**
 * Card id → item id. Returns null for cards that are not items (script section rehearsals).
 * @param {object} o
 * @param {{id: string, w: string, zipf?: number}[]} [o.words]   the German word list: unifies BW:/SW: slugs with W: ids
 * @param {Record<string, string>} [o.chunkOf]   B1 phrase or situation id → chunk id (b1 items' chunk twins, SS: ck)
 * @param {Record<string, string>} [o.gapPrep]   cluster gap id → preposition word id
 * @param {{verbLemma?: Record<string, string>, wordLemma?: Record<string, string>, formLemma?: Record<string, string>}} [o.build]   Word building: verb id → word id, PW word → word id
 * @returns {(id: string, deck?: string) => string | null}
 */
export function resolver({ words = [], chunkOf = {}, gapPrep = {}, build = {} } = {}) {
  /** @type {Map<string, {id: string, z: number}>} */ const bySlug = new Map();
  for (const w of words) {
    const k = slug(w.w), cur = bySlug.get(k), z = w.zipf || 0;
    if (!cur || z > cur.z) bySlug.set(k, { id: w.id, z });
  }
  const lemma = (/** @type {string} */ s) => { const hit = bySlug.get(s); return hit ? `W:${hit.id}` : `BW:${s}`; };
  const buildItem = itemResolver(build);
  return (id, deck = 'b1') => {
    const s = String(id || '');
    const tag = tagOf(s);
    if (/^SR:/.test(s)) return null;
    if (/^SW:/.test(s)) return lemma(s.slice(3));
    if (tag === 'BW') return lemma(s.slice(3));
    if (tag === 'CO') { const to = s.slice(3).split('~')[1]; return to ? `W:${to}` : null; }
    if (tag === 'CF') return `W:${s.slice(3)}`;
    if (tag === 'CP') { const p = gapPrep[s.slice(3)]; return p ? `W:${p}` : null; }
    if (tag === 'PX' || tag === 'PD' || tag === 'PV' || tag === 'PS' || tag === 'SX' || tag === 'PW' || tag === 'PF') return buildItem(s);
    if (chunkOf[s]) return `K:${chunkOf[s]}`;
    if (!tag && !/^[A-Z]{1,2}:/.test(s)) return null;
    return s || null;
  };
}

/**
 * @typedef {object} Input
 * @property {string} today                          'YYYY-MM-DD'
 * @property {number} [epoch]                        today as an Igloo epoch day (core/clock.js epochDay)
 * @property {Record<string, Record<string, any>>} decks   deck name → card id → FSRS record (b1, speak, script, clusters …)
 * @property {(id: string, deck?: string) => string | null} [resolve]   resolver()
 * @property {Record<string, any>} [know]            doors.know.v1
 * @property {Record<string, any>} [srs]             doors.srs.v1
 * @property {string} [lang]                         the Igloo language key ('german')
 * @property {string} [itemLang]                     the course's language ('de'): Igloo's items are scoped to it
 *                                                   (domain/itemids.js scopeItem; German's stay unscoped)
 * @property {string[]} [examWords]                  item ids of the words captured in mock exams
 * @property {Record<string, {first?: string, last?: string, n?: number}>} [seen]   lookup.seen: item id → views (the
 *                                                   same as evidence.lookup; both are read)
 * @property {Partial<Record<Origin, Record<string, {first?: string, last?: string, n?: number}>>>} [evidence]
 *           where items were met without a card (round 4): origin → item id → {first, last, n}. An entry with n or last
 *           adds its origin to the item's sources and nothing else (never a recall, never 'known'). data/knowledge.js
 *           EVIDENCE_KV names the collection each origin is read from.
 */

/** @param {any} rec @param {string} today */
const lapsedRecently = (rec, today) => (!!rec.relearn && rec.last !== today)
  || (rec.hist || []).some((/** @type {any[]} */ h) => h[1] === 1 && !String(h[4] || '').includes('v') && D8.diff(h[0], today) < LAPSE_DAYS && D8.diff(h[0], today) >= 1);

/** @param {number} recall @param {boolean} graduated @param {boolean} lapse @returns {State} */
export function stateOf(recall, graduated, lapse) {
  if (!graduated) return 'unknown';
  if (recall >= KNOWN_R - 1e-9) return lapse ? 'shaky' : 'known';
  if (recall >= SHAKY_R - 1e-9) return 'shaky';
  return 'unknown';
}

/**
 * Score every item that has a record anywhere. Items not in the result are 'unseen' (use get()).
 * @param {Input} input
 */
export function knowledge(input) {
  const { today, decks = {}, know = {}, srs = {}, lang = 'german', itemLang = 'de', examWords = [], seen = {}, evidence = {} } = input;
  const resolve = input.resolve || resolver();
  const examSet = new Set(examWords);
  /** @type {Map<string, {R: number, S: number, grad: boolean, lapse: boolean, last: string | null, today: boolean, marked: string | null, sources: Set<Origin>, cards: string[]}>} */
  const acc = new Map();
  const slot = (/** @type {string} */ id) => {
    let a = acc.get(id);
    if (!a) { a = { R: 0, S: 0, grad: false, lapse: false, last: null, today: false, marked: null, sources: new Set(), cards: [] }; acc.set(id, a); }
    return a;
  };
  const observe = (/** @type {ReturnType<typeof slot>} */ a, /** @type {number} */ R, /** @type {number} */ S) => {
    if (!a.grad || R > a.R) { a.R = R; a.S = S; }
    a.grad = true;
  };
  for (const [deck, cards] of Object.entries(decks)) {
    const kind = deckName(deck);   // 'fr:core' reads as 'core'; a legacy deck is its own name (domain/decks.js)
    const dl = deckLang(deck);     // a French deck's items are 'fr:…'; a legacy deck's (German) as they always were
    for (const [cid, rec] of Object.entries(cards || {})) {
      if (!rec || !rec.reps) continue;
      const r0 = resolve(cid, kind);
      const id = r0 && scopeItem(dl, r0);
      if (!id) continue;
      const a = slot(id);
      a.cards.push(`${deck}/${cid}`);
      // a card marked known (domain/known.js) and not checked yet: its source is the mark ('self', or Igloo's test),
      // plus where it was met when it had been met before the mark
      const by = rec.known && !rec.known.checked ? rec.known.by : null;
      if (by) { a.marked = by; a.sources.add(by === 'igloo' ? 'test' : 'self'); }
      if (!by || rec.src || (rec.hist || []).length) a.sources.add(/** @type {Origin} */ (rec.src || origin(cid, kind, x => examSet.has(resolve(x, kind) || x))));
      if (rec.last && (!a.last || rec.last > a.last)) a.last = rec.last;
      const h = rec.hist || [];
      if (rec.last === today && h.length && h[h.length - 1][0] === today && h[h.length - 1][1] >= 3) a.today = true;
      if (lapsedRecently(rec, today)) a.lapse = true;
      // a record in an old shape (no S or due) has no recall today: it counts as seen, and never blocks a later card
      const R = FS.Ron(rec, today);
      if (!Number.isFinite(R)) continue;
      if (rec.learn == null) observe(a, R, rec.S || 0);
      else if (!a.grad) a.R = Math.max(a.R, R);
    }
  }
  // Igloo: Drill's SM-2 intervals and the Test results, keyed '<lang>|<item id>'
  const epoch = input.epoch;
  const fromIgloo = (/** @type {string} */ key) => { const i = key.indexOf('|'); if (!(i > 0 && key.slice(0, i) === lang)) return null; const r = resolve(key.slice(i + 1), 'b1'); return r && scopeItem(itemLang, r); };
  if (epoch != null) {
    for (const [key, s] of Object.entries(srs || {})) {
      if (!s || !s.reps || !(s.ivl > 0)) continue;
      const id = fromIgloo(key); if (!id) continue;
      const a = slot(id); a.sources.add('test'); a.cards.push(`igloo/${key}`);
      observe(a, FS.R(Math.max(0, epoch - (s.last ?? epoch)), Math.max(0.5, s.ivl)), s.ivl);
    }
    for (const [key, k] of Object.entries(know || {})) {
      const t = k && TEST[k.s]; if (!t) continue;
      const id = fromIgloo(key); if (!id) continue;
      const a = slot(id); a.sources.add('test');
      const age = Math.max(0, epoch - (k.last ?? epoch - 30));   // a result without a date counts as a month old
      observe(a, k.s === 'known' ? FS.R(age, t.S) : t.R, t.S);
      if (k.s !== 'known' && age < LAPSE_DAYS) a.lapse = true;
    }
  }
  for (const id of examSet) slot(id).sources.add('exam');
  // evidence without a card: Look up views (seen, kept as evidence.lookup), then every other origin's, in origin order
  /** @type {Partial<Record<Origin, Record<string, any>>>} */ const ev = { ...(evidence || {}), lookup: { ...(seen || {}), ...((evidence || {}).lookup || {}) } };
  for (const o of ORIGINS) for (const [id, v] of Object.entries(ev[o] || {})) if (v && (v.n || v.last)) slot(id).sources.add(o);
  /** @type {Map<string, Score>} */ const items = new Map();
  for (const [id, a] of acc) {
    items.set(id, { id, state: stateOf(a.R, a.grad, a.lapse), recall: a.grad ? a.R : Math.min(a.R, SHAKY_R - 0.01), stability: a.grad ? a.S : 0,
      last: a.last, today: a.today, marked: /** @type {Score['marked']} */ (a.marked), sources: [...a.sources].sort(), cards: a.cards, grad: a.grad });
  }
  return makeView(items);
}

/** @param {string} id @returns {Score} */
const unseen = id => ({ id, state: 'unseen', recall: 0, stability: 0, last: null, today: false, marked: null, sources: [], cards: [] });

/** @param {Map<string, Score>} items */
function makeView(items) {
  /** @param {string} id */
  const get = id => items.get(id) || unseen(id);
  return {
    items,
    get,
    /**
     * Counts for a set of items (a cluster, a topic): known / shaky / unknown / unseen and the total.
     * @param {string[]} ids
     */
    summary(ids) {
      const out = { known: 0, shaky: 0, unknown: 0, unseen: 0, n: ids.length, today: 0 };
      for (const id of ids) { const s = get(id); out[s.state]++; if (s.today) out.today++; }
      return out;
    },
    /**
     * A grammar concept from its items. @param {string} id concept id @param {string[]} itemIds
     * @returns {Score & {coverage: number, n: number, seen: number}}
     */
    concept(id, itemIds) {
      const scores = itemIds.map(get);
      const seenS = scores.filter(s => s.state !== 'unseen');
      const gradS = seenS.filter(s => s.grad);
      const n = scores.length, k = seenS.length;
      const recall = n ? scores.reduce((t, s) => t + s.recall, 0) / n : 0;
      const seenMean = gradS.length ? gradS.reduce((t, s) => t + s.recall, 0) / gradS.length : 0;
      const coverage = n ? k / n : 0;
      /** @type {State} */ let state = 'unseen';
      if (k) state = !gradS.length ? 'unknown' : seenMean >= KNOWN_R - 1e-9 ? (coverage >= 0.5 ? 'known' : 'shaky') : seenMean >= SHAKY_R - 1e-9 ? 'shaky' : 'unknown';
      const last = seenS.map(s => s.last).filter(Boolean).sort().pop() || null;
      return { id: `GC:${id}`, state, recall, stability: 0, last, today: scores.some(s => s.today), marked: null, coverage, n, seen: k,
        sources: [...new Set(scores.flatMap(s => s.sources))].sort(), cards: [] };
    },
  };
}

/**
 * The items of each grammar concept: the Igloo grammar items (G:<id>, igloo.grammar.items.de) by their concept, and
 * the B1 grammar items (BG:, b1.items) by the concepts of their plan topic (b1.plan topics[].concepts, the first one).
 * @param {{concepts?: {id: string}[], items?: {id: string, concept: string}[], b1Items?: {id: string, group?: string}[], plan?: {topics: {id: string, concepts?: string[]}[]} | null}} o
 * @returns {Record<string, string[]>}
 */
export function conceptItems({ concepts = [], items = [], b1Items = [], plan = null }) {
  /** @type {Record<string, string[]>} */ const out = Object.fromEntries(concepts.map(c => [c.id, /** @type {string[]} */ ([])]));
  for (const it of items) if (out[it.concept]) out[it.concept].push(`G:${it.id}`);
  const topic = new Map((plan?.topics || []).map(t => [t.id, (t.concepts || [])[0]]));
  for (const it of b1Items) {
    if (!String(it.id).startsWith('BG:')) continue;
    const c = topic.get(it.group || '');
    if (c && out[c]) out[c].push(it.id);
  }
  return out;
}
