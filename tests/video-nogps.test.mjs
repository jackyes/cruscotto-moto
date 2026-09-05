// Video no-GPS: giro solo IMU forza 2D, mai mappa 3D sul nulla.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoHasGps } = api;

const P = (lat, lon) => ({ lat, lon });

test('videoHasGps: true con 2+ punti, false altrimenti', () => {
  assert.equal(videoHasGps({ mapPts: [P(44, 10), P(44.01, 10.01)] }), true);
  assert.equal(videoHasGps({ mapPts: [P(44, 10)] }), false);
  assert.equal(videoHasGps({ mapPts: [] }), false);
  assert.equal(videoHasGps({}), false);
  assert.equal(videoHasGps(null), false);
});

test('videoHasGps: punti senza lat/lon non contano (prefiltro mapPts)', () => {
  // mapPts arriva già prefiltrato da startVideoRender; qui solo contratto.
  assert.equal(videoHasGps({ mapPts: null }), false);
  assert.equal(videoHasGps({ mapPts: [P(44, 10), P(44.02, 10.02), P(44.03, 10.03)] }), true);
});
