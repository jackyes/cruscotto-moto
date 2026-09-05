// Traccia 3D: GeoJSON [lon,lat], slice semiaperto, finestra scia clampata.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoTrackGeoJson, videoTrailRange } = api;
const P = (lat, lon) => ({ lat, lon });

test('videoTrackGeoJson: coordinate [lon,lat], mai inversione', () => {
  const gj = videoTrackGeoJson([P(44, 10), P(44.001, 10.002)], 0, 2);
  assert.equal(gj.type, 'Feature');
  assert.equal(gj.geometry.type, 'LineString');
  assert.deepEqual(gj.geometry.coordinates[0], [10, 44]);
  assert.equal(gj.geometry.coordinates.length, 2);
});

test('videoTrackGeoJson: slice semiaperto + clamp', () => {
  const pts = [P(44, 10), P(44.001, 10.001), P(44.002, 10.002), P(44.003, 10.003), P(44.004, 10.004)];
  const s = videoTrackGeoJson(pts, 1, 3);
  assert.equal(s.geometry.coordinates.length, 2);
  assert.deepEqual(s.geometry.coordinates[0], [pts[1].lon, pts[1].lat]);
  assert.equal(videoTrackGeoJson(pts, 3, 1).geometry.coordinates.length, 0);
  assert.equal(videoTrackGeoJson(pts, -5, 999).geometry.coordinates.length, 5);
  assert.equal(videoTrackGeoJson([], 0, 9).geometry.coordinates.length, 0);
  assert.equal(videoTrackGeoJson(null, 0, 9).geometry.coordinates.length, 0);
  assert.doesNotThrow(() => videoTrackGeoJson([]));
});

test('videoTrailRange: finestra scorrevole e clamp, mai NaN', () => {
  assert.deepEqual(videoTrailRange(0, 100, 40), [0, 1]);
  assert.deepEqual(videoTrailRange(50, 100, 40), [11, 51]);
  assert.deepEqual(videoTrailRange(99, 100, 40), [60, 100]);
  assert.deepEqual(videoTrailRange(500, 100, 40), [60, 100]);
  assert.deepEqual(videoTrailRange(-3, 100, 40), [0, 1]);
  for (const [from, to] of [videoTrailRange(0, 0, 40), videoTrailRange(5, 10, 0), videoTrailRange(NaN, 10, 40)]) {
    assert.ok(Number.isInteger(from) && Number.isInteger(to), `${from},${to}`);
    assert.ok(from <= to);
  }
});
