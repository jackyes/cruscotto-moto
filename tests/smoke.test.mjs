import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

test('harness: caricamento e binding essenziali', () => {
  resetState();
  assert.equal(typeof api.haversine, 'function');
  assert.equal(typeof api.leanFromUp, 'function');
  assert.equal(typeof api.decodePolyline6, 'function');
  assert.equal(typeof api.navBuild, 'function');
  assert.equal(typeof api.processSample, 'function');
  assert.equal(api.G, 9.80665);
  assert.equal(typeof api.state, 'object');
  assert.equal(api.MOUNT['landscape-left'].lon, '-z');
});
