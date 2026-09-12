'use strict';
/* js/ui-core.js (step 28): toast/confirmToast, gauge buildGauge/setPeaks/setNeedle, settings load/save, updateCalibStatus, applyTheme, updateCam/GpsStatus. els/$ restano inline. Ordine: dopo js/diag.js. */
/* --- geometria gauge piega (numeri nominati, condivisi fra build e setPeaks) --- */
const GAUGE_CX = 130, GAUGE_CY = 130, GAUGE_R = 96;
const GAUGE_TICK_MAJOR_IN = 24, GAUGE_TICK_MINOR_IN = 17, GAUGE_TICK_OUT = 8;
const GAUGE_LABEL_IN = 38, GAUGE_NEEDLE_IN = 28, GAUGE_NUM_Y = 166;
const GAUGE_HUB_R = 9, GAUGE_HUB_DOT_R = 4, GAUGE_PEAK_R = 5;

function toast(msg, kind, ms) {
  // Tetto: una raffica di errori (GPS che salta, IDB bloccato) inondava il DOM
  // di toast. Si scartano solo i toast semplici, mai i confirmToast (rimuovere
  // un confirm lascerebbe la sua promise appesa per sempre).
  const plain = Array.from(els.toasts.children).filter(c => c.classList.contains('toast') && !c.querySelector('button'));
  while (plain.length >= 3) plain.shift().remove();
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), ms || 3500);
  return el;
}

function confirmToast(msg) {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'toast';
    const p = document.createElement('div');
    p.textContent = msg;
    const row = document.createElement('div');
    row.className = 'tbtns';
    const yes = document.createElement('button');
    yes.textContent = 'Conferma';
    yes.style.color = 'var(--bad)';
    const no = document.createElement('button');
    no.textContent = 'Annulla';
    row.appendChild(no); row.appendChild(yes);
    el.appendChild(p); el.appendChild(row);
    els.toasts.appendChild(el);
    const done = v => { el.remove(); res(v); };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
  });
}

function buildGauge() {
  // Geometria nominata: prima 130/96/17/24/38/166 vivevano come numeri sparsi
  // fra qui e setPeaks (che ripeteva cx/cy/r a mano, pronti a divergere).
  const cx = GAUGE_CX, cy = GAUGE_CY, r = GAUGE_R;
  const svg = els.gauge;
  svg.innerHTML = '';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', "Angolo di piega");
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag) => document.createElementNS(NS, tag);
  const pt = (ang) => { const a = ang * Math.PI / 180; return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) }; };

  const path = mk('path');
  path.setAttribute('d', `M ${pt(150).x} ${pt(150).y} A ${r} ${r} 0 0 1 ${pt(30).x} ${pt(30).y}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('class', 'gauge-arc');
  path.setAttribute('stroke-width', '16');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);

  for (let a = -60; a <= 60; a += 10) {
    const ang = 90 - a;
    const major = a % 30 === 0;
    const r1 = major ? r - GAUGE_TICK_MAJOR_IN : r - GAUGE_TICK_MINOR_IN, r2 = r - GAUGE_TICK_OUT;
    const line = mk('line');
    line.setAttribute('x1', cx + r1 * Math.cos(ang * Math.PI / 180));
    line.setAttribute('y1', cy - r1 * Math.sin(ang * Math.PI / 180));
    line.setAttribute('x2', cx + r2 * Math.cos(ang * Math.PI / 180));
    line.setAttribute('y2', cy - r2 * Math.sin(ang * Math.PI / 180));
    line.setAttribute('class', major ? 'gauge-tick major' : 'gauge-tick');
    line.setAttribute('stroke-width', major ? (a === 0 ? 3.5 : 2.5) : 1.4);
    if (a === 0) {
      line.setAttribute('style', 'stroke: var(--text);');
    } else if (Math.abs(a) >= 50) {
      line.setAttribute('style', 'stroke: var(--bad);');
    } else if (a > 0) {
      line.setAttribute('style', 'stroke: var(--accent);');
    } else {
      line.setAttribute('style', 'stroke: var(--good);');
    }
    svg.appendChild(line);
    if (major) {
      const txt = mk('text');
      txt.setAttribute('x', cx + (r - GAUGE_LABEL_IN) * Math.cos(ang * Math.PI / 180));
      txt.setAttribute('y', cy - (r - GAUGE_LABEL_IN) * Math.sin(ang * Math.PI / 180) + 4);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '12');
      txt.setAttribute('font-weight', '800');
      txt.setAttribute('class', 'gauge-label');
      txt.textContent = Math.abs(a);
      svg.appendChild(txt);
    }
  }

  /* Il numero della piega, sotto l'asse (per non incrociare l'ago), con il grado. */
  const num = mk('text');
  num.setAttribute('x', cx); num.setAttribute('y', GAUGE_NUM_Y);
  num.setAttribute('text-anchor', 'middle');
  num.setAttribute('class', 'gauge-val');
  num.setAttribute('font-size', '36');
  num.setAttribute('font-weight', '900');
  const tspan = mk('tspan');
  tspan.setAttribute('id', 'leanVal');
  tspan.textContent = '--';
  num.appendChild(tspan);
  const deg = mk('tspan');
  deg.setAttribute('class', 'gauge-deg');
  deg.setAttribute('font-size', '22');
  deg.textContent = '°';
  num.appendChild(deg);
  svg.appendChild(num);

  /* Marker di picco: un punto sull'arco per il massimo destro e sinistro. */
  const peakR = mk('circle');
  peakR.setAttribute('r', GAUGE_PEAK_R);
  peakR.setAttribute('class', 'gauge-peak peak-r');
  peakR.setAttribute('style', 'fill:var(--accent);stroke:#fff;stroke-width:1.5;display:none;');
  svg.appendChild(peakR);
  const peakL = mk('circle');
  peakL.setAttribute('r', GAUGE_PEAK_R);
  peakL.setAttribute('class', 'gauge-peak peak-l');
  peakL.setAttribute('style', 'fill:var(--good);stroke:#fff;stroke-width:1.5;display:none;');
  svg.appendChild(peakL);

  const needle = mk('g');
  const nline = mk('line');
  nline.setAttribute('x1', cx); nline.setAttribute('y1', cy);
  nline.setAttribute('x2', cx); nline.setAttribute('y2', cy - (r - GAUGE_NEEDLE_IN));
  nline.setAttribute('class', 'gauge-needle');
  nline.setAttribute('stroke-width', '4.5');
  nline.setAttribute('stroke-linecap', 'round');
  needle.appendChild(nline);
  const hubRing = mk('circle');
  hubRing.setAttribute('cx', cx); hubRing.setAttribute('cy', cy); hubRing.setAttribute('r', GAUGE_HUB_R);
  hubRing.setAttribute('style', 'fill:var(--surface-3);stroke:var(--accent);stroke-width:2.5;');
  needle.appendChild(hubRing);
  const hubDot = mk('circle');
  hubDot.setAttribute('cx', cx); hubDot.setAttribute('cy', cy); hubDot.setAttribute('r', GAUGE_HUB_DOT_R);
  hubDot.setAttribute('fill', 'var(--accent)');
  needle.appendChild(hubDot);
  svg.appendChild(needle);

  state._needle = needle;
  state._peakR = peakR; state._peakL = peakL;
  state._cx = cx; state._cy = cy;
  els.leanVal = document.getElementById('leanVal');
}

function setPeaks(maxR, maxL) {
  if (!state._peakR) return;
  const place = (el, deg) => {
    if (!(Math.abs(deg) > 1)) { el.style.display = 'none'; return; }
    const ang = (90 - Math.max(-60, Math.min(60, deg))) * Math.PI / 180;
    // Stessa geometria di buildGauge (GAUGE_CX/CY/R): prima 130/96 erano
    // ripetuti qui a mano, pronti a divergere dalla costruzione.
    el.setAttribute('cx', GAUGE_CX + GAUGE_R * Math.cos(ang));
    el.setAttribute('cy', GAUGE_CY - GAUGE_R * Math.sin(ang));
    el.style.display = '';
  };
  place(state._peakR, maxR);
  place(state._peakL, -maxL);
}

function setNeedle(lean) {
  if (!state._needle) return;
  const a = Math.max(-60, Math.min(60, lean));
  state._needle.setAttribute('transform', `rotate(${a} ${state._cx} ${state._cy})`);
}

function loadSettings() {
  const s = store.get('cruscotto.settings', {});
  /* Validato contro MOUNT, come camRadius qui sotto: il valore finisce in
     MOUNT[state.mount] dentro il loop sensori (js/sensors-pipe.js) e in
     js/calib.js, dove una chiave ignota dava TypeError a ogni campione —
     strumentazione morta fino a ripristinare le impostazioni. */
  state.mount = mountKey(s.mount);
  state.invertLean = !!s.invertLean;
  state.wakeLockOn = s.wakeLockOn !== false;
  state.camAlerts = s.camAlerts !== false;
  // Validato contro la lista delle <option>, come camRadius: `|| 400` mascherava un
  // eventuale valore legittimo 0 e accettava stringhe da un localStorage modificato
  // a mano; il range 50-2000 accettava valori che la <select> non sa mostrare.
  state.camDist = camDistFrom(s.camDist);
  /* Validato contro la lista, non `|| default`: il valore finisce interpolato nella
     query Overpass, e un localStorage modificato a mano non deve poterci scrivere.
     choiceOr e non indexOf crudo: dallo storage il valore torna anche come stringa,
     e "15000" non e' nella lista dei numeri — un raggio legittimo veniva resettato. */
  state.camRadius = choiceOr(CAM_RADIUS_CHOICES, s.camRadius, CAM_RADIUS_DEFAULT);
  state.navVoice = s.navVoice !== false;
  state.navNoHw = !!s.navNoHw;
  state.navNoToll = !!s.navNoToll;
  state.navBackroads = !!s.navBackroads;
  state.navNoFerry = !!s.navNoFerry;
  // choiceOr coerce con Number: dal localStorage arriva sempre stringa, e "90" || 0
  // restava stringa — compass + offset + 360 concatenava invece di sommare.
  state.compassOffset = choiceOr(COMPASS_OFFSETS, s.compassOffset, 0);
  state.gyroFusion = s.gyroFusion !== false;
  state.gravityMode = (s.gravityMode === 'native' || s.gravityMode === 'own') ? s.gravityMode : 'auto';
  state.rectNull = !!s.rectNull;
  // Segno del giroscopio imparato a runtime (vedi updateGyroSign): si riusa il
  // verdetto della sessione precedente, così un avvio già in marcia non riparte
  // col segno di default sbagliato. Non si persistono lock/score/energy.
  // Validato come ogni altro setting persistito: è un MOLTIPLICATORE, quindi un
  // valore degenere non si nota — 0 azzera tutte le tre componenti del giroscopio
  // (gyroSat(x)*0 === 0) e l'app resta senza giroscopio in silenzio, mentre un
  // flip lo riscrive come -0, che JSON.stringify salva come "0" per sempre.
  // Number(): dal localStorage può arrivare una stringa ("1"), come per compassOffset.
  {
    const gs = Number(store.get('cruscotto.gyroSign', LEAN_GYRO_SIGN_DEFAULT));
    state.gyroSign = (gs === 1 || gs === -1) ? gs : LEAN_GYRO_SIGN_DEFAULT;
  }
  state.camAhead = s.camAhead !== false;
  state.camLegalOk = !!s.camLegalOk;
  state.guidaAlways = !!s.guidaAlways;
  state.theme = s.theme || 'dark';
  els.themeSel.value = state.theme;
  els.mountSel.value = state.mount;
  els.invertLean.checked = state.invertLean;
  els.wakeLockChk.checked = state.wakeLockOn;
  els.camAlertsChk.checked = state.camAlerts;
  els.camDistSel.value = String(state.camDist);
  els.camRadiusSel.value = String(state.camRadius);
  els.navVoice.checked = state.navVoice;
  setNavVoice(state.navVoice, { silentSave: true });
  els.navNoHw.checked = state.navNoHw;
  els.navNoToll.checked = state.navNoToll;
  els.navBackroads.checked = state.navBackroads;
  els.navNoFerry.checked = state.navNoFerry;
  els.compassOffsetSel.value = String(state.compassOffset);
  els.gyroFusion.checked = state.gyroFusion;
  els.gravityModeSel.value = state.gravityMode;
  els.rectNull.checked = state.rectNull;
  els.camAheadChk.checked = state.camAhead;
  if (els.guidaAlwaysChk) els.guidaAlwaysChk.checked = state.guidaAlways;
  /* Le calibrazioni salvate prima della riscrittura dell'attitudine non sono piu'
     valide: leanFromUp usava la proiezione xy invece della base, quindi una base
     costruita allora e' consistente solo col vecchio estrattore. */
  const c = store.get('cruscotto.calib', null);
  /* calibOk e non il solo c.v === 2: uno storage manomesso o troncato (vettori
     NaN, campi assenti) entrava in state.calib e la piega usciva NaN in gauge e
     log; con i campi assenti buildBasis lanciava e l'avvio moriva. */
  if (c && c.v === 2 && calibOk(c)) { state.calib = calibBasis(c); updateCalibStatus(); }
  else if (c) {
    store.del('cruscotto.calib');
    state.calib = null;   // una base in memoria non deve sopravvivere a una voce salvata invalida
    setTimeout(() => toast((c.v === 2 ? 'Calibrazione salvata non valida' : 'Filtro piega aggiornato') +
      ': rifai la calibrazione (moto ferma e dritta).', 'err', 8000), 800);
  }
}

function saveSettings() {
  store.set('cruscotto.settings', {
    mount: state.mount, invertLean: state.invertLean, wakeLockOn: state.wakeLockOn,
    camAlerts: state.camAlerts, camDist: state.camDist, camRadius: state.camRadius,
    compassOffset: state.compassOffset,
    gyroFusion: state.gyroFusion, camAhead: state.camAhead, theme: state.theme,
    gravityMode: state.gravityMode, rectNull: state.rectNull,
    navVoice: state.navVoice, navNoHw: state.navNoHw, navNoToll: state.navNoToll,
    navBackroads: state.navBackroads, navNoFerry: state.navNoFerry,
    camLegalOk: state.camLegalOk, guidaAlways: state.guidaAlways
  });
}

const CAM_LEGAL_MSG = 'Avvisi autovelox da OpenStreetMap: dati incompleti e non ufficiali. Uso a tuo rischio, non sostituisce attenzione alla strada.';

async function askCamLegal() {
  const ok = await confirmToast(CAM_LEGAL_MSG);
  if (ok) {
    state.camLegalOk = true;
    state.camAlerts = true;
    if (els.camAlertsChk) els.camAlertsChk.checked = true;
  } else {
    state.camAlerts = false;
    if (els.camAlertsChk) els.camAlertsChk.checked = false;
    toast('Avvisi autovelox disattivati.', null, 4000);
  }
  saveSettings();
  return ok;
}

function maybeAskCamLegal() {
  if (!state.camAlerts || state.camLegalOk) return;
  askCamLegal();
}

function updateCalibStatus() {
  els.calibStatus.textContent = state.calib ? 'calibrato' : 'non calibrato';
  els.calibStatus.style.color = state.calib ? 'var(--good)' : 'var(--text-2)';
}

function applyTheme() {
  let resolved = state.theme || 'dark';
  if (resolved === 'auto') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = resolved;
  canvasTheme.reset();
  resetVideoColors();
  state._lastDisp = null;
  if (els.metaTheme) els.metaTheme.content = resolved === 'light' ? '#eef3f8' : '#070a0e';
  if (state.currentTab === 'charts') drawCharts();
  if (state.currentTab === 'map' && state.mapType === 'canvas') drawCanvasMap();
}

function updateCamStatus() {
  const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
  const imported = (state.importedCameras || []).length;
  let cls = 'ok', txt = 'Autovelox ok';
  if (state.camFetching) {
    // Per primo: all'avvio camCenter e' nullo e cameras vuoto, e senza questa
    // precedenza il badge lampeggerebbe rosso a ogni apertura dell'app.
    cls = 'wait'; txt = 'Autovelox…';
  } else if (!p) {
    cls = 'wait'; txt = 'Autovelox attesa';
  } else if (Date.now() < state.camRetryAfter) {
    if (state.cameras.length || imported) {
      // Backoff attivo ma ci sono dati (cache offline / raggio minore, camTs=0):
      // mostrare "offline" come se non ci fosse nulla è falso e spaventa.
      cls = 'ok'; txt = 'Autovelox cache';
    } else {
      cls = 'err'; txt = 'Autovelox offline';
    }
  } else if (!state.cameras.length && !imported) {
    cls = 'err'; txt = 'Autovelox nessun dato';
  } else if (!imported && (!state.camCenter || haversine(state.camCenter, p) * 1000 > state.camRadius)) {
    // Fuori dal cerchio scaricato. Con un DB importato la copertura non dipende
    // dalla cache OSM, quindi non e' un degrado e non si segnala.
    cls = 'err'; txt = 'Autovelox fuori zona';
  } else if (state.camTotal > state.camDrawn) {
    // Il tetto marker ha tagliato: dirlo, o la mappa sembra completa quando non lo e'.
    cls = 'wait'; txt = 'Autovelox ' + state.camDrawn + '/' + state.camTotal;
  }
  els.camDot.className = 'status-dot ' + cls;
  els.camTxt.textContent = txt;
}

function updateGpsStatus() {
  if (state.demo) {
    els.gpsDot.className = 'status-dot ok';
    els.gpsTxt.textContent = 'GPS demo';
    return;
  }
  if (state.gpsStatus === 'ok') {
    els.gpsDot.className = 'status-dot ok';
    els.gpsTxt.textContent = 'GPS ok' + (state.gps.acc != null ? ' (±' + Math.round(state.gps.acc) + 'm)' : '');
  } else if (state.gpsStatus === 'err') {
    els.gpsDot.className = 'status-dot err';
    els.gpsTxt.textContent = 'GPS errore';
  } else {
    els.gpsDot.className = 'status-dot wait';
    els.gpsTxt.textContent = 'GPS attesa';
  }
}
