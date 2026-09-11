import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { state, collectCalib, finishCalibration, collectAccBias } = api;

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

/* ---- orientamento ignoto durante la finestra di calibrazione ----
   state._calMount (e state.mount) sono chiavi di MOUNT lette da collectCalib e
   dal bias accelerometro. Con una chiave ignota `MOUNT[k]` è undefined e
   `axisVec(latAxis.lat)` lanciava: l'eccezione risaliva dal loop sensori a OGNI
   campione della finestra, quindi la calibrazione non si concludeva mai e lo
   stato restava "in calibrazione" per sempre. 'constructor'/'toString'/'__proto__'
   sono il buco peggiore: NON sono in MOUNT ma MOUNT[k] li trova truthy
   (Object.prototype), quindi un fallback scritto come `MOUNT[k] || …` li lascia
   passare e latAxis.lat resta undefined come senza guardia. */
const MOUNT_GARBAGE = ['garbage', '', undefined, null, 'constructor', 'toString', '__proto__'];

test('collectCalib/finishCalibration: mount ignoto non lancia e calibra col default', () => {
  for (const mount of MOUNT_GARBAGE) {
    resetState();
    seedCalibClean();
    state.mount = mount;
    state._calMount = mount;
    // _wLP non-nullo: senza la proiezione del dondolio sull'asse laterale il
    // ternario corto-circuita e `axisVec(latAxis.lat)` non viene mai valutato —
    // cioè il crash non si vedrebbe. Con _wLP la riga è davvero eseguita.
    state._wLP = { x: 0, y: 0, z: 0.5 };
    assert.doesNotThrow(() => {
      for (let i = 0; i < 50; i++) collectCalib();
      finishCalibration(null);
    }, 'mount ' + String(mount) + ': eccezione nella finestra di calibrazione');
    assert.ok(state.calib && state.calib.up && state.calib.fwd && state.calib.right,
      'mount ' + String(mount) + ': calibrazione non conclusa');
    // Ripiego documentato (MOUNT['landscape-left']): late = 'y', come in sensors-pipe.
    assert.equal(state.calib.v, 2);
  }
  resetState();
});

test('collectAccBias: mount ignoto non lancia (finestra di bias viva)', () => {
  for (const mount of MOUNT_GARBAGE) {
    resetState();
    seedCalibClean();
    state.mount = mount;
    state._calMount = mount;
    state._abPending = true;      // come dopo startAccBiasCapture()
    state.accBias = null;
    state._abSum = { lat: 0, lon: 0, vert: 0 };
    state._abN = 0;
    state._abT = 0;
    state.latG = 0; state.lonG = 0; state.vertG = 0;
    state._wLP = { x: 0, y: 0, z: 0.5 };   // come sopra: serve il ramo con axisVec(latAxis.lat)
    assert.doesNotThrow(() => {
      for (let i = 0; i < 80; i++) collectAccBias(1 / 60);
    }, 'mount ' + String(mount) + ': eccezione nel bias accelerometro');
    assert.ok(state.accBias, 'mount ' + String(mount) + ': bias non catturato');
  }
  resetState();
});

test('mountKey/mountDef: chiave ignota ripiega sul default, non su Object.prototype', () => {
  for (const k of MOUNT_GARBAGE) {
    assert.equal(api.mountKey(k), 'landscape-left', 'mountKey(' + String(k) + ')');
    assert.equal(api.mountDef(k), api.MOUNT['landscape-left'], 'mountDef(' + String(k) + ')');
  }
  assert.equal(api.mountKey('portrait'), 'portrait');
  assert.equal(api.mountDef('portrait'), api.MOUNT.portrait);
});
