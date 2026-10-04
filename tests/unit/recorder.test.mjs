// The recorder keeps what was captured when the system ends a take on its own (a call, Siri, the screen locking).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, RecorderError } from '../../src/services/recorder.js';

function fakes() {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const stream = { getTracks: () => [track] };
  let last = null;
  class MR {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/mp4'; last = this; }
    static isTypeSupported(m) { return m === 'audio/mp4'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
    data(bytes) { this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' }) }); }
    systemEnd() { this.state = 'inactive'; this.onstop?.(); }
  }
  return { md: { getUserMedia: async () => stream }, MR, rec: () => last, track };
}

test('a take the system ended is kept, and every chunk is offered to the caller as it comes', async () => {
  const f = fakes();
  const r = createRecorder({ mediaDevices: /** @type {any} */ (f.md), MediaRecorderImpl: f.MR });
  const seen = []; let ended = 0;
  await r.start({ onChunk: b => seen.push(b.size), onEnded: () => ended++ });
  f.rec().data(100); f.rec().data(50);
  assert.deepEqual(seen, [100, 150], 'the audio so far after each chunk');
  f.rec().systemEnd();
  assert.equal(ended, 1); assert.equal(r.ended, true); assert.equal(r.recording, false);
  const { blob, mime } = await r.stop();
  assert.equal(blob.size, 150, 'nothing captured is dropped'); assert.equal(mime, 'audio/mp4');
  assert.equal(f.track.stopped, true, 'the microphone is released');
});

test('a normal stop resolves with the audio; nothing recorded is an empty error', async () => {
  const f = fakes();
  const r = createRecorder({ mediaDevices: /** @type {any} */ (f.md), MediaRecorderImpl: f.MR });
  await r.start();
  f.rec().data(10);
  const { blob } = await r.stop();
  assert.equal(blob.size, 10); assert.equal(r.ended, false);
  await r.start();
  await assert.rejects(r.stop(), e => e instanceof RecorderError && e.code === 'empty');
});
