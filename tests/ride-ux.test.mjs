import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { guidaActive, state, saveSettings, loadSettings, CAM_LEGAL_MSG } = api;

test('guidaActive: log, nav, velocità, toggle', () => {
  resetState();
  assert.equal(guidaActive(), false);
  state.logging = true;
  assert.equal(guidaActive(), true);
  resetState();
  state.nav = { status: 'ACTIVE' };
  assert.equal(guidaActive(), true);
  resetState();
  state.nav = { status: 'OFF_MANUAL' };
  assert.equal(guidaActive(), false);
  state.speedKph = 15;
  assert.equal(guidaActive(), true);
  resetState();
  state.speedKph = 14.9;
  assert.equal(guidaActive(), false);
  state.guidaAlways = true;
  assert.equal(guidaActive(), true);
});

test('settings: camLegalOk / guidaAlways persistono', () => {
  resetState();
  state.camLegalOk = true;
  state.guidaAlways = true;
  saveSettings();
  resetState();
  loadSettings();
  assert.equal(state.camLegalOk, true);
  assert.equal(state.guidaAlways, true);
  assert.ok(CAM_LEGAL_MSG.includes('OpenStreetMap'));
  resetState();
  saveSettings();
});
