#!/usr/bin/env node
// Content gate: the manifest is current, every listed file exists with the listed sha256, and every file validates
// against its JSON Schema in schemas/content/. The schemas are checked for keywords the validator does not support.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validate, unsupported } from '../src/core/schema.js';
import { build, ROOT } from './build-manifest.mjs';
import { build as buildSpeak, serialise as serialiseSpeak, SRC as SPEAK_SRC } from './build-speak.mjs';
import { validateBank } from '../src/features/practice/sim.js';
import { validateClusters } from '../src/domain/clusters.js';
import { build as buildClusters, serialise as serialiseClusters, withAdded, OUT as CLUSTERS_OUT, WORDS as WORDS_PATH } from './build-clusters.mjs';

const schemas = new Map();
for (const f of readdirSync(path.join(ROOT, 'schemas/content'))) {
  const s = JSON.parse(readFileSync(path.join(ROOT, 'schemas/content', f), 'utf8'));
  const bad = unsupported(s);
  if (bad.length) { console.error(`${f}: unsupported keywords ${bad.join(', ')}`); process.exit(1); }
  schemas.set(s.$id, s);
}
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'content/manifest.json'), 'utf8'));
const errors = [];
if (JSON.stringify(build()) !== JSON.stringify(manifest)) errors.push('content/manifest.json is out of date: run node tools/build-manifest.mjs');
const ms = JSON.parse(readFileSync(path.join(ROOT, 'schemas/records/content-manifest.schema.json'), 'utf8'));
for (const e of validate(ms, manifest)) errors.push(`manifest.json ${e}`);
let n = 0;
for (const f of manifest.files) {
  const buf = readFileSync(path.join(ROOT, 'content', f.path));
  if (createHash('sha256').update(buf).digest('hex') !== f.sha256) errors.push(`${f.path}: sha256 differs from the manifest`);
  const schema = schemas.get(f.schema);
  if (!schema) { errors.push(`${f.path}: no schema ${f.schema} in schemas/content`); continue; }
  const errs = validate(schema, JSON.parse(buf.toString('utf8')));
  errs.forEach(e => errors.push(`${f.path} ${e}`));
  n++;
}
// speaking situations: built from their source, and the rules a schema cannot say (sim.js validateBank)
const speakPath = path.join(ROOT, 'content/speak/situations.json');
const speakText = readFileSync(speakPath, 'utf8');
if (serialiseSpeak(buildSpeak(JSON.parse(readFileSync(SPEAK_SRC, 'utf8')))) !== speakText) errors.push('content/speak/situations.json is out of date: run node tools/build-speak.mjs');
const chunkIds = new Set(Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/chunks/german.json'), 'utf8')).chunks));
const frameIds = new Set(JSON.parse(readFileSync(path.join(ROOT, 'content/b1/frames.json'), 'utf8')).map((/** @type {any} */ f) => f.id));
for (const e of validateBank(JSON.parse(speakText), { chunkIds, frameIds })) errors.push(`speak/situations.json ${e}`);
// word clusters: built from their sources, and the rules a schema cannot say (domain/clusters.js validateClusters)
{
  const wordsText = readFileSync(WORDS_PATH, 'utf8');
  try {
    if (withAdded(wordsText, JSON.parse(readFileSync(path.join(ROOT, 'authoring/clusters/words-added.de.json'), 'utf8'))) !== wordsText) errors.push('content/igloo/words/de.json lacks the cluster words: run node tools/build-clusters.mjs');
    const words = JSON.parse(wordsText);
    const clustersText = readFileSync(CLUSTERS_OUT, 'utf8');
    if (serialiseClusters(buildClusters(words)) !== clustersText) errors.push('content/clusters/de.json is out of date: run node tools/build-clusters.mjs');
    const themes = JSON.parse(readFileSync(path.join(ROOT, 'content/igloo/words/themes.json'), 'utf8')).map((/** @type {any} */ t) => t.id);
    for (const e of validateClusters(JSON.parse(clustersText), { words, chunkIds, themes })) errors.push(`clusters/de.json ${e}`);
  } catch (e) { errors.push(`clusters: ${/** @type {Error} */ (e).message}`); }
}
if (errors.length) {
  console.error(`validate-content: ${errors.length} problem(s)`);
  errors.slice(0, 60).forEach(e => console.error('  ' + e));
  process.exit(1);
}
console.log(`validate-content: ${n} files valid against ${schemas.size} schemas; manifest ${manifest.version} current`);
