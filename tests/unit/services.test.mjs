// Platform services (Arch #8): voice (TTS), the one audio player, speech (recognition + recording), share, haptics and
// the language seam. No browser: speechSynthesis, Audio, MediaRecorder, navigator.share are fakes. All data synthetic.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickVoice, say, canSay, unlock, setVoice } from '../../src/services/voice.js';
import { clip, track, stop, setAudioHooks } from '../../src/services/audio.js';
import { webSpeech } from '../../src/services/speech.js';
import { createRecorder } from '../../src/services/recorder.js';
import { webShare } from '../../src/services/share.js';
import { webHaptics } from '../../src/services/haptics.js';
import { setLanguage, langAttr, bcp47, asrLocale, dirAttr, language, voicePrefsFor } from '../../src/core/lang.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* ---------- fakes ---------- */

/** speechSynthesis with a voice list; records what was spoken. */
function fakeSynth(voices) {
  const did = { spoken: [], cancels: 0 };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.volume = 1; } };
  globalThis.speechSynthesis = {
    getVoices: () => voices,
    speak: u => { did.spoken.push(u); did.last = u; },
    cancel: () => { did.cancels++; },
    addEventListener() {}, removeEventListener() {},
  };
  return did;
}

/** An Audio element with events; play() resolves, rejects or hangs as told. */
function fakeAudio({ play = 'ok' } = {}) {
  const made = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src || ''; this.preload = 'auto'; this.paused = true; this.currentTime = 0; this.l = {}; made.push(this); }
    addEventListener(type, fn, o) { (this.l[type] ||= []).push({ fn, once: !!o?.once }); }
    emit(type) { const ls = this.l[type] || []; this.l[type] = ls.filter(x => !x.once); for (const x of ls) x.fn(); }
    play() {
      if (play === 'blocked') return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
      if (play === 'hang') return new Promise(() => {});
      this.paused = false;
      queueMicrotask(() => this.emit('playing'));
      return Promise.resolve();
    }
    pause() { if (!this.paused) { this.paused = true; this.emit('pause'); } }
    removeAttribute() { this.src = ''; }
    load() {}
  };
  return made;
}

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { setVoice(null); setLanguage('german'); stop(); });

/* ---------- language seam ---------- */

test('lang: German is the default; a language without content keeps German; the tags come from one table', () => {
  assert.equal(setLanguage(null).id, 'german');
  assert.deepEqual([langAttr(), bcp47(), asrLocale(), dirAttr()], ['de', 'de-DE', 'de-DE', 'ltr']);
  setLanguage('arabic');   // no content in this build
  assert.equal(language().id, 'german', 'content is German, so its lang attribute stays de');
  setLanguage('nonsense');
  assert.equal(langAttr(), 'de');
  assert.ok(voicePrefsFor('de-AT').prefer.test('Anna'), 'any German region finds the German voice list');
  assert.equal(voicePrefsFor('xx-YY').prefer, null);
});

/* ---------- voice ---------- */

const VOICES = [
  { name: 'Eddy (Deutsch (Deutschland))', lang: 'de-DE' },
  { name: 'Microsoft Seraphina Multilingual Online (Natural)', lang: 'de-DE' },
  { name: 'Anna', lang: 'de_DE' },
  { name: 'Google Deutsch', lang: 'de-DE', localService: false },
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Petra', lang: 'de-AT' },
];

test('voice: a monolingual voice for the tag; the language list wins, then the exact region; never Multilingual', () => {
  assert.equal(pickVoice(VOICES, 'de-DE').name, 'Anna', 'a preferred name, de_DE read as de-DE');
  assert.equal(pickVoice(VOICES, 'en-GB').name, 'Daniel');
  assert.equal(pickVoice(VOICES, 'fr-FR'), null, 'no French voice');
  const multiOnly = [{ name: 'Florian Multilingual', lang: 'de-DE' }];
  assert.equal(pickVoice(multiOnly, 'de-DE'), null, 'a Multilingual voice is never used');
  assert.equal(pickVoice(VOICES, 'de-DE', { prefer: null }).name, 'Eddy (Deutsch (Deutschland))', 'no list: exact region first');
  assert.equal(pickVoice(VOICES, 'de-DE', { avoid: /Anna|Eddy/ }).name, 'Google Deutsch');
  assert.equal(pickVoice(VOICES, 'de-DE', { avoid: /Anna|Eddy/, localOnly: true }).name, 'Petra', 'a private text never gets a cloud voice');
});

test('voice: say() speaks with the chosen voice and rate, reports start and end; null without a voice', async () => {
  const did = fakeSynth(VOICES);
  assert.equal(canSay('de-DE'), true);
  const words = [];
  const s = say('Guten Tag', 'de-DE', { rate: 0.8, onWord: (i, n) => words.push([i, n]) });
  assert.ok(s);
  assert.equal(did.last.text, 'Guten Tag');
  assert.equal(did.last.voice.name, 'Anna');
  assert.equal(did.last.rate, 0.8);
  did.last.onboundary({ name: 'word', charIndex: 6, charLength: 3 });
  did.last.onstart();
  did.last.onend();
  assert.equal(await s.started, true);
  assert.equal((await s.done).ended, true);
  assert.deepEqual(words, [[6, 3]]);
  fakeSynth([{ name: 'Thomas', lang: 'fr-FR' }]);
  assert.equal(say('Guten Tag', 'de-DE'), null);
  assert.equal(canSay('de-DE'), false);
});

test('voice: unlock() speaks one silent utterance, once, and only inside a tap', () => {
  const did = fakeSynth(VOICES);
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userActivation: { isActive: false } }, configurable: true });
  try {
    setVoice(null);
    unlock();
    assert.equal(did.spoken.length, 0, 'outside a tap: nothing');
    globalThis.navigator.userActivation.isActive = true;
    unlock(); unlock();
    assert.equal(did.spoken.length, 1);
    assert.equal(did.spoken[0].volume, 0);
  } finally { if (nav) Object.defineProperty(globalThis, 'navigator', nav); }
});

/* ---------- the player ---------- */

test('audio: clip() starts at once, reports playing, then onEnded and onEnd once', async () => {
  const made = fakeAudio();
  const ev = [];
  const c = clip('https://media.example/a.mp3', { onStart: () => ev.push('start'), onEnded: () => ev.push('ended'), onEnd: () => ev.push('end') });
  assert.equal(made.length, 1);
  assert.equal(made[0].paused, false, 'play() was called synchronously, inside the caller\'s tap');
  assert.equal(await c.result, 'playing');
  made[0].paused = true; made[0].emit('ended'); made[0].emit('pause');
  assert.deepEqual(ev, ['start', 'ended', 'end']);
});

test('audio: one thing plays at a time; stop() stops it; the shell hears starts and stops', async () => {
  const made = fakeAudio();
  const duck = [];
  setAudioHooks({ duck: on => duck.push(on) });
  const a = clip('https://media.example/a.mp3');
  await a.result;
  const b = clip('https://media.example/b.mp3');
  assert.equal(made[0].paused, true, 'the first is paused when the second starts');
  await b.result;
  stop();
  assert.equal(made[1].paused, true);
  assert.deepEqual(duck, [true, false, true, false]);
  setAudioHooks({ duck: () => {} });
});

test('audio: blocked and stalled clips say so', async () => {
  fakeAudio({ play: 'blocked' });
  assert.equal(await clip('https://media.example/a.mp3').result, 'blocked');
  const made = fakeAudio({ play: 'hang' });
  const ends = [];
  const c = clip('https://media.example/b.mp3', { stallMs: 20, onEnd: () => ends.push(1) });
  assert.equal(await c.result, 'stalled');
  assert.equal(made[0].src, '', 'a stalled clip lets go of its source');
  assert.deepEqual(ends, [], 'it never started, so it never "ends"');
});

test('audio: track() is exam audio with a play limit, counted only once playback started', async () => {
  const made = fakeAudio();
  let used = 0;
  const tr = track('https://media.example/hoeren-1.mp3', { limit: 2, used: () => used, onCount: () => used++ });
  assert.equal(made[0].preload, 'none', 'nothing loads before the first play');
  assert.equal(tr.remaining(), 2);
  assert.equal(await tr.start(), 'playing');
  assert.equal(made[0].preload, 'auto');
  assert.equal(used, 1);
  assert.equal(await tr.start(), 'playing');
  assert.equal(await tr.start(), 'limit', 'no third play');
  assert.equal(used, 2);
  // a play the browser blocks is not counted
  fakeAudio({ play: 'blocked' });
  let n = 0;
  const t2 = track('https://media.example/hoeren-2.mp3', { limit: 1, used: () => n, onCount: () => n++ });
  assert.equal(await t2.start(), 'blocked');
  assert.equal(n, 0);
  assert.equal(t2.remaining(), 1);
});

/* ---------- speech ---------- */

function fakeRecorderDeps() {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const stream = { getTracks: () => [track] };
  class MR {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/mp4'; MR.last = this; }
    static isTypeSupported(m) { return m === 'audio/mp4'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
  }
  return { md: { getUserMedia: async () => stream }, MR, track };
}

test('speech: the recogniser listens in the locale it is given', async () => {
  const made = [];
  globalThis.SpeechRecognition = class {
    constructor() { made.push(this); }
    start() { setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'hallo' }], { isFinal: true })] }); this.onend?.(); }, 0); }
    stop() {}
  };
  try {
    const sp = webSpeech();
    assert.equal(sp.canListen(), true);
    const heard = await sp.listen({ lang: 'fr-FR' }).done;
    assert.equal(made[0].lang, 'fr-FR');
    assert.equal(heard.text, 'hallo');
  } finally { delete globalThis.SpeechRecognition; }
});

test('speech: recording goes through services/recorder.js (one MediaRecorder path), cancel stops it', async () => {
  const f = fakeRecorderDeps();
  const sp = webSpeech({ recorder: () => createRecorder({ mediaDevices: /** @type {any} */ (f.md), MediaRecorderImpl: f.MR }) });
  assert.equal(sp.canRecord(), true);
  const take = await sp.record();
  f.MR.last.ondataavailable({ data: new Blob([new Uint8Array(40)], { type: 'audio/mp4' }) });
  const blob = await take.stop();
  assert.equal(blob.size, 40);
  assert.equal(f.track.stopped, true, 'the microphone is released');
  const again = await sp.record();
  sp.cancel();
  assert.equal(await again.stop(), null, 'nothing recorded: null');
  const none = webSpeech({ recorder: () => createRecorder({ mediaDevices: null, MediaRecorderImpl: undefined }) });
  assert.equal(none.canRecord(), false);
  await assert.rejects(none.record());
});

test('only services/ touch the microphone, the recogniser, the level meter, the voices, the player, vibrate and share; no feature hard-codes de-DE', () => {
  const bad = [];
  const walk = d => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { if (n !== 'vendor') walk(p); } else if (p.endsWith('.js')) {
    const rel = path.relative(ROOT, p);
    if (rel.startsWith('src/services/')) continue;
    const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/new Audio\(|MediaRecorder|speechSynthesis\.|SpeechSynthesisUtterance|SpeechRecognition|getUserMedia|AudioContext|createAnalyser|getFloatTimeDomainData|navigator\.vibrate|navigator\.share/.test(src)) bad.push(rel);
    if (rel.startsWith('src/features/') && /['"]de-DE['"]/.test(src)) bad.push(`${rel} (a hard-coded de-DE: use core/lang.js)`);
  } } };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(bad, []);
});

/* ---------- share and haptics ---------- */

test('share: the share sheet on a touch device that can share files; a closed sheet downloads nothing; else a download', async () => {
  const saved = [];
  const save = (b, n) => saved.push(n);
  const shared = [];
  const nav = { canShare: () => true, share: async o => { shared.push(o.files[0].name); } };
  assert.equal(await webShare({ nav, coarse: () => true, save }).shareFile(new Blob(['x']), 'a.json'), 'shared');
  assert.deepEqual(shared, ['a.json']);
  const abort = { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } };
  assert.equal(await webShare({ nav: abort, coarse: () => true, save }).shareFile(new Blob(['x']), 'b.json'), 'cancelled');
  assert.deepEqual(saved, []);
  const refused = { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } };
  assert.equal(await webShare({ nav: refused, coarse: () => true, save }).shareFile(new Blob(['x']), 'c.json'), 'downloaded', 'outside a tap: the download');
  assert.equal(await webShare({ nav, coarse: () => false, save }).shareFile(new Blob(['x']), 'd.json'), 'downloaded', 'a desktop downloads');
  assert.equal(await webShare({ nav: {}, coarse: () => true, save }).shareFile(new Blob(['x']), 'e.json'), 'downloaded');
  assert.deepEqual(saved, ['c.json', 'd.json', 'e.json']);
});

test('haptics: the Vibration API where there is one; nothing (and no error) where there is none', () => {
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    const buzz = [];
    Object.defineProperty(globalThis, 'navigator', { value: { vibrate: ms => buzz.push(ms), userAgent: 'Android' }, configurable: true });
    webHaptics().tap();
    assert.deepEqual(buzz, [8]);
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Desktop' }, configurable: true });
    webHaptics().tap();
  } finally { if (nav) Object.defineProperty(globalThis, 'navigator', nav); }
});
