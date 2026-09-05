'use strict';
/* js/video3d.js (step 25): render video 3D (loader three.js, fallback, start/init, keyframes, moto procedurale, drawVideoFrame3D/HUD3D). Ordine: dopo js/log-session.js. */
/* Config video 3D: URL pinnati + SRI, timeouts, camera, terreno.
   Versioni allineate al loader mappa (maplibre 4.7.1) e three 0.149.0. */
const VIDEO3D_CONF = {
  libs: [
    { global: 'maplibregl', url: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js', integrity: 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp',
      fallback: { url: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', integrity: 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj' } },
    { global: 'THREE', url: 'https://unpkg.com/three@0.149.0/build/three.min.js', integrity: 'sha384-RRHfJ6w1mTlKUBMYT/hvnRiOzEB/vyRV3DrQOseb6oYfvaZSfdd0byS4bHps0k2R' },
  ],
  css: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  cssFallback: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  demTiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  demEncoding: 'terrarium',
  timeouts: { cdnMs: 12000, styleMs: 15000 },
  camera: { zoom: 15.5, pitch: 60 },
  // pixelRatio 1: a DPR 3 la mappa rasterizzerebbe 8.3 Mpx per un frame 720p
  // da 0.92 Mpx (9x fragment + readback buttati). fadeDuration 0: con 30
  // jumpTo/s le label ricomincerebbero il crossfade a ogni frame. maxPitch 75:
  // il tetto default 60 clampa in silenzio il pitch in piega (bug mai notato).
  map: { pixelRatio: 1, fadeDuration: 0, maxPitch: 75, refreshExpiredTiles: false },
  // Cielo nativo maplibre (sopra l'orizzonte il canvas è trasparente, e nel
  // WebM l'alpha diventa nero: serve un colore vero). Solo chiavi spec 4.7.1.
  sky: { 'sky-color': '#88c6fc', 'sky-horizon-blend': 0.5, 'horizon-color': '#f8f4f0', 'horizon-fog-blend': 0.5, 'fog-color': '#dfe9f2', 'fog-ground-blend': 0.6 },
  // Traccia del giro: linea drappeggiata sul terreno (line/fill/raster/hillshade
  // sono gli unici layer drappeggiabili in 4.7.1). Scia = ultimi N punti.
  trail: { color: '#38bdf8', done: '#1d4ed8', width: 5, trailN: 40, quantStep: 60,
    cometHead: '#1d4ed8', cometMid: 'rgba(56,189,248,0.55)' },
  // Rilievo ombreggiato sul DEM già scaricato per il terrain (zero tile extra).
  hill: { exaggeration: 0.35, shadow: '#334155', highlight: '#ffffff', accent: '#f8f4f0' },
  // Edifici liberty già nello style (building-3d fill-extrusion z14+): solo tinta.
  buildings: { color: '#cfd8e3', opacity: 0.9 },
};

/* Pura: opzioni costruttore Map (testabile senza DOM né maplibre). */
function videoMapOptions(centerLat, centerLon) {
  return {
    center: [centerLon, centerLat],
    zoom: VIDEO3D_CONF.camera.zoom, pitch: VIDEO3D_CONF.camera.pitch, bearing: 0,
    style: VIDEO3D_CONF.styleUrl,
    attributionControl: false,
    preserveDrawingBuffer: true, // serve a drawImage nel master canvas
    pixelRatio: VIDEO3D_CONF.map.pixelRatio,
    fadeDuration: VIDEO3D_CONF.map.fadeDuration,
    maxPitch: VIDEO3D_CONF.map.maxPitch,
    refreshExpiredTiles: VIDEO3D_CONF.map.refreshExpiredTiles,
  };
}

/* Pura: pixelRatio effettivo, mai oltre il tetto 4096 di maxCanvasSize e mai
   sopra il dpr del device (sotto: 1, non 0 — maplibre lo userebbe per dividere). */
function videoMapPixelRatio(dpr, W, H) {
  if (!isFinite(dpr) || dpr <= 0) return 1;
  const pr = Math.min(dpr, 4096 / Math.max(1, Math.max(W, H)));
  return Math.max(1, pr);
}

/* Pura: oggetto sky per map.setSky (solo chiavi renderizzate da 4.7.1). */
function videoSkyOptions() { return Object.assign({}, VIDEO3D_CONF.sky); }

/* Pura: paint scia-cometa (testa opaca → coda trasparente). Stop statici:
   la finestra scorre ma la testa resta sempre a progress=1. */
function videoCometPaint() {
  const T = VIDEO3D_CONF.trail;
  return { 'line-width': T.width + 1, 'line-opacity': 1,
    'line-gradient': ['interpolate', ['linear'], ['line-progress'],
      0, 'rgba(29,78,216,0)', 0.6, T.cometMid, 1, T.cometHead] };
}

/* Pura: paint hillshade dal conf (riusa DEM del terrain, niente tile extra). */
function videoHillPaint() {
  const H = VIDEO3D_CONF.hill;
  return { 'hillshade-exaggeration': H.exaggeration,
    'hillshade-shadow-color': H.shadow,
    'hillshade-highlight-color': H.highlight,
    'hillshade-accent-color': H.accent };
}

/* Pura: a quale pitch l'orizzonte entra nel frame (formula dal bundle 4.7.1:
   h = 0.5 + tan(90-pitch)*1.4993*0.85; visibile se h < 1). */
function videoSkyVisible(pitchDeg) {
  if (!isFinite(pitchDeg)) return false;
  const h = 0.5 + Math.tan((90 - pitchDeg) * Math.PI / 180) * 1.4993 * 0.85;
  return h < 1;
}

/* Aggiunge la traccia una volta sola: percorso intero smorzato + scia vuota
   che verrà riempita per frame. beforeId = primo symbol (non spezza lo stack). */
function videoTrackAddToMap(map, mapPts) {
  if (!mapPts || !mapPts.length) return;
  const T = VIDEO3D_CONF.trail;
  map.addSource('giro', { type: 'geojson', data: videoTrackGeoJson(mapPts, 0, mapPts.length) });
  let beforeId = null;
  try {
    const layers = map.getStyle ? map.getStyle().layers : null;
    if (layers) { const s = layers.find(l => l.type === 'symbol'); if (s) beforeId = s.id; }
  } catch (e) {}
  map.addSource('giro', { type: 'geojson', data: videoTrackGeoJson(mapPts, 0, mapPts.length) });
  map.addLayer({ id: 'giro-rest', type: 'line', source: 'giro',
    paint: { 'line-color': T.color, 'line-width': T.width, 'line-opacity': 0.35 } }, beforeId);
  map.addSource('giro-fatto', { type: 'geojson', data: videoTrackGeoJson([], 0, 0) });
  map.addLayer({ id: 'giro-done', type: 'line', source: 'giro-fatto',
    paint: { 'line-color': T.done, 'line-width': T.width, 'line-opacity': 0.9 } }, beforeId);
  // Scia-cometa con lineMetrics (gradiente testa→coda): se il gradiente non
  // è supportato, catch → tinta solida storica (stesso layer, niente duplicati).
  map.addSource('scia', { type: 'geojson', lineMetrics: true, data: videoTrackGeoJson([], 0, 0) });
  try {
    map.addLayer({ id: 'giro-scia', type: 'line', source: 'scia', paint: videoCometPaint() }, beforeId);
  } catch (e) {
    map.addLayer({ id: 'giro-scia', type: 'line', source: 'scia',
      paint: { 'line-color': T.done, 'line-width': T.width + 1, 'line-opacity': 1 } }, beforeId);
  }
}

/* Rilievo + edifici dopo il terrain (try/catch dedicati: un id mancante nello
   stile remoto non deve buttare in 2D un render sano). */
function videoSceneAddToMap(map, beforeId) {
  const B = VIDEO3D_CONF.buildings;
  try {
    map.addLayer({ id: 'rilievo-ombreggiato', type: 'hillshade',
      source: 'dem', paint: videoHillPaint() }, beforeId);
  } catch (e) {}
  try {
    if (map.getLayer && map.getLayer('building-3d')) {
      map.setPaintProperty('building-3d', 'fill-extrusion-color', B.color);
      map.setPaintProperty('building-3d', 'fill-extrusion-opacity', B.opacity);
    }
  } catch (e) {}
}

/* Avanza percorso fatto + scia. setData solo quando kIdx cambia (a 1x ~1/s);
   il percorso fatto avanza a scatti quantizzati (niente round-trip worker per frame). */
function videoTrackAdvance(map, job, kIdx) {
  const T = VIDEO3D_CONF.trail;
  const n = job.mapPts ? job.mapPts.length : 0;
  if (!n || kIdx === job._trailIdx) return;
  job._trailIdx = kIdx;
  try {
    const [from, to] = videoTrailRange(kIdx, n, T.trailN);
    map.getSource('scia').setData(videoTrackGeoJson(job.mapPts, from, to));
    const q = Math.floor(kIdx / T.quantStep);
    if (q !== job._trailQuant) {
      job._trailQuant = q;
      map.getSource('giro-fatto').setData(videoTrackGeoJson(job.mapPts, 0, kIdx + 1));
    }
  } catch (e) {}
}

/* Pura: GeoJSON LineString dai punti (coordinate maplibre = [lon,lat]).
   Slice semiaperto [from,to): serve a separare percorso fatto / scia / resto. */
function videoTrackGeoJson(pts, from, to) {
  const n = pts ? pts.length : 0;
  if (!n) return { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
  const a = Math.max(0, Math.min(n, from == null ? 0 : from));
  const b = Math.max(0, Math.min(n, to == null ? n : to));
  const coords = [];
  for (let k = a; k < b; k++) {
    if (pts[k] && pts[k].lat != null && pts[k].lon != null) coords.push([pts[k].lon, pts[k].lat]);
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
}

/* Pura: finestra scia [from,to] semiaperto attorno a kIdx (clampata, mai NaN). */
function videoTrailRange(kIdx, trackLen, trailN) {
  if (!isFinite(kIdx) || !isFinite(trackLen) || trackLen <= 0) return [0, 0];
  if (!isFinite(trailN) || trailN <= 0) return [0, 0];
  const ki = Math.max(0, Math.min(trackLen - 1, Math.round(kIdx)));
  const to = Math.min(trackLen, ki + 1);
  return [Math.max(0, to - Math.max(1, Math.round(trailN))), to];
}

function loadVideo3DScript(url, onload, onerror, integrity) {
  const sc = document.createElement('script');
  sc.src = url; sc.crossOrigin = 'anonymous';
  if (integrity) sc.integrity = integrity;
  sc.onload = onload;
  // Fallback versione precedente (solo maplibre: se la v5 non carica o
  // l'SRI non torna, riprova con la 4.7.1 prima di buttare in 2D).
  sc.onerror = () => {
    const lib = (VIDEO3D_CONF.libs || []).find(l => l.url === url);
    if (lib && lib.fallback && !lib._fbTried) {
      lib._fbTried = true;
      try {
        const css = document.querySelector('link[href="' + VIDEO3D_CONF.css + '"]');
        if (css && VIDEO3D_CONF.cssFallback) css.href = VIDEO3D_CONF.cssFallback;
      } catch (e) {}
      loadVideo3DScript(lib.fallback.url, onload, onerror, lib.fallback.integrity);
      return;
    }
    onerror();
  };
  document.head.appendChild(sc);
}

/* Pura: altezza camera vera dal suolo (§6.5 doc replay). Dipende anche
   dall'altezza viewport: stesso zoom su telefono basso = più in alto. */
function videoCamHeightFor(zoom, pitchDeg, latDeg, viewportHPx) {
  if (!isFinite(zoom) || !isFinite(pitchDeg) || !isFinite(latDeg) || !isFinite(viewportHPx)) return NaN;
  const mpp = 156543.03 * Math.cos(latDeg * Math.PI / 180) / Math.pow(2, zoom);
  const dPx = 1.5 * Math.max(1, viewportHPx);
  return dPx * mpp * Math.cos(pitchDeg * Math.PI / 180);
}

/* Pura: zoom per un'altezza target (inversa della sopra: niente tentativi).
   Clamp 18: oltre l'Esri sgrana, sotto ~80 m niente chase (§6.5). */
function videoZoomForHeight(targetM, pitchDeg, latDeg, viewportHPx) {
  if (!isFinite(targetM) || targetM <= 0 || !isFinite(pitchDeg) || !isFinite(latDeg) || !isFinite(viewportHPx)) return NaN;
  const cosP = Math.cos(pitchDeg * Math.PI / 180);
  if (cosP <= 0.05) return NaN;
  const mpp = targetM / (1.5 * Math.max(1, viewportHPx) * cosP);
  const z = Math.log2(156543.03 * Math.cos(latDeg * Math.PI / 180) / mpp);
  return Math.max(10, Math.min(18, z));
}

/* Probe satellite opzionale (Image + cache-buster, §6.4 doc): eventi
   error/data maplibre non segnalano tile fallite (loaded anche se ko).
   Chiama cb(true) se arriva, cb(false) dopo timeout. */
function videoSatProbe(tileUrl, timeoutMs, cb) {
  let done = false;
  const finish = ok => { if (!done) { done = true; try { cb(!!ok); } catch (e) {} } };
  try {
    const img = new Image();
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = tileUrl + (tileUrl.indexOf('?') >= 0 ? '&' : '?') + 'p=' + Date.now();
    setTimeout(() => finish(false), isFinite(timeoutMs) ? timeoutMs : 9000);
  } catch (e) { finish(false); }
}

function fallbackTo2D(pre, msg, job) {
  requestVideoFallback(pre, job, msg);
}

/* Punto unico di fallback 3D→2D. Prima i 5 trigger (settle ok/ko, timeout CDN,
   catch terrain, map error, timeout stile) correvano senza dedup: doppio
   recorder 2D+3D. E se l'utente premeva Annulla durante il load, il fallback
   avviava comunque un render fantasma. */
function requestVideoFallback(pre, job, reason) {
  const cur = (typeof globalThis !== 'undefined' && globalThis.videoJob !== undefined)
    ? globalThis.videoJob
    : (typeof videoJob !== 'undefined' ? videoJob : null);
  if (job) {
    if (job._fellBack || job.cancelled) return false;
    job._fellBack = true;
    clearVideoTimers(job);
    cleanupVideoJob(job);
  } else if (cur && cur.cancelled) {
    return false;
  }
  if (cur === job && typeof videoJob !== 'undefined') videoJob = null;
  if (typeof globalThis !== 'undefined' && globalThis.videoJob === job) globalThis.videoJob = null;
  toast(reason, 'err', 6000);
  startVideoRender2D(pre);
  return true;
}

/* Timer registrati in job._timers: al fallback/cancel si cancellano tutti,
   così nessun timeout tardivo riavvia un render dopo la chiusura. */
function trackVideoTimer(job, id) {
  if (job) (job._timers = job._timers || []).push(id);
  return id;
}
function clearVideoTimers(job) {
  if (!job || !job._timers) return;
  for (const t of job._timers) { try { clearTimeout(t); } catch (e) {} }
  job._timers = [];
}

function startVideoRender3D(pre) {
  if (window.maplibregl && window.THREE) {
    try { initVideoRender3D(pre); }
    catch (e) { requestVideoFallback(pre, null, 'Errore motore 3D: ' + (e && e.message ? e.message : e) + '. Uso il render 2D.'); }
    return;
  }
  els.videoStatus.textContent = 'Carico motore 3D';
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = VIDEO3D_CONF.css;
  document.head.appendChild(css);
  const missing = VIDEO3D_CONF.libs.filter(l => !window[l.global]);

  // Feedback: pallini animati, così si capisce che sta lavorando.
  let dots = 1;
  const tick = setInterval(() => {
    dots = (dots % 3) + 1;
    els.videoStatus.textContent = 'Carico motore 3D' + '.'.repeat(dots);
  }, 400);

  let done = 0, settled = false;
  const pre2 = pre;
  const settle = () => {
    if (settled) return;
    if (++done < missing.length) return;
    settled = true;
    clearInterval(tick);
    clearTimeout(timeout);
    if (videoJob && videoJob.cancelled) return;
    if (window.maplibregl && window.THREE) {
      try { initVideoRender3D(pre2); }
      catch (e) { requestVideoFallback(pre2, null, 'Errore motore 3D: ' + (e && e.message ? e.message : e) + '. Uso il render 2D.'); }
    } else {
      requestVideoFallback(pre2, null, 'Mappa 3D non disponibile, uso il render 2D.');
    }
  };

  // Rete lenta / CDN bloccata: niente attesa infinita.
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    clearInterval(tick);
    requestVideoFallback(pre, null, 'Dipendenze 3D non caricate (rete lenta?), uso il render 2D.');
  }, VIDEO3D_CONF.timeouts.cdnMs);

  for (const lib of missing) loadVideo3DScript(lib.url, settle, settle, lib.integrity);
}

/* Costruisce job 3D (mappa+moto) senza avviare capture: riusato dal render
   WebM realtime e dal loop MP4 offline (stesso frame, altro sink). */
function video3DBuildJob(pre, canvas, ctx) {
  const maplibregl = window.maplibregl, THREE = window.THREE;
  const W = pre.res[0], H = pre.res[1];
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-9999px; top:0; width:' + W + 'px; height:' + H + 'px;';
  document.body.appendChild(container);

  const first = pre.mapPts.length ? pre.mapPts[0] : { lat: 42.5, lon: 12.5 };
  const mapOpts = videoMapOptions(first.lat, first.lon);
  const map = new maplibregl.Map(Object.assign({ container: container }, mapOpts));
  const moto = initVideoMoto3D(THREE, W, H);

  return {
    mode: '3d', running: true, cancelled: false, canvas, ctx,
    map, container, mapReady: false, moto,
    rows: pre.rows, track: pre.track, mapPts: pre.mapPts, spark: pre.spark,
    dist: pre.dist, tEnd: pre.tEnd, mult: pre.mult, speedMax: pre.speedMax,
    slow: pre.slow,
    tSim: pre.rows.length ? pre.rows[0].t : 0, lastRaf: 0,
    chunks: [], rec: null, stream: null, raf: 0, recErr: false,
    keyframes: buildCameraKeyframes(pre.mapPts),
    _trailIdx: -1, _trailQuant: -1,
    extremes: videoExtremesForJob(pre.rows),
    hud: hudLayout(pre.res[0], pre.res[1]),
  };
}

function initVideoRender3D(pre) {
  const W = pre.res[0], H = pre.res[1];
  els.videoStatus.textContent = 'Preparo mappa 3D…';

  // Canvas mappa WebGL con preserveDrawingBuffer (per drawImage nel master canvas).
  const canvas = makeVideoCanvas(pre.res);
  const ctx = canvas.getContext('2d');
  const job = video3DBuildJob(pre, canvas, ctx);
  void W; void H;
  videoJob = job; // così "Annulla" funziona anche durante il caricamento
  const map = job.map;

  /* Init robusto (§6.3 doc): 'load' aspetta le tile e hanga offline, mentre
     'style.load' dipende solo dal parsing. Guardia 6 s + satellite probe. */
  let styleReady = false;
  const setupTerrain = () => {
    if (job.cancelled) return;
    try {
      map.addSource('dem', {
        type: 'raster-dem',
        tiles: VIDEO3D_CONF.demTiles,
        encoding: VIDEO3D_CONF.demEncoding, tileSize: 256, maxzoom: 15,
      });
      // Terreno solo dopo camera in posizione (§6.2): recalculateZoom sposta
      // lo zoom, quindi si posiziona → setTerrain → riposiziona.
      const first = pre.mapPts.length ? pre.mapPts[0] : { lat: 42.5, lon: 12.5 };
      try { map.jumpTo({ center: [first.lon, first.lat], zoom: VIDEO3D_CONF.camera.zoom, pitch: VIDEO3D_CONF.camera.pitch, bearing: 0 }); } catch (e) {}
      map.setTerrain({ source: 'dem', exaggeration: 1.5 });
      try { map.jumpTo({ center: [first.lon, first.lat], zoom: VIDEO3D_CONF.camera.zoom, pitch: VIDEO3D_CONF.camera.pitch, bearing: 0 }); } catch (e) {}
      // Cielo sopra l'orizzonte (chiave fuori spec = ErrorEvent, mai throw:
      // la guardia typeof evita di buttare in 2D un render sano).
      if (typeof map.setSky === 'function') { try { map.setSky(videoSkyOptions()); } catch (e) {} }
      // Traccia del giro: layer decorativo in try/catch dedicato (un id mancante
      // nello stile remoto non deve buttare in 2D un render sano).
      let beforeId = null;
      try {
        const layers = map.getStyle ? map.getStyle().layers : null;
        if (layers) { const s = layers.find(l => l.type === 'symbol'); if (s) beforeId = s.id; }
      } catch (e) {}
      try { videoTrackAddToMap(map, pre.mapPts); } catch (e) {}
      // Rilievo ombreggiato + tinta edifici (stesso beforeId: la scia resta sopra).
      videoSceneAddToMap(map, beforeId);
      job.mapReady = true;
      beginVideoCapture(job, canvas, pre.mime);
    } catch (e) {
      requestVideoFallback(pre, job, 'Terreno 3D non disponibile, uso il render 2D.');
    }
  };
  const onStyle = () => { if (!styleReady) { styleReady = true; setupTerrain(); } };
  try { map.on('style.load', onStyle); } catch (e) {}
  // Guardia: se style.load non scatta (CDN/stile bloccati), prova comunque.
  trackVideoTimer(job, setTimeout(onStyle, 6000));

  // Rete di sicurezza: se nemmeno la guardia basta (mappa morta).
  trackVideoTimer(job, setTimeout(() => {
    if (!job.mapReady && videoJob === job && !job.cancelled) {
      requestVideoFallback(pre, job, 'Stile mappa non caricato, uso il render 2D.');
    }
  }, VIDEO3D_CONF.timeouts.styleMs));
}

/* Pura: bearing per ogni punto con carry-forward. bearing() torna null su punti
   coincidenti (moto ferma, o fix GPS ripetuto a 20 Hz nelle rows): invece di
   collassare a 0 (= NORD) si tiene l'ultimo valido; il prefisso iniziale si
   retro-riempie col primo valido. ok:false = nessun bearing reale qui. */
function videoBearingSeries(mapPts) {
  const n = mapPts ? mapPts.length : 0;
  if (!n) return [];
  const out = new Array(n);
  let last = null, firstValid = null;
  for (let i = 0; i < n; i++) {
    const b = i > 0 ? bearing(mapPts[i - 1], mapPts[i])
      : (n > 1 ? bearing(mapPts[0], mapPts[1]) : null);
    if (b != null && isFinite(b)) { last = b; if (firstValid == null) firstValid = b; }
    out[i] = { lat: mapPts[i].lat, lon: mapPts[i].lon, brg: last, ok: last != null };
  }
  const seed = firstValid != null ? firstValid : 0;
  for (let i = 0; i < n; i++) if (out[i].brg == null) out[i].brg = seed;
  return out;
}

/* Pura: media circolare con kernel triangolare (il vicino pesa più del lontano),
   saltando i campioni ok:false (carry copiati, non misure reali). */
function videoSmoothBearings(series, win) {
  const n = series ? series.length : 0;
  if (!n) return [];
  const w = win || 5, half = Math.floor(w / 2);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (!series[j].ok && series[j].brg !== series[i].brg) continue;
      const wt = half + 1 - Math.abs(j - i);
      const a = series[j].brg * Math.PI / 180;
      sx += Math.sin(a) * wt; sy += Math.cos(a) * wt;
    }
    out[i] = {
      lat: series[i].lat, lon: series[i].lon,
      brg: (sx || sy) ? (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 : series[i].brg,
    };
  }
  return out;
}

function buildCameraKeyframes(mapPts) {
  return videoSmoothBearings(videoBearingSeries(mapPts), 5);
}

/* Pura: campiona il percorso a posizione frazionaria (lerp equirettangolare:
   a 1 punto/s l'errore vs geodetica è sotto il mm; bearing sull'arco corto). */
function videoPathSampleAt(kf, u) {
  const n = kf ? kf.length : 0;
  if (!n || !isFinite(u)) return null;
  const c = Math.max(0, Math.min(n - 1, u));
  const i0 = Math.min(n - 1, Math.floor(c)), i1 = Math.min(n - 1, i0 + 1);
  const f = c - i0, a = kf[i0], b = kf[i1];
  const d = ((b.brg - a.brg + 540) % 360) - 180;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    brg: (a.brg + d * f + 360) % 360,
  };
}

/* Pura: posizione frazionaria sulla traccia per indice riga (niente Math.round:
   quello congelava la camera ~30 frame e poi scattava). */
function videoTrackPosForRow(rowIdx, rowsLen, trackLen) {
  if (!trackLen || trackLen <= 0) return 0;
  if (!rowsLen || rowsLen <= 1) return 0;
  const i = Math.max(0, Math.min(rowsLen - 1, rowIdx));
  return Math.max(0, Math.min(trackLen - 1, (i / (rowsLen - 1)) * (trackLen - 1)));
}

/* Pura: smorzamento esponenziale indipendente dal frame rate (EMA esatta).
   tau in secondi SIMULATI: il chiamante passa dt*mult, non dt reale. */
function videoDamp(cur, target, dtSim, tau) {
  if (!isFinite(cur) || !isFinite(target) || !isFinite(dtSim) || dtSim <= 0) return target;
  if (!isFinite(tau) || tau <= 0) return target;
  const a = 1 - Math.exp(-dtSim / tau);
  return cur + (target - cur) * a;
}

/* Pura: stessa EMA sull'angolo, arco corto (350→10 passa per 0, non per 180). */
function videoDampAngle(curDeg, targetDeg, dtSim, tau) {
  if (!isFinite(curDeg)) return targetDeg;
  if (!isFinite(targetDeg)) return curDeg;
  const d = ((targetDeg - curDeg + 540) % 360) - 180;
  return (curDeg + d * (1 - Math.exp(-Math.max(0, dtSim) / Math.max(1e-3, tau))) + 360) % 360;
}

/* Pura: contro-piega busto rider (30% della piega, clamp ±60°).
   Il rider è figlio di bike (che piega di -lean): con +0.3lean il busto
   resta più verticale, come un pilota vero che sporge. */
function videoRiderLean(leanDeg) {
  if (!isFinite(leanDeg)) return 0;
  const cl = Math.max(-60, Math.min(60, leanDeg));
  return (cl * Math.PI / 180) * 0.3;
}

function initVideoMoto3D(THREE, W, H, quality) {
  const shadows = !!(quality && quality.shadows);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = shadows; // default off: shadowMap costa su telefono
  renderer.domElement.style.cssText = 'position:fixed; left:-9999px; top:0;';
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
  camera.position.set(0, 3.0, 6.5);
  camera.lookAt(0, 0.55, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.4));
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(4, 8, 3);
  dir.castShadow = shadows;
  if (shadows && dir.shadow && dir.shadow.mapSize) dir.shadow.mapSize.set(1024, 1024);
  scene.add(dir);
  if (shadows && THREE.PlaneGeometry && THREE.ShadowMaterial) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.ShadowMaterial({ opacity: 0.3 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  const moto = new THREE.Group();          // yaw: muso via dalla camera
  moto.rotation.y = Math.PI;
  const bike = new THREE.Group();          // roll: piega attorno all'asse di marcia
  moto.add(bike);

  const M = {
    tire:    new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.9 }),
    rim:     new THREE.MeshStandardMaterial({ color: 0xccd1d8, roughness: 0.25, metalness: 0.9 }),
    chrome:  new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.15, metalness: 1.0 }),
    frame:   new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.5, metalness: 0.6 }),
    accent:  new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.3, metalness: 0.35 }),
    seat:    new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.95 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 1.0 }),
    head:    new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2b0, emissiveIntensity: 1.2, roughness: 0.3 }),
    tail:    new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2222, emissiveIntensity: 1.5 }),
    glass:   new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 }),
    disc:    new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.2, metalness: 1.0 }),
    suit:    new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.8 }),
    helmet:  new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.25, metalness: 0.4 }),
  };

  const add = (geom, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    if (shadows) { m.castShadow = true; }
    (parent || bike).add(m); return m;
  };

  const wheels = [];
  function wheel(z) {
    const axle = new THREE.Group();
    axle.position.set(0, 0.42, z);
    axle.rotation.z = Math.PI / 2;          // cilindro sdraiato: asse lungo X
    bike.add(axle);
    const spin = new THREE.Group();          // ruota intera rotola attorno all'asse
    axle.add(spin);
    wheels.push(spin);
    spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 32), M.tire));
    spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.15, 32), M.rim));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.17, 24), M.disc);
    disc.userData.videoPart = 'brake-disc';
    spin.add(disc);
    spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 16), M.chrome)); // mozzo
    for (let i = 0; i < 6; i++) {            // raggi
      const a = i / 6 * Math.PI * 2;
      const g = new THREE.Group(); g.rotation.y = a;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), M.chrome);
      sp.rotation.z = Math.PI / 2; sp.position.x = 0.25;
      g.add(sp); spin.add(g);
    }
  }
  wheel(-0.70); wheel(+0.70);                // posteriore / anteriore

  // forcellone + mono
  add(new THREE.BoxGeometry(0.06, 0.10, 0.55), M.frame, 0, 0.72, -0.25, 0.12);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.30, 12), M.chrome, 0.14, 0.85, -0.45);

  // forcella
  add(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 12), M.chrome, -0.10, 0.95, 0.62, 0, 0, 0.06);
  add(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 12), M.chrome, 0.10, 0.95, 0.62, 0, 0, -0.06);
  add(new THREE.BoxGeometry(0.24, 0.05, 0.12), M.frame, 0, 1.25, 0.60);
  add(new THREE.BoxGeometry(0.24, 0.05, 0.12), M.frame, 0, 0.85, 0.58);

  // manubrio + manopole
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 12), M.chrome, 0, 1.32, 0.72, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 12), M.tire, -0.26, 1.32, 0.72, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 12), M.tire, 0.26, 1.32, 0.72, 0, 0, Math.PI / 2);

  // telaio
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 10), M.frame, -0.10, 1.02, 0.30, 0, 0, 0.35);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 10), M.frame, 0.10, 1.02, 0.30, 0, 0, -0.35);
  add(new THREE.BoxGeometry(0.05, 0.6, 0.05), M.frame, -0.12, 0.75, 0.45);
  add(new THREE.BoxGeometry(0.05, 0.6, 0.05), M.frame, 0.12, 0.75, 0.45);

  // motore + alette di raffreddamento
  add(new THREE.BoxGeometry(0.34, 0.28, 0.40), M.frame, 0, 0.62, 0.00);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.38, 0.03, 0.44), M.chrome, 0, 0.78 + i * 0.035, 0.0);

  // serbatoio (ellissoide)
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 18), M.accent);
  tank.scale.set(0.22, 0.16, 0.34); tank.position.set(0, 1.08, 0.20); bike.add(tank);

  // sella + codino
  add(new THREE.BoxGeometry(0.40, 0.14, 0.55), M.seat, 0, 0.92, -0.32);
  add(new THREE.BoxGeometry(0.32, 0.20, 0.35), M.accent, 0, 1.00, -0.60);

  // carenatura / muso + parabrezza
  add(new THREE.BoxGeometry(0.34, 0.50, 0.50), M.accent, 0, 1.00, 0.55, -0.18);
  add(new THREE.BoxGeometry(0.30, 0.28, 0.02), M.glass, 0, 1.28, 0.62, -0.35);

  // faro
  add(new THREE.CylinderGeometry(0.10, 0.10, 0.06, 20), M.head, 0, 0.95, 0.85, Math.PI / 2);
  add(new THREE.TorusGeometry(0.10, 0.02, 8, 20), M.chrome, 0, 0.95, 0.85, Math.PI / 2);

  // parafango anteriore (mezza ciambella)
  add(new THREE.TorusGeometry(0.46, 0.05, 12, 24, Math.PI), M.accent, 0, 0.72, 0.70, Math.PI / 2);

  // scarico
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 12), M.exhaust, 0.12, 0.55, -0.10, 0.4);
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.45, 16), M.exhaust, 0.12, 0.50, -0.55, Math.PI / 2);

  // luce posteriore + targa + pedane
  add(new THREE.BoxGeometry(0.14, 0.05, 0.03), M.tail, 0, 0.95, -0.78);
  add(new THREE.BoxGeometry(0.16, 0.10, 0.02), M.frame, 0, 0.80, -0.78);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.10, 8), M.frame, -0.20, 0.35, -0.05);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.10, 8), M.frame, 0.20, 0.35, -0.05);

  // cavalletto laterale (fermo in video: migliora silhouette da dietro)
  const stand = add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), M.frame, -0.22, 0.25, -0.30, 0, 0, 0.5);
  stand.userData.videoPart = 'stand';

  // rider minimale: busto + casco, contro-piega 30% (vedi videoRiderLean).
  // Gruppo separato da bike così la piega si compone senza toccare la moto.
  const rider = new THREE.Group();
  rider.position.set(0, 1.0, -0.25);
  rider.userData.videoPart = 'rider';
  bike.add(rider);
  const torsoGeom = THREE.CapsuleGeometry
    ? new THREE.CapsuleGeometry(0.16, 0.35, 4, 12)
    : new THREE.CylinderGeometry(0.16, 0.20, 0.55, 12);
  add(torsoGeom, M.suit, 0, 0.35, 0, 0.15, 0, 0, rider);
  add(new THREE.SphereGeometry(0.14, 20, 16), M.helmet, 0, 0.72, 0.05, 0, 0, 0, rider);

  scene.add(moto);

  // Registra tutto il disposable per disposeVideoMoto3D: traverse a fine vita
  // non basta se i materiali condivisi (M.*) non sono referenziati dai mesh
  // visitati — qui la lista è esplicita e completa.
  const disposables = new Set();
  scene.traverse(o => {
    if (o.geometry) disposables.add(o.geometry);
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => disposables.add(m));
  });
  Object.values(M).forEach(m => disposables.add(m));
  return { renderer, scene, camera, bike, wheels, rider, shadows, _disposables: [...disposables] };
}

/* Libera GPU+CPU dopo un render 3D o un cancel. Idempotente: doppia chiamata
   (cleanupVideoJob + stopVideoRender) non lancia. Senza: ogni render 3D
   accumulava decine di Geometry/Material mai disposti. */
function disposeVideoMoto3D(moto) {
  if (!moto || moto._disposed) return;
  moto._disposed = true;
  const list = moto._disposables || [];
  for (const d of list) { try { d.dispose && d.dispose(); } catch (e) {} }
  moto._disposables = [];
  if (moto.renderer) {
    try { moto.renderer.dispose(); } catch (e) {}
    try { moto.renderer.forceContextLoss && moto.renderer.forceContextLoss(); } catch (e) {}
    try {
      const el = moto.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) {}
  }
}

/* Velocità angolare ruota da dt reale: prima era speed*0.022*mult per frame
   (frame-rate dipendente + doppio conteggio di mult, già applicato a tSim). */
function videoWheelSpin(speedKmh, dt) {
  if (!isFinite(speedKmh) || !isFinite(dt) || dt <= 0) return 0;
  return (speedKmh / 3.6) / 0.42 * dt; // v/r, raggio ruota 0.42 m
}

/* Indice nel track per la riga i: clamp + gestioni vuote. Prima il mapping
   proporzionale puro dava NaN fuori range se track/rows divergevano. */
function videoTrackIndexForRow(rowIdx, rowsLen, trackLen) {
  if (!trackLen || trackLen <= 0) return 0;
  if (!rowsLen || rowsLen <= 1) return 0;
  const i = Math.max(0, Math.min(rowsLen - 1, rowIdx));
  return Math.max(0, Math.min(trackLen - 1, Math.round((i / (rowsLen - 1)) * (trackLen - 1))));
}

/* Pura: altezza target dal suolo per regime (m). Lento = basso e radente
   sui tornanti, veloce = più alto per leggere la strada (§6.5 doc). */
function videoCamAltFor(speedKmh, leanDeg) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  const lean = isFinite(leanDeg) ? Math.min(60, Math.abs(leanDeg)) : 0;
  const t = Math.max(0, Math.min(1, v / 120)); // 0 km/h → 0, 120+ → 1
  // 90 m fermo → 260 m veloce; piega abbassa (prospettiva radente).
  return 90 + t * 170 - (lean / 60) * 15;
}

/* Pura: camera mappa dinamica. Veloce → zoom out (più strada visibile),
   lento → zoom in (dettaglio curve). Piega alta → pitch più radente.
   vert 9:16 → +0.75 zoom (a parità di zoom la striscia visibile è stretta,
   la strada sparisce ai bordi; falsy = comportamento storico invariato).
   Con lat/H noti lo zoom viene dall'altezza vera (niente tentativi, §6.5);
   senza (chiamanti vecchi/test) cade sulla curva storica. */
function videoCameraFor(speedKmh, leanDeg, vert, latDeg, viewportHPx) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  const lean = isFinite(leanDeg) ? Math.min(60, Math.abs(leanDeg)) : 0;
  const t = Math.max(0, Math.min(1, v / 120)); // 0 km/h → 0, 120+ → 1
  const pitch = 55 + (lean / 60) * 17; // 55 (dritto) → 72 (piega max)
  let zoom = 16.5 - t * 2.0 + (vert ? 0.75 : 0); // curva storica
  if (isFinite(latDeg) && isFinite(viewportHPx)) {
    const z = videoZoomForHeight(videoCamAltFor(v, lean), pitch, latDeg, viewportHPx);
    if (isFinite(z)) zoom = z + (vert ? 0.75 : 0);
  }
  return { zoom, pitch };
}

function drawVideoFrame3D(job, dt) {
  const { ctx, map, moto, rows, mapPts, keyframes, dist, speedMax, tSim } = job;
  const W = job.canvas.width, H = job.canvas.height;
  const i = Math.max(0, findRowAt(rows, tSim));
  const r = rows[i] || {};

  // Camera mappa: scorre continua sul tracciato (niente scatti a 1 Hz),
  // guarda ~2 s avanti sul percorso, zoom/pitch smorzati (niente pompaggio GPS).
  const u = videoTrackPosForRow(i, rows.length, keyframes.length);
  const p = videoPathSampleAt(keyframes, u);
  if (p && job.mapReady) {
    // Altezza vera da lat/viewport (§6.5) + padding top (§6.6: punto in quota
    // si proietta alto con terrain, la moto finirebbe sotto l'HUD).
    const cam = videoCameraFor(r.speedKmh || 0, r.lean || 0, W < H, p.lat, H);
    const dtSim = (dt == null ? 1 / 30 : Math.max(0, dt)) * (job.mult || 1);
    const ahead = videoPathSampleAt(keyframes, Math.min(keyframes.length - 1, u + 2 * keyframes.length / Math.max(1, job.tEnd - (rows[0] ? rows[0].t : 0))));
    const brgT = ahead ? ahead.brg : p.brg;
    const c = job._cam || { lat: p.lat, lon: p.lon, brg: brgT, zoom: cam.zoom, pitch: cam.pitch };
    // Soglie anti-deriva: a regime il centro resta sul GPS (niente moto fuori strada).
    c.lat = videoDamp(c.lat, p.lat, dtSim, 0.18);
    c.lon = videoDamp(c.lon, p.lon, dtSim, 0.18);
    if (Math.abs(c.lat - p.lat) > 0.0001) c.lat = p.lat;
    if (Math.abs(c.lon - p.lon) > 0.0001) c.lon = p.lon;
    c.brg = videoDampAngle(c.brg, brgT, dtSim, 0.55);
    c.zoom = videoDamp(c.zoom, cam.zoom, dtSim, 0.4);
    c.pitch = videoDamp(c.pitch, cam.pitch, dtSim, 0.4);
    job._cam = c;
    map.jumpTo({ center: [c.lon, c.lat], bearing: c.brg, pitch: c.pitch, zoom: c.zoom,
      padding: { top: 150, bottom: 0, left: 0, right: 0 } });
    if (typeof map.redraw === 'function') map.redraw(); else if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
    // Scia: kIdx intero già calcolato? qui serve l'indice traccia, non keyframe.
    videoTrackAdvance(map, job, videoTrackIndexForRow(i, rows.length, mapPts.length));
  }

  // Moto: piega + rotolamento ruote (dt reale, non per-frame).
  const leanRad = (r.lean || 0) * Math.PI / 180;
  moto.bike.rotation.z = -leanRad;           // piega positiva (destra) = top verso destra
  if (moto.rider) moto.rider.rotation.z = videoRiderLean(r.lean || 0);
  const spin = videoWheelSpin(r.speedKmh || 0, dt == null ? 1 / 30 : dt);
  for (const w of moto.wheels) w.rotation.y += spin;

  moto.renderer.render(moto.scene, moto.camera);

  // Composizione: mappa + moto + HUD.
  ctx.clearRect(0, 0, W, H);
  const mc = map.getCanvas();
  if (mc) ctx.drawImage(mc, 0, 0, W, H);
  ctx.drawImage(moto.renderer.domElement, 0, 0, W, H);
  drawVideoHUD3D(ctx, job, r, tSim, dist[i] || 0, speedMax);
}

/* Pura: estremi per indice riga nel formato {tickR,tickL} che l'HUD legge. */
function videoExtremesForJob(rows) {
  const ex = runningExtremes(rows || []);
  return ex.leanR.map((rR, k) => ({ tickR: rR, tickL: ex.leanL[k] }));
}

// L'HUD 3D sta su pannelli neri sopra una basemap sempre chiara (stile liberty):
// usa una palette scura fissa, non il tema app (in tema chiaro --text è quasi
// nero e diventerebbe illeggibile sul pannello). Il cruscotto 2D invece segue
// il tema via videoColor perché dipinge il fondo con --c-bg.
const HUD3D_COLORS = {
  accent: '#38bdf8', txt: '#f4f8fc', axis: '#a8b8c8',
  good: '#34d399', bad: '#f87171',
};

function drawVideoHUD3D(ctx, job, r, tSim, distKm, speedMax) {
  const W = job.canvas.width, H = job.canvas.height;
  const accent = HUD3D_COLORS.accent, txt = HUD3D_COLORS.txt, axis = HUD3D_COLORS.axis;
  const good = HUD3D_COLORS.good, bad = HUD3D_COLORS.bad;
  const kmh = Math.round(r.speedKmh || 0);
  // Layout parametrico (720p/1080p/9:16); il chiamante non testato può non
  // passare job.hud → fallback, altrimenti 1 test su 160 lancia.
  const L = job.hud || hudLayout(W, H);
  const s = L.s || 1;
  const P0 = 'rgba(0,0,0,.42)', P1 = 'rgba(0,0,0,.30)';

  ctx.textBaseline = 'alphabetic';
  // Velocità (alto-sinistra): numero + km/h, alone per il beige liberty.
  hudPanel(ctx, L.speed.x, L.speed.y, L.speed.w, L.speed.h, 16 * s, P0, P1);
  ctx.textAlign = 'left';
  hudText(ctx, String(kmh), L.speed.x + 18 * s, L.speed.y + 80 * s,
    hudFont('bold', 64 * s), accent, 4 * s);
  hudText(ctx, 'km/h', L.speed.x + 18 * s + 64 * s * (kmh >= 100 ? 2.1 : 1.4), L.speed.y + 80 * s,
    hudFont('bold', 22 * s), axis, 3 * s);

  // Tempo + distanza (alto-destra): box auto-larghezza dal testo misurato.
  const tr = fmtDur(tSim) + ' · ' + (isFinite(distKm) ? distKm.toFixed(2) : '0.00') + ' km';
  ctx.textAlign = 'right';
  ctx.font = hudFont('bold', 22 * s);
  const tw = ctx.measureText ? ctx.measureText(tr).width : 200 * s;
  const tx = L.vert ? L.time.x : W - 16 * s - tw - 28 * s;
  hudPanel(ctx, tx, L.time.y, tw + 28 * s, 44 * s, 14 * s, P0, P1);
  hudText(ctx, tr, tx + tw + 14 * s, L.time.y + 31 * s, hudFont('bold', 22 * s), txt, 3 * s);

  // Cerchio G fra i blocchi alti (non sopra la moto: sta a y ~ fascia alta).
  hudGdot(ctx, L.g.cx, L.g.cy, L.g.gr, r.latG || 0, r.lonG || 0, accent, axis, txt);

  // Piega: contagiri con fondoscala vivo (record finora) + settore attivo.
  // hudCang è in convenzione canvas; ang() matematica qui darebbe il giro lungo.
  function tickMark(cx, cy, gr, tickDeg, scale) {
    if (!isFinite(tickDeg) || !tickDeg) return;
    const t = Math.max(-scale, Math.min(scale, tickDeg));
    const a = hudCang(t);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * gr * 0.86, cy + Math.sin(a) * gr * 0.86);
    ctx.lineTo(cx + Math.cos(a) * gr * 1.02, cy + Math.sin(a) * gr * 1.02);
    ctx.stroke();
  }
  function i0(job) {
    try { return Math.max(0, findRowAt(job.rows, job.tSim)); } catch (e) { return 0; }
  }
  const cx = L.lean.cx, cy = L.lean.cy, gr = L.lean.gr;
  const ex = (job.extremes && job.extremes[i0(job)]) || { tickR: 47, tickL: -42 };
  const scale = leanScaleFor(ex.tickR, ex.tickL);
  const m = leanGaugeModel(r.lean || 0, ex.tickR, ex.tickL, scale);
  hudPanel(ctx, L.lean.x, L.lean.y, L.lean.w, L.lean.h, 14 * s, P0, P1);
  ctx.lineCap = 'round';
  ctx.strokeStyle = axis; ctx.lineWidth = Math.max(3, gr * 0.14);
  ctx.beginPath(); ctx.arc(cx, cy, gr, hudCang(-scale), hudCang(scale)); ctx.stroke();
  // tacche record D/S
  ctx.strokeStyle = good; ctx.lineWidth = Math.max(2, gr * 0.07);
  tickMark(cx, cy, gr, ex.tickR, scale); tickMark(cx, cy, gr, ex.tickL, scale);
  // settore 0→corrente + ago
  const na = (90 - m.cl) * Math.PI / 180; // ago: convenzione matematica con sin negato
  ctx.strokeStyle = m.cl >= 0 ? good : bad; ctx.lineWidth = Math.max(2, gr * 0.10);
  ctx.beginPath(); ctx.arc(cx, cy, gr, hudCang(0), hudCang(m.cl), m.cl < 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(na) * gr * 0.82, cy - Math.sin(na) * gr * 0.82); ctx.stroke();
  ctx.textAlign = 'center';
  hudText(ctx, Math.round(m.cl) + '° ' + m.side, cx, cy + gr * 0.3 + 24 * s,
    hudFont('bold', 24 * s), txt, 3 * s);
  hudText(ctx, 'max ' + Math.round(Math.max(Math.abs(ex.tickR), Math.abs(ex.tickL))) + '°',
    cx, cy + gr * 0.3 + 48 * s, hudFont('bold', 18 * s), axis, 3 * s);

  // Vmax + record piega (basso-destra): box auto-larghezza, layout-dipendente.
  const exV = (job.extremes && job.extremes[i0(job)]) || { tickR: 47, tickL: -42 };
  const vmax = Math.round(Math.max(0, speedMax || kmh));
  const br = 'Vmax ' + vmax + ' · piega ' + Math.round(Math.max(Math.abs(exV.tickR), Math.abs(exV.tickL))) + '°';
  ctx.textAlign = 'right';
  ctx.font = hudFont('bold', 22 * s);
  const bw = ctx.measureText ? ctx.measureText(br).width : 260 * s;
  const bx = L.vert ? L.vmax.x : W - 16 * s - bw - 28 * s;
  hudPanel(ctx, bx, L.vmax.y, L.vert ? L.vmax.w : bw + 28 * s, L.vmax.h, 14 * s, P0, P1);
  const bxx = L.vert ? L.vmax.x + L.vmax.w - 14 * s : bx + bw + 14 * s;
  hudText(ctx, br, bxx, L.vmax.y + 31 * s, hudFont('bold', 22 * s), txt, 3 * s);

  // Avanzamento giro (sottile, bordo basso): frazione tSim/tEnd.
  const frac = job.tEnd > 0 ? Math.max(0, Math.min(1, tSim / job.tEnd)) : 0;
  ctx.fillStyle = 'rgba(0,0,0,.30)';
  ctx.fillRect(0, H - 6 * s, W, 6 * s);
  ctx.fillStyle = accent;
  ctx.fillRect(0, H - 6 * s, W * frac, 6 * s);
}
