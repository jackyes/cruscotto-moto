'use strict';
/* js/video3d.js (step 25): render video 3D (loader three.js, fallback, start/init, keyframes, moto procedurale, drawVideoFrame3D/HUD3D). Ordine: dopo js/log-session.js. */
/* Config video 3D: URL pinnati + SRI, timeouts, camera, terreno.
   Versioni allineate al loader mappa (maplibre 4.7.1) e three 0.149.0. */
const VIDEO3D_CONF = {
  libs: [
    { global: 'maplibregl', url: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', integrity: 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj' },
    { global: 'THREE', url: 'https://unpkg.com/three@0.149.0/build/three.min.js', integrity: 'sha384-RRHfJ6w1mTlKUBMYT/hvnRiOzEB/vyRV3DrQOseb6oYfvaZSfdd0byS4bHps0k2R' },
  ],
  css: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  demTiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  demEncoding: 'terrarium',
  timeouts: { cdnMs: 12000, styleMs: 15000 },
  camera: { zoom: 15.5, pitch: 60 },
};

function loadVideo3DScript(url, onload, onerror, integrity) {
  const sc = document.createElement('script');
  sc.src = url; sc.crossOrigin = 'anonymous';
  if (integrity) sc.integrity = integrity;
  sc.onload = onload; sc.onerror = onerror;
  document.head.appendChild(sc);
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

function initVideoRender3D(pre) {
  const maplibregl = window.maplibregl, THREE = window.THREE;
  const W = pre.res[0], H = pre.res[1];
  els.videoStatus.textContent = 'Preparo mappa 3D…';

  // Canvas mappa WebGL con preserveDrawingBuffer (per drawImage nel master canvas).
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-9999px; top:0; width:' + W + 'px; height:' + H + 'px;';
  document.body.appendChild(container);

  const first = pre.mapPts.length ? pre.mapPts[0] : { lat: 42.5, lon: 12.5 };
  const map = new maplibregl.Map({
    container: container,
    center: [first.lon, first.lat],
    zoom: VIDEO3D_CONF.camera.zoom, pitch: VIDEO3D_CONF.camera.pitch, bearing: 0,
    style: VIDEO3D_CONF.styleUrl,
    attributionControl: false,
    preserveDrawingBuffer: true, // serve a drawImage nel master canvas
  });

  const canvas = makeVideoCanvas(pre.res);
  const ctx = canvas.getContext('2d');
  const moto = initVideoMoto3D(THREE, W, H);

  const job = {
    mode: '3d', running: true, cancelled: false, canvas, ctx,
    map, container, mapReady: false, moto,
    rows: pre.rows, track: pre.track, mapPts: pre.mapPts, spark: pre.spark,
    dist: pre.dist, tEnd: pre.tEnd, mult: pre.mult, speedMax: pre.speedMax,
    tSim: pre.rows.length ? pre.rows[0].t : 0, lastRaf: 0,
    chunks: [], rec: null, stream: null, raf: 0, recErr: false,
    keyframes: buildCameraKeyframes(pre.mapPts),
  };
  videoJob = job; // così "Annulla" funziona anche durante il caricamento

  map.on('load', () => {
    if (job.cancelled) return;
    try {
      map.addSource('dem', {
        type: 'raster-dem',
        tiles: VIDEO3D_CONF.demTiles,
        encoding: VIDEO3D_CONF.demEncoding, tileSize: 256, maxzoom: 15,
      });
      map.setTerrain({ source: 'dem', exaggeration: 1.5 });
      job.mapReady = true;
      beginVideoCapture(job, canvas, pre.mime);
    } catch (e) {
      requestVideoFallback(pre, job, 'Terreno 3D non disponibile, uso il render 2D.');
    }
  });

  // Stile/worker non caricati (CSP, offline, CDN bloccata) → fallback immediato.
  map.on('error', () => {
    if (!job.mapReady && !job.cancelled) requestVideoFallback(pre, job, 'Mappa 3D non disponibile, uso il render 2D.');
  });

  // Rete di sicurezza: se lo stile non carica in tempo.
  trackVideoTimer(job, setTimeout(() => {
    if (!job.mapReady && videoJob === job && !job.cancelled) {
      requestVideoFallback(pre, job, 'Stile mappa non caricato, uso il render 2D.');
    }
  }, VIDEO3D_CONF.timeouts.styleMs));
}

function buildCameraKeyframes(mapPts) {
  const n = mapPts.length;
  if (!n) return [];
  const raw = new Array(n);
  for (let i = 0; i < n; i++) {
    let brg = 0;
    if (i > 0) brg = bearing(mapPts[i - 1], mapPts[i]) ?? 0;
    else if (n > 1) brg = bearing(mapPts[0], mapPts[1]) ?? 0;
    raw[i] = { lat: mapPts[i].lat, lon: mapPts[i].lon, brg };
  }
  // Media circolare su finestra di 5 per smussare lo jitter dell'heading GPS.
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      const a = raw[j].brg * Math.PI / 180;
      sx += Math.sin(a); sy += Math.cos(a); c++;
    }
    out[i] = { lat: raw[i].lat, lon: raw[i].lon, brg: (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 };
  }
  return out;
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

/* Pura: camera mappa dinamica. Veloce → zoom out (più strada visibile),
   lento → zoom in (dettaglio curve). Piega alta → pitch più radente. */
function videoCameraFor(speedKmh, leanDeg) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  const lean = isFinite(leanDeg) ? Math.min(60, Math.abs(leanDeg)) : 0;
  const t = Math.max(0, Math.min(1, v / 120)); // 0 km/h → 0, 120+ → 1
  return {
    zoom: 16.5 - t * 2.0,          // 16.5 (fermo) → 14.5 (veloce)
    pitch: 55 + (lean / 60) * 13,  // 55 (dritto) → 68 (piega max)
  };
}

function drawVideoFrame3D(job, dt) {
  const { ctx, map, moto, rows, mapPts, keyframes, dist, speedMax, tSim } = job;
  const W = job.canvas.width, H = job.canvas.height;
  const i = Math.max(0, findRowAt(rows, tSim));
  const r = rows[i] || {};

  // Camera mappa: segue il tracciato, muso in avanti, zoom/pitch dinamici.
  const kIdx = videoTrackIndexForRow(i, rows.length, mapPts.length);
  const kf = keyframes[kIdx];
  if (kf && job.mapReady) {
    const cam = videoCameraFor(r.speedKmh || 0, r.lean || 0);
    map.jumpTo({ center: [kf.lon, kf.lat], bearing: kf.brg, pitch: cam.pitch, zoom: cam.zoom });
    if (typeof map.triggerRepaint === 'function') map.triggerRepaint(); else if (typeof map.redraw === 'function') map.redraw();
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

function drawVideoHUD3D(ctx, job, r, tSim, distKm, speedMax) {
  const W = job.canvas.width, H = job.canvas.height;
  const accent = videoColor('accent'), txt = videoColor('text'), axis = videoColor('c-axis');
  const good = videoColor('good'), bad = videoColor('bad');
  const kmh = Math.round(r.speedKmh || 0);

  ctx.textBaseline = 'alphabetic';
  // Velocità (alto-sinistra)
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  rrPath(ctx, 16, 16, 220, 120, 16); ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = accent; ctx.font = 'bold 64px system-ui';
  ctx.fillText(String(kmh), 34, 96);
  ctx.fillStyle = axis; ctx.font = 'bold 22px system-ui';
  ctx.fillText('km/h', 34 + 64 * (kmh >= 100 ? 2.1 : 1.4), 96);

  // Tempo + distanza (alto-destra)
  const tr = fmtDur(tSim) + ' · ' + distKm.toFixed(2) + ' km';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.font = 'bold 22px system-ui';
  const tw = ctx.measureText(tr).width;
  rrPath(ctx, W - 16 - tw - 28, 16, tw + 28, 44, 14); ctx.fill();
  ctx.fillStyle = txt;
  ctx.fillText(tr, W - 30, 47);

  // Piega (basso-sinistra): arco piccolo
  const cx = 90, cy = H - 96, gr = 56;
  ctx.strokeStyle = axis; ctx.lineWidth = 9; ctx.lineCap = 'round';
  const ang = a => (90 - a) * Math.PI / 180;
  ctx.beginPath(); ctx.arc(cx, cy, gr, ang(-60), ang(60)); ctx.stroke();
  const cl = Math.max(-60, Math.min(60, r.lean || 0));
  const na = ang(cl);
  ctx.strokeStyle = cl >= 0 ? good : bad; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * gr * 0.82, cy - Math.sin(na) * gr * 0.82); ctx.stroke();
  ctx.fillStyle = txt; ctx.textAlign = 'center'; ctx.font = 'bold 24px system-ui';
  ctx.fillText(Math.round(cl) + '°', cx, cy + gr * 0.3);

  // Vmax + distanza (basso-destra)
  const vmax = Math.round(Math.max(0, speedMax || kmh));
  const br = 'Vmax ' + vmax + ' km/h · ' + (isFinite(distKm) ? distKm.toFixed(2) : '0.00') + ' km';
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px system-ui';
  const bw = ctx.measureText(br).width;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  rrPath(ctx, W - 16 - bw - 28, H - 60, bw + 28, 44, 14); ctx.fill();
  ctx.fillStyle = txt;
  ctx.fillText(br, W - 30, H - 29);
}
