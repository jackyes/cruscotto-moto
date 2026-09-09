'use strict';
/* js/sensors-pipe.js (step 12): pipeline sensori (resetSensorFilters, processSample). Usa state/logAcc/lastMotionT (core) + tutte le fns sensors-core/accel-fusion/calib. toast() a runtime. Ordine: dopo js/accel-fusion.js. */
function resetSensorFilters() {
  state._accHist = null;
  state._accLP = null;
  state._accLP2 = null;   // LP di riferimento per la metrica di adattamento
  state._vibPow = null;
  state._vibPow2 = null;
  state._wLP = null;
  state._accBiq = null;   // stato del passa-basso 2° ordine sull'accelerometro
  state._yawFilt = null;  // imbardata filtrata per la compensazione centripeta
  state._yawFilt2 = null;
  state._yawPow = null;
  state.gyroBias = null;
  state._biasSum = 0; state._biasN = 0; state._biasT = 0;
  state.vibG = 0; state.vibHiG = 0;
  state.vibAdaptG = 0;
  state.gRatio = 1;
  state.leanConf = 1;
  state.vibRectG = 0;
  state._rectEma = null;
  state.vibScaleVal = 1;
  state.attKp = ATT_KP;
  state.gravAgreeDeg = null;
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
  state._resLat = null;
  state._resLon = null;
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

/* Un vettore con una componente non-finito (NaN/Infinity) è un campione difettoso. */
function finiteVec(v) { return !!(v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z)); }

/* Saturazione simmetrica del giroscopio. Hoisted fuori da processSample: una
   chiusura allocata a ogni campione (fino a 60 Hz) è puro lavoro del GC. */
function gyroSat(v) {
  return v > LEAN_GYRO_MAX_DPS ? LEAN_GYRO_MAX_DPS : (v < -LEAN_GYRO_MAX_DPS ? -LEAN_GYRO_MAX_DPS : v);
}

function processSample(sm) {
  if (state.demo) return;
  const nowP = sm.t;
  // Orologio performance per i confronti col resto del sistema (speedGpsT è
  // performance.now()): sm.t è il timestamp del sensore (HAL Android col
  // Generic Sensor API) e vive in un dominio temporale diverso — confrontarli
  // direttamente faceva scattare (o non scattare mai) i gate di stallo GPS.
  const nowPerf = performance.now();
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
    // I filtri non ponticano il gap: _accLP/_wLP contengono lo stato pre-buco,
    // i buffer mediana/despike interpolano fra campioni di prima e di dopo —
    // i primi campioni dopo la ripresa uscirebbero con piega spuria.
    state._accLP = null;
    state._wLP = null;
    state._accBiq = null;
    state._yawFilt = null;
    state._yawFilt2 = null;
    state._yawPow = null;
    state._accLP2 = null;
    state._vibPow2 = null;
    state._hbuf = null;
    state._vibPow = null;
    state._accHist = null;
    return;
  }

  /* Campione sporco (NaN/Infinity da Generic Sensor API dopo sospensione/ripresa
     del sensore): un solo valore non-finito corromperebbe ogni filtro EMA per il
     resto della sessione (attitudeReference → null, attTrust → 0, piega degradata
     a sola integrazione giroscopica). L'accelerometro difettoso butta via tutto il
     campione; giroscopio/lin/grav difettosi si azzerano soltanto. */
  if (sm.acc && !finiteVec(sm.acc)) {
    state._attU = null; state._gsPrev = null; state.attRef = 'none';
    return;
  }
  if (sm.gyro && !finiteVec(sm.gyro)) sm.gyro = null;
  if (sm.lin && !finiteVec(sm.lin)) sm.lin = null;
  if (sm.grav && !finiteVec(sm.grav)) sm.grav = null;

  const ig = sm.acc;
  const m = MOUNT[state.mount];
  const B = state.calib;

  /* Velocita' angolare, vettoriale. Saturazione simmetrica (non azzeramento: mettere
     a zero i picchi e' un filtro asimmetrico e in curva i picchi cadono piu' spesso da
     un lato, quindi iniettava un errore direzionale). */
  /* Scratch riusati a ping-pong: prima ogni campione (60 Hz) allocava 2-4 oggetti
     vettore (grezzo, filtrato, Wc) — GC continuo sul main thread. */
  const wRaw = state._wRaw || (state._wRaw = { x: 0, y: 0, z: 0 });
  let W = wRaw;
  W.x = 0; W.y = 0; W.z = 0;
  state.hasGyro = !!sm.gyro;
  if (sm.gyro) {
    wRaw.x = gyroSat(sm.gyro.x) * state.gyroSign;
    wRaw.y = gyroSat(sm.gyro.y) * state.gyroSign;
    wRaw.z = gyroSat(sm.gyro.z) * state.gyroSign;
    // Passa-basso sul VETTORE prima dell'integrazione: riduce la varianza che
    // alimenta il random walk. tau base 40 ms (adattivo con la vibrazione),
    // ritardo trascurabile in ingresso curva. EMA del 1° ordine, NON il biquad
    // 2° ordine dell'accelerometro: sul giroscopio la fase conta di piu'
    // (l'integrale e' il canale veloce della piega) e il biquad, a parita' di
    // tau, ritardava la chicane (misurato: +1° di errore dinamico).
    const tauW = GYRO_LP_TAU_S * vibScale();
    const aW = dt / (tauW + dt);
    const lp = state._wLP;
    if (lp) {
      const wF = state._wFlt || (state._wFlt = { x: 0, y: 0, z: 0 });
      wF.x = lp.x + (wRaw.x - lp.x) * aW;
      wF.y = lp.y + (wRaw.y - lp.y) * aW;
      wF.z = lp.z + (wRaw.z - lp.z) * aW;
      state._wFlt = lp;         // il vecchio stato filtro diventa il prossimo scratch
      state._wLP = wF;
      W = wF;
    } else {
      // Primo campione: lo stato filtro prende il buffer grezzo; il prossimo
      // campione usera' l'altro buffer come scratch (mai due alias sullo stato).
      state._wLP = wRaw;
      state._wRaw = state._wFlt || null;
      state._wFlt = null;
      W = wRaw;
    }
  }

  /* LP dedicato sull'imbardata attorno alla verticale del telaio. L'errore
     della compensazione centripeta e' v·δω_up/g: a 20 m/s un grado/s di rumore
     su yaw costa 2° di piega — il canale piu' sensibile di tutto il filtro. Si
     filtra la sola COMPONENTE lungo B.up: rollio e beccheggio di W restano
     intatti (i picchi di rollio in ingresso curva non vanno smussati), e B e'
     la calibrazione, non l'attitudine — nessun anello di feedback. */
  let Wc = W;
  if (B && sm.gyro) {
    /* Filtro sull'imbardata guidato dal RUMORE del canale stesso, non dalla
       vibrazione dell'accelerometro. Un filtro veloce (tau 0.05 s) segue la ψ̇
       reale con ritardo trascurabile; il residuo fra yaw grezzo e quel filtro
       E' la stima del rumore: su una ψ̇ pulita (chicane) e' ~0, su rumore
       bianco e' quasi tutto il rumore. Il tau del filtro lento che alimenta la
       compensazione centripeta cresce con quel rumore — cosi' la dinamica paga
       solo quando il canale e' davvero sporco, e l'errore v·δω_up/g resta
       contenuto proprio dove piu' costa. */
    const yawRaw = vdot(W, B.up);
    const aY0 = dt / (YAW_LP_BASE_S + dt);
    state._yawFilt = (state._yawFilt == null) ? yawRaw : state._yawFilt + aY0 * (yawRaw - state._yawFilt);
    const rY = yawRaw - state._yawFilt;
    const aP = dt / (VIB_TAU_S + dt);
    state._yawPow = (state._yawPow == null) ? rY * rY : state._yawPow + aP * (rY * rY - state._yawPow);
    const tauY = YAW_LP_TAU_S * clamp01(Math.sqrt(state._yawPow) / YAW_NOISE_MAX_DPS);
    const aY = dt / (Math.max(tauY, 0.02) + dt);
    state._yawFilt2 = (state._yawFilt2 == null) ? yawRaw : state._yawFilt2 + aY * (yawRaw - state._yawFilt2);
    if (state._yawFilt2 !== yawRaw) {
      // Inline sul scratch: vadd+vscale allocavano 2 vettori per campione.
      const d = state._yawFilt2 - yawRaw;
      const wc = state._wcTmp || (state._wcTmp = { x: 0, y: 0, z: 0 });
      wc.x = W.x + B.up.x * d;
      wc.y = W.y + B.up.y * d;
      wc.z = W.z + B.up.z * d;
      Wc = wc;
    }
  }

  /* Filtro vettoriale sull'accelerometro: mediana (impulsi) poi passa-basso (norma).
     hypot() e' non lineare, quindi su rumore a media nulla la norma non si media a g:
     filtrare il VETTORE e poi prenderne la norma e' l'unico ordine che cancella
     davvero il rumore. */
  let Am = ig, aLP = null;
  if (ig) {
    pushAccHist(ig);
    Am = medianAcc() || ig;
    /* Passa-basso 2° ordine, tau adattivo: sotto vibrazione si allunga e la
       norma (non lineare) legge di meno il rumore rettificato. L'ordine del
       filtro e' vettoriale: il vettore si filtra, la norma si prende dopo. */
    const tauA = ACC_LP_TAU_S * vibScale();
    if (state._accBiq) aLP = biquadStep(state._accBiq, Am, dt, tauA);
    else { state._accBiq = {}; aLP = biquadInit(state._accBiq, Am, dt, tauA); }
    state._accLP = aLP;
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
  state.yawUp = (sm.gyro && state._attU) ? vdot(Wc, state._attU) : state.gyroYaw;

  /* Fermo accertato con evidenza POSITIVA: fix GPS fresco che riporta velocita' bassa,
     piu' assenza di rotazione, piu' vibrazione bassa. Il test precedente era di fatto
     `speedMs === 0`, che scattava anche quando il GPS semplicemente non riportava la
     velocita' — cioe' a 100 km/h dopo una galleria, mandando 2 s di rollio VERO dentro
     lo stimatore di bias. */
  const gpsFresh = (nowPerf - state.speedGpsT) < SPEED_STALE_MS;
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
    const ok = updateAttitude(aLP || Am, W, B, dt, Wc);
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
  let hasNat = false, gNat = null;
  if (sm.lin && ig) { hasNat = true; gNat = vsub(ig, sm.lin); }
  else if (sm.grav && ig) { hasNat = true; gNat = sm.grav; }
  const own = (ig && state._attU) ? vsub(ig, vscale(state._attU, G)) : null;
  state.gravAgreeDeg = null;
  if (state.gravityMode === 'own' && own) {
    la = own; state.gravNative = false;
  } else if (hasNat) {
    la = sm.lin ? sm.lin : vsub(ig, sm.grav);
    state.gravNative = true;
    /* Cross-check in 'auto': la fusione di piattaforma non e' tarata per la
       vibrazione del motore. Si confronta la gravita' nativa con la propria
       attitudine (g·û): se divergono in direzione o in norma, la nativa si
       butta. La diagnostica mostra l'angolo di disaccordo. */
    if (state.gravityMode === 'auto' && own && gNat) {
      const mn = vlen(gNat);
      if (mn > 1e-6) {
        const ang = Math.acos(clamp01(vdot(gNat, state._attU) / mn)) * 180 / Math.PI;
        state.gravAgreeDeg = ang;
        if (ang > GRAV_AGREE_DEG || Math.abs(mn / G - 1) > GRAV_AGREE_G) {
          la = own; state.gravNative = false;
        }
      }
    }
  } else if (own) {
    la = own; state.gravNative = false;
  } else {
    state.gravNative = false;
  }
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
    /* Rettificazione MEMS: sotto vibrazione la massa sismica induce un offset
       DC. updateRectDetector stima la media sistematica di vertG in condizioni
       in cui dovrebbe valere ~0; la correzione e' opzionale e limitata, la
       stima resta sempre visibile in diagnostica e nel CSV. */
    updateRectDetector(dt);
    if (state.rectNull && state._rectEma != null && Math.abs(state._rectEma) <= RECT_NULL_MAX_G) {
      state.vertG = clampG(state.vertG - state._rectEma);
    }
    updateAccelFusion(dt);
  }

  /* ---- Velocita' fusa, propagata a ogni campione ---- */
  propagateSpeed(dt, nowPerf);

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
  logAcc.vibRect += state.vibRectG;
  logAcc.latPk = keepPeak(logAcc.latPk, state.latG);
  logAcc.lonPk = keepPeak(logAcc.lonPk, state.lonG);
  logAcc.vertPk = keepPeak(logAcc.vertPk, state.vertG);
}
