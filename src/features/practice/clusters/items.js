/* Cluster study (Practice › Word clusters): the cards of a cluster and a round's composition. Pure; tested in node
   (tests/unit/cluster-study.test.mjs). Cards live in deck 'clusters' of the one FSRS schedule:
     W:<word id>      the meaning → the word (topics, prefixes, suffixes; a family's head)
     CF:<word id>     a word family: its head and a meaning → the family word with that meaning
     CO:<a>~<b>       opposites: word a → its opposite b (both directions are cards; every listed opposite of a counts)
     CP:<gap id>      a preposition gap sentence; its usage note shows after the answer
   Every card is rebuilt from its id (itemFor), so a saved round resumes and a due round can mix clusters. Typed rounds
   run in Practice's round (round.js) and are graded by grade.js over match.js, like every other typed answer. */

import { itemOf } from '../../../domain/known.js';

const ART = new Set(['der', 'die', 'das']);
export const ROUND = 12;
export const NEW_PER_ROUND = 6;

/** The form he types: a noun with its article ("der Unfall"), anything else as listed. @param {any} w */
export const form = w => (w.pos === 'noun' && ART.has(w.art) ? `${w.art} ${w.w}` : w.w);
/** Accepted answers for a word: with "sich" optional for reflexive verbs. @param {any} w */
function accepted(w) {
  const f = form(w);
  return /^sich /.test(f) ? [f, f.slice(5)] : [f];
}
/** @param {any} w */
const gloss = w => (w.en || []).slice(0, 3).join('; ');
/** @param {any} w */
const strictArt = w => (w.pos === 'noun' && ART.has(w.art) ? [w.art] : []);
/** @param {any} w */
const card = w => ({ head: form(w) + (w.pos === 'noun' && w.pl ? `, ${w.pl}` : ''), ex: w.ex || null, exEn: w.exen || null, conf: null });

/** Whether a word can be a typed card: no open slot (… or brackets) in it. @param {any} w */
export const typable = w => !!w && !/[…()[\]]/.test(w.w);

/**
 * The card ids of a cluster, in study order (words with an open slot, like "statt … zu", only count).
 * @param {import('../../../domain/clusters.js').Cluster} cl @param {{word: (id: string) => any}} ix
 */
export function cardIds(cl, ix) {
  if (cl.type === 'prep') return (cl.gaps || []).map((/** @type {any} */ g) => `CP:${g.id}`);
  const ok = (/** @type {string} */ id) => typable(ix.word(id));
  if (cl.type === 'opp') return (cl.pairs || []).filter((/** @type {any} */ p) => ok(p.a) && ok(p.b)).flatMap((/** @type {any} */ p) => [`CO:${p.a}~${p.b}`, `CO:${p.b}~${p.a}`]);
  if (cl.type === 'family') return cl.items.filter(ok).map(id => (id === cl.head ? `W:${id}` : `CF:${id}`));
  return cl.items.filter(ok).map(id => `W:${id}`);
}

/**
 * The item ids a cluster counts as known / total (its words; a preposition group: its prepositions).
 * @param {import('../../../domain/clusters.js').Cluster} cl
 */
export const itemIds = cl => cl.items.map(id => `W:${id}`);

/**
 * A round item for a card id, or null when the content no longer has it.
 * @param {string} id
 * @param {{word: (id: string) => any, opposites: (id: string) => string[]}} ix  domain/clusters.js index()
 * @param {any} c the clusters content
 * @param {{t: (k: string, v?: any) => string, where?: string}} o
 */
export function itemFor(id, ix, c, { t, where = '' }) {
  // a card whose content moved keeps its id and shows the item it now points to (content aliases)
  const to = c.aliases?.[id];
  if (to && to !== id) { const it = itemFor(to, ix, c, { t, where }); return it ? { ...it, id } : null; }
  const base = { id, area: 'clusters', teil: null, fn: null, star: false, trap: null, focus: [], plan: 'recall', hl: null, partner: null, prefill: null,
    anywhere: false, literal: true, wrong: [], src: 'cluster', origin: 'practice', level: 'B1', where };
  if (id.startsWith('CP:')) {
    const g = (c.preps?.gaps || []).find((/** @type {any} */ x) => x.id === id.slice(3));
    if (!g) return null;
    const note = c.preps.notes[g.prep]?.note || '';
    return { ...base, kind: 'prep', group: g.prep, task: t('practice.clusters.task.prep'), prompt: g.de, promptLang: 'de', gap: true, loose: true, strict: [],
      accept: g.answer, model: g.de.replace('___', g.answer[0]), gloss: g.en, rule: g.note, usage: [g.note, (note.match(/^.*?[.:](?=\s|$)/) || [note])[0]].filter(Boolean).join(' '), level: ix.word(g.prep)?.level || 'A2' };
  }
  if (id.startsWith('CO:')) {
    const [a, b] = id.slice(3).split('~');
    const wa = ix.word(a), wb = ix.word(b);
    if (!wa || !wb) return null;
    const others = ix.opposites(a).filter(x => x !== b).map(x => ix.word(x)).filter(Boolean);
    return { ...base, kind: 'opposite', group: a, task: t('practice.clusters.task.opp'), prompt: form(wa), promptLang: 'de', gap: false, loose: false,
      strict: strictArt(wb), accept: [...accepted(wb), ...others.flatMap(accepted)], model: form(wb), gloss: gloss(wa), rule: '', card: card(wb), level: wb.level };
  }
  const wid = id.replace(/^(W|CF):/, '');
  const w = ix.word(wid);
  if (!w) return null;
  const fam = id.startsWith('CF:') ? (c.families || []).find((/** @type {any} */ f) => f.members.includes(wid)) : null;
  const head = fam ? ix.word(fam.head) : null;
  const task = head ? t('practice.clusters.task.family', { head: form(head) })
    : w.pos === 'noun' && ART.has(w.art) ? t('practice.clusters.task.noun') : t('practice.clusters.task.word');
  return { ...base, kind: head ? 'family' : 'word', group: fam ? fam.id : w.theme || '', task, prompt: gloss(w), promptLang: 'en', gap: false, loose: false,
    strict: strictArt(w), accept: accepted(w), model: form(w), gloss: null, rule: '', card: card(w), level: w.level };
}

/**
 * The card ids of a round: due cards first (lowest recall first), then cards not seen yet in study order (at most
 * NEW_PER_ROUND, none when the clock allows no new items), then, when nothing is due or new, seen cards not reviewed
 * today, least well known first, so a cluster can always be practised.
 * newCap: at most this many new cards (a round of words picked on the map takes all of them while new items are allowed).
 * skip: cards never introduced as new (their word is marked known in some deck, domain/known.js skipsNew); a card
 * marked known waits for its check and is not practised ahead either.
 * @param {{ids: string[], cards: Record<string, any>, c: any, isDue: (rec: any) => boolean, recall: (rec: any) => number, size?: number, newCap?: number, skip?: (id: string) => boolean}} o
 * @returns {{ids: string[], due: number, fresh: number, extra: boolean}}
 */
export function compose({ ids, cards, c, isDue, recall, size = ROUND, newCap = NEW_PER_ROUND, skip = () => false }) {
  const due = ids.filter(id => cards[id]?.reps && isDue(cards[id])).sort((a, b) => recall(cards[a]) - recall(cards[b])).slice(0, size);
  const cap = c.newItems ? Math.min(newCap, size - due.length) : 0;
  const fresh = ids.filter(id => !cards[id]?.reps && !skip(id)).slice(0, Math.max(0, cap));
  if (due.length + fresh.length) return { ids: spread(due, fresh), due: due.length, fresh: fresh.length, extra: false };
  const extra = ids.filter(id => cards[id]?.reps && cards[id].last !== c.today && !(cards[id].known && !cards[id].known.checked)).sort((a, b) => recall(cards[a]) - recall(cards[b])).slice(0, size);
  return { ids: extra, due: 0, fresh: 0, extra: extra.length > 0 };
}

/** New cards between reviews: r r n r r n … @param {string[]} olds @param {string[]} news */
function spread(olds, news) {
  const o = [...olds], n = [...news], out = [];
  while (o.length || n.length) { if (o.length) out.push(o.shift()); if (o.length) out.push(o.shift()); if (n.length) out.push(n.shift()); }
  return /** @type {string[]} */ (out);
}

/**
 * A round kind for the address: 'cluster:<type>:<id>', 'cluster:due', or 'cluster:pick' (the words in ?ids=, picked
 * on the Explore map). @param {string | null} kind
 */
export function parseClusterKind(kind) {
  if (kind === 'cluster:pick') return { due: false, key: null, pick: true };
  const m = /^cluster:(?:(due)|(family|opp|prefix|suffix|topic|prep):([\w.äöüß-]+))$/.exec(String(kind || ''));
  if (!m) return null;
  return m[1] ? { due: true, key: null } : { due: false, key: `${m[2]}:${m[3]}` };
}

/** Most words a picked round takes. */
export const PICK_MAX = 12;
/**
 * The card ids of a picked round from the address (?ids=<word id>,<word id>…): W: cards, in the order given, without
 * repeats, at most PICK_MAX. Anything that is not a plain word id is dropped. @param {string | null} param
 */
export function pickIds(param) {
  const out = [];
  for (const raw of String(param || '').split(',')) {
    const id = raw.trim();
    if (id && /^[\wäöüÄÖÜß.'-]+$/.test(id) && !out.includes(`W:${id}`)) out.push(`W:${id}`);
    if (out.length >= PICK_MAX) break;
  }
  return out;
}

/**
 * The words a round asked, as word ids in the cluster's order (a family card, an opposite and a preposition gap ask a
 * word too). @param {Record<string, any>} prev the round's cards (id → record before) @param {any} cl the cluster or null
 * @param {any} content the clusters content
 */
export function roundWords(prev, cl, content) {
  /** @type {string[]} */ const out = [];
  for (const id of Object.keys(prev || {})) {
    let w = itemOf(id).replace(/^W:/, '');
    if (id.startsWith('CP:')) w = (content?.preps?.gaps || []).find((/** @type {any} */ g) => g.id === id.slice(3))?.prep || '';
    if (w && !/^[A-Z]{1,2}:/.test(w) && !out.includes(w)) out.push(w);
  }
  return cl ? cl.items.filter((/** @type {string} */ w) => out.includes(w)).concat(out.filter(w => !cl.items.includes(w))) : out;
}

/**
 * The part of a cluster a round touched: its words (a family keeps its head, opposites the pairs of those words).
 * @param {any} cl @param {string[]} words
 */
export function partOf(cl, words) {
  const set = new Set(words);
  if (cl.type === 'opp') { const pairs = (cl.pairs || []).filter((/** @type {any} */ p) => set.has(p.a) || set.has(p.b)); return { ...cl, pairs, items: [...new Set(pairs.flatMap((/** @type {any} */ p) => [p.a, p.b]))] }; }
  if (cl.type === 'family') return { ...cl, items: [cl.head, ...cl.items.filter((/** @type {string} */ w) => w !== cl.head && set.has(w))] };
  return { ...cl, items: cl.items.filter((/** @type {string} */ w) => set.has(w)) };
}
