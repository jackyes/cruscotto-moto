import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { parseMaxspeed, pickNearestMaxspeed, speedLimitDue, state } = api;

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
