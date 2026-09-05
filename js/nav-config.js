'use strict';
/* js/nav-config.js (step 19): costanti NAV_* + navGate + route-canvas/persist/restore/start/stop/sim. Ordine: dopo js/nav-ui.js. */
const NAV_HOSTS = ['https://valhalla1.openstreetmap.de/route'];
/* Fallback: l'istanza Valhalla FOSSGIS e' andata giu' (443 e 80 filtrate). OSRM sullo
   stesso dominio risponde, restituisce polyline6 come Valhalla e da' type/modifier/
   bearing per manovra: basta tradurre la forma della risposta. Costo: profilo auto
   fisso, quindi le preferenze moto non si applicano quando risponde lui. */
const NAV_OSRM_HOST = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
const NAV_GEO_HOST = 'https://photon.komoot.io/api';
const NAV_API_GAP_MS = 1100;      // 1 req/s con margine, per TUTTE le chiamate
const NAV_VALHALLA_TIMEOUT_MS = 7000;  // corto: se non risponde si passa a OSRM
const NAV_TIMEOUT_MS = 20000;
const NAV_GEO_TIMEOUT_MS = 8000;

const NAV_OFF_FIXES = 4;          // fix consecutivi fuori soglia
const NAV_OFF_TRAVEL_M = 40;      // ...e metri REALMENTE percorsi: il guard del semaforo
const NAV_MISS_FIXES = 3;         // rilevatore di manovra mancata
const NAV_MISS_TRAVEL_M = 25;
const NAV_WRONG_FIXES = 5;        // contromano
const NAV_WRONG_TRAVEL_M = 60;
const NAV_REROUTE_MOVE_M = 60;
const NAV_REROUTE_BACKOFF = [12000, 25000, 50000, 90000, 120000];
const NAV_REROUTE_MAX = 6;        // circuit breaker: 6 ricalcoli in 10 min -> manuale
const NAV_REROUTE_WINDOW_MS = 600000;
const NAV_RELOCK_LOST = 5;
const NAV_RELOCK_GAP_MS = 8000;
const NAV_RELOCK_JUMP_M = 400;
const NAV_ARRIVE_FIXES = 2;
const NAV_HEAD_GATE_DEG = 120;    // scarta i segmenti che vanno dall'altra parte
const NAV_PASS_OVERSHOOT_M = 10;
const NAV_PASS_EARLY_M = 10;
const NAV_PASS_HEAD_DEG = 45;
const NAV_CHAIN_MIN_M = 150;      // due manovre "incatenate" sotto questa distanza
const NAV_MAX_SEG_SCAN = 400;     // tappo duro sui segmenti valutati per fix

const MAN_ROUNDABOUT_IN = 26, MAN_ROUNDABOUT_OUT = 27;

let navGateLast = 0, navGateChain = Promise.resolve();

function navGate(fn) {
  const run = navGateChain.then(async () => {
    const wait = NAV_API_GAP_MS - (Date.now() - navGateLast);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    navGateLast = Date.now();
    return fn();
  });
  navGateChain = run.catch(() => {}); // un errore non deve rompere la catena
  return run;
}
function navRouteForCanvas() {
  const nv = state.nav;
  if (!nv || !nv.n) return null;
  const step = Math.max(1, Math.floor(nv.n / 400));
  const out = [];
  for (let i = 0; i < nv.n; i += step) out.push({ lat: nv.lat[i], lon: nv.lon[i] });
  out.push({ lat: nv.lat[nv.n - 1], lon: nv.lon[nv.n - 1] });
  return out;
}
async function navPersistRoute() {
  const nv = state.nav;
  if (!nv) { try { await idb.kvPut('activeRoute', null); } catch (e) {} return; }
  try {
    await idb.kvPut('activeRoute', {
      ts: Date.now(), dest: nv.dest, req: nv.reqSaved, shape: nv.shapeRaw,
      man: nv.man, totalM: nv.totalM, totalS: nv.totalS,
    });
  } catch (e) {}
}
let navProgT = 0;

function navPersistProgress() {
  const nv = state.nav;
  if (!nv) return;
  const now = Date.now();
  if (now - navProgT < 5000 && nv.nextMan === navProgLastMan) return;
  navProgT = now; navProgLastMan = nv.nextMan;
  idb.kvPut('navProgress', {
    ts: now, sAlong: nv.sAlong, nextMan: nv.nextMan,
    lat: nv.lastLat, lon: nv.lastLon,
  }).catch(() => {});
}
let navProgLastMan = -1;

async function navRestore() {
  let r = null, pg = null;
  try { r = await idb.kvGet('activeRoute'); pg = await idb.kvGet('navProgress'); } catch (e) { return; }
  if (!r || !r.shape || !r.shape.length) return;
  let nv;
  try { nv = navBuild({ legs: r.shape.map((sh, i) => ({ shape: sh, maneuvers: [] })) }); }
  catch (e) { return; }
  // le manovre si riprendono dal record, non si ricostruiscono
  nv.man = r.man || [];
  // I flag delle rotonde non sono persistiti: navBuild li ha calcolati da manovre
  // vuote, quindi qui vanno ricostruiti da r.man, o il gate di heading torna attivo
  // proprio dentro le rotonde (dove i bearing ruotano di 360°) e può far perdere
  // l'aggancio dopo un riavvio.
  for (let k = 0; k < nv.man.length; k++) {
    if (nv.man[k].type === MAN_ROUNDABOUT_IN || nv.man[k].type === MAN_ROUNDABOUT_OUT) {
      for (let i = Math.max(0, nv.man[k].beginIdx); i <= Math.min(nv.n - 1, nv.man[k].endIdx); i++) nv.flags[i] |= 1;
    }
  }
  const M = nv.man.length;
  nv.sMan = new Float64Array(M); nv.tEnd = new Float64Array(M);
  let acc = 0;
  for (let k = 0; k < M; k++) {
    nv.sMan[k] = nv.cum[Math.min(nv.n - 1, Math.max(0, nv.man[k].beginIdx))];
    acc += nv.man[k].time || 0; nv.tEnd[k] = acc;
  }
  nv.totalS = acc;
  nv.dest = r.dest; nv.reqSaved = r.req; nv.shapeRaw = r.shape;
  nv.status = 'IDLE';                       // non riparte da sola
  nv.idx = 0; nv.segT = 0; nv.sAlong = (pg && pg.sAlong) || 0; nv.offDist = 0; nv.offThr = 50;
  nv.nextMan = Math.min(Math.max(1, (pg && pg.nextMan) || 1), Math.max(0, M - 1));
  nv.spoken = 0; nv.preSpoken = {};
  nv.offCount = 0; nv.offTravel = 0; nv.missCount = 0; nv.missTravel = 0;
  nv.wrongCount = 0; nv.wrongTravel = 0; nv.farCount = 0; nv.lostCount = 0; nv.arriveCount = 0;
  nv.vEMA = null; nv.lastFixAt = 0; nv.lastGoodAt = 0; nv.lastLat = pg && pg.lat; nv.lastLon = pg && pg.lon;
  nv.rerouteLog = []; nv.rerouteStreak = 0; nv.rerouteAt = 0; nv.rerouteWait = 0;
  nv.travelSinceReroute = 0; nv.resumeHint = pg || null;
  nv.stale = !pg || (Date.now() - pg.ts > 1800000);
  state.nav = nv;
  state.navDest = nv.dest ? { lat: nv.dest.lat, lon: nv.dest.lon, label: nv.dest.label } : null;
  navDrawRoute();
  renderNavPanel();
  navSetStatus(nv.stale
    ? 'Percorso salvato trovato (vecchio). Tocca Avvia per riprendere.'
    : 'Percorso salvato trovato. Tocca Avvia per riprendere.');
}
function navStart() {
  const nv = state.nav;
  navSpeak.init(); navSpeak.prime();       // il gesto utente e' questo tap
  if (!nv) {
    const d = state.navDest;
    const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
    if (!d) { toast('Scegli prima una destinazione.', 'err'); return; }
    if (!p) { toast('Nessun fix GPS.', 'err'); return; }
    navRequestRouteSafe(p, d, trackUpHeading(), null);
    return;
  }
  const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
  if (!p) { toast('Nessun fix GPS.', 'err'); return; }
  const pr = navProject(nv, p.lat, p.lon, trackUpHeading(), state.speedMs || 0, state.gps.acc, true);
  if (!pr || pr.d > 2000) {
    // troppo lontano dalla rotta salvata: non si riprende alla cieca
    navSetStatus('Sei lontano dal percorso salvato: ricalcolo da qui.');
    navRequestRouteSafe(p, nv.dest, trackUpHeading(), 'ripresa');
    return;
  }
  nv.idx = pr.i; nv.segT = pr.t; nv.sAlong = pr.s; nv.offDist = pr.d;
  // il nextMan si ricava dalla posizione, non dal record salvato
  let k = 1;
  while (k < nv.man.length && nv.sMan[k] < nv.sAlong + 5) k++;
  nv.nextMan = Math.min(k, nv.man.length - 1);
  nv.spoken = 0; nv.preSpoken = {};
  nv.status = 'ACTIVE'; nv.lastGoodAt = Date.now();
  navSetStatus('Navigazione in corso.');
  navRenderBanner(); renderNavPanel(); navDrawRoute();
}
function navStop() {
  navSimStop();
  state.nav = null; state.navDest = null;
  navSpeak.stop();
  idb.kvPut('activeRoute', null).catch(() => {});
  idb.kvPut('navProgress', null).catch(() => {});
  els.navQuery.value = ''; els.navResults.textContent = '';
  navSetStatus('Navigazione terminata.');
  navRenderBanner(); renderNavPanel(); navDrawRoute();
}
let navSimTimer = null, navSimS = 0, navSimOff = 0;

function navSimStop() { clearInterval(navSimTimer); navSimTimer = null; navSimOff = 0; }

function navSimStart() {
  const nv = state.nav;
  if (!nv || !nv.n) { toast('Calcola prima un percorso.', 'err'); return; }
  navSimStop();
  navSimS = nv.sAlong || 0;
  navSimTimer = setInterval(() => {
    const v = parseFloat(els.navSimSpeed.value) || 25;
    navSimS += v;
    if (navSimS >= nv.totalM) { navSimS = nv.totalM; }
    const i = Math.max(0, Math.min(nv.n - 2, navLowerBound(nv.cum, nv.n, navSimS) - 1));
    const span = Math.max(1e-6, nv.cum[i + 1] - nv.cum[i]);
    const t = Math.max(0, Math.min(1, (navSimS - nv.cum[i]) / span));
    let la = nv.lat[i] + t * (nv.lat[i + 1] - nv.lat[i]);
    let lo = nv.lon[i] + t * (nv.lon[i + 1] - nv.lon[i]);
    if (navSimOff > 0) {
      // scarto perpendicolare crescente, per far scattare il ricalcolo
      const b = (nv.brg[i] + 90) * Math.PI / 180;
      la += Math.cos(b) * navSimOff / 111132;
      lo += Math.sin(b) * navSimOff / (111320 * Math.cos(la * Math.PI / 180));
      navSimOff += 25;
    }
    state.pos.lat = la; state.pos.lon = lo;
    state.gps.lat = la; state.gps.lon = lo;
    state.gps.heading = nv.brg[i]; state.gps.acc = 6;
    state.speedMs = v; state.speedKph = v * 3.6; state.gpsStatus = 'ok';
    updateGpsStatus();
    navTick(la, lo, 6);
    updateMap();
    navRenderBanner();
    if (state.currentTab === 'nav') renderNavPanel();
    if (navSimS >= nv.totalM) navSimStop();
  }, 1000);
  toast('Simulazione avviata.', 'ok');
}
