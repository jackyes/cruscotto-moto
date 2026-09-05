'use strict';
/* js/nav-engine.js (step 13): motore navigazione (navTick, navMaybeReroute). Usa state + geo pura + navSpeak/render/persist a runtime. Ordine: dopo js/sensors-pipe.js. */
function navTick(pLat, pLon, acc) {
  const nv = state.nav;
  if (!nv || nv.status === 'IDLE') return;
  const now = Date.now();
  const v = state.speedMs || 0;
  const hdg = trackUpHeading();
  const gap = nv.lastFixAt ? (now - nv.lastFixAt) : 0;
  const jump = (nv.lastLat != null) ? distM({ lat: nv.lastLat, lon: nv.lastLon }, { lat: pLat, lon: pLon }) : 0;
  const resumed = gap > 30000;                 // ritorno da background / galleria
  nv.vEMA = nv.vEMA == null ? v : (nv.vEMA + 0.25 * (v - nv.vEMA));
  const vRef = Math.max(5, nv.vEMA);

  // 1. aggancio
  const needFull = nv.lostCount >= NAV_RELOCK_LOST || resumed ||
                   (nv.lastGoodAt && now - nv.lastGoodAt > NAV_RELOCK_GAP_MS) ||
                   jump > NAV_RELOCK_JUMP_M;
  let pr = navProject(nv, pLat, pLon, hdg, v, acc, needFull);
  if (!pr) { nv.lastFixAt = now; return; }
  if (needFull && Math.abs(pr.s - nv.sAlong) > 300) {
    // salto grosso: conferma su due fix prima di adottarlo
    if (nv.pendingS != null && Math.abs(pr.s - nv.pendingS) < 200) { nv.pendingS = null; }
    else { nv.pendingS = pr.s; nv.lastFixAt = now; nv.lastLat = pLat; nv.lastLon = pLon; return; }
  }
  nv.idx = pr.i; nv.segT = pr.t; nv.sAlong = pr.s; nv.offDist = pr.d;
  nv.snapLat = nv.lat[pr.i] + pr.t * (nv.lat[pr.i + 1] - nv.lat[pr.i]);
  nv.snapLon = nv.lon[pr.i] + pr.t * (nv.lon[pr.i + 1] - nv.lon[pr.i]);
  // soglia adattiva: la componente su acc e' il vero freno, senza si ricalcola
  // ogni 15 s in un canyon urbano
  nv.offThr = Math.max(30, Math.min(90, 30 + 1.5 * (acc || 0) + 0.3 * v));
  if (nv.offDist <= nv.offThr) { nv.lastGoodAt = now; nv.lostCount = 0; }
  else nv.lostCount++;

  const travelled = jump;
  const judging = (acc == null || acc <= GPS_ACC_MAX) && !resumed;
  // Senza questo incremento il freno "60 m dall'ultima richiesta" non si sblocca mai
  // e dopo il primo ricalcolo tutti i successivi restano bloccati per sempre.
  nv.travelSinceReroute = (nv.travelSinceReroute || 0) + travelled;

  // 2. fuori percorso — tre rilevatori, tutti prima dell'avanzamento
  let trigger = null;
  if (nv.status === 'ACTIVE' && judging) {
    // A) scarto laterale persistente. Il guard del semaforo e' offTravel, NON offCount:
    //    da fermi il GPS deriva di 60 m in quattro secondi e il contatore arriverebbe
    //    a 4 lo stesso, ma la distanza percorsa resta zero.
    if (nv.offDist > nv.offThr) { nv.offCount++; nv.offTravel += travelled; }
    else { nv.offCount = 0; nv.offTravel = 0; }
    if (nv.offCount >= NAV_OFF_FIXES && nv.offTravel >= NAV_OFF_TRAVEL_M) trigger = 'scarto';

    // B) manovra mancata. Serve perche' A e' troppo lento: dopo un'uscita autostradale
    //    persa la rotta resta parallela 300-400 m e A scatta dopo 10-15 s, quando
    //    l'uscita dopo e' a 12 km.
    const k = nv.nextMan, mk = k < nv.man.length ? nv.man[k] : null;
    if (mk && hdg != null && mk.brgAfter != null && mk.brgBefore != null &&
        nv.sAlong >= nv.sMan[k] - 5 &&
        angleDiff(hdg, mk.brgAfter) > 60 &&
        angleDiff(mk.brgBefore, mk.brgAfter) > 25) {
      nv.missCount++; nv.missTravel += travelled;
    } else { nv.missCount = 0; nv.missTravel = 0; }
    if (nv.missCount >= NAV_MISS_FIXES && nv.missTravel >= NAV_MISS_TRAVEL_M) trigger = 'manovra mancata';

    // C) contromano
    if (hdg != null && angleDiff(hdg, nv.brg[nv.idx]) > 135) { nv.wrongCount++; nv.wrongTravel += travelled; }
    else { nv.wrongCount = 0; nv.wrongTravel = 0; }
    if (nv.wrongCount >= NAV_WRONG_FIXES && nv.wrongTravel >= NAV_WRONG_TRAVEL_M) trigger = 'contromano';

    // D) scorciatoia forte: scarto grosso con fix buono, non si aspetta
    if (nv.offDist > 150 && (acc == null || acc < 20) && v > 5) { nv.farCount++; } else nv.farCount = 0;
    if (nv.farCount >= 2) trigger = 'fuori percorso';
  }

  // 3. avanzamento manovre (solo se non stiamo per ricalcolare)
  if (!trigger) navAdvance(nv, hdg);

  // 4. distanze e tempi
  const k = nv.nextMan;
  nv.distToNext = k < nv.man.length ? Math.max(0, nv.sMan[k] - nv.sAlong) : 0;
  nv.distRemain = Math.max(0, nv.totalM - nv.sAlong);
  const kc = Math.max(0, k - 1);
  const span = Math.max(1, (k < nv.man.length ? nv.sMan[k] : nv.totalM) - nv.sMan[kc]);
  const frac = Math.max(0, Math.min(1, (nv.sAlong - nv.sMan[kc]) / span));
  nv.timeRemain = (nv.tEnd[nv.man.length - 1] - nv.tEnd[kc]) + (1 - frac) * nv.man[kc].time;

  // 5. arrivo
  const arriveM = Math.max(25, 1.5 * (acc || 0));
  const near = nv.dest ? distM({ lat: pLat, lon: pLon }, nv.dest) : Infinity;
  if (nv.status === 'ACTIVE' && (nv.distRemain < 15 || near < arriveM)) {
    nv.arriveCount++;
    if (nv.arriveCount >= NAV_ARRIVE_FIXES) {
      nv.status = 'ARRIVED';
      navSpeak.say('Sei arrivato a destinazione.', 4);
      trigger = null;
    }
  } else nv.arriveCount = 0;

  // 6. voce
  if (nv.status === 'ACTIVE' && !trigger) {
    if (nv.preSpoken[k]) { nv.spoken |= nv.preSpoken[k]; nv.preSpoken[k] = 0; }
    navAnnounce(nv, vRef);
  }

  // 7. ricalcolo, con i freni
  if (trigger) navMaybeReroute(pLat, pLon, hdg, trigger);

  nv.lastFixAt = now; nv.lastLat = pLat; nv.lastLon = pLon;
  navPersistProgress();
}

function navMaybeReroute(pLat, pLon, hdg, why) {
  const nv = state.nav;
  const now = Date.now();
  if (nv.status !== 'ACTIVE') return;
  if (nv.rerouteAt && now - nv.rerouteAt < nv.rerouteWait) return;
  if (nv.rerouteAt && nv.travelSinceReroute < NAV_REROUTE_MOVE_M) return;
  // circuit breaker: se sto deviando apposta, il navigatore deve smettere di insistere
  nv.rerouteLog = (nv.rerouteLog || []).filter(t => now - t < NAV_REROUTE_WINDOW_MS);
  if (nv.rerouteLog.length >= NAV_REROUTE_MAX) {
    nv.status = 'OFF_MANUAL';
    navSpeak.say('Fuori percorso. Tocca ricalcola quando vuoi.', 3);
    navRenderBanner(); renderNavPanel();
    return;
  }
  nv.rerouteLog.push(now);
  nv.rerouteAt = now; nv.travelSinceReroute = 0;
  nv.rerouteStreak = (nv.lastRerouteEnd && now - nv.lastRerouteEnd < 60000) ? nv.rerouteStreak + 1 : 0;
  nv.rerouteWait = NAV_REROUTE_BACKOFF[Math.min(nv.rerouteStreak, NAV_REROUTE_BACKOFF.length - 1)];
  nv.status = 'REROUTING';
  nv.offCount = 0; nv.offTravel = 0; nv.missCount = 0; nv.wrongCount = 0; nv.farCount = 0;
  navSpeak.stop();
  navSpeak.say('Ricalcolo il percorso.', 3);
  navRenderBanner();
  navRequestRouteSafe({ lat: pLat, lon: pLon }, nv.dest, hdg, why);
}
