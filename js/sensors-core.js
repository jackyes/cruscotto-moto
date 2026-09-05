'use strict';
/* js/sensors-core.js (step 6): nucleo sensori/attitude (despike, clampG/01, pushBounded, speed-fusion, attitudeReference/Attitude, updateGyroSign). Usa state/logAcc da js/core.js. No DOM. */
function despike(st, x) {
  if (!st.b) st.b = [];
  st.b.push(x);
  if (st.b.length < 3) return x;      // riscaldamento
  if (st.b.length > 3) st.b.shift();
  const a = st.b[0], b = st.b[1], c = st.b[2];
  const dA = b - a, dC = b - c;
  const isolato =
    Math.abs(dA) > DESPIKE_G && Math.abs(dC) > DESPIKE_G &&  // salta via da entrambi i vicini
    (dA > 0) === (dC > 0) &&                                  // e torna indietro: non è un fronte
    Math.abs(c - a) < DESPIKE_RATIO * Math.min(Math.abs(dA), Math.abs(dC));
  return isolato ? (a + c) / 2 : b;
}

const clampG = v => v > ACCEL_LIMIT_G ? ACCEL_LIMIT_G : (v < -ACCEL_LIMIT_G ? -ACCEL_LIMIT_G : v);

/* Coda a blocchi unica: tetto per lunghezza o per tempo. Rimpiazza gli
   shift() O(n) per campione con splice ammortizzato. */
function pushBounded(h, v, max, maxAgeMs, getT) {
  h.push(v);
  if (maxAgeMs != null && getT) {
    const cut = getT(v) - maxAgeMs;
    if (h.length > 1 && getT(h[0]) < cut) {
      let k = 1;
      while (k < h.length - 1 && getT(h[k]) < cut) k++;
      h.splice(0, k);
    }
  } else if (max != null && h.length > max) {
    h.splice(0, h.length - max);
  }
  return h;
}

const clamp01 = v => v < 0 ? 0 : (v > 1 ? 1 : v);

/* Si tiene l'INTEGRALE dell'accelerazione longitudinale, non la velocita'.
   La velocita' e' poi sempre `base + integrale`, dove `base` viene riancorata per
   intero a ogni fix GPS. Cosi' l'errore non si accumula da un fix all'altro: fra due
   fix c'e' la dinamica dell'accelerometro (senza ritardo), a ogni fix c'e' il valore
   assoluto del GPS (senza deriva).
   Un osservatore che invece integra la velocita' e la corregge solo in parte a ogni
   fix si assesta su un errore stazionario quando l'accelerometro ha un offset — e qui
   l'offset c'e' per forza, perche' `lonG` viene da `ig − g·û` e un residuo di
   beccheggio ci si scarica dentro. Misurato: -1,06 m/s a regime, cioe' 3,5 gradi di
   piega di troppo dopo ogni staccata. */
function pushSpeedHist(t, aInt) {
  const h = state._spHist || (state._spHist = []);
  pushBounded(h, { t: t, a: aInt }, null, SPEED_HIST_S * 1000, e => e.t);
}

function aIntAt(t) {
  const h = state._spHist;
  if (!h || !h.length) return null;
  if (t <= h[0].t) return h[0].a;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].t <= t) {
      const b = h[Math.min(i + 1, h.length - 1)];
      if (b.t === h[i].t) return h[i].a;
      const f = (t - h[i].t) / (b.t - h[i].t);
      return h[i].a + f * (b.a - h[i].a);
    }
  }
  return h[h.length - 1].a;
}

/* Propagazione inerziale, un passo per campione sensore. */
function propagateSpeed(dt, nowP) {
  if (state._aInt == null) state._aInt = 0;
  /* Senza un fix fresco che la ancori, l'integrazione dell'accelerometro diverge in
     modo quadratico: dopo qualche secondo di galleria il valore sarebbe peggio di
     nessun valore. Si CONGELA invece di integrare, e chi la consuma (compensazione
     centripeta, piega cinematica) la vede stale e si disattiva. */
  if (nowP - state.speedGpsT > SPEED_STALE_MS) return;

  state._aInt += state.lonG * G * dt;              // frame moto, già proiettata
  pushSpeedHist(nowP, state._aInt);
  if (state._spBase == null) return;
  let v = state._spBase + state._aInt;
  /* Rete di sicurezza: l'estrapolazione inerziale copre il secondo fra un fix e
     l'altro, non discute col GPS. Serve anche a spezzare l'anello
     attitudine → velocità → compensazione centripeta → attitudine. */
  if (state.speedGpsMs != null) {
    const lo = state.speedGpsMs - SPEED_MAX_DEV_MS, hi = state.speedGpsMs + SPEED_MAX_DEV_MS;
    if (v < lo) v = lo; else if (v > hi) v = hi;
  }
  state.speedFusMs = v < 0 ? 0 : v;
}

/* Riancoraggio a ogni fix. tFixP è il tempo del fix sull'orologio performance; il
   valore riportato è però la velocità di GPS_LAG_S secondi prima, quindi la base si
   calcola sull'integrale di ALLORA, non su quello corrente: è così che il ritardo del
   Doppler viene tolto invece di essere ereditato. */
function correctSpeed(vGps, tFixP) {
  if (state._aInt == null) state._aInt = 0;
  const past = aIntAt(tFixP - GPS_LAG_S * 1000);
  state._spBase = vGps - (past != null ? past : state._aInt);
  state._spCorrT = tFixP;
  const v = state._spBase + state._aInt;
  state.speedFusMs = v < 0 ? 0 : v;
}

function attitudeReference(f, w, B, dt) {
  /* Riferimento accelerometrico.

     f e' la forza specifica: f = a_inerziale + g*u. In curva a regime a e' esattamente
     perpendicolare al telaio, quindi f e' parallela a B.up e l'accelerometro grezzo
     legge 0 gradi di piega proprio quando la piega e' massima — il motivo per cui il
     filtro precedente lo spegneva in curva.

     Ma per un veicolo la cui velocita' e' lungo il proprio asse longitudinale (nessuna
     deriva laterale: buona approssimazione per una moto) l'accelerazione inerziale e'
         a = v_punto * F + v * (omega x F)
     ESATTAMENTE — senza piccoli angoli, senza strada piana, senza ipotesi di curva
     coordinata. Sottraendola, il residuo e' gravita' pura e l'accelerometro torna un
     riferimento assoluto valido DENTRO la curva.

     Il prodotto vettoriale va tenuto intero. La scorciatoia "sottraggo solo v*r sul
     laterale" sbaglia di -0,96 / -6,6 / -13,8 gradi a 15 / 30 / 40 gradi di piega,
     con errore che cresce con l'angolo: la componente lungo B.up non e' trascurabile. */
  const v = state.speedFusMs;
  const fresh = (performance.now() - state.speedGpsT) < SPEED_STALE_MS;
  let ref = f, mode = 'raw';
  /* La compensazione richiede omega: senza giroscopio il prodotto vettoriale è nullo
     e il "compensato" sarebbe solo l'accelerometro grezzo con un'etichetta sbagliata.
     Meglio dichiararlo e lasciare che sia il ramo su norma a lavorare. */
  if (fresh && v > CENTRIP_MIN_MS && state.hasGyro) {
    const wr = vscale(w, Math.PI / 180);            // il prodotto vettoriale vuole rad/s
    const c = vcross(wr, B.fwd);                     // = omega_up*B.right - q_left*B.up
    /* v_punto deve venire da una sorgente INDIPENDENTE dall'attitudine, altrimenti si
       chiude un anello: un errore di beccheggio sporca lonG, che sporca v_punto, che
       inclina il riferimento, che peggiora il beccheggio. Misurato: oscillazione di
       +-6 gradi con periodo ~6 s dopo una staccata.
       La derivata della velocita' GPS e' rumorosa e lenta, ma indipendente — e qui il
       requisito e' proprio quello, perche' il termine v_punto*F agisce quasi solo sul
       beccheggio, che sulla piega incide pochissimo. */
    /* Nessun termine v_punto·F.

       In teoria andrebbe sottratta anche l'accelerazione longitudinale. In pratica
       serve una v̇ affidabile e non esiste: quella del GPS è ritardata, quella
       inerziale viene da `lonG`, che dipende dall'attitudine e chiude un anello
       (misurato: +2,0° di errore permanente in curva a regime, contro 0,00° senza).
       Sottrarne una sbagliata è PEGGIO che non sottrarne nessuna, perché cancella in
       parte il residuo di norma e lascia passare un riferimento errato con fiducia
       alta: in staccata 5,0° di errore medio contro 2,9°.
       Lasciandola stare, il residuo si apre da solo — ‖ref‖/g diventa
       √(1+(a_lon/g)²), cioè 1,13 a 0,5 g — la fiducia va a zero e il filtro veleggia
       sul giroscopio per i pochi secondi della manovra. Che è il comportamento
       giusto: durante una staccata l'accelerometro NON sa dove sia il basso, e
       dichiararlo è meglio che indovinare. */
    ref = vsub(f, vscale(c, v));
    mode = 'centrip';
  }
  const mag = vlen(ref);
  if (!(mag > 0.1)) return null;

  /* Senza velocità (galleria, fix perso, GPS che non riporta la velocità) la
     compensazione non è calcolabile — ma la NORMA sa comunque quanto si è carichi:
     in curva coordinata ‖a‖/g = 1/cos(φ), quindi il MODULO della piega resta
     osservabile anche a occhi chiusi. Il segno lo dà l'integrazione del giroscopio.
     Senza questo, il riferimento grezzo punta su B.up (0° di piega) e trascina la
     stima verso l'alto finché il gate di coerenza non lo ferma: misurato, si assesta
     a 24° su una piega vera di 30. Con questo resta sulla piega vera.
     Vale solo in assenza di manovra longitudinale, che sporca la norma allo stesso
     modo di una curva e non è distinguibile da essa senza un riferimento esterno. */
  if (mode === 'centrip') {
    const trust = clamp01(1 - Math.abs(mag / G - 1) / ATT_TOL_G);
    return { u: vscale(ref, 1 / mag), trust: trust, mode: mode };
  }

  /* Da fermo o a passo d'uomo non esiste forza centrifuga: ‖a‖ vale g e l'accelerometro
     è un riferimento PERFETTO. Applicargli l'attesa 1/cos(φ) della curva coordinata,
     come faceva la formula unica, chiudeva il gate proprio dove il dato è migliore —
     e impediva persino al filtro di inizializzarsi mentre si spinge la moto a mano. */
  const slow = v <= CENTRIP_MIN_MS;

  if (!slow && Math.abs(state.lonG) < 0.15) {
    /* Il segno: dal GPS quando dice qualcosa di netto (è indipendente e non deriva),
       altrimenti dall'integrazione del giroscopio. Senza né l'uno né l'altro non c'è
       modo di sapere da che parte si pende, e si resta sul riferimento grezzo. */
    let sgn = 0;
    if (state.latGps != null && Math.abs(state.latGps) > 0.05) sgn = state.latGps < 0 ? -1 : 1;
    else if (state.hasGyro && Math.abs(state.lean) > 2) sgn = state.lean < 0 ? -1 : 1;
    if (sgn) {
      // mag < G (vibrazione, errore LP) rendeva G/mag > 1: clamp lo saturava a 1,
      // acos(1) = 0 e il riferimento collassava sul grezzo trascinando la stima
      // verso l'alto. Sotto g non c'è informazione d'angolo: si congela l'ultimo
      // rotore norm valido invece di inventarne uno a 0°.
      if (mag < G) return state._attLastNorm || null;
      const ang = Math.acos(clamp01(G / mag)) * sgn;
      const rot = vadd(vscale(B.up, Math.cos(ang)), vscale(B.right, Math.sin(ang)));
      const out = { u: rot, trust: NORM_MODE_TRUST, mode: 'norm' };
      state._attLastNorm = out;
      return out;
    }
  }

  /* Gate di coerenza. Il gate precedente confrontava ‖a‖/g con 1 e ALLARGAVA la
     tolleranza con la vibrazione: ma in curva coordinata ‖a‖/g = 1/cos(phi)
     esattamente, cioe' lo scarto da 1 E' la piega travestita. Allargarlo cancellava
     l'unico rilevatore funzionante, ed e' il motivo per cui la piega peggiorava
     quanto piu' la moto vibrava.
     Qui il residuo e' gia' compensato, quindi il valore atteso e' g e lo scarto e'
     errore vero. Con la compensazione attiva non serve piu' nessun gate sul laterale. */
  const expect = slow ? 1 : 1 / Math.max(0.2, Math.cos(state.lean * Math.PI / 180));
  const trust = clamp01(1 - Math.abs(mag / G - expect) / ATT_TOL_G);
  return { u: vscale(ref, 1 / mag), trust: trust, mode: 'raw' };
}

function updateAttitude(f, w, B, dt) {
  const R = attitudeReference(f, w, B, dt);
  if (!state._attU) {
    /* Inizializzazione: mai su un campione grezzo isolato, mai senza riferimento, e
       mai su un riferimento in cui non si crede.
       Quest'ultima condizione non è pedanteria: un'attitudine iniziale sbagliata non
       resta ferma dove è nata, PRECEDE attorno all'asse di curva alla velocità di
       imbardata, quindi un errore di beccheggio si travasa in errore di piega in
       pochi secondi. Misurato partendo in frenata da 0,5 g: 27° di errore di
       beccheggio iniziale diventano 25,6° di errore di PIEGA dopo 4 s, a modulo
       costante. Meglio aspettare un secondo che partire storti. */
    if (!R || R.trust < 0.5 || state._accHist.length < medianWindow()) {
      state.attTrust = R ? R.trust : 0;
      return false;
    }
    state._attU = R.u;
    state.attBias = { x: 0, y: 0, z: 0 };
  }
  const hasGyro = state.hasGyro && state.gyroFusion;
  state.attTrust = R ? R.trust : 0;
  state.attRef = R ? (hasGyro ? R.mode : R.mode) : (hasGyro ? 'gyro' : 'none');

  let u = state._attU;
  /* e = û × û_ref e' l'ASSE della rotazione che porta la stima sul riferimento, con
     modulo sin(angolo). Non e' un incremento da sommare a û: sommarlo direttamente
     sposterebbe û perpendicolarmente all'errore invece che verso il riferimento.
     Va usato come correzione della VELOCITA' ANGOLARE, alla Mahony:
         omega_eff = omega − bias − Kp·e        [rad/s]
         du/dt     = −omega_eff × û
     Con omega_eff = −Kp·e si ottiene infatti −(−Kp e) × û = Kp (e × û), che e'
     esattamente la componente di û_ref perpendicolare a û: il riallineamento giusto. */
  const e = R ? vscale(vcross(u, R.u), R.trust) : { x: 0, y: 0, z: 0 };

  if (hasGyro) {
    /* Integrale: impara il bias quando il riferimento e' credibile e continua ad
       applicarlo quando non lo e' (in curva). Il segno e' POSITIVO: se il giroscopio
       ha un bias b, il termine proporzionale si stabilizza su Kp·e ≈ b, quindi
       accumulare +Ki·e fa convergere la stima su b — non su −b. */
    state.attBias = vadd(state.attBias, vscale(e, ATT_KI * dt * 180 / Math.PI));
    const bmax = ATT_BIAS_MAX_DPS;
    state.attBias.x = Math.max(-bmax, Math.min(bmax, state.attBias.x));
    state.attBias.y = Math.max(-bmax, Math.min(bmax, state.attBias.y));
    state.attBias.z = Math.max(-bmax, Math.min(bmax, state.attBias.z));

    const wEff = vsub(vscale(vsub(w, state.attBias), Math.PI / 180), vscale(e, ATT_KP));
    u = vadd(u, vscale(vcross(wEff, u), -dt));
  } else if (R) {
    // Senza giroscopio non c'e' nulla da propagare: si insegue solo il riferimento.
    const a = dt / (LEAN_SMOOTH_TAU_S + dt);
    u = vadd(u, vscale(vsub(R.u, u), a));
  }
  state._attU = vnorm(u);
  return true;
}

/* Il segno di rotationRate non e' uniforme fra i motori e il README dichiarava la
   costante mai validata. Se e' invertito il giroscopio COMBATTE l'accelerometro:
   in ingresso curva a 60 gradi/s l'errore quasi-statico e' ~50 gradi nel verso
   sbagliato. Qui si misura invece di indovinare: mentre il riferimento e' credibile
   (rettilineo), la correlazione fra rateo di rollio misurato e derivata dell'angolo
   accelerometrico dice il segno. */
function updateGyroSign(rollRate, leanAcc, dt, credible) {
  /* Il gate NON puo' dipendere dalla soluzione di attitudine: con il segno invertito
     l'attitudine e' sbagliata, quindi il suo indice di fiducia resta basso e lo
     stimatore non partirebbe mai. Si usa una condizione che dipende solo
     dall'accelerometro grezzo: norma vicina a g, cioe' assetto quasi dritto, dove
     l'angolo accelerometrico segue davvero il rollio. */
  if (!(dt > 0) || !credible) {
    state._gsPrev = leanAcc;
    // Senza campioni credibili l'evidenza decade invece di congelarsi: il lockout
    // post-verdetto si resetta da solo e un rimontaggio telefono da' nuovo verdetto.
    const decay0 = !(dt > 0) ? 1 : Math.exp(-dt / GSIGN_TAU_S);
    state.gyroSignScore = (state.gyroSignScore || 0) * decay0;
    state.gyroSignEnergy = (state.gyroSignEnergy || 0) * decay0;
    if (state.gyroSignEnergy < GSIGN_MIN_ENERGY) state.gyroSignLocked = false;
    return false;
  }
  if (state.gyroSignLocked) return false;   // verdetto gia' dato e ancora valido
  if (state._gsPrev == null) { state._gsPrev = leanAcc; return false; }
  const dLean = (leanAcc - state._gsPrev) / dt;
  state._gsPrev = leanAcc;
  if (Math.abs(dLean) < 5 || Math.abs(rollRate) < 5) return false;   // troppo fermo: nessuna informazione
  const decay = Math.exp(-dt / GSIGN_TAU_S);
  state.gyroSignScore = state.gyroSignScore * decay + rollRate * dLean * dt;
  state.gyroSignEnergy = state.gyroSignEnergy * decay + Math.abs(rollRate * dLean) * dt;
  if (state.gyroSignEnergy > GSIGN_MIN_ENERGY && state.gyroSignScore < -0.3 * state.gyroSignEnergy) {
    state.gyroSign = -state.gyroSign;
    state.gyroSignScore = 0; state.gyroSignEnergy = 0;
    state.gyroSignLocked = true;
    state._attU = null;                       // la stima precedente e' costruita al contrario
    return true;
  }
  return false;
}
