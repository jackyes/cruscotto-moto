'use strict';
/* js/cams.js (step 16): runtime autovelox (fetchCameras, maybeLoadCameras, checkCameras, camsToDraw). Usa state/grid/fetchWithTimeout/render a runtime. Ordine: dopo js/nav-net.js. */
async function fetchCameras(lat, lon) {
  // Guard anti-flood: senza questo, ogni fix GPS (1 Hz) lanciava una nuova query
  // mentre la precedente era ancora in volo → decine di richieste identiche e ban IP.
  if (state.camFetching) return;
  if (Date.now() < state.camRetryAfter) return;
  state.camFetching = true;
  /* Il timeout del server scala col raggio: a 50 km l'area e' 25 volte quella a 10 km,
     e i 25 s fissi non bastavano sulle zone dense. */
  const r = state.camRadius;
  const tmo = Math.round(25 + (r - 10000) / 1000);
  const q = `[out:json][timeout:${tmo}];(node["highway"="speed_camera"](around:${r},${lat},${lon});node["enforcement"="speed_camera"](around:${r},${lat},${lon}););out body;`;
  const qs = '?data=' + encodeURIComponent(q);
  try {
    let res = null, lastErr = null;
    // Al primo errore si prova il mirror, prima di rassegnarsi al backoff di 2 minuti.
    for (const host of CAM_HOSTS) {
      try {
        const r2 = await fetchWithTimeout(host + qs, (tmo + 10) * 1000);
        if (r2.ok) { res = r2; break; }
        lastErr = new Error('HTTP ' + r2.status);
      } catch (e) { lastErr = e; }
    }
    if (!res) throw lastErr || new Error('overpass non raggiungibile');
    const data = await res.json();
    const cams = (data.elements || []).map(el => ({
      id: el.id,
      lat: el.lat, lon: el.lon,
      maxspeed: (el.tags && el.tags.maxspeed) || '',
      name: (el.tags && el.tags.name) || ''
    })).filter(c => typeof c.lat === 'number' && typeof c.lon === 'number');
    state.cameras = cams;
    state.camCenter = { lat, lon };
    state.camTs = Date.now();
    state.camRetryAfter = 0;
    store.set('cruscotto.cameras', { center: { lat, lon }, ts: state.camTs, r: r, cameras: cams });
    rebuildCamGrid();
    renderCameras();
  } catch (e) {
    state.camRetryAfter = Date.now() + CAM_FAIL_BACKOFF_MS; // mantiene cache precedente
  } finally {
    state.camFetching = false;
  }
}

function maybeLoadCameras(lat, lon) {
  const stale = !state.camTs || (Date.now() - state.camTs > CAM_STALE_MS);
  const moved = !state.camCenter || haversine(state.camCenter, { lat, lon }) * 1000 > camMoveThreshold();
  if (stale || moved) fetchCameras(lat, lon);
}

function camsToDraw() {
  const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
  // Con un DB nazionale importato non si disegna tutto: solo ciò che è vicino.
  const list = p ? camsNear(p.lat, p.lon, camMarkerRadius()) : allCameras();
  state.camTotal = list.length;
  state.camDrawn = Math.min(list.length, CAM_MARKER_MAX);
  if (list.length <= CAM_MARKER_MAX) return list;
  if (!p) return list.slice(0, CAM_MARKER_MAX);
  // Si ordina solo quando il tetto morde davvero, e comunque a un redraw ogni 20 s.
  const withD = list.map(c => ({ c: c, d: haversine(p, { lat: c.lat, lon: c.lon }) }));
  withD.sort((a, b) => a.d - b.d);
  return withD.slice(0, CAM_MARKER_MAX).map(x => x.c);
}

function checkCameras() {
  if (!state.camAlerts) return;
  if (state.pos.lat == null) return;
  const me = { lat: state.pos.lat, lon: state.pos.lon };
  // Solo le celle attorno: niente scansione dell'intero DB a ogni fix.
  const cams = camsNear(me.lat, me.lon, state.camDist * 2 + 500);
  if (!cams.length) return;

  const hdg = trackUpHeading();
  const useBearing = state.camAhead && hdg != null && state.speedMs >= HEADING_MIN_MS;
  const now = Date.now();
  const seen = {};

  let nearest = null, nearestD = Infinity;
  const meR = me.lat * Math.PI / 180, meLonR = me.lon * Math.PI / 180;
  const sinMe = Math.sin(meR), cosMe = Math.cos(meR);
  for (const c of cams) {
    // haversine inline su precomputati: niente oggetti, niente sin/cos per me.
    const dLatH = (c.latR - meR) / 2, dLonH = (c.lonR - meLonR) / 2;
    const h = Math.sin(dLatH) ** 2 + cosMe * c.cosLat * Math.sin(dLonH) ** 2;
    const d = 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
    const k = c._k || camKey(c);
    seen[k] = d;
    if (d > state.camDist) continue;
    if (useBearing) {
      // Scarta gli autovelox alle spalle o sulla carreggiata opposta
      const bc = bearing(me, c);
      if (bc == null) continue;
      if (angleDiff(bc, hdg) > CAM_AHEAD_DEG) continue;
    } else {
      // Senza heading affidabile: avvisa solo se ci si sta avvicinando
      const prev = state.camLastDist[k];
      if (prev != null && d > prev - 1) continue;
    }
    if (d < nearestD) { nearestD = d; nearest = c; }
  }
  state.camLastDist = seen;

  if (!nearest) return;
  const k = camKey(nearest);
  if (state.camCooldown[k] && now - state.camCooldown[k] < CAM_COOLDOWN_MS) return;
  state.camCooldown[k] = now;
  pruneCamCooldown(now);
  alertCamera(nearestD, nearest);
}
