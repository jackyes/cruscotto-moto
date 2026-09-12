'use strict';
/* js/nav-gen.js (step 21): generatore di giri. Scansione Overpass delle strade
   tortuose, semina delle tappe, iterazione sui candidati Valhalla, applicazione.
   Usa state/idb/navGate/fetchWithTimeout/curvy a runtime.
   Ordine: dopo js/nav-net.js (serve navCostingOptions, navHeadForReq, routeCacheKey). */

const NAVGEN_SEEDS = 4;          // semi diversi provati per generazione
const NAVGEN_ITER_MAX = 5;       // raffinamenti della distanza per seme
const NAVGEN_REQ_MAX = 22;       // tetto DURO di richieste di rotta per generazione
const NAVGEN_DIST_TOL = 0.12;    // entro il 12% dai km chiesti = smetti di raffinare
const NAVGEN_LOOP_SHRINK0 = 0.85; // le strade vere sono più lunghe del poligono geometrico
const NAVGEN_LINE_BULGE0 = 0.18;  // scarto laterale iniziale delle tappe, in frazione della retta
const NAVGEN_WAY_MIN_M = 150;    // way più corte sono frammenti, non strade
const NAVGEN_WAY_MIN_DPK = 60;   // sotto questi gradi/km è un rettilineo
const NAVGEN_WAY_KEEP = 600;     // quante way tenere in cache dopo la scansione
const NAVGEN_SCAN_TTL_MS = 30 * 24 * 3600 * 1000;  // le strade non si muovono
const NAVGEN_SCAN_KEEP = 8;      // scansioni tenute in cache: sono grosse
const NAVGEN_VALHALLA_TIMEOUT_MS = 12000;  // più lungo di una rotta normale: qui ci sono 5 tappe

const NAVGEN_DIR_DEG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SO: 225, O: 270, NO: 315 };

/* Stato vivo della generazione. Fuori da `state` perché non è né persistito né
   letto da altri moduli: è la memoria di un'operazione che dura trenta secondi. */
let navGenBusy = false, navGenAbort = false, navGenReqs = 0;
let navGenPool = [], navGenPoolKey = '';

function navGenStatus(txt) {
  if (els.navGenTxt) els.navGenTxt.textContent = txt;
}

/* Firma delle opzioni: decide se i candidati già in cassa ("↻ Un altro") valgono
   ancora. Cambiare km, forma, curve, tipo o direzione — o spostarsi di un
   chilometro — li invalida tutti. */
function navGenKey(from, o) {
  return [o.km, o.loop ? 'L' : 'A', o.curves, o.type, o.dir,
          from.lat.toFixed(2), from.lon.toFixed(2)].join('|');
}

function navGenOpts() {
  return {
    km: state.navGenKm, loop: !!state.navGenLoop, curves: state.navGenCurves,
    type: state.navGenType, dir: state.navGenDir,
  };
}

/* Stessa risoluzione della partenza usata da navStart e navSetDest: la posizione
   grezza se c'è, altrimenti quella lisciata. Deve coincidere, o la chiave di cache
   scaldata a fine generazione non combacerebbe con quella che navRequestRoute
   calcola un istante dopo. */
function navGenOrigin() {
  return state.pos.lat != null ? { lat: state.pos.lat, lon: state.pos.lon }
       : (state.gps.lat != null ? { lat: state.gps.lat, lon: state.gps.lon } : null);
}

/* ---- scansione Overpass delle strade tortuose ---- */

/* La risposta grezza di Overpass è grossa: su 20 km di raggio attorno a Lecco sono
   3,9 MB di JSON per 4691 way. Non finisce mai in cache così com'è — si riduce
   SUBITO a un punto di aggancio più le statistiche di curvosità, e si butta la
   geometria. La cache risultante è di qualche decina di KB, sopravvive 30 giorni, e
   soprattutto non tiene megabyte di coordinate vive nella memoria di un telefono.
   Le statistiche e non il punteggio: il punteggio dipende da curve/tipo, che
   l'utente cambia senza dover riscaricare niente. */
function navGenReduceWays(elements) {
  const out = [];
  for (const el of elements || []) {
    const g = el && el.geometry;
    if (!g || g.length < 3) continue;
    const n = g.length;
    const lat = new Float64Array(n), lon = new Float64Array(n);
    for (let i = 0; i < n; i++) { lat[i] = g[i].lat; lon[i] = g[i].lon; }
    const st = curveStats(lat, lon, n);
    if (st.lenM < NAVGEN_WAY_MIN_M || st.degPerKm < NAVGEN_WAY_MIN_DPK) continue;
    /* DUE punti di aggancio, non uno: uno vicino all'inizio e uno vicino alla fine
       della way. Con un punto solo Valhalla è libero di sfiorare la strada curva e
       ripartire subito per la via più veloce — misurato, seminare un punto per way
       dava un giro MENO tortuoso della semina geometrica cieca. Con una coppia la
       strada va percorsa, perché entrambi gli estremi sono vincoli.
       A frazione di LUNGHEZZA e non di indice: i nodi OSM sono irregolari e il nodo
       di mezzo può cadere a un quinto della strada. Il punto medio resta come
       riferimento per il settore e la corona. */
    const mid = pathPointAt(lat, lon, n, 0.5);
    const a = pathPointAt(lat, lon, n, 0.15), b = pathPointAt(lat, lon, n, 0.85);
    out.push({ lat: mid.lat, lon: mid.lon, aLat: a.lat, aLon: a.lon, bLat: b.lat, bLon: b.lon,
               lenM: st.lenM, degPerKm: st.degPerKm,
               medRadius: isFinite(st.medRadius) ? st.medRadius : 0,
               q1: isFinite(st.q1) ? st.q1 : 0, q3: isFinite(st.q3) ? st.q3 : 0,
               tightFrac: st.tightFrac });
  }
  /* Quando sono troppe si campiona a passo costante sull'elenco ORDINATO, non si
     taglia la coda. La differenza conta: questa cache serve tutte le impostazioni
     di curve (la chiave non le include, così cambiare "tante" in "poche" non
     riscarica niente), e tenere solo le N più tortuose svuotava il pozzo per chi
     chiedeva poche curve — misurato, "poche" restituiva 406 gradi/km perché non
     c'era rimasta una sola strada tranquilla fra cui scegliere. Il campionamento a
     passo tiene la testa, il centro e la coda della distribuzione entro lo stesso
     tetto di memoria. */
  out.sort((a, b) => b.degPerKm - a.degPerKm);
  if (out.length <= NAVGEN_WAY_KEEP) return out;
  const stride = out.length / NAVGEN_WAY_KEEP;
  const keep = [];
  for (let i = 0; keep.length < NAVGEN_WAY_KEEP && Math.floor(i * stride) < out.length; i++) {
    keep.push(out[Math.floor(i * stride)]);
  }
  return keep;
}

/* Prune della cache delle scansioni: sono le voci più grandi che l'app scrive su
   IndexedDB, e senza tetto un'estate di giri in posti diversi le accumula tutte.
   Stessa forma di geoCachePrune (js/nav-net.js), tetto molto più basso. */
async function navGenScanPrune() {
  try {
    const keys = await idb.kvKeys();
    const mine = (keys || []).filter(k => String(k).indexOf('curvyScan:') === 0);
    if (mine.length <= NAVGEN_SCAN_KEEP) return;
    const entries = [];
    for (const k of mine) { const e = await idb.kvGet(k); if (e) entries.push([k, e.ts || 0]); }
    entries.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < entries.length - NAVGEN_SCAN_KEEP; i++) {
      try { await idb.kvDel(entries[i][0]); } catch (err) {}
    }
  } catch (err) {}
}

async function navGenScanCurvy(lat, lon, radiusM, withUnclassified) {
  const rKm = Math.round(radiusM / 1000);
  const key = 'curvyScan:' + lat.toFixed(2) + ',' + lon.toFixed(2) + ':' + rKm + (withUnclassified ? ':u' : '');
  const cached = await cacheGetFresh(key, NAVGEN_SCAN_TTL_MS);
  if (cached && !cached.stale && cached.body) return cached.body;
  /* `out skel geom`: solo id e coordinate, niente tag. Il filtro sul tipo di strada
     è già nella query, e i tag raddoppierebbero il peso per niente.
     Niente motorway/trunk/primary: non è lì che si va a curvare. `unclassified`
     entra solo sui raggi piccoli — sono le più tortuose ma anche le più strette e
     sporche, e su 25 km di raggio raddoppiano il download. */
  const cls = withUnclassified ? 'secondary|tertiary|unclassified' : 'secondary|tertiary';
  const tmo = Math.round(45 + rKm);
  const q = '[out:json][timeout:' + tmo + '];way["highway"~"^(' + cls + ')$"]' +
            '["access"!~"^(private|no)$"](around:' + Math.round(radiusM) + ',' +
            lat.toFixed(5) + ',' + lon.toFixed(5) + ');out skel geom;';
  const qs = '?data=' + encodeURIComponent(q);
  let lastErr = null;
  for (const host of CAM_HOSTS) {
    if (navGenAbort) return null;
    try {
      const res = await fetchWithTimeout(host + qs, (tmo + 15) * 1000);
      /* Il timer di abort di fetchWithTimeout resta vivo finché qualcuno non legge
         il body: uscendo di qui su un HTTP non-2xx senza spegnerlo si lascia armato
         un AbortController per un minuto abbondante, per ogni mirror che rifiuta.
         jsonUnderTimeout lo fa da sé sul ramo buono; su questo va fatto a mano. */
      if (!res.ok) { clearResTmo(res); lastErr = new Error('HTTP ' + res.status); continue; }
      const data = await jsonUnderTimeout(res);
      /* Overpass segnala i propri errori di runtime DENTRO un HTTP 200, con un
         campo `remark` e senza `elements` (stesso caso trattato in js/cams.js).
         Senza questo check si scriverebbe in cache una scansione vuota, valida per
         trenta giorni: tutti i giri della zona generati alla cieca fino alla
         scadenza, senza un motivo visibile. */
      if (!Array.isArray(data.elements) || data.remark) {
        lastErr = new Error('Overpass: ' + ((data.remark && String(data.remark).slice(0, 80)) || 'risposta senza elements'));
        continue;
      }
      const ways = navGenReduceWays(data.elements);
      await cachePut(key, ways, NAVGEN_SCAN_TTL_MS);
      navGenScanPrune();
      return ways;
    } catch (e) { lastErr = e; }
  }
  // Scansione vecchia meglio di niente: una strada tortuosa lo è ancora.
  if (cached && cached.body) return cached.body;
  throw lastErr || new Error('Overpass non raggiungibile');
}

/* ---- semina delle tappe ---- */

/* Way ordinate per aderenza a ciò che l'utente ha chiesto, con distanza e rilevamento
   dalla partenza già calcolati: la scelta per settore diventa una scansione lineare
   su una lista già ordinata, e viene rifatta a ogni raffinamento. */
function navGenRankWays(ways, from, opts) {
  const out = [];
  for (const w of ways || []) {
    const d = haversineM(from.lat, from.lon, w.lat, w.lon);
    const b = bearing(from, w);
    if (b == null) continue;
    out.push({ lat: w.lat, lon: w.lon, d: d, b: b,
               aLat: w.aLat, aLon: w.aLon, bLat: w.bLat, bLon: w.bLon,
               score: curveScore(w, opts.curves, opts.type, 'way') });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* Numero di tappe. Poche su un giro corto (ogni tappa è un vincolo che irrigidisce
   il percorso), di più su uno lungo (senza, Valhalla ricade sulle arterie). */
function navGenSectors(km) { return km < 60 ? 3 : (km <= 150 ? 4 : 5); }

/* La way migliore dentro un settore angolare e una corona circolare. Fuori da quelle
   due finestre il seme non serve: troppo vicino e il giro si accartoccia, troppo
   lontano e sfonda i km chiesti. Null se il settore è vuoto — mare, montagna, o una
   zona che Overpass non ha coperto: il chiamante ripiega sul punto geometrico. */
function navGenPickWay(ranked, brgDeg, sectorDeg, rMin, rMax, used) {
  for (const w of ranked) {
    if (w.d < rMin || w.d > rMax) continue;
    if (angleDiff(w.b, brgDeg) > sectorDeg / 2) continue;
    const k = w.lat.toFixed(4) + ',' + w.lon.toFixed(4);
    if (used[k]) continue;          // due tappe sullo stesso tornante = un giro che si morde
    used[k] = true;
    return w;
  }
  return null;
}

/* Espande una way scelta nella COPPIA di tappe che la fa percorrere per intero,
   entrando dall'estremo più vicino a dove si arriva. L'ordine conta: invertito,
   Valhalla percorre la strada, torna indietro e riparte — tre volte la lunghezza e
   un'inversione a U in mezzo. Se la way non porta con sé gli estremi (voce di cache
   vecchia, scritta prima che esistessero) si ricade sul punto singolo. */
function navGenWayPair(w, prev) {
  if (!w) return [];
  if (!isFinite(w.aLat) || !isFinite(w.bLat)) return [{ lat: w.lat, lon: w.lon }];
  const a = { lat: w.aLat, lon: w.aLon }, b = { lat: w.bLat, lon: w.bLon };
  if (!prev) return [a, b];
  return haversineM(prev.lat, prev.lon, a.lat, a.lon) <= haversineM(prev.lat, prev.lon, b.lat, b.lon)
    ? [a, b] : [b, a];
}

/* Semina ad anello: K tappe su settori uguali attorno alla partenza. Il raggio
   nominale viene dalla circonferenza (km = 2πr), ridotto perché la strada vera fra
   due tappe è sempre più lunga della corda. `seedIdx` ruota tutto: è ciò che rende
   diversi i quattro tentativi, e il tasto "↻ Un altro". */
function navGenSeedLoop(from, opts, ranked, seedIdx, shrink) {
  const K = navGenSectors(opts.km);
  const r = (opts.km * 1000) / (2 * Math.PI) * shrink;
  const base = (opts.dir === 'auto' ? 0 : (NAVGEN_DIR_DEG[opts.dir] || 0)) + seedIdx * 37;
  const sector = 360 / K;
  const used = {};
  const vias = [];
  let prev = from;
  for (let k = 0; k < K; k++) {
    const b = ((base + k * sector) % 360 + 360) % 360;
    const w = ranked && ranked.length
      ? navGenPickWay(ranked, b, sector * 0.9, r * 0.6, r * 1.35, used) : null;
    const add = w ? navGenWayPair(w, prev) : [geoDest(from.lat, from.lon, b, r)];
    for (const p of add) vias.push(p);
    prev = vias[vias.length - 1];
  }
  return vias;
}

/* Semina in linea: tappe dentro un corridoio attorno alla retta partenza→arrivo,
   scostate a zig-zag. Qui il raggio non è il manettino — gli estremi sono fissi —
   e a decidere la lunghezza è lo scarto laterale (`bulge`). */
function navGenSeedLine(from, dest, opts, ranked, seedIdx, bulge) {
  const total = haversineM(from.lat, from.lon, dest.lat, dest.lon);
  const axis = bearing(from, dest);
  if (axis == null || !(total > 0)) return [];
  /* Una tappa in meno che sull'anello, non due: la densità di tappe è ciò che
     decide quanto controllo si ha sul percorso, e con K−2 la sola andata ne aveva
     una ogni 25 km contro una ogni 17 km dell'anello — abbastanza rada da lasciare
     Valhalla libero di tornare sulle arterie fra un punto e l'altro (misurato: 197
     gradi/km contro i 592 di un anello con gli stessi parametri). */
  const K = Math.max(1, navGenSectors(opts.km) - 1);
  const used = {};
  const vias = [];
  for (let k = 0; k < K; k++) {
    const f = (k + 1) / (K + 1);
    const onAxis = geoDest(from.lat, from.lon, axis, total * f);
    // lato alternato, e seedIdx decide da che parte si comincia: due giri con la
    // stessa forma ma specchiati sono due giri diversi.
    const side = ((k + seedIdx) % 2 === 0) ? 90 : -90;
    const off = total * bulge;
    const geom = geoDest(onAxis.lat, onAxis.lon, axis + side, off);
    const b = bearing(from, geom);
    const d = haversineM(from.lat, from.lon, geom.lat, geom.lon);
    const w = (ranked && ranked.length && b != null)
      ? navGenPickWay(ranked, b, 50, d * 0.7, d * 1.3, used) : null;
    const prev = vias.length ? vias[vias.length - 1] : from;
    const add = w ? navGenWayPair(w, prev) : [geom];
    for (const p of add) vias.push(p);
  }
  return vias;
}

/* ---- richiesta di un candidato ---- */

/* Solo Valhalla, e senza il retry senza heading del percorso normale: i candidati
   sono usa-e-getta e non vale la pena spendere quota per salvarne uno. Niente
   fallback OSRM soprattutto: OSRM ha il profilo auto fisso, quindi misurare un
   candidato su OSRM e poi navigarlo con Valhalla significa scegliere il giro in
   base a una geometria che non è quella che si percorrerà. Meglio un candidato in
   meno che un candidato che mente. */
async function navGenFetchTrip(locations) {
  const req = {
    locations: locations.map(p => ({ lat: p.lat, lon: p.lon })),
    costing: 'motorcycle',
    costing_options: navCostingOptions(),
    directions_options: { language: 'it-IT', units: 'kilometers' },
  };
  navGenReqs++;
  const url = NAV_HOSTS[0] + '?json=' + encodeURIComponent(JSON.stringify(req));
  const res = await navGate(() => fetchWithTimeout(url, NAVGEN_VALHALLA_TIMEOUT_MS));
  const j = await jsonUnderTimeout(res);
  if (j && j.error) throw new Error('Valhalla ' + (j.error_code || '') + ': ' + j.error);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (!j || !j.trip || j.trip.status !== 0) throw new Error('risposta non valida');
  return j.trip;
}

/* Misura del candidato: km dal sommario, curve dalla geometria vera di tutte le leg
   concatenate — la stessa che si guiderà, non quella seminata. */
function navGenMeasure(trip) {
  const lats = [], lons = [];
  for (const leg of (trip.legs || [])) {
    // decodePolyline6 ritorna {lat, lon}: la lunghezza sta negli array, non in un `n`.
    const d = decodePolyline6(leg.shape || '');
    for (let i = 0; i < d.lat.length; i++) { lats.push(d.lat[i]); lons.push(d.lon[i]); }
  }
  const st = curveStats(lats, lons, lats.length);
  // summary.length è in km (units: kilometers nella richiesta)
  const km = (trip.summary && isFinite(trip.summary.length)) ? trip.summary.length : st.lenM / 1000;
  return { km: km, stats: st };
}

/* Punteggio finale del candidato: quanto azzecca i km chiesti, e quanto azzecca le
   curve chieste. I km pesano di più perché sono l'unica cosa che l'utente ha
   davvero quantificato — "tante curve" è un desiderio, "100 km" è un vincolo (il
   serbatoio, le ore di luce, l'ora di cena). */
function navGenScore(m, opts) {
  const distFit = curveFit(m.km, opts.km, 0.22);
  return 0.45 * distFit + 0.55 * curveScore(m.stats, opts.curves, opts.type, 'route');
}

/* ---- ciclo principale ---- */

function navGenCancel() {
  if (!navGenBusy) return;
  navGenAbort = true;
  navGenStatus('Generazione annullata.');
}

function navGenSetBusy(on) {
  navGenBusy = on;
  if (els.btnNavGen) els.btnNavGen.disabled = on;
  if (els.btnNavGenAgain) els.btnNavGenAgain.disabled = on;
  if (els.btnNavGenStop) els.btnNavGenStop.disabled = !on;
}

/* Consuntivo onesto. Chi ha chiesto cento chilometri di tornanti e ne ha ottenuti
   settanta di curvoni deve leggerlo, non scoprirlo in sella. */
function navGenReport(best, opts) {
  const s = best.m.stats;
  const r = isFinite(s.medRadius) ? Math.round(s.medRadius) + ' m' : 'larghe';
  return 'Giro pronto: ' + best.m.km.toFixed(0) + ' km · ' + Math.round(s.degPerKm) +
    '°/km · curve ~' + r + (s.tightFrac > 0.05 ? ' (' + Math.round(s.tightFrac * 100) + '% tornanti)' : '') +
    '. Chiesti ' + opts.km + ' km, curve ' + opts.curves + ', ' + opts.type + '.';
}

async function navGenApply(best, from, opts) {
  const vias = best.vias.map(v => ({ lat: v.lat, lon: v.lon, label: '' }));
  /* Si scalda la cache invece di applicare il trip a mano. navSetDest →
     navRequestRouteSafe trova la voce fresca e monta la rotta passando per lo
     stesso codice collaudato di qualunque altro percorso (persistenza, disegno,
     inquadratura, banner, voce): niente secondo ramo di applicazione da tenere
     allineato, e nessuna richiesta di rete in più.
     La chiave deve combaciare esattamente con quella che navRequestRoute calcolerà
     un istante dopo — stessa origine, stesse opzioni di costo, stesso heading
     (navHeadForReq è l'unica definizione di "l'heading conta o no"). Se nel
     frattempo arriva un fix GPS che sposta l'origine oltre gli 11 m della chiave, si
     perde il colpo di cache e si spende una richiesta: il giro è comunque quello. */
  const hdg = navHeadForReq(trackUpHeading());
  const key = routeCacheKey(from, best.dest, navCostingOptions(), hdg, vias);
  await cachePut(key, { trip: best.trip, engine: 'Valhalla' }, ROUTE_CACHE_TTL_MS);
  state.navVias = vias;
  await navSetDest({
    lat: best.dest.lat, lon: best.dest.lon,
    label: opts.loop ? ('Anello ' + opts.km + ' km') : (best.destLabel || 'Giro ' + opts.km + ' km'),
  });
  navGenStatus(navGenReport(best, opts));
}

/* "↻ Un altro": i candidati scartati del giro precedente sono già pagati. Se ce n'è
   ancora uno decente in cassa lo si mostra senza toccare la rete. */
async function navGenPoolTake(from, opts) {
  if (navGenPoolKey !== navGenKey(from, opts) || !navGenPool.length) return false;
  const best = navGenPool.shift();
  navGenStatus('Un altro giro, dai candidati già calcolati.');
  await navGenApply(best, from, opts);
  return true;
}

async function navGenRun(again) {
  if (navGenBusy) return;
  const from = navGenOrigin();
  if (!from) { toast('Nessun fix GPS: non so da dove far partire il giro.', 'err'); return; }
  const opts = navGenOpts();
  navGenAbort = false; navGenReqs = 0;
  /* Il flag di occupato si alza PRIMA di pescare dalla cassa, non dopo: applicare un
     candidato e' asincrono (scrittura in cache + navSetDest), e nella finestra fra
     l'inizio e la fine un secondo tocco su "↻ Un altro" entrava di nuovo qui e
     applicava due giri uno sopra l'altro. */
  navGenSetBusy(true);
  const targetM = opts.km * 1000;
  try {
    if (again && await navGenPoolTake(from, opts)) return;
    // Arrivo: la destinazione impostata se c'è (sola andata), altrimenti la partenza
    // (anello) o un punto inventato alla distanza giusta.
    let dest, destLabel = '';
    if (opts.loop) {
      dest = { lat: from.lat, lon: from.lon };
    } else if (state.navDest) {
      dest = { lat: state.navDest.lat, lon: state.navDest.lon };
      destLabel = state.navDest.label || '';
    } else {
      const b = opts.dir === 'auto' ? Math.floor(Math.random() * 360) : NAVGEN_DIR_DEG[opts.dir];
      /* Metà dei chilometri chiesti in linea d'aria, non tre quarti. Con 0,72 la
         meta inventata finiva così lontano che il percorso non era altro che un
         trasferimento diretto: niente margine per deviare sulle strade belle, e
         infatti usciva alla curvosità di base (misurato: 200 gradi/km contro i 592
         di un anello con gli stessi parametri). La metà lascia all'incirca il doppio
         della strada rispetto alla linea retta, cioè lo spazio in cui le curve
         chieste ci possono stare. Quando la meta la sceglie l'utente non si tocca:
         è un vincolo suo, e se è lontana quanto i chilometri chiesti il percorso
         sarà dritto — il consuntivo finale lo dice invece di far finta. */
      dest = geoDest(from.lat, from.lon, b, targetM * 0.5);
    }

    /* La scansione Overpass costa una ventina di secondi su una zona densa: messa in
       serie si mangerebbe da sola due terzi del budget. Parte QUI, senza await, e
       intanto il primo seme — quello geometrico, che non ha bisogno di strade —
       va già in rete. Quando tocca ai semi 2, 3 e 4 la scansione è arrivata. */
    const scanR = opts.loop
      ? Math.max(5000, Math.min(60000, targetM / (2 * Math.PI) * 1.5))
      : Math.max(5000, Math.min(60000, haversineM(from.lat, from.lon, dest.lat, dest.lon) * 0.7));
    let scanErr = null;
    const scanP = navGenScanCurvy(from.lat, from.lon, scanR, scanR <= 15000 || opts.curves === 'tante')
      .catch(e => { scanErr = e; return null; });

    const cands = [];
    for (let seed = 0; seed < NAVGEN_SEEDS; seed++) {
      if (navGenAbort || navGenReqs >= NAVGEN_REQ_MAX) break;
      // Seme 0 alla cieca di proposito: è quello che copre l'attesa di Overpass.
      const ranked = seed === 0 ? null
        : navGenRankWays(await scanP, from, opts);
      if (navGenAbort) break;
      if (seed === 1 && scanErr) {
        navGenStatus('Strade curve non disponibili (' + (scanErr.message || 'errore') +
                     '): giro generato alla cieca.');
      }
      let knob = opts.loop ? NAVGEN_LOOP_SHRINK0 : NAVGEN_LINE_BULGE0;
      for (let it = 0; it < NAVGEN_ITER_MAX; it++) {
        if (navGenAbort || navGenReqs >= NAVGEN_REQ_MAX) break;
        navGenStatus('Cerco un giro… tentativo ' + (seed + 1) + '/' + NAVGEN_SEEDS +
                     ' · ' + navGenReqs + '/' + NAVGEN_REQ_MAX + ' richieste' +
                     (ranked ? ' · ' + ranked.length + ' strade curve' : ''));
        const vias = opts.loop
          ? navGenSeedLoop(from, opts, ranked, seed, knob)
          : navGenSeedLine(from, dest, opts, ranked, seed, knob);
        let trip;
        try {
          trip = await navGenFetchTrip([from, ...vias, dest]);
        } catch (e) {
          /* Un candidato che non si calcola non ferma la generazione: una tappa può
             essere caduta in mezzo a un lago o dentro una ZTL. Si stringe il raggio
             e si riprova con l'iterazione successiva. */
          knob *= 0.85;
          continue;
        }
        if (navGenAbort) break;
        const m = navGenMeasure(trip);
        cands.push({ trip: trip, vias: vias, dest: dest, destLabel: destLabel, m: m,
                     score: navGenScore(m, opts) });
        const e = (m.km - opts.km) / opts.km;
        if (Math.abs(e) <= NAVGEN_DIST_TOL) break;   // centrato: il seme è finito
        // Correzione proporzionale: troppo lungo → stringi, troppo corto → allarga.
        // Il fattore 0,8 smorza, perché la lunghezza della strada non è lineare nel
        // raggio e una correzione piena oscilla invece di convergere.
        knob *= Math.max(0.5, Math.min(1.8, 1 - 0.8 * e));
      }
    }

    if (navGenAbort) { navGenStatus('Generazione annullata.'); return; }
    if (!cands.length) {
      navGenStatus('Nessun giro trovato: ' + (scanErr ? scanErr.message : 'il motore non ha risposto') + '.');
      toast('Non sono riuscito a generare un giro.', 'err', 6000);
      return;
    }
    cands.sort((a, b) => b.score - a.score);
    navGenPool = cands.slice(1);
    navGenPoolKey = navGenKey(from, opts);
    await navGenApply(cands[0], from, opts);
  } catch (e) {
    navGenStatus('Errore nella generazione: ' + ((e && e.message) || e));
    toast('Errore nella generazione del giro.', 'err', 6000);
  } finally {
    navGenSetBusy(false);
  }
}

/* Funzione di servizio per la calibrazione: stampa le statistiche di curvosità della
   rotta attualmente caricata. Serve per tarare CURVE_TARGETS su strade che si
   conoscono — importi il GPX di un giro che SAI essere tortuoso, leggi i numeri veri
   e aggiusti le costanti, invece di indovinare i pesi. */
function navGenStats() {
  const nv = state.nav;
  if (!nv || !nv.n) { console.log('nessuna rotta caricata'); return null; }
  const s = curveStats(nv.lat, nv.lon, nv.n);
  console.log('km', (nv.totalM / 1000).toFixed(1), '| gradi/km', s.degPerKm.toFixed(0),
    '| raggio mediano', s.medRadius.toFixed(0), '| q1', s.q1.toFixed(0), '| q3', s.q3.toFixed(0),
    '| tornanti', (s.tightFrac * 100).toFixed(0) + '%', '| in curva', (s.curvFrac * 100).toFixed(0) + '%');
  return s;
}
