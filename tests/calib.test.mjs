import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { state, collectCalib, finishCalibration } = api;

/* Prepara lo stato come se startCalibration() fosse già partito (senza il
   setTimeout da 2 s), con una moto ferma e dritta. */
function seedCalibClean() {
  state._calPending = true;
  state._calSum = { x: 0, y: 0, z: 0 };
  state._calN = 0;
  state._calSamples = [];
  state._calBadN = 0;
  state._calRotSum = 0;
  state._lastUp = { x: 0, y: 0, z: 1 };
  state.hasGyro = true;
  state.gyroRoll = 0;
  state.gyroYaw = 0;
  state.gRatio = 1;
}

test('calibrazione: accetta una finestra pulita (fermo e dritto)', () => {
  resetState();
  seedCalibClean();
  for (let i = 0; i < 50; i++) collectCalib();
  finishCalibration(null);
  assert.ok(state.calib, 'calibrazione accettata');
  assert.ok(state.calib.up && state.calib.fwd && state.calib.right, 'base ortonormale completa');
  assert.equal(state.calib.v, 2);
});

test('calibrazione: rifiuta se la moto si muove (rotazione media oltre soglia)', () => {
  resetState();
  seedCalibClean();
  state.gyroRoll = 6;   // > CALIB_MAX_MEAN_ROT (1.0 °/s): piega sistematica
  for (let i = 0; i < 50; i++) collectCalib();
  finishCalibration(null);
  assert.equal(state.calib, null, 'calibrazione rifiutata per movimento');
});

test('calibrazione: rifiuta se i campioni sono dispersi (telefono che si inclina)', () => {
  resetState();
  seedCalibClean();
  for (let i = 0; i < 25; i++) { state._lastUp = { x: 0, y: 0, z: 1 }; collectCalib(); }
  for (let i = 0; i < 25; i++) { state._lastUp = { x: 0, y: 1, z: 0 }; collectCalib(); }
  finishCalibration(null);
  assert.equal(state.calib, null, 'calibrazione rifiutata per dispersione');
});

test('calibrazione: dati insufficienti senza campioni', () => {
  resetState();
  seedCalibClean();
  finishCalibration(null);
  assert.equal(state.calib, null);
});
