// Avvio automatico del log, media in marcia del giro, stato dei pulsanti mappa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { api, resetState, vmSandbox } from './harness.mjs';
import { appSource } from './app-source.mjs';

const { state, els } = api;
const s = vmSandbox;
const C = name => vm.runInContext(name, s);   // const del modulo, non globali
const HOLD = C('AUTO_LOG_HOLD_MS'), REARM = C('AUTO_REARM_MS'), HINT = C('AUTO_STOP_HINT_MS');

/* Pilota autoLogTick con velocità GPS "fresca" a un istante dato. startLog,
   stopLog, toast e confirmToast finti: qui conta solo la decisione. */
function rig() {
  resetState();
  state.autoLog = true;
  const log = { starts: 0, stops: 0, toasts: [], confirms: [] };
  s.startLog = () => { log.starts++; state.logging = true; };
  s.stopLog = async () => { log.stops++; state.logging = false; state._autoArmed = false; };
  s.toast = m => { log.toasts.push(m); return { remove() {} }; };
  s.confirmToast = m => { log.confirms.push(m); return Promise.resolve(log.answer === true); };
  // +T0: speedGpsT = 0 nel codice vuol dire "mai avuta una velocità".
  const T0 = 1000;
  const at = (t, kmh) => {
    if (kmh != null) { state.speedGpsMs = kmh / 3.6; state.speedGpsT = t + T0; }
    s.autoLogTick(t + T0);
  };
  return { log, at };
}
const orig = { startLog: s.startLog, stopLog: s.stopLog, toast: s.toast, confirmToast: s.confirmToast };
const restore = () => Object.assign(s, orig);

test('parte dopo 10 s sopra 20 km/h, non prima; un calo sotto soglia azzera l\'attesa', () => {
  const { log, at } = rig();
  try {
    at(1000, 30);
    at(1000 + HOLD - 1, 30);
    assert.equal(log.starts, 0, 'partito prima dei 10 s');
    at(1000 + HOLD - 500, 15);          // semaforo: si riparte da capo
    at(1000 + HOLD + 100, 30);
    at(1000 + HOLD + 100 + HOLD - 1, 30);
    assert.equal(log.starts, 0);
    at(1000 + HOLD + 100 + HOLD, 30);
    assert.equal(log.starts, 1);
    assert.ok(log.toasts.some(m => /automaticamente/.test(m)));
  } finally { restore(); }
});

test('mai con impostazione spenta, in Demo, a GPS perso o con velocità vecchia', () => {
  for (const setup of [
    () => { state.autoLog = false; },
    () => { state.demo = true; },
    () => { state.gpsLostS = 5; },
  ]) {
    const { log, at } = rig();
    try {
      setup();
      at(0, 50); at(HOLD * 2, 50);
      assert.equal(log.starts, 0);
    } finally { restore(); }
  }
  const { log, at } = rig();
  try {
    at(0, 50);
    s.autoLogTick(1000 + HOLD * 2);     // nessun fix nuovo da 20 s: velocità non fresca
    assert.equal(log.starts, 0);
  } finally { restore(); }
});

test('dopo uno Stop in marcia non riparte; si riarma solo dopo 2 min da fermi', async () => {
  const { log, at } = rig();
  try {
    at(0, 50); at(HOLD, 50);
    assert.equal(log.starts, 1);
    await s.stopLog();                  // Stop premuto andando
    at(HOLD + 1000, 50); at(HOLD * 4, 50);
    assert.equal(log.starts, 1, 'ripartito subito dopo uno Stop manuale');
    let t = HOLD * 5;
    at(t, 0); at(t + REARM - 1, 0);     // fermi, ma non abbastanza
    at(t + REARM - 1 + 100, 50); at(t + REARM + HOLD + 200, 50);
    assert.equal(log.starts, 1);
    t = t + REARM + HOLD * 2;
    at(t, 0); at(t + REARM, 0);         // parcheggio: riarmato
    at(t + REARM + 100, 50); at(t + REARM + 100 + HOLD, 50);
    assert.equal(log.starts, 2);
  } finally { restore(); }
});

test('col log attivo, fermi da 10 min: propone lo Stop una volta; risposta sì lo ferma', async () => {
  const { log, at } = rig();
  try {
    state.logging = true;
    log.answer = true;
    at(0, 0); at(HINT - 1, 0);
    assert.equal(log.confirms.length, 0);
    at(HINT, 0); at(HINT + 5000, 0);
    assert.equal(log.confirms.length, 1, 'proposta ripetuta');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(log.stops, 1);
    // Ripartiti e rifermati: una nuova proposta è lecita.
    state.logging = true;
    at(HINT + 10000, 40); at(HINT + 20000, 0); at(HINT * 2 + 20000, 0);
    assert.equal(log.confirms.length, 2);
  } finally { restore(); }
});

test('rideMovingStats: media pesata sul tempo, esclusi soste, buchi e velocità congelata', () => {
  const rows = [];
  for (let i = 0; i <= 100; i++) rows.push({ t: i, speedKmh: 60 });             // 100 s a 60
  for (let i = 101; i <= 200; i++) rows.push({ t: i, speedKmh: 0 });            // sosta
  for (let i = 201; i <= 250; i++) rows.push({ t: i, speedKmh: 120, speedStale: 1 }); // galleria
  rows.push({ t: 1000, speedKmh: 90, gap: 1 });                                  // buco di 750 s
  const st = s.rideMovingStats(rows);
  assert.equal(st.movingS, 100);
  assert.equal(st.vAvg, 60);
  assert.equal(s.rideMovingStats(null).vAvg, 0);
  assert.equal(s.rideMovingStats([null, { t: 'x' }]).movingS, 0);
});

test('aria-pressed segue Segui, Bussola e Voce', () => {
  resetState();
  s.setFollow(false);
  assert.equal(els.btnFollow.getAttribute('aria-pressed'), 'false');
  s.setFollow(true);
  assert.equal(els.btnFollow.getAttribute('aria-pressed'), 'true');
  s.setTrackUp(true);
  assert.equal(els.btnTrackUp.getAttribute('aria-pressed'), 'true');
  s.setTrackUp(false);
  assert.equal(els.btnTrackUp.getAttribute('aria-pressed'), 'false');
  s.setNavVoice(false);
  assert.equal(els.btnNavMute.getAttribute('aria-pressed'), 'false');
  s.setNavVoice(true);
  assert.equal(els.btnNavMute.getAttribute('aria-pressed'), 'true');
  resetState();
});

test('markup: impostazione autoLog agganciata, aria-pressed iniziali coerenti coi default', () => {
  const src = appSource();
  assert.match(src, /<input type="checkbox" id="autoLog">/);
  assert.match(src, /autoLogChk: \$\('autoLog'\)/);
  assert.match(src, /<button id="btnFollow" aria-pressed="true"/);
  assert.match(src, /<button id="btnTrackUp" aria-pressed="false"/);
  assert.match(src, /<button id="btnNavMute" aria-pressed="true"/);
});
