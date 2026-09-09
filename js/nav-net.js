'use strict';
/* js/nav-net.js (step 15): rete navigazione (navCostingOptions, navRequestRoute, navRequestRouteSafe, navTryOsrm, navGeocode, geoCachePrune). Usa navGate/fetchWithTimeout/cache/idb + render a runtime. Ordine: dopo js/log-core.js. */

/* Identità delle richieste percorso: ogni navRequestRoute si prende un numero
   d'ordine; al ritorno della risposta lo confronta con l'ultimo emesso. Se una
   richiesta nuova è partita nel frattempo (o l'utente ha chiuso il navigatore,
   navStop) la risposta vecchia si scarta invece di sovrascrivere state.nav:
   prima un reroute lento "resuscitava" una rotta fermata o"caramellava" la
   destinazione appena cambiata. */
let navReqSeq = 0;

/* Inizializzazione dello stato VIVO di una rotta appena costruita: i tre rami di
   navRequestRoute (cache fresca, cache stale, rete) la replicavano identica —
   un campo nuovo dimenticato in un solo ramo = navigatore mezzo-nudo. */
function navInitLive(nv) {
  nv.idx = 0; nv.segT = 0; nv.sAlong = 0; nv.offDist = 0; nv.offThr = 50;
  nv.nextMan = Math.min(1, nv.man.length - 1);
  nv.spoken = 0; nv.preSpoken = {};
  nv.offCount = 0; nv.offTravel = 0; nv.missCount = 0; nv.missTravel = 0;
  nv.wrongCount = 0; nv.wrongTravel = 0; nv.farCount = 0; nv.lostCount = 0; nv.arriveCount = 0;
  nv.vEMA = null; nv.lastFixAt = 0; nv.lastGoodAt = Date.now(); nv.lastLat = null; nv.lastLon = null;
}

async function navTryOsrm(from, to, hdg, vias) {
  const pts = [from, ...((vias || []).filter(v => v && isFinite(v.lat) && isFinite(v.lon))), to];
  const coords = pts.map(c => c.lon.toFixed(6) + ',' + c.lat.toFixed(6)).join(';');
  let url = NAV_OSRM_HOST + coords +
    '?steps=true&overview=full&geometries=polyline6';
  // stesso ruolo dell'heading in Valhalla: evita che riparta con un'inversione a U
  if (hdg != null && isFinite(hdg)) url += '&bearings=' + Math.round(hdg) + ',60;';
  const res = await navGate(() => fetchWithTimeout(url, NAV_OSRM_TIMEOUT_MS));
  const j = await jsonUnderTimeout(res);
  if (!res.ok || !j || j.code !== 'Ok') throw new Error('OSRM ' + ((j && (j.code || j.message)) || res.status));
  return navFromOsrm(j);
}

function navRequestRouteSafe(from, to, hdg, why) {
  return navRequestRoute(from, to, hdg, why).catch(e => {
    const m = (e && e.message) || String(e);
    navSetStatus('Errore interno nel calcolo percorso: ' + m);
    toast('Errore interno: ' + m, 'err', 8000);
    if (state.nav && state.nav.status === 'REROUTING') state.nav.status = 'ACTIVE';
    navRenderBanner(); renderNavPanel();
  });
}

function navCostingOptions() {
  return { motorcycle: {
    use_highways: state.navNoHw ? 0.1 : 0.5,
    use_tolls: state.navNoToll ? 0.0 : 0.5,
    use_ferry: state.navNoFerry ? 0.0 : 0.5,
    use_trails: state.navBackroads ? 0.6 : 0.0,
  } };
}

let geoPruneDone = false, geoPruneRunning = false;

async function geoCachePrune() {
  // Una volta a sessione, mai concorrente: veniva lanciata non-awaitata a ogni
  // geocoding — decine di prune parallele che si scavalcano a vicenda.
  if (geoPruneDone || geoPruneRunning) return;
  geoPruneRunning = true;
  try {
    const keys = await idb.kvKeys();
    const geo = (keys || []).filter(k => k.indexOf('geocodeCache:') === 0);
    if (geo.length > 200) {
      const entries = [];
      for (const k of geo) { const e = await idb.kvGet(k); if (e) entries.push([k, e.ts || 0]); }
      entries.sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < entries.length - 200; i++) {
        try { await idb.kvDel(entries[i][0]); } catch (err) {}
      }
    }
    geoPruneDone = true;
  } catch (err) {
  } finally {
    geoPruneRunning = false;
  }
}

async function navRequestRoute(from, to, hdg, why) {
  if (!from || !to) return;
  const mySeq = ++navReqSeq;
  // Il check vale anche per state.navDest: navStop la azzera, e una risposta
  // in volo non deve ricostruire una rotta appena terminata.
  const reqStale = () => (mySeq !== navReqSeq || !state.navDest);
  // L'heading si passa a Valhalla SOLO quando si e' davvero in movimento: il compass
  // magnetica da fermo e' rumore, e con heading_tolerance stretto fa fallire Valhalla
  // con "No suitable edges near location" (error_code 171) = HTTP 400.
  const useHead = hdg != null && isFinite(hdg) && state.speedMs >= HEADING_MIN_MS;
  // Via intermedie solo sul calcolo "fresco" (why null): in ricalcolo/ripresa
  // (why non-null) si va dritti da→dest, per non far ripassare Valhalla da una
  // tappa già superata durante una deviazione.
  const vias = (why == null ? (state.navVias || []) : [])
    .filter(v => v && isFinite(v.lat) && isFinite(v.lon));
  const build = (withHead) => {
    const orig = { lat: from.lat, lon: from.lon };
    // Senza heading sull'origine, Valhalla e' libero di rispondere con un'inversione a U
    // verso il punto appena lasciato: in autostrada e' il peggior output possibile.
    if (withHead) { orig.heading = Math.round(hdg); orig.heading_tolerance = 60; }
    const locations = [orig, ...vias.map(v => ({ lat: v.lat, lon: v.lon })), { lat: to.lat, lon: to.lon }];
    return {
      locations,
      costing: 'motorcycle',
      costing_options: navCostingOptions(),
      directions_options: { language: 'it-IT', units: 'kilometers' },
    };
  };
  navSetStatus(why ? 'Ricalcolo in corso…' : 'Calcolo percorso…');
  let trip = null, engine = null, err = null, retried = false, lastReq = null;
  // Il nav precedente serve a TUTTI i rami di applicazione: il backoff reroute
  // (streak/log) si porta dietro anche quando la risposta arriva dalla cache,
  // altrimenti un ricalcolo servito da cache azzerava il circuit breaker e la
  // escalation non arrivava mai (reroute ogni 60 m, mai OFF_MANUAL).
  const prev = state.nav;
  const rKey = routeCacheKey(from, to, navCostingOptions(), useHead ? hdg : null, vias);
  const cached = await cacheGetFresh(rKey, ROUTE_CACHE_TTL_MS);
  if (cached && !cached.stale) {
    try {
      const nv0 = navBuild(cached.body.trip);
      nv0.engine = cached.body.engine || 'cache';
      nv0.dest = { lat: to.lat, lon: to.lon, label: (state.navDest && state.navDest.label) || '' };
      nv0.status = 'ACTIVE';
      navInitLive(nv0);
      nv0.rerouteAt = prev ? prev.rerouteAt : 0; nv0.rerouteWait = prev ? prev.rerouteWait : 0;
      nv0.rerouteStreak = prev ? (prev.rerouteStreak || 0) : 0;
      nv0.rerouteLog = prev ? (prev.rerouteLog || []) : [];
      nv0.lastRerouteEnd = Date.now(); nv0.travelSinceReroute = 0;
      nv0.shapeRaw = (cached.body.trip.legs || []).map(l => l.shape);
      nv0.reqSaved = lastReq || { from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon } };
      if (reqStale()) return;
      state.nav = nv0;
      navSetStatus((why ? 'Percorso ricalcolato' : 'Percorso pronto') + ' · motore: ' + nv0.engine + ' (cache)');
      navPersistRoute(); navDrawRoute(); navFitRoute(); navRenderBanner(); renderNavPanel();
      return;
    } catch (e) { /* cache corrotta: si prosegue con rete */ }
  }
  // 1) Valhalla: profilo moto e preferenze. Timeout corto, cosi' se e' giu' il
  //    fallback parte in fretta invece di far aspettare venti secondi.
  for (const host of NAV_HOSTS) {
    try {
      let req = build(useHead);
      lastReq = req;
      let res = await navGate(() => fetchWithTimeout(
        host + '?json=' + encodeURIComponent(JSON.stringify(req)), NAV_VALHALLA_TIMEOUT_MS));
      let j = await jsonUnderTimeout(res);
      // "No suitable edges": spesso e' l'heading. Si ritenta una volta senza.
      if (useHead && !retried && j && (j.error_code === 171 || j.error_code === 154)) {
        retried = true;
        req = build(false);
        lastReq = req;
        res = await navGate(() => fetchWithTimeout(
          host + '?json=' + encodeURIComponent(JSON.stringify(req)), NAV_VALHALLA_TIMEOUT_MS));
        j = await jsonUnderTimeout(res);
      }
      // Valhalla riporta gli errori come JSON con error_code, non come HTTP non-2xx.
      if (j && j.error) { err = new Error('Valhalla ' + (j.error_code || '') + ': ' + j.error); continue; }
      if (!res.ok) { err = new Error('HTTP ' + res.status); continue; }
      if (!j || !j.trip || j.trip.status !== 0) { err = new Error('risposta non valida'); continue; }
      trip = j.trip; engine = 'Valhalla'; break;
    } catch (e) { err = e; }
  }
  // 2) OSRM: risponde sempre, ma profilo auto fisso — le preferenze moto non si applicano.
  if (!trip) {
    try {
      trip = await navTryOsrm(from, to, useHead ? hdg : null, vias);
      engine = 'OSRM';
    } catch (e2) { err = err || e2; }
  }
  if (trip && !(err && err.name === 'TimeoutError')) {
    cachePut(rKey, { trip: trip, engine: engine }, ROUTE_CACHE_TTL_MS);
  }
  const data = trip ? { trip: trip } : null;
  // Offline con cache stale: meglio rotta vecchia che niente.
  if (!data && cached && cached.stale && cached.body && cached.body.trip) {
    try {
      const nvS = navBuild(cached.body.trip);
      nvS.engine = cached.body.engine || 'cache';
      nvS.dest = { lat: to.lat, lon: to.lon, label: (state.navDest && state.navDest.label) || '' };
      nvS.status = 'ACTIVE';
      // Stesso init del ramo cache-fresh e di quello di rete (navInitLive).
      navInitLive(nvS);
      nvS.rerouteAt = 0; nvS.rerouteWait = 0; nvS.rerouteStreak = 0; nvS.rerouteLog = [];
      nvS.lastRerouteEnd = Date.now(); nvS.travelSinceReroute = 0;
      nvS.shapeRaw = (cached.body.trip.legs || []).map(l => l.shape);
      nvS.reqSaved = lastReq || { from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon } };
      if (reqStale()) return;
      state.nav = nvS;
      navSetStatus('Offline: uso ultimo percorso salvato.');
      navPersistRoute(); navDrawRoute(); navFitRoute(); navRenderBanner(); renderNavPanel();
      return;
    } catch (e) { /* stale illeggibile: si prosegue col messaggio OFF_NONET */ }
  }
  if (!data) {
    if (reqStale()) return;
    if (prev && prev.man) {
      // Mai cancellare la rotta salvata: la linea vecchia resta l'informazione piu'
      // utile che si abbia, e senza rete e' l'unica.
      // Fallimento offline/timeout NON è "l'utente devia apposta": il tentativo
      // era stato accodato al circuit breaker in navMaybeReroute prima di
      // conoscerne l'esito, e va tolto, altrimenti un tratto senza campo fa
      // scattare OFF_MANUAL scambiando "niente rete" per "deviazione voluta".
      // Il pop va fatto SOLO se era un ricalcolo (status REROUTING, push fatto da
      // navMaybeReroute): nel ramo "ripresa" di navStart (status ACTIVE/IDLE)
      // nessun push è avvenuto e un pop toglierebbe una voce legittima del log.
      if (prev.status === 'REROUTING' && prev.rerouteLog && prev.rerouteLog.length) prev.rerouteLog.pop();
      if (prev.status === 'REROUTING') {
        prev.status = 'OFF_NONET';
        prev.lastRerouteEnd = Date.now();
      }
      // Nuova destinazione/ripresa fallita: la rotta attiva è SANA e va lasciata
      // tale — prima OFF_NONET veniva applicato anche qui, degradando la guida
      // (e il circuito di ricalcolo) per un errore di rete non dovuto a deviazione.
      navSetStatus('Senza rete: percorso non aggiornato. ' + (err ? err.message : ''));
    } else {
      navSetStatus('Nessun motore di routing raggiungibile: ' + (err ? err.message : 'errore'));
      toast('Nessun motore di routing raggiungibile: ' + (err ? err.message : 'errore'), 'err', 7000);
    }
    navRenderBanner(); renderNavPanel();
    return;
  }
  let nv;
  try { nv = navBuild(trip); }
  catch (e) { navSetStatus('Percorso illeggibile: ' + e.message); toast('Percorso illeggibile.', 'err', 5000); return; }
  nv.engine = engine;

  nv.dest = { lat: to.lat, lon: to.lon, label: (state.navDest && state.navDest.label) || (prev && prev.dest && prev.dest.label) || '' };
  nv.status = 'ACTIVE';
  navInitLive(nv);
  nv.rerouteAt = prev ? prev.rerouteAt : 0;
  nv.rerouteWait = prev ? prev.rerouteWait : 0;
  nv.rerouteStreak = prev ? (prev.rerouteStreak || 0) : 0;
  nv.rerouteLog = prev ? (prev.rerouteLog || []) : [];
  nv.lastRerouteEnd = Date.now();
  nv.travelSinceReroute = 0;
  nv.shapeRaw = (trip.legs || []).map(l => l.shape);
  nv.reqSaved = lastReq || { from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon } };
  if (reqStale()) return;
  state.nav = nv;
  /* Dire quale motore ha risposto: con OSRM le preferenze moto non si applicano, e
     lasciarlo intendere sarebbe peggio che tacere. */
  const anyPref = state.navNoHw || state.navNoToll || state.navBackroads || state.navNoFerry;
  navSetStatus((why ? 'Percorso ricalcolato' : 'Percorso pronto') + ' · motore: ' + engine +
    (engine === 'OSRM' ? ' (profilo auto' + (anyPref ? ', preferenze moto non applicate' : '') + ')' : ''));
  navPersistRoute();
  navDrawRoute();
  navFitRoute();
  navRenderBanner();
  renderNavPanel();
}

async function navGeocode(q) {
  const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
  const gKey = geoCacheKey(q, p);
  const gCached = await cacheGetFresh(gKey, GEO_CACHE_TTL_MS);
  if (gCached && !gCached.stale) return gCached.body;
  /* Niente `lang`: Photon accetta solo default/de/en/fr e su `it` risponde 400.
     Senza il parametro usa i nomi locali, che in Italia e' esattamente quello che serve. */
  let url = NAV_GEO_HOST + '?limit=6&q=' + encodeURIComponent(q);
  if (p) url += '&lat=' + p.lat.toFixed(5) + '&lon=' + p.lon.toFixed(5);
  let res;
  try {
    res = await navGate(() => fetchWithTimeout(url, NAV_GEO_TIMEOUT_MS));
  } catch (e) {
    if (gCached && gCached.stale) return gCached.body; // offline: meglio stale che niente
    throw e;
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await jsonUnderTimeout(res); detail = (j && (j.message || j.error)) ? ' — ' + (j.message || j.error) : ''; } catch (e) {}
    if (gCached && gCached.stale) return gCached.body;
    throw new Error('HTTP ' + res.status + detail);
  }
  const j = await jsonUnderTimeout(res);
  const out = (j.features || []).map(f => {
    const c = f.geometry && f.geometry.coordinates;   // [lon, lat]: invertito
    const pr = f.properties || {};
    if (!c || c.length < 2) return null;
    const name = pr.name || [pr.street, pr.housenumber].filter(Boolean).join(' ') || pr.city || '?';
    const sub = [pr.street && pr.name ? pr.street : null, pr.postcode, pr.city, pr.state, pr.country]
      .filter(Boolean).join(', ');
    return { lat: +c[1], lon: +c[0], label: String(name), sub: String(sub) };
  }).filter(Boolean);
  cachePut(gKey, out, GEO_CACHE_TTL_MS);
  geoCachePrune();
  return out;
}
