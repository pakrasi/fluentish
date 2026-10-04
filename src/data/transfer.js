/* Export and import of a profile's progress (Profile > Data).
   Export writes fluentish-export@1: settings and collections, cards, attempts and events. Never secrets or device
   prefs. Import reads that format or an Igloo "Export progress" file and MERGES: per card the newer record wins
   (the rule Igloo's importB1 used), attempts and events are added by id, settings merge per field by rev, and other
   collections are only filled when empty here. */
import { validate } from '../core/schema.js';
import { mergeSettings } from './settings.js';
import { planMigration } from './migrate.js';

const SCHEMA = {
  type: 'object', required: ['schema', 'exportedAt', 'profile', 'kv', 'cards', 'attempts', 'events'],
  properties: {
    schema: { const: 'fluentish-export@1' }, profile: { type: 'object', required: ['id'] },
    kv: { type: 'object' }, cards: { type: 'object' }, attempts: { type: 'array' }, events: { type: 'array' },
  },
};
const NOT_EXPORTED = new Set(['secrets', 'prefs', 'exams.vocabAudio']);   // the word-audio index is a cache of the results repo

/** @param {import('./store.js').Store} store @param {{profile: any}} o */
export function exportBundle(store, { profile }) {
  return {
    schema: 'fluentish-export@1',
    exportedAt: new Date().toISOString(),
    profile: { id: profile.id, name: profile.name, createdAt: profile.createdAt },
    kv: Object.fromEntries(Object.entries(store.kv).filter(([k]) => !NOT_EXPORTED.has(k))),
    cards: store.cardsByDeck,
    attempts: store.attempts(),
    events: [...store.events.values()],
  };
}

/**
 * Merge cards: a record wins when this side has none or an older one (u = last write time).
 * @param {import('./store.js').Store} store @param {string} deck @param {Record<string, any>} incoming
 */
function mergeCards(store, deck, incoming) {
  const cur = store.cards(deck);
  /** @type {[string, any][]} */ const changed = [];
  for (const [id, rec] of Object.entries(incoming || {})) {
    if (!rec || typeof rec !== 'object') continue;
    if (!cur[id] || (rec.u || 0) > (cur[id].u || 0)) changed.push([id, rec]);
  }
  if (changed.length) store.putCards(deck, changed);
  return changed.length;
}

/**
 * @param {string} text  file contents
 * @param {{store: import('./store.js').Store, hlc: any, bus?: any}} app
 * @returns {Promise<{kind: 'fluentish' | 'igloo', cards: number, attempts: number}>}
 */
export async function importFile(text, { store, bus }) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('the file is not JSON'); }
  if (data && data.schema === 'fluentish-export@1') {
    const errs = validate(SCHEMA, data);
    if (errs.length) throw new Error(errs[0]);
    let cards = 0;
    for (const [deck, recs] of Object.entries(data.cards)) cards += mergeCards(store, deck, /** @type {any} */ (recs));
    const have = new Set(store.attempts().map(a => a.id));
    const newAttempts = data.attempts.filter((/** @type {any} */ a) => a && a.id && !have.has(a.id)).map((/** @type {any} */ a) => ({ ...a, profileId: store.profile.id }));
    if (newAttempts.length) store.putAttempts(newAttempts);
    const newEvents = data.events.filter((/** @type {any} */ e) => e && e.id && !store.events.has(e.id));
    if (newEvents.length) {
      for (const e of newEvents) store.events.set(e.id, e);
      await store.adapter.putEvents(store.profile.id, newEvents);
    }
    for (const [k, v] of Object.entries(data.kv)) {
      if (NOT_EXPORTED.has(k)) continue;
      if (k === 'settings') { store.set('settings', mergeSettings(store.get('settings'), v)); bus?.emit('settings:changed', { key: '*' }); }
      else if (store.get(k) == null) store.set(k, v);
    }
    return { kind: 'fluentish', cards, attempts: newAttempts.length };
  }
  if (data && typeof data === 'object' && ('b1' in data || 'srs' in data) && 'exported' in data) {
    /** @type {Record<string, string>} */ const snap = {};
    for (const [k, v] of Object.entries(data.b1 || {})) snap[k] = JSON.stringify(v);
    const plan = planMigration(snap, { profileId: store.profile.id, deviceId: 'import', now: new Date() });
    const cards = mergeCards(store, 'b1', Object.fromEntries(plan.cards));
    if (store.get('b1.session') == null && plan.kv['b1.session']) store.set('b1.session', plan.kv['b1.session']);
    return { kind: 'igloo', cards, attempts: 0 };
  }
  throw new Error('this is not a Fluentish or Igloo export');
}
