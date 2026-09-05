// Video FX 2D: slow-mo envelope, shake deterministico, speed-lines procedurali.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { buildSlowZones, slowMultAt, shakeAmpFor, shakeOffset, speedLinesFor } = api;

const R = (t, o) => Object.assign({ t, speedKmh: 0, lean: 0, vib_g: 0 }, o);

test('buildSlowZones: piega>25 apre zona, corte scartate, merge vicine', () => {
  const rows = [];
  for (let k = 0; k < 200; k++) rows.push(R(k * 0.05, { lean: k >= 40 && k < 120 ? 30 : 0 }));
  const s = buildSlowZones(rows, 4);
  assert.equal(s.base, 4);
  assert.equal(s.zones.length, 1, JSON.stringify(s.zones));
  assert.ok(s.zones[0].t1 - s.zones[0].t0 >= 1.5);
  const flat = [];
  for (let k = 0; k < 200; k++) flat.push(R(k * 0.05));
  assert.equal(buildSlowZones(flat, 1).zones.length, 0);
  const blip = [];
  for (let k = 0; k < 200; k++) blip.push(R(k * 0.05, { lean: k === 100 ? 40 : 0 }));
  assert.equal(buildSlowZones(blip, 1).zones.length, 0, 'blip singolo scartato');
  assert.equal(buildSlowZones([], 2).base, 2);
  assert.equal(buildSlowZones(null, null).base, 1);
});

test('slowMultAt: dentro slow, fuori base, rampa continua', () => {
  const slow = { base: 4, slow: 0.35, ramp: 0.5, zones: [{ t0: 10, t1: 20 }] };
  assert.equal(slowMultAt(15, slow), 0.35);
  assert.equal(slowMultAt(0, slow), 4);
  assert.equal(slowMultAt(30, slow), 4);
  const edge = slowMultAt(10, slow);
  assert.ok(edge >= 0.35 && edge <= 4, 'rampa continua: ' + edge);
  assert.equal(slowMultAt(5, null), 1);
  assert.equal(slowMultAt(5, { base: 2, zones: [] }), 2);
});

test('shakeAmpFor: soglia 0.15, clamp a maxPx, scala con W', () => {
  assert.equal(shakeAmpFor(0.1, 1280), 0);
  assert.equal(shakeAmpFor(0, 1280), 0);
  assert.equal(shakeAmpFor(NaN, 1280), 0);
  const a = shakeAmpFor(0.5, 1280);
  assert.ok(a > 0 && a <= 6, 'a=' + a);
  assert.equal(shakeAmpFor(99, 1280), 6, 'clamp 720p');
  assert.equal(shakeAmpFor(99, 1920), 9, 'scala 1080p');
});

test('shakeOffset: deterministico, zero su amp 0', () => {
  assert.deepEqual(shakeOffset(5, 0), { dx: 0, dy: 0 });
  const a = shakeOffset(1.234, 4), b = shakeOffset(1.234, 4);
  assert.deepEqual(a, b, 'stesso t = stesso offset');
  const c = shakeOffset(1.3, 4);
  assert.ok(c.dx !== a.dx || c.dy !== a.dy, 'varia nel tempo');
  assert.ok(Math.abs(a.dx) <= 6 && Math.abs(a.dy) <= 6, 'bound amp*1.5');
});

test('speedLinesFor: vuote sotto soglia, n proporzionale, deterministiche', () => {
  assert.deepEqual(speedLinesFor(5, 50, 120, 1280, 720), [], 'sotto 0.72*max');
  const lo = speedLinesFor(5, 100, 120, 1280, 720);
  const hi = speedLinesFor(5, 120, 120, 1280, 720);
  assert.ok(lo.length >= 6 && hi.length >= lo.length, 'n proporzionale');
  const a = speedLinesFor(5, 120, 120, 1280, 720);
  const b = speedLinesFor(5, 120, 120, 1280, 720);
  assert.deepEqual(a, b, 'stesso frame = stesse linee');
  for (const l of a) {
    assert.ok(l.x0 < 1280 * 0.16 || l.x0 > 1280 * 0.84, 'solo bordi: ' + l.x0);
    assert.ok(l.a >= 0.15 && l.a <= 0.5, 'alpha bound');
  }
});
