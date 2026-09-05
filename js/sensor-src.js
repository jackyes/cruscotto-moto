'use strict';
/* js/sensor-src.js (step 21): sorgenti sensori (setupSensors, sensorSrc, start/stopGenericSensors, startDeviceMotion, addListeners, checkSecureContext). Ordine: dopo js/video.js. */
function setupSensors() {
  const needPerm = (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    || (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function');
  if (needPerm) {
    els.permBtn.style.display = 'block';
    els.permBtn.addEventListener('click', async () => {
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') await DeviceOrientationEvent.requestPermission();
        if (typeof DeviceMotionEvent.requestPermission === 'function') await DeviceMotionEvent.requestPermission();
      } catch (e) {}
      els.permBtn.style.display = 'none';
      addListeners();
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



function stopGenericSensors() {
  for (const s of sensorSrc.list) { try { s.stop(); } catch (e) {} }
  sensorSrc.list = [];
  sensorSrc.acc = sensorSrc.gyro = sensorSrc.grav = sensorSrc.lin = null;
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
      if (n === 'NotAllowedError' || n === 'NotReadableError' || n === 'SecurityError') {
        // Se cade l'accelerometro cade tutto: si ripiega su devicemotion.
        if (sen === sensorSrc.acc) { stopGenericSensors(); startDeviceMotion(); }
      }
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
    sensorSrc._gyro = { x: g.x * RAD2DEG, y: g.y * RAD2DEG, z: g.z * RAD2DEG };
  });
  sensorSrc.grav = mk(window.GravitySensor, function () {
    const g = this;
    if (g.x == null) return;
    sensorSrc._grav = { x: g.x, y: g.y, z: g.z };
  });
  sensorSrc.lin = mk(window.LinearAccelerationSensor, function () {
    const a = this;
    if (a.x == null) return;
    sensorSrc._lin = { x: a.x, y: a.y, z: a.z };
  });

  /* L'accelerometro fa da orologio: ogni sua lettura produce un campione, usando
     l'ultimo valore noto degli altri sensori. Le letture arrivano separate, quindi
     l'alternativa sarebbe attenderle tutte e perdere campioni quando una manca. */
  sensorSrc.acc = mk(window.Accelerometer, function () {
    const a = this;
    if (a.x == null) return;
    processSample({
      acc:  { x: a.x, y: a.y, z: a.z },
      gyro: sensorSrc._gyro || null,
      grav: sensorSrc._grav || null,
      lin:  sensorSrc._lin || null,
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastMotionT = 0;
      state._attU = null;
      state._spHist = null;
    }
  });

  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(onGeolocation, onGeolocationErr, {
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
