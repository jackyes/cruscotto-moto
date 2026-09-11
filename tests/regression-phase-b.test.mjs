// Test regressione Fase B: fix MED (geo/reti nav, parse GeoJSON, Overpass body,
// GPX alt, Doppler cap, track gating, clamp velocità su ancora proiettata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';

const { state, els, idb, angleDiff, routeCacheKey, jsonUnderTimeout, parseCamerasFile,
  buildGpx, onGeolocation, propagateSpeed, correctSpeed, SPEED_MAX_DEV_MS, tickDemo } = api;
const s = vmSandbox;

// ---- B-nav ----
test('angleDiff: NaN in ingresso → 0 (niente detector morti né falsi allarmi)', () => {
  assert.equal(angleDiff(NaN, 90), 0);
  assert.equal(angleDiff(45, undefined), 0);
  assert.equal(angleDiff(45, 90), 45);
  assert.equal(angleDiff(350, 10), 20);
});

test('routeCacheKey: heading (arrotondato a 10°) entra nella chiave', () => {
  const from = { lat: 45.0, lon: 9.0 }, to = { lat: 45.1, lon: 9.1 };
  const costing = { a: 1 };
  const kNo = routeCacheKey(from, to, costing, null);
  const k0 = routeCacheKey(from, to, costing, 0);
  const k4 = routeCacheKey(from, to, costing, 4);      // stesso bucket di 0
  const k180 = routeCacheKey(from, to, costing, 180);  // U-turn: chiave diversa
  assert.notEqual(kNo, k0, 'con/senza heading devono differire');
  assert.equal(k0, k4);
  assert.notEqual(k0, k180);
});

test('jsonUnderTimeout: AbortError → TimeoutError (il body muore sotto timer)', async () => {
  await assert.rejects(
    () => jsonUnderTimeout({ json: async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; } }),
    e => e.name === 'TimeoutError'
  );
  await assert.rejects(
    () => jsonUnderTimeout({ json: async () => { throw new Error('bad json'); } }),
    /bad json/
  );
});

// ---- B-parse: GeoJSON non-Point ----
test('parseCamerasFile: GeoJSON LineString/MultiPoint non vengono scartati', () => {
  const gj = JSON.stringify({
    features: [
      { geometry: { type: 'Point', coordinates: [9.1, 45.1] }, properties: { vmax: '50', name: 'Punto' } },
      { geometry: { type: 'LineString', coordinates: [[9.2, 45.2], [9.25, 45.25]] }, properties: { name: 'Tratto' } },
      { geometry: { type: 'MultiPolygon', coordinates: [[[[9.3, 45.3]]]] }, properties: {} },
    ],
  });
  const out = parseCamerasFile(gj);
  assert.equal(out.length, 3);
  assert.equal(out[0].lat, 45.1);
  assert.equal(out[1].lat, 45.2, 'PRIMO punto della LineString (profonda 2 livelli)');
  assert.equal(out[2].lon, 9.3);
});

// ---- B-cams: Overpass 200 con error body ----
test('fetchCameras: remark/error body HTTP 200 NON sovrascrive la cache buona', async () => {
  resetState();
  state.cameras = [{ id: 1, lat: 45.0, lon: 9.0, maxspeed: '50', name: 'vecchia' }];
  state.camTs = Date.now() - 1000;
  state.camCenter = { lat: 45.0, lon: 9.0 };
  const origFwt = s.fetchWithTimeout;
  s.fetchWithTimeout = async () => ({ ok: true, json: async () => ({ remark: 'runtime error: overworked' }) });
  const origKv = idb.kvPut;
  let kvWritten = 0;
  idb.kvPut = async () => { kvWritten++; };
  try {
    await s.fetchCameras(45.5, 9.5);
    assert.equal(state.cameras.length, 1, 'cache buona sostituita col vuoto');
    assert.equal(state.cameras[0].name, 'vecchia');
    assert.equal(kvWritten, 0, 'cache su disco sovrascritta');
    assert.ok(state.camRetryAfter > Date.now(), 'backoff non attivato');
  } finally {
    s.fetchWithTimeout = origFwt;
    idb.kvPut = origKv;
  }
});

// ---- B-log/GPX: alt assente → niente <ele>0.0 ----
test('buildGpx: fix senza quota non fabbrica <ele>0.0</ele>', () => {
  const track = [
    { lat: 45.0, lon: 9.0, alt: 120, ts: 1700000000000 },
    { lat: 45.001, lon: 9.0, alt: null, ts: 1700000001000 },
    { lat: 45.002, lon: 9.0, alt: NaN, ts: 1700000002000 },
  ];
  const gpx = buildGpx(track);
  assert.ok(gpx.includes('<ele>120.0</ele>'));
  assert.ok(!gpx.includes('<ele>0.0'), 'ele fittizia a 0: ' + gpx);
});

// ---- B-inputs: Doppler cap + track solo a log attivo ----
function geoPos(lat, lon, speed, acc) {
  return { coords: { latitude: lat, longitude: lon, accuracy: acc, speed, heading: null, altitude: null },
    timestamp: Date.now() };
}
test('onGeolocation: spike Doppler >90 m/s rifiutato; traccia solo con logging attivo', () => {
  resetState();
  s.updateMap = () => {};
  s.maybeLoadCameras = () => {};
  s.checkCameras = () => {};
  s.updateGpsStatus = () => {};
  s.navRenderBanner = () => {};

  // Spike Doppler: non deve entrare in speedGpsMs
  onGeolocation(geoPos(45.0, 9.0, 300, 5));
  assert.notEqual(state.speedGpsMs, 300, 'spike 1080 km/h accettato');

  // Fuori log: niente traccia né distanza
  state.pos = { lat: 45.0, lon: 9.0 };
  state.logging = false;
  state.session.distKm = 0;
  state.track = [];
  const kmBefore = state.session.distKm;
  onGeolocation(geoPos(45.01, 9.0, null, 5));   // ~1.1 km di spostamento
  assert.equal(state.track.length, 0, 'traccia scritta a log fermo');
  assert.equal(state.session.distKm, kmBefore, 'distKm cresce a log fermo');

  // A log attivo: traccia + distanza (2 fix: il primo aggancia lastPos,
  // il secondo accumula km; appendTrackPoint è gated a 1 Hz, basta un punto)
  state.logging = true;
  onGeolocation(geoPos(45.02, 9.0, null, 5));
  onGeolocation(geoPos(45.03, 9.0, null, 5));
  assert.ok(state.track.length > 0, 'traccia non scritta a log attivo');
  assert.ok(state.session.distKm > 0);
});

// ---- B-speed: clamp su ancora proiettata ----
test('propagateSpeed: clamp confronta con la proiezione al presente, non col Doppler laggato', () => {
  resetState();
  // Fix a 20 m/s ma proiezione al presente 17 m/s (frenata in corso):
  correctSpeed(20, 1600, true);              // _spAnchor = 20 + (_aInt - aIntAt(1600)) = 20
  state._spAnchor = 17;                      // simulato: frenata maturata dal fix
  state.speedGpsMs = 20;                     // Doppler laggato com'è
  state._spBase = 14.6;                      // _spBase + _aInt = 14.6 → frenata vera
  state._aInt = 0;
  state.lonG = 0;
  state.speedGpsT = Date.now();
  propagateSpeed(0.1, Date.now());
  // Vecchio clamp: lo = 20 - 2.5 = 17.5 → v sarebbe stato risolto a 17.5 (frenata cancellata).
  // Nuovo: lo = 17 - 2.5 = 14.5 → 14.6 passa intatto.
  assert.ok(Math.abs(state.speedFusMs - 14.6) < 0.01,
    'clamp su Doppler laggato: ' + state.speedFusMs);
});

test('correctSpeed: scrive _spAnchor (proiezione al presente)', () => {
  resetState();
  state._aInt = 5;
  state._spHist = [{ t: 0, a: 0 }, { t: 1000, a: 2 }];
  correctSpeed(20, 1600);
  assert.ok(state._spAnchor != null);
  assert.ok(Math.abs(state._spAnchor - 23) < 1e-9);   // stesso valore di speedFusMs
});

// ---- B-demo: distanza demo solo a log attivo ----
/* Ultimo test del file di proposito: tickDemo chiama appendTrackPoint, il cui
   throttle da 1 Hz (lastTrackT, `let` interno a js/cam-map.js) è stato condiviso
   e non azzerabile da resetState — eseguito prima, lasciava a secco il test
   onGeolocation qui sopra ("traccia non scritta a log attivo"). */
test('tickDemo: la distanza demo non cresce a registrazione ferma', () => {
  resetState();
  state.demo = true;
  state.speedMs = 20;                 // ~72 km/h simulati
  state.session.distKm = 0;
  let t = 1000;
  tickDemo(t);                        // primo giro: demoStart/demoLast si agganciano, dt = 0
  for (let i = 0; i < 5; i++) { t += 100; tickDemo(t); }
  assert.equal(state.session.distKm, 0, 'distKm cresciuta a log fermo');

  // A log attivo la distanza si accumula davvero (5 × 0,1 s × 20 m/s = 10 m).
  state.logging = true;
  for (let i = 0; i < 5; i++) { t += 100; tickDemo(t); }
  assert.ok(state.session.distKm > 0.005 && state.session.distKm < 0.02,
    'distKm a log attivo: ' + state.session.distKm);

  // Stop: il contatore si ferma dove era, come i massimi in updateDisplay.
  state.logging = false;
  const kmAfterStop = state.session.distKm;
  for (let i = 0; i < 5; i++) { t += 100; tickDemo(t); }
  assert.equal(state.session.distKm, kmAfterStop, 'distKm cresciuta dopo lo Stop');
  state.demo = false;
  resetState();
});
