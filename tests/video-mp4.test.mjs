// MP4 offline: config encode, profili audio, passo frame.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { mp4ConfigFor, engineToneFor, windGainFor, mp4FrameStepUs, videoBitrateFor } = api;

test('mp4ConfigFor: H.264 30fps, stesso bitrate WebM', () => {
  const c = mp4ConfigFor(1280, 720);
  assert.equal(c.codec, 'avc1.640028');
  assert.equal(c.width, 1280); assert.equal(c.height, 720);
  assert.equal(c.framerate, 30);
  assert.equal(c.bitrate, videoBitrateFor(1280));
  const c2 = mp4ConfigFor(720, 1280); // 9:16: bitrate 720p
  assert.equal(c2.bitrate, videoBitrateFor(720));
});

test('mp4ConfigFor: input strani → default 720p', () => {
  const c = mp4ConfigFor(NaN, -3);
  assert.equal(c.width, 1280); assert.equal(c.height, 720);
});

test('engineToneFor: 60 Hz fermo, ~324 a 120', () => {
  assert.equal(engineToneFor(0), 60);
  assert.equal(engineToneFor(120), 60 + 120 * 2.2);
  assert.equal(engineToneFor(NaN), 60);
  assert.equal(engineToneFor(-10), 60);
});

test('windGainFor: 0 fermo, 0.15 a 130+, clamp oltre', () => {
  assert.equal(windGainFor(0), 0);
  assert.equal(windGainFor(130), 0.15);
  assert.equal(windGainFor(200), 0.15);
  assert.ok(windGainFor(65) > 0.07 && windGainFor(65) < 0.08);
});

test('mp4FrameStepUs: 30 fps → 33333 µs', () => {
  assert.equal(mp4FrameStepUs(30), 33333);
  assert.equal(mp4FrameStepUs(0), 33333); // fallback
  assert.equal(mp4FrameStepUs(60), 16667);
});
