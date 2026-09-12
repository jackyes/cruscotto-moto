'use strict';
/* js/nav-gen.js (step 21): generatore di giri. Semina delle tappe, iterazione sui
   candidati Valhalla, misura della geometria che torna, applicazione del migliore.
   Usa state/idb/navGate/fetchWithTimeout/curvy a runtime.
   Ordine: dopo js/nav-net.js (serve navCostingOptions, navHeadForReq, routeCacheKey). */

const NAVGEN_SEEDS = 4;          // semi diversi provati per generazione
const NAVGEN_ITER_MAX = 5;       // raffinamenti della distanza per seme
const NAVGEN_REQ_MAX = 22;       // tetto DURO di richieste di rotta per generazione
const NAVGEN_DIST_TOL = 0.12;    // entro il 12% dai km chiesti = smetti di raffinare
const NAVGEN_LOOP_SHRINK0 = 0.85; // le strade vere sono più lunghe del poligono geometrico
const NAVGEN_LINE_BULGE0 = 0.18;  // scarto laterale iniziale delle tappe, in frazione della retta
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

/* ---- semina delle tappe ---- */

/* Numero di tappe. Poche su un giro corto (ogni tappa è un vincolo che irrigidisce
   il percorso), di più su uno lungo (senza, Valhalla ricade sulle arterie). */
function navGenSectors(km) { return km < 60 ? 3 : (km <= 150 ? 4 : 5); }

/* Semina ad anello: K tappe su settori uguali attorno alla partenza. Il raggio
   nominale viene dalla circonferenza (km = 2πr), ridotto perché la strada vera fra
   due tappe è sempre più lunga della corda. `seedIdx` ruota tutto: è ciò che rende
   diversi i quattro tentativi, e il tasto "↻ Un altro".

   Le tappe sono punti geometrici e basta: le aggancia alla strada più vicina
   Valhalla. Una versione precedente le sceglieva invece fra le strade più tortuose
   della zona, scaricate da Overpass — misurato su due A/B controllati, non
   cambiava niente (Lecco, montagna: 592 gradi/km senza contro 504 con; pianura
   padana: 166 contro 151), perché fra una tappa e l'altra le strade le sceglie
   comunque Valhalla e sei punti vincolati su cinquanta chilometri non decidono la
   curvosità del giro. A decidere è la MISURA dei candidati, più in basso. */
function navGenSeedLoop(from, opts, seedIdx, shrink) {
  const K = navGenSectors(opts.km);
  const r = (opts.km * 1000) / (2 * Math.PI) * shrink;
  const base = (opts.dir === 'auto' ? 0 : (NAVGEN_DIR_DEG[opts.dir] || 0)) + seedIdx * 37;
  const sector = 360 / K;
  const vias = [];
  for (let k = 0; k < K; k++) {
    const b = ((base + k * sector) % 360 + 360) % 360;
    vias.push(geoDest(from.lat, from.lon, b, r));
  }
  return vias;
}

/* Semina in linea: tappe dentro un corridoio attorno alla retta partenza→arrivo,
   scostate a zig-zag. Qui il raggio non è il manettino — gli estremi sono fissi —
   e a decidere la lunghezza è lo scarto laterale (`bulge`). */
function navGenSeedLine(from, dest, opts, seedIdx, bulge) {
  const total = haversineM(from.lat, from.lon, dest.lat, dest.lon);
  const axis = bearing(from, dest);
  if (axis == null || !(total > 0)) return [];
  /* Una tappa in meno che sull'anello, non due: la densità di tappe è ciò che
     decide quanto controllo si ha sul percorso, e con K−2 la sola andata ne aveva
     una ogni 25 km contro una ogni 17 km dell'anello — abbastanza rada da lasciare
     Valhalla libero di tornare sulle arterie fra un punto e l'altro. */
  const K = Math.max(1, navGenSectors(opts.km) - 1);
  const vias = [];
  for (let k = 0; k < K; k++) {
    const f = (k + 1) / (K + 1);
    const onAxis = geoDest(from.lat, from.lon, axis, total * f);
    // lato alternato, e seedIdx decide da che parte si comincia: due giri con la
    // stessa forma ma specchiati sono due giri diversi.
    const side = ((k + seedIdx) % 2 === 0) ? 90 : -90;
    vias.push(geoDest(onAxis.lat, onAxis.lon, axis + side, total * bulge));
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
  return 0.45 * distFit + 0.55 * curveScore(m.stats, opts.curves, opts.type);
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

    const cands = [];
    for (let seed = 0; seed < NAVGEN_SEEDS; seed++) {
      if (navGenAbort || navGenReqs >= NAVGEN_REQ_MAX) break;
      let knob = opts.loop ? NAVGEN_LOOP_SHRINK0 : NAVGEN_LINE_BULGE0;
      for (let it = 0; it < NAVGEN_ITER_MAX; it++) {
        if (navGenAbort || navGenReqs >= NAVGEN_REQ_MAX) break;
        navGenStatus('Cerco un giro… tentativo ' + (seed + 1) + '/' + NAVGEN_SEEDS +
                     ' · ' + navGenReqs + '/' + NAVGEN_REQ_MAX + ' richieste');
        const vias = opts.loop
          ? navGenSeedLoop(from, opts, seed, knob)
          : navGenSeedLine(from, dest, opts, seed, knob);
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
      navGenStatus('Nessun giro trovato: il motore di routing non ha risposto.');
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
