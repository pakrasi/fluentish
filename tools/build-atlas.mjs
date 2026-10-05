#!/usr/bin/env node
// Builds content/atlas/de.json: the Explore map's item table and, for the Topic, Word family, Opposites, Level and
// Word type modes, every group's disc and every item's place in it (src/domain/atlas.js). Widths come from the vendored
// map font's advance table (src/vendor/newsreader-map/metrics.json), so the layout is the same on every device.
//
// Positions never move once shipped: the build reads the current map and keeps every existing group and item where it
// is; new items take new lines at the end of their group, new groups free places on the spiral. When a group has no
// room left, the build stops and asks for a repack, which lays everything out afresh (a map release).
//   node tools/build-atlas.mjs            update the map (keeps positions)
//   node tools/build-atlas.mjs --repack   lay out from scratch
//   node tools/build-atlas.mjs --check    exit 1 if the map on disk is not what the content builds
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemsFrom, itemWidths, widthOf, groupsFor, layoutGroups, serialise, placedFrom, BUILT_MODES } from '../src/domain/atlas.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'content/atlas/de.json');
export const METRICS = path.join(ROOT, 'src/vendor/newsreader-map/metrics.json');
const read = (/** @type {string} */ p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

/** The content the map is built from. */
export function sources() {
  return {
    words: read('content/igloo/words/de.json'),
    chunks: read('content/igloo/chunks/german.json').chunks,
    chunksEn: read('content/igloo/chunks/en.json'),
    prio: read('content/igloo/chunks/priority_de.json').prio,
    concepts: read('content/igloo/grammar/concepts_de.json'),
    clusters: read('content/clusters/de.json'),
  };
}

/**
 * Build the map text. previous: the current file (parsed), or null for a fresh layout.
 * @param {ReturnType<typeof sources>} src @param {any} metrics @param {any | null} previous
 */
export function build(src, metrics, previous) {
  const items = itemsFrom(src);
  const width = widthOf(metrics);
  const widths = new Map(items.map(it => [it.id, itemWidths(width, it)]));
  const w = new Map([...widths].map(([id, x]) => [id, x.w]));
  const prev = previous ? placedFrom(previous) : {};
  /** @type {Record<string, any[]>} */ const modes = {};
  for (const mode of BUILT_MODES) modes[mode] = layoutGroups(groupsFor(mode, items, src.clusters), w, { previous: prev[mode] || null });
  const font = { family: metrics.family, opsz: metrics.opsz, wght: metrics.wght, regular: metrics.styles.regular.sha256.slice(0, 16), italic: metrics.styles.italic.sha256.slice(0, 16) };
  if (previous && previous.font && previous.font.regular !== font.regular) throw new Error('the map font changed: repack (node tools/build-atlas.mjs --repack)');
  return serialise({ items, widths, modes, font });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const metrics = JSON.parse(readFileSync(METRICS, 'utf8'));
  const repack = process.argv.includes('--repack'), check = process.argv.includes('--check');
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  const t0 = performance.now();
  const text = build(sources(), metrics, repack || !current ? null : JSON.parse(current));
  if (check) {
    if (text !== current) { console.error('content/atlas/de.json is out of date: run node tools/build-atlas.mjs'); process.exit(1); }
    console.log('build-atlas: content/atlas/de.json current');
  } else {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    const m = JSON.parse(text);
    console.log(`build-atlas: ${m.items.id.length} items; ${Object.entries(m.modes).map(([k, g]) => `${k} ${/** @type {any[]} */ (g).length} groups`).join(', ')}; ${(text.length / 1024).toFixed(0)} kB; ${(performance.now() - t0).toFixed(0)} ms`);
  }
}
