import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { state, haversine, bearing, angleDiff, cellKey, camsNear, rebuildCamGrid,
        parseCamerasFile, camLabel } = api;

test('haversine: distanze note e simmetria', () => {
  const a = {lat:0, lon:0};
  const north = {lat:1, lon:0};
  const east = {lat:0, lon:1};
  assert.ok(Math.abs(haversine(a, north) - 111.19) < 0.2);
  assert.ok(Math.abs(haversine(a, east) - 111.32) < 0.2);
  assert.equal(haversine(a, a), 0);
  assert.ok(Math.abs(haversine(a, north) - haversine(north, a)) < 1e-9);
});

test('bearing: punti cardinali', () => {
  const a = {lat:0, lon:0};
  assert.ok(Math.abs(bearing(a, {lat:1, lon:0}) - 0) < 1e-9);
  assert.ok(Math.abs(bearing(a, {lat:0, lon:1}) - 90) < 1e-9);
  assert.ok(Math.abs(bearing(a, {lat:-1, lon:0}) - 180) < 1e-9);
  assert.ok(Math.abs(bearing(a, {lat:0, lon:-1}) - 270) < 1e-9);
  assert.ok(bearing(a, {lat:1, lon:1}) > 0 && bearing(a, {lat:1, lon:1}) < 90);
});

test('angleDiff: minimo arco e wrap a 360 gradi', () => {
  assert.equal(angleDiff(0, 90), 90);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(0, 180), 180);
  assert.equal(angleDiff(0, 181), 179);
  assert.equal(angleDiff(30, 30), 0);
});

test('cellKey: forma e coerenza spaziale', () => {
  assert.match(cellKey(45.0, 9.0), /^-?\d+:-?\d+$/);
  const k1 = cellKey(45.001, 9.001);
  const k2 = cellKey(45.0011, 9.0011);
  assert.equal(k1, k2);
  const k3 = cellKey(46.0, 9.0);
  assert.notEqual(k1, k3);
});

test('camsNear: trova cio che e dentro, non cio che e lontano', () => {
  resetState();
  state.cameras = [{lat:45.0, lon:9.0, maxspeed:'50'}];
  state.importedCameras = [];
  rebuildCamGrid();
  assert.equal(camsNear(45.0, 9.0, 500).length, 1);
  assert.equal(camsNear(45.0, 9.0, 500)[0].maxspeed, '50');
  assert.equal(camsNear(44.0, 9.0, 500).length, 0);
});

test('parseCamerasFile: CSV (virgole e punto e virgola)', () => {
  const out = parseCamerasFile('45.0,9.0\n46.1,10.2,90,Autovelox Test\n');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {lat:45, lon:9, maxspeed:'', name:''});
  assert.deepEqual(out[1], {lat:46.1, lon:10.2, maxspeed:'90', name:'Autovelox Test'});
  const semi = parseCamerasFile('45.5;9.2;70;Roma');
  assert.deepEqual(semi[0], {lat:45.5, lon:9.2, maxspeed:'70', name:'Roma'});
});

test('parseCamerasFile: JSON SCDB e GeoJSON', () => {
  const scdb = parseCamerasFile('[{"lat":45,"lng":9,"vmax":"90","ort":"Milano","strasse":"Via Roma"}]');
  assert.deepEqual(scdb, [{lat:45, lon:9, maxspeed:'90', name:'Milano Via Roma'}]);
  const geo = parseCamerasFile('{"type":"FeatureCollection","features":[{"geometry":{"coordinates":[9.0,45.0]},"properties":{"vmax":"50","name":"Cam A"}}]}');
  assert.deepEqual(geo, [{lat:45, lon:9, maxspeed:'50', name:'Cam A'}]);
});

test('parseCamerasFile: input vuoto o non valido', () => {
  assert.deepEqual(parseCamerasFile(''), []);
  assert.deepEqual(parseCamerasFile(null), []);
  assert.deepEqual(parseCamerasFile('ciao\nriga senza coordinate\n'), []);
});

test('camLabel: unisce nome e limite', () => {
  assert.equal(camLabel({name:'X', maxspeed:'90'}), 'X · 90');
  assert.equal(camLabel({name:'X'}), 'X');
  assert.equal(camLabel({maxspeed:'50'}), '50');
  assert.equal(camLabel({}), '');
});
