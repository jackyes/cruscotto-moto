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
  // Satellite opzionale (§5.1 doc): raster Esri (z/y/x!) + DEM terrarium (z/x/y).
  // Default liberty: satellite costa tile pesanti, resta scelta utente.
  satTiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  satAttr: 'Immagini Esri, Maxar, Earthstar Geographics',
  demTiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  demAttr: 'Quote Tilezen / AWS Open Data',
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
  // Rampa unica |lean| → colore (teal dritto → rosso piega max, §3 doc replay):
  // stesso dato in 2D (bin Path2D) e 3D (expression interpolate). Stop [deg, rgb].
  leanRamp: [[0, [46, 111, 106]], [12, [79, 168, 140]], [22, [180, 192, 100]],
    [32, [224, 179, 65]], [42, [222, 122, 53]], [52, [212, 64, 47]]],
  // Terra sotto il raster (§6.7 doc): buchi tile = terreno lontano, non voragini.
  ground: '#2F3A30',
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

/* Pura: colore rampa lean (interpolazione lineare fra stop, come MapLibre
   interpolate linear). lean negativo = |.| (destra/sinistra stesso dato). */
function videoLeanColor(leanDeg) {
  const stops = VIDEO3D_CONF.leanRamp;
  const a = isFinite(leanDeg) ? Math.min(60, Math.abs(leanDeg)) : 0;
  if (a <= stops[0][0]) return 'rgb(' + stops[0][1].join(',') + ')';
  for (let k = 1; k < stops.length; k++) {
    if (a <= stops[k][0]) {
      const [d0, c0] = stops[k - 1], [d1, c1] = stops[k];
      const t = (a - d0) / Math.max(1e-9, d1 - d0);
      const c = [0, 1, 2].map(j => Math.round(c0[j] + (c1[j] - c0[j]) * t));
      return 'rgb(' + c.join(',') + ')';
    }
  }
  const last = stops[stops.length - 1][1];
  return 'rgb(' + last.join(',') + ')';
}

/* Pura: expression MapLibre per la stessa rampa (traccia 3D colorata per
   piega: ['get','lean'] su segmenti con k/lean, §5.3 doc). */
function videoLeanColorExpr() {
  const e = ['interpolate', ['linear'], ['get', 'lean']];
  for (const [d, c] of VIDEO3D_CONF.leanRamp) e.push(d, 'rgb(' + c.join(',') + ')');
  return e;
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
   h = 0.5 + tan(90-pitch)·SKY_HORIZON_FACTOR; visibile se h < 1). */
const SKY_HORIZON_FACTOR = 1.4993 * 0.85;
function videoSkyVisible(pitchDeg) {
  if (!isFinite(pitchDeg)) return false;
  const h = 0.5 + Math.tan((90 - pitchDeg) * Math.PI / 180) * SKY_HORIZON_FACTOR;
  return h < 1;
}

/* Pura: lean per segmento 3D dalla riga di quel momento (per tempo con mapT,
   vedi videoMapTimes; senza, per proporzione di indice). */
function videoSegLeansFor(mapPts, rows, mapT) {
  const n = mapPts ? mapPts.length : 0, nr = rows ? rows.length : 0;
  if (!n || !nr) return new Array(n).fill(0);
  const out = new Array(n);
  for (let k = 0; k < n; k++) {
    const ri = videoRowForMapPoint(rows, mapT, k, n);
    const l = rows[ri] ? rows[ri].lean : 0;
    out[k] = isFinite(l) ? Math.abs(l) : 0;
  }
  return out;
}

/* Aggiunge la traccia una volta sola: percorso intero smorzato + scia vuota
   che verrà riempita per frame. beforeId = primo symbol (non spezza lo stack). */
function videoTrackAddToMap(map, mapPts, segLeans) {
  if (!mapPts || !mapPts.length) return;
  const T = VIDEO3D_CONF.trail;
  let beforeId = null;
  try {
    const layers = map.getStyle ? map.getStyle().layers : null;
    if (layers) { const s = layers.find(l => l.type === 'symbol'); if (s) beforeId = s.id; }
  } catch (e) {}
  map.addSource('giro', { type: 'geojson', data: videoTrackGeoJson(mapPts, 0, mapPts.length) });
  map.addLayer({ id: 'giro-rest', type: 'line', source: 'giro',
    paint: { 'line-color': T.color, 'line-width': T.width, 'line-opacity': 0.35 } }, beforeId);
  // Sottofondo terra (§6.7): deve stare sotto il raster, non qui (lo stile
  // liberty lo gestisce); il ground serve al setup che lo inserisce per primo.
  map.addSource('giro-fatto', { type: 'geojson',
    data: videoTrackSegGeoJson(mapPts, 0, mapPts.length, segLeans) });
  // Tratto fatto colorato per piega (stessa rampa del 2D); fallback tinta
  // solida se l'expression non è supportata dallo stile remoto.
  try {
    map.addLayer({ id: 'giro-done', type: 'line', source: 'giro-fatto',
      paint: { 'line-color': videoLeanColorExpr(), 'line-width': T.width, 'line-opacity': 0.95 } }, beforeId);
  } catch (e) {
    map.addLayer({ id: 'giro-done', type: 'line', source: 'giro-fatto',
      paint: { 'line-color': T.done, 'line-width': T.width, 'line-opacity': 0.9 } }, beforeId);
  }
  // Reveal progressivo (§5.3 doc): solo segmenti con k <= corrente, il resto
  // resta nascosto senza riscrivere geometrie. setFilter solo su cambio chunk.
  try { map.setFilter('giro-done', ['<=', ['get', 'k'], -1]); } catch (e) {}
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
/* Layer liberty da nascondere in modalità satellite: i fill opachi piatti
   (acqua, landuse/landcover/park, footprint edifici 2D) coprirebbero il raster
   Esri. Si tengono building-3d (estrusi 3D sopra il satellite, cinematico),
   strade/labels/waterway per il contesto. Guardia per layer: id mancanti nello
   stile remoto non devono buttare in 2D un render sano. */
const VIDEO3D_SAT_HIDE = ['natural_earth', 'park', 'park_outline',
  'landuse_residential', 'landcover_wood', 'landcover_grass', 'landcover_ice',
  'landcover_wetland', 'landuse_pitch', 'landuse_track', 'landuse_cemetery',
  'landuse_hospital', 'landuse_school', 'water', 'landcover_sand',
  'aeroway_fill', 'building', 'road_area_pattern'];

function videoSatHideBaseLayers(map) {
  // background: layer di tipo background NON ha layout 'visibility' (solo
  // paint). Si azzera l'opacità altrimenti il #f8f4f0 copre tutto il satellite.
  try { if (map.getLayer && map.getLayer('background')) map.setPaintProperty('background', 'background-opacity', 0); } catch (e) {}
  for (const id of VIDEO3D_SAT_HIDE) {
    try { if (map.getLayer && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {}
  }
}

/* Satellite opzionale: raster Esri come base (sotto strade/labels), liberty
   base (background trasparente + fill piatti nascosti). Idempotente, try/catch:
   stile remoto senza layer o tile bloccate → si resta su liberty, niente throw. */
function videoSatAddToMap(map) {
  try {
    map.addSource('video-sat', { type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: VIDEO3D_CONF.satTiles, attribution: VIDEO3D_CONF.satAttr });
  } catch (e) {}
  videoSatHideBaseLayers(map);
  let satBefore = null;
  try {
    const ls = map.getStyle ? map.getStyle().layers : null;
    if (ls && ls.length) satBefore = ls[0].id;
  } catch (e) {}
  try {
    map.addLayer({ id: 'video-sat', type: 'raster', source: 'video-sat',
      paint: { 'raster-opacity': 1 } }, satBefore);
  } catch (e) {}
}

/* Pura: id dei layer estrusi (i palazzi 3D) presenti nello stile. Scan per
   tipo invece dell'id cablato 'building-3d': se liberty rinomina il layer
   l'interruttore continua a funzionare, e uno stile con più estrusi
   (es. building-3d + landmark) si spegne tutto insieme. */
function videoBuildingLayerIds(layers) {
  const out = [];
  for (const l of (layers || [])) {
    if (l && l.type === 'fill-extrusion' && l.id) out.push(l.id);
  }
  return out;
}

/* buildings: false spegne i palazzi 3D (default acceso). In centro città gli
   estrusi coprono la traccia e mangiano frame rate; in montagna non c'è nulla
   da spegnere, quindi resta una scelta dell'utente, non un automatismo. */
function videoSceneAddToMap(map, beforeId, buildings) {
  const B = VIDEO3D_CONF.buildings;
  const show = buildings !== false;
  try {
    map.addLayer({ id: 'rilievo-ombreggiato', type: 'hillshade',
      source: 'dem', paint: videoHillPaint() }, beforeId);
  } catch (e) {}
  let ids = [];
  try {
    const st = map.getStyle ? map.getStyle() : null;
    ids = videoBuildingLayerIds(st && st.layers);
  } catch (e) {}
  if (!ids.length) ids = ['building-3d'];
  for (const id of ids) {
    try {
      if (!(map.getLayer && map.getLayer(id))) continue;
      map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
      if (!show) continue;
      map.setPaintProperty(id, 'fill-extrusion-color', B.color);
      map.setPaintProperty(id, 'fill-extrusion-opacity', B.opacity);
    } catch (e) {}
  }
}

/* Avanza percorso fatto + scia. Scia = setData su cambio idx; percorso fatto =
   setFilter su cambio chunk (niente round-trip worker per frame, §5.3 doc). */
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
      map.setFilter('giro-done', ['<=', ['get', 'k'], kIdx]);
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

/* Pura: segmenti con k/lean per reveal progressivo (§5.3 doc): una Feature per
   segmento, così setFilter(['<=',['get','k'],cur]) mostra solo il percorso fatto
   senza riscrivere geometrie ogni frame. lean = |piega| picco segmento. */
function videoTrackSegGeoJson(pts, from, to, leans) {
  const n = pts ? pts.length : 0;
  const feats = [];
  if (!n) return { type: 'FeatureCollection', features: [] };
  const a = Math.max(0, Math.min(n - 1, from == null ? 0 : from));
  const b = Math.max(1, Math.min(n, to == null ? n : to));
  for (let k = Math.max(0, a - 1); k < b - 1; k++) {
    const p0 = pts[k], p1 = pts[k + 1];
    if (!p0 || !p1 || p0.lat == null || p1.lat == null) continue;
    const l0 = leans && isFinite(leans[k]) ? Math.abs(leans[k]) : 0;
    const l1 = leans && isFinite(leans[k + 1]) ? Math.abs(leans[k + 1]) : 0;
    feats.push({ type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[p0.lon, p0.lat], [p1.lon, p1.lat]] },
      properties: { k, lean: Math.max(l0, l1) } });
  }
  return { type: 'FeatureCollection', features: feats };
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

/* Metri per pixel a zoom 0 all'equatore in MapLibre, che lavora con tile da
   512 px (40.075.016,686 m / 512). Prima c'era 156543,03, il valore delle tile
   da 256 px (Leaflet, Google): altezze e commenti erano il doppio di quelle
   reali. Corretto insieme ai bersagli di videoCamAltFor, dimezzati: lo zoom
   risultante — e quindi il video — è identico a prima. */
const MAPLIBRE_MPP_Z0 = 78271.517;

/* Pura: altezza camera vera dal suolo (§6.5 doc replay). Dipende anche
   dall'altezza viewport: stesso zoom su telefono basso = più in alto. */
function videoCamHeightFor(zoom, pitchDeg, latDeg, viewportHPx) {
  if (!isFinite(zoom) || !isFinite(pitchDeg) || !isFinite(latDeg) || !isFinite(viewportHPx)) return NaN;
  const mpp = MAPLIBRE_MPP_Z0 * Math.cos(latDeg * Math.PI / 180) / Math.pow(2, zoom);
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
  const z = Math.log2(MAPLIBRE_MPP_Z0 * Math.cos(latDeg * Math.PI / 180) / mpp);
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

/* Carica maplibre+three (CDN, SRI, fallback versione) e risolve quando i
   globali ci sono. Estratto da startVideoRender3D perché anche l'export MP4
   3D ne ha bisogno: prima li dava per scontati e al primo render MP4 3D
   video3DBuildJob trovava maplibregl undefined → "Encode MP4 fallito".
   Rifiuta con il motivo già pronto per il toast (rete lenta / non disponibile). */
function ensureVideo3DLibs(onStatus) {
  return new Promise((resolve, reject) => {
    if (window.maplibregl && window.THREE) { resolve(); return; }
    const say = t => { try { if (onStatus) onStatus(t); } catch (e) {} };
    say('Carico motore 3D');
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = VIDEO3D_CONF.css;
    document.head.appendChild(css);
    const missing = VIDEO3D_CONF.libs.filter(l => !window[l.global]);

    // Feedback: pallini animati, così si capisce che sta lavorando.
    let dots = 1;
    const tick = setInterval(() => {
      dots = (dots % 3) + 1;
      say('Carico motore 3D' + '.'.repeat(dots));
    }, 400);

    let done = 0, settled = false;
    const settle = () => {
      if (settled) return;
      if (++done < missing.length) return;
      settled = true;
      clearInterval(tick);
      clearTimeout(timeout);
      if (window.maplibregl && window.THREE) resolve();
      else reject(new Error('Mappa 3D non disponibile'));
    };

    // Rete lenta / CDN bloccata: niente attesa infinita.
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      reject(new Error('Dipendenze 3D non caricate (rete lenta?)'));
    }, VIDEO3D_CONF.timeouts.cdnMs);

    if (!missing.length) { settle(); return; }
    for (const lib of missing) loadVideo3DScript(lib.url, settle, settle, lib.integrity);
  });
}

function startVideoRender3D(pre) {
  if (videoSessionGone()) return;    // modale chiusa durante setup async: niente ghost
  const start = () => {
    const fit = typeof videoRealtimeFit === 'function' ? videoRealtimeFit(pre) : null;
    if (!fit) return;
    try { initVideoRender3D(pre, fit); }
    catch (e) { requestVideoFallback(pre, null, 'Errore motore 3D: ' + (e && e.message ? e.message : e) + '. Uso il render 2D.'); }
  };
  if (window.maplibregl && window.THREE) { start(); return; }
  ensureVideo3DLibs(t => { els.videoStatus.textContent = t; }).then(() => {
    if (videoJob && videoJob.cancelled) return;
    if (videoSessionGone()) return;  // chiusa durante il load CDN (~12 s)
    start();
  }, e => {
    requestVideoFallback(pre, null, (e && e.message ? e.message : 'Mappa 3D non disponibile') + ', uso il render 2D.');
  });
}

/* Costruisce job 3D (mappa+moto) senza avviare capture: riusato dal render
   WebM realtime e dal loop MP4 offline (stesso frame, altro sink). */
function video3DBuildJob(pre, canvas, ctx) {
  const maplibregl = window.maplibregl, THREE = window.THREE;
  const W = pre.res[0], H = pre.res[1];
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-9999px; top:0; width:' + W + 'px; height:' + H + 'px;';
  document.body.appendChild(container);

  let map = null, moto = null;
  try {
    const first = pre.mapPts.length ? pre.mapPts[0] : { lat: 42.5, lon: 12.5 };
    const mapOpts = videoMapOptions(first.lat, first.lon);
    map = new maplibregl.Map(Object.assign({ container: container }, mapOpts));
    moto = initVideoMoto3D(THREE, W, H);
  } catch (e) {
    // Costruzione fallita a metà (WebGL non ottenibile, CDN lib assente): si
    // ripulisce ciò che è già stato creato prima di rilanciare, altrimenti
    // container/canvas/contesti restano orfani e i retry (rete instabile)
    // esaurirebbero i contesti WebGL del browser mobile.
    if (moto) { try { disposeVideoMoto3D(moto); } catch (e2) {} }
    if (map && map.remove) { try { map.remove(); } catch (e2) {} }
    if (container.parentNode) container.parentNode.removeChild(container);
    throw e;
  }

  return {
    mode: '3d', running: true, cancelled: false, canvas, ctx,
    map, container, mapReady: false, moto,
    rows: pre.rows, track: pre.track, mapPts: pre.mapPts, mapT: pre.mapT, spark: pre.spark,
    dist: pre.dist, tEnd: pre.tEnd, mult: pre.mult, speedMax: pre.speedMax,
    slow: pre.slow,
    tSim: pre.rows.length ? pre.rows[0].t : 0, lastRaf: 0,
    chunks: [], rec: null, stream: null, raf: 0, recErr: false,
    keyframes: buildCameraKeyframes(pre.mapPts),
    segLeans: videoSegLeansFor(pre.mapPts, pre.rows, pre.mapT),
    _trailIdx: -1, _trailQuant: -1,
    extremes: videoExtremesForJob(pre.rows),
    hud: hudLayout(pre.res[0], pre.res[1]),
  };
}

function initVideoRender3D(pre, fit) {
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
      // Sottofondo terra (§6.7 doc): sotto il raster, i buchi tile leggono
      // come terreno lontano invece che voragini. In satellite no: il raster
      // Esri è opaco e il fondo scuro coprirebbe l'immagine.
      if (!pre.sat) {
        try {
          map.addLayer({ id: 'video-ground', type: 'background',
            paint: { 'background-color': VIDEO3D_CONF.ground } });
        } catch (e) {}
      }
      // Satellite opzionale: raster Esri come base + liberty fill nascosti.
      if (pre.sat) { try { videoSatAddToMap(map); } catch (e) {} }
      try { videoTrackAddToMap(map, pre.mapPts, job.segLeans); } catch (e) {}
      // Rilievo ombreggiato + tinta edifici (stesso beforeId: la scia resta sopra).
      videoSceneAddToMap(map, beforeId, pre.buildings);
      job.mapReady = true;
      beginVideoCapture(job, canvas, pre.mime, fit);
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

/* Pura: piega extra del busto verso l'interno curva (18% della piega, clamp
   ±60°). Il pilota è figlio di bike, che ruota già di +lean: prima era una
   contro-piega (-30%, busto più dritto della moto), ma il pilota sportivo si
   sporge dentro la curva. pose() sposta anche bacino, ginocchio e sguardo. */
function videoRiderLean(leanDeg) {
  if (!isFinite(leanDeg)) return 0;
  const cl = Math.max(-60, Math.min(60, leanDeg));
  return (cl * Math.PI / 180) * 0.18;
}

/* Modello moto in metri reali (passo 1,43 m, ruote da 17"), scalato per
   occupare a schermo lo stesso box che l'HUD lascia libero (hudMotoBox).
   Colori della livrea: vernice, tuta, casco. */
const MOTO3D = {
  scale: 1.25,
  paint: 0xc8102e,       // rosso vernice
  paint2: 0xf3f4f6,      // bianco livrea
  dark: 0x111317,        // plastiche nere lucide
  suit: 0x1a1c20,        // pelle nera
  suit2: 0xc8102e,       // righe tuta
  suit3: 0xf1f2f4,       // spalle, gomitiere
};

/* Solido per sezioni (carrozzeria, busto, casco): superellissi lungo z,
   chiuso ai capi, indicizzato → normali lisce. st = [{z, y, a, b, b2?, n?, x?}]:
   a semilarghezza, b semialtezza sopra e b2 sotto, n esponente (2 ellisse,
   4 quasi squadrata). colorFn(x, y, z, u) → hex dipinge la livrea sui vertici. */
function moto3dLoft(THREE, st, seg, colorFn) {
  const N = seg || 28;
  const pos = [], idx = [], col = [];
  const cache = new Map();
  const pushCol = (x, y, z, u) => {
    if (!colorFn) return;
    const hex = colorFn(x, y, z, u);
    let c = cache.get(hex);
    if (!c) { c = new THREE.Color(hex); cache.set(hex, c); }
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    const u = st.length > 1 ? i / (st.length - 1) : 0;
    const e = 2 / (s.n || 2.2);
    for (let j = 0; j < N; j++) {
      const t = j / N * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const bx = s.a * Math.sign(c) * Math.pow(Math.abs(c), e);
      const hb = sn >= 0 ? s.b : (s.b2 != null ? s.b2 : s.b);
      const by = hb * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      pos.push((s.x || 0) + bx, s.y + by, s.z);
      pushCol((s.x || 0) + bx, s.y + by, s.z, u);
    }
  }
  // Facce verso l'esterno qualunque sia il verso delle stazioni (avanti→dietro o viceversa).
  const dec = st[0].z > st[st.length - 1].z;
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * N + j, b = i * N + (j + 1) % N, c = (i + 1) * N + j, d = (i + 1) * N + (j + 1) % N;
      if (dec) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (i, flip) => {
    const s = st[i], ci = pos.length / 3;
    pos.push(s.x || 0, s.y, s.z);
    pushCol(s.x || 0, s.y + s.b * 0.5, s.z, i / Math.max(1, st.length - 1));
    for (let j = 0; j < N; j++) {
      const a = i * N + j, b = i * N + (j + 1) % N;
      if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  cap(0, dec);
  cap(st.length - 1, !dec);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Pura: n stazioni lisce da poche stazioni chiave (Catmull-Rom su ogni campo). */
function moto3dStations(keys, n) {
  const out = [];
  const K = keys.length;
  const fields = ['z', 'y', 'a', 'b', 'b2', 'n', 'x'];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1) * (K - 1);
    const i = Math.min(K - 2, Math.floor(u)), t = u - i;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(K - 1, i + 2)];
    const o = {};
    for (const f of fields) {
      const v = s => (s[f] != null ? s[f] : (f === 'b2' ? s.b : (f === 'n' ? 2.2 : 0)));
      const a0 = v(p0), a1 = v(p1), a2 = v(p2), a3 = v(p3);
      const t2 = t * t, t3 = t2 * t;
      o[f] = 0.5 * ((2 * a1) + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 + (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
    }
    o.a = Math.max(0.002, o.a); o.b = Math.max(0.002, o.b); o.b2 = Math.max(0.002, o.b2);
    out.push(o);
  }
  return out;
}

function initVideoMoto3D(THREE, W, H, quality) {
  const shadows = !!(quality && quality.shadows);
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = shadows;
  if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
  if (THREE.ACESFilmicToneMapping != null) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
  renderer.domElement.style.cssText = 'position:fixed; left:-9999px; top:0;';
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
  camera.position.set(0, 3.0, 6.5);
  camera.lookAt(0, 0.55, 0);

  // Luce da esterno: cielo/terreno + sole alto alle spalle della camera.
  scene.add(new THREE.HemisphereLight(0xdbeaff, 0x5b5140, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sun.position.set(3, 8, 5);
  sun.castShadow = shadows;
  if (shadows && sun.shadow && sun.shadow.mapSize) sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.1);
  rim.position.set(-4, 3, -4);
  scene.add(rim);

  const moto = new THREE.Group();          // yaw: muso via dalla camera
  moto.rotation.y = Math.PI;
  const bike = new THREE.Group();          // roll: piega attorno alla linea di contatto
  moto.add(bike);
  const body = new THREE.Group();          // metri reali → scala video
  body.scale.set(MOTO3D.scale, MOTO3D.scale, MOTO3D.scale);
  bike.add(body);

  const P = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
  const S = THREE.MeshStandardMaterial;
  const M = {
    paint:  new P({ color: MOTO3D.paint, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 }),
    paint2: new P({ color: MOTO3D.paint2, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 }),
    gloss:  new P({ color: MOTO3D.dark, roughness: 0.25, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    matte:  new S({ color: 0x1b1d21, roughness: 0.85, metalness: 0.1 }),
    tire:   new S({ color: 0x141518, roughness: 0.78, metalness: 0.0 }),
    rim:    new S({ color: 0x15171a, roughness: 0.35, metalness: 0.6 }),
    alu:    new S({ color: 0xb4bbc3, roughness: 0.32, metalness: 1.0 }),
    steel:  new S({ color: 0xa9adb2, roughness: 0.22, metalness: 1.0 }),
    gold:   new S({ color: 0xd6a53a, roughness: 0.3, metalness: 1.0 }),
    ti:     new S({ color: 0x8e979f, roughness: 0.28, metalness: 1.0 }),
    carbon: new S({ color: 0x23262b, roughness: 0.35, metalness: 0.3 }),
    seat:   new S({ color: 0x17181b, roughness: 0.92, metalness: 0.0 }),
    screen: new S({ color: 0x1c2a33, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55 }),
    tail:   new S({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 2.2, roughness: 0.4 }),
    head:   new S({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.6, roughness: 0.2 }),
    amber:  new S({ color: 0x402000, emissive: 0xff9a1a, emissiveIntensity: 1.2, roughness: 0.4 }),
    suit:   new P({ color: MOTO3D.suit, roughness: 0.5, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    white:  new P({ color: MOTO3D.suit3, roughness: 0.45, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    // bianco × colore per vertice: livree dipinte sulla geometria (niente texture)
    paintV: new P({ color: 0xffffff, vertexColors: true, roughness: 0.28, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06 }),
    suitV:  new P({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    helmV:  new P({ color: 0xffffff, vertexColors: true, roughness: 0.22, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04 }),
    frame:  new S({ color: 0x9aa1a9, roughness: 0.38, metalness: 1.0 }),
  };

  const mesh = (geom, mat, parent, x, y, z, rx, ry, rz) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    if (shadows) m.castShadow = true;
    (parent || body).add(m);
    return m;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  // Asta tra due punti, raggio r1 in a e r2 in b (telaio, forcella, arti, raggi).
  const rod = (parent, a, b, r1, r2, mat, seg) => {
    const d = V(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, seg || 12), mat);
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    if (shadows) m.castShadow = true;
    parent.add(m);
    return m;
  };
  const ball = (parent, p, r, mat, sx, sy, sz) => {
    const m = mesh(new THREE.SphereGeometry(r, 20, 14), mat, parent, p.x, p.y, p.z);
    if (sx) m.scale.set(sx, sy || sx, sz || sx);
    return m;
  };
  // Arto: aste coniche con giunti sferici (niente spigoli ai gomiti/ginocchia).
  const limb = (parent, pts, radii, mat) => {
    for (let i = 0; i < pts.length - 1; i++) rod(parent, pts[i], pts[i + 1], radii[i], radii[i + 1], mat, 14);
    for (let i = 0; i < pts.length; i++) ball(parent, pts[i], radii[i], mat);
  };
  const loft = (keys, n, mat, parent, seg, colorFn) => mesh(moto3dLoft(THREE, moto3dStations(keys, n), seg, colorFn), mat, parent);
  const mirrorX = (fn) => { fn(1); fn(-1); };

  // ---------------- ruote ----------------
  const wheels = [];
  // Profilo pneumatico (r, y) in sezione: fianchi, spalla, battistrada tondo.
  const tireProfile = (R, halfW, rimR) => {
    const pts = [];
    const crownR = halfW * 1.25, rc = R - crownR;
    pts.push(new THREE.Vector2(rimR, -halfW * 0.78));
    pts.push(new THREE.Vector2(rimR + (R - rimR) * 0.35, -halfW * 0.98));
    for (let k = 0; k <= 16; k++) {
      const t = -1.0 + 2.0 * k / 16;           // rad
      const ang = t * 0.95;
      pts.push(new THREE.Vector2(rc + crownR * Math.cos(ang), crownR * Math.sin(ang) * 0.82));
    }
    pts.push(new THREE.Vector2(rimR + (R - rimR) * 0.35, halfW * 0.98));
    pts.push(new THREE.Vector2(rimR, halfW * 0.78));
    return pts;
  };
  function wheel(z, R, halfW, front) {
    const rimR = 0.216;
    const axle = new THREE.Group();
    axle.position.set(0, R, z);
    axle.rotation.z = Math.PI / 2;           // asse locale Y = asse ruota (X moto)
    body.add(axle);
    const spin = new THREE.Group();
    axle.add(spin);
    wheels.push(spin);
    mesh(new THREE.LatheGeometry(tireProfile(R, halfW, rimR), 56), M.tire, spin);
    // canale cerchio + bordini
    const barrel = [
      new THREE.Vector2(rimR + 0.004, -halfW * 0.8), new THREE.Vector2(rimR - 0.012, -halfW * 0.72),
      new THREE.Vector2(rimR - 0.016, 0), new THREE.Vector2(rimR - 0.012, halfW * 0.72), new THREE.Vector2(rimR + 0.004, halfW * 0.8),
    ];
    const rimMat = M.rim;
    mesh(new THREE.LatheGeometry(barrel, 48), rimMat, spin).material.side = THREE.DoubleSide;
    // filetto rosso sul bordo cerchio
    mesh(new THREE.TorusGeometry(rimR - 0.004, 0.004, 6, 48), M.paint, spin, 0, halfW * 0.62, 0, Math.PI / 2);
    mesh(new THREE.TorusGeometry(rimR - 0.004, 0.004, 6, 48), M.paint, spin, 0, -halfW * 0.62, 0, Math.PI / 2);
    // mozzo + 5 razze sdoppiate
    mesh(new THREE.CylinderGeometry(0.045, 0.045, halfW * 1.1, 20), M.rim, spin);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      for (const d of [-0.11, 0.11]) {
        const h = V(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
        const r = V(Math.cos(a + d) * (rimR - 0.012), 0, Math.sin(a + d) * (rimR - 0.012));
        rod(spin, h, r, 0.011, 0.007, rimMat, 8);
      }
    }
    // disco/i freno: anello in acciaio + razze della flangia in oro
    const discR = front ? 0.16 : 0.11;
    const discs = new THREE.Group();
    discs.userData.videoPart = 'brake-disc';
    spin.add(discs);
    const sides = front ? [-1, 1] : [-1];
    for (const s of sides) {
      const y = s * halfW * 0.72;
      mesh(new THREE.CylinderGeometry(discR, discR, 0.005, 48, 1, true), M.steel, discs, 0, y, 0).material.side = THREE.DoubleSide;
      const ring = new THREE.RingGeometry(discR * 0.74, discR, 48);
      mesh(ring, M.steel, discs, 0, y, 0, -Math.PI / 2).material.side = THREE.DoubleSide;
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2 + 0.3;
        rod(discs, V(Math.cos(a) * 0.05, y, Math.sin(a) * 0.05), V(Math.cos(a) * discR * 0.76, y, Math.sin(a) * discR * 0.76), 0.008, 0.006, M.gold, 6);
      }
      // pinza: figlia dell'asse, non gira con la ruota
      mesh(new THREE.BoxGeometry(0.05, 0.035, 0.11), M.gold, axle,
        front ? -discR * 0.82 : discR * 0.6, y + s * 0.012, front ? -discR * 0.55 : -discR * 0.8);
    }
    return spin;
  }
  const rearSpin = wheel(-0.715, 0.315, 0.095, false);
  wheel(0.715, 0.30, 0.062, true);

  // ---------------- ciclistica ----------------
  const rake = 24 * Math.PI / 180;
  const fdir = V(0, Math.cos(rake), -Math.sin(rake));
  const fAxle = V(0, 0.30, 0.715);
  const fpt = (t, x) => V(x, fAxle.y + fdir.y * t, fAxle.z + fdir.z * t);
  mirrorX(s => {
    rod(body, fpt(0.04, s * 0.095), fpt(0.36, s * 0.095), 0.024, 0.024, M.steel, 16);  // steli (USD)
    rod(body, fpt(0.30, s * 0.095), fpt(0.78, s * 0.095), 0.03, 0.03, M.gold, 16);    // foderi
    rod(body, fpt(0.30, s * 0.095), fpt(0.31, s * 0.095), 0.033, 0.033, M.gold, 16);
    mesh(new THREE.BoxGeometry(0.03, 0.08, 0.06), M.matte, body, s * 0.095, 0.30, 0.72);  // piedino
  });
  // piastre + semimanubri
  for (const t of [0.52, 0.76]) {
    const c = fpt(t, 0);
    mesh(new THREE.BoxGeometry(0.26, 0.025, 0.07), M.alu, body, 0, c.y, c.z, -rake);
  }
  mirrorX(s => {
    const c = fpt(0.70, s * 0.11);
    const end = V(s * 0.31, c.y - 0.05, c.z - 0.06);
    rod(body, c, end, 0.013, 0.013, M.alu, 10);
    rod(body, V(s * 0.23, c.y - 0.035, c.z - 0.045), V(s * 0.33, c.y - 0.055, c.z - 0.065), 0.019, 0.019, M.matte, 12); // manopola
    rod(body, V(s * 0.20, c.y - 0.01, c.z + 0.01), V(s * 0.30, c.y - 0.03, c.z + 0.05), 0.006, 0.005, M.alu, 6); // leva
  });

  // telaio a doppio trave + forcellone scatolato (sezioni squadrate, non tubi)
  mirrorX(s => {
    loft([
      { z: 0.47, y: 0.86, x: s * 0.075, a: 0.02, b: 0.045, n: 4 },
      { z: 0.30, y: 0.80, x: s * 0.165, a: 0.022, b: 0.065, n: 4 },
      { z: 0.08, y: 0.72, x: s * 0.185, a: 0.022, b: 0.075, n: 4 },
      { z: -0.08, y: 0.58, x: s * 0.165, a: 0.022, b: 0.08, n: 4 },
      { z: -0.17, y: 0.47, x: s * 0.135, a: 0.024, b: 0.06, n: 4 },
    ], 14, M.frame);
    loft([
      { z: -0.13, y: 0.445, x: s * 0.125, a: 0.022, b: 0.05, n: 4 },
      { z: -0.40, y: 0.395, x: s * 0.13, a: 0.02, b: 0.045, n: 4 },
      { z: -0.70, y: 0.322, x: s * 0.125, a: 0.017, b: 0.03, n: 4 },
      { z: -0.77, y: 0.312, x: s * 0.125, a: 0.015, b: 0.025, n: 4 },
    ], 12, M.frame);
  });
  // catena + corona (lato sinistro pilota = +x)
  rod(body, V(0.135, 0.36, -0.12), V(0.135, 0.40, -0.715), 0.006, 0.006, M.matte, 6);
  rod(body, V(0.135, 0.28, -0.12), V(0.135, 0.23, -0.715), 0.006, 0.006, M.matte, 6);
  mesh(new THREE.TorusGeometry(0.095, 0.01, 6, 36), M.alu, rearSpin, 0, 0.13, 0, Math.PI / 2);

  // motore (visibile in piega sotto la carena)
  loft([
    { z: 0.40, y: 0.50, a: 0.12, b: 0.16, n: 3.2 },
    { z: 0.22, y: 0.46, a: 0.16, b: 0.2, n: 3.2 },
    { z: -0.02, y: 0.42, a: 0.15, b: 0.16, n: 3.2 },
    { z: -0.12, y: 0.44, a: 0.12, b: 0.1, n: 3 },
  ], 10, M.carbon);

  // scarico laterale (destra pilota = -x): collettore + silenziatore esagonale
  rod(body, V(-0.05, 0.28, 0.30), V(-0.12, 0.27, -0.05), 0.028, 0.028, M.ti, 12);
  rod(body, V(-0.12, 0.27, -0.05), V(-0.16, 0.36, -0.28), 0.03, 0.03, M.ti, 12);
  const can = new THREE.Group();
  can.position.set(-0.19, 0.44, -0.44);
  can.rotation.x = -0.32;
  body.add(can);
  loft([
    { z: 0.20, y: 0, a: 0.045, b: 0.05, n: 3.5 },
    { z: 0.14, y: 0, a: 0.06, b: 0.07, n: 3.5 },
    { z: -0.12, y: 0, a: 0.062, b: 0.072, n: 3.5 },
    { z: -0.18, y: 0, a: 0.055, b: 0.064, n: 3.5 },
  ], 10, M.ti, can, 24);
  mesh(new THREE.CylinderGeometry(0.056, 0.05, 0.04, 24), M.carbon, can, 0, 0, -0.2, Math.PI / 2);
  mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 16), M.matte, can, 0, 0, -0.215, Math.PI / 2);

  // ---------------- carrozzeria ----------------
  // serbatoio
  loft([
    { z: 0.40, y: 0.90, a: 0.10, b: 0.07, b2: 0.08, n: 2.6 },
    { z: 0.30, y: 0.94, a: 0.17, b: 0.10, b2: 0.10, n: 2.8 },
    { z: 0.14, y: 0.955, a: 0.19, b: 0.10, b2: 0.12, n: 2.8 },
    { z: 0.00, y: 0.925, a: 0.165, b: 0.085, b2: 0.12, n: 2.8 },
    { z: -0.10, y: 0.88, a: 0.13, b: 0.05, b2: 0.09, n: 2.6 },
  ], 16, M.paint);
  // codino: fianchetti fino al telaio, punta rialzata, striscia bianca centrale
  const tailCol = (x, y, z) => (Math.abs(x) < 0.035 && y > 0.83 && z < -0.34) ? MOTO3D.paint2 : MOTO3D.paint;
  loft([
    { z: -0.06, y: 0.745, a: 0.145, b: 0.08, b2: 0.09, n: 3.6 },
    { z: -0.30, y: 0.785, a: 0.15, b: 0.08, b2: 0.10, n: 3.8 },
    { z: -0.50, y: 0.84, a: 0.125, b: 0.07, b2: 0.09, n: 3.6 },
    { z: -0.68, y: 0.90, a: 0.085, b: 0.05, b2: 0.06, n: 3.2 },
    { z: -0.82, y: 0.95, a: 0.045, b: 0.025, b2: 0.03, n: 2.8 },
    { z: -0.88, y: 0.965, a: 0.015, b: 0.008, b2: 0.01, n: 2.4 },
  ], 24, M.paintV, body, 40, tailCol);
  // sella pilota sopra il codino
  loft([
    { z: -0.02, y: 0.845, a: 0.09, b: 0.02, b2: 0.03, n: 3 },
    { z: -0.14, y: 0.858, a: 0.135, b: 0.035, b2: 0.04, n: 3.6 },
    { z: -0.30, y: 0.88, a: 0.13, b: 0.035, b2: 0.04, n: 3.6 },
    { z: -0.40, y: 0.90, a: 0.10, b: 0.02, b2: 0.03, n: 3 },
  ], 12, M.seat);
  // sottocoda nero
  loft([
    { z: -0.28, y: 0.665, a: 0.11, b: 0.02, n: 3 },
    { z: -0.55, y: 0.725, a: 0.10, b: 0.025, n: 3 },
    { z: -0.78, y: 0.84, a: 0.045, b: 0.02, n: 2.6 },
  ], 10, M.gloss);
  // LED posteriori: due lame lungo i bordi della punta, visibili da dietro
  mirrorX(s => rod(body, V(s * 0.012, 0.95, -0.87), V(s * 0.075, 0.885, -0.72), 0.008, 0.008, M.tail, 8));
  loft([
    { z: -0.845, y: 0.925, a: 0.045, b: 0.012, n: 3 },
    { z: -0.865, y: 0.93, a: 0.035, b: 0.01, n: 3 },
  ], 4, M.tail);
  // portatarga + frecce
  mesh(new THREE.BoxGeometry(0.05, 0.008, 0.28), M.gloss, body, 0, 0.72, -0.76, 0.55);
  mesh(new THREE.BoxGeometry(0.16, 0.10, 0.008), M.matte, body, 0, 0.60, -0.88, -0.25);
  mirrorX(s => mesh(new THREE.BoxGeometry(0.035, 0.018, 0.018), M.amber, body, s * 0.09, 0.66, -0.86));
  // parafango posteriore (hugger)
  loft([
    { z: -0.50, y: 0.64, a: 0.08, b: 0.02, n: 2.4 },
    { z: -0.70, y: 0.66, a: 0.09, b: 0.02, n: 2.4 },
    { z: -0.88, y: 0.58, a: 0.07, b: 0.015, n: 2.4 },
  ], 10, M.gloss);

  // carena: cupolino a becco (in alto) + fianchi squadrati sul motore con
  // taglio diagonale rosso/bianco
  loft([
    { z: 1.00, y: 0.82, a: 0.02, b: 0.015, b2: 0.02, n: 2.2 },
    { z: 0.92, y: 0.845, a: 0.09, b: 0.05, b2: 0.06, n: 2.6 },
    { z: 0.80, y: 0.87, a: 0.15, b: 0.08, b2: 0.10, n: 3.0 },
    { z: 0.64, y: 0.86, a: 0.19, b: 0.09, b2: 0.14, n: 3.2 },
    { z: 0.50, y: 0.82, a: 0.21, b: 0.07, b2: 0.14, n: 3.4 },
    { z: 0.40, y: 0.78, a: 0.19, b: 0.04, b2: 0.10, n: 3.2 },
  ], 22, M.paint, body, 36);
  loft([
    { z: 0.64, y: 0.67, a: 0.17, b: 0.11, b2: 0.10, n: 3.4 },
    { z: 0.50, y: 0.58, a: 0.225, b: 0.20, b2: 0.24, n: 3.8 },
    { z: 0.30, y: 0.52, a: 0.235, b: 0.21, b2: 0.23, n: 4.0 },
    { z: 0.10, y: 0.50, a: 0.21, b: 0.17, b2: 0.19, n: 4.0 },
    { z: -0.06, y: 0.51, a: 0.16, b: 0.10, b2: 0.12, n: 3.6 },
    { z: -0.13, y: 0.53, a: 0.08, b: 0.04, b2: 0.05, n: 3.0 },
  ], 40, M.paintV, body, 64, (x, y, z) => (y < 0.40 + 0.35 * (z - 0.1) ? MOTO3D.paint2 : MOTO3D.paint));
  // puntale nero
  loft([
    { z: 0.36, y: 0.28, a: 0.16, b: 0.05, b2: 0.04, n: 3.0 },
    { z: 0.10, y: 0.24, a: 0.15, b: 0.05, b2: 0.035, n: 3.0 },
    { z: -0.08, y: 0.28, a: 0.10, b: 0.04, b2: 0.03, n: 2.8 },
  ], 12, M.gloss);
  // cupolino fumé
  loft([
    { z: 0.78, y: 0.93, a: 0.11, b: 0.015, n: 2.2 },
    { z: 0.68, y: 0.99, a: 0.15, b: 0.03, n: 2.4 },
    { z: 0.58, y: 1.03, a: 0.15, b: 0.028, n: 2.4 },
    { z: 0.50, y: 1.04, a: 0.12, b: 0.012, n: 2.2 },
  ], 12, M.screen, body, 28);
  // fari
  mirrorX(s => loft([
    { z: 0.94, y: 0.83, a: 0.02, b: 0.008, x: s * 0.05, n: 2.2 },
    { z: 0.84, y: 0.86, a: 0.035, b: 0.012, x: s * 0.13, n: 2.2 },
    { z: 0.78, y: 0.87, a: 0.02, b: 0.008, x: s * 0.17, n: 2.2 },
  ], 8, M.head));
  // specchietti
  mirrorX(s => {
    rod(body, V(s * 0.20, 0.93, 0.62), V(s * 0.28, 1.0, 0.58), 0.008, 0.008, M.gloss, 6);
    loft([
      { z: 0.64, y: 1.0, a: 0.03, b: 0.02, x: s * 0.30, n: 2.4 },
      { z: 0.58, y: 1.0, a: 0.07, b: 0.032, x: s * 0.30, n: 2.8 },
      { z: 0.54, y: 1.0, a: 0.06, b: 0.028, x: s * 0.30, n: 2.8 },
    ], 8, M.paint);
  });
  // parafango anteriore
  loft([
    { z: 0.94, y: 0.56, a: 0.05, b: 0.012, n: 2.4 },
    { z: 0.80, y: 0.62, a: 0.075, b: 0.02, n: 2.4 },
    { z: 0.62, y: 0.60, a: 0.07, b: 0.02, n: 2.4 },
    { z: 0.52, y: 0.52, a: 0.05, b: 0.012, n: 2.4 },
  ], 10, M.paint);
  // pedane
  mirrorX(s => {
    rod(body, V(s * 0.12, 0.42, -0.20), V(s * 0.22, 0.41, -0.22), 0.011, 0.009, M.alu, 8);
    mesh(new THREE.BoxGeometry(0.01, 0.07, 0.10), M.alu, body, s * 0.13, 0.44, -0.24);
  });
  // cavalletto laterale ripiegato sotto il telaio
  const stand = rod(body, V(0.11, 0.33, -0.10), V(0.12, 0.30, -0.32), 0.011, 0.009, M.matte, 8);
  stand.userData.videoPart = 'stand';

  // ---------------- pilota ----------------
  const rider = new THREE.Group();
  rider.position.set(0, 0.87, -0.20);       // perno: bacino sulla sella
  rider.userData.videoPart = 'rider';
  body.add(rider);
  const R = (x, y, z) => V(x, y - 0.87, z + 0.20);   // coordinate moto → locali pilota
  // busto: loft lungo la colonna (z locale), y locale = schiena
  const torso = new THREE.Group();
  torso.position.copy(R(0, 0.90, -0.21));
  torso.rotation.x = -(Math.PI / 2 - 38 * Math.PI / 180);
  rider.add(torso);
  const suitCol = (x, y, z) => {
    const ax = Math.abs(x);
    if (z > 0.34 && ax > 0.1) return MOTO3D.suit3;                           // spalle
    if (z > 0.3 && ax > 0.075 && y > 0) return MOTO3D.suit2;                 // bordo rosso delle spalle
    if (y > 0.03 && ax < 0.022 && z > 0.04 && z < 0.5) return MOTO3D.suit2;  // riga sulla colonna
    if (ax > 0.125 && z > 0.1 && z < 0.28) return MOTO3D.suit2;              // fianchi
    return MOTO3D.suit;
  };
  loft([
    { z: -0.03, y: 0, a: 0.15, b: 0.10, n: 2.4 },
    { z: 0.10, y: 0.005, a: 0.165, b: 0.105, n: 2.5 },
    { z: 0.24, y: 0.012, a: 0.16, b: 0.10, n: 2.5 },
    { z: 0.37, y: 0.02, a: 0.20, b: 0.11, n: 2.7 },
    { z: 0.47, y: 0.02, a: 0.215, b: 0.10, n: 2.7 },
    { z: 0.55, y: 0.01, a: 0.10, b: 0.065, n: 2.2 },
  ], 26, M.suitV, torso, 56, suitCol);
  // gobba aerodinamica bassa tra le spalle (non copre il casco)
  const hump = loft([
    { z: 0.30, y: 0.085, a: 0.03, b: 0.012, n: 2.2 },
    { z: 0.40, y: 0.095, a: 0.08, b: 0.03, n: 2.4 },
    { z: 0.49, y: 0.09, a: 0.07, b: 0.026, n: 2.4 },
    { z: 0.54, y: 0.07, a: 0.03, b: 0.012, n: 2.2 },
  ], 12, M.suitV, torso, 32, x => (Math.abs(x) < 0.022 ? MOTO3D.suit2 : MOTO3D.suit));
  hump.userData.videoPart = 'backpack';
  // casco: guscio bianco, visiera scura, striscia rossa dalla fronte alla nuca
  const helmet = new THREE.Group();
  helmet.position.copy(R(0, 1.325, 0.235));
  helmet.rotation.x = 0.22;
  rider.add(helmet);
  const helmCol = (x, y, z) => {
    if (z > 0.05 && y > -0.04 && y < 0.05 && Math.abs(x) < 0.118) return 0x0b0d10;   // visiera
    if (Math.abs(x) < 0.03 && y > 0.0) return MOTO3D.paint;                          // striscia
    if (Math.abs(x) < 0.048 && y > 0.02) return 0x111317;                             // filetti
    if (y < -0.075) return 0x111317;                                                   // bordo
    return 0xf4f5f7;
  };
  loft([
    { z: 0.16, y: -0.03, a: 0.04, b: 0.03, b2: 0.05, n: 2.4 },
    { z: 0.13, y: -0.01, a: 0.105, b: 0.09, b2: 0.12, n: 2.4 },
    { z: 0.07, y: 0.005, a: 0.13, b: 0.125, b2: 0.13, n: 2.3 },
    { z: -0.03, y: 0.01, a: 0.135, b: 0.13, b2: 0.12, n: 2.2 },
    { z: -0.11, y: 0.0, a: 0.115, b: 0.105, b2: 0.095, n: 2.2 },
    { z: -0.16, y: -0.01, a: 0.05, b: 0.05, b2: 0.04, n: 2.2 },
  ], 18, M.helmV, helmet, 40, helmCol);
  loft([   // spoiler
    { z: -0.07, y: 0.115, a: 0.02, b: 0.008, n: 2.2 },
    { z: -0.13, y: 0.10, a: 0.075, b: 0.014, n: 2.6 },
    { z: -0.17, y: 0.075, a: 0.06, b: 0.008, n: 2.2 },
  ], 8, M.gloss, helmet);
  // braccia: spalla → gomito → mano sulla manopola
  mirrorX(s => {
    const arm = new THREE.Group();
    arm.userData.videoPart = 'rider-arm';
    rider.add(arm);
    limb(arm, [R(s * 0.18, 1.16, 0.13), R(s * 0.27, 1.02, 0.26), R(s * 0.28, 0.92, 0.41)], [0.056, 0.046, 0.04], M.suit);
    ball(arm, R(s * 0.285, 0.915, 0.43), 0.042, M.matte, 1.0, 0.85, 1.2);                   // guanto
    rod(arm, R(s * 0.262, 1.034, 0.24), R(s * 0.276, 1.0, 0.285), 0.052, 0.05, M.white, 12); // gomitiera
  });
  // gambe: anca → ginocchio (fuori) → caviglia → stivale sulla pedana
  const legs = {};
  mirrorX(s => {
    // Perno all'anca; il ginocchio ruota attorno all'asse anca→caviglia, così
    // in piega esce verso l'asfalto e il piede resta sulla pedana.
    const hip = R(s * 0.11, 0.89, -0.18), ankle = R(s * 0.18, 0.47, -0.15);
    const leg = new THREE.Group();
    leg.position.copy(hip);
    leg.userData.videoPart = 'rider-leg';
    leg.userData.axis = V(ankle.x - hip.x, ankle.y - hip.y, ankle.z - hip.z).normalize();
    rider.add(leg);
    legs[s] = leg;
    const L = (x, y, z) => { const q = R(x, y, z); return V(q.x - hip.x, q.y - hip.y, q.z - hip.z); };
    limb(leg, [L(s * 0.11, 0.89, -0.18), L(s * 0.22, 0.76, 0.09), L(s * 0.18, 0.47, -0.15)], [0.08, 0.06, 0.045], M.suit);
    ball(leg, L(s * 0.245, 0.765, 0.10), 0.032, M.paint2, 0.6, 1.0, 1.0);                  // saponetta
    rod(leg, L(s * 0.2, 0.70, 0.03), L(s * 0.19, 0.58, -0.07), 0.058, 0.052, M.gloss, 12);  // parastinchi
    loft([
      { z: -0.20, y: 0.46, a: 0.045, b: 0.06, x: s * 0.18, n: 2.6 },
      { z: -0.12, y: 0.425, a: 0.045, b: 0.04, x: s * 0.185, n: 2.8 },
      { z: -0.05, y: 0.41, a: 0.035, b: 0.025, x: s * 0.19, n: 2.6 },
    ].map(p => { const q = L(p.x, p.y, p.z); return Object.assign({}, p, { x: q.x, y: q.y, z: q.z }); }), 8, M.matte, leg); // stivale
  });

  scene.add(moto);
  if (shadows && THREE.PlaneGeometry && THREE.ShadowMaterial) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.3 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // IBL: cielo, orizzonte chiaro, sole, terreno caldo (riflessi su vernice e metalli).
  let envTex = null, shadowTex = null;
  if (THREE.PMREMGenerator && THREE.CanvasTexture && THREE.EquirectangularReflectionMapping) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext && c.getContext('2d');
    if (g) {
      const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, '#5f8fc9');
      grd.addColorStop(0.42, '#cfe2f3');
      grd.addColorStop(0.5, '#f4f1ea');
      grd.addColorStop(0.53, '#8a8468');
      grd.addColorStop(1, '#3a3a2c');
      g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
      const sunG = g.createRadialGradient(150, 50, 2, 150, 50, 40);
      sunG.addColorStop(0, 'rgba(255,255,255,1)');
      sunG.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sunG; g.fillRect(100, 0, 100, 100);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(300, 60, 140, 14);
      const tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromEquirectangular(tex);
      scene.environment = rt.texture;
      tex.dispose(); pmrem.dispose();
      envTex = rt;
    }
  }

  // Ombra di contatto allungata sotto la moto; pose() la sposta verso
  // l'interno curva quando la moto piega.
  let shadow = null;
  if (THREE.CanvasTexture && THREE.MeshBasicMaterial && THREE.PlaneGeometry) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext && c.getContext('2d');
    if (g) {
      const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grd.addColorStop(0, 'rgba(0,0,0,0.62)');
      grd.addColorStop(0.5, 'rgba(0,0,0,0.3)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
      shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 2.9), mat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.005;
      shadow.renderOrder = -1;
      shadow.userData.videoPart = 'contact-shadow';
      moto.add(shadow);
      shadowTex = tex;
    }
  }
  const pose = (leanDeg) => {
    const l = Math.max(-60, Math.min(60, isFinite(leanDeg) ? leanDeg : 0)) * Math.PI / 180;
    if (shadow) {
      // baricentro (~0.75 m) proiettato a terra lungo la piega
      shadow.position.x = -Math.sin(l) * 0.75 * MOTO3D.scale;
      shadow.scale.x = 1 + 1.1 * Math.abs(Math.sin(l));
    }
    // hang-off: bacino verso l'interno curva, ginocchio interno fuori, sguardo in curva
    rider.position.x = -Math.sin(l) * 0.10;
    const inside = l > 0 ? -1 : 1;                 // piega a destra: lato destro pilota (-x)
    for (const s of [-1, 1]) {
      const leg = legs[s];
      const ang = s === inside ? Math.min(1, Math.abs(l) / 0.7) * 0.75 : 0;
      leg.quaternion.setFromAxisAngle(leg.userData.axis, ang * (s > 0 ? -1 : 1));
    }
    helmet.rotation.y = -l * 0.35;
  };
  pose(0);

  const disposables = new Set();
  scene.traverse(o => {
    if (o.geometry) disposables.add(o.geometry);
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => disposables.add(m));
  });
  Object.values(M).forEach(m => disposables.add(m));
  if (envTex) disposables.add(envTex);
  if (shadowTex) disposables.add(shadowTex);
  return { renderer, scene, camera, bike, wheels, rider, shadows, pose, _disposables: [...disposables] };
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
  // Altezze vere (vedi MAPLIBRE_MPP_Z0): 45 m fermo → 130 m veloce; la piega
  // abbassa fino a 7,5 m (prospettiva radente).
  return 45 + t * 85 - (lean / 60) * 7.5;
}

/* Pura: camera mappa dinamica. Veloce → zoom out (più strada visibile),
   lento → zoom in (dettaglio curve). Piega alta → pitch più radente.
   vert 9:16 → +CAM_ZOOM_VERT_BOOST zoom (a parità di zoom la striscia visibile è
   stretta, la strada sparisce ai bordi; falsy = comportamento storico invariato).
   Con lat/H noti lo zoom viene dall'altezza vera (niente tentativi, §6.5);
   senza (chiamanti vecchi/test) cade sulla curva storica. */
const CAM_PITCH_BASE = 55;      // pitch a piega zero (dritto)
const CAM_PITCH_LEAN_SPAN = 17; // 55 (dritto) → 72 (piega max)
const CAM_ZOOM_BASE = 16.5;     // zoom a 0 km/h (curva storica)
const CAM_ZOOM_SPEED_DROP = 2.0;// decremento zoom a piena velocità
const CAM_ZOOM_VERT_BOOST = 0.75;// zoom extra per 9:16 (striscia visibile stretta)
function videoCameraFor(speedKmh, leanDeg, vert, latDeg, viewportHPx) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  const lean = isFinite(leanDeg) ? Math.min(60, Math.abs(leanDeg)) : 0;
  const t = Math.max(0, Math.min(1, v / 120)); // 0 km/h → 0, 120+ → 1
  const pitch = CAM_PITCH_BASE + (lean / 60) * CAM_PITCH_LEAN_SPAN;
  let zoom = CAM_ZOOM_BASE - t * CAM_ZOOM_SPEED_DROP + (vert ? CAM_ZOOM_VERT_BOOST : 0); // curva storica
  if (isFinite(latDeg) && isFinite(viewportHPx)) {
    const z = videoZoomForHeight(videoCamAltFor(v, lean), pitch, latDeg, viewportHPx);
    if (isFinite(z)) zoom = z + (vert ? CAM_ZOOM_VERT_BOOST : 0);
  }
  return { zoom, pitch };
}

function drawVideoFrame3D(job, dt) {
  const { map, moto, rows, mapPts, keyframes, tSim } = job;
  const W = job.canvas.width, H = job.canvas.height;
  const i = Math.max(0, findRowAt(rows, tSim));
  const r = rows[i] || {};

  // Camera mappa: scorre continua sul tracciato (niente scatti a 1 Hz),
  // guarda ~2 s avanti sul percorso, zoom/pitch smorzati (niente pompaggio GPS).
  const u = videoMapPosForRow(job, i, keyframes.length);
  const p = videoPathSampleAt(keyframes, u);
  if (p && job.mapReady) {
    // Altezza vera da lat/viewport (§6.5) + padding top (§6.6: punto in quota
    // si proietta alto con terrain, la moto finirebbe sotto l'HUD).
    const cam = videoCameraFor(r.speedKmh || 0, r.lean || 0, W < H, p.lat, H);
    const dtSim = (dt == null ? 1 / 30 : Math.max(0, dt)) * (job.mult || 1);
    // ~2 s più avanti sul percorso: per tempo quando c'è mapT (da fermi la
    // camera non deve guardare avanti come se si andasse), altrimenti come prima.
    const uAhead = (job.mapT && job.mapT.length === keyframes.length && isFinite(r.t))
      ? videoMapPosAtTime(job.mapT, r.t + 2)
      : u + 2 * keyframes.length / Math.max(1, job.tEnd - (rows[0] ? rows[0].t : 0));
    const ahead = videoPathSampleAt(keyframes, Math.min(keyframes.length - 1, uAhead));
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
    videoTrackAdvance(map, job, Math.round(videoMapPosForRow(job, i, mapPts.length)));
  }

  // Moto: piega + rotolamento ruote (dt reale, non per-frame).
  // Clamp a ±60° come gli altri consumatori (videoRiderLean, pose): oltre, il
  // busto è saturato e il rider appare "incollato" alla moto.
  const leanRad = Math.max(-60, Math.min(60, r.lean || 0)) * Math.PI / 180;
  // Il gruppo padre ha rotation.y = PI (muso via dalla camera), che gia' ribalta
  // l'asse di rollio: il meno qui lo ribaltava una seconda volta e la moto si
  // coricava all'esterno della curva, contro l'ago dell'HUD. Con +leanRad la
  // piega positiva (destra) porta il top a destra schermo, vista da dietro.
  moto.bike.rotation.z = leanRad;
  if (moto.rider) moto.rider.rotation.z = videoRiderLean(r.lean || 0);
  if (moto.pose) moto.pose(r.lean || 0);   // hang-off, ginocchio, sguardo, ombra
  const spin = videoWheelSpin(r.speedKmh || 0, dt == null ? 1 / 30 : dt);
  for (const w of moto.wheels) w.rotation.y += spin;

  videoCompose3D(job, r, i);
}

/* Composizione: mappa + moto + HUD sul canvas master. Separata dalla posa
   (camera smorzata, ruote) perché il loop offline la ripete dopo aver
   aspettato le tile, senza far avanzare di nuovo camera e ruote. */
function videoCompose3D(job, r, i) {
  const { ctx, map, moto, dist, speedMax, tSim } = job;
  const W = job.canvas.width, H = job.canvas.height;
  moto.renderer.render(moto.scene, moto.camera);
  ctx.clearRect(0, 0, W, H);
  const mc = map.getCanvas();
  if (mc) ctx.drawImage(mc, 0, 0, W, H);
  ctx.drawImage(moto.renderer.domElement, 0, 0, W, H);
  drawVideoHUD3D(ctx, job, r, tSim, dist[i] || 0, speedMax);
}

/* Ricompone il frame corrente (stessa posa) con la mappa appena ridisegnata.
   Dopo un annulla cleanupVideoJob ha già tolto moto e mappa: niente da fare. */
function videoRecompose3D(job) {
  if (!job || job.cancelled || !job.moto || !job.map) return;
  const i = Math.max(0, findRowAt(job.rows, job.tSim));
  videoCompose3D(job, job.rows[i] || {}, i);
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
  // measureText cachata per stringa (prima 1/frame: dominante con 3 pannelli).
  const tr = fmtDur(tSim) + ' · ' + (isFinite(distKm) ? distKm.toFixed(2) : '0.00') + ' km';
  ctx.textAlign = 'right';
  ctx.font = hudFont('bold', 22 * s);
  const twCache = job._twCache || (job._twCache = {});
  let tw = twCache[tr];
  if (tw == null) {
    tw = ctx.measureText ? ctx.measureText(tr).width : 200 * s;
    if (Object.keys(twCache).length > 60) job._twCache = {};
    job._twCache[tr] = tw;
  }
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
  // Stessa cache del box tempo (Vmax cambia solo al superamento record).
  const twCache2 = job._twCache || (job._twCache = {});
  let bw = twCache2[br];
  if (bw == null) {
    bw = ctx.measureText ? ctx.measureText(br).width : 260 * s;
    if (Object.keys(twCache2).length > 60) job._twCache = {};
    job._twCache[br] = bw;
  }
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
