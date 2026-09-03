import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { state, attitudeReference, updateAttitude, processSample, buildBasis, leanFromUp,
        vscale, vlen, vdot, vcross, vsub, G } = api;

const B = () => buildBasis({x:1, y:0, z:0});

test('attitudeReference: raw da fermo', () => {
  resetState();
  const b = B();
  const R = attitudeReference({x:G, y:0, z:0}, {x:0,y:0,z:0}, b, 0.05);
  assert.equal(R.mode, 'raw');
  assert.ok(Math.abs(R.trust - 1) < 1e-9);
  assert.ok(Math.abs(R.u.x - 1) < 1e-9);
  assert.ok(Math.abs(R.u.y) < 1e-9);
});

test('attitudeReference: ramo norm senza GPS', () => {
  resetState();
  state.speedFusMs = 20;
  state.lonG = 0;
  state.latGps = -0.1;
  state.hasGyro = false;
  const b = B();
  const f = vscale(b.up, G / Math.cos(Math.PI/6));
  const R = attitudeReference(f, {x:0,y:0,z:0}, b, 0.05);
  assert.equal(R.mode, 'norm');
  assert.ok(Math.abs(R.trust - 0.3) < 1e-12);
  assert.ok(Math.abs(R.u.x - Math.cos(Math.PI/6)) < 1e-6);
  assert.ok(Math.abs(R.u.y - (-Math.sin(Math.PI/6))) < 1e-6);
  assert.ok(Math.abs(leanFromUp(R.u, b) - (-30)) < 1e-6);
});

test('attitudeReference: compensazione centripeta', () => {
  resetState();
  state.speedFusMs = 10;
  state.speedGpsT = Date.now();
  state.hasGyro = true;
  state.speedGpsMs = 10;
  const b = B();
  const R = attitudeReference({x:1,y:2,z:3}, {x:4,y:5,z:6}, b, 0.05);
  assert.equal(R.mode, 'centrip');
  assert.equal(R.trust, 0);
  const wr = {x:4*Math.PI/180, y:5*Math.PI/180, z:6*Math.PI/180};
  const c = vcross(wr, b.fwd);
  const ref = vsub({x:1,y:2,z:3}, vscale(c, 10));
  const m = vlen(ref);
  assert.ok(Math.abs(R.u.x - ref.x/m) < 1e-3);
  assert.ok(Math.abs(R.u.y - ref.y/m) < 1e-3);
  assert.ok(Math.abs(R.u.z - ref.z/m) < 1e-3);
});

test('updateAttitude: inizializzazione rifiutata senza storia sufficiente', () => {
  resetState();
  const b = B();
  state._accHist = [{x:G,y:0,z:0}];
  const ok = updateAttitude({x:G,y:0,z:0}, {x:0,y:0,z:0}, b, 0.05);
  assert.equal(ok, false);
  assert.ok(!state._attU);
});

test('processSample: convergenza della piega a destra', () => {
  resetState();
  state.calib = B();
  const c = Math.cos(Math.PI/6), s = Math.sin(Math.PI/6);
  const acc = {x: c*G, y: s*G, z: 0};
  let t = 100000;
  for (let i = 0; i < 40; i++) {
    t += 50;
    api.lastMotionT = t - 50;
    processSample({acc, gyro: null, grav: null, lin: null, t});
  }
  assert.ok(Math.abs(state.lean - 30) < 1.0, 'lean atteso ~30, ottenuto ' + state.lean);
});

test('processSample: convergenza della piega a sinistra', () => {
  resetState();
  state.calib = B();
  const c = Math.cos(Math.PI/6), s = Math.sin(Math.PI/6);
  const acc = {x: c*G, y: -s*G, z: 0};
  let t = 200000;
  for (let i = 0; i < 40; i++) {
    t += 50;
    api.lastMotionT = t - 50;
    processSample({acc, gyro: null, grav: null, lin: null, t});
  }
  assert.ok(Math.abs(state.lean - (-30)) < 1.0, 'lean atteso ~-30, ottenuto ' + state.lean);
});
