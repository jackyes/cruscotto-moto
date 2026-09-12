'use strict';
/* js/curvy.js (step 3): geometria delle curve, pura — niente rete, niente DOM, niente
   state. geoDest, geoProject, resampleXY, curveStats, curveScore, CURVE_TARGETS.
   Serve al generatore di giri (js/nav-gen.js): misurare quanto curva una strada o
   un percorso, e quanto quella misura assomiglia a quella chiesta dall'utente.
   Ordine: dopo js/geo.js (usa EARTH_R, haversineM). */

/* Punto a distanza e rotta date, sulla sfera. Serve per seminare le tappe di un
   giro: un punto a 14 km a nord-est dalla partenza. Formula sferica e non
   equirettangolare perché qui le distanze sono decine di km, non i 500 m della
   deviazione simulata, e in longitudine l'errore del piano cresce col coseno. */
function geoDest(lat, lon, brgDeg, distM) {
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(brgDeg) || !isFinite(distM)) return null;
  const d = distM / EARTH_R, b = brgDeg * Math.PI / 180;
  const la1 = lat * Math.PI / 180, lo1 = lon * Math.PI / 180;
  const sinLa1 = Math.sin(la1), cosLa1 = Math.cos(la1);
  const sinD = Math.sin(d), cosD = Math.cos(d);
  const la2 = Math.asin(Math.min(1, Math.max(-1, sinLa1 * cosD + cosLa1 * sinD * Math.cos(b))));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * sinD * cosLa1, cosD - sinLa1 * Math.sin(la2));
  // wrap a [-180, 180]: un giro vicino all'antimeridiano non deve produrre lon 181
  return { lat: la2 * 180 / Math.PI, lon: ((lo2 * 180 / Math.PI + 540) % 360) - 180 };
}

/* Proiezione su un piano locale in METRI, equirettangolare attorno al baricentro.
   La curvatura è una proprietà locale: su un giro da 200 km l'errore di scala di
   questa proiezione resta sotto lo 0,1%, cioè invisibile su un raggio di curva, e
   in cambio tutto il ciclo caldo (migliaia di punti per candidato, decine di
   candidati) diventa aritmetica piana invece di trigonometria sferica. */
function geoProject(lat, lon, n) {
  const out = { x: new Float64Array(n), y: new Float64Array(n), n: n, lat0: 0, lon0: 0 };
  if (!n) return out;
  let sLat = 0, sLon = 0;
  for (let i = 0; i < n; i++) { sLat += lat[i]; sLon += lon[i]; }
  const lat0 = sLat / n, lon0 = sLon / n;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  out.lat0 = lat0; out.lon0 = lon0;
  for (let i = 0; i < n; i++) {
    out.x[i] = (lon[i] - lon0) * kx;
    out.y[i] = (lat[i] - lat0) * 111132;
  }
  return out;
}

const CURVE_STEP_M = 25;       // passo di ricampionamento
const CURVE_R_MAX = 500;       // sopra questo raggio non è una curva, è una piega
const CURVE_TIGHT_R = 60;      // sotto questo raggio è un tornante
const CURVE_MAX_PTS = 40000;   // tappo: 1000 km a passo 25 m, oltre è input malato

/* Ricampionamento a passo fisso, nel piano. I nodi OSM sono spaziati in modo
   irregolare: un incrocio, un ponte o un confine comunale mettono cinque nodi in
   venti metri anche su un rettilineo perfetto, e la somma dei |Δdirezione| grezzi
   conterebbe quel grappolo come curva. A passo costante il conto misura la strada
   invece della densità con cui è stata mappata — che è l'unica cosa che vogliamo
   sapere. È anche ciò che rende confrontabili percorsi che vengono da fonti
   diverse — una polilinea Valhalla e una traccia GPX hanno densità di nodi molto
   diverse, e senza ricampionare non sarebbero paragonabili. */
function resampleXY(x, y, n, stepM) {
  const step = stepM > 0 ? stepM : CURVE_STEP_M;
  if (!n || n < 2) return { x: new Float64Array(0), y: new Float64Array(0), n: 0, lenM: 0 };
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  const lenM = cum[n - 1];
  if (!(lenM > 0)) return { x: new Float64Array(0), y: new Float64Array(0), n: 0, lenM: 0 };
  const m = Math.min(CURVE_MAX_PTS, Math.floor(lenM / step) + 1);
  const ox = new Float64Array(m), oy = new Float64Array(m);
  // j avanza monotono: il campionamento è una scansione lineare, non una ricerca
  // per punto (su 8000 punti la differenza è fra O(n) e O(n²)).
  let j = 0;
  for (let k = 0; k < m; k++) {
    const s = k * step;
    while (j + 2 < n && cum[j + 1] < s) j++;
    const span = cum[j + 1] - cum[j];
    const t = span > 1e-9 ? (s - cum[j]) / span : 0;
    ox[k] = x[j] + t * (x[j + 1] - x[j]);
    oy[k] = y[j] + t * (y[j + 1] - y[j]);
  }
  return { x: ox, y: oy, n: m, lenM: lenM };
}

/* Statistiche di curvosità di una polilinea lat/lon.
     lenM      lunghezza reale (m)
     degPerKm  gradi di sterzata totali per km — il "quante curve"
     medRadius raggio mediano delle curve vere (< CURVE_R_MAX) — il "strette o veloci"
     q1/q3     primo e terzo quartile dei raggi: la loro distanza è la VARIETÀ,
               che è quello che chiede chi sceglie "misto"
     tightFrac frazione di metri percorsi dentro un tornante (< CURVE_TIGHT_R)
     curvFrac  frazione di metri passati in curva anziché in rettilineo

   Il raggio viene dalla curvatura di Menger sulle triple consecutive:
   R = abc / 4A, con A l'area del triangolo dal prodotto vettoriale. Tre punti
   allineati danno A ≈ 0 → raggio infinito, cioè rettilineo, che è esattamente il
   comportamento voluto (e il motivo del guard su `area`: senza, una retta
   produrrebbe Infinity/NaN a caso a seconda dell'arrotondamento). */
function curveStats(lat, lon, n) {
  const out = { lenM: 0, degPerKm: 0, medRadius: Infinity, q1: Infinity, q3: Infinity,
                tightFrac: 0, curvFrac: 0 };
  if (!lat || !lon || !n || n < 3) return out;
  const p = geoProject(lat, lon, n);
  const rs = resampleXY(p.x, p.y, p.n, CURVE_STEP_M);
  out.lenM = rs.lenM;
  if (rs.n < 3 || rs.lenM < CURVE_STEP_M * 2) return out;
  let deg = 0, tightM = 0;
  const radii = [];
  for (let i = 1; i + 1 < rs.n; i++) {
    const ax = rs.x[i] - rs.x[i - 1], ay = rs.y[i] - rs.y[i - 1];
    const bx = rs.x[i + 1] - rs.x[i], by = rs.y[i + 1] - rs.y[i];
    const cross = ax * by - ay * bx, dot = ax * bx + ay * by;
    // atan2 e non acos: l'angolo di sterzata è firmato e stabile anche sui
    // micro-segmenti, dove acos(dot/|a||b|) perde cifre vicino a ±1.
    deg += Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
    const area = Math.abs(cross) / 2;
    if (area > 1e-6) {
      const a = Math.hypot(ax, ay), b = Math.hypot(bx, by);
      const c = Math.hypot(rs.x[i + 1] - rs.x[i - 1], rs.y[i + 1] - rs.y[i - 1]);
      const R = (a * b * c) / (4 * area);
      if (R < CURVE_R_MAX) {
        radii.push(R);
        if (R < CURVE_TIGHT_R) tightM += CURVE_STEP_M;
      }
    }
  }
  /* Denominatore: la lunghezza EFFETTIVAMENTE misurata, non quella totale. Un
     angolo di sterzata ha bisogno di un punto prima e di uno dopo, quindi il primo
     e l'ultimo campione non ne producono: su n campioni si contano n−2 angoli, che
     coprono (n−2) passi. Dividere per la lunghezza intera regalava quei due passi
     al rettilineo e sottostimava tutto — invisibile su un giro da mille campioni,
     ma su un tratto da 150 m (sette campioni) erano il 30% dei gradi buttati via. */
  const spanM = (rs.n - 2) * CURVE_STEP_M;
  out.degPerKm = deg / (spanM / 1000);
  out.tightFrac = tightM / spanM;
  out.curvFrac = (radii.length * CURVE_STEP_M) / spanM;
  if (radii.length) {
    radii.sort((a, b) => a - b);
    const pick = q => radii[Math.min(radii.length - 1, Math.max(0, Math.round(q * (radii.length - 1))))];
    out.medRadius = pick(0.5); out.q1 = pick(0.25); out.q3 = pick(0.75);
  }
  return out;
}

/* Bersagli. NON sono indovinati: vengono dalla misura di 1311 strade reali
   (secondary + tertiary sopra i 150 m, 20 km attorno a Lecco) e da un anello
   Valhalla vero da 51,7 km con le preferenze moto attive.

   Strade reali, raggio mediano di curva (m):  p10 74 · p25 101 · p50 147 · p90 291
   Anello Valhalla da 51,7 km: 205 gradi/km, raggio mediano 181 m, 5% di tornanti.

   Quei 205 gradi/km sono il metro di paragone: è il giro che esce SENZA sforzo.
   "medie" ci si siede sopra, "tante" deve battere quel numero di parecchio, e
   "poche" deve starci sotto. I bersagli valgono per un PERCORSO INTERO, che media
   curve, rettilinei e paesi attraversati. */
const CURVE_TARGETS = {
  route: { poche: 80, medie: 200, tante: 450 },
  // raggio mediano bersaglio per il tipo di curva; `misto` non ha un raggio:
  // chiede varietà, e si giudica sull'ampiezza dell'intervallo interquartile.
  radius: { veloci: 260, strette: 80 },
};

/* Aderenza 0..1 fra una misura e il suo bersaglio, su scala LOGARITMICA: 100 e 400
   gradi/km distano quanto 400 e 1600, che è come li percepisce chi guida. Lineare,
   un bersaglio alto avrebbe schiacciato tutte le differenze in basso. */
function curveFit(v, target, tol) {
  if (!isFinite(v) || !isFinite(target) || target <= 0 || v <= 0) return 0;
  const e = Math.abs(Math.log(v / target)) / (tol > 0 ? tol : 0.9);
  return 1 / (1 + e * e);
}

/* Quanto pesa il "quante curve" rispetto al "che tipo di curve". La quantità pesa
   di più: è l'asse che l'utente ha davvero quantificato, ed è quello che si sente
   in sella su cento chilometri. */
const CURVE_W_QTY = 0.65, CURVE_W_KIND = 0.35;

/* Punteggio 0..1 di quanto un percorso assomiglia a ciò che l'utente ha chiesto.
   Un percorso perfettamente dritto prende zero anche a "poche curve": la scala è
   logaritmica e lo zero è infinitamente lontano da qualunque bersaglio — che è il
   comportamento voluto, perché "poche curve" non vuol dire "nessuna". */
function curveScore(stats, curves, type) {
  if (!stats) return 0;
  const tgt = CURVE_TARGETS.route;
  const qty = curveFit(stats.degPerKm, tgt[curves] != null ? tgt[curves] : tgt.medie, 0.85);
  let kind;
  if (type === 'misto') {
    /* Varietà, non un raggio preciso: si premia un intervallo interquartile ampio
       — tornanti E curvoni nello stesso giro. Normalizzato su 200 m di ampiezza,
       che sui dati reali è già una strada molto varia. */
    const span = (isFinite(stats.q3) && isFinite(stats.q1)) ? stats.q3 - stats.q1 : 0;
    kind = Math.max(0, Math.min(1, span / 200));
  } else {
    kind = curveFit(stats.medRadius, CURVE_TARGETS.radius[type] || CURVE_TARGETS.radius.veloci, 0.7);
    // Chi chiede "strette" vuole tornanti veri, non solo un raggio mediano basso:
    // metà del punteggio di tipo viene dalla frazione di metri dentro un tornante.
    if (type === 'strette') kind = 0.5 * kind + 0.5 * Math.min(1, stats.tightFrac / 0.25);
  }
  return CURVE_W_QTY * qty + CURVE_W_KIND * kind;
}
