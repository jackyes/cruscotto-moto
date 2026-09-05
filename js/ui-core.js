'use strict';
/* js/ui-core.js (step 28): toast/confirmToast, gauge buildGauge/setPeaks/setNeedle, settings load/save, updateCalibStatus, applyTheme, updateCam/GpsStatus. els/$ restano inline. Ordine: dopo js/diag.js. */
function toast(msg, kind, ms) {
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
  const cx = 130, cy = 130, r = 96;
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
    const r1 = major ? r - 24 : r - 17, r2 = r - 8;
    const line = mk('line');
    line.setAttribute('x1', cx + r1 * Math.cos(ang * Math.PI / 180));
    line.setAttribute('y1', cy - r1 * Math.sin(ang * Math.PI / 180));
    line.setAttribute('x2', cx + r2 * Math.cos(ang * Math.PI / 180));
    line.setAttribute('y2', cy - r2 * Math.sin(ang * Math.PI / 180));
    line.setAttribute('class', major ? 'gauge-tick major' : 'gauge-tick');
    line.setAttribute('stroke-width', major ? 2.5 : 1.2);
    svg.appendChild(line);
    if (major) {
      const txt = mk('text');
      txt.setAttribute('x', cx + (r - 38) * Math.cos(ang * Math.PI / 180));
      txt.setAttribute('y', cy - (r - 38) * Math.sin(ang * Math.PI / 180) + 4);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '12');
      txt.setAttribute('font-weight', '600');
      txt.setAttribute('class', 'gauge-label');
      txt.textContent = Math.abs(a);
      svg.appendChild(txt);
    }
  }

  /* Il numero della piega, sotto l'asse (per non incrociare l'ago), con il grado. */
  const num = mk('text');
  num.setAttribute('x', cx); num.setAttribute('y', 166);
  num.setAttribute('text-anchor', 'middle');
  num.setAttribute('class', 'gauge-val');
  num.setAttribute('font-size', '34');
  num.setAttribute('font-weight', '800');
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
  peakR.setAttribute('r', 4); peakR.setAttribute('class', 'gauge-peak');
  peakR.style.display = 'none';
  svg.appendChild(peakR);
  const peakL = mk('circle');
  peakL.setAttribute('r', 4); peakL.setAttribute('class', 'gauge-peak');
  peakL.style.display = 'none';
  svg.appendChild(peakL);

  const needle = mk('g');
  const nline = mk('line');
  nline.setAttribute('x1', cx); nline.setAttribute('y1', cy);
  nline.setAttribute('x2', cx); nline.setAttribute('y2', cy - (r - 30));
  nline.setAttribute('class', 'gauge-needle');
  nline.setAttribute('stroke-width', '5');
  nline.setAttribute('stroke-linecap', 'round');
  needle.appendChild(nline);
  const hub = mk('circle');
  hub.setAttribute('cx', cx); hub.setAttribute('cy', cy); hub.setAttribute('r', 8);
  hub.setAttribute('class', 'gauge-hub');
  needle.appendChild(hub);
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
    el.setAttribute('cx', 130 + 96 * Math.cos(ang));
    el.setAttribute('cy', 130 - 96 * Math.sin(ang));
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
  state.mount = s.mount || 'landscape-left';
  state.invertLean = !!s.invertLean;
  state.wakeLockOn = s.wakeLockOn !== false;
  state.camAlerts = s.camAlerts !== false;
  state.camDist = s.camDist || 400;
  /* Validato contro la lista, non `|| default`: il valore finisce interpolato nella
     query Overpass, e un localStorage modificato a mano non deve poterci scrivere. */
  state.camRadius = CAM_RADIUS_CHOICES.indexOf(s.camRadius) >= 0 ? s.camRadius : CAM_RADIUS_DEFAULT;
  state.navVoice = s.navVoice !== false;
  state.navNoHw = !!s.navNoHw;
  state.navNoToll = !!s.navNoToll;
  state.navBackroads = !!s.navBackroads;
  state.navNoFerry = !!s.navNoFerry;
  state.compassOffset = s.compassOffset || 0;
  state.gyroFusion = s.gyroFusion !== false;
  state.camAhead = s.camAhead !== false;
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
  els.camAheadChk.checked = state.camAhead;
  /* Le calibrazioni salvate prima della riscrittura dell'attitudine non sono piu'
     valide: leanFromUp usava la proiezione xy invece della base, quindi una base
     costruita allora e' consistente solo col vecchio estrattore. */
  const c = store.get('cruscotto.calib', null);
  if (c && c.v === 2) { state.calib = calibBasis(c); updateCalibStatus(); }
  else if (c) {
    store.del('cruscotto.calib');
    setTimeout(() => toast('Filtro piega aggiornato: rifai la calibrazione (moto ferma e dritta).', 'err', 8000), 800);
  }
}

function saveSettings() {
  store.set('cruscotto.settings', {
    mount: state.mount, invertLean: state.invertLean, wakeLockOn: state.wakeLockOn,
    camAlerts: state.camAlerts, camDist: state.camDist, camRadius: state.camRadius,
    compassOffset: state.compassOffset,
    gyroFusion: state.gyroFusion, camAhead: state.camAhead, theme: state.theme,
    navVoice: state.navVoice, navNoHw: state.navNoHw, navNoToll: state.navNoToll,
    navBackroads: state.navBackroads, navNoFerry: state.navNoFerry
  });
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
  if (els.metaTheme) els.metaTheme.content = resolved === 'light' ? '#eef2f6' : '#0a0e14';
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
    cls = 'err'; txt = 'Autovelox offline';
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
