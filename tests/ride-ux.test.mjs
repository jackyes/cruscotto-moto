import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const { els, updateMapHud, mapHudModel } = api;

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
  assert.equal(els.mapHud.className, 'map-hud lean-l nolim');
  assert.equal(els.mhLeanDir.textContent, '');
  assert.equal(els.mhArcL.getAttribute('stroke-dasharray'), '32 60');
  assert.equal(els.mhArcR.getAttribute('stroke-dasharray'), '0 60');
  assert.equal(els.mhMaxL.textContent, '42°');
  assert.equal(els.mhMaxR.textContent, '37°');
  assert.equal(els.mhPeakL.getAttribute('transform'), 'rotate(-42)');
  assert.equal(els.mhPeakL.getAttribute('visibility'), 'visible');
  assert.equal(els.mhPeakR.getAttribute('transform'), 'rotate(37)');

  state.lean = 12.5;
  updateMapHud();
  assert.equal(els.mapHud.className, 'map-hud lean-r nolim');
  assert.equal(els.mhArcR.getAttribute('stroke-dasharray'), '13 60');
  assert.equal(els.mhArcL.getAttribute('stroke-dasharray'), '0 60');

  // Senza calibrazione la piega non è misurata: placeholder, non uno zero finto.
  state.calib = null;
  state.demo = false;
  updateMapHud();
  assert.equal(els.mhLeanVal.textContent, '--');
  assert.equal(els.mhLeanDir.textContent, 'non calibrato');
  assert.equal(els.mapHud.className, 'map-hud nocal nolim');
  assert.equal(els.mhArcR.getAttribute('stroke-dasharray'), '0 60');
  setFullscreen(false);
  resetState();
});

test('mapHudModel: verso, arco in gradi, limite e affidabilità con isteresi, NaN', () => {
  const base = { demo: true, calib: null, lean: 0, leanConf: 1, speedKph: 0, speedLimit: null,
    session: { maxLeanL: 0, maxLeanR: 0 } };
  const m = (o, prev) => mapHudModel(Object.assign({}, base, o), prev || null);

  // Sotto 1°: niente verso e niente arco, come l'etichetta del cruscotto.
  let r = m({ lean: -0.4 });
  assert.equal(r.cls, 'map-hud nolim');
  assert.equal(r.lean, '0');
  assert.equal(r.dashL, '0 60');
  assert.equal(r.dashR, '0 60');
  assert.equal(r.dir, '');
  // Oltre il fondo scala l'arco satura, il numero no.
  r = m({ lean: -75 });
  assert.equal(r.cls, 'map-hud lean-l nolim');
  assert.equal(r.dashL, '60 60');
  assert.equal(r.lean, '75');
  // Arco e testo arrotondati allo stesso modo.
  r = m({ lean: 49.6 });
  assert.equal(r.dashR, '50 60');
  assert.equal(r.lean, '50');
  // NaN: placeholder, mai "NaN 60" nel dasharray.
  r = m({ lean: NaN });
  assert.equal(r.lean, '--');
  assert.equal(r.dashL, '0 60');
  assert.equal(r.dashR, '0 60');

  // Limite: il margine di SPEED_LIMIT_OVER_KMH (3) è escluso, come per il badge del cruscotto.
  assert.equal(m({ speedLimit: 50, speedKph: 53 }).cls, 'map-hud');
  const on = m({ speedLimit: 50, speedKph: 53.1 });
  assert.equal(on.cls, 'map-hud over');
  assert.equal(on.limit, '50');
  // Isteresi: una volta acceso, si spegne solo 1 km/h sotto la soglia.
  assert.equal(m({ speedLimit: 50, speedKph: 52.5 }, on).over, true);
  assert.equal(m({ speedLimit: 50, speedKph: 52 }, on).over, false);
  assert.equal(m({ speedLimit: 50, speedKph: 52.5 }).over, false);
  assert.equal(m({ speedLimit: 130 }).cls, 'map-hud lim3');
  assert.equal(m({}).limit, '');

  // Affidabilità: si accende alla soglia di .lean-conf.bad e si spegne a 0.45.
  const low = m({ leanConf: 0.33 });
  assert.equal(low.cls, 'map-hud lowconf nolim');
  assert.equal(m({ leanConf: 0.34 }).lowconf, false);
  assert.equal(m({ leanConf: 0.4 }, low).lowconf, true);
  assert.equal(m({ leanConf: 0.45 }, low).lowconf, false);
  // Non calibrato: niente "affidabilità bassa" su una piega che non c'è.
  r = m({ demo: false, leanConf: 0 });
  assert.equal(r.cls, 'map-hud nocal nolim');
  assert.equal(r.lean, '--');
  assert.equal(r.dir, 'non calibrato');

  // Pallini dei massimi: nascosti fino a 1°, saturi a 60°, arrotondati come il testo.
  r = m({ session: { maxLeanL: -41.6, maxLeanR: 0.8 } });
  assert.equal(r.peakL, 'rotate(-42)');
  assert.equal(r.maxL, '42°');
  assert.equal(r.peakR, '');
  assert.equal(m({ session: { maxLeanL: 0, maxLeanR: 72 } }).peakR, 'rotate(60)');
});

test('updateMapHud: a valori fermi zero scritture, mai className sui nodi SVG', () => {
  resetState();
  setFullscreen(true);
  state.demo = true;
  state.lean = -20;
  state.session.maxLeanL = -30;
  state.speedLimit = 50;
  state.speedKph = 40;
  const svg = ['mhArcL', 'mhArcR', 'mhPeakL', 'mhPeakR'];
  const orig = {};
  let attrW = 0, clsW = 0;
  for (const k of svg) {
    orig[k] = els[k].setAttribute;
    // Il setAttribute del mock usa la closure, non this: si può chiamare staccato.
    els[k].setAttribute = (a, v) => { attrW++; orig[k](a, v); };
    // Nel DOM vero className di un SVGElement è in sola lettura: assegnarlo lancia.
    Object.defineProperty(els[k], 'className', {
      get: () => '', set() { throw new TypeError('className su un nodo SVG'); }, configurable: true,
    });
  }
  let cls = els.mapHud.className;
  Object.defineProperty(els.mapHud, 'className', {
    get: () => cls, set(v) { clsW++; cls = v; }, configurable: true,
  });
  try {
    updateMapHud();
    assert.equal(cls, 'map-hud lean-l');
    attrW = 0; clsW = 0;
    updateMapHud();
    assert.equal(attrW, 0, 'attributi SVG riscritti a valore invariato');
    assert.equal(clsW, 0, 'className riscritto a valore invariato');
    state.lean = -21;
    updateMapHud();
    assert.equal(attrW, 1, 'doveva cambiare solo il dasharray dell\'arco sinistro');
    assert.equal(els.mhArcL.getAttribute('stroke-dasharray'), '21 60');
    assert.equal(clsW, 0);
  } finally {
    for (const k of svg) {
      els[k].setAttribute = orig[k];
      Object.defineProperty(els[k], 'className', { value: '', writable: true, configurable: true, enumerable: true });
    }
    Object.defineProperty(els.mapHud, 'className', { value: cls, writable: true, configurable: true, enumerable: true });
    setFullscreen(false);
    resetState();
  }
});

test('HUD mappa: markup agganciato, tema chiaro leggibile, attributi SVG liberi dal CSS', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // Solo l'HTML prova che ogni $('mh…') di els aggancia un nodo vero.
  const ids = [...html.matchAll(/\$\('(mapHud|mh[A-Z]\w*)'\)/g)].map(x => x[1]);
  assert.ok(ids.length >= 11, 'chiavi HUD mancanti in els: ' + ids);
  for (const id of ids) assert.match(html, new RegExp('id="' + id + '"'), 'els.' + id + ' punta a un id assente');
  // Un display.js vecchio in cache ci assegna className/style: su un nodo SVG lancerebbe.
  assert.match(html, /<div id="mhLeanDir"/);
  assert.match(html, /<span id="mhLeanVal"/);
  // Classe iniziale = quella che il JS calcola al boot: niente scrittura al primo giro.
  const boot = mapHudModel({ demo: false, calib: null, lean: 0, leanConf: 1, speedKph: 0,
    speedLimit: null, session: { maxLeanL: 0, maxLeanR: 0 } }, null);
  assert.match(html, new RegExp('id="mapHud" class="' + boot.cls + '"'));
  assert.equal((html.match(/pathLength="60"/g) || []).length, 2);
  // Una regola CSS vince sull'attributo di presentazione e bloccherebbe arco e pallini.
  // Selettore su una sola riga ([^\n{}]*): niente backtracking su tutto il file.
  for (const r of html.match(/\n  [^\n{}]*\.mh-(?:fill|peak)[^\n{}]*\{[^}]*\}/g) || []) {
    assert.doesNotMatch(r.slice(r.indexOf('{')), /stroke-dasharray|visibility|transform/, r.trim());
  }
  // Regressione del tema chiaro: fondo da token definito in entrambi i temi, niente rgba fissi.
  const rule = sel => {
    const mm = html.match(new RegExp('\\n  ' + sel.replace(/[.[\]]/g, '\\$&') + ' \\{([^}]*)\\}'));
    assert.ok(mm, 'regola assente: ' + sel);
    return mm[1];
  };
  for (const sel of [':root', ':root[data-theme="light"]']) {
    assert.match(rule(sel), /--hud-bg:/, sel);
    assert.match(rule(sel), /--hud-shadow:/, sel);
  }
  for (const sel of ['.map-hud', '.map-ctrl', '.map-full-btn', '.nav-banner']) {
    assert.match(rule(sel), /background: var\(--hud-bg\)/, sel);
  }
  for (const sel of ['.map-hud', '.map-ctrl', '.map-full-btn']) {
    assert.doesNotMatch(rule(sel), /rgba\(/, sel);
  }
});

test('updateDisplay: un errore dell\'HUD non ferma il giro e si logga una volta', () => {
  resetState();
  setFullscreen(true);
  const d = Object.getOwnPropertyDescriptor(els.mhSpeedVal, 'textContent');
  Object.defineProperty(els.mhSpeedVal, 'textContent', {
    get: () => 'x', set() { throw new Error('HUD rotto'); }, configurable: true,
  });
  const warn = console.warn;   // la sandbox usa lo stesso oggetto console del test
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    state.speedKph = 50;
    assert.doesNotThrow(() => api.updateDisplay());
    assert.doesNotThrow(() => api.updateDisplay());
    assert.equal(warned, 1, 'errore HUD loggato a ogni giro');
  } finally {
    console.warn = warn;
    Object.defineProperty(els.mhSpeedVal, 'textContent', d);
    setFullscreen(false);
    resetState();
  }
});
