// Bias del giroscopio misurato da fermi (gyroBiasStillStep, js/sensors-pipe.js).
// Il bias attorno alla verticale non si impara dalla gravità ed entra dritto nella
// compensazione centripeta (piega ≈ atan(v·ω/g)): da fermi si misura e si toglie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox as sb } from './harness.mjs';

const { state, processSample, buildBasis, G } = api;
const now = () => sb.performance.now();          // orologio della sandbox (speedGpsT)
const B = () => buildBasis({ x: 1, y: 0, z: 0 }); // up = x, right = y, fwd = −z
function rng(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }

/* Sosta di stopS secondi poi marcia a 20 m/s (curva tenuta a `deg`), bias vero
   `bias` °/s su tutti e tre gli assi, vibrazione `rms` g RMS (rumore uniforme),
   rumore giroscopio ±5 °/s. Errore medio sulla piega da 20 s dopo la partenza. */
function ride({ deg = 0, bias = 0, rms = 0, stopS = 0, seed = 7, moveS = 65, stopSpeed = 0, stopGyro = null, gpsFresh = true }) {
  const v = 20, phi = deg * Math.PI / 180, psi = deg ? (G * Math.tan(phi) / v) * (180 / Math.PI) : 0;
  const w = { x: -psi * Math.cos(phi), y: -psi * Math.sin(phi), z: 0 }, f = { x: G / Math.cos(phi), y: 0, z: 0 };
  resetState(); state.calib = B();
  const r = rng(seed), amp = rms * Math.sqrt(3);
  let t = 300000, s = 0, n = 0;
  for (let i = 0; i < (stopS + moveS) * 60; i++) {
    const moving = i >= stopS * 60;
    t += 1000 / 60; api.lastMotionT = t - 1000 / 60;
    if (i % 60 === 0 && (moving || gpsFresh)) { state.speedGpsMs = moving ? v : stopSpeed; state.speedGpsT = now(); }
    if (i === stopS * 60) { state.speedFusMs = v; state._spBase = v; state._aInt = 0; state.lonG = 0; }
    const ww = moving ? w : (stopGyro ? stopGyro(r) : { x: 0, y: 0, z: 0 });
    const ff = moving ? f : { x: G, y: 0, z: 0 };
    const gn = () => (r() * 2 - 1) * 5;
    processSample({
      acc: { x: ff.x + (r() * 2 - 1) * amp * G, y: (r() * 2 - 1) * amp * G, z: (r() * 2 - 1) * amp * G },
      gyro: { x: ww.x + bias + gn(), y: ww.y + bias + gn(), z: ww.z + bias + gn() }, grav: null, lin: null, t,
    });
    if (moving && i >= (stopS + 20) * 60) { s += Math.abs(state.lean - (moving ? deg : 0)); n++; }
  }
  return { err: n ? s / n : NaN, b: { ...state.gyroBiasStill }, n: state.gyroBiasStillN };
}

test('da fermi misura il bias su tutti e tre gli assi, anche col motore che vibra', () => {
  for (const rms of [0, 0.3]) {
    const r = ride({ bias: 2, rms, stopS: 10, moveS: 1 });
    assert.ok(r.n >= 2, 'finestre di quiete: ' + r.n);
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(r.b[k] - 2) < 0.3, rms + ' g: ' + k + ' = ' + r.b[k].toFixed(2));
  }
});

test('rettilineo con bias 2 °/s: da ~6° a sotto 1° dopo una sosta di 10 s', () => {
  const senza = ride({ bias: 2, stopS: 0 }).err, con = ride({ bias: 2, stopS: 10 }).err;
  assert.ok(senza > 4, 'premessa: senza sosta ' + senza.toFixed(2) + '°');
  assert.ok(con < 1, 'con sosta ' + con.toFixed(2) + '°');
  assert.ok(ride({ bias: 2, rms: 0.3, stopS: 10 }).err < 2.5, 'con vibrazione 0,3 g RMS');
});

test('curva tenuta: dopo la sosta il bias non conta più (errore uguale a bias zero)', () => {
  const b2 = ride({ deg: 30, bias: 2, stopS: 10 }).err, b0 = ride({ deg: 30, bias: 0, stopS: 10 }).err;
  const senza = ride({ deg: 30, bias: 2, stopS: 0 }).err;
  assert.ok(senza > b2 + 3, 'premessa: senza sosta ' + senza.toFixed(2) + '° contro ' + b2.toFixed(2) + '°');
  assert.ok(Math.abs(b2 - b0) < 0.5, 'bias 2: ' + b2.toFixed(2) + '°, bias 0: ' + b0.toFixed(2) + '°');
});

test('nessun falso fermo: in marcia, in galleria, in una curva a passo d\'uomo, col telefono in mano', () => {
  // In marcia (GPS 20 m/s): mai.
  assert.equal(ride({ deg: 30, bias: 1, moveS: 30 }).n, 0);
  // Galleria: velocità "0" ma GPS stantio.
  assert.equal(ride({ bias: 1, stopS: 10, moveS: 1, gpsFresh: false }).n, 0);
  // Manovra a passo d'uomo (GPS 0,3 m/s) girando a 10 °/s: rotazione vera, non bias.
  assert.equal(ride({ bias: 1, stopS: 10, moveS: 1, stopSpeed: 0.3, stopGyro: () => ({ x: 10, y: 0, z: 0 }) }).n, 0);
  // Telefono maneggiato da fermi: rotazioni ampie a media quasi nulla.
  const hand = r => ({ x: (r() * 2 - 1) * 60, y: (r() * 2 - 1) * 60, z: (r() * 2 - 1) * 60 });
  assert.equal(ride({ bias: 1, stopS: 10, moveS: 1, stopGyro: hand }).n, 0);
});

test('il bias da fermi azzera il residuo imparato dal filtro e resta fuori dal segno del giroscopio', () => {
  resetState(); state.calib = B();
  state.attBias = { x: 0.7, y: -0.4, z: 0.2 };
  state.gyroSign = -1;
  let t = 300000;
  for (let i = 0; i < 180; i++) {
    t += 1000 / 60; api.lastMotionT = t - 1000 / 60;
    if (i % 60 === 0) { state.speedGpsMs = 0; state.speedGpsT = now(); }
    processSample({ acc: { x: G, y: 0, z: 0 }, gyro: { x: 1.5, y: -0.5, z: 0.25 }, grav: null, lin: null, t });
  }
  // Stimato negli assi del SENSORE: stesso valore qualunque sia gyroSign.
  assert.ok(state.gyroBiasStillN >= 1);
  assert.ok(Math.abs(state.gyroBiasStill.x - 1.5) < 1e-6 && Math.abs(state.gyroBiasStill.z - 0.25) < 1e-6);
  assert.ok(Math.abs(state.attBias.x) < 0.05, 'residuo del filtro non azzerato: ' + state.attBias.x);
});
