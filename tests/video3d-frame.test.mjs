import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoWheelSpin, videoTrackIndexForRow } = api;

test('videoWheelSpin: dt-based, fps-indipendente', () => {
  const a = videoWheelSpin(72, 1 / 60) * 60; // 1s a 60fps
  const b = videoWheelSpin(72, 1 / 15) * 15; // 1s a 15fps
  assert.ok(Math.abs(a - b) / a < 0.05);
  assert.ok(a > 0);
});

test('videoWheelSpin: fermo/invalidi -> 0', () => {
  assert.equal(videoWheelSpin(0, 0.016), 0);
  assert.equal(videoWheelSpin(50, 0), 0);
  assert.equal(videoWheelSpin(50, -1), 0);
  assert.equal(videoWheelSpin(NaN, 0.016), 0);
  assert.equal(videoWheelSpin(50, NaN), 0);
});

test('videoWheelSpin: fisica v/r', () => {
  // 36 km/h = 10 m/s, r=0.42 -> ~23.8 rad/s
  const w = videoWheelSpin(36, 1);
  assert.ok(Math.abs(w - 10 / 0.42) < 0.01);
});

test('videoTrackIndexForRow: proporzionale con clamp', () => {
  assert.equal(videoTrackIndexForRow(0, 100, 50), 0);
  assert.equal(videoTrackIndexForRow(99, 100, 50), 49);
  assert.equal(videoTrackIndexForRow(50, 100, 50), 25);
  assert.equal(videoTrackIndexForRow(-5, 100, 50), 0);
  assert.equal(videoTrackIndexForRow(500, 100, 50), 49);
});

test('videoTrackIndexForRow: casi degeneri', () => {
  assert.equal(videoTrackIndexForRow(0, 0, 50), 0);
  assert.equal(videoTrackIndexForRow(0, 1, 50), 0);
  assert.equal(videoTrackIndexForRow(5, 100, 0), 0);
  assert.equal(videoTrackIndexForRow(5, 100, -3), 0);
});
