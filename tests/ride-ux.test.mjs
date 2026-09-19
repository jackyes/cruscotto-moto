import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';

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

// ---- HUD della mappa fullscreen ----
const { els, updateMapHud } = api;

// Il body del mock risponde sempre `false` a contains(): l'HUD si aggiorna solo
// in fullscreen, quindi il flag va pilotato a mano.
function setFullscreen(on) {
  vmSandbox.document.body.classList.contains = cls => on && cls === 'map-fullscreen';
}

test('updateMapHud: scrive piega, verso, massimi e velocità solo in fullscreen', () => {
  resetState();
  setFullscreen(false);
  els.mhSpeedVal.textContent = 'intatto';
  state.speedKph = 88;
  updateMapHud();
  assert.equal(els.mhSpeedVal.textContent, 'intatto', 'HUD aggiornato fuori dal fullscreen');

  setFullscreen(true);
  state.calib = { ok: true };
  state.lean = -32.4;
  state.session.maxLeanL = -41.6;
  state.session.maxLeanR = 37.2;
  updateMapHud();
  assert.equal(els.mhSpeedVal.textContent, '88');
  assert.equal(els.mhLeanVal.textContent, '32');
  assert.equal(els.mhLeanDir.className, 'mh-dir left');
  assert.equal(els.mhMaxL.textContent, '42°');
  assert.equal(els.mhMaxR.textContent, '37°');

  state.lean = 12.5;
  updateMapHud();
  assert.equal(els.mhLeanDir.className, 'mh-dir right');

  // Senza calibrazione la piega non è misurata: placeholder, non uno zero finto.
  state.calib = null;
  state.demo = false;
  updateMapHud();
  assert.equal(els.mhLeanVal.textContent, '--');
  setFullscreen(false);
  resetState();
});
