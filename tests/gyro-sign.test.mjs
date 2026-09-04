import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { updateGyroSign, resetSensorFilters, GSIGN_MIN_ENERGY, GSIGN_TAU_S } = api;

test('updateGyroSign: dt<=0 e credible=false sono no-op', () => {
  resetState();
  const s = api.state;
  s.gyroSign = 1; s.gyroSignScore = 0; s.gyroSignEnergy = 0; s._gsPrev = null;
  updateGyroSign(50, 10, 0, true);
  assert.equal(s._gsPrev, 10);
  assert.equal(s.gyroSignEnergy, 0);
  updateGyroSign(50, 20, -0.1, true);
  assert.equal(s._gsPrev, 20);
  updateGyroSign(50, 30, 0.05, false);
  assert.equal(s._gsPrev, 30);
  assert.equal(s.gyroSignEnergy, 0);
});

test('updateGyroSign: primo campione arma solo _gsPrev', () => {
  resetState();
  const s = api.state;
  s._gsPrev = null; s.gyroSignEnergy = 0;
  updateGyroSign(50, 12, 0.05, true);
  assert.equal(s._gsPrev, 12);
  assert.equal(s.gyroSignEnergy, 0);
});

test('updateGyroSign: fermo (dLean o rollRate < 5) non accumula', () => {
  resetState();
  const s = api.state;
  s._gsPrev = 10; s.gyroSignScore = 0; s.gyroSignEnergy = 0;
  updateGyroSign(50, 10.1, 0.05, true); // dLean = 2 < 5
  assert.equal(s.gyroSignEnergy, 0);
  updateGyroSign(2, 20, 0.05, true); // rollRate < 5
  assert.equal(s.gyroSignEnergy, 0);
});

test('updateGyroSign: correlazione negativa forte flippa il segno', () => {
  resetState();
  const s = api.state;
  s.gyroSign = 1; s.gyroSignScore = 0; s.gyroSignEnergy = 0;
  s._gsPrev = 0; s._attU = { x: 1 };
  // rollRate>0 con dLean<0 ripetuti: score negativo, energia sopra soglia
  for (let i = 0; i < 200 && s.gyroSign === 1; i++) {
    updateGyroSign(50, s._gsPrev - 1, 0.05, true);
  }
  assert.equal(s.gyroSign, -1);
  assert.equal(s.gyroSignScore, 0);
  assert.equal(s.gyroSignEnergy, 0);
  assert.equal(s._attU, null);
});

test('updateGyroSign: correlazione positiva non flippa', () => {
  resetState();
  const s = api.state;
  s.gyroSign = 1; s.gyroSignScore = 0; s.gyroSignEnergy = 0;
  s._gsPrev = 0;
  for (let i = 0; i < 200; i++) {
    if (s.gyroSign !== 1) break;
    updateGyroSign(50, s._gsPrev + 1, 0.05, true);
  }
  assert.equal(s.gyroSign, 1);
});

test('updateGyroSign: verdetto gia dato blocca accumulo', () => {
  resetState();
  const s = api.state;
  s.gyroSignEnergy = GSIGN_MIN_ENERGY * 20 + 1;
  s.gyroSignScore = 42; s._gsPrev = 5;
  updateGyroSign(50, 15, 0.05, true);
  assert.equal(s.gyroSignScore, 42);
  assert.equal(s._gsPrev, 5); // early-return: _gsPrev intatto
});

test('updateGyroSign: costanti di taratura attese', () => {
  assert.equal(GSIGN_TAU_S, 4);
  assert.equal(GSIGN_MIN_ENERGY, 150);
});

test('resetSensorFilters: azzera filtri e stime', () => {
  resetState();
  const s = api.state;
  s._accLP = { x: 1, y: 2, z: 3 };
  s._wLP = { x: 1, y: 1, z: 1 };
  s.gyroBias = { x: 5, y: 5, z: 5 };
  s.attBias = { x: 1, y: 1, z: 1 };
  s._spHist = [{ t: 1, v: 2 }];
  s.speedMs = 12; s.vibG = 3; s.leanConf = 0.1;
  s._attU = { x: 1 }; s.pitch = 9; s.leanKin = 9;
  resetSensorFilters();
  assert.equal(s._accLP, null);
  assert.equal(s._wLP, null);
  assert.equal(s.gyroBias, null);
  assert.equal(s.attBias.x, 0);
  assert.equal(s.attBias.y, 0);
  assert.equal(s.attBias.z, 0);
  assert.equal(s._spHist, null);
  assert.equal(s._attU, null);
  assert.equal(s.attBias.x, 0);
  assert.equal(s.attBias.y, 0);
  assert.equal(s.attBias.z, 0);
  assert.equal(s.pitch, 0);
  assert.equal(s.leanKin, 0);
  assert.equal(s.vibG, 0);
  assert.equal(s.leanConf, 1);
  assert.equal(s.speedFusMs, 12);
});

test('resetSensorFilters: speedFusMs fallback a 0 senza speedMs', () => {
  resetState();
  const s = api.state;
  s.speedMs = null;
  resetSensorFilters();
  assert.equal(s.speedFusMs, 0);
});
