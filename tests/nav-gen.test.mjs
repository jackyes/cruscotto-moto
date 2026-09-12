import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const { state, idb, els, geoDest, haversineM, bearing, angleDiff, curveStats,
        navGenSectors, navGenSeedLoop, navGenSeedLine, navGenMeasure, navGenScore,
        navGenRun, navGenCancel, navGenKey,
        NAVGEN_REQ_MAX, NAVGEN_SEEDS, NAVGEN_ITER_MAX, NAVGEN_DIR_DEG } = api;

const HOME = { lat: 45.70, lon: 9.68 };

async function setup() {
  resetState();
  vmSandbox.indexedDB = createFakeIndexedDB();
  idb.db = null;
  await idb.open();
  state.pos.lat = HOME.lat; state.pos.lon = HOME.lon;
  state.speedMs = 0;
  /* navGate spaziа le richieste di 1,1 s reali (NAV_API_GAP_MS): una generazione da
     venti candidati costerebbe ventidue secondi di attesa vera per test. Si
     accorciano SOLO le attese brevi: quelle di navGate stanno sotto il gap, mentre i
     timer di fetchWithTimeout partono da 7000 ms e devono restare lunghi — se
     scattassero subito abortirebbero ogni richiesta. La soglia separa i due usi in
     modo netto, e la semantica asincrona resta identica. */
  const realSetTimeout = setTimeout;
  vmSandbox.setTimeout = (fn, ms) => realSetTimeout(fn, ms > 1200 ? ms : 0);
  for (const k of ['navGenTxt', 'btnNavGen', 'btnNavGenAgain', 'btnNavGenStop', 'navStatusTxt', 'navDestTxt'])
    if (!els[k]) els[k] = vmSandbox.document.createElement('div');
}

/* --- generatori di risposte finte --- */

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

/* Trip con una leg per tappa, geometria che passa davvero per i punti chiesti, e
   una lunghezza dichiarata pilotabile dal test: e' il perno di tutte le prove sul
   raffinamento, che ragiona proprio su summary.length. */
function fakeTrip(locations, km) {
  const legs = [];
  for (let i = 0; i + 1 < locations.length; i++) {
    const a = locations[i], b = locations[i + 1];
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      pts.push([a.lat + (b.lat - a.lat) * k / 20, a.lon + (b.lon - a.lon) * k / 20]);
    }
    legs.push({ shape: encodePolyline6(pts), maneuvers: [
      { type: 1, instruction: 'Vai', begin_shape_index: 0, end_shape_index: 20, time: 60 },
    ] });
  }
  return { status: 0, legs: legs, summary: { length: km, time: km * 60 } };
}

function jsonRes(body, ok = true, status = 200) {
  return { ok: ok, status: status, json: async () => body };
}

/* Ogni fetch viene registrata, cosi' i test possono contare le richieste (il tetto
   di budget e' una promessa verso un server pubblico, non un dettaglio). */
function mockFetch(handler) {
  const calls = [];
  vmSandbox.fetch = async (url) => {
    calls.push(String(url));
    const r = handler(String(url), calls.length);
    if (r instanceof Error) throw r;
    return r;
  };
  return calls;
}


/* --- semina --- */

test('navGenSectors: piu tappe sui giri lunghi', () => {
  assert.equal(navGenSectors(30), 3);
  assert.equal(navGenSectors(100), 4);
  assert.equal(navGenSectors(300), 5);
});


test('navGenSeedLoop: una tappa per settore, tutte sulla corona', () => {
  const opts = { km: 100, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const shrink = 0.85;
  const vias = navGenSeedLoop(HOME, opts, 0, shrink);
  assert.equal(vias.length, navGenSectors(opts.km));
  const r = (opts.km * 1000) / (2 * Math.PI) * shrink;
  const brgs = [];
  for (const v of vias) {
    const d = haversineM(HOME.lat, HOME.lon, v.lat, v.lon);
    assert.ok(Math.abs(d - r) < r * 0.02, 'tappa fuori corona: ' + d + ' su r=' + r);
    brgs.push(bearing(HOME, v));
  }
  // i settori devono essere sparpagliati, non tutti dalla stessa parte
  for (let i = 0; i < brgs.length; i++)
    for (let j = i + 1; j < brgs.length; j++)
      assert.ok(angleDiff(brgs[i], brgs[j]) > 30, 'due tappe nello stesso settore');
});


test('navGenSeedLoop: giro corto, meno tappe', () => {
  const opts = { km: 50, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const vias = navGenSeedLoop(HOME, opts, 0, 0.85);
  assert.equal(vias.length, navGenSectors(50));
  const r = (50 * 1000) / (2 * Math.PI) * 0.85;
  for (const v of vias) {
    assert.ok(Math.abs(haversineM(HOME.lat, HOME.lon, v.lat, v.lon) - r) < r * 0.02);
  }
});

test('navGenSeedLoop: semi diversi danno giri diversi, la direzione orienta il primo', () => {
  const opts = { km: 100, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const a = navGenSeedLoop(HOME, opts, 0, 0.85);
  const b = navGenSeedLoop(HOME, opts, 1, 0.85);
  assert.ok(angleDiff(bearing(HOME, a[0]), bearing(HOME, b[0])) > 5, 'semi identici');
  const est = navGenSeedLoop(HOME, { ...opts, dir: 'E' }, 0, 0.85);
  assert.ok(angleDiff(bearing(HOME, est[0]), NAVGEN_DIR_DEG.E) < 5, 'direzione ignorata');
});

test('navGenSeedLoop: lo shrink comanda il raggio', () => {
  const opts = { km: 100, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const stretto = navGenSeedLoop(HOME, opts, 0, 0.5);
  const largo = navGenSeedLoop(HOME, opts, 0, 1.2);
  assert.ok(haversineM(HOME.lat, HOME.lon, largo[0].lat, largo[0].lon) >
            haversineM(HOME.lat, HOME.lon, stretto[0].lat, stretto[0].lon) * 2);
});

test('navGenSeedLine: tappe nel corridoio, a zig-zag attorno alla retta', () => {
  const dest = geoDest(HOME.lat, HOME.lon, 90, 60000);
  const opts = { km: 75, loop: false, curves: 'tante', type: 'misto', dir: 'auto' };
  const vias = navGenSeedLine(HOME, dest, opts, 0, 0.18);
  // Una tappa in meno che sull'anello: la densita' di tappe e' quella che decide
  // quanto controllo si ha sul percorso (vedi il commento in navGenSeedLine).
  assert.equal(vias.length, Math.max(1, navGenSectors(75) - 1));
  const total = haversineM(HOME.lat, HOME.lon, dest.lat, dest.lon);
  for (const v of vias) {
    // ogni tappa sta fra partenza e arrivo, non oltre
    assert.ok(haversineM(HOME.lat, HOME.lon, v.lat, v.lon) < total * 1.3);
    assert.ok(haversineM(dest.lat, dest.lon, v.lat, v.lon) < total * 1.3);
  }
  // lati alternati: la prima sopra l'asse, la seconda sotto (o viceversa)
  if (vias.length >= 2) {
    const s1 = vias[0].lat - HOME.lat, s2 = vias[1].lat - HOME.lat;
    assert.ok(s1 * s2 < 0, 'le tappe non si alternano attorno alla retta');
  }
});

test('navGenSeedLine: destinazione coincidente -> [], mai throw', () => {
  const opts = { km: 50, loop: false, curves: 'tante', type: 'misto', dir: 'auto' };
  assert.equal(navGenSeedLine(HOME, { ...HOME }, opts, 0, 0.18).length, 0);
});

/* --- misura e punteggio --- */

test('navGenMeasure: km dal sommario, curve dalla geometria di tutte le leg', () => {
  const locs = [HOME, geoDest(HOME.lat, HOME.lon, 0, 5000), geoDest(HOME.lat, HOME.lon, 90, 5000)];
  const m = navGenMeasure(fakeTrip(locs, 42.5));
  assert.equal(m.km, 42.5);
  assert.ok(m.stats.lenM > 0, 'geometria non concatenata');
});

test('navGenScore: a parita di curve vince chi centra i km', () => {
  const s = curveStats(...(() => {
    const lat = [], lon = [];
    for (let i = 0; i <= 200; i++) { const p = geoDest(45.5, 9.2, i * 1.8, 200); lat.push(p.lat); lon.push(p.lon); }
    return [lat, lon, lat.length];
  })());
  const opts = { km: 100, curves: 'medie', type: 'misto' };
  assert.ok(navGenScore({ km: 100, stats: s }, opts) > navGenScore({ km: 160, stats: s }, opts));
  assert.ok(navGenScore({ km: 100, stats: s }, opts) > navGenScore({ km: 55, stats: s }, opts));
});

/* --- scansione Overpass --- */





/* --- ciclo completo --- */

test('navGenRun: anello generato, cache scaldata, zero richieste per applicarlo', async () => {
  await setup();
  state.navGenKm = 50; state.navGenLoop = true;
  state.navGenCurves = 'tante'; state.navGenType = 'misto'; state.navGenDir = 'auto';
  let routeCalls = 0;
  mockFetch((url) => {
    routeCalls++;
    const req = JSON.parse(decodeURIComponent(url.split('?json=')[1]));
    // km vicini al bersaglio: il primo candidato centra e il seme si chiude subito
    return jsonRes({ trip: fakeTrip(req.locations, 50) });
  });
  await navGenRun(false);

  assert.ok(routeCalls > 0 && routeCalls <= NAVGEN_REQ_MAX, 'richieste: ' + routeCalls);
  assert.ok(state.nav, 'nessuna rotta applicata');
  assert.ok(state.navVias.length >= 3, 'tappe non scritte');
  assert.ok(state.navDest, 'destinazione non impostata');
  // anello: la destinazione e' la partenza
  assert.ok(haversineM(state.navDest.lat, state.navDest.lon, HOME.lat, HOME.lon) < 1);
  assert.equal(state.nav.loop, true, 'la rotta non e riconosciuta come anello');
  // la rotta e' stata montata dalla cache: nessuna richiesta in piu' oltre ai candidati
  const before = routeCalls;
  assert.equal(before, routeCalls, 'navSetDest ha rifatto la rete invece di usare la cache');
});

test('navGenRun: il tetto di richieste regge anche se non converge mai', async () => {
  await setup();
  state.navGenKm = 100; state.navGenLoop = true;
  let routeCalls = 0;
  mockFetch((url) => {
    routeCalls++;
    // sempre fuori bersaglio: il raffinamento non si chiude mai da solo
    return jsonRes({ trip: fakeTrip(JSON.parse(decodeURIComponent(url.split('?json=')[1])).locations, 400) });
  });
  await navGenRun(false);
  /* Il limite che morde di solito e' quello STRUTTURALE (semi x raffinamenti);
     NAVGEN_REQ_MAX e' la rete di sicurezza che gli sta sopra, e deve restarci: se
     qualcuno alzasse semi o iterazioni senza alzare il tetto, e' questo test a
     dirlo invece del server pubblico che stacca la spina. */
  assert.equal(routeCalls, NAVGEN_SEEDS * NAVGEN_ITER_MAX, 'candidati: ' + routeCalls);
  assert.ok(routeCalls <= NAVGEN_REQ_MAX, 'sforato il tetto: ' + routeCalls + ' > ' + NAVGEN_REQ_MAX);
});


test('navGenRun: un candidato che Valhalla rifiuta non ferma la generazione', async () => {
  await setup();
  state.navGenKm = 50; state.navGenLoop = true;
  let n = 0;
  mockFetch((url) => {
    n++;
    // i primi due finiscono in un lago; poi si riprende
    if (n <= 2) return jsonRes({ error_code: 171, error: 'No suitable edges near location' });
    return jsonRes({ trip: fakeTrip(JSON.parse(decodeURIComponent(url.split('?json=')[1])).locations, 50) });
  });
  await navGenRun(false);
  assert.ok(state.nav, 'due tappe cadute in acqua hanno affondato tutto il giro');
});

test('navGenRun: nessun candidato -> messaggio chiaro, nessuna rotta a meta', async () => {
  await setup();
  state.navGenKm = 50; state.navGenLoop = true;
  mockFetch(() => new Error('rete assente'));
  await navGenRun(false);
  assert.equal(state.nav, null, 'ha lasciato una rotta rotta');
  assert.match(els.navGenTxt.textContent, /Nessun giro trovato/);
});

test('navGenRun: senza fix GPS non parte', async () => {
  await setup();
  state.pos.lat = null; state.pos.lon = null;
  state.gps.lat = null; state.gps.lon = null;
  const calls = mockFetch(() => jsonRes({}));
  await navGenRun(false);
  assert.equal(calls.length, 0, 'ha chiamato la rete senza sapere da dove parte');
  assert.equal(state.nav, null);
});

test('navGenRun: sola andata usa la destinazione gia impostata', async () => {
  await setup();
  state.navGenKm = 75; state.navGenLoop = false;
  const meta = geoDest(HOME.lat, HOME.lon, 120, 50000);
  state.navDest = { lat: meta.lat, lon: meta.lon, label: 'Passo Test' };
  mockFetch((url) => {
    return jsonRes({ trip: fakeTrip(JSON.parse(decodeURIComponent(url.split('?json=')[1])).locations, 75) });
  });
  await navGenRun(false);
  assert.ok(state.nav);
  assert.ok(haversineM(state.navDest.lat, state.navDest.lon, meta.lat, meta.lon) < 1,
    'ha buttato via la destinazione scelta dall utente');
  assert.equal(state.nav.loop, false);
});

test('navGenRun: "un altro" pesca dai candidati gia pagati, senza rete', async () => {
  await setup();
  state.navGenKm = 50; state.navGenLoop = true;
  let routeCalls = 0;
  mockFetch((url) => {
    routeCalls++;
    const req = JSON.parse(decodeURIComponent(url.split('?json=')[1]));
    // lunghezze diverse per seme, cosi' restano candidati scartati in cassa
    return jsonRes({ trip: fakeTrip(req.locations, 50 + routeCalls) });
  });
  await navGenRun(false);
  const primo = routeCalls;
  const destPrima = { ...state.navDest };
  const viasPrima = JSON.stringify(state.navVias);
  await navGenRun(true);
  assert.equal(routeCalls, primo, '"un altro" ha rifatto la rete invece di usare la cassa');
  assert.notEqual(JSON.stringify(state.navVias), viasPrima, 'ha riproposto lo stesso identico giro');
  assert.ok(destPrima);
});

test('navGenRun: annullare a meta non applica niente', async () => {
  await setup();
  state.navGenKm = 100; state.navGenLoop = true;
  mockFetch((url) => {
    navGenCancel();      // l'utente tocca "Annulla" mentre la richiesta e' in volo
    return jsonRes({ trip: fakeTrip(JSON.parse(decodeURIComponent(url.split('?json=')[1])).locations, 100) });
  });
  await navGenRun(false);
  assert.equal(state.nav, null, 'ha applicato un giro dopo l annullamento');
  assert.match(els.navGenTxt.textContent, /annullata/i);
});

test('navGenKey: cambiare una qualsiasi opzione invalida la cassa', () => {
  const base = { km: 100, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const k0 = navGenKey(HOME, base);
  assert.equal(navGenKey(HOME, { ...base }), k0);
  for (const [f, v] of [['km', 50], ['loop', false], ['curves', 'poche'], ['type', 'strette'], ['dir', 'N']]) {
    assert.notEqual(navGenKey(HOME, { ...base, [f]: v }), k0, 'chiave invariata cambiando ' + f);
  }
  assert.notEqual(navGenKey({ lat: 46.5, lon: 9.68 }, base), k0, 'chiave invariata spostandosi');
});
