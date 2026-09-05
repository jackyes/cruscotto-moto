// Traccia = dato: rampa unica |lean| teal→rosso in 2D e 3D + segmenti k/lean.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoLeanColor, videoLeanColorExpr, videoTrackSegGeoJson, videoSegLeansFor,
  videoMapBounds, videoLeanBin, videoMapProj, videoLeanAtPoint,
  videoMapBgKey, VIDEO3D_CONF } = api;

test('videoLeanColor: 0 teal, 52 rosso, interpola in mezzo', () => {
  assert.equal(videoLeanColor(0), 'rgb(46,111,106)');
  assert.equal(videoLeanColor(52), 'rgb(212,64,47)');
  assert.equal(videoLeanColor(-52), videoLeanColor(52));
  assert.equal(videoLeanColor(NaN), videoLeanColor(0));
  assert.equal(videoLeanColor(999), videoLeanColor(52)); // clamp
  const mid = videoLeanColor(32);
  assert.ok(mid.includes('224,179,65'), 'stop ambra 32°: ' + mid);
});

test('videoLeanColorExpr: interpolate linear su get lean, stessi stop', () => {
  const e = videoLeanColorExpr();
  assert.equal(e[0], 'interpolate');
  assert.deepEqual(e[1], ['linear']);
  assert.deepEqual(e[2], ['get', 'lean']);
  assert.equal(e[3], 0);
  assert.ok(String(e[4]).includes('46,111,106'));
  const n = VIDEO3D_CONF.leanRamp.length;
  assert.equal((e.length - 3) / 2, n);
});

test('videoTrackSegGeoJson: segmenti con k/lean picco', () => {
  const pts = [{ lat: 44, lon: 10 }, { lat: 44.001, lon: 10.001 }, { lat: 44.002, lon: 10.002 }];
  const g = videoTrackSegGeoJson(pts, 0, 3, [10, 30, 5]);
  assert.equal(g.type, 'FeatureCollection');
  assert.equal(g.features.length, 2);
  assert.equal(g.features[0].properties.k, 0);
  assert.equal(g.features[0].properties.lean, 30); // max(10,30)
  assert.equal(g.features[1].properties.lean, 30); // max(30,5)
  assert.deepEqual(videoTrackSegGeoJson([], 0, 0, []).features, []);
});

test('videoSegLeansFor: mapping proporzionale rows→mapPts', () => {
  const rows = [{ lean: 5 }, { lean: -40 }, { lean: 10 }];
  const pts = [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, { lat: 3, lon: 3 },
    { lat: 4, lon: 4 }, { lat: 5, lon: 5 }];
  const l = videoSegLeansFor(pts, rows);
  assert.equal(l.length, 5);
  assert.equal(l[0], 5); // primo → rows[0]
  assert.equal(l[4], 10); // ultimo → rows[2]
  assert.ok(l.every(v => v >= 0), 'valori assoluti');
  assert.deepEqual(videoSegLeansFor([], []), []);
});

test('videoMapBounds: una tantum, null se vuota', () => {
  const bb = videoMapBounds([{ lat: 44, lon: 10 }, { lat: 45, lon: 12 }]);
  assert.deepEqual(bb, { minLat: 44, maxLat: 45, minLon: 10, maxLon: 12 });
  assert.equal(videoMapBounds([]), null);
  assert.equal(videoMapBounds([{ lat: null, lon: 1 }]), null);
});

test('videoLeanBin: 26 bin, 0→0, 52→25, clamp', () => {
  assert.equal(videoLeanBin(0), 0);
  assert.equal(videoLeanBin(52), 25);
  assert.equal(videoLeanBin(-52), 25);
  assert.equal(videoLeanBin(999), 25);
  assert.ok(videoLeanBin(26) >= 12 && videoLeanBin(26) <= 13);
});

test('videoMapProj: una tantum, scala fit, formula X/Y', () => {
  const bb = { minLat: 44, maxLat: 45, minLon: 10, maxLon: 12 };
  const p = videoMapProj(bb, 0, 100, 400, 300, 40);
  assert.ok(p.scale > 0);
  // spanLon=2 → (400-80)/2=160; spanLat=1 → (300-80)/1=220: vince 160.
  assert.equal(p.scale, 160);
  const X = lon => p.x + p.ox + (lon - p.minLon) * p.scale;
  const Y = lat => p.y + p.oy + (p.maxLat - lat) * p.scale;
  assert.equal(X(10), p.x + p.ox);
  assert.equal(Y(45), p.y + p.oy);
  assert.ok(X(12) <= p.x + 400);
});

test('videoLeanAtPoint: mapping proporzionale, NaN→0', () => {
  const job = { rows: [{ lean: 5 }, { lean: -40 }, { lean: NaN }] };
  assert.equal(videoLeanAtPoint(job, 0, 5), 5);
  assert.equal(videoLeanAtPoint(job, 4, 5), 0); // NaN→0
  assert.equal(videoLeanAtPoint({ rows: [] }, 2, 5), 0);
  assert.equal(videoLeanAtPoint(job, 2, 5), -40);
});

test('videoMapBgKey: cambia con geometria o tema', () => {
  const bb = { minLat: 44, maxLat: 45, minLon: 10, maxLon: 12 };
  const a = videoMapBgKey(bb, 0, 0, 400, 300, '#g', '#b');
  assert.equal(videoMapBgKey(bb, 0, 0, 400, 300, '#g', '#b'), a);
  assert.notEqual(videoMapBgKey(bb, 0, 0, 401, 300, '#g', '#b'), a);
  assert.notEqual(videoMapBgKey(bb, 0, 0, 400, 300, '#g2', '#b'), a);
});
