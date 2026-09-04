import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { navFromOsrm, osrmIdxOf, decodePolyline6 } = api;

function encodeDelta(d) {
  let v = d < 0 ? ~(d << 1) : (d << 1);
  let s = '';
  while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
  return s + String.fromCharCode(v + 63);
}
function encodePolyline6(points) {
  let pLat = 0, pLon = 0, out = '';
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    out += encodeDelta(la - pLat) + encodeDelta(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}

const SHAPE = encodePolyline6([[45, 9], [45.001, 9], [45.002, 9], [45.003, 9]]);

function osrmResponse(over = {}) {
  return {
    code: 'Ok',
    routes: [{
      geometry: SHAPE,
      distance: 333,
      duration: 60,
      legs: [{
        steps: [
          { name: 'Via A', duration: 20, maneuver: { type: 'depart', location: [9, 45], bearing_before: null, bearing_after: 0 } },
          { name: 'Via B', duration: 20, maneuver: { type: 'turn', modifier: 'right', location: [9, 45.001], bearing_before: 0, bearing_after: 90 } },
          { name: '', duration: 20, maneuver: { type: 'arrive', location: [9, 45.003], bearing_before: 0, bearing_after: null } },
        ],
      }],
    }],
    ...over,
  };
}

test('osrmIdxOf: trova indice piu vicino da from', () => {
  resetState();
  const d = decodePolyline6(SHAPE);
  const i = osrmIdxOf(45.002, 9, d.lat, d.lon, 0);
  assert.equal(i, 2);
});

test('osrmIdxOf: rispetta from come base', () => {
  resetState();
  const d = decodePolyline6(SHAPE);
  const i = osrmIdxOf(45, 9, d.lat, d.lon, 3);
  assert.equal(i, 3);
});

test('osrmIdxOf: match esatto ritorna subito', () => {
  resetState();
  const d = decodePolyline6(SHAPE);
  const i = osrmIdxOf(d.lat[1], d.lon[1], d.lat, d.lon, 0);
  assert.equal(i, 1);
});

test('navFromOsrm: converte 3 step, chaining end_shape_index', () => {
  resetState();
  const trip = navFromOsrm(osrmResponse());
  assert.equal(trip.legs.length, 1);
  assert.equal(trip.legs[0].maneuvers.length, 3);
  const man = trip.legs[0].maneuvers;
  assert.equal(man[0].end_shape_index, man[1].begin_shape_index);
  assert.equal(man[1].end_shape_index, man[2].begin_shape_index);
  assert.equal(man[2].end_shape_index, 3);
  assert.equal(JSON.stringify(man[1].street_names), JSON.stringify(['Via B']));
  assert.equal(man[0].bearing_before, null);
  assert.equal(man[2].bearing_after, null);
  assert.equal(trip.summary.length, 0.333);
});

test('navFromOsrm: rotta vuota lancia', () => {
  resetState();
  assert.throws(() => navFromOsrm({}), /OSRM: rotta vuota/);
  assert.throws(() => navFromOsrm({ routes: [] }), /OSRM: rotta vuota/);
  assert.throws(() => navFromOsrm({ routes: [{}] }), /OSRM: rotta vuota/);
});

test('navFromOsrm: shape implausibile lancia', () => {
  resetState();
  // coordinate fuori scala lat>90: navShapePlausible rifiuta
  const badShape = encodePolyline6([[450, 9], [451, 9]]);
  const bad = { code: 'Ok', routes: [{ geometry: badShape, distance: 1, duration: 1, legs: [{ steps: [{ maneuver: {} }] }] }] };
  assert.throws(() => navFromOsrm(bad), /OSRM: shape implausibile/);
});

test('navFromOsrm: nessuno step lancia', () => {
  resetState();
  const j = osrmResponse();
  j.routes[0].legs = [{ steps: [] }];
  assert.throws(() => navFromOsrm(j), /OSRM: nessuna manovra/);
});

test('navFromOsrm: step senza maneuver.location usa cur', () => {
  resetState();
  const j = osrmResponse();
  delete j.routes[0].legs[0].steps[1].maneuver.location;
  const trip = navFromOsrm(j);
  const man = trip.legs[0].maneuvers;
  assert.equal(man[1].begin_shape_index, man[0].begin_shape_index);
});

test('navFromOsrm: bearing mancanti restano null', () => {
  resetState();
  const j = osrmResponse();
  delete j.routes[0].legs[0].steps[0].maneuver.bearing_before;
  delete j.routes[0].legs[0].steps[0].maneuver.bearing_after;
  const trip = navFromOsrm(j);
  assert.equal(trip.legs[0].maneuvers[0].bearing_before, null);
  assert.equal(trip.legs[0].maneuvers[0].bearing_after, null);
});

test('navFromOsrm: exit rotonda mappato', () => {
  resetState();
  const j = osrmResponse();
  j.routes[0].legs[0].steps[1].maneuver = { type: 'rotary', modifier: 'straight', exit: 2, location: [9, 45.001], bearing_before: 0, bearing_after: 90 };
  const trip = navFromOsrm(j);
  assert.equal(trip.legs[0].maneuvers[1].roundabout_exit_count, 2);
});
