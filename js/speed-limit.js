'use strict';
/* js/speed-limit.js: limite di velocità da OSM (Overpass).

   Una query scarica le strade con maxspeed entro SPEED_LIMIT_RADIUS_M, con la
   geometria intera; la strada su cui si è si sceglie poi in locale a ogni fix.
   Prima si chiedevano le strade entro 40 m ogni 15 s o 150 m (a 100 km/h una
   query ogni ~5 s, ~600 l'ora su un endpoint pubblico) e si prendeva quella col
   CENTRO più vicino: una statale lunga chilometri perdeva contro una traversa di
   200 m all'incrocio, e il badge diceva 30 (rosso) a 90 km/h.

   Scelta della strada: distanza dal tracciato vero (segmenti), entro
   SPEED_LIMIT_MATCH_M, e verso di marcia compatibile col segmento entro
   SPEED_LIMIT_HEAD_DEG (in entrambi i sensi, o solo in quello giusto per i
   senso unico). Senza heading affidabile (lenti) conta solo la distanza. */
const SPEED_LIMIT_RADIUS_M = 1000;    // raggio della query
const SPEED_LIMIT_REFETCH_M = 500;    // spostamento dal centro della cache che fa riscaricare
const SPEED_LIMIT_STALE_MS = 600000;  // età massima della cache (dati OSM cambiano di rado)
const SPEED_LIMIT_MATCH_M = 25;       // oltre, nessuna strada: badge nascosto
const SPEED_LIMIT_HEAD_DEG = 35;      // tolleranza fra verso di marcia e segmento
const SPEED_LIMIT_FAIL_MS = 120000;   // backoff dopo che tutti gli host hanno fallito
const SPEED_LIMIT_OVER_KMH = 3;

function parseMaxspeed(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'none' || s === 'signals' || s === 'walk') return null;
  if (s.indexOf(':') >= 0) return null;
  const first = s.split(';')[0].trim();
  const m = first.match(/^(\d+(?:\.\d+)?)\s*(mph|knots)?$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (!isFinite(v) || v <= 0 || v > 200) return null;
  if (m[2] === 'mph') v *= 1.60934;
  else if (m[2] === 'knots') v *= 1.852;
  return Math.round(v);
}

/* Senso unico: 1 = nel verso dei nodi, -1 = contrario, 0 = doppio senso.
   Autostrade e rotatorie lo sono per definizione anche senza tag. */
function wayOneway(tags) {
  const t = tags || {};
  const o = String(t.oneway || '').toLowerCase();
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === 'no' || o === 'false' || o === '0') return 0;
  if (t.highway === 'motorway' || t.junction === 'roundabout' || t.junction === 'circular') return 1;
  return 0;
}

/* Pura: elementi Overpass (out tags geom) → strade utilizzabili. */
function parseSpeedWays(elements) {
  const out = [];
  for (const el of elements || []) {
    if (!el || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const kmh = parseMaxspeed(el.tags && el.tags.maxspeed);
    if (kmh == null) continue;
    const pts = [];
    for (const g of el.geometry) {
      if (g && typeof g.lat === 'number' && typeof g.lon === 'number' && isFinite(g.lat) && isFinite(g.lon)) pts.push({ lat: g.lat, lon: g.lon });
    }
    if (pts.length >= 2) out.push({ kmh, oneway: wayOneway(el.tags), pts });
  }
  return out;
}

/* Pura: limite della strada su cui si è. heading in gradi (0 = nord) o null. */
function matchSpeedLimit(ways, lat, lon, heading) {
  if (!ways || !ways.length || lat == null || lon == null) return null;
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  const useHead = heading != null && isFinite(heading);
  let best = null, bestD = SPEED_LIMIT_MATCH_M;
  for (const w of ways) {
    const p = w.pts;
    for (let i = 0; i + 1 < p.length; i++) {
      // Piano locale in metri centrato sulla posizione (a questa scala basta).
      const ax = (p[i].lon - lon) * kx, ay = (p[i].lat - lat) * ky;
      const bx = (p[i + 1].lon - lon) * kx, by = (p[i + 1].lat - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d > bestD) continue;
      if (useHead) {
        const brg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        let diff = Math.abs(heading - brg) % 360;
        if (diff > 180) diff = 360 - diff;
        const fwd = diff <= SPEED_LIMIT_HEAD_DEG;
        const back = diff >= 180 - SPEED_LIMIT_HEAD_DEG;
        const ok = w.oneway === 1 ? fwd : w.oneway === -1 ? back : (fwd || back);
        if (!ok) continue;
      }
      bestD = d;
      best = w.kmh;
    }
  }
  return best;
}

/* Serve una query nuova? Mai con una in volo o durante il backoff; sì senza
   cache, con la cache vecchia o allontanandosi dal suo centro. */
function speedLimitDue(lat, lon, now) {
  if (state.speedLimitFetching) return false;
  if (now < (state.speedLimitRetryAfter || 0)) return false;
  const c = state.speedLimitPos;
  if (!c || !state.speedLimitWays) return true;
  if (now - (state.speedLimitAt || 0) >= SPEED_LIMIT_STALE_MS) return true;
  return haversine(c, { lat, lon }) * 1000 >= SPEED_LIMIT_REFETCH_M;
}

/* A ogni fix: ricalcolo locale del limite e, se serve, query in sottofondo.
   Fuori dal cerchio scaricato (query fallita e ci si è allontanati) il limite
   è ignoto: badge nascosto invece di un valore di un'altra strada. */
function maybeLoadSpeedLimit(lat, lon, heading) {
  if (lat == null || lon == null) return;
  const hdg = heading !== undefined ? heading : navHeadForReq(state.gps && state.gps.heading);
  updateSpeedLimitAt(lat, lon, hdg);
  if (speedLimitDue(lat, lon, Date.now())) fetchSpeedLimit(lat, lon);
}

function updateSpeedLimitAt(lat, lon, hdg) {
  const c = state.speedLimitPos;
  const inside = c && state.speedLimitWays &&
    haversine(c, { lat, lon }) * 1000 <= SPEED_LIMIT_RADIUS_M - SPEED_LIMIT_MATCH_M;
  state.speedLimit = inside ? matchSpeedLimit(state.speedLimitWays, lat, lon, hdg) : null;
}

async function fetchSpeedLimit(lat, lon) {
  if (state.speedLimitFetching) return;
  state.speedLimitFetching = true;
  const q = `[out:json][timeout:15];way["highway"]["maxspeed"](around:${SPEED_LIMIT_RADIUS_M},${lat},${lon});out tags geom;`;
  const qs = '?data=' + encodeURIComponent(q);
  try {
    let res = null, lastErr = null;
    for (const host of CAM_HOSTS) {
      try {
        const r2 = await fetchWithTimeout(host + qs, 20000);
        if (r2.ok) { res = r2; break; }
        lastErr = new Error('HTTP ' + r2.status);
      } catch (e) { lastErr = e; }
    }
    if (!res) throw lastErr || new Error('overpass non raggiungibile');
    const data = await jsonUnderTimeout(res);
    if (!Array.isArray(data.elements) || data.remark) {
      throw new Error('Overpass: ' + ((data.remark && String(data.remark).slice(0, 80)) || 'risposta senza elements'));
    }
    // Anche un risultato vuoto è una cache valida (zona senza maxspeed): si
    // riscarica solo spostandosi o allo scadere, non a ogni fix.
    state.speedLimitWays = parseSpeedWays(data.elements);
    state.speedLimitAt = Date.now();
    state.speedLimitPos = { lat, lon };
    state.speedLimitRetryAfter = 0;
    const p = state.pos;
    if (p && p.lat != null) updateSpeedLimitAt(p.lat, p.lon, navHeadForReq(state.gps && state.gps.heading));
    else updateSpeedLimitAt(lat, lon, null);
  } catch (e) {
    /* Tutti gli host falliti: il limite vecchio non resta a schermo (la moto è
       andata avanti e un "50" con la classe 'over' mentirebbe). La cache resta:
       dentro il suo cerchio il match locale continua a valere. */
    state.speedLimitRetryAfter = Date.now() + SPEED_LIMIT_FAIL_MS;
    const p = state.pos;
    if (p && p.lat != null) updateSpeedLimitAt(p.lat, p.lon, navHeadForReq(state.gps && state.gps.heading));
    else state.speedLimit = null;
  } finally {
    state.speedLimitFetching = false;
  }
}
