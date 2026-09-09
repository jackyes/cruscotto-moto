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
    const data = await jsonUnderTimeout(res);
    /* Overpass segnala i propri errori "runtime" dentro un HTTP 200 (campo
       remark, elements assente): senza il check, cameras=[] e la cache BUONA
       veniva sovrascritta col vuoto — zero avvisi autovelox per 15 minuti.
       Qui si lancia: il chiamante fa backoff e la cache precedente resta. */
    if (!Array.isArray(data.elements) || data.remark) {
      throw new Error('Overpass: ' + ((data.remark && String(data.remark).slice(0, 80)) || 'risposta senza elements'));
    }
    const cams = data.elements.map(el => ({
      id: el.id,
      lat: el.lat, lon: el.lon,
      maxspeed: (el.tags && el.tags.maxspeed) || '',
      name: (el.tags && el.tags.name) || ''
    })).filter(c => isFinite(c.lat) && isFinite(c.lon));
    state.cameras = cams;
    state.camCenter = { lat, lon };
    state.camTs = Date.now();
    state.camRetryAfter = 0;
    // Cache su IndexedDB, non localStorage: a 50 km di raggio in zona densa
    // l'array sfora la quota di localStorage (5 MB) e la cache moriva in
    // silenzio, oltre a JSON.stringify sincroni da centinaia di KB sul main
    // thread a ogni download.
    idb.kvPut('cachedCameras', { center: { lat, lon }, ts: state.camTs, r: r, cameras: cams }).catch(() => {});
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
  const moved = !state.camCenter || haversineM(state.camCenter.lat, state.camCenter.lon, lat, lon) > camMoveThreshold();
  if (stale || moved) fetchCameras(lat, lon);
}

/* Rete tornata: il backoff post-fallimento non deve far aspettare i 2 minuti
   quando il motivo era proprio la rete assente (galleria, ascensore).
   Il listener vive quanto la pagina (window): nessuna rimozione necessaria. */
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => { state.camRetryAfter = 0; });
}

function camsToDraw() {
  const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
  const ver = state.camGridVer || 0;
  // Dirty-flag: finché non ci si muove davvero (e la griglia non cambia) la
  // lista resta la stessa. Il vecchio timer a 20 s ricostruiva fino a 400
  // marker anche da fermi: batteria e calore spesi per un'immagine identica.
  const moved = !p ? false : (!state._camDraw || !state._camDraw.pos ||
    haversineM(state._camDraw.pos.lat, state._camDraw.pos.lon, p.lat, p.lon) > camMoveThreshold() * 0.4);
  if (state._camDraw && state._camDraw.ver === ver && !moved) return state._camDraw.list;
  const list = p ? camsNear(p.lat, p.lon, camMarkerRadius()) : allCameras();
  state.camTotal = list.length;
  state.camDrawn = Math.min(list.length, CAM_MARKER_MAX);
  let out = list;
  if (list.length > CAM_MARKER_MAX) {
    if (!p) out = list.slice(0, CAM_MARKER_MAX);
    else {
      // Si ordina solo quando il tetto morde davvero, e comunque a un redraw
      // ogni movimento reale.
      const withD = list.map(c => ({ c: c, d: haversine(p, { lat: c.lat, lon: c.lon }) }));
      withD.sort((a, b) => a.d - b.d);
      out = withD.slice(0, CAM_MARKER_MAX).map(x => x.c);
    }
  }
  state._camDraw = { pos: p ? { lat: p.lat, lon: p.lon } : null, ver: ver, list: out };
  return out;
}

function checkCameras(acc) {
  if (!state.camAlerts) return;
  if (state.pos.lat == null) return;
  // Gate di accuratezza dedicato: un fix da 100-300 m (sottopasso, canyon
  // urbano, dopo galleria) genererebbe falsi allarmi "autovelox ~80 m" con la
  // camera reale a 300+, o peggio farebbe saltare un avviso vero perché la
  // distanza sembra "salire" per rumore. Più permissivo di GPS_ACC_MAX (traccia):
  // qui conta non far scattare un falso banner, non la precisione della linea.
  if (acc != null && acc > CAM_ACC_MAX) return;
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
    const d = 2 * EARTH_R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
    const k = c._k || camKey(c);
    seen[k] = { d: d, t: now };
    if (d > state.camDist) continue;
    if (useBearing) {
      // Scarta gli autovelox alle spalle o sulla carreggiata opposta
      const bc = bearing(me, c);
      if (bc == null) continue;
      if (angleDiff(bc, hdg) > CAM_AHEAD_DEG) continue;
    } else {
      // Senza heading affidabile: avvisa solo se ci si sta avvicinando.
      // La distanza precedente vale solo se recente: un fix staccato di minuti
      // (schermo spento, galleria lunga) riusava numeri vecchi di ore e
      // scartava camere vere come "in allontanamento".
      const prev = state.camLastDist[k];
      if (prev != null && now - prev.t <= CAM_LAST_DIST_MAX_MS && d > prev.d - 1) continue;
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
