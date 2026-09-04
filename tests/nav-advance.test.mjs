import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { navBuild, navPassed, navAdvance, NAV_PASS_OVERSHOOT_M, NAV_PASS_EARLY_M, NAV_PASS_HEAD_DEG } = api;

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

// Rotta nord: (45,9) -> (45.001,9) -> (45.002,9), manovra a indice 1 (~111m)
function buildNorth() {
  resetState();
  const nv = navBuild({
    legs: [{
      shape: encodePolyline6([[45, 9], [45.001, 9], [45.002, 9]]),
      maneuvers: [
        { type: 1, instruction: 'parti', begin_shape_index: 0, end_shape_index: 1, bearing_after: 0 },
        { type: 2, instruction: 'arriva', begin_shape_index: 1, end_shape_index: 2, bearing_after: 0 },
      ],
    }],
  });
  nv.nextMan = 0; nv.offDist = 0; nv.offThr = 50; nv.sAlong = 0;
  nv.spoken = 0; nv.suppressPost = false;
  return nv;
}

test('costanti soglie attese', () => {
  assert.equal(NAV_PASS_OVERSHOOT_M, 10);
  assert.equal(NAV_PASS_EARLY_M, 10);
  assert.equal(NAV_PASS_HEAD_DEG, 45);
});

test('navPassed: oltre ultima manovra = false', () => {
  const nv = buildNorth();
  assert.equal(navPassed(nv, 99, 0), false);
});

test('navPassed: offDist sopra soglia congela', () => {
  const nv = buildNorth();
  nv.sAlong = nv.sMan[0] + NAV_PASS_OVERSHOOT_M + 50;
  nv.offDist = nv.offThr + 1;
  assert.equal(navPassed(nv, 0, 0), false);
});

test('navPassed: overshoot fa scattare', () => {
  const nv = buildNorth();
  nv.offDist = 0;
  nv.sAlong = nv.sMan[0] + NAV_PASS_OVERSHOOT_M;
  assert.equal(navPassed(nv, 0, null), true);
});

test('navPassed: appena sotto overshoot senza heading = false', () => {
  const nv = buildNorth();
  nv.offDist = 0;
  nv.sAlong = nv.sMan[0] + NAV_PASS_OVERSHOOT_M - 0.5;
  // dentro finestra early ma hdg null -> false (sAlong < sMan-EARLY solo se sMan>10.5)
  assert.equal(navPassed(nv, 0, null), false);
});

test('navPassed: early + heading allineato fa scattare', () => {
  const nv = buildNorth();
  nv.offDist = 0;
  nv.sAlong = nv.sMan[0] - NAV_PASS_EARLY_M + 1;
  nv.man[0].brgAfter = 0;
  assert.equal(navPassed(nv, 0, 5), true);
});

test('navPassed: early + heading disallineato non scatta', () => {
  const nv = buildNorth();
  nv.offDist = 0;
  nv.sAlong = nv.sMan[0] - NAV_PASS_EARLY_M + 1;
  nv.man[0].brgAfter = 0;
  assert.equal(navPassed(nv, 0, 180), false);
});

test('navPassed: early senza brgAfter non scatta', () => {
  const nv = buildNorth();
  nv.offDist = 0;
  nv.sAlong = nv.sMan[0] - NAV_PASS_EARLY_M + 1;
  nv.man[0].brgAfter = null;
  assert.equal(navPassed(nv, 0, 0), false);
});

test('navAdvance: avanza una manovra, resetta spoken', () => {
  const nv = buildNorth();
  nv.offDist = 0;
  nv.sAlong = nv.sMan[0] + NAV_PASS_OVERSHOOT_M;
  nv.spoken = 2;
  const moved = navAdvance(nv, null);
  assert.equal(moved, 1);
  assert.equal(nv.nextMan, 1);
  assert.equal(nv.spoken, 0);
  assert.equal(nv.suppressPost, false);
});

test('navAdvance: nessuna manovra passata = 0', () => {
  const nv = buildNorth();
  nv.offDist = 0; nv.sAlong = 0;
  assert.equal(navAdvance(nv, 180), 0);
  assert.equal(nv.nextMan, 0);
});

test('navAdvance: salto multiplo imposta suppressPost', () => {
  const nv = buildNorth();
  nv.offDist = 0;
  // oltre entrambe le manovre: consuma 0 e 1 in un colpo
  nv.sAlong = nv.sMan[1] + NAV_PASS_OVERSHOOT_M;
  const moved = navAdvance(nv, null);
  assert.equal(moved, 2);
  assert.equal(nv.nextMan, 2);
  assert.equal(nv.suppressPost, true);
});

test('navAdvance: congelato con offDist alto', () => {
  const nv = buildNorth();
  nv.sAlong = nv.sMan[1] + NAV_PASS_OVERSHOOT_M;
  nv.offDist = nv.offThr + 10;
  assert.equal(navAdvance(nv, null), 0);
  assert.equal(nv.nextMan, 0);
});
