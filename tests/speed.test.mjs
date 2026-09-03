import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { state, pushSpeedHist, aIntAt, propagateSpeed, correctSpeed, updateGpsAccel, updateAccelFusion, G } = api;

test('aIntAt: interpolazione lineare della storia', () => {
  resetState();
  pushSpeedHist(1000, 0);
  pushSpeedHist(1100, 10);
  pushSpeedHist(1200, 20);
  assert.equal(aIntAt(1050), 5);
  assert.equal(aIntAt(1000), 0);
  assert.equal(aIntAt(1150), 15);
  assert.equal(aIntAt(900), 0);
  assert.equal(aIntAt(1300), 20);
});

test('propagateSpeed: integra e applica il clamp', () => {
  resetState();
  state.speedGpsT = 1000;
  state.speedGpsMs = 10;
  state._spBase = 10;
  state._aInt = 0;
  state.lonG = 1;
  propagateSpeed(0.1, 2000);
  assert.ok(Math.abs(state.speedFusMs - 10.98) < 0.01);
});

test('propagateSpeed: si congela senza fix fresco', () => {
  resetState();
  state.speedGpsT = 1000;
  state._spBase = 10;
  state._aInt = 5;
  state.lonG = 1;
  propagateSpeed(0.1, 6000);
  assert.equal(state._aInt, 5);
  assert.equal(state.speedFusMs, 0);
});

test('correctSpeed: riancoraggio con compensazione del ritardo', () => {
  resetState();
  state._aInt = 5;
  state._spHist = [{t:0, a:0}, {t:1000, a:2}];
  correctSpeed(20, 1600);
  assert.equal(state.speedFusMs, 23);
});

test('updateGpsAccel: accelerazione longitudinale da dv/dt', () => {
  resetState();
  state._pvT = 10;
  state._pv = 10;
  updateGpsAccel({speed: 12, heading: null}, 11000);
  assert.ok(Math.abs(state.lonGps - 2/G) < 1e-9);
  assert.equal(state._pv, 12);
  assert.equal(state._pvT, 11);
});

test('updateAccelFusion: complementare inerziale + GPS', () => {
  resetState();
  state._lpLat = 0.2;
  state._lpLatGps = 0.1;
  state.latG = 0.5;
  updateAccelFusion(0.05);
  const a = 0.05 / 1.55;
  const lp = 0.2 + a * 0.3;
  assert.ok(Math.abs(state.latFus - ((0.5 - lp) + 0.1)) < 1e-9);
});
