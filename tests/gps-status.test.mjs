// Stato GPS: "perso" quando i fix smettono, permesso negato, riavvio del watch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { api, resetState, vmSandbox } from './harness.mjs';

const { state, els } = api;
const s = vmSandbox;
const { gpsLostSeconds, gpsStatusView, mapHudModel, onGeolocationErr, gpsWatchdog, updateGpsStatus } = s;
// const del modulo: binding lessicale, non proprietà del globale della sandbox.
const GPS_RESTART_MS = vm.runInContext('GPS_RESTART_MS', s);
const setWatchId = v => vm.runInContext('watchId = ' + JSON.stringify(v), s);
const getWatchId = () => vm.runInContext('watchId', s);

function withFix(t) {
  resetState();
  state.gpsStatus = 'ok';
  state.gpsFixT = t;
  state.gps.acc = 4;
  return state;
}

test('gpsLostSeconds: null finché i fix arrivano, secondi dopo 3 s di silenzio', () => {
  withFix(1000);
  assert.equal(gpsLostSeconds(state, 1000 + 2999), null);
  assert.equal(gpsLostSeconds(state, 1000 + 3000), 3);
  assert.equal(gpsLostSeconds(state, 1000 + 12500), 12);
  // Mai perso senza un primo fix, in demo o con stato diverso da ok.
  state.gpsFixT = 0;
  assert.equal(gpsLostSeconds(state, 1e9), null);
  withFix(1000); state.demo = true;
  assert.equal(gpsLostSeconds(state, 1e9), null);
  withFix(1000); state.gpsStatus = 'waiting';
  assert.equal(gpsLostSeconds(state, 1e9), null);
});

test('gpsStatusView: ok, perso (s poi min), negato, errore, attesa, demo', () => {
  withFix(0);
  assert.deepEqual({ ...gpsStatusView(state) }, { cls: 'ok', txt: 'GPS ok (±4m)' });
  state.gpsLostS = 12;
  assert.deepEqual({ ...gpsStatusView(state) }, { cls: 'wait', txt: 'GPS perso · 12 s' });
  state.gpsLostS = 150;
  assert.equal(gpsStatusView(state).txt, 'GPS perso · 2 min');
  resetState(); state.gpsStatus = 'err'; state.gpsDenied = true;
  assert.deepEqual({ ...gpsStatusView(state) }, { cls: 'err', txt: 'GPS negato' });
  state.gpsDenied = false;
  assert.equal(gpsStatusView(state).txt, 'GPS errore');
  resetState();
  assert.equal(gpsStatusView(state).txt, 'GPS attesa');
  state.demo = true;
  assert.equal(gpsStatusView(state).txt, 'GPS demo');
});

test('updateGpsStatus: header e velocità spenta quando il GPS è perso', () => {
  const cls = new Set();
  els.speedVal.classList = { toggle(c, on) { if (on) cls.add(c); else cls.delete(c); }, contains: c => cls.has(c) };
  withFix(Date.now() - 20000);
  updateGpsStatus();
  assert.equal(els.gpsDot.className, 'status-dot wait');
  assert.equal(els.gpsTxt.textContent, 'GPS perso · 20 s');
  assert.ok(cls.has('stale'), 'velocità congelata non segnalata');
  withFix(Date.now());
  updateGpsStatus();
  assert.equal(els.gpsDot.className, 'status-dot ok');
  assert.ok(!cls.has('stale'));
});

test('HUD mappa: gps-lost con PERSO e i secondi; negato distinto da errore', () => {
  const base = { demo: false, calib: null, lean: 0, leanConf: 1, speedKph: 80, speedLimit: null,
    session: { maxLeanL: 0, maxLeanR: 0, distKm: 0 }, gps: { acc: 5 } };
  const lost = mapHudModel({ ...base, gpsStatus: 'ok', gpsLostS: 7 }, null);
  assert.match(lost.cls, / gps-lost$/);
  assert.equal(lost.gps, 'PERSO 7s');
  assert.equal(mapHudModel({ ...base, gpsStatus: 'ok', gpsLostS: 125 }, null).gps, 'PERSO 2min');
  assert.match(mapHudModel({ ...base, gpsStatus: 'ok', gpsLostS: null }, null).cls, / gps-ok$/);
  assert.equal(mapHudModel({ ...base, gpsStatus: 'err', gpsDenied: true }, null).gps, 'GPS NEGATO');
  assert.equal(mapHudModel({ ...base, gpsStatus: 'err' }, null).gps, 'NO GPS');
});

test('onGeolocationErr: timeout non è un errore, permesso negato avvisa una volta', () => {
  const toasts = [];
  const orig = s.toast;
  s.toast = (m, k) => { toasts.push(m); return { remove() {} }; };
  try {
    withFix(Date.now());
    onGeolocationErr({ code: 3 });
    assert.equal(state.gpsStatus, 'ok', 'timeout in galleria: resta ok, lo dice "perso"');
    onGeolocationErr({ code: 2 });
    assert.equal(state.gpsStatus, 'err');
    assert.equal(state.gpsDenied, false);
    onGeolocationErr({ code: 1 });
    onGeolocationErr({ code: 1 });
    assert.equal(state.gpsDenied, true);
    assert.equal(toasts.filter(m => /Posizione negata/.test(m)).length, 1, 'avviso ripetuto');
    onGeolocationErr(undefined);   // browser vecchi: nessun oggetto errore
    assert.equal(state.gpsStatus, 'err');
  } finally { s.toast = orig; }
});

test('gpsWatchdog: riavvia il watch dopo 30 s senza fix, non più di una volta ogni 30 s', () => {
  let next = 100;
  const cleared = [];
  s.navigator = { geolocation: { watchPosition: () => ++next, clearWatch: id => cleared.push(id) } };
  try {
    withFix(1000);
    setWatchId(7);
    assert.equal(gpsWatchdog(1000 + GPS_RESTART_MS - 1), false, 'troppo presto');
    assert.equal(gpsWatchdog(1000 + GPS_RESTART_MS), true);
    assert.deepEqual(cleared, [7]);
    assert.equal(getWatchId(), 101);
    assert.equal(gpsWatchdog(1000 + GPS_RESTART_MS + 1000), false, 'riavvio a raffica');
    assert.equal(gpsWatchdog(1000 + 2 * GPS_RESTART_MS), true);
    // Mai senza un primo fix (avvio a freddo), con permesso negato, in demo o senza watch.
    for (const setup of [
      () => { state.gpsFixT = 0; },
      () => { state.gpsDenied = true; },
      () => { state.demo = true; },
      () => { setWatchId(null); },
    ]) {
      withFix(1000); setWatchId(7); setup();
      assert.equal(gpsWatchdog(1e9), false);
    }
  } finally { s.navigator = {}; setWatchId(null); }
});
