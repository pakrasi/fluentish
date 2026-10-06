// The append-only ledger of card ids that content has shipped (audit P1-10). A learner's card is keyed by an id that
// comes from content (a slug, a word id, a gap id, a pair of word ids); renaming a phrase, moving a word from family
// member to family head or deleting a gap would orphan that card without anyone noticing. Every id content can
// create is listed once in tests/fixtures/shipped-ids.txt and stays there: tests/unit/item-ids.test.mjs fails when
// one of them is no longer created by the content, unless it is listed in tests/fixtures/retired-ids.txt (with a
// reason, after its cards have been migrated).
//
//   node tools/shipped-ids.mjs            check: every shipped id is still created (exit 1 if not)
//   node tools/shipped-ids.mjs --write    append the ids the content creates now that are not in the ledger yet
//
// The ledger only grows: --write never removes a line. What it covers: the B1 pool (BP/BL/BG/BT/BR/BS/K/G, as
// features/shared/pool.js builds it) and its B2 layer (G:/K:, pool.js b2Layer), every word of the word list (W:<word id>, the id Look up, Explore, Word
// clusters and the exam words use), every Word cluster card (CO/CF/CP and family heads), and the speaking situations
// (SS:), and every Word building card (PX/PD/PV/PS/SX/PW). Ids made from a learner's own data (F:, BW: exam words, SR:/SW: script cards) are not content and are not
// listed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER = path.join(ROOT, 'tests/fixtures/shipped-ids.txt');
export const RETIRED = path.join(ROOT, 'tests/fixtures/retired-ids.txt');
const J = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const imp = (/** @type {string} */ p) => import(pathToFileURL(path.join(ROOT, p)).href);

/** Every card id the current content creates. @returns {Promise<Set<string>>} */
export async function currentIds() {
  const { buildPool } = await imp('src/features/shared/pool.js');
  const { index } = await imp('src/domain/clusters.js');
  const { cardIds } = await imp('src/features/shared/cluster-items.js');
  const ids = new Set();
  const data = buildPool({ items: J('content/b1/items.json'), grammar: J('content/b1/grammar.json'), bank: J('content/b1/bank.json'), plan: J('content/b1/plan.json'),
    nouns: J('content/b1/nouns.json'), schreiben: J('content/b1/schreiben.json'),
    // the B2 layer (round 4, L1b): reachable through the level gate
    b2: { grammar: J('content/igloo/grammar/items_de.json'), concepts: J('content/igloo/grammar/concepts_de.json'), annot: J('content/b1/annot.json'),
      en: J('content/igloo/chunks/en.json'), de: J('content/igloo/chunks/german.json').chunks, accept: J('content/igloo/chunks/accept_german.json') } });
  for (const it of data.pool) ids.add(it.id);
  for (const it of data.b2) ids.add(it.id);
  const words = J('content/igloo/words/de.json');
  for (const w of words) ids.add(`W:${w.id}`);
  for (const [, [id]] of Object.entries(J('content/b1/wordmap.json'))) ids.add(`W:${id}`);
  const clusters = J('content/clusters/de.json');
  const ix = index(clusters, words);
  for (const cl of ix.all) for (const id of cardIds(cl, ix)) ids.add(id);
  // an alias keeps an old card id working: the card shows the item it points to (clusters/items.js itemFor)
  for (const [old, to] of Object.entries(clusters.aliases || {})) if (ids.has(to)) ids.add(old);
  for (const it of J('content/speak/situations.json').items) ids.add(it.id);
  // Word building (deck 'build'): prefix, verb, sentence, suffix and word cards (domain/wordbuild.js cardIds)
  const { cardIds: buildIds } = await imp('src/domain/wordbuild.js');
  for (const id of buildIds(J('content/build/de.json'))) ids.add(id);
  return ids;
}

/** @param {string} file */
export const readList = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean) : []);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cur = await currentIds();
  const shipped = readList(LEDGER), retired = new Set(readList(RETIRED));
  const gone = shipped.filter(id => !cur.has(id) && !retired.has(id));
  if (process.argv.includes('--write')) {
    const have = new Set(shipped), add = [...cur].filter(id => !have.has(id)).sort();
    if (add.length) writeFileSync(LEDGER, (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '') + add.join('\n') + '\n');
    console.log(`shipped-ids: ${add.length} added, ${shipped.length + add.length} in the ledger`);
  }
  if (gone.length) { console.error(`shipped-ids: ${gone.length} shipped id(s) no longer created:\n  ${gone.slice(0, 40).join('\n  ')}`); process.exit(1); }
  if (!process.argv.includes('--write')) console.log(`shipped-ids: all ${shipped.length} shipped ids are still created`);
}
