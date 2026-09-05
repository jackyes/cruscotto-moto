'use strict';
/* js/sensors-pipe.js (step 12): pipeline sensori (resetSensorFilters, processSample). Usa state/logAcc/lastMotionT (core) + tutte le fns sensors-core/accel-fusion/calib. toast() a runtime. Ordine: dopo js/accel-fusion.js. */
function resetSensorFilters() {
  state._accHist = null;
  state._accLP = null;
  state._vibPow = null;
  state._wLP = null;
  state.gyroBias = null;
  state._biasSum = 0; state._biasN = 0; state._biasT = 0;
  state.vibG = 0; state.vibHiG = 0;
  state.gRatio = 1;
  state.leanConf = 1;
  // attitudine
  state._attU = null;
  state._attLastNorm = null;
  state.attBias = { x: 0, y: 0, z: 0 };
  state.leanBias = 0;
  state.attTrust = 0;
  state.attRef = 'none';
  state.pitch = 0;
  state.leanKin = 0;
  state.gyroYaw = 0;
  state.yawUp = 0;
  state._gsPrev = null;
  state.gyroSignLocked = false;
  // accelerazioni: buffer despike, offset, riferimenti GPS e fusione
  state._hbuf = null;
  state.accBias = null;
  state._abPending = false;
  state._lpLat = null;
  state._lpLon = null;
  state._lpLatGps = null;
  state._lpLonGps = null;
  state._pv = null;
  state._pvT = null;
  state._phdg = null;
  state.latGps = null;
  state.lonGps = null;
  state.latFus = 0;
  state.lonFus = 0;
  // velocita' fusa
  state._spHist = null;
  state._spCorrT = 0;
  state._aInt = 0;
  state._spBase = null;
  state.speedFusMs = state.speedMs || 0;
}

function processSample(sm) {
  if (state.demo) return;
  const nowP = sm.t;

  /* Base dei tempi. Con la Generic Sensor API `t` e' il timestamp hardware del HAL
     Android, non l'istante di consegna: e' il dt autorevole. Con devicemotion resta
     il tempo di arrivo, quindi il controllo di plausibilita' serve comunque. */
  let dt = (nowP - lastMotionT) / 1000;
  lastMotionT = nowP;
  const dtOk = dt > 0.0005 && dt < 0.25;

  state._evtN = (state._evtN || 0) + 1;
  if (!state._rateT0) state._rateT0 = nowP;
  if (nowP - state._rateT0 >= 1000) {
    state.sensorHz = state._evtN * 1000 / (nowP - state._rateT0);
    state._evtN = 0; state._rateT0 = nowP;
  }

  /* Un buco (schermo spento, cambio app, sensore sospeso) non e' un dt lungo: e'
     rotazione persa. Prima la predizione veniva saltata ma la correzione proporzionale
     restava applicata a guadagno pieno, quindi l'accelerometro tirava la piega verso
     il proprio valore — che in curva e' zero. Ora si salta l'intero aggiornamento e la
     stima viene reinizializzata dal riferimento. */
  if (!dtOk) {
    state._attU = null;
    state._gsPrev = null;
    state.attRef = 'none';
    return;
  }

  const ig = sm.acc;
  const m = MOUNT[state.mount];
  const B = state.calib;

  /* Velocita' angolare, vettoriale. Saturazione simmetrica (non azzeramento: mettere
     a zero i picchi e' un filtro asimmetrico e in curva i picchi cadono piu' spesso da
     un lato, quindi iniettava un errore direzionale). */
  let W = { x: 0, y: 0, z: 0 };
  state.hasGyro = !!sm.gyro;
  if (sm.gyro) {
    const sat = v => v > LEAN_GYRO_MAX_DPS ? LEAN_GYRO_MAX_DPS : (v < -LEAN_GYRO_MAX_DPS ? -LEAN_GYRO_MAX_DPS : v);
    W = vscale({ x: sat(sm.gyro.x), y: sat(sm.gyro.y), z: sat(sm.gyro.z) }, state.gyroSign);
    // Passa-basso leggero sul VETTORE prima dell'integrazione: riduce la varianza che
    // alimenta il random walk. tau 40 ms, ritardo trascurabile in ingresso curva.
    const a = dt / (0.04 + dt);
    state._wLP = state._wLP ? vadd(state._wLP, vscale(vsub(W, state._wLP), a)) : W;
    W = state._wLP;
  }

  /* Filtro vettoriale sull'accelerometro: mediana (impulsi) poi passa-basso (norma).
     hypot() e' non lineare, quindi su rumore a media nulla la norma non si media a g:
     filtrare il VETTORE e poi prenderne la norma e' l'unico ordine che cancella
     davvero il rumore. */
  let Am = ig, aLP = null;
  if (ig) {
    pushAccHist(ig);
    Am = medianAcc() || ig;
    const a = dt / (ACC_LP_TAU_S + dt);
    state._accLP = state._accLP ? vadd(state._accLP, vscale(vsub(Am, state._accLP), a)) : Am;
    aLP = state._accLP;
    updateVibration(ig, dt);
    state.gRatio = vlen(aLP) / G;
    /* La calibrazione cattura il vettore gravita' dal PASSA-BASSO, non dalla mediana:
       la mediana toglie gli impulsi ma lascia la vibrazione del motore, che a minimo
       fa sbandare la direzione del verticale e fa scattare il gate di dispersione. */
    state._lastUp = upVector(aLP || Am);
    collectCalib();
  }

  /* Proiezioni nel frame moto, disponibili anche prima dell'attitudine. */
  if (B && sm.gyro) {
    state.gyroRoll = vdot(W, B.fwd);
    state.gyroYaw  = vdot(W, B.up);
  } else if (sm.gyro) {
    state.gyroRoll = W.z; state.gyroYaw = 0;
  } else {
    state.gyroRoll = 0; state.gyroYaw = 0;
  }
  /* psi_punto attorno alla verticale vera, non attorno all'asse su del telaio: in
     piega i due differiscono di cos(phi), e in curva a regime vale tan(phi)=v*psi/g,
     quindi usare quello sbagliato sbaglia la piega cinematica di atan(sin(phi))
     invece di phi — 3,4 gradi a 30 gradi di piega. u E' la verticale in coordinate
     telefono, quindi la proiezione e' diretta. */
  state.yawUp = (sm.gyro && state._attU) ? vdot(W, state._attU) : state.gyroYaw;

  /* Fermo accertato con evidenza POSITIVA: fix GPS fresco che riporta velocita' bassa,
     piu' assenza di rotazione, piu' vibrazione bassa. Il test precedente era di fatto
     `speedMs === 0`, che scattava anche quando il GPS semplicemente non riportava la
     velocita' — cioe' a 100 km/h dopo una galleria, mandando 2 s di rollio VERO dentro
     lo stimatore di bias. */
  const gpsFresh = (nowP - state.speedGpsT) < SPEED_STALE_MS;
  state.stopped = gpsFresh && state.speedGpsMs != null && state.speedGpsMs < STOP_SPEED_MS
    && Math.abs(state.gyroRoll) < STOP_ROLL_DPS && state.vibG < STOP_VIB_G;

  // Bias di rollio da fermo: resta solo come indicatore diagnostico. La correzione
  // vera la fa il termine integrale vettoriale di updateAttitude.
  if (state.stopped && sm.gyro) {
    state._biasSum = (state._biasSum || 0) + state.gyroRoll;
    state._biasN = (state._biasN || 0) + 1;
    state._biasT = (state._biasT || 0) + dt;
    if (state._biasT >= 2) {
      const bm = state._biasSum / state._biasN;
      state.gyroBias = (state.gyroBias == null) ? bm : state.gyroBias + 0.2 * (bm - state.gyroBias);
      state._biasSum = 0; state._biasN = 0; state._biasT = 0;
    }
  } else { state._biasSum = 0; state._biasN = 0; state._biasT = 0; }

  /* ---- Attitudine ---- */
  if (ig && B) {
    const ok = updateAttitude(aLP || Am, W, B, dt);
    if (ok) {
      const u = state._attU;
      let lean = leanFromUp(u, B);
      let pitch = pitchFromUp(u, B);
      if (state.invertLean) lean = -lean;
      state.lean = Math.max(-80, Math.min(80, lean));
      state.pitch = pitch;
      state.leanBias = vdot(state.attBias, B.fwd);
    }
    /* Il verdetto sul segno del giroscopio sta FUORI dal ramo "attitudine aggiornata":
       con il segno invertito l'attitudine è sbagliata e può non inizializzarsi affatto,
       quindi legarlo al suo esito lo renderebbe irraggiungibile proprio nel caso in cui
       serve. Dipende solo dall'accelerometro grezzo e dal giroscopio grezzo.
       Si impara a BASSA VELOCITÀ: sopra i pochi m/s l'angolo accelerometrico è
       dominato dalla forza centrifuga e la sua derivata non segue più il rollio (in
       curva a regime è identicamente zero). Da fermo o a passo d'uomo l'accelerometro
       È la piega: bastano i primi metri, o il montaggio del telefono sul supporto. */
    let leanAccRaw = leanFromUp(upVector(aLP || Am), B);
    if (state.invertLean) leanAccRaw = -leanAccRaw;
    if (updateGyroSign(state.gyroRoll, leanAccRaw, dt,
      state.speedFusMs < CENTRIP_MIN_MS && Math.abs(state.gRatio - 1) < ATT_TOL_G))
      toast('Segno del giroscopio corretto automaticamente.', null, 5000);
    state.leanConf = clamp01(1 - state.vibG / LEAN_VIB_MAX) * (0.5 + 0.5 * state.attTrust);
  } else if (ig && !B) {
    state._attU = null;
    state.lean = 0; state.pitch = 0;
  }

  /* ---- Accelerazioni nel frame moto ----
     La gravita' non viene piu' da un passa-basso con congelamento: viene dalla
     soluzione di attitudine (g*u per costruzione) o dalla fusione di piattaforma.
     Il vecchio percorso aveva un caso patologico documentato: sopra 30 gradi di piega
     il residuo verticale superava la soglia di freeze e la stima restava congelata li'
     in permanenza. */
  let la = null;
  if (sm.lin) { la = sm.lin; state.gravNative = true; }
  else if (sm.grav && ig) { la = vsub(ig, sm.grav); state.gravNative = true; }
  else if (ig && state._attU) { la = vsub(ig, vscale(state._attU, G)); state.gravNative = false; }
  else if (ig) { la = null; state.gravNative = false; }
  state.accelDerived = !state.gravNative;

  if (la) {
    let lat, lon, vert;
    if (B) {
      lat  = vdot(la, B.right) / G;
      lon  = vdot(la, B.fwd)   / G;
      vert = vdot(la, B.up)    / G;
    } else {
      lat  = axis(la, m.lat)  / G;
      lon  = axis(la, m.lon)  / G;
      vert = axis(la, m.vert) / G;
    }
    if (!state._hbuf) state._hbuf = { lat: {}, lon: {}, vert: {} };
    lat  = despike(state._hbuf.lat,  lat);
    lon  = despike(state._hbuf.lon,  lon);
    vert = despike(state._hbuf.vert, vert);
    if (state.accBias) { lat -= state.accBias.lat; lon -= state.accBias.lon; vert -= state.accBias.vert; }
    state.latG = clampG(lat);
    state.lonG = clampG(lon);
    state.vertG = clampG(vert);
    collectAccBias(dt);
    updateAccelFusion(dt);
  }

  /* ---- Velocita' fusa, propagata a ogni campione ---- */
  propagateSpeed(dt, nowP);

  /* Piega cinematica: stima INDIPENDENTE dall'accelerometro e dall'integrazione.
     In curva a regime vale atan(v*psi_punto/g) = phi. Serve da verifica incrociata
     in analisi: se lean_deg e lean_kin_deg divergono, una delle due sta sbagliando. */
  if (state.speedFusMs > CENTRIP_MIN_MS) {
    const kin = Math.atan(state.speedFusMs * (-state.yawUp * Math.PI / 180) / G) * 180 / Math.PI;
    state.leanKin = state.invertLean ? -kin : kin;
  } else state.leanKin = 0;

  // (1) accumulo per la decimazione anti-alias del log — solo a registrazione attiva
  if (!state.logging) return;
  logAcc.n++;
  logAcc.lean += state.lean;
  logAcc.latG += state.latG;
  logAcc.lonG += state.lonG;
  logAcc.vertG += state.vertG;
  logAcc.gyro += state.gyroRoll;
  logAcc.vib += state.vibG;
  logAcc.latFus += state.latFus;
  logAcc.lonFus += state.lonFus;
  logAcc.pitch += state.pitch;
  logAcc.yaw += state.gyroYaw;
  logAcc.speedFus += state.speedFusMs;
  logAcc.leanKin += state.leanKin;
  logAcc.vibHi += state.vibHiG;
  logAcc.latPk = keepPeak(logAcc.latPk, state.latG);
  logAcc.lonPk = keepPeak(logAcc.lonPk, state.lonG);
  logAcc.vertPk = keepPeak(logAcc.vertPk, state.vertG);
}
