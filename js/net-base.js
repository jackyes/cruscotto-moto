'use strict';
/* js/net-base.js (step 7): TimeoutError/OfflineError, fetchWithTimeout, route/geoCacheKey, cacheGetFresh/Put, takeLogAvg. Usa idb+logAcc (core). No DOM. */
/* fetch con timeout esplicito, usata da Overpass, dal routing e dal geocoding. Senza
   AbortController una connessione appesa (galleria, cella satura) non risolveva mai la
   promise: `finally` non girava, state.camFetching restava true e la guardia anti-flood
   qui sotto uccideva ogni fetch successiva per il resto della sessione, senza dirlo. */
class TimeoutError extends Error { constructor(msg) { super(msg || 'timeout'); this.name = 'TimeoutError'; } }
class OfflineError extends Error { constructor(msg) { super(msg || 'offline'); this.name = 'OfflineError'; } }
async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  let timed = false;
  const kill = setTimeout(() => { timed = true; ctl.abort(); }, ms);
  let res;
  try {
    res = await fetch(url, { signal: ctl.signal });
  } catch (e) {
    clearTimeout(kill);
    if (timed || (e && e.name === 'AbortError')) throw new TimeoutError('timeout dopo ' + ms + ' ms');
    // Solo un navigator.onLine === false dà diritto al diagnóstico "offline":
    // un TypeError è CORS/DNS/mixed-content e dire "Senza rete" mentiva
    // all'utente (il motore era bloccato, non irraggiungibile).
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      throw new OfflineError((e && e.message) || 'offline');
    throw e;
  }
  // Il timer NON si ferma agli header: resta vivo finché jsonUnderTimeout non
  // ha letto tutto il body. Un server che manda gli header e poi stalla il body
  // (galleria, cella satura) lasciava la promise appesa per sempre: ricalcolo
  // bloccato in REROUTING e coda navGate paralizzata per la sessione.
  res._tmoKill = kill;
  res._tmoMs = ms;
  return res;
}
function clearResTmo(res) {
  if (res && res._tmoKill) { clearTimeout(res._tmoKill); res._tmoKill = null; }
}
/* Il timer abortisce anche la lettura del body (spec fetch), ma il caller che
   fa .json() dopo vedrebbe un AbortError nudo invece del TimeoutError — e la
   UI confonderebbe "bloccato" con "lento". Tutto il body va letto da qui. */
async function jsonUnderTimeout(res) {
  try {
    const j = await res.json();
    clearResTmo(res);
    return j;
  } catch (e) {
    clearResTmo(res);
    if (e && e.name === 'AbortError') {
      throw new TimeoutError('body non ricevuto entro il timeout' + (res && res._tmoMs ? ' di ' + res._tmoMs + ' ms' : ''));
    }
    throw e;
  }
}


/* Cache route/geocode in idb kv (stesse chiavi, no migrazione schema).
   Route: chiave = hash(from@4dec+to+costing[+heading]); TTL 24h. Geocode: chiave = query
   normalizzata + bias @2dec; TTL 7gg, max ~200 voci LRU. Offline: cache letta
   anche se scaduta (stale-while-offline); TimeoutError non scrive mai.
   L'heading (arrotondato a 10°) entra nella chiave: una richiesta CON heading
   servita da una cache calcolata SENZA (e viceversa) cambia il tracciato
   vicino all'origine — è il param che evita l'inversione a U iniziale. */
const ROUTE_CACHE_TTL_MS = 24 * 3600 * 1000, GEO_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
function routeCacheKey(from, to, costing, hdg, vias) {
  const f = from.lat.toFixed(4) + ',' + from.lon.toFixed(4);
  const t = to.lat.toFixed(4) + ',' + to.lon.toFixed(4);
  const h = (hdg != null && isFinite(hdg)) ? ':' + (Math.round(hdg / 10) * 10) : '';
  const v = (vias && vias.length) ? '~' + vias.map(x => x.lat.toFixed(4) + ',' + x.lon.toFixed(4)).join('>') : '';
  return 'routeCache:' + f + v + '>' + t + ':' + JSON.stringify(costing || {}) + h;
}
function geoCacheKey(q, p) {
  const nq = String(q || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const bias = p ? '|' + p.lat.toFixed(2) + ',' + p.lon.toFixed(2) : '';
  return 'geocodeCache:' + nq + bias;
}
async function cacheGetFresh(key, ttl) {
  try {
    const e = await idb.kvGet(key);
    if (!e || !e.ts) return null;
    if (Date.now() - e.ts > (e.ttl || ttl)) return { stale: true, body: e.body };
    return { stale: false, body: e.body };
  } catch (err) { return null; }
}
async function cachePut(key, body, ttl) {
  try { await idb.kvPut(key, { ts: Date.now(), ttl: ttl, body: body }); } catch (err) {}
}

function takeLogAvg() {
  if (!logAcc.n) return null;
  const n = logAcc.n;
  const out = {
    lean: logAcc.lean / n, latG: logAcc.latG / n, lonG: logAcc.lonG / n,
    vertG: logAcc.vertG / n, gyro: logAcc.gyro / n, vib: logAcc.vib / n,
    latFus: logAcc.latFus / n, lonFus: logAcc.lonFus / n,
    pitch: logAcc.pitch / n, yaw: logAcc.yaw / n, speedFus: logAcc.speedFus / n,
    leanKin: logAcc.leanKin / n, vibHi: logAcc.vibHi / n, vibRect: logAcc.vibRect / n,
    latPk: logAcc.latPk, lonPk: logAcc.lonPk, vertPk: logAcc.vertPk,
  };
  resetLogAcc();
  return out;
}

