import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { state, despike, clampG, clamp01, medianWindow, medianAcc, pushAccHist, updateVibration, keepPeak, G } = api;

test('clampG / clamp01', () => {
  assert.equal(clampG(5), 4);
  assert.equal(clampG(-5), -4);
  assert.equal(clampG(2), 2);
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(0.5), 0.5);
});

test('keepPeak: massimo in modulo con segno', () => {
  assert.equal(keepPeak(0, 0.5), 0.5);
  assert.equal(keepPeak(0.5, 0.3), 0.5);
  assert.equal(keepPeak(0.5, -0.7), -0.7);
  assert.equal(keepPeak(0, 0), 0);
});

test('despike: elimina un impulso isolato, preserva un gradino', () => {
  const st = {};
  const o = [despike(st, 0), despike(st, 0), despike(st, 2.0), despike(st, 0)];
  assert.deepEqual(o, [0, 0, 0, 0]);
  const st2 = {};
  const o2 = [despike(st2, 0), despike(st2, 1), despike(st2, 1), despike(st2, 1)];
  assert.deepEqual(o2, [0, 1, 1, 1]);
});

test('medianWindow: finestra basata sulla frequenza reale', () => {
  resetState();
  state.sensorHz = 0;   assert.equal(medianWindow(), 7);
  state.sensorHz = 20;  assert.equal(medianWindow(), 3);
  state.sensorHz = 200; assert.equal(medianWindow(), 9);
  state.sensorHz = 60;  assert.equal(medianWindow(), 7);
});

test('medianAcc: mediana componente per componente', () => {
  resetState();
  state._accHist = [
    {x:1,y:10,z:100},
    {x:3,y:30,z:300},
    {x:2,y:20,z:200},
  ];
  assert.deepEqual(medianAcc(), {x:2,y:20,z:200});
});

test('updateVibration: energia residua rispetto al passa-basso', () => {
  resetState();
  state._accLP = {x: G, y: 0, z: 0};
  updateVibration({x: G, y: G, z: 0}, 0.05);
  assert.ok(Math.abs(state.vibHiG - 1.0) < 1e-9);
  assert.equal(state.vibG, state.vibHiG);
});

test('pushAccHist rispetta la finestra', () => {
  resetState();
  state.sensorHz = 20;
  for (let i = 0; i < 10; i++) pushAccHist({x:i, y:i, z:i});
  assert.equal(state._accHist.length, 3);
});
