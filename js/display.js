'use strict';
/* js/display.js (step 30): switchTab, demo state/tickDemo, setTxt, updateDisplay, setBar, mainLoop. init resta inline. Ordine: dopo js/misc.js. */
function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  document.querySelectorAll('nav.tabbar button').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (name === 'map') {
    if (state.mapType === 'leaflet' && state.map) setTimeout(() => { state.map.invalidateSize(); applyMapRotation(); }, 50);
    else if (state.mapType === 'canvas') drawCanvasMap();
  } else if (name === 'charts') {
    drawCharts();
  } else if (name === 'history') {
    renderHistory();
  } else if (name === 'nav') {
    renderNavPanel();
  }
}

let demoStart = null;
let demoLast = null;


function tickDemo(now) {
  if (!state.demo) return;
  if (demoStart == null) { demoStart = now; demoLast = now; }
  const dt = Math.min(0.25, Math.max(0, (now - demoLast) / 1000));
  demoLast = now;
  const t = (now - demoStart) / 1000;
  const lean = 38 * Math.sin(t * 0.45) * Math.sin(t * 0.13 + 0.6);
  state.lean = lean;
  const speed = 70 + 45 * Math.sin(t * 0.31 + 1.0) * Math.sin(t * 0.11);
  state.speedKph = Math.max(0, speed);
  state.speedMs = state.speedKph / 3.6;
  state.latG = Math.tan(lean * Math.PI / 180);
  state.lonG = 0.18 * Math.sin(t * 0.7);
  state.vertG = 0.05 * Math.sin(t * 2.2);
  // Rateo di rollio coerente con la piega simulata (derivata analitica), così le
  // colonne gyro_roll_dps e la piega cinematica non sono più inventate a zero.
  const dLean = 38 * (0.45 * Math.cos(t * 0.45) * Math.sin(t * 0.13 + 0.6)
                    + 0.13 * Math.sin(t * 0.45) * Math.cos(t * 0.13 + 0.6));
  state.gyroRoll = dLean;
  state.pitch = 3 * Math.sin(t * 0.09);
  // Imbardata da curva coordinata: ψ̇ = g·tan(φ)/v, negativa a destra (regola destrorsa)
  const vms = Math.max(1, state.speedMs);
  state.yawUp = -(G * Math.tan(lean * Math.PI / 180) / vms) * 180 / Math.PI;
  state.gyroYaw = state.yawUp * Math.cos(lean * Math.PI / 180);
  state.leanKin = lean;
  state.speedFusMs = state.speedMs;
  state.speedGpsMs = state.speedMs; // la colonna CSV speed_ms resta "velocità GPS" anche in demo
  // valori di qualità sintetici, così il pannello diagnostica è leggibile anche in demo
  state.vibG = 0.05 + 0.04 * Math.abs(Math.sin(t * 3));
  state.vibHiG = state.vibG;
  state.gRatio = 1 / Math.cos(lean * Math.PI / 180);
  state.leanConf = 1; state.attTrust = 1;
  state.attRef = 'centrip'; state.sensorSrc = 'demo'; state.sensorHz = 60;
  state.latGps = state.latG * 0.95; state.lonGps = state.lonG * 0.95;
  state.latFus = state.latG; state.lonFus = state.lonG;
  if (state.logging) {
    logAcc.n++;
    logAcc.lean += state.lean; logAcc.latG += state.latG;
    logAcc.lonG += state.lonG; logAcc.vertG += state.vertG;
    logAcc.gyro += state.gyroRoll; logAcc.vib += state.vibG;
    logAcc.latFus += state.latFus; logAcc.lonFus += state.lonFus;
    logAcc.pitch += state.pitch; logAcc.yaw += state.gyroYaw;
    logAcc.speedFus += state.speedFusMs; logAcc.leanKin += state.leanKin;
    logAcc.vibHi += state.vibHiG;
    logAcc.latPk = keepPeak(logAcc.latPk, state.latG);
    logAcc.lonPk = keepPeak(logAcc.lonPk, state.lonG);
    logAcc.vertPk = keepPeak(logAcc.vertPk, state.vertG);
  }
  // camere sintetiche demo (test banner/beep)
  if (!state.cameras.length) {
    state.cameras = [
      { lat: 45.0005, lon: 9.0005, maxspeed: '50', name: 'Demo cam 1' },
      { lat: 45.0015, lon: 8.9995, maxspeed: '70', name: 'Demo cam 2' },
    ];
    rebuildCamGrid();
    renderCameras();
  }
  // traccia in movimento (spirale attorno a 45.0,9.0)
  const lat = 45.0 + 0.025 * Math.sin(t * 0.05) * (1 + t * 0.002);
  const lon = 9.0 + 0.035 * Math.cos(t * 0.05) * (1 + t * 0.002);
  state.gps = { lat, lon, alt: 120, heading: (t * 18) % 360, acc: 5 };
  state.pos.lat = lat; state.pos.lon = lon;
  state.gpsStatus = 'ok';
  state.session.lastPos = state.session.lastPos || { lat, lon };
  // dt reale: il passo fisso 0.05 s presupponeva frame da 50 ms, rAF ne dà ~16,7
  state.session.distKm += (state.speedMs * dt) / 1000;
  appendTrackPoint(lat, lon, 120);
  checkCameras();
  updateMap();
}

function setTxt(el, s) {
  s = String(s);
  if (!el || el.textContent === s) return;
  el.textContent = s;
}

function updateDisplay() {
  setTxt(els.speedVal, Math.round(state.speedKph));

  if (state.demo || state.calib) {
    els.leanVal.textContent = Math.abs(state.lean).toFixed(1);
    if (Math.abs(state.lean) < 1) { els.leanDir.textContent = ' '; els.leanDir.className = 'lean-dir'; }
    else if (state.lean > 0) { els.leanDir.textContent = 'DESTRA'; els.leanDir.className = 'lean-dir right'; }
    else { els.leanDir.textContent = 'SINISTRA'; els.leanDir.className = 'lean-dir left'; }
  } else {
    els.leanVal.textContent = '--';
    els.leanDir.textContent = 'CALIBRA';
    els.leanDir.className = 'lean-dir';
  }
  setNeedle(state.lean);
  setPeaks(state.session.maxLeanR, Math.abs(state.session.maxLeanL));

  // Affidabilità della piega: non corregge nulla, ma rende visibile quando la
  // vibrazione sta degradando la misura invece di lasciarlo indovinare.
  if (state.calib || state.demo) {
    const c = clamp01(state.leanConf);
    els.leanConfFill.style.width = (c * 100).toFixed(0) + '%';
    els.leanConf.classList.toggle('warn', c <= 0.66 && c > 0.33);
    els.leanConf.classList.toggle('bad', c <= 0.33);
    els.leanConfTxt.textContent = 'affidabilità ' + (c > 0.66 ? 'alta' : c > 0.33 ? 'media' : 'bassa');
  } else {
    els.leanConfFill.style.width = '0%';
    els.leanConf.classList.remove('warn', 'bad');
    els.leanConfTxt.textContent = 'affidabilità —';
  }
  updateDiag();

  if (state.accelDerived && !state._accelWarned) {
    state._accelWarned = true;
    toast('Accelerazione lineare non esposta dal device: valori ricavati dalla gravità stimata.', null, 6000);
  }

  const latAbs = Math.abs(state.latG), lonAbs = Math.abs(state.lonG), vertAbs = Math.abs(state.vertG);
  setTxt(els.latVal, (state.latG >= 0 ? '+' : '') + state.latG.toFixed(2));
  els.lonVal.textContent = (state.lonG >= 0 ? '+' : '') + state.lonG.toFixed(2);
  els.vertVal.textContent = (state.vertG >= 0 ? '+' : '') + state.vertG.toFixed(2);
  setBar(els.latBar, state.latG, latAbs, 1.2);
  setBar(els.lonBar, state.lonG, lonAbs, 1.2);
  setBar(els.vertBar, state.vertG, vertAbs, 1.2);

  /* Massimi e cronometro avanzano solo a registrazione attiva.
     Prima session.start veniva impostato già al boot: dopo lo Stop il tempo
     continuava a correre e i massimi si aggiornavano ancora — Demo inclusa. */
  if (state.logging) {
    state.session.maxSpeed = Math.max(state.session.maxSpeed, state.speedKph);
    state.session.maxLeanR = Math.max(state.session.maxLeanR, state.lean);
    state.session.maxLeanL = Math.min(state.session.maxLeanL, state.lean);
  }
  setTxt(els.statMaxSpeed, Math.round(state.session.maxSpeed));
  els.statDist.textContent = state.session.distKm.toFixed(2);
  els.maxLeanR.textContent = Math.abs(state.session.maxLeanR).toFixed(0) + '°';
  els.maxLeanL.textContent = Math.abs(state.session.maxLeanL).toFixed(0) + '°';
  let dur = 0;
  if (state.session.startWall) {
    const end = state.logging ? Date.now() : (state.session.endWall || state.session.startWall);
    dur = Math.max(0, (end - state.session.startWall) / 1000);
  }
  const mm = String(Math.floor(dur / 60)).padStart(2, '0');
  const ss = String(Math.floor(dur % 60)).padStart(2, '0');
  els.statTime.textContent = mm + ':' + ss;
  els.topTime.textContent = mm + ':' + ss;

  updateGpsStatus();
  updateCamStatus();
}

function setBar(el, val, absVal, maxG) {
  const pct = Math.min(100, (absVal / maxG) * 50);
  el.style.width = pct + '%';
  el.style.left = (val >= 0 ? '50%' : (50 - pct) + '%');
  el.className = 'fill' + (val < 0 ? ' neg' : '');
}

function mainLoop(now) {
  tickDemo(now);
  // Il refresh UI è throttlato: a 60 Hz erano ~20 scritture DOM per frame, con il
  // telefono al sole sul manubrio è batteria e calore per nulla.
  if (now - lastDisplayT >= 1000 / DISPLAY_HZ) {
    lastDisplayT = now;
    updateDisplay();
  }
  const nowP = performance.now();
  // Il campionamento del log vive su setInterval (vedi sampleTick): rAF si ferma
  // a schermo spento e scala col frame rate.
  if (nowP - lastChartT >= 100) {
    lastChartT = nowP;
    sampleCharts(nowP);
    if (state.currentTab === 'charts') drawCharts();
  }
  requestAnimationFrame(mainLoop);
}
