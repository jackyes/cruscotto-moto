import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { takeLogAvg, snapshot, resetLogAcc, GAP_MS } = api;

function fillAcc(n, vals = {}) {
  const acc = api.logAcc;
  for (let i = 0; i < n; i++) {
    acc.n++;
    acc.lean += vals.lean ?? 10;
    acc.latG += vals.latG ?? 0.5;
    acc.lonG += vals.lonG ?? 0.1;
    acc.vertG += vals.vertG ?? 1.0;
    acc.gyro += vals.gyro ?? 5;
    acc.vib += vals.vib ?? 0.02;
    acc.latFus += vals.latFus ?? 0.4;
    acc.lonFus += vals.lonFus ?? 0.05;
    acc.pitch += vals.pitch ?? 2;
    acc.yaw += vals.yaw ?? 30;
    acc.speedFus += vals.speedFus ?? 20;
    acc.leanKin += vals.leanKin ?? 9;
    acc.vibHi += vals.vibHi ?? 0.01;
    acc.latPk = vals.latPk ?? acc.latPk;
    acc.lonPk = vals.lonPk ?? acc.lonPk;
    acc.vertPk = vals.vertPk ?? acc.vertPk;
  }
}

test('takeLogAvg: n=0 ritorna null', () => {
  resetState();
  assert.equal(takeLogAvg(), null);
});

test('takeLogAvg: media corretta e azzeramento', () => {
  resetState();
  fillAcc(4, { lean: 20, latG: 1.0 });
  const m = takeLogAvg();
  assert.equal(m.lean, 20);
  assert.equal(m.latG, 1.0);
  assert.equal(m.vertG, 1.0);
  // svuotato dopo lettura
  assert.equal(takeLogAvg(), null);
});

test('takeLogAvg: picchi non mediati', () => {
  resetState();
  const acc = api.logAcc;
  acc.n = 2; acc.latG = 1.0; acc.lonG = 0.2; acc.vertG = 2.0;
  acc.latPk = -2.5; acc.lonPk = 1.5; acc.vertPk = 3.0;
  const m = takeLogAvg();
  assert.equal(m.latPk, -2.5);
  assert.equal(m.lonPk, 1.5);
  assert.equal(m.vertPk, 3.0);
  assert.equal(m.latG, 0.5);
});

test('resetLogAcc: azzera conteggio e picchi', () => {
  resetState();
  fillAcc(3);
  api.logAcc.latPk = 4;
  resetLogAcc();
  assert.equal(api.logAcc.n, 0);
  assert.equal(api.logAcc.lean, 0);
  assert.equal(api.logAcc.latPk, 0);
  assert.equal(takeLogAvg(), null);
});

test('snapshot: usa media quando disponibile', () => {
  resetState();
  const s = api.state;
  s.speedGpsMs = 10; s.session = { startWall: Date.now() - 5000 };
  fillAcc(2, { lean: 30 });
  const snap = snapshot();
  assert.equal(snap.lean, 30);
  assert.equal(snap.speedKmh, 36);
  assert.equal(snap.gap, 0);
});

test('snapshot: fallback a state senza media', () => {
  resetState();
  const s = api.state;
  s.lean = 15; s.latG = 0.3; s.speedGpsMs = 5;
  s.gyroRoll = 7; s.vibG = 0.05; s.pitch = 3; s.gyroYaw = 45;
  s.speedFusMs = 6; s.leanKin = 12; s.vibHiG = 0.02;
  s.session = { startWall: Date.now() - 1000 };
  const snap = snapshot();
  assert.equal(snap.lean, 15);
  assert.equal(snap.gyro, 7);
  assert.equal(snap.speedKmh, 18);
  assert.equal(snap.gap, 0);
});

test('snapshot: speedKmh null senza fix GPS', () => {
  resetState();
  api.state.speedGpsMs = null;
  api.state.session = { startWall: Date.now() - 1000 };
  const snap = snapshot();
  assert.equal(snap.speedKmh, null);
});

test('snapshot: gap=0 con campionamento fresco, GAP_MS=500', () => {
  // snapshot() legge Date.now() dentro la sandbox vm: il mock va installato
  // nel contesto vm, non nel Date globale di Node. Due snapshot ravvicinati
  // danno gap=0; il ramo gap=1 non e testabile senza esporre lastSampleWall.
  resetState();
  api.state.session = { startWall: Date.now() - 10000 };
  const first = snapshot();
  assert.equal(first.gap, 0);
  const second = snapshot();
  assert.equal(second.gap, 0);
  assert.equal(GAP_MS, 500);
  assert.ok(second.t >= first.t);
});
