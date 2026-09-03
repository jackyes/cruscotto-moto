import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { decodePolyline6, navShapePlausible, navBuild, navSegNearest,
        navLowerBound, navProject, navBandDist, navFmtDist, navFmtShort, navFmtTime,
        osrmType, osrmText, navParseCoords, NAV_BANDS } = api;

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

test('decodePolyline6: round-trip', () => {
  const pts = [[45.0, 9.0], [45.1, 9.1], [45.05, 9.05], [44.9, 8.8]];
  const d = decodePolyline6(encodePolyline6(pts));
  assert.equal(d.lat.length, pts.length);
  for (let i = 0; i < pts.length; i++) {
    assert.ok(Math.abs(d.lat[i] - pts[i][0]) < 1e-5);
    assert.ok(Math.abs(d.lon[i] - pts[i][1]) < 1e-5);
  }
});

test('decodePolyline6: stringa vuota', () => {
  const d = decodePolyline6('');
  assert.deepEqual(d.lat, []);
  assert.deepEqual(d.lon, []);
});

test('navShapePlausible: rileva la precisione sbagliata', () => {
  assert.equal(navShapePlausible([45, 9], [9, 45]), true);
  assert.equal(navShapePlausible([450, 9], [9, 45]), false);
  assert.equal(navShapePlausible([], []), false);
  assert.equal(navShapePlausible([NaN, 45], [9, 9]), false);
  assert.equal(navShapePlausible([45, Infinity], [9, 9]), false);
});

test('navBuild: una leg, distanza cumulata e indici', () => {
  resetState();
  const trip = {
    legs: [{
      shape: encodePolyline6([[45,9],[45.001,9],[45.002,9]]),
      maneuvers: [{ type: 1, instruction:'a', begin_shape_index:0, end_shape_index:1 }],
    }],
  };
  const nv = navBuild(trip);
  assert.equal(nv.n, 3);
  assert.equal(nv.man.length, 1);
  assert.equal(nv.man[0].type, 1);
  assert.equal(nv.man[0].beginIdx, 0);
  assert.equal(nv.man[0].endIdx, 1);
  assert.ok(nv.totalM > 200 && nv.totalM < 250);
  assert.equal(nv.totalS, 0);
});

test('navBuild: due leg, offset e punto duplicato', () => {
  resetState();
  const trip = {
    legs: [
      { shape: encodePolyline6([[45,9],[45.001,9],[45.002,9]]),
        maneuvers: [{ type: 1, begin_shape_index:0, end_shape_index:1 }] },
      { shape: encodePolyline6([[45.002,9],[45.003,9],[45.004,9]]),
        maneuvers: [{ type: 4, begin_shape_index:0, end_shape_index:1 }] },
    ],
  };
  const nv = navBuild(trip);
  assert.equal(nv.n, 5);
  assert.equal(nv.man.length, 2);
  assert.equal(nv.man[0].beginIdx, 0);
  assert.equal(nv.man[1].beginIdx, 2);
  assert.equal(nv.man[1].type, 4);
});

test('navSegNearest: proiezione punto-segmento', () => {
  const nv = { lon: new Float64Array([0,1]), lat: new Float64Array([0,0]), cum: new Float64Array([0,1]) };
  const mid = navSegNearest(nv, 0, 1, 1, 0, 0.5);
  assert.ok(Math.abs(mid.d2) < 1e-9);
  assert.equal(mid.t, 0.5);
  assert.equal(navSegNearest(nv, 0, 1, 1, 0, -1).t, 0);
  assert.equal(navSegNearest(nv, 0, 1, 1, 0, 2).t, 1);
});

test('navLowerBound: prima cumulativa >= v', () => {
  const cum = new Float64Array([0,10,20,30]);
  assert.equal(navLowerBound(cum, 4, 15), 2);
  assert.equal(navLowerBound(cum, 4, 0), 0);
  assert.equal(navLowerBound(cum, 4, 30), 3);
  assert.equal(navLowerBound(cum, 4, 31), 3);
});

test('navProject: aggancio su una rotta dritta', () => {
  resetState();
  const trip = { legs: [{ shape: encodePolyline6([[45,9],[45.001,9],[45.002,9]]), maneuvers: [] }] };
  const nv = navBuild(trip);
  const pr = navProject(nv, 45.0005, 9.0, 0, 10, 5, true);
  assert.ok(pr, 'proiezione non trovata');
  assert.ok(pr.d < 1);
  assert.ok(pr.s > 50 && pr.s < 62);
});

test('navBandDist: distanza per fascia', () => {
  const b = NAV_BANDS[0];
  assert.equal(navBandDist(b, 20), 70);
  assert.equal(navBandDist(b, 10), 35);
  assert.equal(navBandDist(b, 60), 140);
});

test('navFmtDist / navFmtShort', () => {
  assert.equal(navFmtDist(100), '100 metri');
  assert.equal(navFmtDist(500), '500 metri');
  assert.equal(navFmtDist(1200), '1,2 chilometri');
  assert.equal(navFmtDist(5000), '5 chilometri');
  assert.equal(navFmtShort(500), '500 m');
  assert.equal(navFmtShort(1500), '1,5 km');
  assert.equal(navFmtShort(20000), '20 km');
});

test('navFmtTime: arrotondamento e riporto dei minuti (BUG noto)', () => {
  assert.equal(navFmtTime(0), '0 min');
  assert.equal(navFmtTime(60), '1 min');
  assert.equal(navFmtTime(3540), '59 min');
  assert.equal(navFmtTime(3660), '1 h 01');
  assert.equal(navFmtTime(3599), '1 h 00'); // 59'59'' non deve diventare "60 min"
  assert.equal(navFmtTime(7199), '2 h 00'); // 1h 59'59'' non deve diventare "1 h 60"
});

test('osrmType: mappatura manovre OSRM', () => {
  assert.equal(osrmType('depart', ''), 1);
  assert.equal(osrmType('arrive', ''), 4);
  assert.equal(osrmType('turn', 'right'), 10);
  assert.equal(osrmType('turn', 'sharp left'), 14);
  assert.equal(osrmType('roundabout', ''), 26);
  assert.equal(osrmType('exit roundabout', ''), 27);
  assert.equal(osrmType('fork', 'left'), 24);
  assert.equal(osrmType('merge', ''), 25);
  assert.equal(osrmType('unknown', ''), 8);
});

test('osrmText: frasi italiane', () => {
  assert.equal(osrmText({maneuver:{type:'depart'}, name:'Via Roma'}), 'Parti su Via Roma');
  assert.equal(osrmText({maneuver:{type:'arrive'}}), 'Sei arrivato a destinazione');
  assert.equal(osrmText({maneuver:{type:'turn', modifier:'right'}, name:'Via X'}), 'Svolta a destra su Via X');
  assert.equal(osrmText({maneuver:{type:'roundabout', exit:2}}), 'Alla rotonda prendi la seconda uscita');
  assert.equal(osrmText({maneuver:{type:'roundabout', exit:9}}), 'Alla rotonda prendi la 9ª uscita');
});

test('navParseCoords: formati supportati', () => {
  assert.deepEqual(navParseCoords('45.5, 9.2'), {lat:45.5, lon:9.2, label:'Coordinate'});
  assert.deepEqual(navParseCoords('45,5;9,2'), {lat:45.5, lon:9.2, label:'Coordinate'});
  assert.deepEqual(navParseCoords('45 9'), {lat:45, lon:9, label:'Coordinate'});
  assert.deepEqual(navParseCoords('https://maps.google.com/?q=loc:!3d45.5!4d9.2'), {lat:45.5, lon:9.2, label:'Coordinate'});
  assert.deepEqual(navParseCoords('https://www.google.com/maps/@45.5,9.2,15z'), {lat:45.5, lon:9.2, label:'Coordinate'});
  assert.equal(navParseCoords('ciao'), null);
  assert.equal(navParseCoords('95.0, 9.0'), null);
});
