// Poster PNG: statistiche pure (meta batte rows, gap non gonfia, glitch isolati).
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { fmtDurH, climbMeters, countCurves, leanHistogram, posterStats,
  projectTrackXY, posterMoments, posterLayout, posterLayoutFor, posterSizeFor,
  posterTitle, POSTER_FORMATS, buildPosterModel } = api;

const R = o => Object.assign({ t: 0, speedKmh: 0, lean: 0, latG: 0, lonG: 0, alt: 100 }, o);

test('fmtDurH: h:mm:ss oltre l ora, — su invalidi', () => {
  assert.equal(fmtDurH(61), '1:01');
  assert.equal(fmtDurH(3599), '59:59');
  assert.equal(fmtDurH(3661), '1:01:01');
  assert.equal(fmtDurH(NaN), '—');
  assert.equal(fmtDurH(null), '—');
});

test('climbMeters: ancora 3 m, rumore ignorato, discese azzerano', () => {
  const up = [];
  for (let a = 0; a <= 100; a++) up.push(R({ alt: a }));
  // Residuo sotto soglia perso per disegno (99..100 < 3 m): accetta 97..100.
  const dPlus = Math.round(climbMeters(up, 3).dPlus);
  assert.ok(dPlus >= 97 && dPlus <= 100, 'dPlus=' + dPlus);
  const noisy = [];
  // Swing 2 m < soglia 3: rumore GPS, non salita.
  for (let k = 0; k < 200; k++) noisy.push(R({ alt: 100 + (k % 2 ? 1 : -1) }));
  assert.equal(climbMeters(noisy, 3).dPlus, 0);
  const zeros = [];
  for (let k = 0; k < 50; k++) zeros.push(R({ alt: 0 }));
  assert.equal(climbMeters(zeros, 3).valid, false);
  assert.equal(climbMeters([], 3).valid, false);
});

test('countCurves: isteresi + durata, rumore no', () => {
  const rows = [];
  let t = 0;
  const seg = (lean, n) => { for (let k = 0; k < n; k++) { rows.push(R({ lean, t })); t += 0.05; } };
  seg(0, 20); seg(25, 40); seg(0, 20); seg(-25, 40); seg(0, 20); seg(25, 40); seg(0, 20);
  assert.equal(countCurves(rows, 15, 7).n, 3);
  const noise = [];
  for (let k = 0; k < 600; k++) noise.push(R({ lean: (k % 2 ? 5 : -5), t: k * 0.05 }));
  assert.equal(countCurves(noise, 15, 7).n, 0);
  const short = [R({ lean: 0, t: 0 }), R({ lean: 20, t: 0.1 }), R({ lean: 0, t: 0.2 })];
  assert.equal(countCurves(short, 15, 7).n, 0);
  assert.equal(countCurves([], 15, 7).n, 0);
});

test('leanHistogram: bin D/S, dritto escluso', () => {
  const rows = [R({ lean: 2 }), R({ lean: 27 }), R({ lean: -32 }), R({})];
  const h = leanHistogram(rows, 5);
  assert.equal(h.binsR[5], 1);
  assert.equal(h.binsL[6], 1);
  assert.equal(h.binsR.reduce((a, b) => a + b, 0), 1);
});

test('posterStats: media in movimento, vmax dal meta, decel da lonG', () => {
  const rows = [R({ speedKmh: 0, t: 0 }), R({ speedKmh: 100, t: 1 }), R({ speedKmh: 100, t: 2, gap: 1 })];
  const st = posterStats(rows, [], { maxSpeed: 142, distKm: 12.5 });
  assert.equal(Math.round(st.vAvg), 100); // sosta e gap esclusi
  assert.equal(st.vmax, 142); // meta fuso, non grezzo rows
  assert.equal(st.distKm, undefined); // campo si chiama km
  assert.equal(st.km, 12.5); // da meta, non da rows
});

test('posterStats: gradino GPS non diventa decelerazione assurda', () => {
  const rows = [R({ speedKmh: 0, t: 0 }), R({ speedKmh: 100, t: 0.05, lonG: -0.3 })];
  const st = posterStats(rows, [], {});
  assert.ok(st.decel > 2.9 && st.decel < 3.0); // 0.3*9.80665
  assert.ok(st.decel < 10);
});

test('posterStats: jitter da fermo non gonfia distanza/tempi', () => {
  const rows = [];
  for (let k = 0; k < 500; k++) rows.push(R({ t: k * 0.05, speedKmh: 0, lean: 0 }));
  const st = posterStats(rows, [], { distKm: 12.5 });
  assert.equal(st.km, 12.5);
  assert.equal(st.tLean20, 0);
  assert.doesNotThrow(() => posterStats([], [], {}));
  assert.ok(!JSON.stringify(posterStats([], [], {})).includes('NaN'));
});

test('projectTrackXY: correzione cos(lat) ~0.7 a 45 gradi', () => {
  const pts = [{ lat: 45, lon: 10 }, { lat: 45.01, lon: 10 }, { lat: 45, lon: 10.01 }, { lat: 45.01, lon: 10.01 }];
  const px = projectTrackXY(pts, 1000, 1000, 40);
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let k = 0; k < px.length; k += 2) {
    mnx = Math.min(mnx, px[k]); mxx = Math.max(mxx, px[k]);
    mny = Math.min(mny, px[k + 1]); mxy = Math.max(mxy, px[k + 1]);
  }
  const ratio = (mxx - mnx) / (mxy - mny);
  assert.ok(Math.abs(ratio - Math.cos(45 * Math.PI / 180)) < 0.02, 'ratio=' + ratio);
});

test('posterMoments: 3 righe con valore e tempo', () => {
  const rows = [R({ t: 1, speedKmh: 50, lean: 10, latG: 0.2 }),
    R({ t: 2, speedKmh: 120, lean: -40, latG: 0.9 })];
  const mm = posterMoments(rows);
  assert.equal(mm.length, 3);
  assert.ok(mm[0].v.includes('120'));
  assert.ok(mm[1].v.includes('40'));
});

test('posterLayout + buildPosterModel: box dentro card, modello piatto', () => {
  const W = 1080, H = 1350;
  const L = posterLayout(W, H);
  for (const k of ['header', 'map', 'stats', 'spark', 'hist', 'moments', 'foot']) {
    const r = L[k];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H + 1, k);
  }
  assert.ok(L.map.h > L.spark.h);
  const rows = [R({ t: 0, speedKmh: 80, lean: 20 }), R({ t: 1, speedKmh: 90, lean: -25 })];
  const m = buildPosterModel(rows, [{ lat: 44, lon: 10 }, { lat: 44.01, lon: 10.01 }],
    { distKm: 5, maxSpeed: 90, startISO: '2026-04-12T07:30:00.000Z' });
  assert.ok(!JSON.stringify(m).includes('NaN'));
  assert.equal(m.spark.length, 2);
  assert.equal(m.nPts, 2);
});

test('posterSizeFor: 3 formati + fallback portrait', () => {
  assert.deepEqual(posterSizeFor('square'), { w: 1080, h: 1080 });
  assert.deepEqual(posterSizeFor('portrait'), { w: 1080, h: 1350 });
  assert.deepEqual(posterSizeFor('story'), { w: 1080, h: 1920 });
  assert.deepEqual(posterSizeFor('bogus'), { w: 1080, h: 1350 });
  assert.deepEqual(posterSizeFor(undefined), { w: 1080, h: 1350 });
  assert.ok(POSTER_FORMATS.square && POSTER_FORMATS.portrait && POSTER_FORMATS.story);
});

test('posterTitle: data/ora da startISO, fallback e ISO invalido', () => {
  assert.match(posterTitle({ startISO: '2026-04-12T07:30:00.000Z' }), /12\/4\/2026/);
  assert.equal(posterTitle({}), 'Giro in moto');
  assert.equal(posterTitle({ startISO: 'non-una-data' }), 'Giro in moto');
  assert.equal(posterTitle(null), 'Giro in moto');
});

test('posterLayoutFor: invarianti box x3 formati', () => {
  for (const fmt of ['square', 'portrait', 'story']) {
    const s = posterSizeFor(fmt);
    const L = posterLayoutFor(fmt);
    for (const k of ['header', 'map', 'stats', 'strip', 'spark', 'hist', 'moments', 'foot']) {
      const r = L[k];
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= s.w && r.y + r.h <= s.h + 1, fmt + '/' + k);
    }
    assert.ok(L.moments.h >= 0, fmt + '/moments non negativo');
    assert.ok(L.map.h > L.spark.h, fmt + '/map > spark');
  }
});

test('buildPosterModel: gLat/decel/tLean20 senza NaN anche su rows=[]', () => {
  const m = buildPosterModel([], [], {});
  assert.ok(isFinite(m.st.gLat) && isFinite(m.st.decel) && isFinite(m.st.tLean20));
  assert.ok(!JSON.stringify(m).includes('NaN'));
});

// ---- sagoma della traccia: proporzioni vere, non quelle del riquadro ----
function fitted(track, box) {
  const xy = api.posterTrackXY(track, 1080, 1350);
  const px = api.posterFitXY(xy, box.x, box.y, box.w, box.h);
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let k = 0; k < px.length; k += 2) {
    mnx = Math.min(mnx, px[k]); mxx = Math.max(mxx, px[k]);
    mny = Math.min(mny, px[k + 1]); mxy = Math.max(mxy, px[k + 1]);
  }
  return { w: mxx - mnx, h: mxy - mny, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 };
}
const BOX = { x: 40, y: 100, w: 1000, h: 600 };

test('card: rettilineo nord-sud resta una linea sottile, non uno zig-zag largo quanto la card', () => {
  const straight = Array.from({ length: 200 }, (_, i) => ({ lat: 45 + i * 0.0009, lon: 9 + (i % 2 ? 0.00003 : 0) }));
  const f = fitted(straight, BOX);
  assert.ok(Math.abs(f.h - BOX.h) < 1, 'occupa tutta l\'altezza: ' + f.h);
  assert.ok(f.w < 2, 'il jitter di ~2 m resta di pochi pixel: ' + f.w.toFixed(1));
  assert.ok(Math.abs(f.cx - (BOX.x + BOX.w / 2)) < 1, 'centrata');
});

test('card: giro 40×5 km conserva il rapporto 8:1', () => {
  const wide = Array.from({ length: 400 }, (_, i) => {
    const u = i / 399 * 2 * Math.PI;
    return { lat: 45 + 0.0225 * Math.sin(u), lon: 9 + 0.254 * Math.cos(u) };
  });
  const f = fitted(wide, BOX);
  assert.ok(Math.abs(f.w - BOX.w) < 1, 'occupa tutta la larghezza');
  assert.ok(Math.abs(f.w / f.h - 8) < 0.3, 'rapporto: ' + (f.w / f.h).toFixed(2));
  assert.ok(Math.abs(f.cy - (BOX.y + BOX.h / 2)) < 1, 'centrata in verticale');
});

test('card: giro quasi quadrato riempie il lato corto del riquadro; un punto solo non esplode', () => {
  const sq = Array.from({ length: 100 }, (_, i) => {
    const u = i / 99 * 2 * Math.PI;
    return { lat: 45 + 0.01 * Math.sin(u), lon: 9 + 0.01 / Math.cos(45 * Math.PI / 180) * Math.cos(u) };
  });
  const f = fitted(sq, BOX);
  assert.ok(Math.abs(f.h - BOX.h) < 1);
  assert.ok(Math.abs(f.w / f.h - 1) < 0.05, 'rapporto: ' + (f.w / f.h).toFixed(3));
  const px = api.posterFitXY([0, 0, 0, 0], 0, 0, 100, 50);
  assert.ok(px.every(v => isFinite(v)), 'coordinate finite');
});
