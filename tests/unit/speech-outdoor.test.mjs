// Speaking outdoors (services/speech.js, level.js, recorder.js): every alternative kept, a session that ends early
// restarted inside one attempt, a take whose words stop changing ended, the noise check, the capture constraints.
// No browser: the recogniser, the meter and getUserMedia are fakes. All data synthetic.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { webSpeech, STALE_MS } from '../../src/services/speech.js';
import { createRecorder } from '../../src/services/recorder.js';
import { audioConstraints, createMeter } from '../../src/services/level.js';
import { NOISE } from '../../src/domain/hearing.js';

const wait = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** A recogniser the test drives: each instance is pushed to `made`; say(), fail(), end() play its events. */
function fakeRecogniser() {
  const made = [];
  globalThis.SpeechRecognition = class {
    constructor() { made.push(this); this.started = 0; }
    start() { this.started++; }
    stop() { queueMicrotask(() => this.onend?.()); }
    abort() { this.stop(); }
    /** a final result with alternatives: [[text, confidence], …] */
    say(alts, { final = true, index = 0 } = {}) {
      const res = Object.assign(alts.map(([transcript, confidence]) => ({ transcript, confidence })), { isFinal: final });
      const results = []; results[index] = res;
      this.onresult?.({ resultIndex: index, results });
    }
    fail(error) { this.onerror?.({ error }); }
    end() { this.onend?.(); }
  };
  return made;
}
afterEach(() => { delete globalThis.SpeechRecognition; });

/** A meter that reports the given dBFS frames on start, then keeps reporting the last one. */
function fakeMeter(frames, { fail = false } = {}) {
  const did = { started: 0, stopped: 0 };
  return {
    did,
    make: () => ({
      async start(onDb) {
        did.started++;
        if (fail) throw new Error('denied');
        for (const f of frames) onDb(f);
      },
      stop() { did.stopped++; },
    }),
  };
}

test('every alternative is kept, best guess first, with its confidence', async () => {
  const made = fakeRecogniser();
  const sp = webSpeech();
  const l = sp.listen({ lang: 'de-DE' });
  const r = made[0];
  assert.equal(r.maxAlternatives, 5);
  r.say([['ich habe Angst für Hunde', 0.42], ['ich habe Angst vor Hunden', 0.31], ['ich hab Angst für Hunde', 0.2]]);
  r.end();
  const heard = await l.done;
  assert.equal(heard.text, 'ich habe Angst für Hunde');
  assert.equal(heard.confidence, 0.42);
  assert.deepEqual(heard.alts.map(a => a.text), ['ich habe Angst für Hunde', 'ich habe Angst vor Hunden', 'ich hab Angst für Hunde']);
  assert.equal(heard.restarts, 0); assert.equal(heard.error, null);
});

test('a session that ends early with nothing heard is restarted inside the attempt; a refusal is not', async () => {
  const made = fakeRecogniser();
  const sp = webSpeech();
  const l = sp.listen({ lang: 'de-DE' });
  made[0].fail('no-speech'); made[0].end();          // a gust: Safari gave up
  await wait(200);
  assert.equal(made.length, 2, 'started again');
  made[1].say([['Wie wäre es mit Donnerstag', 0.9]]); made[1].end();
  const heard = await l.done;
  assert.equal(heard.text, 'Wie wäre es mit Donnerstag');
  assert.equal(heard.restarts, 1);
  assert.equal(heard.error, null, 'the early end is not an error once something was heard');

  const made2 = fakeRecogniser();
  const sp2 = webSpeech();
  const l2 = sp2.listen({ lang: 'de-DE' });
  made2[0].fail('not-allowed'); made2[0].end();
  const h2 = await l2.done;
  assert.equal(made2.length, 1, 'never restarted');
  assert.equal(h2.error, 'not-allowed'); assert.equal(sp2.blocked(), true);
});

test('restarts stop after a few tries; he stopping it never restarts', async () => {
  const made = fakeRecogniser();
  const sp = webSpeech();
  const l = sp.listen({ lang: 'de-DE' });
  for (let i = 0; i < 3; i++) { await wait(200); made[made.length - 1].end(); }
  const heard = await l.done;
  assert.equal(made.length, 3, 'the first try and two restarts');
  assert.equal(heard.text, ''); assert.equal(heard.restarts, 2);

  const made2 = fakeRecogniser();
  const l2 = webSpeech().listen({ lang: 'de-DE' });
  l2.stop();
  await l2.done;
  await wait(200);
  assert.equal(made2.length, 1);
});

test('hold to talk: continuous, restarted over pauses until he lets go, the parts joined', async () => {
  const made = fakeRecogniser();
  const sp = webSpeech();
  const l = sp.listen({ lang: 'de-DE', hold: true });
  assert.equal(made[0].continuous, true);
  made[0].say([['Ich glaube', 0.8]]); made[0].end();   // a wind pause ended the session
  await wait(200);
  assert.equal(made.length, 2);
  made[1].say([['dass das eine gute Idee ist', 0.7]]);
  l.stop();
  const heard = await l.done;
  assert.equal(heard.text, 'Ich glaube dass das eine gute Idee ist');
  assert.equal(heard.confidence, 0.7, 'the weakest part'); assert.equal(heard.hold, true);
});

test('a take whose words stop changing is ended (wind keeps Safari from hearing silence)', async () => {
  const made = fakeRecogniser();
  let t = 0;
  const sp = webSpeech({ now: () => t });
  const l = sp.listen({ lang: 'de-DE' });
  made[0].say([['Ich komme gern', 0.8]], { final: false });
  t = STALE_MS + 1;
  await wait(300);
  const heard = await l.done;   // ended without a final: the interim words are kept, confidence unknown
  assert.equal(heard.text, 'Ich komme gern');
  assert.equal(heard.confidence, null);
});

test('noise check: about a second of the room first, then listening; a fresh room is not measured again', async () => {
  const made = fakeRecogniser();
  const loud = fakeMeter(Array(20).fill(NOISE.loudDb + 6));
  const sp = webSpeech({ meter: loud.make });
  const phases = [], levels = [];
  const l = sp.listen({ lang: 'de-DE', check: true, onLevel: x => levels.push(x), onPhase: (p, a) => phases.push([p, a && a.noisy]) });
  assert.equal(made.length, 0, 'not listening during the check');
  await wait(1100);
  assert.deepEqual(phases, [['checking', null], ['listening', true]]);
  assert.equal(made.length, 1);
  assert.ok(levels.length >= 20 && levels.every(x => x > 0 && x <= 1), 'the meter saw the frames, 0..1');
  made[0].say([['hallo', 0.9]]); made[0].end();
  const heard = await l.done;
  assert.equal(heard.ambient.noisy, true);
  assert.equal(loud.did.stopped >= 1, true, 'the meter is closed before done resolves');
  assert.equal(sp.noise().noisy, true);
  // the next tap within the minute listens at once
  const l2 = sp.listen({ lang: 'de-DE', check: true, onPhase: p => phases.push([p]) });
  await wait(0);
  assert.deepEqual(phases.slice(2), [['listening']]);
  made[1].end(); await wait(200); made[2].end(); await wait(200); made[3].end();
  await l2.done;
});

test('noise check without a meter (refused, or no Web Audio): listening goes on, no verdict', async () => {
  const made = fakeRecogniser();
  const none = fakeMeter([], { fail: true });
  const sp = webSpeech({ meter: none.make });
  const l = sp.listen({ lang: 'de-DE', check: true });
  await wait(50);
  assert.equal(made.length, 1);
  made[0].say([['ja', 0.9]]); made[0].end();
  assert.equal((await l.done).ambient, null);
  assert.equal(await webSpeech({ meter: () => null }).checkNoise(), null);
  const quiet = fakeMeter(Array(20).fill(-65));
  assert.equal((await webSpeech({ meter: quiet.make }).checkNoise(10)).noisy, false);
});

test('the meter and the recogniser clash once (audio-capture): listening goes on without the meter', async () => {
  const made = fakeRecogniser();
  const m = fakeMeter(Array(10).fill(-60));
  const sp = webSpeech({ meter: m.make });
  const l = sp.listen({ lang: 'de-DE', onLevel: () => {} });
  await wait(0);
  made[0].fail('audio-capture'); made[0].end();
  await wait(200);
  assert.equal(made.length, 2, 'retried without the meter');
  made[1].say([['gern', 0.9]]); made[1].end();
  assert.equal((await l.done).text, 'gern');
  const before = m.did.started;
  const l2 = sp.listen({ lang: 'de-DE', onLevel: () => {} });
  await wait(0);
  assert.equal(m.did.started, before, 'no meter from now on');
  made[2].say([['ja', 0.9]]); made[2].end();
  await l2.done;
});

test('capture constraints: echo cancellation, noise suppression and gain as ideals, only where supported', async () => {
  assert.deepEqual(audioConstraints({ getSupportedConstraints: () => ({ echoCancellation: true, deviceId: true }) }), { echoCancellation: true }, 'iOS Safari: echo cancellation only');
  assert.deepEqual(audioConstraints({ getSupportedConstraints: () => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }) }), { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  assert.deepEqual(audioConstraints({}), { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 'unknown: ask for all, a browser ignores the rest');
  assert.equal(audioConstraints({ getSupportedConstraints: () => ({ deviceId: true }) }), true);
  // the recorder asks with them
  const asked = [];
  const track = { stop() {}, addEventListener() {} };
  const md = { getUserMedia: async c => { asked.push(c); return { getTracks: () => [track] }; }, getSupportedConstraints: () => ({ echoCancellation: true }) };
  class MR { constructor() { this.state = 'inactive'; } static isTypeSupported() { return true; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); } }
  const r = createRecorder({ mediaDevices: md, MediaRecorderImpl: MR });
  await r.start();
  assert.deepEqual(asked[0], { audio: { echoCancellation: true } });
  r.cancel();
});

test('level meter: an analyser frame becomes dBFS on a timer; stop closes the context and the microphone', async () => {
  const closed = [], stopped = [];
  class AC {
    resume() {}
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData(buf) { buf.fill(0.1); } }; }
    close() { closed.push(1); }
  }
  const md = { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped.push(1) }] }) };
  const m = createMeter({ mediaDevices: md, AC, every: 5 });
  assert.equal(m.supported, true);
  const dbs = [];
  await m.start(db => dbs.push(db));
  await wait(30);
  m.stop();
  assert.ok(dbs.length >= 2);
  assert.equal(Math.round(dbs[0]), -20, 'RMS 0.1 is −20 dBFS');
  assert.deepEqual([closed.length, stopped.length], [1, 1]);
  assert.equal(createMeter({ mediaDevices: md, AC: undefined }).supported, false);
});

test('the speaking log stays on the device: device scope, never exported, never in a snapshot', async () => {
  const { DEVICE_SCOPE } = await import('../../src/data/store.js');
  const { NOT_EXPORTED } = await import('../../src/data/transfer.js');
  const { SNAPSHOT_KV } = await import('../../src/data/sync/backup.js');
  assert.equal(DEVICE_SCOPE.has('speech.log'), true);
  assert.equal(NOT_EXPORTED.has('speech.log'), true);
  assert.equal('speech.log' in SNAPSHOT_KV, false);
});
