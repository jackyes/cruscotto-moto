'use strict';
const SPEED_LIMIT_AROUND_M = 40;
const SPEED_LIMIT_MIN_MS = 15000;
const SPEED_LIMIT_MIN_M = 150;
const SPEED_LIMIT_FAIL_MS = 120000;
const SPEED_LIMIT_EMPTY_MS = 60000;
const SPEED_LIMIT_EMPTY_MAX_MS = 300000;
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

function speedLimitDue(lat, lon, now) {
  if (state.speedLimitFetching) return false;
  if (now < (state.speedLimitRetryAfter || 0)) return false;
  const last = state.speedLimitPos;
  if (!last) return true;
  const age = now - (state.speedLimitAt || 0);
  const moved = haversine(last, { lat, lon }) * 1000;
  return age >= SPEED_LIMIT_MIN_MS || moved >= SPEED_LIMIT_MIN_M;
}

function maybeLoadSpeedLimit(lat, lon) {
  if (lat == null || lon == null) return;
  if (!speedLimitDue(lat, lon, Date.now())) return;
  fetchSpeedLimit(lat, lon);
}

function pickNearestMaxspeed(elements, lat, lon) {
  let best = null, bestD = Infinity;
  const me = { lat, lon };
  for (const el of elements || []) {
    const c = el.center;
    if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
    const kmh = parseMaxspeed(el.tags && el.tags.maxspeed);
    if (kmh == null) continue;
    const d = haversine(me, { lat: c.lat, lon: c.lon });
    if (d < bestD) { bestD = d; best = kmh; }
  }
  return best;
}

async function fetchSpeedLimit(lat, lon) {
  if (state.speedLimitFetching) return;
  state.speedLimitFetching = true;
  const q = `[out:json][timeout:8];way["highway"]["maxspeed"](around:${SPEED_LIMIT_AROUND_M},${lat},${lon});out tags center;`;
  const qs = '?data=' + encodeURIComponent(q);
  try {
    let res = null, lastErr = null;
    for (const host of CAM_HOSTS) {
      try {
        const r2 = await fetchWithTimeout(host + qs, 12000);
        if (r2.ok) { res = r2; break; }
        lastErr = new Error('HTTP ' + r2.status);
      } catch (e) { lastErr = e; }
    }
    if (!res) throw lastErr || new Error('overpass non raggiungibile');
    const data = await jsonUnderTimeout(res);
    if (!Array.isArray(data.elements) || data.remark) {
      throw new Error('Overpass: ' + ((data.remark && String(data.remark).slice(0, 80)) || 'risposta senza elements'));
    }
    state.speedLimit = pickNearestMaxspeed(data.elements, lat, lon);
    state.speedLimitAt = Date.now();
    state.speedLimitPos = { lat, lon };
    if (state.speedLimit == null) {
      // Strada senza tag maxspeed: il risultato vuoto è legittimo, ma ripetere
      // la query ogni 15 s / 150 m (a 130 km/h ≈ 850 richieste/ora contro un
      // endpoint pubblico) è spam. Backoff esponenziale da 60 s fino a 5 min.
      const n = (state.speedLimitEmptyN || 0) + 1;
      state.speedLimitEmptyN = n;
      state.speedLimitRetryAfter = Date.now() +
        Math.min(SPEED_LIMIT_EMPTY_MAX_MS, SPEED_LIMIT_EMPTY_MS * Math.pow(2, n - 1));
    } else {
      state.speedLimitEmptyN = 0;
      state.speedLimitRetryAfter = 0;
    }
  } catch (e) {
    /* Il limite del fetch precedente restava in state per SPEED_LIMIT_FAIL_MS: nel
       frattempo la moto è andata avanti, e il badge continuava a mostrare il
       vecchio valore — con la classe 'over' accesa a 75 km/h su un "50" che non
       c'entra più. Un errore (tutti gli host Overpass falliti) significa "limite
       ignoto": il badge sparisce, come nel ramo del risultato vuoto, invece di
       mentire. Il backoff resta: non si martella l'endpoint. */
    state.speedLimit = null;
    state.speedLimitRetryAfter = Date.now() + SPEED_LIMIT_FAIL_MS;
  } finally {
    state.speedLimitFetching = false;
  }
}
