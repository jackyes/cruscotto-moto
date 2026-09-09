import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { parseGpx, routeCacheKey, state } = api;

// Le funzioni girano in un vm (Array di un altro realm): deepStrictEqual sugli
// array fallisce per prototipo diverso, quindi si confronta la serializzazione.
function ptsOf(text) {
  return JSON.stringify(parseGpx(text));
}

test('parseGpx: trkpt/rtept, attributi in qualsiasi ordine', () => {
  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1">
 <trk><trkseg>
  <trkpt lat="45.0000000" lon="9.0000000"><ele>100</ele></trkpt>
  <trkpt lon="9.0100000" lat="45.0100000"></trkpt>
 </trkseg></trk>
 <rte><rtept lat="45.0200000" lon="9.0200000"/></rte>
</gpx>`;
  assert.equal(ptsOf(gpx), JSON.stringify([
    { lat: 45, lon: 9 }, { lat: 45.01, lon: 9.01 }, { lat: 45.02, lon: 9.02 },
  ]));
});

test('parseGpx: scarta lat/lon fuori range e input vuoto', () => {
  assert.equal(parseGpx('').length, 0);
  assert.equal(parseGpx('<gpx></gpx>').length, 0);
  const bad = '<trkpt lat="999" lon="9"/><trkpt lat="45" lon="9"/>';
  assert.equal(parseGpx(bad).length, 1);
});

test('routeCacheKey: via intermedia cambia la chiave', () => {
  const from = { lat: 45.0, lon: 9.0 }, to = { lat: 45.1, lon: 9.1 };
  const costing = { a: 1 };
  const kNo = routeCacheKey(from, to, costing, null);
  const kVia = routeCacheKey(from, to, costing, null, [{ lat: 45.05, lon: 9.05 }]);
  assert.notEqual(kNo, kVia);
  // stesso via (a 4 decimali) => stessa chiave
  assert.equal(kVia, routeCacheKey(from, to, costing, null, [{ lat: 45.05001, lon: 9.05001 }]));
  // via vuoto/non valido non cambia la chiave
  assert.equal(kNo, routeCacheKey(from, to, costing, null, []));
});

test('navVias: reset su stop incluso in state', () => {
  resetState();
  assert.deepEqual(state.navVias, []);
  assert.equal(state.gpxRoute, null);
});
