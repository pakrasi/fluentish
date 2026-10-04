#!/usr/bin/env node
// Content gate: the manifest is current, every listed file exists with the listed sha256, and every file validates
// against its JSON Schema in schemas/content/. The schemas are checked for keywords the validator does not support.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validate, unsupported } from '../src/core/schema.js';
import { build, ROOT } from './build-manifest.mjs';

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
if (errors.length) {
  console.error(`validate-content: ${errors.length} problem(s)`);
  errors.slice(0, 60).forEach(e => console.error('  ' + e));
  process.exit(1);
}
console.log(`validate-content: ${n} files valid against ${schemas.size} schemas; manifest ${manifest.version} current`);
