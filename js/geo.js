'use strict';
/* js/geo.js (step 2): funzioni pure senza dipendenze (no state, no DOM).
   haversine/M, camKey, cellKey, camPrecompute, bearing, angleDiff, NAV_BANDS,
   distM, decodePolyline6, navShapePlausible, navSegNearest, navLowerBound,
   navProject, navPassed, navAdvance, navBandDist, navFmtDist/Short/Time.
   Ordine: dopo js/core.js, prima dello script inline. */
function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h)) / 1000;
}
// Variante scalare: evita due allocazioni di oggetto per chiamata nel loop checkCameras.
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const la1 = lat1 * Math.PI / 180, la2 = lat2 * Math.PI / 180;
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function camKey(c) {
  if (c && c._k) return c._k;
  if (!c || !isFinite(c.lat) || !isFinite(c.lon)) return '?,?';
  if (c.id != null && c.id !== '') return 'id:' + c.id;
  const k = c.lat.toFixed(6) + ',' + c.lon.toFixed(6);
  try { c._k = k; } catch (e) {}
  return k;
}

/* ---- Indice spaziale a griglia ----
   Un DB importato (es. SCDB Italia) supera i 10.000 punti: la scansione lineare a
   ogni fix GPS e un marker Leaflet per camera bloccavano il telefono. */
function cellKey(lat, lon) {
  return Math.floor(lat / CAM_GRID_DEG) + ':' + Math.floor(lon / CAM_GRID_DEG);
}
/* Precomputa all'ingest: radianti + sin/cos lat + chiave stabile. Il costo
   trigonometrico si paga 1x all'import invece di 1x per fix per camera. */
function camPrecompute(c) {
  if (c._pre) return c;
  const D = Math.PI / 180;
  c.latR = c.lat * D; c.lonR = c.lon * D;
  c.sinLat = Math.sin(c.latR); c.cosLat = Math.cos(c.latR);
  c._k = camKey(c);
  c._pre = true;
  return c;
}

/* Rilevamento iniziale da A verso B, in gradi bussola (0 = nord).
   Ritorna null se non calcolabile: input non finito o punti coincidenti
   (sotto ~1 cm atan2(0,0) sarebbe 0° fittizio). */
function bearing(a, b) {
  if (!a || !b) return null;
  const la1 = +a.lat, lo1 = +a.lon, la2 = +b.lat, lo2 = +b.lon;
  if (!isFinite(la1) || !isFinite(lo1) || !isFinite(la2) || !isFinite(lo2)) return null;
  if (Math.abs(la1) > 90 || Math.abs(la2) > 90 || Math.abs(lo1) > 180 || Math.abs(lo2) > 180) return null;
  const r1 = la1 * Math.PI / 180, r2 = la2 * Math.PI / 180;
  const dLon = (lo2 - lo1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(r2);
  const x = Math.cos(r1) * Math.sin(r2) - Math.sin(r1) * Math.cos(r2) * Math.cos(dLon);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return null; // punti identici (dist ~0)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* Fasce di annuncio: TEMPORALI, non metriche. 100 m a 130 km/h sono 2,8 s, cioe'
   troppo tardi per un'uscita autostradale. clamp(v*t, min, max). */
const NAV_BANDS = [
  { bit: 8, t: 3.5, min: 25,  max: 140,  name: 'now'  },
  { bit: 4, t: 9,   min: 80,  max: 350,  name: 'near' },
  { bit: 2, t: 25,  min: 250, max: 900,  name: 'mid'  },
  { bit: 1, t: 55,  min: 500, max: 1800, name: 'far'  },
];

function distM(a, b) { return haversine(a, b) * 1000; } // haversine ritorna km

/* ---- decodifica polyline, precisione 6 ----
   Aritmetica float invece di |= e >>: a precisione 6 i valori arrivano a 29 bit e il
   margine sui 32 bit si assottiglia. Costa nulla e toglie di mezzo la classe di bug. */
function decodePolyline6(str) {
  const lats = [], lons = [];
  let i = 0, lat = 0, lon = 0;
  const n = str.length;
  while (i < n) {
    let shift = 0, result = 0, b;
    do { b = str.charCodeAt(i++) - 63; result += (b & 0x1f) * Math.pow(2, shift); shift += 5; }
    while (b >= 0x20 && i < n);
    lat += (result % 2 === 1) ? -(result + 1) / 2 : result / 2;
    shift = 0; result = 0;
    do { b = str.charCodeAt(i++) - 63; result += (b & 0x1f) * Math.pow(2, shift); shift += 5; }
    while (b >= 0x20 && i < n);
    lon += (result % 2 === 1) ? -(result + 1) / 2 : result / 2;
    lats.push(lat * 1e-6); lons.push(lon * 1e-6);
  }
  return { lat: lats, lon: lons };
}

/* Asserzione di sanita': il sintomo dell'errore 5-vs-6 e' latitudine 4.5 invece di 45.
   Senza questo controllo la mappa mostra solo il vuoto e non c'e' nessun errore. */
function navShapePlausible(lats, lons) {
  if (!lats.length) return false;
  for (let i = 0; i < lats.length; i += Math.max(1, Math.floor(lats.length / 20))) {
    if (!isFinite(lats[i]) || !isFinite(lons[i])) return false;
    if (Math.abs(lats[i]) > 90 || Math.abs(lons[i]) > 180) return false;
  }
  return true;
}

/* ---- costruzione delle strutture derivate, una volta sola alla ricezione ----
   Typed array e non array di oggetti: 12.000 punti come {lat,lon} sono ~1,2 MB e
   pressione GC in un loop che gira a ogni fix; cosi' sono ~350 KB. */

/* ---- proiezione punto-segmento in piano equirettangolare locale ----
   Origine nella posizione corrente: numeri piccoli, niente cancellazione, e cos(lat)
   calcolato una volta per fix invece che per segmento. A 44 gradi cos = 0,72:
   ignorarlo gonfia le distanze est-ovest del 39%. */
function navSegNearest(nv, i, kx, ky, pLat, pLon) {
  const ax = (nv.lon[i] - pLon) * kx, ay = (nv.lat[i] - pLat) * ky;
  const bx = (nv.lon[i + 1] - pLon) * kx, by = (nv.lat[i + 1] - pLat) * ky;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = 0;
  if (L2 > 1e-9) t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { d2: cx * cx + cy * cy, t: t };
}

function navLowerBound(cum, n, v) {
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

/* Aggancio alla polilinea. Non argmin geometrico puro: su un percorso che ripassa
   vicino a se stesso (tornanti, ritorno sulla stessa strada, doppia carreggiata)
   il punto piu' vicino e' quello sbagliato, l'aggancio salta di 40 km e il navigatore
   comincia ad annunciare svolte di un altro pezzo di percorso. */
function navProject(nv, pLat, pLon, hdg, v, acc, full) {
  const kx = 111320 * Math.cos(pLat * Math.PI / 180), ky = 111132;
  let lo, hi;
  if (full) { lo = 0; hi = nv.n - 2; }
  else {
    const back = Math.max(60, 2 * v), fwd = Math.max(200, 6 * v + 3 * (acc || 0));
    lo = navLowerBound(nv.cum, nv.n, nv.sAlong - back);
    hi = navLowerBound(nv.cum, nv.n, nv.sAlong + fwd);
    hi = Math.min(nv.n - 2, Math.max(lo, Math.min(hi, lo + NAV_MAX_SEG_SCAN)));
  }
  const useHead = hdg != null && isFinite(hdg);
  let best = null, bestScore = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    // pass 0 con il gate di heading; pass 1 senza, se il gate ha escluso tutto
    for (let i = lo; i <= hi; i++) {
      const round = (nv.flags[i] & 1) !== 0;
      let dh = 0;
      if (useHead && !round) {
        dh = angleDiff(hdg, nv.brg[i]);
        if (pass === 0 && dh > NAV_HEAD_GATE_DEG) continue;
      }
      const r = navSegNearest(nv, i, kx, ky, pLat, pLon);
      const d = Math.sqrt(r.d2);
      const s = nv.cum[i] + r.t * (nv.cum[i + 1] - nv.cum[i]);
      // penalita' di regressione: 0,75 m per ogni metro indietro oltre 20 m di slack
      const back = full ? 0 : Math.max(0, (nv.sAlong - 20) - s) * 0.75;
      const head = (useHead && !round) ? 60 * dh / 180 : 0;
      const score = d + back + head;
      if (score < bestScore) { bestScore = score; best = { i: i, t: r.t, d: d, s: s }; }
    }
    if (best) break;
  }
  return best;
}

/* ---- avanzamento manovre ----
   `while`, non `if`: dopo una galleria ci si ritrova due o tre manovre avanti, e con
   `if` si scaricano tre "adesso gira" consecutivi per svolte gia' superate. */
function navPassed(nv, k, hdg) {
  if (k >= nv.man.length) return false;
  if (nv.offDist > nv.offThr) return false;   // match scadente: si congela
  if (nv.sAlong >= nv.sMan[k] + NAV_PASS_OVERSHOOT_M) return true;
  if (nv.sAlong >= nv.sMan[k] - NAV_PASS_EARLY_M &&
      hdg != null && nv.man[k].brgAfter != null &&
      angleDiff(hdg, nv.man[k].brgAfter) <= NAV_PASS_HEAD_DEG) return true;
  return false;
}

function navAdvance(nv, hdg) {
  let moved = 0;
  while (nv.nextMan < nv.man.length && navPassed(nv, nv.nextMan, hdg)) {
    nv.nextMan++; nv.spoken = 0; moved++;
  }
  // Le manovre consumate in blocco da un recupero GPS non devono generare il post-cue:
  // "continua per 3 km su via X" quando via X e' gia' alle spalle e' disinformazione.
  if (moved > 1) nv.suppressPost = true;
  return moved;
}

function navBandDist(b, vRef) { return Math.max(b.min, Math.min(b.max, vRef * b.t)); }

function navFmtDist(m) {
  if (m < 150) return Math.round(m / 10) * 10 + ' metri';
  if (m < 950) return Math.round(m / 50) * 50 + ' metri';
  if (m < 3000) return (m / 1000).toFixed(1).replace('.', ',') + ' chilometri';
  return Math.round(m / 1000) + ' chilometri';
}
function navFmtShort(m) {
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
}
function navFmtTime(s) {
  if (!isFinite(s) || s < 0) return '—';
  let m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  m = m % 60;
  return h ? h + ' h ' + String(m).padStart(2, '0') : m + ' min';
}
