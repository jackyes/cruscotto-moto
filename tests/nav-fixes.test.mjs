// Fix del cluster "nav" dell'audit GUI: finding 5, 6, 7, 8, 12, 15, 17, 18, 21, 22.
// Un test per finding, ognuno dei quali rosso se si disattiva la sua fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, vmSandbox, resetState, tickIntervals, liveIntervals } from './harness.mjs';

const {
  state, els, navBuild, navTick, navStart, navStop, navReset, navSetDest,
  navRenderBanner, renderNavPanel, navRenderResults, navResultsKey, navClearResults,
  navSearchCancel, navSearchSeqGet, navChainMinM, navFitRoute, navSimStart,
  navSimStop, navSimDevia, navFmtShort, navShortCue, navSpeak, navDistToNext, NAV_ICON,
  NAV_CHAIN_MIN_M, NAV_SIM_OFF_MAX_M, NAV_ARRIVE_FIXES,
} = api;

/* --- polyline6: stesso codificatore di tests/nav-advance.test.mjs --- */
function encodeDelta(d) {
  let v = d < 0 ? ~(d << 1) : (d << 1);
  let s = '';
  while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
  return s + String.fromCharCode(v + 63);
}
function encodePolyline6(points) {
  let pLat = 0, pLon = 0, out = '';
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    out += encodeDelta(la - pLat) + encodeDelta(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}

// Rotta nord (45,9) -> (45.001,9) -> (45.002,9): ~222 m, manovra d'arrivo in fondo.
function buildNorth() {
  resetState();
  const nv = navBuild({
    legs: [{
      shape: encodePolyline6([[45, 9], [45.001, 9], [45.002, 9]]),
      maneuvers: [
        { type: 1, instruction: 'parti', begin_shape_index: 0, end_shape_index: 1, bearing_after: 0 },
        { type: 2, instruction: 'arriva', begin_shape_index: 1, end_shape_index: 2, bearing_after: 0 },
      ],
    }],
  });
  nv.nextMan = 0; nv.offDist = 0; nv.offThr = 50; nv.sAlong = 0;
  nv.spoken = 0; nv.preSpoken = {};
  return nv;
}

/* Rotta dritta a mano per il simulatore: nv costruito a tavolino invece che da
   navBuild, perché al simulatore servono solo lat/lon/brg/cum. status IDLE: navTick
   esce subito e il tick non tocca la rete. */
function simRoute(lat0, lon0, spanDeg) {
  const span = spanDeg || 0.05;
  const half = span / 2;
  const step = span * 111132 / 2;
  const nv = {
    status: 'IDLE', n: 3, man: [], nextMan: 0, sAlong: 0,
    lat: new Float64Array([lat0, lat0 + half, lat0 + span]),
    lon: new Float64Array([lon0, lon0, lon0]),
    brg: new Float64Array([0, 0, 0]),
    cum: new Float64Array([0, step, step * 2]),
    totalM: step * 2, totalS: 600, distRemain: step * 2, timeRemain: 600,
    sMan: new Float64Array([0]), sAlong: 0,
  };
  return nv;
}

// ---------------------------------------------------------------- #5

test('#5 arrivo: oltre al banner (che sparisce) resta lo stato persistente', () => {
  resetState();
  const nv = buildNorth();
  nv.status = 'ACTIVE';
  nv.dest = { lat: 45.002, lon: 9, label: 'Arrivo' };
  nv.sAlong = nv.totalM - 5;
  nv.arriveCount = 0;
  nv.lastGoodAt = Date.now();
  state.nav = nv;
  state.speedMs = 8;
  state.gps.heading = 0;
  state.gps.acc = 5;
  els.navStatusTxt.textContent = 'Percorso pronto · motore: Valhalla';

  for (let i = 0; i < NAV_ARRIVE_FIXES; i++) navTick(45.002, 9, 8);
  assert.equal(nv.status, 'ARRIVED', 'arrivo non rilevato');
  assert.equal(els.navStatusTxt.textContent, 'Arrivato a destinazione.',
    'arrivo scritto solo nel banner: passati gli 8 s non resta nessuna indicazione');
  assert.equal(els.navSumDist.textContent, navFmtShort(0),
    'pannello fermo sulle distanze del calcolo');
  // Il banner si nasconde da solo fra 8 s: non lasciare un timer vivo nel processo.
  if (nv._arriveTimer) vmSandbox.clearTimeout(nv._arriveTimer);
});

test('#5 secondo arrivo sulla stessa rotta: il banner "Arrivato" ricompare', () => {
  resetState();
  const nv = buildNorth();
  nv.status = 'ARRIVED';
  nv.bannerDone = true;            // banner già consumato: sono passati gli 8 s
  nv.arriveCount = 0;
  nv.dest = { lat: 45.002, lon: 9, label: 'A' };
  nv.sAlong = nv.totalM - 5;
  nv.lastGoodAt = Date.now();
  state.nav = nv;
  state.pos.lat = 45.002; state.pos.lon = 9;
  state.speedMs = 8; state.gps.heading = 0; state.gps.acc = 5;

  // navStart riprende la STESSA rotta: stesso oggetto nv, quindi bannerDone va
  // azzerato qui — navBuild/navRestore non bastano, creano un oggetto nuovo.
  navStart();
  assert.equal(nv.status, 'ACTIVE');
  assert.equal(nv.bannerDone, false, 'bannerDone latchato: il secondo arrivo resta invisibile');

  for (let i = 0; i < NAV_ARRIVE_FIXES; i++) navTick(45.002, 9, 8);
  assert.equal(nv.status, 'ARRIVED');
  assert.equal(els.navBanner.style.display, 'block', 'banner assente al secondo arrivo');
  assert.ok(els.navBanner.textContent.includes('Arrivato'));
  if (nv._arriveTimer) vmSandbox.clearTimeout(nv._arriveTimer);
});

// ---------------------------------------------------------------- #6

test('#6 heartbeat voce: riarmato da ogni annuncio, non solo da navStart', () => {
  resetState();
  /* La sintesi non esiste nel sandbox: si inietta il minimo che say() tocca.
     La voce finta è italiana, così pick() non fa scattare l'avviso (toast =
     un setTimeout di 9 s che terrebbe vivo il processo). */
  const ss = {
    speak() {}, cancel() {}, resume() {},
    getVoices() { return [{ lang: 'it-IT', name: 'Finta', localService: true }]; },
  };
  vmSandbox.SpeechSynthesisUtterance = function (t) { this.text = t; };
  vmSandbox.speechSynthesis = ss;
  vmSandbox.window.speechSynthesis = ss;
  navSpeak.stopHeartbeat();
  navSpeak.stop();
  const base = liveIntervals();
  try {
    state.navVoice = true;
    // Il ricalcolo automatico e la destinazione nuova riportano la navigazione in
    // ACTIVE SENZA passare da navStart: se il riarmo vive solo lì, da quel momento
    // la sintesi di Android resta senza resume() periodico e tronca gli annunci.
    assert.ok(navSpeak.say('Ricalcolo il percorso.', 3), 'annuncio non accodato');
    assert.equal(liveIntervals(), base + 1, 'heartbeat non riarmato parlando');

    navSpeak.stopHeartbeat();                 // come fa navStop
    navSpeak.stop();
    assert.equal(liveIntervals(), base, 'heartbeat non spento');
    assert.ok(navSpeak.say('Ricalcolo il percorso.', 3));
    assert.equal(liveIntervals(), base + 1, 'dopo un Termina il resume() periodico resta spento');
  } finally {
    navSpeak.stopHeartbeat();
    navSpeak.stop();
    delete vmSandbox.speechSynthesis;
    delete vmSandbox.window.speechSynthesis;
  }
});

test('#6 navReset spegne l\'heartbeat della voce', () => {
  resetState();
  navSpeak.stopHeartbeat();
  const base = liveIntervals();
  navSpeak.startHeartbeat();
  assert.equal(liveIntervals(), base + 1);
  // Idempotente: dette da ogni annuncio, chiamate ripetute non devono accumulare
  // interval (la guardia `if (this.hb) return` in startHeartbeat).
  navSpeak.startHeartbeat();
  navSpeak.startHeartbeat();
  assert.equal(liveIntervals(), base + 1, 'heartbeat duplicato: un interval per annuncio');
  navReset();
  assert.equal(liveIntervals(), base, 'heartbeat della voce sopravvissuto al reset');
});

// ---------------------------------------------------------------- #7

test('#7 distanza dalla prossima manovra prima del primo fix: mai "NaN km"', () => {
  resetState();
  // Stato di una rotta appena ripristinata: navRestore/navStart rendono banner e
  // pannello prima che navTick scriva distToNext.
  const nv = {
    status: 'ACTIVE', dest: { lat: 45, lon: 9, label: 'X' },
    totalM: 5000, totalS: 600, distRemain: 3000, timeRemain: 400,
    nextMan: 1, sAlong: 1000,
    sMan: new Float64Array([0, 1500, 3000]),
    man: [{ type: 8, text: 'A', streets: [] }, { type: 8, text: 'B', streets: [] },
          { type: 4, text: 'C', streets: [] }],
  };
  state.nav = nv;

  renderNavPanel();
  const cur = els.navSteps.children[1].children[0].textContent;
  assert.equal(cur, navFmtShort(500), 'pannello: distanza del passo corrente sbagliata');
  assert.ok(!/NaN/.test(cur), 'pannello: "NaN km" nel passo corrente');

  navRenderBanner();
  const banner = els.navBanner.textContent;
  assert.ok(!/NaN/.test(banner), 'banner: "NaN km" prima del primo fix');
  assert.ok(banner.includes(navFmtShort(500)), 'banner: distanza dalla manovra non calcolata');

  // nv a metà costruzione: man c'è, sMan no. Il fallback deve reggere anche questo
  // (prima leggeva nv.sMan[k] di undefined: TypeError dentro il banner, in marcia).
  state.nav = {
    status: 'ACTIVE', dest: { lat: 45, lon: 9, label: 'X' },
    totalM: 1000, totalS: 120, distRemain: 1000, timeRemain: 120, nextMan: 0, sAlong: 0,
    man: [{ type: 8, text: 'A', streets: [] }],
  };
  navRenderBanner();
  renderNavPanel();
  assert.equal(navDistToNext(state.nav), 0, 'fallback senza sMan: distanza non neutra');
});

// ---------------------------------------------------------------- #8

test('#8 destinazione nuova: aggiornata anche la rotta viva, non solo state.navDest', () => {
  resetState();
  state.nav = {
    status: 'ACTIVE', dest: { lat: 45.0, lon: 9.0, label: 'A' },
    totalM: 100, totalS: 10, distRemain: 100, timeRemain: 10,
    nextMan: 0, sAlong: 0, sMan: new Float64Array([0]), man: [],
  };
  // Un arrivo già annunciato sulla rotta vecchia: la destinazione nuova lo invalida.
  state.nav.bannerDone = true;
  state.nav.arriveCount = 3;
  // Nessun fix: navSetDest esce prima di chiedere la rotta alla rete.
  state.pos.lat = null; state.pos.lon = null; state.gps.lat = null;

  navSetDest({ lat: 46.5, lon: 10.2, label: 'B' });

  assert.equal(state.navDest.label, 'B');
  assert.equal(state.nav.dest.label, 'B',
    'nv.dest resta su A: pannello, marker e navMaybeReroute puntano alla destinazione vecchia');
  assert.equal(state.nav.dest.lat, 46.5);
  assert.equal(state.nav.destStale, true,
    'nv.dest cambiata senza marcare la geometria come vecchia: navTick giudica l\'arrivo contro B');
  assert.equal(state.nav.bannerDone, false,
    'banner "Arrivato" consumato per sempre: il secondo arrivo non lo mostra più');
  assert.equal(state.nav.arriveCount, 0);

  // Copia, non alias: il prossimo state.navDest non deve cambiare la rotta viva.
  state.navDest = { lat: 1, lon: 2, label: 'C' };
  assert.equal(state.nav.dest.lat, 46.5, 'nv.dest è un alias di state.navDest');
});

test('#8 destinazione nuova su rotta già arrivata: il banner "Arrivato" non risorge', () => {
  resetState();
  const nv = buildNorth();
  nv.status = 'ARRIVED';
  nv.bannerDone = true;            // gli 8 s sono passati: banner già sparito da solo
  nv.arriveCount = 0;
  nv.dest = { lat: 45.002, lon: 9, label: 'A' };
  nv.sAlong = nv.totalM - 5;
  state.nav = nv;
  // Nessun fix: navSetDest esce prima di chiedere la rotta, quindi la rotta viva
  // resta quella di A — è il caso peggiore, ed è quello che si vede davvero
  // scegliendo una destinazione nuova dopo essere arrivati.
  state.pos.lat = null; state.pos.lon = null; state.gps.lat = null;

  navSetDest({ lat: 46.5, lon: 10.2, label: 'B' });

  // navArriveReset azzera bannerDone, e il timer che nasconde il banner si arma solo
  // nel ramo d'arrivo di navTick (status ACTIVE): su una rotta ARRIVED il banner
  // restava a schermo per sempre, sopra la destinazione nuova.
  assert.equal(nv.status, 'IDLE', 'rotta conclusa lasciata viva: navTick continua a girare su A');
  navRenderBanner();
  assert.equal(els.navBanner.style.display, 'none',
    'banner "⚑ Arrivato" di A ricomparso su B, senza timer che lo nasconda');
});

test('#8 destinazione nuova: niente "Arrivato" finché la geometria è quella vecchia', () => {
  resetState();
  const nv = buildNorth();                    // polilinea verso (45.002, 9)
  nv.status = 'ACTIVE';
  // B lontana: in piedi resta solo il termine geometrico (distRemain < 15), che è
  // quello che misura la polilinea VECCHIA. Con B sopra il fix scatterebbe il
  // termine GPS, e lì l'arrivo è legittimo (test successivo).
  nv.dest = { lat: 46.5, lon: 10.2, label: 'B' };
  nv.sAlong = nv.totalM - 5;                  // in fondo alla rotta: l'arrivo scatta
  nv.arriveCount = 0;                         // navInitLive non è passata: undefined++ = NaN
  nv.destStale = true;                        // com'è dopo navSetDest
  nv.lastGoodAt = Date.now();
  state.nav = nv;
  state.speedMs = 8; state.gps.heading = 0; state.gps.acc = 5;

  for (let i = 0; i < NAV_ARRIVE_FIXES; i++) navTick(45.002, 9, 8);
  assert.notEqual(nv.status, 'ARRIVED',
    'arrivo annunciato verso la destinazione VECCHIA: la polilinea non porta al nuovo dest');
  if (nv._arriveTimer) vmSandbox.clearTimeout(nv._arriveTimer);
});

test('#8 arrivo via GPS con geometria vecchia: il fix conta, la polilinea no', () => {
  resetState();
  const nv = buildNorth();
  nv.status = 'ACTIVE';
  nv.dest = { lat: 45.001, lon: 9, label: 'B' };  // B è qui sotto: ci siamo arrivati davvero
  nv.sAlong = 0;                                  // ...ma la polilinea è ancora all'inizio
  nv.arriveCount = 0;
  nv.destStale = true;                            // la rotta nuova non è mai atterrata
  nv.lastGoodAt = Date.now();
  state.nav = nv;
  state.speedMs = 0; state.gps.heading = 0; state.gps.acc = 5;

  for (let i = 0; i < NAV_ARRIVE_FIXES; i++) navTick(45.001, 9, 5);
  assert.equal(nv.status, 'ARRIVED',
    'arrivo soppresso: un ricalcolo fallito bloccherebbe per sempre l\'annuncio verso B');
  if (nv._arriveTimer) vmSandbox.clearTimeout(nv._arriveTimer);
});

// ---------------------------------------------------------------- #12

test('#12 simulatore: segue la rotta NUOVA invece della polilinea catturata', () => {
  resetState();
  state.nav = simRoute(45, 9);
  navSimStart();
  tickIntervals();
  assert.ok(Math.abs(state.pos.lon - 9) < 1e-4, 'primo tick fuori dalla rotta');

  // Ricalcolo riuscito: state.nav è un oggetto nuovo, su un'altra polilinea.
  const nvB = simRoute(45, 10);
  state.nav = nvB;
  tickIntervals();
  assert.ok(Math.abs(state.pos.lon - 10) < 1e-4,
    'il simulatore interpola ancora la polilinea vecchia (closure stantia)');
});

test('#12 offset di deviazione: limitato, non cresce all\'infinito', () => {
  resetState();
  state.nav = simRoute(45, 9);      // ~5,5 km: 30 tick non esauriscono la rotta
  navSimStart();
  navSimDevia();
  for (let i = 0; i < 30; i++) tickIntervals();
  const offM = Math.abs(state.pos.lon - 9) * 111320 * Math.cos(45 * Math.PI / 180);
  assert.ok(offM <= NAV_SIM_OFF_MAX_M + 20,
    'deviazione cresciuta oltre il tetto: ' + Math.round(offM) + ' m');
  assert.ok(offM >= NAV_SIM_OFF_MAX_M - 20,
    'deviazione sparita: ' + Math.round(offM) + ' m');
});

test('#12 deviazione: rientro in carreggiata quando arriva la rotta ricalcolata', () => {
  resetState();
  state.nav = simRoute(45, 9);
  navSimStart();
  navSimDevia();
  for (let i = 0; i < 5; i++) tickIntervals();
  const offM = Math.abs(state.pos.lon - 9) * 111320 * Math.cos(45 * Math.PI / 180);
  assert.ok(offM > 100, 'la deviazione non è partita: ' + Math.round(offM) + ' m');

  // Ricalcolo: rotta nuova, il navigatore ci ha riagganciati al suo sAlong.
  const nvB = simRoute(45, 9);
  nvB.sAlong = 200;
  state.nav = nvB;
  tickIntervals();
  const offB = Math.abs(state.pos.lon - 9) * 111320 * Math.cos(45 * Math.PI / 180);
  assert.ok(offB < 5, 'la moto simulata resta fuori dalla rotta nuova: ' + Math.round(offB) + ' m');
});

// ---------------------------------------------------------------- #15

test('#15 ricerca: navSearchCancel invalida le risposte in volo', () => {
  resetState();
  // Il ramo coordinate vive dentro init() (index.html), che l'harness non esegue:
  // qui si verifica il meccanismo su cui si appoggia, cioè che la selezione di un
  // risultato o una riga di coordinate facciano avanzare il numero d'ordine.
  const before = navSearchSeqGet();
  navSearchCancel();
  assert.equal(navSearchSeqGet(), before + 1);
  const items = [{ lat: 45, lon: 9, label: 'Coordinate', sub: '45, 9' }];
  navRenderResults(items);
  els.navResults.children[0].click();
  assert.equal(navSearchSeqGet(), before + 2,
    'selezione di un risultato senza invalidare le ricerche in volo');

  // Chiudere il navigatore non annulla la ricerca: la risposta in volo atterrava
  // dopo navStop e ripopolava la lista appena svuotata.
  const beforeStop = navSearchSeqGet();
  navStop();
  assert.equal(navSearchSeqGet(), beforeStop + 1, 'navStop non annulla la ricerca in volo');
});

test('#15 il wiring della ricerca annulla le risposte in volo', () => {
  // init() non gira nell'harness: i due handler che svuotano campo e lista a mano
  // vanno controllati sulla sorgente. Entrambi hanno un debounce Photon armato.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /navSearchCancel\(\);\s*\n\s*navRenderResults\(out\)/,
    'lista dai giri salvati: una ricerca in volo la sostituisce (o viene sostituita)');
  assert.match(html, /navSearchCancel\(\);[^\n]*\n\s*navClearResults\(\)/,
    'tappa intermedia: una ricerca in volo ripopola la lista appena svuotata');
});

// ---------------------------------------------------------------- #17

test('#17 navFitRoute: inquadra la rotta solo se è fresca, non in ricalcolo', () => {
  resetState();
  let fitted = 0;
  state.mapType = 'leaflet';
  state.map = { fitBounds() { fitted++; } };
  state.nav = {
    n: 3, lat: new Float64Array([45, 45.001, 45.002]), lon: new Float64Array([9, 9, 9]),
  };

  state.follow = true;
  navFitRoute(true);                       // why == null: destinazione nuova
  assert.equal(fitted, 1, 'rotta fresca non inquadrata');
  assert.equal(state.follow, false, 'follow non staccato sulla rotta fresca');

  state.follow = true;
  navFitRoute(false);                      // why != null: ricalcolo o ripresa
  assert.equal(fitted, 1, 'inquadratura anche in ricalcolo: follow spento a metà viaggio');
  assert.equal(state.follow, true, 'follow spento in ricalcolo');
});

// ---------------------------------------------------------------- #18

test('#18 soglia catena: stessa formula per banner e voce, cresce con la velocità', () => {
  assert.equal(navChainMinM(0), NAV_CHAIN_MIN_M);
  assert.equal(navChainMinM(5), NAV_CHAIN_MIN_M);    // 6*5 = 30 m, sotto il minimo
  assert.equal(navChainMinM(40), 240);               // 144 km/h

  resetState();
  // 200 m fra due manovre: sotto la soglia a 40 m/s, sopra quella fissa di 150 m.
  state.nav = {
    status: 'ACTIVE', dest: { lat: 45, lon: 9, label: 'X' }, vRef: 40,
    totalM: 5000, totalS: 600, distRemain: 3000, timeRemain: 400,
    distToNext: 800, nextMan: 0, sAlong: 0,
    sMan: new Float64Array([0, 200, 3000]),
    man: [{ type: 10, text: 'Gira a destra', streets: [] },
          { type: 12, text: 'Poi svolta', streets: [] },
          { type: 4, text: 'Arrivo', streets: [] }],
  };
  navRenderBanner();
  const banner = els.navBanner.textContent;
  assert.ok(banner.includes('poi ' + NAV_ICON[12] + ' ' + navShortCue('Poi svolta')),
    'banner senza manovra incatenata mentre la voce la annuncia: ' + JSON.stringify(banner));

  /* Manovra incatenata silent (uscita di rotonda OSRM): navAnnounce la tace, il
     banner la annunciava lo stesso — due indicazioni diverse nello stesso istante. */
  const then = 'poi ' + NAV_ICON[12] + ' ';
  state.nav.man[1].silent = true;
  navRenderBanner();
  assert.ok(!els.navBanner.textContent.includes(then),
    'banner annuncia una manovra incatenata che la voce tace: ' + JSON.stringify(els.navBanner.textContent));
  delete state.nav.man[1].silent;

  /* multiCue: vPre contiene già entrambe le manovre ed è quella che la voce legge;
     m.text è solo la prima metà. Il banner diceva la prima metà + un "poi" in più. */
  state.nav.man[0].multiCue = true;
  state.nav.man[0].vPre = 'Gira a destra, poi svolta';
  navRenderBanner();
  const b2 = els.navBanner.textContent;
  assert.ok(!b2.includes(then), 'multiCue: manovra incatenata ripetuta nel banner: ' + JSON.stringify(b2));
  assert.ok(b2.includes('Gira a destra, poi svolta'),
    'multiCue: banner e voce dicono cose diverse: ' + JSON.stringify(b2));
});

// ---------------------------------------------------------------- #21

test('#21 risultati ricerca: combobox annunciabile e navigabile da tastiera', () => {
  resetState();
  const items = [
    { lat: 45.46, lon: 9.19, label: 'Duomo', sub: 'Milano' },
    { lat: 41.9, lon: 12.5, label: 'Roma', sub: 'Lazio' },
  ];
  navRenderResults(items);
  const box = els.navResults;
  assert.equal(box.children.length, 2);
  assert.equal(box.children[0].type, 'button', 'button senza type: dentro un form farebbe submit');
  assert.equal(box.children[0].getAttribute('role'), 'option');
  assert.equal(els.navQuery.getAttribute('aria-expanded'), 'true', 'comparsa risultati non annunciata');

  const k = key => ({ key, target: els.navQuery, preventDefault() {} });
  // Frecce: ArrowDown sposta il fuoco sul primo risultato, poi sul secondo.
  navResultsKey(k('ArrowDown'));
  assert.equal(vmSandbox.document.activeElement, box.children[0]);
  navResultsKey(k('ArrowDown'));
  assert.equal(vmSandbox.document.activeElement, box.children[1]);
  navResultsKey(k('ArrowUp'));
  assert.equal(vmSandbox.document.activeElement, box.children[0]);

  // Da qui in poi i tasti partono DAL RISULTATO, non dal campo: #navResults è un
  // fratello di #navQuery, quindi in un browser l'evento non risale al campo. Senza
  // il filtro sul target e il listener sul documento, dal secondo elemento in poi
  // frecce e Invio erano morti.
  const kIn = key => ({ key, target: box.children[0], preventDefault() {} });
  navResultsKey(kIn('ArrowDown'));
  assert.equal(vmSandbox.document.activeElement, box.children[1], 'ArrowDown da un risultato ignorata');
  navResultsKey(kIn('ArrowUp'));
  assert.equal(vmSandbox.document.activeElement, box.children[0], 'ArrowUp da un risultato ignorata');
  // Un keydown nato altrove non deve muovere il fuoco della lista.
  navResultsKey({ key: 'ArrowDown', target: els.navSteps, preventDefault() {} });
  assert.equal(vmSandbox.document.activeElement, box.children[0], 'la lista reagisce a tasti di altri elementi');

  navResultsKey(kIn('Enter'));
  assert.equal(state.navDest.label, 'Duomo');
  /* Invio svuota la lista: il bottone appena premuto esce dal DOM e il fuoco cade
     su <body>, da dove non raggiunge né il campo né la lista. */
  assert.equal(vmSandbox.document.activeElement, els.navQuery,
    'fuoco perso dopo Invio: la lista non è più raggiungibile da tastiera');
  assert.equal(box.children.length, 0);
  assert.equal(els.navQuery.getAttribute('aria-expanded'), 'false', 'combobox resta aperto su lista vuota');

  // Esc chiude la lista E annulla la ricerca in volo: senza, la risposta Photon già
  // partita atterrava dopo (my === navSearchSeq) e riapriva la lista appena chiusa.
  navRenderResults(items);
  const seqEsc = navSearchSeqGet();
  navResultsKey({ key: 'Escape', target: els.navQuery, preventDefault() {} });
  assert.equal(box.children.length, 0);
  assert.equal(navSearchSeqGet(), seqEsc + 1, 'Esc chiude la lista ma lascia la risposta in volo');
  assert.equal(vmSandbox.document.activeElement, els.navQuery, 'fuoco non tornato nel campo dopo Esc');
});

test('#21 Esc a lista vuota: annulla comunque la ricerca in volo', () => {
  resetState();
  navClearResults();
  const seq = navSearchSeqGet();
  /* L'uscita anticipata per lista vuota scattava PRIMA del ramo Escape: con la lista
     già chiusa (nessun risultato, o Esc appena premuto) la richiesta Photon restava
     in volo e atterrando riapriva la lista che Esc aveva chiuso. */
  navResultsKey({ key: 'Escape', target: els.navQuery, preventDefault() {} });
  assert.equal(navSearchSeqGet(), seq + 1, 'Esc su lista vuota non invalida la risposta in volo');
  assert.equal(vmSandbox.document.activeElement, els.navQuery, 'fuoco non riportato nel campo');
});

test('#21 ridisegno della lista: il fuoco resta su un risultato', () => {
  resetState();
  const r = (n) => ({ lat: 45 + n / 1000, lon: 9, label: 'R' + n, sub: '' });
  navRenderResults([r(1), r(2)]);
  const box = els.navResults;
  const k = key => ({ key, target: els.navQuery, preventDefault() {} });
  navResultsKey(k('ArrowDown'));
  navResultsKey(k('ArrowDown'));
  assert.equal(vmSandbox.document.activeElement, box.children[1]);

  // Risposta del debounce di un carattere in più: la lista viene ricostruita mentre
  // il fuoco è su una option.
  navRenderResults([r(3), r(4), r(5)]);
  assert.equal(vmSandbox.document.activeElement, box.children[1],
    'opzione distrutta dal ridisegno: il fuoco cade su <body> e frecce/Esc/Invio muoiono');

  // Lista nuova più corta dell\'indice: il fuoco torna nel campo, non su un nodo staccato.
  navRenderResults([r(6)]);
  assert.equal(vmSandbox.document.activeElement, els.navQuery,
    'fuoco lasciato su un\'opzione che non esiste più');
});

test('#21 il listener della tastiera è sul documento, non sul campo', () => {
  // init() non gira nell'harness, quindi il wiring non è osservabile a runtime: si
  // controlla la sorgente. Sul campo il listener non riceve nulla una volta che il
  // fuoco è entrato nei risultati.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes("document.addEventListener('keydown', navResultsKey)"),
    'keydown della ricerca non registrato sul documento');
  assert.ok(!/els\.navQuery\.addEventListener\('keydown'/.test(html),
    'keydown tornato su #navQuery: dal primo risultato in poi i tasti non arrivano più');
});

// ---------------------------------------------------------------- #22

test('#22 navReset ferma anche il simulatore, non solo la navigazione', () => {
  resetState();
  // Baseline a intervalli zero: il sim lasciato vivo da un test prima non conta qui,
  // e nemmeno l'heartbeat della voce (armato al load di js/nav-map.js), che navReset
  // spegne — contarlo farebbe sembrare il reset un timer sparito.
  navSimStop();
  navSpeak.stopHeartbeat();
  const base = liveIntervals();
  state.nav = simRoute(45, 9);
  navSimStart();
  assert.equal(liveIntervals(), base + 1, 'simulatore non avviato');

  navReset();
  assert.equal(state.nav, null);
  assert.equal(liveIntervals(), base, 'timer del simulatore sopravvissuto al reset');

  state.pos.lat = null; state.pos.lon = null;
  tickIntervals();                        // un giro di tutti gli interval vivi
  assert.equal(state.pos.lat, null, 'il simulatore ha scritto in state dopo il reset');
});

// ---------------------------------------------------------------- #16

/* Il banner è una live region (`role="status" aria-live="polite"`): ricostruirlo
   da zero a ogni fix GPS faceva rileggere tutta la riga allo screen reader ogni
   secondo, e la velocità che cambia a ogni tick affogava la manovra. */
test('#16 banner: scheletro riusato a ogni fix, velocità fuori dalla live region', () => {
  resetState();
  state.speedKph = 72;
  state.nav = {
    status: 'ACTIVE', dest: { lat: 45, lon: 9, label: 'X' },
    totalM: 5000, totalS: 600, distRemain: 3000, timeRemain: 400,
    nextMan: 0, sAlong: 1000, distToNext: 200,
    sMan: new Float64Array([1000, 3000]),
    man: [{ type: 10, text: 'Gira a destra', streets: [] }, { type: 4, text: 'Arrivo', streets: [] }],
  };
  navRenderBanner();
  const el = els.navBanner;
  const speed = el.children[0], msg = el.children[1];
  assert.equal(speed.className, 'nb-speed');
  assert.equal(speed.getAttribute('aria-hidden'), 'true', 'velocità annunciata a ogni tick');
  assert.equal(speed.textContent, '72 km/h');
  const dist = msg.children[0], street = msg.children[1];
  assert.equal(dist.className, 'nb-dist');
  assert.equal(street.className, 'nb-street');

  // Fix successivo: cambiano solo velocità e distanza, i nodi restano quelli.
  state.speedKph = 75;
  state.nav.sAlong = 1050;
  navRenderBanner();
  assert.equal(el.children[0], speed, 'banner ricostruito a ogni fix (churn nella live region)');
  assert.equal(el.children[1], msg, 'contenitore del messaggio ricreato');
  assert.equal(msg.children[0], dist, 'span distanza ricreata');
  assert.equal(msg.children[1], street, 'span strada ricreata');
  assert.equal(speed.textContent, '75 km/h');

  // Ramo d'arrivo (non più una manovra): la velocità non deve restare appesa,
  // come faceva il vecchio `el.textContent = ''` che spazzava tutto.
  state.nav.status = 'ARRIVED';
  navRenderBanner();
  assert.equal(speed.textContent, '', 'velocità rimasta nel banner di arrivo');
  assert.ok(el.textContent.includes('Arrivato'), 'testo: ' + el.textContent);
});
