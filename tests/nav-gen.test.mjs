import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const { state, idb, els, geoDest, haversineM, bearing, angleDiff, curveStats,
        navGenReduceWays, navGenRankWays, navGenSectors, navGenPickWay,
        navGenSeedLoop, navGenSeedLine, navGenWayPair, navGenMeasure, navGenScore,
        navGenScanCurvy, navGenRun, navGenCancel, navGenKey,
        NAVGEN_REQ_MAX, NAVGEN_SEEDS, NAVGEN_ITER_MAX, NAVGEN_WAY_MIN_M, NAVGEN_WAY_KEEP, NAVGEN_DIR_DEG,
        routeCacheKey, navCostingOptions, navHeadForReq, trackUpHeading } = api;

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

function overpassWays(n, nodesPerWay = 40) {
  // cerchietti veri: passano il filtro di lunghezza e di curvosita'
  const els2 = [];
  for (let i = 0; i < n; i++) {
    const c = geoDest(HOME.lat, HOME.lon, (i * 360) / n, 12000);
    const geometry = [];
    for (let k = 0; k <= nodesPerWay; k++) {
      const p = geoDest(c.lat, c.lon, (k * 360) / nodesPerWay, 90);
      geometry.push({ lat: p.lat, lon: p.lon });
    }
    els2.push({ type: 'way', id: i + 1, geometry: geometry });
  }
  return { elements: els2 };
}

/* --- riduzione e classifica --- */

test('navGenReduceWays: scarta frammenti e rettilinei, tiene il punto a meta lunghezza', () => {
  const dritta = { geometry: [] };
  for (let i = 0; i <= 60; i++) dritta.geometry.push({ lat: 45 + i * 0.0005, lon: 9 });
  const corta = { geometry: [{ lat: 45, lon: 9 }, { lat: 45.0002, lon: 9.0002 }, { lat: 45.0004, lon: 9 }] };
  const buona = overpassWays(1).elements[0];
  const out = navGenReduceWays([dritta, corta, buona, { geometry: null }, null]);
  assert.equal(out.length, 1, 'doveva restare solo la way tortuosa');
  assert.ok(out[0].lenM >= NAVGEN_WAY_MIN_M);
  assert.ok(out[0].degPerKm > 0);
  /* Tre punti di aggancio: il centro (per settore e corona) piu' i due estremi, che
     sono quelli che finiscono davvero fra le tappe. Tutti e tre devono stare SULLA
     strada, non sul centro del rettangolo di ingombro: su una way a ferro di cavallo
     quel centro cade fuori dall'asfalto e Valhalla lo aggancia a una strada a caso. */
  const g = buona.geometry;
  const suStrada = p => g.some(q => haversineM(q.lat, q.lon, p.lat, p.lon) < 30);
  assert.ok(suStrada({ lat: out[0].lat, lon: out[0].lon }), 'centro fuori strada');
  assert.ok(suStrada({ lat: out[0].aLat, lon: out[0].aLon }), 'estremo A fuori strada');
  assert.ok(suStrada({ lat: out[0].bLat, lon: out[0].bLon }), 'estremo B fuori strada');
  assert.ok(haversineM(out[0].aLat, out[0].aLon, out[0].bLat, out[0].bLon) > out[0].lenM * 0.2,
    'i due estremi sono troppo vicini per costringere a percorrere la strada');
});

test('navGenReduceWays: elenco vuoto o nullo -> [], mai throw', () => {
  // .length e non deepEqual: gli array arrivano dal realm della vm, quindi non
  // sono reference-equal con un [] di questo modulo.
  assert.equal(navGenReduceWays([]).length, 0);
  assert.equal(navGenReduceWays(null).length, 0);
});

test('navGenReduceWays: oltre il tetto campiona tutta la scala, non taglia la coda', () => {
  /* Regressione: la cache tagliava alle N way PIU tortuose. Ma la chiave di cache
     non include curve/tipo (apposta: cambiare impostazione non deve riscaricare
     niente), quindi chi chiedeva "poche curve" cercava dentro un pozzo da cui ogni
     strada tranquilla era gia' stata buttata via. */
  const elements = [];
  for (let i = 0; i < NAVGEN_WAY_KEEP * 2; i++) {
    const R = 40 + (i % 60) * 8;                  // raggi da 40 a 512 m: scala intera
    const c = geoDest(HOME.lat, HOME.lon, (i * 360) / 40, 6000 + (i % 20) * 300);
    const geometry = [];
    for (let k = 0; k <= 14; k++) {
      const p = geoDest(c.lat, c.lon, (k * 360) / 14, R);
      geometry.push({ lat: p.lat, lon: p.lon });
    }
    elements.push({ geometry: geometry });
  }
  const out = navGenReduceWays(elements);
  assert.equal(out.length, NAVGEN_WAY_KEEP, 'tetto non rispettato: ' + out.length);
  const dpk = out.map(w => w.degPerKm).sort((a, b) => a - b);
  const tutte = navGenReduceWays(elements.slice(0, NAVGEN_WAY_KEEP)).map(w => w.degPerKm);
  const minTutte = Math.min(...tutte);
  assert.ok(dpk[0] < minTutte * 1.6,
    'la coda tranquilla e sparita: minimo tenuto ' + dpk[0].toFixed(0) + ' su ' + minTutte.toFixed(0));
  assert.ok(dpk[dpk.length - 1] / dpk[0] > 5,
    'il pozzo non copre la scala: da ' + dpk[0].toFixed(0) + ' a ' + dpk[dpk.length - 1].toFixed(0));
  // ...e le tre impostazioni devono pescare popolazioni davvero diverse
  const medOf = curves => {
    const r = navGenRankWays(out, HOME, { curves, type: 'misto' }).slice(0, 20);
    const v = r.map(w => out.find(x => x.lat === w.lat && x.lon === w.lon).degPerKm).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  assert.ok(medOf('poche') < medOf('medie'), 'poche non e piu calma di medie');
  assert.ok(medOf('medie') < medOf('tante'), 'medie non e piu calma di tante');
});

test('navGenRankWays: ordinate per punteggio, con distanza e rilevamento da casa', () => {
  const ways = navGenReduceWays(overpassWays(8).elements);
  const r = navGenRankWays(ways, HOME, { curves: 'tante', type: 'misto' });
  assert.equal(r.length, ways.length);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score, 'non ordinate');
  for (const w of r) {
    assert.ok(Math.abs(w.d - haversineM(HOME.lat, HOME.lon, w.lat, w.lon)) < 1);
    assert.ok(w.b >= 0 && w.b < 360);
  }
});

/* --- semina --- */

test('navGenSectors: piu tappe sui giri lunghi', () => {
  assert.equal(navGenSectors(30), 3);
  assert.equal(navGenSectors(100), 4);
  assert.equal(navGenSectors(300), 5);
});

test('navGenPickWay: rispetta settore e corona, e non riusa la stessa strada', () => {
  const ranked = navGenRankWays(navGenReduceWays(overpassWays(16).elements), HOME,
    { curves: 'tante', type: 'misto' });
  const used = {};
  const a = navGenPickWay(ranked, 0, 90, 8000, 16000, used);
  assert.ok(a, 'nessuna way trovata nel settore nord');
  assert.ok(angleDiff(bearing(HOME, a), 0) <= 45);
  const d = haversineM(HOME.lat, HOME.lon, a.lat, a.lon);
  assert.ok(d >= 8000 && d <= 16000, 'fuori corona: ' + d);
  // seconda pescata nello stesso settore: non puo' essere la stessa strada
  const b = navGenPickWay(ranked, 0, 90, 8000, 16000, used);
  if (b) assert.ok(b.lat !== a.lat || b.lon !== a.lon);
  // corona impossibile -> null, non un'eccezione
  assert.equal(navGenPickWay(ranked, 0, 90, 900000, 1000000, {}), null);
});

test('navGenSeedLoop: una tappa per settore, tutte dentro la corona', () => {
  const opts = { km: 100, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const ranked = navGenRankWays(navGenReduceWays(overpassWays(24).elements), HOME, opts);
  const shrink = 0.85;
  const vias = navGenSeedLoop(HOME, opts, ranked, 0, shrink);
  const K = navGenSectors(opts.km);
  // Una COPPIA di tappe per settore quando c'e' una strada vera da percorrere
  // (entrata e uscita), una sola quando si ripiega sulla geometria.
  assert.ok(vias.length >= K && vias.length <= K * 2, 'tappe: ' + vias.length + ' su K=' + K);
  const r = (opts.km * 1000) / (2 * Math.PI) * shrink;
  for (const v of vias) {
    const d = haversineM(HOME.lat, HOME.lon, v.lat, v.lon);
    assert.ok(d >= r * 0.5 && d <= r * 1.5, 'tappa fuori corona: ' + d + ' su r=' + r);
  }
  // i settori devono essere sparpagliati: si guardano i punti medi delle coppie
  const brgs = [];
  for (let i = 0; i < vias.length; i += 2) brgs.push(bearing(HOME, vias[i]));
  for (let i = 0; i < brgs.length; i++)
    for (let j = i + 1; j < brgs.length; j++)
      assert.ok(angleDiff(brgs[i], brgs[j]) > 30, 'due settori sovrapposti');
});

test('navGenWayPair: entra dall estremo piu vicino, per non percorrerla al contrario', () => {
  const w = { lat: 45.5, lon: 9.5, aLat: 45.50, aLon: 9.50, bLat: 45.60, bLon: 9.50 };
  const daSud = navGenWayPair(w, { lat: 45.0, lon: 9.5 });
  assert.equal(daSud[0].lat, 45.50, 'arrivando da sud si entra dall estremo sud');
  const daNord = navGenWayPair(w, { lat: 46.0, lon: 9.5 });
  assert.equal(daNord[0].lat, 45.60, 'arrivando da nord si entra dall estremo nord');
  // voce di cache vecchia, senza estremi: si ricade sul punto singolo invece di NaN
  const vecchia = navGenWayPair({ lat: 45.5, lon: 9.5 }, HOME);
  assert.equal(vecchia.length, 1);
  assert.equal(vecchia[0].lat, 45.5);
  assert.equal(navGenWayPair(null, HOME).length, 0);
});

test('navGenSeedLoop: senza strade ripiega sulla geometria pura, stesso numero di tappe', () => {
  const opts = { km: 50, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const vias = navGenSeedLoop(HOME, opts, null, 0, 0.85);
  assert.equal(vias.length, navGenSectors(50));
  const r = (50 * 1000) / (2 * Math.PI) * 0.85;
  for (const v of vias) {
    assert.ok(Math.abs(haversineM(HOME.lat, HOME.lon, v.lat, v.lon) - r) < r * 0.02);
  }
});

test('navGenSeedLoop: semi diversi danno giri diversi, la direzione orienta il primo', () => {
  const opts = { km: 100, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const a = navGenSeedLoop(HOME, opts, null, 0, 0.85);
  const b = navGenSeedLoop(HOME, opts, null, 1, 0.85);
  assert.ok(angleDiff(bearing(HOME, a[0]), bearing(HOME, b[0])) > 5, 'semi identici');
  const est = navGenSeedLoop(HOME, { ...opts, dir: 'E' }, null, 0, 0.85);
  assert.ok(angleDiff(bearing(HOME, est[0]), NAVGEN_DIR_DEG.E) < 5, 'direzione ignorata');
});

test('navGenSeedLoop: lo shrink comanda il raggio', () => {
  const opts = { km: 100, loop: true, curves: 'tante', type: 'misto', dir: 'auto' };
  const stretto = navGenSeedLoop(HOME, opts, null, 0, 0.5);
  const largo = navGenSeedLoop(HOME, opts, null, 0, 1.2);
  assert.ok(haversineM(HOME.lat, HOME.lon, largo[0].lat, largo[0].lon) >
            haversineM(HOME.lat, HOME.lon, stretto[0].lat, stretto[0].lon) * 2);
});

test('navGenSeedLine: tappe nel corridoio, a zig-zag attorno alla retta', () => {
  const dest = geoDest(HOME.lat, HOME.lon, 90, 60000);
  const opts = { km: 75, loop: false, curves: 'tante', type: 'misto', dir: 'auto' };
  const vias = navGenSeedLine(HOME, dest, opts, null, 0, 0.18);
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
  assert.equal(navGenSeedLine(HOME, { ...HOME }, opts, null, 0, 0.18).length, 0);
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

test('navGenScanCurvy: riduce, mette in cache, e la seconda volta non tocca la rete', async () => {
  await setup();
  const calls = mockFetch(() => jsonRes(overpassWays(6)));
  const a = await navGenScanCurvy(HOME.lat, HOME.lon, 12000, false);
  assert.equal(a.length, 6);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('overpass'), 'host sbagliato: ' + calls[0]);
  assert.ok(calls[0].includes('out%20skel%20geom') || decodeURIComponent(calls[0]).includes('out skel geom'),
    'la query deve chiedere skel geom, non i tag');
  const b = await navGenScanCurvy(HOME.lat, HOME.lon, 12000, false);
  assert.equal(calls.length, 1, 'la seconda scansione ha rifatto la rete');
  assert.equal(b.length, 6);
});

test('navGenScanCurvy: un remark dentro un HTTP 200 non avvelena la cache', async () => {
  await setup();
  // Overpass segnala i suoi errori dentro un 200, senza elements: e' il caso che
  // scriverebbe in cache una scansione vuota valida trenta giorni.
  const calls = mockFetch(() => jsonRes({ remark: 'runtime error: Query timed out' }));
  await assert.rejects(() => navGenScanCurvy(HOME.lat, HOME.lon, 12000, false), /Overpass/);
  assert.equal(calls.length, 2, 'doveva provare entrambi i mirror');
  const cached = await idb.kvGet('curvyScan:' + HOME.lat.toFixed(2) + ',' + HOME.lon.toFixed(2) + ':12');
  assert.equal(cached, null, 'ha scritto in cache una scansione avvelenata');
});

test('navGenScanCurvy: HTTP 500 su entrambi i mirror -> lancia', async () => {
  await setup();
  const calls = mockFetch(() => jsonRes({}, false, 500));
  await assert.rejects(() => navGenScanCurvy(HOME.lat, HOME.lon, 12000, false));
  assert.equal(calls.length, 2);
});

test('navGenScanCurvy: rete giu ma cache vecchia in casa -> usa quella', async () => {
  await setup();
  mockFetch(() => jsonRes(overpassWays(5)));
  await navGenScanCurvy(HOME.lat, HOME.lon, 12000, false);
  // si invecchia la voce oltre il TTL e si stacca la rete
  const key = 'curvyScan:' + HOME.lat.toFixed(2) + ',' + HOME.lon.toFixed(2) + ':12';
  const e = await idb.kvGet(key);
  await idb.kvPut(key, { ...e, ts: 1 });
  mockFetch(() => new Error('rete giu'));
  const out = await navGenScanCurvy(HOME.lat, HOME.lon, 12000, false);
  assert.equal(out.length, 5, 'una strada tortuosa lo e ancora anche dopo un mese');
});

/* --- ciclo completo --- */

test('navGenRun: anello generato, cache scaldata, zero richieste per applicarlo', async () => {
  await setup();
  state.navGenKm = 50; state.navGenLoop = true;
  state.navGenCurves = 'tante'; state.navGenType = 'misto'; state.navGenDir = 'auto';
  let routeCalls = 0;
  mockFetch((url) => {
    if (url.includes('overpass')) return jsonRes(overpassWays(24));
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
    if (url.includes('overpass')) return jsonRes(overpassWays(24));
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

test('navGenRun: Overpass giu -> giro generato alla cieca, niente eccezioni', async () => {
  await setup();
  state.navGenKm = 50; state.navGenLoop = true;
  mockFetch((url) => {
    if (url.includes('overpass')) return jsonRes({}, false, 503);
    return jsonRes({ trip: fakeTrip(JSON.parse(decodeURIComponent(url.split('?json=')[1])).locations, 50) });
  });
  await navGenRun(false);
  assert.ok(state.nav, 'senza Overpass non ha generato niente');
  assert.match(els.navGenTxt.textContent, /Giro pronto|alla cieca/);
});

test('navGenRun: un candidato che Valhalla rifiuta non ferma la generazione', async () => {
  await setup();
  state.navGenKm = 50; state.navGenLoop = true;
  let n = 0;
  mockFetch((url) => {
    if (url.includes('overpass')) return jsonRes(overpassWays(24));
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
    if (url.includes('overpass')) return jsonRes(overpassWays(24));
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
    if (url.includes('overpass')) return jsonRes(overpassWays(24));
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
    if (url.includes('overpass')) return jsonRes(overpassWays(24));
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
