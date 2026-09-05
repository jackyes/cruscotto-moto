'use strict';
/* js/cam-map.js (step 22): track point, helpers camere, CAM_HOSTS, render mappa camere, import. fetch/check in js/cams.js. Ordine: dopo js/sensor-src.js. */
function appendTrackPoint(lat, lon, alt) {
  const now = performance.now();
  if (now - lastTrackT < 1000) return;
  lastTrackT = now;
  state.track.push({ lat, lon, alt: alt || 0, t: now, ts: Date.now() });
  if (state.track.length > TRACK_MAX) state.track.splice(0, state.track.length - TRACK_MAX);
  updateMap();
}

function allCameras() { return state.cameras.concat(state.importedCameras || []); }


function camMarkerRadius() { return state.camRadius * CAM_MARKER_FACTOR; }


function camMoveThreshold() { return state.camRadius * CAM_MOVE_FACTOR; }


function rebuildCamGrid() {
  const g = new Map();
  for (const c of allCameras()) {
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
    if (!isFinite(c.lat) || !isFinite(c.lon)) continue;
    camPrecompute(c);
    const k = cellKey(c.lat, c.lon);
    let a = g.get(k);
    if (!a) { a = []; g.set(k, a); }
    a.push(c);
  }
  state.camGrid = g;
}

function camsNear(lat, lon, radiusM) {
  if (!state.camGrid) rebuildCamGrid();
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(0.15, Math.cos(lat * Math.PI / 180)));
  const y0 = Math.floor((lat - dLat) / CAM_GRID_DEG), y1 = Math.floor((lat + dLat) / CAM_GRID_DEG);
  const x0 = Math.floor((lon - dLon) / CAM_GRID_DEG), x1 = Math.floor((lon + dLon) / CAM_GRID_DEG);
  const out = [];
  const la0 = lat - dLat, la1 = lat + dLat, lo0 = lon - dLon, lo1 = lon + dLon;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = state.camGrid.get(y + ':' + x);
      if (!a) continue;
      for (const c of a) {
        // pre-filtro bbox: evita haversine/allocazioni per i punti ai bordi cella
        if (c.lat < la0 || c.lat > la1 || c.lon < lo0 || c.lon > lo1) continue;
        out.push(c);
      }
    }
  }
  return out;
}

function loadCachedCameras() {
  const c = store.get('cruscotto.cameras', null);
  if (c && c.cameras && c.cameras.length) {
    state.cameras = c.cameras;
    state.camCenter = c.center;
    /* Una cache presa a raggio minore e' un sottoinsieme di quello richiesto ora: i punti
       si mostrano comunque (meglio di niente all'avvio offline) ma con ts a 0, cosi' il
       primo fix riscarica invece di credere di avere gia' tutto. */
    state.camTs = (c.r && c.r >= state.camRadius) ? (c.ts || 0) : 0;
    rebuildCamGrid();
    renderCameras();
  }
}

const CAM_HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/* js/net-base.js: TimeoutError, OfflineError, fetchWithTimeout */
/* js/cams.js: fetchCameras */

/* js/cams.js: maybeLoadCameras */

/* js/parse.js: camLabel */

/* Cosa disegnare: mai piu' di CAM_MARKER_MAX marker. Il tetto vive qui e NON dentro
   camsNear(), che serve anche a checkCameras(): un avviso perso per colpa di un limite
   di disegno sarebbe il bug peggiore introducibile in quest'app. */
/* js/cams.js: camsToDraw */

function renderCameras() {
  if (state.mapType === 'leaflet' && state.map) {
    if (!state.camLayer) state.camLayer = L.layerGroup().addTo(state.map);
    state.camLayer.clearLayers();
    const list = camsToDraw();
    for (const c of list) {
      const m = L.circleMarker([c.lat, c.lon], { radius: 7, color: '#f87171', fillColor: '#f87171', fillOpacity: 0.9, weight: 2 });
      const lbl = camLabel(c);
      if (lbl) {
        const span = document.createElement('span');
        span.textContent = lbl;
        m.bindTooltip(span);
      }
      m.addTo(state.camLayer);
    }
  }
  if (state.mapType === 'canvas') drawCanvasMap();
}

function trackUpHeading() {
  // Sotto ~11 km/h l'heading GPS è rumore puro e faceva girare la mappa su sé stessa.
  const h = state.gps.heading;
  if (h != null && !isNaN(h) && state.speedMs >= HEADING_MIN_MS) return h;
  if (state.compass != null) return (state.compass + state.compassOffset + 360) % 360;
  if (h != null && !isNaN(h)) return h;
  return null;
}
function setFollow(on) {
  state.follow = on;
  els.btnFollow.classList.toggle('on', on);
  if (on) centerMap(); // recentra subito all'attivazione
}

/* Track-up senza plugin: leaflet-rotate non è caricato, quindi map.setBearing()
   e map.resetNorth() non esistono e lanciavano TypeError a ogni aggiornamento.
   Si ruota il container via CSS (riquadro sovradimensionato per coprire gli angoli). */
function applyMapRotation() {
  if (!els.mapBox) return;
  const on = state.trackUp && state.mapType === 'leaflet';
  els.mapBox.classList.toggle('rot', on);
  const mapEl = els.map;
  if (!on) { mapEl.style.transform = ''; return; }
  const h = trackUpHeading();
  if (h == null) return;
  mapEl.style.transform = 'rotate(' + (-h).toFixed(1) + 'deg)';
}
function setTrackUp(on) {
  state.trackUp = on;
  els.btnTrackUp.classList.toggle('on', on);
  if (state.mapType === 'leaflet' && state.map) {
    applyMapRotation();
    setTimeout(() => state.map.invalidateSize(), 60);
  } else if (state.mapType === 'canvas') {
    drawCanvasMap();
  }
}
function centerMap() {
  if (state.gps.lat == null) return;
  if (state.mapType === 'leaflet' && state.map) {
    // Prima del primo fitBounds lo zoom è 5 (vista Italia): panTo lasciava l'utente lì.
    const z = state.map.getZoom();
    if (z == null || z < 14) state.map.setView([state.gps.lat, state.gps.lon], 16);
    else state.map.panTo([state.gps.lat, state.gps.lon]);
  } else if (state.mapType === 'canvas') {
    state.centerPending = true; // centra una tantum, indipendente dal follow
    drawCanvasMap();
    state.centerPending = false;
  }
}

/* js/cams.js: checkCameras */

/* Il cooldown cresceva senza limite lungo un viaggio: si tiene solo ciò che è vivo. */
function pruneCamCooldown(now) {
  for (const k in state.camCooldown) {
    if (now - state.camCooldown[k] > CAM_COOLDOWN_MS * 4) delete state.camCooldown[k];
  }
}

let camAlertTimer = null;
function alertCamera(dist, cam) {
  // Nessun innerHTML: maxspeed/name arrivano da OSM o da un file importato.
  els.camAlert.textContent = '';
  const main = document.createTextNode('⚠ AUTOVELOX' + (cam.maxspeed ? ' · ' + String(cam.maxspeed) : '') + ' ');
  const sub = document.createElement('span');
  sub.style.opacity = '.85';
  sub.textContent = '~' + Math.round(dist) + ' m';
  els.camAlert.appendChild(main);
  els.camAlert.appendChild(sub);
  els.camAlert.style.display = 'block';
  clearTimeout(camAlertTimer);
  camAlertTimer = setTimeout(() => { els.camAlert.style.display = 'none'; }, 4000);
  beep();
}

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep() {
  if (!state.camAlerts) return;
  ensureAudio();
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  [0, 0.18].forEach(off => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + off);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + off + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.12);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0 + off); o.stop(t0 + off + 0.13);
  });
}
document.addEventListener('pointerdown', ensureAudio, { once: true });

/* js/parse.js: parseCamerasFile */

function importCamerasFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const cams = parseCamerasFile(reader.result)
      .filter(c => isFinite(c.lat) && isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180);
    if (!cams.length) { toast('Nessuna camera trovata nel file.', 'err'); return; }
    state.importedCameras = cams;
    /* Un DB nazionale pesa ~1,5 MB: in localStorage rubava quota al log della
       sessione, che poi falliva in silenzio. Va su IndexedDB. */
    try {
      await idb.kvPut('importedCameras', cams);
      store.del('cruscotto.importedCameras');
    } catch (e) {
      toast('Camere caricate ma non salvate (spazio esaurito).', 'err', 5000);
    }
    rebuildCamGrid();
    renderCameras();
    toast('Importate ' + cams.length + ' camere.', 'ok');
  };
  reader.onerror = () => toast('Errore lettura file.', 'err');
  reader.readAsText(file);
}
