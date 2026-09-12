/* Le tre regressioni che un giro AD ANELLO fa emergere nel navigatore, piu' la
   non-regressione del percorso normale accanto a ognuna: la destinazione di un
   anello e' la partenza, e tutto il codice che ragiona "quanto sei lontano
   dall'arrivo" aveva quel caso come punto cieco. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState } from './harness.mjs';

const { state, els, navBuild, navTick, navIsLoop, navViasRemaining, navHeadForReq,
        navPersistRoute, navRestore, idb, haversineM,
        NAV_ARRIVE_FIXES, NAV_LOOP_CLOSE_M, NAV_LOOP_MIN_M, HEADING_MIN_MS } = api;

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

/* Quadrato di ~0,04 gradi di lato (~4,4 km) che torna al punto di partenza: circa
   17 km, sopra NAV_LOOP_MIN_M. Una leg per lato, come le manda Valhalla con tre
   tappe intermedie. */
const SQ = [[45, 9], [45.04, 9], [45.04, 9.04], [45, 9.04], [45, 9]];
function buildLoop() {
  resetState();
  const legs = [];
  for (let i = 0; i + 1 < SQ.length; i++) {
    const a = SQ[i], b = SQ[i + 1], pts = [];
    for (let k = 0; k <= 10; k++) pts.push([a[0] + (b[0] - a[0]) * k / 10, a[1] + (b[1] - a[1]) * k / 10]);
    legs.push({
      shape: encodePolyline6(pts),
      maneuvers: [{ type: i === SQ.length - 2 ? 4 : 1, instruction: 'lato ' + i,
                    begin_shape_index: 0, end_shape_index: 10, time: 300 }],
    });
  }
  const nv = navBuild({ legs: legs });
  nv.dest = { lat: 45, lon: 9, label: 'Anello' };
  nv.status = 'ACTIVE';
  nv.nextMan = 1; nv.sAlong = 0; nv.offDist = 0; nv.offThr = 50;
  nv.spoken = 0; nv.preSpoken = {}; nv.arriveCount = 0;
  nv.destStale = false; nv.lastGoodAt = Date.now();
  nv.rerouteLog = []; nv.rerouteStreak = 0; nv.rerouteAt = 0; nv.rerouteWait = 0;
  state.nav = nv;
  state.navDest = { lat: 45, lon: 9, label: 'Anello' };
  state.navVias = [{ lat: 45.04, lon: 9 }, { lat: 45.04, lon: 9.04 }, { lat: 45, lon: 9.04 }];
  return nv;
}

// Stessa forma ma aperta: parte da (45,9) e finisce lontano.
function buildOpen() {
  resetState();
  const pts = [];
  for (let k = 0; k <= 40; k++) pts.push([45 + 0.04 * k / 40, 9]);
  const nv = navBuild({
    legs: [{ shape: encodePolyline6(pts), maneuvers: [
      { type: 1, instruction: 'parti', begin_shape_index: 0, end_shape_index: 20, time: 300 },
      { type: 4, instruction: 'arriva', begin_shape_index: 20, end_shape_index: 40, time: 300 },
    ] }],
  });
  nv.dest = { lat: 45.04, lon: 9, label: 'Meta' };
  nv.status = 'ACTIVE';
  nv.nextMan = 1; nv.sAlong = 0; nv.offDist = 0; nv.offThr = 50;
  nv.spoken = 0; nv.preSpoken = {}; nv.arriveCount = 0;
  nv.destStale = false; nv.lastGoodAt = Date.now();
  nv.rerouteLog = []; nv.rerouteStreak = 0; nv.rerouteAt = 0; nv.rerouteWait = 0;
  state.nav = nv;
  state.navDest = { lat: 45.04, lon: 9, label: 'Meta' };
  return nv;
}

/* --- 1. riconoscimento dell'anello --- */

test('navIsLoop: chiuso e lungo -> anello; aperto o degenere -> no', () => {
  const chiuso = buildLoop();
  assert.equal(chiuso.loop, true, 'un quadrato chiuso non e riconosciuto come anello');
  assert.equal(buildOpen().loop, false, 'una rotta aperta scambiata per anello');
  // chiuso ma corto: e' una rotta degenere, non un giro
  assert.equal(navIsLoop([45, 45.0001], [9, 9], 2, NAV_LOOP_MIN_M - 1), false);
  assert.equal(navIsLoop([45, 45], [9, 9], 2, 0), false);
  assert.equal(navIsLoop([], [], 0, 0), false);
});

/* Il flag non e' persistito da nessuna parte: se dipendesse da chi ha CHIESTO il
   giro, una rotta ripristinata da IndexedDB tornerebbe "non anello" e l'arrivo
   scatterebbe di nuovo al primo fix. navBuild lo ricalcola dalla geometria e
   navRestore passa di li' — la prova sta nel test di persist/restore in fondo. */

/* --- 2. l'arrivo non deve scattare alla partenza (fix js/nav-engine.js) --- */

test('anello: fermi sulla partenza non si "arriva" (era: arrivato dal parcheggio)', () => {
  const nv = buildLoop();
  for (let i = 0; i < NAV_ARRIVE_FIXES + 3; i++) navTick(45, 9, 8);
  assert.notEqual(nv.status, 'ARRIVED',
    'la destinazione di un anello e la partenza: il termine geometrico dell arrivo va sospeso');
});

test('anello: a meta giro compiuto, tornare sulla partenza vale arrivo', () => {
  const nv = buildLoop();
  nv.sAlong = nv.totalM * 0.8;          // tre lati su quattro gia' percorsi
  nv.idx = nv.n - 3;
  for (let i = 0; i < NAV_ARRIVE_FIXES; i++) navTick(45, 9, 8);
  assert.equal(nv.status, 'ARRIVED', 'chiudendo l anello l arrivo deve scattare');
});

test('rotta normale: l arrivo per vicinanza funziona come prima (non-regressione)', () => {
  const nv = buildOpen();
  for (let i = 0; i < NAV_ARRIVE_FIXES; i++) navTick(45.04, 9, 8);
  assert.equal(nv.status, 'ARRIVED', 'il gate dell anello ha rotto l arrivo normale');
});

/* --- 3. le tappe sopravvivono al ricalcolo (fix js/nav-net.js) --- */

test('navViasRemaining: tiene solo le tappe ancora davanti', () => {
  const nv = buildLoop();
  // prima manovra: nessuna tappa superata
  nv.nextMan = 0;
  assert.equal(navViasRemaining().length, 3);
  // dentro la seconda leg: la prima tappa e' alle spalle
  nv.nextMan = 1;
  assert.equal(navViasRemaining().length, 2);
  assert.equal(navViasRemaining()[0].lat, 45.04);
  assert.equal(navViasRemaining()[0].lon, 9.04);
  // ultima leg: resta solo l'ultima tappa
  nv.nextMan = 3;
  assert.equal(navViasRemaining().length, 0);
});

test('navViasRemaining: senza tappe o senza rotta non lancia', () => {
  resetState();
  assert.equal(navViasRemaining().length, 0);
  state.navVias = [{ lat: 45, lon: 9 }];
  state.nav = null;
  assert.equal(navViasRemaining().length, 1, 'senza rotta viva le tappe restano tutte da fare');
  state.nav = { man: [] };
  assert.equal(navViasRemaining().length, 1);
});

test('navViasRemaining: un ricalcolo su un anello non punta dritto a casa', () => {
  /* La regressione vera: dest == partenza, quindi buttando via le tappe il
     ricalcolo produce "sei gia' arrivato" e il giro finisce al primo fuori-percorso. */
  const nv = buildLoop();
  nv.nextMan = 1;
  const residue = navViasRemaining();
  assert.ok(residue.length > 0, 'senza tappe residue il ricalcolo di un anello annulla il giro');
  const ultima = residue[residue.length - 1];
  assert.ok(haversineM(ultima.lat, ultima.lon, nv.dest.lat, nv.dest.lon) > 1000,
    'la tappa residua deve portare lontano da casa, non verso casa');
});

/* --- 4. persistenza delle tappe (fix js/nav-config.js) --- */

test('persist/restore: le tappe tornano dopo un riavvio, e l anello si ricalcola', async () => {
  const { createFakeIndexedDB } = await import('./fake-indexeddb.mjs');
  const { vmSandbox } = await import('./harness.mjs');
  const nv = buildLoop();
  vmSandbox.indexedDB = createFakeIndexedDB();
  idb.db = null;
  await idb.open();
  nv.shapeRaw = [];
  for (let i = 0; i + 1 < SQ.length; i++) {
    const a = SQ[i], b = SQ[i + 1], pts = [];
    for (let k = 0; k <= 10; k++) pts.push([a[0] + (b[0] - a[0]) * k / 10, a[1] + (b[1] - a[1]) * k / 10]);
    nv.shapeRaw.push(encodePolyline6(pts));
  }
  nv.reqSaved = { from: { lat: 45, lon: 9 }, to: { lat: 45, lon: 9 } };
  await navPersistRoute();

  const rec = await idb.kvGet('activeRoute');
  assert.equal(rec.vias.length, 3, 'le tappe non sono finite nel record salvato');

  // riavvio: stato azzerato, si ricostruisce da IndexedDB
  const viePrima = JSON.stringify(state.navVias);
  resetState();
  assert.equal(state.navVias.length, 0);
  await navRestore();
  assert.equal(JSON.stringify(state.navVias), viePrima, 'le tappe non sono tornate');
  assert.equal(state.nav.loop, true, 'l anello non e stato riconosciuto dopo il restore');
});

/* --- 5. l heading di richiesta e cache non possono divergere --- */

test('navHeadForReq: null da fermi, il valore in movimento', () => {
  resetState();
  state.speedMs = 0;
  assert.equal(navHeadForReq(90), null, 'da fermi la bussola e rumore');
  state.speedMs = HEADING_MIN_MS + 1;
  assert.equal(navHeadForReq(90), 90);
  assert.equal(navHeadForReq(null), null);
  assert.equal(navHeadForReq(NaN), null);
});
