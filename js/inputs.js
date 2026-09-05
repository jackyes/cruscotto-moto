'use strict';
/* js/inputs.js (step 17): handler input sensori/GPS (accIncG, linearAccel, onDeviceMotion, onDeviceOrientation, onGeolocation, onGeolocationErr). DOM/sensori a runtime. Ordine: dopo js/cams.js. */
function accIncG(e) {
  const a = e.accelerationIncludingGravity;
  if (a && (a.x != null || a.y != null || a.z != null)) return { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
  return null;
}

function linearAccel(e) {
  const a = e.acceleration;
  if (a && (a.x != null || a.y != null || a.z != null)) return { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
  return null;
}

function onDeviceMotion(e) {
  if (state.demo) return;
  const ig = accIncG(e);
  if (!ig) return;
  const rr = e.rotationRate;
  const gyro = (rr && (rr.alpha != null || rr.beta != null || rr.gamma != null))
    ? { x: rr.beta || 0, y: rr.gamma || 0, z: rr.alpha || 0 }   // deg/s, assi device
    : null;
  processSample({ acc: ig, gyro: gyro, grav: null, lin: linearAccel(e), t: performance.now() });
}

function onDeviceOrientation(e) {
  if (state.demo) return;
  /* Bussola device (heading magnetico) → track-up anche da fermo.
     e.alpha di 'deviceorientation' è RELATIVO all'orientamento iniziale su Android:
     usabile come heading solo se l'evento è assoluto (absolute===true o
     'deviceorientationabsolute'), e va convertito con 360−alpha perché alpha cresce
     in senso antiorario. */
  if (e.webkitCompassHeading != null) {
    state.compass = e.webkitCompassHeading;
  } else if (e.alpha != null && (e.absolute === true || e.type === 'deviceorientationabsolute')) {
    state.compass = (360 - e.alpha) % 360;
  }
  if (e.beta == null || e.gamma == null) return;
  const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
  const up = { x: -Math.cos(b) * Math.sin(g), y: Math.sin(b), z: Math.cos(b) * Math.cos(g) };
  const m = Math.hypot(up.x, up.y, up.z) || 1;
  state._lastUpOrient = { x: up.x / m, y: up.y / m, z: up.z / m };
  if (!state._lastUp) state._lastUp = state._lastUpOrient;
}

function onGeolocation(pos) {
  if (state.demo) return;
  const c = pos.coords;

  /* Velocita'.

     `c.speed` e' null ogni volta che il fix non viene dal Doppler GNSS: provider fuso
     su Wi-Fi/cella, primi fix dopo una galleria, pagina in background. Il codice
     precedente scriveva 0 in quel caso, e con l'EMA la velocita' crollava sotto la
     deadband dopo 2-3 fix, restando inchiodata a 0 anche a 100 km/h. Peggio: quel
     valore era il rilevatore di "fermo" per il bias del giroscopio, che quindi si
     accendeva in corsa e mangiava 2 s di rollio VERO come se fosse bias.
     "Velocita' non riportata" e "velocita' zero" adesso sono cose diverse. */
  const nowP = performance.now();
  if (c.speed != null && c.speed >= 0 && isFinite(c.speed)) {
    state.speedGpsMs = c.speed;
    state.speedGpsT = nowP;
    // Tempo del fix sull'orologio performance: pos.timestamp e' epoch.
    const skew = Date.now() - nowP;
    let tFixP = (pos.timestamp ? pos.timestamp - skew : nowP);
    if (!(tFixP > nowP - 5000 && tFixP <= nowP + 500)) tFixP = nowP;
    correctSpeed(c.speed, tFixP);
  }
  // La deadband non scrive piu' nello stato del filtro: si applica solo al valore
  // esposto, altrimenti rende la velocita' bimodale e rompe ogni test su di essa.
  const shown = (state.speedFusMs < SPEED_DEADBAND_MS) ? 0 : state.speedFusMs;
  state.speedMs = shown;
  state.speedKph = shown * 3.6;

  /* Posizione grezza per tutto ciò che è metrico (distanze, traccia, avvisi):
     lo smoothing serve solo a non far ballare il marker. A 130 km/h con fix a 1 Hz
     l'EMA arretra il punto di ~50 m — inaccettabile per un avviso autovelox. */
  state.pos.lat = c.latitude; state.pos.lon = c.longitude;
  if (state.gps.lat == null) {
    state.gps.lat = c.latitude; state.gps.lon = c.longitude;
  } else {
    state.gps.lat = 0.6 * state.gps.lat + 0.4 * c.latitude;
    state.gps.lon = 0.6 * state.gps.lon + 0.4 * c.longitude;
  }
  state.gps.alt = c.altitude; state.gps.heading = c.heading; state.gps.acc = c.accuracy;
  state.gpsStatus = 'ok';
  updateGpsAccel(c, pos.timestamp || Date.now());
  updateGpsStatus();

  maybeLoadCameras(c.latitude, c.longitude);
  checkCameras();
  /* Prima del return per accuratezza scarsa piu' sotto: la navigazione deve vedere
     anche i fix imprecisi, per scartarli con criterio proprio invece che non riceverli. */
  if (state.nav) { navTick(c.latitude, c.longitude, c.accuracy); navRenderBanner(); }

  // Marker/follow si aggiornano a ogni fix, anche se il punto traccia viene scartato:
  // altrimenti in città o da fermo la mappa sembra congelata.
  updateMap();

  // Traccia + distanza: gate su distanza minima + accuratezza (no jitter da fermo)
  const okAcc = c.accuracy == null || c.accuracy <= GPS_ACC_MAX;
  if (!okAcc) return;
  const last = state.session.lastPos;
  if (last) {
    const d = haversine(last, { lat: c.latitude, lon: c.longitude }) * 1000; // m
    if (d >= TRACK_MIN_M) {
      state.session.distKm += d / 1000;
      state.session.lastPos = { lat: c.latitude, lon: c.longitude };
      appendTrackPoint(c.latitude, c.longitude, c.altitude);
    }
  } else {
    state.session.lastPos = { lat: c.latitude, lon: c.longitude };
    appendTrackPoint(c.latitude, c.longitude, c.altitude);
  }
}

function onGeolocationErr() {
  if (state.demo) return;
  state.gpsStatus = 'err';
  updateGpsStatus();
}
