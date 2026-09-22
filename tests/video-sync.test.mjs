// Video: righe (20 Hz, anche da fermi) e punti mappa (traccia, solo in marcia)
// agganciati per tempo, non per proporzione di indice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vmSandbox as s } from './harness.mjs';

/* Giro sintetico: 60 min, sosta dal minuto 20 al 30, 60 km/h verso nord.
   Righe a 20 Hz (t in s dall'inizio), traccia a 1 punto/s solo in marcia (ts epoch). */
const START_MS = Date.parse('2026-09-20T09:00:00Z');
const LAT0 = 45, M_PER_DEG = 111195, V = 60 / 3.6;
const movedAt = t => (t < 1200 ? t : (t < 1800 ? 1200 : t - 600)) * V;   // metri percorsi al tempo t
function ride() {
  const rows = [], track = [];
  for (let i = 0; i < 60 * 60 * 20; i++) {
    const t = i / 20;
    rows.push({ t, lat: LAT0 + movedAt(t) / M_PER_DEG, lon: 9, lean: t < 1200 ? 30 : -30, speedKmh: t >= 1200 && t < 1800 ? 0 : 60 });
  }
  for (let t = 0; t < 3600; t++) {
    if (t >= 1200 && t < 1800) continue;                                    // fermi: nessun punto
    track.push({ lat: LAT0 + movedAt(t) / M_PER_DEG, lon: 9, t: 123456 + t * 1000, ts: START_MS + t * 1000 });
  }
  return { rows, track };
}
const latAt = (pts, u) => { const i = Math.floor(u), f = u - i; const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)]; return a.lat + (b.lat - a.lat) * f; };

test('mappa agganciata per tempo: scarto sotto 50 m a ogni minuto, anche dopo la sosta', () => {
  const { rows, track } = ride();
  const mapT = s.videoMapTimes(track, true, START_MS);
  assert.ok(mapT, 'tempi ricavati dalla traccia');
  const job = { rows, mapT };
  for (let m = 0; m < 60; m += 5) {
    const i = m * 60 * 20;
    const u = s.videoMapPosForRow(job, i, track.length);
    const errM = Math.abs(latAt(track, u) - rows[i].lat) * M_PER_DEG;
    assert.ok(errM < 50, 'minuto ' + m + ': scarto ' + Math.round(errM) + ' m');
  }
});

test('durante la sosta la mappa sta ferma; senza tempi (vecchio mapping) si muoveva di km', () => {
  const { rows, track } = ride();
  const job = { rows, mapT: s.videoMapTimes(track, true, START_MS) };
  const at = m => latAt(track, s.videoMapPosForRow(job, m * 60 * 20, track.length));
  // Resta solo la risoluzione della traccia: fra l'ultimo punto prima della
  // sosta (t = 1199 s) e il primo dopo ci sono ~16 m, interpolati sul fermo.
  const moved = Math.abs(at(29) - at(21)) * M_PER_DEG;
  assert.ok(moved < 20, 'la mappa si è mossa di ' + Math.round(moved) + ' m a moto ferma');
  const old = { rows, mapT: null };
  const atOld = m => latAt(track, s.videoMapPosForRow(old, m * 60 * 20, track.length));
  assert.ok(Math.abs(atOld(29) - atOld(21)) * M_PER_DEG > 5000, 'premessa: il vecchio mapping scorreva');
});

test('colore per piega: ogni segmento prende la piega del suo momento', () => {
  const { rows, track } = ride();
  const mapT = s.videoMapTimes(track, true, START_MS);
  const leans = s.videoSegLeansFor(track, rows, mapT);
  // Primi 1200 punti prima della sosta (piega +30), il resto dopo (−30 → |30|).
  assert.equal(leans.length, track.length);
  const job = { rows, mapT };
  // Punto 1000 = t 1000 s, prima della sosta (piega +30); punto 1300 = dopo (−30).
  assert.equal(s.videoLeanAtPoint(job, 1000, track.length), 30);
  assert.equal(s.videoLeanAtPoint(job, 1300, track.length), -30);
  assert.equal(leans[1000], 30);
  // Il vecchio mapping mandava il punto 1000 a t ≈ 1200 s, già nella sosta (−30).
  assert.equal(s.videoLeanAtPoint({ rows, mapT: null }, 1000, track.length), -30);
});

test('videoMapTimes: righe col loro t; niente tempi se mancano, sono disordinati o manca l\'inizio', () => {
  const rows = [{ t: 0, lat: 45, lon: 9 }, { t: 1, lat: 45.1, lon: 9 }, { t: 2, lat: 45.2, lon: 9 }];
  assert.deepEqual(Array.from(s.videoMapTimes(rows, false, NaN)), [0, 1, 2]);
  const tr = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }];
  assert.deepEqual(Array.from(s.videoMapTimes(tr, true, 1000)), [0, 1, 2]);
  assert.equal(s.videoMapTimes(tr, true, NaN), null, 'senza inizio del giro');
  assert.equal(s.videoMapTimes([{ ts: 1000 }, {}, { ts: 3000 }], true, 0), null, 'ts mancante');
  assert.equal(s.videoMapTimes([{ ts: 3000 }, { ts: 1000 }], true, 0), null, 'disordinati');
  assert.equal(s.videoMapTimes([{ ts: 1000 }], true, 0), null, 'un punto solo');
  // Fallback: senza tempi resta il mapping proporzionale di prima.
  const job = { rows: new Array(101).fill(0).map((_, i) => ({ t: i })), mapT: null };
  assert.equal(s.videoMapPosForRow(job, 50, 11), 5);
});

test('videoMapPosAtTime: bordi e interpolazione', () => {
  const T = new Float64Array([0, 10, 10, 20]);
  assert.equal(s.videoMapPosAtTime(T, -5), 0);
  assert.equal(s.videoMapPosAtTime(T, 25), 3);
  assert.equal(s.videoMapPosAtTime(T, 5), 0.5);
  assert.equal(s.videoMapPosAtTime(T, 15), 2.5);
});

test('i quattro job video portano mapT e il 3D lo usa per segmenti e camera', () => {
  for (const f of ['js/video.js', 'js/video3d.js', 'js/video-mp4.js', 'js/video-webm.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(src, /mapPts: pre\.mapPts, mapT: pre\.mapT/, f);
  }
  const v3 = readFileSync(new URL('../js/video3d.js', import.meta.url), 'utf8');
  assert.match(v3, /videoSegLeansFor\(pre\.mapPts, pre\.rows, pre\.mapT\)/);
  assert.match(v3, /const u = videoMapPosForRow\(job, i, keyframes\.length\)/);
  const off = readFileSync(new URL('../js/video-offline.js', import.meta.url), 'utf8');
  assert.match(off, /videoSegLeansFor\(pre\.mapPts, pre\.rows, pre\.mapT\)/);
});
