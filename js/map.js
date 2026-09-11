'use strict';
/* js/map.js (step 26): saveSession/recoverChunks, showSessionDetail, initMap/Leaflet/canvas, updateLeaflet/Map, drawCanvasMap/TrackOnCanvas, canvasTheme. Ordine: dopo js/video3d.js. */
async function saveSession() {
  if (!state.session.startWall) return;
  const endWall = state.session.endWall || Date.now();
  const meta = {
    startISO: new Date(state.session.startWall).toISOString(),
    duration: (endWall - state.session.startWall) / 1000,
    maxSpeed: state.session.maxSpeed,
    maxLeanR: state.session.maxLeanR,
    maxLeanL: state.session.maxLeanL,
    distKm: state.session.distKm,
  };
  const sess = {
    id: state.sessionId || ('s_' + state.session.startWall),
    meta,
    track: (state.trackFull.length ? state.trackFull : state.track).slice(),
    rows: state.rows.slice(),
  };
  try {
    await idb.put(sess);
    // Salvata: i chunk di recupero non servono più e liberano spazio.
    await idb.clearChunks().catch(() => {});
    toast('Giro salvato (' + sess.rows.length + ' campioni).', 'ok');
  } catch (e) {
    // Prima l'errore era muto: l'utente credeva di avere il giro nello storico.
    toast('Salvataggio fallito (spazio esaurito). Esporta subito il CSV.', 'err', 7000);
  }
  // Fuori dal try: un fallimento qui non è "salvataggio fallito" (il giro è già
  // su disco), prima mostrava l'errore per un'operazione già riuscita.
  try { store.del('cruscotto.log'); } catch (e) {}
  renderHistory();
}

async function recoverChunks() {
  let chunks = [];
  try { chunks = await idb.getChunks(); } catch (e) {
    // Errore IDB all'avvio: prima era invisibile, e l'utente non aveva modo di
    // sapere che il recupero non era nemmeno stato tentato.
    try { console.warn('recoverChunks: getChunks fallito', e && e.message); } catch (e2) {}
    return;
  }
  if (!chunks.length) return;
  // Chunk di sessioni diverse (crash durante un log, poi nuovo log): raggruppa
  // per sid e recupera il gruppo con più righe, non un frullato di entrambi.
  const groups = new Map();
  for (const c of chunks) {
    const k = (c && c.sid) || '';
    let g = groups.get(k);
    if (!g) { g = { rows: 0, list: [] }; groups.set(k, g); }
    g.rows += (c.rows || []).length;
    g.list.push(c);
  }
  let best = null;
  for (const g of groups.values()) if (!best || g.rows > best.rows) best = g;
  chunks = best.list;
  chunks.sort((a, b) => a.seq - b.seq);
  const rows = [];
  for (const c of chunks) if (c.rows) for (const r of c.rows) rows.push(r);
  if (!rows.length) { idb.clearChunks().catch(() => {}); return; }
  // Finché l'utente non risponde (Recupera/Scarta), startLog() non deve
  // cancellare questi chunk: la Promise di recoverChunks si risolve subito e il
  // bottone Start è già attivo, quindi senza flag un tap lo bruciava subito.
  state._recoveryPending = true;
  const last = chunks[chunks.length - 1];
  // Traccia ricomposta dai chunk (scritta incrementale): il record kv
  // 'activeTrack' resta solo come fallback per sessioni interrotte da
  // versioni precedenti dell'app.
  const trackChunks = [];
  for (const c of chunks) if (c.track) for (const p of c.track) trackChunks.push(p);
  let saved = null;
  try { saved = await idb.kvGet('activeTrack'); } catch (e) {
    try { console.warn('recoverChunks: lettura activeTrack fallita', e && e.message); } catch (e2) {}
  }
  const track = trackChunks.length ? trackChunks
    : ((saved && saved.sid === last.sid && saved.track) ? saved.track : []);
  const startWall = last.startWall || (saved && saved.startWall) || Date.now();
  const el = document.createElement('div');
  el.className = 'toast';
  const p = document.createElement('div');
  p.textContent = 'Trovata una sessione interrotta (' + rows.length + ' campioni). Recuperarla nello storico?';
  const row = document.createElement('div');
  row.className = 'tbtns';
  const yes = document.createElement('button');
  yes.textContent = 'Recupera';
  yes.className = 'primary';
  const no = document.createElement('button');
  no.textContent = 'Scarta';
  row.appendChild(no); row.appendChild(yes);
  el.appendChild(p); el.appendChild(row);
  els.toasts.appendChild(el);
  yes.addEventListener('click', async () => {
    el.remove();
    let maxSpeed = 0, maxLeanR = 0, maxLeanL = 0;
    for (const r of rows) {
      if (r.speedKmh > maxSpeed) maxSpeed = r.speedKmh;
      if (r.lean > maxLeanR) maxLeanR = r.lean;
      if (r.lean < maxLeanL) maxLeanL = r.lean;
    }
    let distKm = 0;
    for (let i = 1; i < track.length; i++) distKm += haversine(track[i - 1], track[i]);
    const sess = {
      id: last.sid || ('s_' + startWall),
      meta: {
        startISO: new Date(startWall).toISOString(),
        duration: rows.length ? rows[rows.length - 1].t : 0,
        maxSpeed, maxLeanR, maxLeanL, distKm, recovered: true,
      },
      track, rows,
    };
    try {
      await idb.put(sess);
    } catch (e) {
      toast('Recupero fallito.', 'err');
      // _recoveryPending resta true: un successivo Start non cancellerà i chunk
      // della sessione interrotta che non è stato possibile recuperare.
      renderHistory();
      return;
    }
    // Il put è riuscito: il giro è al sicuro. La pulizia dei chunk è accessoria —
    // se fallisce non è "recupero fallito", e l'id della sessione è lo stesso,
    // quindi un'eventuale riproposta al prossimo avvio sovrascrive, non duplica.
    state._recoveryPending = false;
    try { await idb.clearChunks(); } catch (e) {}
    toast('Sessione recuperata.', 'ok');
    renderHistory();
  });
  no.addEventListener('click', () => { state._recoveryPending = false; el.remove(); idb.clearChunks().catch(() => {}); });
}

function showSessionDetail(s) {
  const el = els.sessionDetail;
  el.style.display = 'block';
  const d = new Date(s.meta.startISO);
  const pad = n => String(n).padStart(2, '0');
  el.innerHTML =
    '<h2 style="margin-bottom:8px;">' + d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear() +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</h2>' +
    '<div class="dstats">' +
      '<div class="dstat"><div class="v">' + Math.round(s.meta.maxSpeed) + '</div><div class="k">km/h max</div></div>' +
      '<div class="dstat"><div class="v">' + Math.abs(s.meta.maxLeanR).toFixed(0) + '°</div><div class="k">piega D</div></div>' +
      '<div class="dstat"><div class="v">' + Math.abs(s.meta.maxLeanL).toFixed(0) + '°</div><div class="k">piega S</div></div>' +
      '<div class="dstat"><div class="v">' + (s.meta.distKm||0).toFixed(2) + '</div><div class="k">km</div></div>' +
      '<div class="dstat"><div class="v">' + fmtDur(s.meta.duration) + '</div><div class="k">durata</div></div>' +
      '<div class="dstat"><div class="v">' + (s.rows ? s.rows.length : 0) + '</div><div class="k">campioni</div></div>' +
    '</div>' +
    '<canvas id="replayCanvas" style="height:200px;"></canvas>' +
    '<div class="dbtns">' +
      '<button id="dCsv">Export CSV</button>' +
      '<button id="dGpx">Export GPX</button>' +
      '<button id="dVideo">Export video</button>' +
      '<button id="dCard">Card PNG</button>' +
      '<button id="dDel" style="color:var(--bad); border-color:var(--bad);">Elimina</button>' +
    '</div>';
  state._replayTrack = s.track || [];
  requestAnimationFrame(() => drawTrackOnCanvas($('replayCanvas'), state._replayTrack, { startEnd: true }));
  $('dCsv').addEventListener('click', () => exportCsv(s.rows, s.meta, 'storico'));
  $('dGpx').addEventListener('click', () => exportGpx(s.track, 'storico'));
  $('dVideo').addEventListener('click', () => openVideoModal(s));
  // Card statica: non c'entra con risoluzione/velocità del render video.
  $('dCard').addEventListener('click', () => {
    makeShareCard(s, (url) => {
      if (!url) { toast('Card non generata: nessun dato.', 'err'); return; }
      const a = document.createElement('a');
      a.href = url; a.download = 'cruscotto_card_' + stamp() + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Card PNG scaricata.', 'ok');
    });
  });
  $('dDel').addEventListener('click', async () => {
    if (!await confirmToast('Eliminare questo giro?')) return;
    try { await idb.del(s.id); } catch (e) { toast('Eliminazione fallita.', 'err'); return; }
    el.style.display = 'none';
    renderHistory();
  });
}

function initMap() {
  if (state.mapReady || state._mapLoading) return;
  state._mapLoading = true;
  // Leaflet vendored in repo: niente CDN, niente integrity, funziona offline
  // dalla SHELL del service worker. CSS prima del JS: caricandolo dopo, Leaflet
  // inizializzava con stili assenti e le tile finivano fuori posto al primo render.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './js/vendor/leaflet/leaflet.css';
  link.onerror = () => { state._mapLoading = false; initCanvasMap(); };
  document.head.appendChild(link);

  const script = document.createElement('script');
  script.src = './js/vendor/leaflet/leaflet.js';
  script.onload = () => { state._mapLoading = false; initLeaflet(); };
  script.onerror = () => { state._mapLoading = false; initCanvasMap(); };
  document.head.appendChild(script);
  // Timer conservato e annullato al successo: prima girava a vuoto anche dopo
  // che Leaflet era partito, e poteva scavalcare un init già riuscito.
  state._mapTmo = setTimeout(() => {
    state._mapTmo = null;
    if (!state.mapReady) { state._mapLoading = false; initCanvasMap(); }
  }, 5000);
}

function initLeaflet() {
  if (state.mapReady) return;
  if (state._mapTmo) { clearTimeout(state._mapTmo); state._mapTmo = null; }
  state.mapReady = true;
  state.mapType = 'leaflet';
  const map = L.map('map', { zoomControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(map);
  map.setView([42.5, 12.5], MAP_INIT_ZOOM); // vista iniziale (Italia) prima del primo fix
  state.map = map;
  map.on('dragstart', () => setFollow(false));
  // Leaflet emette 'contextmenu' anche sul long-press touch: destinazione senza tastiera.
  map.on('contextmenu', e => {
    navSetDest({ lat: e.latlng.lat, lon: e.latlng.lng, label: 'Punto sulla mappa' });
    toast('Destinazione impostata.', 'ok');
    switchTab('nav');
  });
  state.mapLayer = L.layerGroup().addTo(map);
  state.mapPos = L.circleMarker([0, 0], { radius: 8, color: MAP_TRACK_COLOR, fillColor: MAP_TRACK_COLOR, fillOpacity: 0.9 }).addTo(state.mapLayer);
  state.mapPoly = L.polyline([], { color: MAP_TRACK_COLOR, weight: 4 }).addTo(state.mapLayer);
  els.btnFollow.classList.toggle('on', state.follow);
  updateLeaflet();
  renderCameras();
}


function updateLeaflet() {
  if (!state.map) return;
  const n = state.track.length;
  const drawn = state._leafN || 0;
  if (n) {
    // Dopo il trim a TRACK_MAX i punti più vecchi escono da state.track ma
    // restano nella polyline (addLatLng non rimuove mai dal davanti): senza il
    // rebuild il disegno si congelava sui primi 10000 punti dei giri lunghi.
    if (state._leafTrim || !drawn || !state.mapPoly.getLatLngs().length) {
      state.mapPoly.setLatLngs(state.track.map(p => [p.lat, p.lon]));
      state._leafTrim = false;
    } else {
      for (let k = drawn; k < n; k++) state.mapPoly.addLatLng([state.track[k].lat, state.track[k].lon]);
    }
    state._leafN = n;
    if (!state.mapFit) { state.map.fitBounds(state.mapPoly.getBounds(), { padding: [30, 30], maxZoom: MAP_FIT_MAX_ZOOM }); state.mapFit = true; }
  }
  // Il marker si muove a ogni fix, anche quando il punto traccia viene scartato.
  if (state.gps.lat != null) {
    state.mapPos.setLatLng([state.gps.lat, state.gps.lon]);
    if (!state.mapFit) { state.map.setView([state.gps.lat, state.gps.lon], MAP_CENTER_ZOOM); state.mapFit = true; }
  }
  if (state.follow && state.gps.lat != null) state.map.panTo([state.gps.lat, state.gps.lon], { animate: false });
  if (state.trackUp) applyMapRotation();
  // Ridisegna i marker autovelox solo muovendosi davvero: il vecchio timer a
  // 20 s ridisegnava fino a 400 marker anche da fermi (batteria, calore).
  if (state.gps.lat != null && (!state._camRenderPos ||
      haversineM(state._camRenderPos.lat, state._camRenderPos.lon, state.gps.lat, state.gps.lon) > camMoveThreshold() * 0.4)) {
    state._camRenderPos = { lat: state.gps.lat, lon: state.gps.lon };
    renderCameras();
  }
}

function initCanvasMap() {
  if (state.mapReady) return;
  if (state._mapTmo) { clearTimeout(state._mapTmo); state._mapTmo = null; }
  state.mapReady = true;
  state.mapType = 'canvas';
  els.map.style.display = 'none';
  els.mapCanvas.style.display = 'block';
  state.mapCanvas = els.mapCanvas;
  drawCanvasMap();
}

function drawCanvasMap() {
  if (state.mapType !== 'canvas' || !state.mapCanvas) return;
  const p = state.gps.lat != null ? { lat: state.gps.lat, lon: state.gps.lon } : null;
  const centered = (state.follow || state.centerPending || state.trackUp) ? p : null;
  const h = state.trackUp ? trackUpHeading() : null;
  drawTrackOnCanvas(state.mapCanvas, state.track, {
    /* Fix GPS vivo, non l'ultimo punto di traccia: la traccia avanza solo a log
       attivo e solo ogni TRACK_MIN_M, quindi da fermi (o a log spento) l'ultimo
       punto scritto e' dove la moto ERA. Vedi drawTrackOnCanvas per l'uso. */
    cur: p,
    heading: state.gps.heading,
    // Con un DB importato disegnare tutto era impraticabile: solo le camere vicine.
    cameras: camsToDraw(),
    route: navRouteForCanvas(),
    center: centered,
    rotateDeg: h != null ? -h : 0,
  });
}

function updateMap() {
  if (!state.mapReady) return;
  if (state.mapType === 'leaflet') updateLeaflet();
  else drawCanvasMap();
}

function drawTrackOnCanvas(canvas, track, opts) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  const h = canvas.clientHeight || 200;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = canvasTheme.get('c-bg');
  ctx.fillRect(0, 0, w, h);
  const cams = (opts && opts.cameras) || [];
  const route = (opts && opts.route) || [];
  const hasTrack = !!(track && track.length);
  /* Posizione corrente: il fix GPS VIVO (opts.cur), non track[track.length - 1].
     La traccia cresce solo a log attivo e solo ogni TRACK_MIN_M: da fermo, a log
     spento o nei primi metri l'ultimo punto scritto e' dove la moto era, e il
     marker restava li'. `opts.cur` e' l'unico modo per passare la posizione: i
     replay (js/map.js:156, index.html:1961) passano solo { startEnd: true } e non
     disegnano nessun marker. Non e' un doppione di `hasTrack`: si puo' avere un fix
     e nessuna traccia. */
  const cur = (opts && opts.cur) || null;
  if (!hasTrack && !cams.length && !route.length && !cur) {
    ctx.fillStyle = canvasTheme.get('c-axis'); ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Nessun fix GPS', w / 2, h / 2);
    return;
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  if (hasTrack) for (const p of track) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
  }
  // Fix senza traccia (log non attivo, oppure prima del primo punto): non serve un
  // ramo dedicato, il fix entra nei bounds qui sotto insieme a camere e rotta.
  for (const c of cams) {
    if (c.lat < minLat) minLat = c.lat; if (c.lat > maxLat) maxLat = c.lat;
    if (c.lon < minLon) minLon = c.lon; if (c.lon > maxLon) maxLon = c.lon;
  }
  // La rotta entra nel bounding box: senza, finirebbe fuori dal riquadro.
  for (const c of route) {
    if (c.lat < minLat) minLat = c.lat; if (c.lat > maxLat) maxLat = c.lat;
    if (c.lon < minLon) minLon = c.lon; if (c.lon > maxLon) maxLon = c.lon;
  }
  /* Il marker sta sul fix VIVO (cur), che puo' essere fuori dalla traccia scritta: la
     traccia avanza solo a log attivo e solo ogni TRACK_MIN_M, quindi da fermi o nei
     primi metri l'ultimo punto e' indietro. Con la traccia a un punto solo lo span
     degenera, il floor a 0.0001 lo gonfia a ~15 m di finestra e il fix finisce fuori
     dal canvas: schermo vuoto proprio all'avvio, quando serve di piu'. Qui cur entra
     nei bounds perche' e' cio' che si disegna: sotto si aggiunge a min/max, non lo
     sostituisce. */
  if (cur) {
    if (cur.lat < minLat) minLat = cur.lat; if (cur.lat > maxLat) maxLat = cur.lat;
    if (cur.lon < minLon) minLon = cur.lon; if (cur.lon > maxLon) maxLon = cur.lon;
  }
  const spanLat = (maxLat - minLat) || 0.0001, spanLon = (maxLon - minLon) || 0.0001;
  const pad = 28;
  const lat0 = (maxLat + minLat) / 2;
  const kx = Math.max(0.15, Math.cos(lat0 * Math.PI / 180));
  const rot0 = (opts && opts.rotateDeg) || 0;
  const scale = Math.min((w - 2 * pad) / (spanLon * kx), (h - 2 * pad) / spanLat);
  const ctr = (opts && opts.center) ? opts.center : null;
  /* Estensione nulla (un solo punto: il fix vivo senza traccia, o una sola camera)
     non da' un centro di riquadro da cui ricavare l'inquadratura: senza anchor
     finiva nell'angolo in alto a sinistra. L'anchor lo centra. */
  const degenerate = (maxLat === minLat && maxLon === minLon);
  const anchor = (ctr || rot0 || degenerate) ? { lon: ctr ? ctr.lon : (minLon + maxLon) / 2, lat: ctr ? ctr.lat : (minLat + maxLat) / 2 } : null;
  const offX = anchor ? (w / 2 - (anchor.lon - minLon) * kx * scale) : ((w - spanLon * kx * scale) / 2);
  const offY = anchor ? (h / 2 - (maxLat - anchor.lat) * scale) : ((h - spanLat * scale) / 2);
  const X = lon => offX + (lon - minLon) * kx * scale;
  const Y = lat => offY + (maxLat - lat) * scale;

  // Track-up anche sulla mappa di riserva: si ruota il contesto attorno al centro.
  const rot = (opts && opts.rotateDeg) || 0;
  if (rot) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);
  }

  if (route.length > 1) {
    ctx.strokeStyle = canvasTheme.get('c-route'); ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.beginPath();
    route.forEach((p, i) => { const x = X(p.lon), y = Y(p.lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }

  if (hasTrack) {
    ctx.strokeStyle = canvasTheme.get('c-accent'); ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    track.forEach((p, i) => { const x = X(p.lon), y = Y(p.lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }

  // camere (punti rossi)
  for (const c of cams) {
    ctx.fillStyle = canvasTheme.get('c-bad');
    ctx.beginPath(); ctx.arc(X(c.lon), Y(c.lat), 5, 0, TAU); ctx.fill();
  }

  // inizio (verde) / fine (rossa)
  if (opts && opts.startEnd && hasTrack) {
    const s = track[0], e = track[track.length - 1];
    ctx.fillStyle = canvasTheme.get('c-good'); ctx.beginPath(); ctx.arc(X(s.lon), Y(s.lat), 5, 0, TAU); ctx.fill();
    ctx.fillStyle = canvasTheme.get('c-bad'); ctx.beginPath(); ctx.arc(X(e.lon), Y(e.lat), 5, 0, TAU); ctx.fill();
  }
  if (rot) ctx.restore(); // il marker resta dritto anche con la mappa ruotata

  // posizione corrente + heading — dal fix vivo, non dall'ultimo punto di traccia
  if (cur) {
    /* X/Y e non w/2 in track-up: con rotateDeg l'anchor e' il centro e coincide col
       fix vivo (drawCanvasMap passa lo stesso punto come center), quindi X(cur.lon)
       vale w/2 esatto — ma senza dipendere dal chiamante. */
    const cx = X(cur.lon), cy = Y(cur.lat);
    ctx.fillStyle = canvasTheme.get('c-txt');
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, TAU); ctx.fill();
    // In track-up il verso di marcia è per definizione verso l'alto.
    const hd = rot ? 0 : opts.heading;
    if (hd != null) {
      const a = hd * Math.PI / 180;
      const dx = Math.sin(a), dy = -Math.cos(a);
      ctx.strokeStyle = canvasTheme.get('c-txt'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * 18, cy + dy * 18); ctx.stroke();
    }
  }
}

const canvasTheme = {
  _c: null,
  get(name) {
    if (!canvasTheme._c) {
      const cs = getComputedStyle(document.documentElement);
      canvasTheme._c = {};
      // I nomi --c-* devono esistere in entrambi i :root di index.html:
      // se una var manca, get() torna '#888' e il video esce grigio (bug #888).
      for (const n of ['c-bg', 'c-grid', 'c-axis', 'c-accent', 'c-good', 'c-bad', 'c-warn', 'c-txt', 'c-route', 'c-acc-lat', 'c-acc-lon', 'c-acc-vert']) {
        canvasTheme._c[n] = (cs.getPropertyValue('--' + n) || '').trim();
      }
    }
    return canvasTheme._c[name] || '#888';
  },
  reset() { canvasTheme._c = null; }
};
