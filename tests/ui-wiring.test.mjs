import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, resetState, vmSandbox } from './harness.mjs';

const { state, els, loadSettings, onGeolocation, processSample, renderNavPanel, MOUNT, NAV_ICON,
  calibBasis, calibOk } = api;
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

// ---- settings: validazione della calibrazione salvata ----
/* loadSettings adottava la voce con il solo controllo `c.v === 2`: una base
   manomessa o troncata nello storage finiva in state.calib e la piega usciva NaN
   in gauge e log; coi campi del tutto assenti buildBasis lanciava su
   vnorm(undefined) e l'avvio moriva (nessun try/catch attorno a loadSettings). */
test('loadSettings: calibrazione v2 non valida scartata, avvio vivo', () => {
  const GOOD = { up: { x: 1, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, right: { x: 0, y: 1, z: 0 }, v: 2 };
  const set = v => {
    s.localStorage.setItem('cruscotto.calib', JSON.stringify(v));
    loadSettings();
  };

  // Base valida: adottata (guardia contro un fix troppo aggressivo).
  // JSON.stringify e non deepEqual: l'oggetto arriva dal realm del vm, e
  // deepStrictEqual confronta anche i prototipi (Object di un altro realm ≠ Object).
  set(GOOD);
  assert.equal(JSON.stringify(state.calib), JSON.stringify(GOOD), 'base valida scartata');

  // Troncata: nessun vettore — è il caso che faceva lanciare buildBasis.
  assert.doesNotThrow(() => set({ v: 2 }), 'v2 troncata: TypeError in loadSettings');
  assert.equal(state.calib, null, 'v2 troncata adottata');
  assert.equal(s.localStorage.getItem('cruscotto.calib'), null, 'voce invalida non cancellata');

  // Vettori presenti ma senza componenti (o non numerici): NaN in gauge e log.
  for (const bad of [
    { up: {}, fwd: {}, right: {}, v: 2 },
    { up: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, right: { x: 0, y: 1, z: 0 }, v: 2 }, // norma nulla
    { up: 'garbage', fwd: { x: 0, y: 0, z: -1 }, right: { x: 0, y: 1, z: 0 }, v: 2 },
    { up: { x: 1, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, right: null, v: 2 },
  ]) {
    s.localStorage.setItem('cruscotto.calib', JSON.stringify(bad));
    assert.doesNotThrow(() => loadSettings(), 'avvio morto su ' + JSON.stringify(bad));
    assert.equal(state.calib, null, 'base invalida adottata: ' + JSON.stringify(bad));
  }

  s.localStorage.removeItem('cruscotto.calib');
  resetState();
});

test('calibBasis: compat v1 (solo vettore up) e rifiuto degli input degeneri', () => {  const v1 = calibBasis({ x: 0, y: 1, z: 0 });          // forma v1: il solo up
  assert.ok(v1 && v1.up && v1.fwd && v1.right, 'v1 non convertita in base');
  assert.equal(v1.up.y, 1);
  assert.equal(calibBasis(null), null);
  assert.equal(calibBasis({ v: 2 }), null);              // v2 senza vettori
  assert.equal(calibBasis({ up: { x: 1, y: 0, z: 0 }, fwd: {}, right: {} }), null);
  assert.equal(calibOk({ up: { x: 1, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, right: { x: 0, y: 1, z: 0 } }), true);
  assert.equal(calibOk({ up: { x: 0, y: 0, z: 0 }, fwd: {}, right: null }), false);
});

// ---- settings: camDist allineata alle <option> della select ----
/* La validazione accettava 50-2000 mentre la <select> ha 300/400/600: un valore
   salvato come 250 restava valido a runtime ma la select lo mostrava VUOTA, e non
   c'era modo di rimetterlo a posto (il change scatta solo su una scelta utente). */
test('loadSettings: camDist validata contro la lista delle option', () => {
  const set = v => {
    s.localStorage.setItem('cruscotto.settings', JSON.stringify({ camDist: v }));
    loadSettings();
  };
  for (const v of [300, 400, 600, '300']) {
    set(v);
    assert.equal(state.camDist, Number(v), 'valore della lista rifiutato: ' + v);
  }
  for (const v of [250, 2000, 50, 0, '', null, undefined, 'garbage', NaN]) {
    set(v);
    assert.equal(state.camDist, 400, 'fuori lista non ripiegato sul default: ' + String(v));
  }
  s.localStorage.removeItem('cruscotto.settings');
  resetState();
});

test('camDist: le <option> di index.html sono la lista validata', () => {
  // L'invariante che il bug violava: la lista validata e le option della select
  // devono essere lo stesso insieme. Il mock del DOM non riproduce la select
  // ("value fuori dalle option → stringa vuota"), quindi si controlla l'HTML.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const block = html.match(/<select id="camDist">([\s\S]*?)<\/select>/);
  assert.ok(block, 'select #camDist non trovata in index.html');
  const values = [...block[1].matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1]));
  // JSON e non deepEqual: la costante arriva dal realm del vm (prototipi diversi).
  assert.equal(JSON.stringify(values), JSON.stringify(api.CAM_DIST_CHOICES),
    'option della select ≠ CAM_DIST_CHOICES');
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

// ---- #13: updateDisplay riscriveva cinque nodi a ogni frame ----
/* js/display.js:221-232 assegnava `els.statDist.textContent = ...` (e altri
   quattro) a ogni giro di updateDisplay, cioe' a DISPLAY_HZ, anche quando la
   stringa era identica: il resto della funzione passa da setTxt, che salta
   l'assegnazione a valore invariato. */
test('#13 updateDisplay: i valori lenti scritti solo se cambiano', () => {
  resetState();
  const spied = ['statDist', 'maxLeanR', 'maxLeanL', 'statTime', 'topTime'];
  const saved = {}, count = {};
  for (const k of spied) {
    const el = els[k];
    const d = Object.getOwnPropertyDescriptor(el, 'textContent');
    saved[k] = d;
    let n = 0;
    count[k] = () => n;
    Object.defineProperty(el, 'textContent', {
      get() { return d.get.call(el); },
      set(v) { n++; d.set.call(el, v); },
      configurable: true, enumerable: true,
    });
  }
  try {
    const write = () => { const o = {}; for (const k of spied) o[k] = count[k](); return o; };

    api.updateDisplay();
    assert.equal(els.statTime.textContent, '00:00');
    assert.equal(els.statDist.textContent, '0.00');
    assert.equal(els.maxLeanR.textContent, '0°');
    const first = write();
    assert.ok(spied.every(k => first[k] === 1), 'primo giro non ha scritto: ' + JSON.stringify(first));

    api.updateDisplay(); // stesso stato: nessuna riscrittura
    const second = write();
    for (const k of spied) assert.equal(second[k], first[k], k + ' riscritto a valore invariato');

    // Un valore che cambia deve arrivare comunque.
    state.session.distKm = 1.234;
    api.updateDisplay();
    assert.equal(els.statDist.textContent, '1.23');
    assert.equal(count.statDist(), first.statDist + 1, 'distanza cambiata non riscritta');
  } finally {
    for (const k of spied) Object.defineProperty(els[k], 'textContent', { ...saved[k] });
    resetState();
  }
});

// ---- #14: .bar .fill transizionava solo width, setBar scrive anche left ----
test('#14 .bar .fill: la transizione copre left, non solo width', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const rule = html.match(/\.bar \.fill \{([\s\S]*?)\}/);
  assert.ok(rule, 'regola .bar .fill assente da index.html');
  const tr = rule[1].match(/transition:\s*([^;]+);/);
  assert.ok(tr, 'transition assente da .bar .fill');
  assert.match(tr[1], /width/, 'width non transizionato: ' + tr[1]);
  assert.match(tr[1], /left/, 'left scritto da setBar ma non transizionato: ' + tr[1]);

  // setBar scrive davvero entrambe le proprieta': il test sopra copre solo il CSS.
  const el = s.document.createElement('div');
  api.setBar(el, -0.6, 0.6, 1.2);
  assert.ok(el.style.width, 'width non scritta: ' + JSON.stringify(el.style));
  assert.ok(el.style.left, 'left non scritta: ' + JSON.stringify(el.style));
  assert.equal(el.className, 'fill neg');
});
