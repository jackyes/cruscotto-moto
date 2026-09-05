import { test } from 'node:test';
import assert from 'node:assert';
import { api, vmSandbox } from './harness.mjs';

vmSandbox.getComputedStyle = () => ({ getPropertyValue: () => '#fff' });

const { videoCameraFor, drawVideoHUD3D } = api;

test('videoCameraFor: fermo zoom-in, veloce zoom-out', () => {
  const slow = videoCameraFor(0, 0);
  const fast = videoCameraFor(130, 0);
  assert.equal(slow.zoom, 16.5);
  assert.equal(fast.zoom, 14.5);
  assert.ok(slow.zoom > videoCameraFor(60, 0).zoom);
  assert.ok(videoCameraFor(60, 0).zoom > fast.zoom);
});

test('videoCameraFor: piega alza il pitch', () => {
  assert.equal(videoCameraFor(50, 0).pitch, 55);
  assert.equal(videoCameraFor(50, 60).pitch, 72);
  assert.ok(videoCameraFor(50, 30).pitch > 55);
  // segno piega irrilevante, invalidi → default dritto
  assert.equal(videoCameraFor(50, -45).pitch, videoCameraFor(50, 45).pitch);
  assert.deepEqual(videoCameraFor(NaN, NaN), { zoom: 16.5, pitch: 55 });
  // clamp oltre i limiti
  assert.equal(videoCameraFor(999, 999).zoom, 14.5);
  assert.equal(videoCameraFor(-10, 0).zoom, 16.5);
});

function mockCtx() {
  const calls = { fillText: [], rr: 0 };
  return {
    calls,
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', lineWidth: 0, lineCap: '',
    fillRect() {}, clearRect() {}, fill() {}, stroke() {},
    beginPath() {}, closePath() {}, arc() {}, arcTo() {}, moveTo() {}, lineTo() {}, rect() {}, clip() {}, save() {}, restore() {},
    measureText: () => ({ width: 100 }),
    fillText(t) { calls.fillText.push(String(t)); },
  };
}

test('drawVideoHUD3D: mostra Vmax e distanza in basso-destra', () => {
  // rrPath reale vuole ctx con metodi path: il mock li ha.
  const ctx = mockCtx();
  const job = { canvas: { width: 1280, height: 720 } };
  drawVideoHUD3D(ctx, job, { speedKmh: 88, lean: 12 }, 61, 3.456, 120);
  const all = ctx.calls.fillText.join(' | ');
  assert.ok(all.includes('88'), 'velocità corrente: ' + all);
  assert.ok(all.includes('Vmax 120 km/h'), 'vmax: ' + all);
  assert.ok(all.includes('3.46 km'), 'distanza: ' + all);
});
