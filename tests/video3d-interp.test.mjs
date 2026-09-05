// Camera continua: carry-forward bearing, smoothing circolare, sampling frazionario, damper.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoBearingSeries, videoSmoothBearings, videoPathSampleAt,
  videoTrackPosForRow, videoDamp, videoDampAngle } = api;

const P = (lat, lon) => ({ lat, lon });

test('videoBearingSeries: punti coincidenti non collassano a NORD', () => {
  // sosta: 3 punti uguali poi ripartenza verso est (brg 90)
  const pts = [P(44, 10), P(44, 10), P(44, 10), P(44, 10.001)];
  const s = videoBearingSeries(pts);
  assert.equal(s.length, 4);
  // backfill: il prefisso prende il primo bearing valido, mai 0=NORD
  assert.ok(s[0].brg > 80 && s[0].brg < 100);
  assert.equal(s[1].brg, s[0].brg);
  assert.equal(s[2].brg, s[0].brg);
  // tutto coincidente: ok:false, brg 0 senza throw
  const dead = videoBearingSeries([P(44, 10), P(44, 10), P(44, 10)]);
  assert.ok(dead.every(x => x.brg === 0 && x.ok === false));
  assert.deepEqual(videoBearingSeries([]), []);
});

test('videoSmoothBearings: media circolare col kernel triangolare', () => {
  const mk = brg => ({ lat: 0, lon: 0, brg, ok: true });
  const out = videoSmoothBearings([350, 355, 0, 5, 10].map(mk));
  assert.ok(out.every(b => b.brg > 320 || b.brg < 40), JSON.stringify(out.map(b => b.brg)));
  // kernel triangolare: pesi 1/2/3/2/1 -> atan2(3,6) ~= 26.57 (media uniforme: 18)
  const spike = videoSmoothBearings([0, 0, 90, 0, 0].map(mk));
  assert.ok(Math.abs(spike[2].brg - 26.57) < 0.5, 'atteso ~26.57: ' + spike[2].brg);
  // ok:false marcati ma col bearing riportato: non tirano a zero
  const stop = [{ lat: 0, lon: 0, brg: 270, ok: false }, { lat: 0, lon: 0, brg: 270, ok: false }, { lat: 0, lon: 0, brg: 270, ok: false }];
  assert.equal(Math.round(videoSmoothBearings(stop)[1].brg), 270);
});

test('videoPathSampleAt: lerp posizione + arco corto sul bearing', () => {
  const kf = [{ lat: 44, lon: 10, brg: 0 }, { lat: 44.002, lon: 10.002, brg: 0 }];
  const p = videoPathSampleAt(kf, 0.5);
  assert.ok(Math.abs(p.lat - 44.001) < 1e-9);
  assert.ok(Math.abs(p.lon - 10.001) < 1e-9);
  // wrap: 350->10 passa per 0, mai per 180
  const w = videoPathSampleAt([{ lat: 0, lon: 0, brg: 350 }, { lat: 0, lon: 0, brg: 10 }], 0.5);
  assert.ok(Math.abs(((w.brg + 180) % 360) - 180) < 1e-6, 'brg=' + w.brg);
  // degeneri: mai throw, il chiamante tiene il guard if (p && ...)
  assert.equal(videoPathSampleAt([], 0), null);
  assert.equal(videoPathSampleAt(kf, NaN), null);
  assert.deepEqual(videoPathSampleAt(kf, -5), kf[0]);
  assert.deepEqual(videoPathSampleAt(kf, 999), kf[1]);
});

test('videoTrackPosForRow: frazionario, monotono, clampato', () => {
  assert.equal(videoTrackPosForRow(0, 100, 50), 0);
  assert.equal(videoTrackPosForRow(99, 100, 50), 49);
  assert.equal(videoTrackPosForRow(50, 101, 11), 5);
  assert.equal(videoTrackPosForRow(25, 101, 11), 2.5);
  let prev = -1;
  for (let i = 0; i < 100; i++) {
    const u = videoTrackPosForRow(i, 100, 50);
    assert.ok(u >= prev, `non monotono a ${i}`);
    prev = u;
  }
});

test('videoDamp: indipendente dal frame rate, converge al target', () => {
  const tau = 0.18;
  let a = 0, b = 0;
  for (let k = 0; k < 60; k++) a = videoDamp(a, 100, 1 / 60, tau);
  for (let k = 0; k < 15; k++) b = videoDamp(b, 100, 1 / 15, tau);
  assert.ok(Math.abs(a - b) < 0.5, `60fps=${a} 15fps=${b}`);
  assert.ok(Math.abs(a - 100 * (1 - Math.exp(-1 / tau))) < 1e-9);
  assert.equal(videoDamp(5, 100, 0, tau), 100);
  assert.equal(videoDamp(5, 100, 0.1, 0), 100);
});

test('videoDampAngle: arco corto su entrambi i versi', () => {
  assert.ok(Math.abs(videoDampAngle(350, 10, 1e9, 1) - 10) < 1e-6);
  assert.ok(Math.abs(videoDampAngle(10, 350, 1e9, 1) - 350) < 1e-6);
  // dt 0 = nessun movimento
  assert.equal(videoDampAngle(45, 90, 0, 0.5), 45);
  assert.ok(!isFinite(NaN) && videoDampAngle(NaN, 90, 0.1, 0.5) === 90);
});
