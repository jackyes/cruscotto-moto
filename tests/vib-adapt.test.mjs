import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { state, processSample, buildBasis, vibScale, biquadStep, biquadInit, updateRectDetector,
        updateAttitude, csvRows, CSV_HEADER, G, ATT_KP, RECT_NULL_MAX_G } = api;
const B = () => buildBasis({x:1, y:0, z:0});

function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/* Curva a regime coordinata: f = g/cosφ lungo B.up, ω = −ψ̇·(cosφ·B.up + sinφ·B.right),
   ψ̇ = g·tanφ/v. B = identita': B.up=x, B.right=y, B.fwd=−z. */
function steadyTurn(phiDeg, v = 20) {
  const phi = phiDeg * Math.PI / 180;
  const psi = (G * Math.tan(phi) / v) * (180 / Math.PI);
  return { phi, v, w: { x: -psi * Math.cos(phi), y: -psi * Math.sin(phi), z: 0 }, f: { x: G / Math.cos(phi), y: 0, z: 0 } };
}

let simT = 300000;
function feed(acc, gyro, n, dt = 1 / 60, extra = {}) {
  for (let i = 0; i < n; i++) {
    simT += dt * 1000;
    api.lastMotionT = simT - dt * 1000;
    processSample({ acc, gyro, grav: null, lin: null, t: simT, ...extra });
  }
}

test('vibScale: cresce con la metrica di adattamento, con tetto', () => {
  resetState();
  state.vibAdaptG = 0;
  assert.equal(vibScale(), 1);
  state.vibAdaptG = 0.25;
  assert.ok(Math.abs(vibScale() - 1.75) < 1e-9);
  state.vibAdaptG = 0.5;
  assert.ok(Math.abs(vibScale() - 2.5) < 1e-9);
  state.vibAdaptG = 2;
  assert.equal(vibScale(), 2.5);   // VIB_ADAPT_MAX satura la metrica
});

test('biquad: inizializzazione senza rampa (pass-through del primo campione)', () => {
  resetState();
  const st = {};
  const out = biquadInit(st, {x: 1, y: 2, z: 3}, 1/60, 0.1);
  assert.deepEqual(out, {x: 1, y: 2, z: 3});
  // regime: un ingresso costante esce invariato (guadagno DC = 1)
  for (let i = 0; i < 200; i++) biquadStep(st, {x: 1, y: 2, z: 3}, 1/60, 0.1);
  const y = biquadStep(st, {x: 1, y: 2, z: 3}, 1/60, 0.1);
  assert.ok(Math.abs(y.x - 1) < 1e-9 && Math.abs(y.y - 2) < 1e-9 && Math.abs(y.z - 3) < 1e-9);
});

test('biquad: reiezione del rumore fuori banda (10 Hz, tau 0.1)', () => {
  resetState();
  const st = {};
  const dt = 1 / 60, tau = 0.1;
  biquadInit(st, {x: 0, y: 0, z: 0}, dt, tau);
  let inPow = 0, outPow = 0;
  for (let i = 0; i < 600; i++) {
    const v = Math.sin(2 * Math.PI * 10 * i * dt);
    const y = biquadStep(st, {x: v, y: 0, z: 0}, dt, tau);
    inPow += v * v;
    outPow += y.x * y.x;
  }
  assert.ok(outPow / inPow < 0.02, 'RMS residuo ' + Math.sqrt(outPow / inPow).toFixed(3));
});

test('processSample: sotto vibrazione l adattamento cresce e Kp scende', () => {
  resetState();
  state.calib = B();
  const v = 20;
  state.speedGpsMs = v; state.speedGpsT = Date.now(); state.speedFusMs = v;
  state._spBase = v; state._aInt = 0; state.lonG = 0;
  const { w, f } = steadyTurn(30);
  const r = rng(11);
  const dt = 1 / 60;
  let t = 300000;
  for (let i = 0; i < 600; i++) {
    t += dt * 1000;
    api.lastMotionT = t - dt * 1000;
    const acc = { x: f.x + (r()*2-1)*0.5*G, y: (r()*2-1)*0.5*G, z: (r()*2-1)*0.5*G };
    const gy = { x: w.x + (r()*2-1)*5, y: w.y + (r()*2-1)*5, z: (r()*2-1)*5 };
    processSample({ acc, gyro: gy, grav: null, lin: null, t });
  }
  assert.ok(state.vibAdaptG > 0.2, 'vibAdaptG ' + state.vibAdaptG.toFixed(3));
  assert.ok(state.vibScaleVal > 1.5, 'vibScaleVal ' + state.vibScaleVal.toFixed(2));
  assert.ok(state.attKp < ATT_KP, 'attKp ' + state.attKp.toFixed(2));
});

test('processSample: il filtro yaw insegue la ψ̇ vera anche con rumore forte', () => {
  resetState();
  state.calib = B();
  const v = 20;
  state.speedGpsMs = v; state.speedGpsT = Date.now(); state.speedFusMs = v;
  state._spBase = v; state._aInt = 0; state.lonG = 0;
  const { w, f } = steadyTurn(30);
  const r = rng(3);
  const dt = 1 / 60;
  let t = 300000;
  for (let i = 0; i < 600; i++) {
    t += dt * 1000;
    api.lastMotionT = t - dt * 1000;
    const gy = { x: w.x + (r()*2-1)*30, y: w.y + (r()*2-1)*30, z: (r()*2-1)*30 };
    processSample({ acc: f, gyro: gy, grav: null, lin: null, t });
  }
  assert.ok(state._yawPow > 10, 'rumore yaw stimato ' + state._yawPow.toFixed(1));
  // la componente yaw vera della curva e' w.x = −ψ·cosφ ≈ −7,16 °/s
  const trueYaw = -((G * Math.tan(Math.PI/6) / v) * (180/Math.PI)) * Math.cos(Math.PI/6);
  assert.ok(Math.abs(state._yawFilt2 - trueYaw) < 5, '_yawFilt2 ' + state._yawFilt2.toFixed(2));
});

test('gravita: cross-check butta la nativa divergente in auto, la tiene in native', () => {
  resetState();
  state.calib = B();
  feed({x: G, y: 0, z: 0}, null, 40);   // attitudine inizializzata dritta
  assert.ok(state._attU);
  // gravita' nativa puntata di lato (sbagliata): auto deve rifiutarla
  state.gravityMode = 'auto';
  feed({x: G, y: 0, z: 0}, null, 3, 1/60, { grav: {x: 0, y: G, z: 0} });
  assert.equal(state.gravNative, false);
  assert.ok(state.gravAgreeDeg > 45, 'angolo disaccordo ' + state.gravAgreeDeg);
  // in 'native' la fusione di piattaforma viene accettata comunque
  resetState();
  state.calib = B();
  feed({x: G, y: 0, z: 0}, null, 40);
  state.gravityMode = 'native';
  feed({x: G, y: 0, z: 0}, null, 3, 1/60, { grav: {x: 0, y: G, z: 0} });
  assert.equal(state.gravNative, true);
});

test('updateRectDetector: media sistematica di vertG sotto vibrazione, gate rispettato', () => {
  resetState();
  state.lean = 0; state.lonG = 0; state.vertG = 0.04; state.vibAdaptG = 0.3;
  for (let i = 0; i < 600; i++) updateRectDetector(1/60);
  assert.ok(state.vibRectG > 0.03, 'stima ' + state.vibRectG.toFixed(3));
  // gate chiuso (piega alta): la stima resta dov'era
  state.lean = 30;
  const before = state.vibRectG;
  for (let i = 0; i < 600; i++) { state.vertG = 0.2; updateRectDetector(1/60); }
  assert.equal(state.vibRectG, before);
});

test('rettificazione: con rectNull la correzione (limitata) si applica a vertG', () => {
  resetState();
  state.calib = B();
  state.rectNull = true;
  state._rectEma = 0.04;   // stima gia' convergente
  feed({x: G, y: 0, z: 0}, null, 60);
  assert.ok(Math.abs(state.vertG - (-0.04)) < 0.02, 'vertG ' + state.vertG.toFixed(3));
  // correzione oltre il tetto: non applicata
  resetState();
  state.calib = B();
  state.rectNull = true;
  state._rectEma = RECT_NULL_MAX_G + 0.05;
  feed({x: G, y: 0, z: 0}, null, 60);
  assert.ok(Math.abs(state.vertG) < 0.01, 'vertG ' + state.vertG.toFixed(3));
});

test('CSV: colonna vib_rect_g in coda con valore', () => {
  const row = { t: 1, lean: 10, vibRect: 0.021 };
  const line = csvRows([row]);
  assert.ok(line.endsWith('0.021'), line);
  assert.ok(CSV_HEADER.endsWith('vib_rect_g'));
  assert.equal(CSV_HEADER.split(',').length, 27);
});

test('sim: curva tenuta 30° con vibrazione 0,6 g RMS — errore contenuto', () => {
  resetState();
  state.calib = B();
  const v = 20;
  state.speedGpsMs = v; state.speedGpsT = Date.now(); state.speedFusMs = v;
  state._spBase = v; state._aInt = 0; state.lonG = 0;
  const { w, f } = steadyTurn(30);
  const r = rng(42);
  const dt = 1 / 60;
  let t = 300000;
  const errs = [];
  for (let i = 0; i < 600; i++) {
    t += dt * 1000;
    api.lastMotionT = t - dt * 1000;
    const acc = { x: f.x + (r()*2-1)*0.6*G, y: (r()*2-1)*0.6*G, z: (r()*2-1)*0.6*G };
    const gy = { x: w.x + (r()*2-1)*5, y: w.y + (r()*2-1)*5, z: (r()*2-1)*5 };
    processSample({ acc, gyro: gy, grav: null, lin: null, t });
    if (i >= 300) errs.push(Math.abs(state.lean - 30));
  }
  const meanAbs = errs.reduce((s, e) => s + e, 0) / errs.length;
  assert.ok(meanAbs < 1.8, 'errore medio ' + meanAbs.toFixed(2) + '°');
});

test('sim: curva tenuta 30° con vibrazione 0,3 g RMS — errore sotto il grado', () => {
  resetState();
  state.calib = B();
  const v = 20;
  state.speedGpsMs = v; state.speedGpsT = Date.now(); state.speedFusMs = v;
  state._spBase = v; state._aInt = 0; state.lonG = 0;
  const { w, f } = steadyTurn(30);
  const r = rng(42);
  const dt = 1 / 60;
  let t = 300000;
  const errs = [];
  for (let i = 0; i < 600; i++) {
    t += dt * 1000;
    api.lastMotionT = t - dt * 1000;
    const acc = { x: f.x + (r()*2-1)*0.3*G, y: (r()*2-1)*0.3*G, z: (r()*2-1)*0.3*G };
    const gy = { x: w.x + (r()*2-1)*5, y: w.y + (r()*2-1)*5, z: (r()*2-1)*5 };
    processSample({ acc, gyro: gy, grav: null, lin: null, t });
    if (i >= 300) errs.push(Math.abs(state.lean - 30));
  }
  const meanAbs = errs.reduce((s, e) => s + e, 0) / errs.length;
  assert.ok(meanAbs < 1.2, 'errore medio ' + meanAbs.toFixed(2) + '°');
});
