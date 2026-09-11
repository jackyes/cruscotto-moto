import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, resetState, vmSandbox } from './harness.mjs';

const { state, els, loadSettings, onGeolocation, processSample, renderNavPanel, MOUNT, NAV_ICON } = api;
const s = vmSandbox;

// ---- els: chiavi referenziate dal codice ma assenti dalla mappa ----
test('els: diagVerdict esiste (il verdetto sensori deve poter essere scritto)', () => {
  // js/diag.js:107 fa `if (els.diagVerdict && ...)`: con la chiave assente la
  // guardia è sempre falsa e #diagVerdict resta sul placeholder "in attesa di dati".
  assert.ok(els.diagVerdict, 'els.diagVerdict assente: updateDiag non scrive mai il verdetto');
  /* Il mock del harness restituisce makeEl() per QUALSIASI id, mai null: il solo
     assert.ok non distingue `$('diagVerdict')` da `$('diagVerdic')`. Che la chiave sia
     agganciata a un elemento vero si controlla sull'HTML, dove l'id sta. */
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="diagVerdict"/, 'els.diagVerdict punta a un id assente da index.html');
});

// ---- settings: validazione di mount ----
test('loadSettings: mount validato contro MOUNT', () => {
  const set = v => {
    s.localStorage.setItem('cruscotto.settings', JSON.stringify({ mount: v }));
    loadSettings();
  };
  set('portrait');
  assert.equal(state.mount, 'portrait');
  set('landscape-right');
  assert.equal(state.mount, 'landscape-right');

  // Chiave ignota: prima finiva in MOUNT[state.mount] dentro il loop sensori
  // (js/sensors-pipe.js) → TypeError a ogni campione, strumentazione morta.
  set('garbage');
  assert.equal(state.mount, 'landscape-left');
  set('');
  assert.equal(state.mount, 'landscape-left');
  // `in` accetterebbe le chiavi di Object.prototype: la validazione deve usare hasOwnProperty.
  set('constructor');
  assert.equal(state.mount, 'landscape-left', 'chiave di Object.prototype accettata');
  set('toString');
  assert.equal(state.mount, 'landscape-left');
  set(null);
  assert.equal(state.mount, 'landscape-left');
  // Campo assente (settings salvate senza mount): default, non undefined.
  s.localStorage.setItem('cruscotto.settings', JSON.stringify({ invertLean: true }));
  loadSettings();
  assert.equal(state.mount, 'landscape-left');

  s.localStorage.removeItem('cruscotto.settings');
  resetState();
});

// ---- sensors-pipe: fallback su orientamento ignoto ----
test('processSample: mount ignoto non lancia (fallback landscape-left)', () => {
  const G = api.G;
  // La gravità di piattaforma (grav/lin) è ciò che rende `la` non-nullo senza
  // calibrazione: è il caso in cui il ramo axis() viene davvero eseguito.
  const acc = { x: 0, y: 0, z: G };
  // 'constructor'/'toString'/'__proto__' non sono in MOUNT ma SONO nella catena di
  // prototipi, e MOUNT[x] li trova truthy: un fallback scritto come `MOUNT[x] || …`
  // li lascia passare e m.lat resta undefined → TypeError a ogni campione, come
  // senza fallback. Verificato: erano l'unico buco rimasto.
  for (const mount of ['garbage', '', undefined, 'constructor', 'toString', '__proto__']) {
    resetState();
    state.mount = mount;         // stato manomesso a runtime: la pipe non deve morire
    state.calib = null;          // senza calibrazione si passa dal ramo `axis(la, m.lat)`
    // Serie di campioni (non uno solo): il dt del primo dipende da lastMotionT
    // interno alla sandbox, che api.lastMotionT non può pilotare (è esportato per
    // valore). Dal secondo in poi il dt è quello vero fra due t consecutivi.
    assert.doesNotThrow(() => {
      let t = 50000;
      for (let i = 0; i < 3; i++) {
        t += 50;
        api.processSample({ acc, gyro: null, grav: acc, lin: null, t });
      }
    }, 'MOUNT[state.mount] undefined (' + String(mount) + ') → TypeError sul campione');
  }
  assert.equal(MOUNT['landscape-left'].lat, 'y');   // il fallback è l'orientamento documentato
  resetState();
});

// ---- inputs: il tick GPS deve ridisegnare il pannello nav ----
function geoPos(lat, lon, speed, acc) {
  return { coords: { latitude: lat, longitude: lon, accuracy: acc, speed, heading: null, altitude: null },
    timestamp: Date.now() };
}

// ---- nav-ui: lista manovre ridisegnata in modo incrementale ----
test('renderNavPanel: a ogni fix si riusano le <li>, non si ricostruisce la lista', () => {
  resetState();
  const nv = {
    status: 'ACTIVE', dest: { lat: 45.464, lon: 9.19, label: 'Duomo' },
    totalM: 5000, totalS: 600, distRemain: 4000, timeRemain: 480,
    distToNext: 200, nextMan: 0, sAlong: 1000,
    sMan: new Float64Array([1000, 2000, 3000]),
    man: [{ type: 10, text: 'Gira a destra', streets: [] },
          { type: 8, text: 'Prosegui', streets: [] },
          { type: 4, text: 'Arrivo', streets: [] }],
  };
  state.nav = nv;
  renderNavPanel();
  const ol = els.navSteps;
  const navFmtShort = api.navFmtShort;
  assert.equal(ol.children.length, 3, 'una <li> per manovra');
  const first = ol.children[0];
  assert.equal(first.className, 'cur');
  assert.equal(first.children[0].textContent, navFmtShort(200));
  assert.equal(ol.children[1].children[0].textContent, navFmtShort(1000));

  // Secondo fix GPS: rotta identica, cambiano solo passo corrente e distanze.
  // Il costo del tick è qui: prima la lista veniva azzerata e ricostruita da zero.
  nv.nextMan = 1; nv.distToNext = 150; nv.sAlong = 2100;
  renderNavPanel();
  assert.equal(ol.children.length, 3, 'lista ricostruita a ogni fix (churn DOM in marcia)');
  assert.equal(ol.children[0], first, '<li> ricreata invece che aggiornata');
  assert.equal(first.className, 'done', 'passo superato non marcato done');
  assert.equal(ol.children[1].className, 'cur', 'passo corrente non marcato cur');
  assert.equal(ol.children[1].children[0].textContent, navFmtShort(150), 'distanza del passo corrente non aggiornata');
  assert.equal(ol.children[2].children[0].textContent, navFmtShort(900), 'distanza del passo futuro non aggiornata');

  // Rotta nuova (navBuild/navRestore producono un array nuovo): la cache deve invalidarsi.
  state.nav = { status: 'ACTIVE', totalM: 900, totalS: 120, distRemain: 900, timeRemain: 120,
    distToNext: 900, nextMan: 0, sAlong: 0, sMan: new Float64Array([0]),
    man: [{ type: 8, text: 'Nuova rotta', streets: [] }] };
  renderNavPanel();
  assert.equal(ol.children.length, 1, 'rotta nuova ma lista vecchia riusata');
  const last = ol.children[ol.children.length - 1];
  assert.equal(last.children[1].textContent, NAV_ICON[8] + ' Nuova rotta');

  // Rotta allungata in place (stesso array): la lista deve accorgersene, non leggere
  // una riga inesistente.
  const grown = { status: 'ACTIVE', totalM: 900, totalS: 120, distRemain: 900, timeRemain: 120,
    distToNext: 900, nextMan: 0, sAlong: 0, sMan: new Float64Array([0, 500]),
    man: [{ type: 8, text: 'Prima', streets: [] }] };
  state.nav = grown;
  renderNavPanel();
  const before = ol.children.length;
  grown.man.push({ type: 4, text: 'Aggiunta', streets: [] });
  grown.sMan = new Float64Array([0, 500]);
  assert.doesNotThrow(() => renderNavPanel());
  assert.equal(ol.children.length, before + 1, 'man allungata in place: passo nuovo non aggiunto');

  state.nav = null;
  assert.doesNotThrow(() => renderNavPanel());
  resetState();
});

test('onGeolocation: renderNavPanel richiamata dal tick, solo sul tab nav', () => {
  resetState();
  // Stub delle parti non in prova: updateMap/checkCameras toccano mappa e IDB.
  // Si ripristinano TUTTE (non solo quelle due spiate): la sandbox è una sola per
  // file, quindi uno stub lasciato su updateMap/checkCameras verrebbe ereditato da
  // qualunque test aggiunto dopo, che fallirebbe per motivi finti.
  const stubbed = ['updateMap', 'maybeLoadCameras', 'checkCameras', 'updateGpsStatus', 'navRenderBanner', 'navTick', 'renderNavPanel'];
  const real = {};
  for (const k of stubbed) real[k] = s[k];
  s.updateMap = () => {};
  s.maybeLoadCameras = () => {};
  s.checkCameras = () => {};
  s.updateGpsStatus = () => {};
  s.navRenderBanner = () => {};
  s.navTick = () => {};
  let panel = 0;
  s.renderNavPanel = () => { panel++; };
  state.nav = { status: 'ACTIVE' };
  try {
    state.currentTab = 'dashboard';
    onGeolocation(geoPos(45.0, 9.0, 10, 5));
    assert.equal(panel, 0, 'pannello ridisegnato con il tab nav non visibile');
    state.currentTab = 'nav';
    onGeolocation(geoPos(45.001, 9.0, 10, 5));
    assert.equal(panel, 1, 'pannello nav non ridisegnato dal tick GPS (distanza/ETA congelati)');
  } finally {
    for (const k of stubbed) s[k] = real[k];
    resetState();
  }
});
