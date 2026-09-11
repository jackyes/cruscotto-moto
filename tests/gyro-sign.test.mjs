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
  assert.equal(s.gyroSignEnergy, GSIGN_MIN_ENERGY); // NON 0: il lock deve scadere dopo ~1 τ
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
  s.gyroSignLocked = true; // il lock e' il segnale di "verdetto dato", non l'energia
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
  s.attBias = { x: 1, y: 1, z: 1 };
  s._spHist = [{ t: 1, v: 2 }];
  s.speedMs = 12; s.vibG = 3; s.leanConf = 0.1;
  s._attU = { x: 1 }; s.pitch = 9; s.leanKin = 9;
  resetSensorFilters();
  assert.equal(s._accLP, null);
  assert.equal(s._wLP, null);
  assert.equal(s.attBias.x, 0);
  assert.equal(s.attBias.y, 0);
  assert.equal(s.attBias.z, 0);
  assert.equal(s._spHist, null);
  assert.equal(s._attU, null);
  assert.equal(s.attBias.x, 0);
  assert.equal(s.attBias.y, 0);
  assert.equal(s.attBias.z, 0);
  assert.equal(s.pitch, 0);
  // null, non 0: 0° e' una piega cinematica VALIDA (moto dritta a velocita' nota),
  // l'assenza di stima non deve travestirsi da misura.
  assert.equal(s.leanKin, null);
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

/* Cambiare `invertLean` (o una calibrazione con montaggio opposto) ribalta il SEGNO
   di leanAcc a parita' di piega: tutto il punteggio accumulato fino a quel momento
   vive nel frame col segno vecchio e diventa evidenza per il segno sbagliato. */
test('resetGyroSignLearner: azzera dLean e punteggio, non il verdetto', () => {
  resetState();
  const s = api.state;
  s.gyroSign = -1; s._gsPrev = 5; s.gyroSignScore = -400;
  s.gyroSignEnergy = 900; s.gyroSignLocked = true;
  api.resetGyroSignLearner();
  assert.equal(s._gsPrev, null);
  assert.equal(s.gyroSignScore, 0);
  /* L'energia NON si azzera: e' il termine che fa scadere il lock a orologio
     (GSIGN_TAU_S). Azzerarla sbloccherebbe un verdetto gia' dato. */
  assert.equal(s.gyroSignEnergy, 900);
  assert.equal(s.gyroSignLocked, true);
});

/* leanKin = atan(v*yawUp/g): con il GPS stantio `speedFusMs` e' un'ultima velocita'
   notissima ma VECCHIA, e la piega cinematica che ne uscirebbe e' un numero
   plausibile e falso. null, non 0: 0 e' una piega valida (moto dritta). */
test('leanKin: null col GPS stantio, numero con la velocita fresca', () => {
  resetState();
  const s = api.state;
  s.calib = api.buildBasis({ x: 1, y: 0, z: 0 });
  s.mount = 'landscape-left';
  const sample = t => ({ acc: { x: api.G, y: 0, z: 0 }, gyro: { x: 30, y: 0, z: 0 }, grav: null, lin: null, t });
  let t = 500000;
  const step = () => { t += 50; api.lastMotionT = t - 50; api.processSample(sample(t)); };

  // Il clock del sandbox è Date.now() (tests/harness.mjs): performance.now() del
  // processo di test vive in un altro dominio e farebbe scattare subito il gate.
  s.speedFusMs = 20; s.speedGpsMs = 20; s.speedGpsT = Date.now();
  for (let i = 0; i < 5; i++) step();
  assert.ok(Number.isFinite(s.leanKin), 'atteso un numero, ottenuto ' + s.leanKin);
  assert.ok(Math.abs(s.leanKin) > 1, 'piega cinematica attesa non nulla, ottenuto ' + s.leanKin);

  s.speedGpsT = Date.now() - (api.SPEED_STALE_MS + 1);
  step();
  assert.equal(s.leanKin, null);
});
