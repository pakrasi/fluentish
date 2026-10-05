/* Explore: what the map and the group page say about a group, shared by both (index.js, group.js). */

/** A map state code (domain/atlas.js STATE_CODE) as its name. */
export const CODE_STATE = /** @type {const} */ (['unseen', 'unknown', 'shaky', 'known']);
/** The four states in the order the stack and the counts show them. */
export const STATES = /** @type {const} */ (['known', 'shaky', 'unknown', 'unseen']);

/** The group page of a group key ('topic:food' → '#/lookup/map/topic/food'). @param {string} key */
export const pageHref = key => { const [type, id] = String(key).split(/:(.*)/); return `#/lookup/map/${type}/${encodeURIComponent(id || '')}`; };
/** The map opened on a group, its sheet open ('topic:food' → '#/lookup/map?mode=topic&g=topic%3Afood'). @param {string} key */
export const mapHref = key => `#/lookup/map?mode=${encodeURIComponent(String(key).split(':')[0])}&g=${encodeURIComponent(key)}`;
/** The `from` a round started on a group page carries, so End and Done come back to the page. @param {string} key */
export const fromPage = key => `map/${String(key).split(':')[0]}/${encodeURIComponent(String(key).split(/:(.*)/)[1] || '')}`;

/**
 * A group's name. @param {(k: string, v?: any) => string} t @param {{key: string, label: string}} g
 */
export function groupName(t, g) {
  const [type, id] = String(g.key).split(/:(.*)/);
  if (g.key === 'topic:grammar') return t('explore.group.grammar');
  if (type === 'type' || type === 'source') return t(`explore.group.${type}.${id}`);
  return g.label;
}

/** A word that a round can ask: no gap or brackets ("um … zu", "(sich) freuen"). @param {string} text */
export const askable = text => !/[…()[\]]/.test(text);
