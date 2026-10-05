#!/usr/bin/env node
// Builds content/speak/situations.json (speaking situations) from authoring/speak/situations.json:
//   - ids get the card prefix ('decline-01' → 'SS:decline-01'); they never change once published
//   - "[chunk]" in an answer becomes offsets (answers[].chunk = [start, end])
//   - each line gets its voice and its audio file name, md5("<voice>|<text>").mp3, the same naming as the exam's
//     word audio. The other person speaks with one of three monolingual German voices (picked from the id, so it
//     never changes), the model answer always with a fourth, so the two sides of the exchange sound different.
// The audio itself is not in git: tools/build_speak_audio.py synthesises it (edge-tts) into media/speak/ and the
// files are published next to the exam audio (<exam media>/speak/, see docs/ARCHITECTURE.md §3.3).
//   node tools/build-speak.mjs           write the content file
//   node tools/build-speak.mjs --check   exit 1 if the content file is not what the source builds
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarked } from '../src/domain/sim.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'authoring/speak/situations.json');
export const OUT = path.join(ROOT, 'content/speak/situations.json');
export const VOICES = { other: ['de-DE-KatjaNeural', 'de-DE-AmalaNeural', 'de-DE-ConradNeural'], answer: 'de-DE-KillianNeural' };

/** md5("<voice>|<text>").mp3 @param {string} voice @param {string} text */
export const audioName = (voice, text) => `${createHash('md5').update(`${voice}|${text}`).digest('hex')}.mp3`;

/** @param {string} id */
const otherVoice = id => VOICES.other[[...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 9973, 7) % VOICES.other.length];

/** @param {any} src the authoring file @returns {any} the content file */
export function build(src) {
  const items = src.items.map((/** @type {any} */ s) => {
    const voice = otherVoice(s.id);
    const answers = s.ans.map((/** @type {string} */ a, /** @type {number} */ k) => {
      const p = parseMarked(a);
      if (!p) throw new Error(`${s.id}: answer ${k + 1} needs exactly one [chunk]: ${a}`);
      return { de: p.de, chunk: p.chunk, audio: audioName(VOICES.answer, p.de) };
    });
    return {
      id: `SS:${s.id}`, fn: s.fn, lv: s.lv, freq: s.freq, reg: s.reg, setup: s.setup, goal: s.goal,
      other: { de: s.other, voice, audio: audioName(voice, s.other) },
      answers,
      ...(s.ck ? { ck: s.ck } : {}), ...(s.frame ? { frame: s.frame } : {}), src: s.src,
    };
  });
  return { about: 'Speaking situations for Practice. Built from authoring/speak/situations.json by tools/build-speak.mjs; do not edit by hand.',
    voices: VOICES, functions: src.functions, items };
}

/** The file as written: one item per line so diffs stay readable. @param {any} bank */
export function serialise(bank) {
  const head = JSON.stringify({ about: bank.about, voices: bank.voices, functions: bank.functions }, null, 2).replace(/\n}$/, '');
  return `${head},\n  "items": [\n${bank.items.map((/** @type {any} */ it) => `    ${JSON.stringify(it)}`).join(',\n')}\n  ]\n}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = serialise(build(JSON.parse(readFileSync(SRC, 'utf8'))));
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur !== text) { console.error('content/speak/situations.json is out of date: run node tools/build-speak.mjs'); process.exit(1); }
    console.log('build-speak: content/speak/situations.json is current');
  } else {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`build-speak: wrote ${path.relative(ROOT, OUT)}`);
  }
}
