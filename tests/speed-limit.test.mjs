import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';

const { parseMaxspeed, pickNearestMaxspeed, speedLimitDue, fetchSpeedLimit, state } = api;
const s = vmSandbox;

test('parseMaxspeed: numeri, mph, scarti', () => {
  assert.equal(parseMaxspeed('50'), 50);
  assert.equal(parseMaxspeed('70'), 70);
  assert.equal(parseMaxspeed('50 mph'), 80);
  assert.equal(parseMaxspeed('30 mph'), 48);
  assert.equal(parseMaxspeed('50;70'), 50);
  assert.equal(parseMaxspeed('none'), null);
  assert.equal(parseMaxspeed('signals'), null);
  assert.equal(parseMaxspeed('walk'), null);
  assert.equal(parseMaxspeed('IT:urban'), null);
  assert.equal(parseMaxspeed(''), null);
  assert.equal(parseMaxspeed(null), null);
  assert.equal(parseMaxspeed('999'), null);
});

test('pickNearestMaxspeed: way più vicino con maxspeed valido', () => {
  const els = [
    { center: { lat: 45.001, lon: 9 }, tags: { maxspeed: '70' } },
    { center: { lat: 45.0001, lon: 9 }, tags: { maxspeed: '50' } },
    { center: { lat: 45, lon: 9 }, tags: { maxspeed: 'signals' } },
  ];
  assert.equal(pickNearestMaxspeed(els, 45, 9), 50);
  assert.equal(pickNearestMaxspeed([], 45, 9), null);
  assert.equal(pickNearestMaxspeed([{ tags: { maxspeed: '50' } }], 45, 9), null);
});

test('speedLimitDue: throttle tempo/spazio e in-volo', () => {
  resetState();
  const now = 1_000_000;
  assert.equal(speedLimitDue(45, 9, now), true);
  state.speedLimitFetching = true;
  assert.equal(speedLimitDue(45, 9, now), false);
  state.speedLimitFetching = false;
  state.speedLimitPos = { lat: 45, lon: 9 };
  state.speedLimitAt = now;
  assert.equal(speedLimitDue(45, 9, now + 1000), false);
  assert.equal(speedLimitDue(45, 9, now + 16000), true);
  state.speedLimitAt = now;
  assert.equal(speedLimitDue(45.002, 9, now + 1000), true);
  state.speedLimitRetryAfter = now + 50000;
  assert.equal(speedLimitDue(45.002, 9, now + 1000), false);
});

// #11: dopo un errore di rete il limite precedente restava in state per due
// minuti — il badge continuava a mostrare il vecchio "50" con la classe 'over'
// accesa a 75 km/h, in un punto della strada che con quel limite non c'entrava.
test('fetchSpeedLimit: errore di rete → il limite vecchio non resta a schermo', async () => {
  resetState();
  state.speedLimit = 50;                       // noto da un fetch precedente, ormai vecchio
  state.speedLimitAt = Date.now() - 60000;
  state.speedLimitPos = { lat: 45, lon: 9 };
  const orig = s.fetchWithTimeout;
  s.fetchWithTimeout = async () => { throw new Error('offline'); };   // tutti gli host giù
  try {
    await fetchSpeedLimit(45.02, 9);
  } finally {
    s.fetchWithTimeout = orig;
  }
  assert.equal(state.speedLimit, null, 'limite vecchio ancora a schermo dopo un errore');
  assert.ok(state.speedLimitRetryAfter > Date.now(), 'backoff non riarmato');
  assert.equal(state.speedLimitFetching, false, 'in-volo rimasto appeso');
  resetState();
});

test('fetchSpeedLimit: successo → limite aggiornato e backoff azzerato', async () => {
  resetState();
  state.speedLimitRetryAfter = Date.now() + 60000;
  const orig = s.fetchWithTimeout;
  s.fetchWithTimeout = async () => ({
    ok: true,
    json: async () => ({ elements: [{ center: { lat: 45.001, lon: 9 }, tags: { maxspeed: '70' } }] }),
  });
  try {
    await fetchSpeedLimit(45, 9);
  } finally {
    s.fetchWithTimeout = orig;
  }
  assert.equal(state.speedLimit, 70);
  assert.equal(state.speedLimitRetryAfter, 0, 'backoff non azzerato dopo un successo');
  resetState();
});
