import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { state, attitudeReference, processSample, buildBasis, leanFromUp, G } = api;
const B = () => buildBasis({x:1, y:0, z:0});

// Curva a regime coordinata: lean φ, velocità v.
//  - accelerometro (forza specifica) = g/cosφ lungo B.up (il risultante è ⟂ al telaio)
//  - giroscopio ω = -ψ̇·(cosφ·B.up + sinφ·B.right), con ψ̇ = g·tanφ / v
function steadyTurn(phiDeg, v = 20) {
  const phi = phiDeg * Math.PI / 180;
  const psi = (G * Math.tan(phi) / v) * (180 / Math.PI); // °/s (positivo per destra)
  const w = { x: -psi * Math.cos(phi), y: -psi * Math.sin(phi), z: 0 }; // °/s
  const f = { x: G / Math.cos(phi), y: 0, z: 0 }; // m/s²
  return { phi, v, w, f };
}

test('attitudeReference: compensazione centripeta in curva a regime', () => {
  resetState();
  const { phi, v, w, f } = steadyTurn(30);
  state.speedFusMs = v;
  state.speedGpsT = Date.now();
  state.hasGyro = true;
  state.speedGpsMs = v;
  const R = attitudeReference(f, w, B(), 0.05);
  assert.equal(R.mode, 'centrip');
  assert.ok(Math.abs(R.trust - 1) < 1e-9, 'trust atteso 1, ottenuto ' + R.trust);
  // il riferimento compensato deve essere la verticale vera: {cosφ, sinφ, 0}
  assert.ok(Math.abs(R.u.x - Math.cos(phi)) < 1e-6);
  assert.ok(Math.abs(R.u.y - Math.sin(phi)) < 1e-6);
  assert.ok(Math.abs(leanFromUp(R.u, B()) - 30) < 1e-3);
});

test('attitudeReference: senza compensazione il grezzo legge ~0 in curva', () => {
  resetState();
  const { v, w, f } = steadyTurn(30);
  state.speedFusMs = v;
  state.speedGpsT = 0; // GPS assente → nessuna compensazione
  state.hasGyro = true;
  state.speedGpsMs = v;
  const R = attitudeReference(f, w, B(), 0.05);
  assert.equal(R.mode, 'raw');
  // accelerometro grezzo = g/cosφ lungo B.up → piega ~0
  assert.ok(Math.abs(leanFromUp(R.u, B())) < 1e-3, 'grezzo: ' + leanFromUp(R.u, B()));
});

function runTurn(phiDeg) {
  resetState();
  const { v, w, f } = steadyTurn(phiDeg);
  state.calib = B();
  state.speedGpsMs = v;
  state.speedGpsT = Date.now();
  state.speedFusMs = v;
  state._spBase = v;
  state._aInt = 0;
  state.lonG = 0;
  let t = 300000;
  for (let i = 0; i < 60; i++) {
    t += 50;
    api.lastMotionT = t - 50;
    processSample({ acc: f, gyro: w, grav: null, lin: null, t });
  }
  return state.lean;
}

test('processSample: curva a regime a destra converge alla piega vera', () => {
  const lean = runTurn(30);
  assert.ok(Math.abs(lean - 30) < 1.0, 'lean atteso ~30, ottenuto ' + lean);
});

test('processSample: curva a regime a sinistra converge alla piega vera', () => {
  const lean = runTurn(-30);
  assert.ok(Math.abs(lean - (-30)) < 1.0, 'lean atteso ~-30, ottenuto ' + lean);
});
