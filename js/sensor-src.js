'use strict';
/* js/sensor-src.js (step 21): sorgenti sensori (setupSensors, sensorSrc, start/stopGenericSensors, startDeviceMotion, addListeners, checkSecureContext). Ordine: dopo js/video.js. */
function setupSensors() {
  const needPerm = (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    || (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function');
  if (needPerm) {
    els.permBtn.style.display = 'block';
    els.permBtn.addEventListener('click', async () => {
      // Su iOS requestPermission() risolve con 'granted'/'denied' senza mai
      // lanciare: ignorare il valore risolto lasciava l'utente senza sensori per
      // tutta la sessione (bottone nascosto, nessun errore, serve reload).
      let granted = true;
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function')
          granted = (await DeviceOrientationEvent.requestPermission()) === 'granted' && granted;
        if (typeof DeviceMotionEvent.requestPermission === 'function')
          granted = (await DeviceMotionEvent.requestPermission()) === 'granted' && granted;
      } catch (e) { granted = false; }
      if (granted) {
        els.permBtn.style.display = 'none';
        addListeners();
      } else {
        els.permBtn.textContent = 'Permesso negato — tocca per riprovare';
        toast('Permesso sensori negato: tocca per riprovare o abilitalo nelle impostazioni.', 'err', 6000);
      }
    });
    return;
  }
  addListeners();
}



/* ====================== Sorgente sensori ======================

   Due percorsi dietro la stessa interfaccia, entrambi che sfociano in processSample().

   1. Generic Sensor API (Chrome/Android). NON compra frequenza: Chromium fissa
      kMaxAllowedFrequency = 60 Hz per tutti i sensori spaziali e Blink clampa in
      silenzio una richiesta piu' alta. Compra tre cose diverse:
        - sensor.timestamp e' il tempo di CAMPIONAMENTO hardware (SensorEvent.timestamp
          del HAL Android) sullo stesso orologio di performance.now(): e' il dt
          autorevole per l'integrazione, invece del tempo di arrivo;
        - Blink emette un evento solo quando il timestamp cambia davvero, quindi niente
          campioni ripetuti spacciati per nuovi;
        - GravitySensor / LinearAccelerationSensor mappano su TYPE_GRAVITY e
          TYPE_LINEAR_ACCELERATION di Android, che la CDD impone siano assistiti dal
          giroscopio quando il giroscopio esiste — una fusione vera, non un passa-basso.
          Se il HAL non li espone, Chromium ripiega su una propria fusione che E'
          letteralmente un passa-basso del prim'ordine: va rilevato, non assunto.

   2. devicemotion (iOS/Safari, Firefox, e ripiego generale). Percorso storico invariato.

   Nessuno dei due supera i 60 Hz, quindi Nyquist resta 30 Hz e l'aliasing della
   vibrazione motore sopra quella soglia resta cosa da supporto smorzato. */

const sensorSrc = { list: [], acc: null, gyro: null, grav: null, lin: null };

/* L'accelerometro fa da orologio, ma se Gyroscope/Gravity/Linear si fermano
   (sospensione, errore, sensor lazy) la cache qui sotto resta congelata
   all'ultimo valore: il campione integrerebbe per sempre un ω vecchio spacciato
   per vivo e la attitudine marcirebbe in silenzio. >500 ms = assente. */
const SAT_STALE_MS = 500;
function freshSat(e) {
  return (e && typeof e.t === 'number' && (performance.now() - e.t) < SAT_STALE_MS) ? e : null;
}



function stopGenericSensors() {
  for (const s of sensorSrc.list) { try { s.stop(); } catch (e) {} }
  sensorSrc.list = [];
  sensorSrc.acc = sensorSrc.gyro = sensorSrc.grav = sensorSrc.lin = null;
  sensorSrc.gyroLast = sensorSrc.gravLast = sensorSrc.linLast = null;
}

/* Teardown completo (demo, cambio sorgente): chiude Generic Sensor, listener
   devicemotion/orientation e il watchPosition del GPS. Senza, sensori e GPS
   restavano vivi anche quando nessuno li consuma (demo accesa, permesso revocato). */
let watchId = null;
function onVisChange() {
  if (document.visibilityState === 'visible') {
    lastMotionT = 0;
    state._attU = null;
    state._spHist = null;
  }
}
function stopSensors() {
  stopGenericSensors();
  try { window.removeEventListener('devicemotion', onDeviceMotion, true); } catch (e) {}
  try { window.removeEventListener('deviceorientation', onDeviceOrientation, true); } catch (e) {}
  try { window.removeEventListener('deviceorientationabsolute', onDeviceOrientation, true); } catch (e) {}
  try { document.removeEventListener('visibilitychange', onVisChange); } catch (e) {}
  if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} watchId = null; }
  state._listenersOn = false;
}

function startGenericSensors() {
  if (!('Accelerometer' in window) || !window.isSecureContext) return false;

  const mk = (Ctor, onRead) => {
    if (typeof Ctor !== 'function') return null;
    let sen;
    try {
      // SecurityError da Permissions Policy e' SINCRONO dal costruttore, non un evento.
      sen = new Ctor({ frequency: 60, referenceFrame: 'device' });
    } catch (e) { return null; }
    sen.addEventListener('error', ev => {
      const n = ev.error && ev.error.name;
      // Se cade l'accelerometro cade tutto (è l'orologio): si ripiega su devicemotion.
      if (sen === sensorSrc.acc) { stopGenericSensors(); startDeviceMotion(); return; }
      // Gyro/grav/lin morti: prima l'errore era scartato senza traccia e la cache
      // restava congelata all'ultimo valore. Si azzera il sensore: il campione
      // successivo lo vede null invece di un ω vecchio spacciato per vivo.
      try { console.warn('sensore fermo (' + n + '): ' + (sen && sen.constructor && sen.constructor.name)); } catch (e) {}
      const idx = sensorSrc.list.indexOf(sen);
      if (idx >= 0) sensorSrc.list.splice(idx, 1);
      if (sen === sensorSrc.gyro) { sensorSrc.gyro = null; sensorSrc.gyroLast = null; }
      else if (sen === sensorSrc.grav) { sensorSrc.grav = null; sensorSrc.gravLast = null; }
      else if (sen === sensorSrc.lin) { sensorSrc.lin = null; sensorSrc.linLast = null; }
      try { sen.stop(); } catch (e) {}
    });
    sen.addEventListener('reading', onRead);
    try { sen.start(); } catch (e) { return null; }
    sensorSrc.list.push(sen);
    return sen;
  };

  const RAD2DEG = 180 / Math.PI;
  sensorSrc.gyro = mk(window.Gyroscope, function () {
    const g = this;
    if (g.x == null) return;
    sensorSrc.gyroLast = { x: g.x * RAD2DEG, y: g.y * RAD2DEG, z: g.z * RAD2DEG, t: performance.now() };
  });
  sensorSrc.grav = mk(window.GravitySensor, function () {
    const g = this;
    if (g.x == null) return;
    sensorSrc.gravLast = { x: g.x, y: g.y, z: g.z, t: performance.now() };
  });
  sensorSrc.lin = mk(window.LinearAccelerationSensor, function () {
    const a = this;
    if (a.x == null) return;
    sensorSrc.linLast = { x: a.x, y: a.y, z: a.z, t: performance.now() };
  });

  /* L'accelerometro fa da orologio: ogni sua lettura produce un campione, usando
     l'ultimo valore noto degli altri sensori. Le letture arrivano separate, quindi
     l'alternativa sarebbe attenderle tutte e perdere campioni quando una manca. */
  sensorSrc.acc = mk(window.Accelerometer, function () {
    const a = this;
    if (a.x == null) return;
    processSample({
      acc:  { x: a.x, y: a.y, z: a.z },
      gyro: freshSat(sensorSrc.gyroLast),
      grav: freshSat(sensorSrc.gravLast),
      lin:  freshSat(sensorSrc.linLast),
      t:    (typeof a.timestamp === 'number' && isFinite(a.timestamp)) ? a.timestamp : performance.now(),
    });
  });

  if (!sensorSrc.acc) { stopGenericSensors(); return false; }
  state.sensorSrc = 'generic';
  return true;
}

function startDeviceMotion() {
  if (!window.DeviceMotionEvent) { state.sensorSrc = 'none'; return false; }
  window.addEventListener('devicemotion', onDeviceMotion, true);
  state.sensorSrc = 'devicemotion';
  return true;
}

function addListeners() {
  // Guardia anti-doppio-aggancio: su iOS un doppio tap sul permBtn lancia il
  // click handler due volte (requestPermission risolve subito 'granted' la
  // seconda), e il vecchio codice aggiungeva TUTTI i listener due volte:
  // ogni lettura arrivava duplicata, con dt≈0 il secondo campione azzerava
  // _attU a ogni giro e l'attitudine restava morta per tutta la sessione.
  if (state._listenersOn) return;
  state._listenersOn = true;
  if (!startGenericSensors()) startDeviceMotion();

  if (window.DeviceOrientationEvent) {
    // 'deviceorientationabsolute' è l'unico che dà un alpha riferito al nord su Android
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onDeviceOrientation, true);
    }
    window.addEventListener('deviceorientation', onDeviceOrientation, true);
  }

  /* I sensori Generic vengono sospesi quando il documento non e' visibile: alla
     ripresa la stima di attitudine e' vecchia di secondi e va reinizializzata.
     Il campionamento del log lo segnala gia' da solo con gap=1. */
  document.addEventListener('visibilitychange', onVisChange);

  if (navigator.geolocation) {
    // id salvato: senza, clearWatch era impossibile e il GPS restava acceso
    // anche quando nessuno consumava i fix (es. Demo).
    watchId = navigator.geolocation.watchPosition(onGeolocation, onGeolocationErr, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 10000
    });
  } else {
    state.gpsStatus = 'err'; updateGpsStatus();
  }
}

function checkSecureContext() {
  if (window.isSecureContext) return;
  els.secWarn.style.display = 'block';
  els.secWarn.textContent =
    'Pagina non in contesto sicuro (HTTPS). GPS e sensori resteranno inattivi. ' +
    'Servi il file via HTTPS (GitHub Pages / Vercel / Netlify), non aprirlo con file://.';
}
