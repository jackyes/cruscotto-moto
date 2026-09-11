'use strict';
/* js/inputs.js (step 17): handler input sensori/GPS (accIncG, linearAccel, onDeviceMotion, onDeviceOrientation, onGeolocation, onGeolocationErr). DOM/sensori a runtime. Ordine: dopo js/cams.js. */
/* Estrazione comune dei due canali accelerometro del devicemotion event. */
function devAccelVec(a) {
  // ?? non ||: un NaN resta NaN e viene buttato dal gate finiteVec a valle,
  // invece di essere mascherato da zero (che è indistinguibile da un valore vero).
  if (a && (a.x != null || a.y != null || a.z != null)) return { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 };
  return null;
}
function accIncG(e) {
  return devAccelVec(e.accelerationIncludingGravity);
}

function linearAccel(e) {
  return devAccelVec(e.acceleration);
}

function onDeviceMotion(e) {
  if (state.demo) return;
  const ig = accIncG(e);
  if (!ig) return;
  const rr = e.rotationRate;
  const gyro = (rr && (rr.alpha != null || rr.beta != null || rr.gamma != null))
    ? { x: rr.beta ?? 0, y: rr.gamma ?? 0, z: rr.alpha ?? 0 }   // deg/s, assi device
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
  // Locale, non su state: _lastUpOrient era scritto e riletto solo qui sotto.
  const upN = { x: up.x / m, y: up.y / m, z: up.z / m };
  if (!state._lastUp) state._lastUp = upN;
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
  const accOk = c.accuracy == null || c.accuracy <= GPS_ACC_MAX;
  /* Plausibilità sul Doppler: un glitch (multipath, provider da cella) entra
     nella finestra di clamp della fusione e resta per sempre in maxSpeed/CSV —
     il fallback da posizione cappa a 150 m/s, il Doppler non aveva tetto. */
  if (c.speed != null && c.speed >= 0 && isFinite(c.speed) && c.speed <= 90) {
    state.speedGpsMs = c.speed;
    state.speedGpsT = nowP;
    // Tempo del fix sull'orologio performance: pos.timestamp e' epoch.
    const skew = Date.now() - nowP;
    let tFixP = (pos.timestamp ? pos.timestamp - skew : nowP);
    if (!(tFixP > nowP - 5000 && tFixP <= nowP + 500)) tFixP = nowP;
    correctSpeed(c.speed, tFixP);
  } else if (accOk && state._lastPosFix) {
    // Fallback da posizione: provider senza velocità Doppler (Wi-Fi/cella, dopo
    // galleria, background). v = d/dt fra due fix, con fiducia più bassa: niente
    // compensazione del lag Doppler (la derivata di posizione vale "adesso").
    const dtS = (nowP - state._lastPosFix.t) / 1000;
    if (dtS >= 1 && dtS <= 5) {
      const d = haversine(state._lastPosFix, { lat: c.latitude, lon: c.longitude }) * 1000;
      const v = d / dtS;
      // Fiducia più bassa: si accetta solo uno spostamento REALE (d > accuratezza,
      // altrimenti il jitter del fix da fermo spaccerebbe una velocità falsa da
      // ~20 km/h) e solo sopra la soglia centripeta — sotto i ~11 km/h la
      // compensazione non serve comunque.
      if (d > (c.accuracy || 0) && v >= CENTRIP_MIN_MS && v < 150) {
        state.speedGpsMs = v;
        state.speedGpsT = nowP;
        correctSpeed(v, nowP, true);
      }
    }
  }
  if (accOk) state._lastPosFix = { lat: c.latitude, lon: c.longitude, t: nowP };
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
  maybeLoadSpeedLimit(c.latitude, c.longitude);
  checkCameras(c.accuracy);
  /* Prima del return per accuratezza scarsa piu' sotto: la navigazione deve vedere
     anche i fix imprecisi, per scartarli con criterio proprio invece che non riceverli. */
  if (state.nav) {
    navTick(c.latitude, c.longitude, c.accuracy);
    navRenderBanner();
    /* Anche il pannello (distanza residua, durata, ETA, lista manovre con il passo
       corrente). renderNavPanel era gia' chiamata a ogni evento di rotta (navStart,
       navStop, navRestore, navSetDest, navMaybeReroute, fine calcolo di rete) e al
       cambio tab, ma l'unico scrittore che ne era privo e' il tick GPS: distRemain,
       timeRemain e nextMan li aggiorna navTick, che nessuno di quegli eventi segue
       a ogni fix. In navigazione reale il pannello restava quindi congelato sui
       valori del calcolo — distanza che non cala, nessun passo marcato done.
       Solo sul tab nav: pannello invisibile, ridisegno inutile. */
    if (state.currentTab === 'nav') renderNavPanel();
  }

  // Marker/follow si aggiornano a ogni fix, anche se il punto traccia viene scartato:
  // altrimenti in città o da fermo la mappa sembra congelata.
  updateMap();

  // Traccia + distanza: gate su distanza minima + accuratezza (no jitter da fermo)
  if (!accOk) return;
  // Solo a log attivo: prima distKm continuava a crescere dopo lo Stop (il display
  // divergeva dalla sessione salvata) e l'export GPX includeva punti post-stop.
  if (!state.logging) return;
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
