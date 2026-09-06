// WebM offline: config encode, candidati codec.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { webmConfigFor, webmCodecCandidates, videoOfflineFrameStepUs, videoBitrateFor } = api;

test('webmConfigFor: VP8 default 30fps, stesso bitrate MP4/WebM realtime', () => {
  const c = webmConfigFor(1280, 720);
  assert.equal(c.codec, 'vp8');
  assert.equal(c.width, 1280); assert.equal(c.height, 720);
  assert.equal(c.framerate, 30);
  assert.equal(c.hardwareAcceleration, 'prefer-hardware');
  assert.equal(c.bitrate, videoBitrateFor(1280));
  const c2 = webmConfigFor(720, 1280); // 9:16: bitrate 720p
  assert.equal(c2.bitrate, videoBitrateFor(720));
});

test('webmConfigFor: codec esplicito, input strani -> default 720p', () => {
  const c = webmConfigFor(1920, 1080, 'vp09.00.10.08');
  assert.equal(c.codec, 'vp09.00.10.08');
  const c2 = webmConfigFor(NaN, -3);
  assert.equal(c2.width, 1280); assert.equal(c2.height, 720);
});

test('webmCodecCandidates: VP8 prima di VP9 (hardware encoder più diffuso)', () => {
  const cands = webmCodecCandidates();
  assert.equal(cands.length, 2);
  assert.deepEqual(cands[0], { wc: 'vp8', mux: 'V_VP8' });
  assert.deepEqual(cands[1], { wc: 'vp09.00.10.08', mux: 'V_VP9' });
});

test('videoOfflineFrameStepUs: 30 fps -> 33333 µs (usato da mp4FrameStepUs)', () => {
  assert.equal(videoOfflineFrameStepUs(30), 33333);
  assert.equal(videoOfflineFrameStepUs(0), 33333); // fallback
  assert.equal(videoOfflineFrameStepUs(60), 16667);
});
