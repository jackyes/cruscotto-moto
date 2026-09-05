import { test } from 'node:test';
import assert from 'node:assert';
import { api, vmSandbox } from './harness.mjs';

const { requestVideoFallback, clearVideoTimers, trackVideoTimer } = api;

function fakePre() { return { rows: [], track: [] }; }

test('requestVideoFallback: 5 trigger sequenziali -> 1 solo 2D', () => {
  let starts = 0;
  vmSandbox.startVideoRender2D = () => { starts++; };
  vmSandbox.toast = () => {};
  const job = { cancelled: false };
  const reasons = ['a', 'b', 'c', 'd', 'e'];
  let oks = 0;
  for (const r of reasons) if (requestVideoFallback(fakePre(), job, r)) oks++;
  assert.equal(oks, 1);
  assert.equal(starts, 1);
});

test('requestVideoFallback: cancelled -> 0 fallback', () => {
  let starts = 0;
  vmSandbox.startVideoRender2D = () => { starts++; };
  vmSandbox.toast = () => {};
  const job = { cancelled: true };
  assert.equal(requestVideoFallback(fakePre(), job, 'x'), false);
  assert.equal(starts, 0);
});

test('requestVideoFallback: senza job ma videoJob cancelled -> false', () => {
  let starts = 0;
  vmSandbox.startVideoRender2D = () => { starts++; };
  vmSandbox.toast = () => {};
  vmSandbox.videoJob = { cancelled: true };
  try {
    assert.equal(requestVideoFallback(fakePre(), null, 'x'), false);
    assert.equal(starts, 0);
  } finally {
    vmSandbox.videoJob = null;
  }
});

test('clearVideoTimers: registra e svuota la lista timer', () => {
  const job = {};
  assert.equal(trackVideoTimer(job, 11), 11);
  trackVideoTimer(job, 22);
  assert.deepEqual(job._timers, [11, 22]);
  clearVideoTimers(job);
  assert.deepEqual(job._timers, []);
});

test('clearVideoTimers: job senza timer non lancia', () => {
  assert.doesNotThrow(() => clearVideoTimers(null));
  assert.doesNotThrow(() => clearVideoTimers({}));
});
