'use strict';
/* js/display.js (step 30): switchTab, demo state/tickDemo, setTxt/setAttr, mapHudModel/updateMapHud, updateDisplay, setBar, mainLoop. init resta inline. Ordine: dopo js/misc.js. */
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
    logAcc.speedFus += state.speedFusMs;
    if (state.leanKin != null) { logAcc.leanKin += state.leanKin; logAcc.leanKinN++; }
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
  /* Solo a registrazione attiva, come i massimi in updateDisplay e come il ramo
     GPS (js/inputs.js): prima la distanza demo continuava a crescere dopo lo Stop,
     e il display divergeva dalla sessione salvata (meta.distKm). */
  if (state.logging) state.session.distKm += (state.speedMs * dt) / 1000;
  appendTrackPoint(lat, lon, 120);
  checkCameras();
  updateMap();
}

function setTxt(el, s) {
  s = String(s);
  if (!el || el.textContent === s) return;
  el.textContent = s;
}

/* Come setTxt, per gli attributi dei nodi SVG dell'HUD: a DISPLAY_HZ riscrivere
   lo stesso valore invalida comunque lo stile del nodo e ridipinge l'arco. */
function setAttr(el, k, v) {
  if (!el || el.getAttribute(k) === v) return;
  el.setAttribute(k, v);
}

/* Ora locale HH:MM: la usano l'orologio dell'header e quello dell'HUD (in
   fullscreen l'header sparisce, e sul manubrio l'ora serve). */
function clockHm() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function guidaActive() {
  return !!(state.guidaAlways
    || state.logging
    || document.body.classList.contains('map-fullscreen')
    || (state.nav && state.nav.status === 'ACTIVE')
    || state.speedKph >= 15);
}

function updateGuidaMode() {
  // Cache del verdetto: a 15 Hz classList.toggle scrive l'attributo di classe
  // anche quando nulla è cambiato (updateDisplay la chiama a ogni tick).
  const on = guidaActive();
  if (state._guidaOn === on) return;
  state._guidaOn = on;
  document.body.classList.toggle('guida', on);
}

/* Isteresi dell'HUD: lo stato si accende alla soglia del cruscotto e si spegne
   un po' prima. Il GPS balla di un km/h e leanConf segue la vibrazione: a
   cavallo della soglia la cifra piu' grande lampeggerebbe proprio mentre la si
   guarda. */
const MAP_HUD_OVER_HYST_KMH = 1;
const MAP_HUD_CONF_LOW = 0.33;   // stessa soglia di .lean-conf.bad (updateDisplay)
const MAP_HUD_CONF_OK = 0.45;
const MAP_HUD_CONF_HI = 0.66;    // stessa soglia di .lean-conf.warn (updateDisplay)
const MAP_HUD_CONF_HI_OFF = 0.60;

/* Pura: stato -> stringhe pronte per l'HUD. Verso, limite, affidabilita' e NaN
   si decidono qui e si testano senza DOM; updateMapHud scrive e basta. `prev` e'
   il modello del giro prima (null al primo): serve solo all'isteresi, passato
   esplicito invece che parcheggiato in state.
   Gli archi valgono 60 unita' (raggio 180/pi e pathLength=60 nel markup): il
   dasharray e' in gradi e qui non si ripetono ne' raggio ne' centro. */
function mapHudModel(st, prev) {
  // isFinite(null) e' true (null vale 0): per i campi che possono essere null
  // (leanKin, l'accuratezza GPS) serve il controllo esplicito.
  const num = v => v != null && isFinite(v);
  const cal = !!(st.demo || st.calib);
  // Mai "NaN 60" nel dasharray: e' un attributo SVG non valido.
  const ok = cal && num(st.lean);
  const a = ok ? Math.abs(st.lean) : 0;
  // Sotto 1° niente verso e niente arco, come l'etichetta del cruscotto.
  const side = a < 1 ? '' : (st.lean > 0 ? 'r' : 'l');
  // Stesso arrotondamento del testo (toFixed(0)): arco e "50°" dicono la stessa cosa.
  const fill = Math.min(60, Math.round(a));
  const lim = st.speedLimit;
  const margin = SPEED_LIMIT_OVER_KMH - (prev && prev.over ? MAP_HUD_OVER_HYST_KMH : 0);
  const over = lim != null && st.speedKph > lim + margin;
  const c = clamp01(st.leanConf);
  const lowconf = cal && (prev && prev.lowconf ? c < MAP_HUD_CONF_OK : c <= MAP_HUD_CONF_LOW);
  // Tre livelli come la barra del cruscotto, con isteresi anche sul confine
  // alto: a 0.66 le tacche cambierebbero colore a ogni vibrazione.
  const confLvl = !cal ? ''
    : (lowconf ? 'low'
      : (c > (prev && prev.confLvl === 'hi' ? MAP_HUD_CONF_HI_OFF : MAP_HUD_CONF_HI) ? 'hi' : 'mid'));
  // Stato GPS: in fullscreen gpsDot/gpsTxt dell'header sono nascosti, e se il
  // fix cade l'unico sintomo e' che velocita' e piega si fermano (la fusione
  // inerziale manda avanti la velocita' per un po', quindi non si nota subito).
  // 'lost': c'era un fix e da GPS_LOST_MS non ne arrivano (velocità congelata).
  const gs = (st.demo || st.gpsStatus === 'ok') ? (!st.demo && st.gpsLostS != null ? 'lost' : 'ok')
    : (st.gpsStatus === 'err' ? 'err' : 'wait');
  const gps = st.demo ? 'DEMO'
    : gs === 'err' ? (st.gpsDenied ? 'GPS NEGATO' : 'NO GPS')
      : gs === 'lost' ? 'PERSO ' + (st.gpsLostS < 60 ? st.gpsLostS + 's' : Math.floor(st.gpsLostS / 60) + 'min')
      : gs === 'ok' ? (num(st.gps && st.gps.acc) ? '±' + Math.round(st.gps.acc) + 'm' : 'GPS OK')
        : 'GPS…';
  // Beccheggio: positivo = muso in su. Sotto 1° e' rumore, e senza calibrazione
  // l'assetto non c'e': niente numero finto.
  const p = st.pitch;
  const pitch = (cal && num(p) && Math.abs(p) >= 1)
    ? (p > 0 ? '▲' : '▼') + Math.abs(p).toFixed(0) + '°' : '';
  let cls = 'map-hud';
  cls += cal ? ' cal' : ' nocal';
  if (cal && side) cls += ' lean-' + side;
  if (confLvl) cls += ' conf-' + confLvl;
  if (lowconf) cls += ' lowconf';
  // A 3 cifre (110, 130) il cartello stringe il font invece di allargarsi.
  if (lim == null) cls += ' nolim';
  else if (String(lim).length > 2) cls += ' lim3';
  if (over) cls += ' over';
  if (st.logging) cls += ' rec';
  cls += ' gps-' + gs;
  // Marcatore sull'arco: rotazione attorno al centro del quadrante (il <g> e'
  // gia' traslato li'), nascosto fino a 1° come in setPeaks.
  const mark = v => num(v) && Math.abs(v) > 1
    ? 'rotate(' + Math.sign(v) * Math.min(60, Math.round(Math.abs(v))) + ')' : '';
  const peak = (d, sgn) => mark(sgn * Math.abs(d));
  const mxL = st.session.maxLeanL, mxR = st.session.maxLeanR;
  return {
    cls, over, lowconf, confLvl,
    lean: ok ? a.toFixed(0) : '--',
    dir: cal ? '' : 'non calibrato',
    dashL: (side === 'l' ? fill : 0) + ' 60',
    dashR: (side === 'r' ? fill : 0) + ' 60',
    peakL: peak(mxL, -1),
    peakR: peak(mxR, 1),
    maxL: Math.abs(mxL).toFixed(0) + '°',
    maxR: Math.abs(mxR).toFixed(0) + '°',
    gps,
    pitch,
    kin: mark(st.leanKin),
    speed: String(Math.round(st.speedKph)),
    // distKm puo' essere NaN su uno storico recuperato: meglio "0.00" che "NaN km".
    dist: (isFinite(st.session.distKm) ? st.session.distKm : 0).toFixed(2) + ' km',
    limit: lim == null ? '' : String(lim),
  };
}

let mapHudPrev = null;   // modello del giro prima: solo per l'isteresi
let mapHudErr = false;   // errore HUD gia' loggato (vedi updateDisplay)

/* Marcatore sull'arco (massimo di sessione, piega cinematica): e' un attributo e
   non una classe, perche' su un nodo SVG il CSS batterebbe l'attributo. */
function mapHudMark(el, t) {
  setAttr(el, 'visibility', t ? 'visible' : 'hidden');
  if (t) setAttr(el, 'transform', t);
}

/* HUD in basso a sinistra della mappa fullscreen: in fullscreen il cruscotto non
   c'e' piu', quindi piega (arco, verso, massimi) e velocita' col limite vanno
   ripetuti qui, piu' i km di sessione, e le tre cose che altrimenti sparivano
   con l'header: REC, stato GPS e ora. Esce subito fuori dal fullscreen: gira a
   DISPLAY_HZ e scrivere
   nodi invisibili e' solo batteria. I colori li decide il CSS da UNA classe sul
   contenitore (prima className e style.color partivano a ogni tick anche a
   valori fermi); il resto passa da setTxt/setAttr: a valori fermi, zero
   scritture nel DOM. Mai className sui nodi SVG: li' e' in sola lettura e in
   strict mode assegnarlo lancia. */
function updateMapHud() {
  // Uscendo dal fullscreen l'isteresi non ha piu' senso: al rientro il primo
  // giro riparte dalle soglie piene invece di trascinarsi lo stato di prima.
  if (!els.mapHud || !document.body.classList.contains('map-fullscreen')) { mapHudPrev = null; return; }
  const m = mapHudModel(state, mapHudPrev);
  mapHudPrev = m;
  if (els.mapHud.className !== m.cls) els.mapHud.className = m.cls;
  setTxt(els.mhLeanVal, m.lean);
  setTxt(els.mhLeanDir, m.dir);
  setTxt(els.mhMaxL, m.maxL);
  setTxt(els.mhMaxR, m.maxR);
  setTxt(els.mhSpeedVal, m.speed);
  setTxt(els.mhDist, m.dist);
  setTxt(els.mhGps, m.gps);
  setTxt(els.mhPitch, m.pitch);
  setTxt(els.mhClock, clockHm());
  setTxt(els.mhLimit, m.limit);   // vuoto = limite ignoto, nascosto da .nolim
  setAttr(els.mhArcL, 'stroke-dasharray', m.dashL);
  setAttr(els.mhArcR, 'stroke-dasharray', m.dashR);
  mapHudMark(els.mhKin, m.kin);
  mapHudMark(els.mhPeakL, m.peakL);
  mapHudMark(els.mhPeakR, m.peakR);
}

function updateDisplay() {
  // Prima dell'HUD: gpsLostS serve a mapHudModel. Solo con pagina visibile
  // (mainLoop salta updateDisplay a documento nascosto), come vuole il watchdog.
  const nowP = performance.now();
  state.gpsLostS = gpsLostSeconds(state, nowP);
  gpsWatchdog(nowP);
  autoLogTick(nowP);
  setTxt(els.speedVal, Math.round(state.speedKph));
  updateGuidaMode();
  if (els.clock) setTxt(els.clock, clockHm());
  if (els.speedAlt) {
    const alt = state.gps && state.gps.alt;
    setTxt(els.speedAlt, (alt != null && isFinite(alt)) ? Math.round(alt) + ' m' : '');
  }
  if (els.speedLimit) {
    const lim = state.speedLimit;
    if (lim == null) {
      els.speedLimit.style.display = 'none';
      els.speedLimit.textContent = '';
      els.speedLimit.classList.remove('over');
    } else {
      els.speedLimit.style.display = '';
      setTxt(els.speedLimit, String(lim));
      els.speedLimit.classList.toggle('over', state.speedKph > lim + SPEED_LIMIT_OVER_KMH);
    }
  }

  if (state.demo || state.calib) {
    els.leanVal.textContent = Math.abs(state.lean).toFixed(1);
    if (Math.abs(state.lean) < 1) {
      els.leanDir.textContent = ' '; els.leanDir.className = 'lean-dir';
      els.leanVal.style.fill = 'var(--text)';
    } else if (state.lean > 0) {
      els.leanDir.textContent = 'DESTRA ▶'; els.leanDir.className = 'lean-dir right';
      els.leanVal.style.fill = 'var(--accent)';
    } else {
      els.leanDir.textContent = '◀ SINISTRA'; els.leanDir.className = 'lean-dir left';
      els.leanVal.style.fill = 'var(--good)';
    }
  } else {
    // Non calibrato: CALIBRA e' un bottone che porta dritto a startCalibration.
    // Si crea UNA volta: la guardia su firstChild era morta perché textContent=''
    // svuotava i figli prima di valutarla, quindi a 15 Hz il DOM ricreava
    // bottone+listener a ogni frame (proprio lo scenario che DISPLAY_HZ dovrebbe
    // evitare: telefono al sole sul manubrio).
    els.leanVal.textContent = '--';
    els.leanVal.style.fill = 'var(--text-3)';
    if (!els.leanDir.firstChild || els.leanDir.firstChild.id !== 'leanCalibBtn') {
      els.leanDir.textContent = '';
      els.leanDir.className = 'lean-dir';
      if (!document.getElementById('leanCalibBtn')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'leanCalibBtn';
        b.textContent = 'CALIBRA';
        b.addEventListener('click', () => startCalibration());
        els.leanDir.appendChild(b);
      }
    }
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
  setTxt(els.lonVal, (state.lonG >= 0 ? '+' : '') + state.lonG.toFixed(2));
  setTxt(els.vertVal, (state.vertG >= 0 ? '+' : '') + state.vertG.toFixed(2));
  setBar(els.latBar, state.latG, latAbs, 1.2);
  setBar(els.lonBar, state.lonG, lonAbs, 1.2);
  setBar(els.vertBar, state.vertG, vertAbs, 2.0); // verticale picca 3-4G su buche/frenate: 1.2 la teneva a fondo scala

  /* Massimi e cronometro avanzano solo a registrazione attiva.
     Prima session.start veniva impostato già al boot: dopo lo Stop il tempo
     continuava a correre e i massimi si aggiornavano ancora — Demo inclusa. */
  if (state.logging) {
    state.session.maxSpeed = Math.max(state.session.maxSpeed, state.speedKph);
    state.session.maxLeanR = Math.max(state.session.maxLeanR, state.lean);
    state.session.maxLeanL = Math.min(state.session.maxLeanL, state.lean);
  }
  setTxt(els.statMaxSpeed, Math.round(state.session.maxSpeed));
  /* setTxt e non .textContent = ...: updateDisplay gira a DISPLAY_HZ e questi
     cinque valori cambiano raramente (la distanza a passi di 0.01 km, il tempo
     una volta al secondo). Assegnare textContent a ogni frame invalida il nodo
     e il layout anche quando la stringa è identica — e il resto della funzione
     passa già da setTxt. */
  setTxt(els.statDist, state.session.distKm.toFixed(2));
  setTxt(els.maxLeanR, Math.abs(state.session.maxLeanR).toFixed(0) + '°');
  setTxt(els.maxLeanL, Math.abs(state.session.maxLeanL).toFixed(0) + '°');
  let dur = 0;
  if (state.session.startWall) {
    const end = state.logging ? Date.now() : (state.session.endWall || state.session.startWall);
    dur = Math.max(0, (end - state.session.startWall) / 1000);
  }
  const mm = String(Math.floor(dur / 60)).padStart(2, '0');
  const ss = String(Math.floor(dur % 60)).padStart(2, '0');
  setTxt(els.statTime, mm + ':' + ss);
  setTxt(els.topTime, mm + ':' + ss);

  /* L'HUD e' un di piu': un suo errore non deve fermare il cruscotto. mainLoop
     rimette in coda requestAnimationFrame solo in fondo, quindi un throw qui
     congelerebbe tutto (in fullscreen, in marcia, anche l'HUD). Log una volta:
     a 15 Hz sarebbe solo rumore. */
  try { updateMapHud(); } catch (e) {
    if (!mapHudErr) { mapHudErr = true; console.warn('[hud]', e); }
  }
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
  // Tab nascosta: su alcuni Android con schermo acceso rAF continua a girare —
  // skip totale (demo, display, chart) invece del solo tickDemo. Batteria/calore
  // sul manubrio. Al ritorno in visibilità il primo frame ridisegna subito.
  if (document.hidden) { requestAnimationFrame(mainLoop); return; }
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
