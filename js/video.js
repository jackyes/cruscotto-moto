'use strict';
/* js/video.js (step 20): export blob + render video 2D (downloadBlob, exportCsv/Gpx, videoColor, capture, drawVideo*2D/Map/Dash/Spark). 3D resta inline. Ordine: dopo js/nav-config.js. */
function downloadBlob(name, text, type) {
  // text può essere una stringa o un array di parti: l'export storico costruisce
  // il CSV a pezzi invece di concatenare centinaia di MB in una sola stringa.
  const blob = new Blob(Array.isArray(text) ? text : [text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function exportCsv(rows, meta, nameSuffix) {
  if (!rows || !rows.length) { toast('Nessun dato da esportare.', 'err'); return; }
  // Chunk da 5000 righe: una sola stringa da 180k righe picca memoria/GC sul telefono.
  const parts = [csvMeta(meta) + '\n' + CSV_HEADER + '\n'];
  for (let i = 0; i < rows.length; i += 5000) parts.push(csvRows(rows.slice(i, i + 5000)) + '\n');
  downloadBlob('cruscotto' + (nameSuffix ? '_' + nameSuffix : '') + '_' + stamp() + '.csv', parts, 'text/csv;charset=utf-8');
}

function exportGpx(track, nameSuffix) {
  if (!track || !track.length) { toast('Nessun percorso da esportare.', 'err'); return; }
  downloadBlob('cruscotto' + (nameSuffix ? '_' + nameSuffix : '') + '_' + stamp() + '.gpx', buildGpx(track), 'application/gpx+xml');
}

// 'text' si chiama 'c-txt' nel tema (non 'c-text'): la mappa evita il grigio #888.
function videoColorKey(name) {
  if (name === 'text' || name === 'c-text') return 'c-txt';
  if (name.indexOf('c-') === 0) return name;
  return 'c-' + name;
}

function videoColor(name) {
  return canvasTheme.get(videoColorKey(name));
}

function resetVideoColors() { canvasTheme.reset(); }


let videoJob = null;


function pickVideoMime() {
  // vp8 prima: su molti Android l'encoder hardware vp9 non è disponibile pur
  // essendo dichiarato supportato, e MediaRecorder fallisce senza dati.
  const cand = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
  for (const m of cand) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

/* Pura: risoluzione video da chiave select. 9:16 = 720x1280 (reel):
   720p largo su telefono spreca metà schermo, il verticale riempie il feed. */
function videoResFor(key) {
  if (key === '1080') return [1920, 1080];
  if (key === '916') return [720, 1280];
  return [1280, 720];
}

/* Pura: bitrate da larghezza canvas. 9:16 ha 0.92 Mpx come il 720p:
   stesso budget, non serve fascia extra. */
function videoBitrateFor(width) {
  if (width >= 1920) return 8_000_000;
  return 5_000_000;
}

/* Pura: zone slow-mo precalcolate (piega forte o picchi vib): il realtime
   integrale resta tSim, l'envelope cambia solo la derivata per-frame. */
function buildSlowZones(rows, base) {
  const b = isFinite(base) && base > 0 ? base : 1;
  const zones = [];
  const arr = rows || [];
  let open = -1;
  for (let k = 0; k < arr.length; k++) {
    const r = arr[k] || {};
    const lean = isFinite(r.lean) ? Math.abs(r.lean) : 0;
    const vib = isFinite(r.vib_g) ? r.vib_g : (isFinite(r.vib) ? r.vib : 0);
    const hot = lean > 25 || vib > 0.5;
    if (hot && open < 0) open = isFinite(r.t) ? r.t : k * 0.05;
    else if (!hot && open >= 0) { zones.push({ t0: open, t1: isFinite(r.t) ? r.t : k * 0.05 }); open = -1; }
  }
  if (open >= 0 && arr.length) {
    const last = arr[arr.length - 1];
    zones.push({ t0: open, t1: last && isFinite(last.t) ? last.t : open + 1 });
  }
  // Fondi sovrapposte + scarta corte (sotto 1.5 s è flicker, non slow-mo).
  const merged = [];
  for (const z of zones) {
    const prev = merged[merged.length - 1];
    if (prev && z.t0 <= prev.t1 + 0.5) prev.t1 = Math.max(prev.t1, z.t1);
    else if (z.t1 - z.t0 >= 1.5) merged.push({ t0: z.t0, t1: z.t1 });
  }
  return { base: b, zones: merged, slow: 0.35, ramp: 0.5 };
}

/* Pura: moltiplicatore con ramp lineare in/out (niente scalini nel video). */
function slowMultAt(t, slow) {
  if (!slow || !slow.zones || !slow.zones.length) return slow && isFinite(slow.base) ? slow.base : 1;
  const ramp = slow.ramp > 0 ? slow.ramp : 0.5;
  for (const z of slow.zones) {
    if (t < z.t0 - ramp || t > z.t1 + ramp) continue;
    if (t >= z.t0 && t <= z.t1) return slow.slow;
    // Rampa: interpola base↔slow ai bordi.
    const edge = t < z.t0 ? (t - (z.t0 - ramp)) / ramp : ((z.t1 + ramp) - t) / ramp;
    const f = Math.max(0, Math.min(1, edge));
    return slow.slow + (slow.base - slow.slow) * f;
  }
  return slow.base;
}

/* Pura: ampiezza shake px da vibrazione (sotto soglia = 0, niente costo). */
function shakeAmpFor(vib, W) {
  const v = isFinite(vib) ? Math.max(0, vib) : 0;
  if (v < 0.15) return 0;
  const maxPx = 6 * (isFinite(W) && W > 0 ? W / 1280 : 1);
  return Math.min(maxPx, (v - 0.15) * 8);
}

/* Pura: offset deterministico (seni 13/29 Hz ~ vib moto; seed tSim = testabile,
   niente random che cambia a ogni render dello stesso frame). */
function shakeOffset(tSim, amp) {
  if (!amp) return { dx: 0, dy: 0 };
  const t = isFinite(tSim) ? tSim : 0;
  return {
    dx: amp * (Math.sin(2 * Math.PI * 13 * t) + 0.5 * Math.sin(2 * Math.PI * 29 * t)),
    dy: amp * (Math.sin(2 * Math.PI * 17 * t + 1.3) + 0.5 * Math.sin(2 * Math.PI * 23 * t)),
  };
}

/* Pura: speed-lines procedurali (solo sopra soglia: sotto = video pulito).
   Seed da frame intero: stesso tSim = stesse linee (deterministico). */
function speedLinesFor(tSim, speedKmh, speedMax, W, H) {
  const sm = isFinite(speedMax) && speedMax > 0 ? speedMax : 120;
  const v = isFinite(speedKmh) ? speedKmh : 0;
  if (v < 0.72 * sm) return [];
  const over = Math.min(1, (v - 0.72 * sm) / (0.28 * sm));
  const n = 6 + Math.round(over * 8);
  // Hash intero dal frame (niente Math.random: render ripetibile).
  let hsh = (Math.floor((isFinite(tSim) ? tSim : 0) * 30) * 2654435761) >>> 0;
  const rnd = () => { hsh = ((hsh * 1664525 + 1013904223) >>> 0); return hsh / 4294967296; };
  const out = [];
  for (let k = 0; k < n; k++) {
    const side = rnd() < 0.5 ? 0 : 1; // 0 = sx, 1 = dx (mai centro dash)
    const y0 = rnd() * H;
    const len = 60 + rnd() * 120;
    const x0 = side ? W - rnd() * W * 0.15 : rnd() * W * 0.15;
    out.push({ x0, y0, x1: side ? x0 + len : x0 - len, y1: y0, a: 0.15 + over * 0.35 * rnd() });
  }
  return out;
}

/* Pura: il giro ha punti GPS validi? No = solo IMU/rulli, mappa 3D inutile. */
function videoHasGps(pre) {
  const mp = pre && pre.mapPts;
  return !!(mp && mp.length >= 2);
}

function openVideoModal(s) {
  stopVideoRender();
  els.videoModal._session = s;
  els.videoStart.disabled = false;
  els.videoProg.style.width = '0%';
  els.videoStatus.textContent = 'Pronto.';
  els.videoModal.hidden = false;
}

function closeVideoModal() {
  els.videoModal.hidden = true;
  els.videoModal._session = null;
}

function startVideoRender(s) {
  const wantMp4Early = !!(els.videoFormat && els.videoFormat.value === 'mp4');
  const mp4ok = wantMp4Early && typeof videoMp4Supported === 'function' && videoMp4Supported();
  if (!mp4ok && (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream)) {
    toast('Registrazione video non supportata su questo browser.', 'err');
    return;
  }
  const rows = s.rows || [];
  const track = s.track || [];
  if (!rows.length && !track.length) { toast('Nessun dato da renderizzare.', 'err'); return; }
  const tEnd = rows.length ? rows[rows.length - 1].t : 0;
  if (tEnd <= 0) { toast('Sessione troppo corta.', 'err'); return; }

  const res = videoResFor(els.videoRes ? els.videoRes.value : '720');
  const mult = Number(els.videoSpeed.value) || 1;

  // Distanza cumulativa per riga (km), riusando haversine dell'app.
  const dist = new Float64Array(rows.length);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    dist[i] = dist[i - 1] + ((a.lat != null && a.lon != null && b.lat != null && b.lon != null) ? haversine(a, b) : 0);
  }

  // Punti mappa validi (con lat/lon) prefiltrati una sola volta.
  const mapPts = [];
  const src = (track && track.length) ? track : rows;
  for (const p of src) if (p.lat != null && p.lon != null) mapPts.push(p);

  // Sparkline velocità: downsampling a ~400 punti, min/max precalcolati.
  const spark = { pts: [], min: Infinity, max: -Infinity };
  const step = Math.max(1, Math.floor(rows.length / 400));
  for (let k = 0; k < rows.length; k += step) {
    const v = rows[k].speedKmh || 0;
    spark.pts.push({ t: rows[k].t, v });
    if (v < spark.min) spark.min = v;
    if (v > spark.max) spark.max = v;
  }
  if (!isFinite(spark.min)) { spark.min = 0; spark.max = 1; }

  let speedMax = 60;
  if (s.meta && s.meta.maxSpeed) speedMax = Math.max(speedMax, s.meta.maxSpeed);
  else for (const r of rows) if (r.speedKmh > speedMax) speedMax = r.speedKmh;
  speedMax = Math.ceil(speedMax / 20) * 20;

  // mime solo per WebM: se MP4 parte, pickVideoMime non serve (su browser
  // senza MediaRecorder ma con WebCodecs il check sopra l'ha già lasciato passare).
  let mime = '';
  if (!mp4ok) {
    mime = pickVideoMime();
    if (!mime) { toast('Codec WebM non disponibile.', 'err'); return; }
  }
  const pre = { mime, res, mult, rows, track, mapPts, spark, dist, tEnd, speedMax,
    slow: buildSlowZones(rows, mult) };
  // Giro senza GPS (solo IMU, es. rulli): la mappa 3D centrerebbe l'Italia
  // di default e centrerebbe il nulla. Forza 2D e spiega perché.
  if (!videoHasGps(pre)) {
    if (els.videoType) els.videoType.value = '2d';
    toast('Giro senza GPS: uso il render 2D (grafici+HUD).', 'err', 6000);
    startVideoRender2D(pre);
    return;
  }
  const mode = (els.videoType && els.videoType.value === '2d') ? '2d' : '3d';
  // Formato MP4 (WebCodecs + muxer vendored, offline): se richiesto e
  // supportato va al loop MP4, altrimenti cade sul WebM realtime.
  const wantMp4 = !!(els.videoFormat && els.videoFormat.value === 'mp4');
  if (wantMp4 && typeof videoMp4Supported === 'function' && videoMp4Supported()) {
    startVideoRenderMp4(pre, mode);
    return;
  }
  if (wantMp4) toast('MP4 non supportato qui, uso WebM.', 'err', 6000);
  if (mode === '3d') { startVideoRender3D(pre); return; }
  startVideoRender2D(pre);
}

function makeVideoCanvas(res) {
  const c = document.createElement('canvas');
  c.width = res[0]; c.height = res[1];
  c.style.cssText = 'position:fixed; left:-9999px; top:0;';
  document.body.appendChild(c);
  return c;
}

function startVideoRender2D(pre) {
  const canvas = makeVideoCanvas(pre.res);
  const ctx = canvas.getContext('2d');
  const job = {
    mode: '2d', running: true, cancelled: false, canvas, ctx,
    rows: pre.rows, track: pre.track, mapPts: pre.mapPts, spark: pre.spark,
    dist: pre.dist, tEnd: pre.tEnd, mult: pre.mult, speedMax: pre.speedMax,
    slow: pre.slow,
    tSim: pre.rows.length ? pre.rows[0].t : 0, lastRaf: 0,
    chunks: [], rec: null, stream: null, raf: 0, recErr: false,
  };
  beginVideoCapture(job, canvas, pre.mime);
}

function beginVideoCapture(job, canvas, mime) {
  if (job.cancelled) return;
  job.stream = canvas.captureStream(30);
  // 1080p ha 2.25x pixel del 720p: a 5 Mbps gli artefatti mangiano i dettagli mappa.
  const bps = videoBitrateFor(canvas.width);
  job.rec = new MediaRecorder(job.stream, { mimeType: mime, videoBitsPerSecond: bps });
  job.rec.onerror = () => {
    job.recErr = true;
    toast('Errore encoder video: prova 720p o un browser desktop.', 'err', 6000);
  };
  job.rec.ondataavailable = e => { if (e.data && e.data.size) job.chunks.push(e.data); };
  job.rec.onstop = () => {
    if (!job.cancelled && !job.recErr && job.chunks.length) {
      const blob = new Blob(job.chunks, { type: mime });
      downloadBlob('cruscotto_video_' + stamp() + '.webm', blob, mime);
      toast('Video esportato.', 'ok');
    } else if (!job.cancelled) {
      toast('Registrazione vuota: codec/encoder non disponibile su questo dispositivo.', 'err', 6000);
    }
    cleanupVideoJob(job);
    if (videoJob === job) videoJob = null;
    closeVideoModal();
  };
  job.rec.start(250);
  videoJob = job;
  els.videoStart.disabled = true;
  els.videoStatus.textContent = 'Render in corso…';
  job.lastRaf = performance.now();
  job.raf = requestAnimationFrame(videoLoop);
}

function cleanupVideoJob(job) {
  if (job.raf) { cancelAnimationFrame(job.raf); job.raf = 0; }
  if (job.canvas && job.canvas.parentNode) job.canvas.parentNode.removeChild(job.canvas);
  if (job.moto) {
    if (typeof disposeVideoMoto3D === 'function') { try { disposeVideoMoto3D(job.moto); } catch (e) {} }
    else if (job.moto.renderer) {
      try { job.moto.renderer.dispose(); } catch (e) {}
      if (job.moto.renderer.domElement && job.moto.renderer.domElement.parentNode) job.moto.renderer.domElement.parentNode.removeChild(job.moto.renderer.domElement);
    }
    job.moto = null;
  }
  if (job.map && job.map.remove) { try { job.map.remove(); } catch (e) {} }
  if (job.container && job.container.parentNode) job.container.parentNode.removeChild(job.container);
}

function videoLoop(now) {
  const job = videoJob;
  if (!job || !job.running) return;
  const rawDt = job.lastRaf ? (now - job.lastRaf) / 1000 : 0;
  const dt = rawDt < 0 ? 0 : (rawDt > 0.1 ? 0.1 : rawDt);
  job.lastRaf = now;
  // Slow-mo envelope (piega/vib): fuori zone = mult base, dentro = 0.35x.
  job.tSim += dt * slowMultAt(job.tSim, job.slow || { base: job.mult });
  if (job.tSim >= job.tEnd) {
    job.tSim = job.tEnd;
    drawVideoFrame(job, dt);
    job.running = false;
    try { job.rec.stop(); } catch (e) {}
    return;
  }
  drawVideoFrame(job, dt);
  els.videoProg.style.width = Math.round((job.tSim / job.tEnd) * 100) + '%';
  els.videoStatus.textContent = fmtDur(job.tSim) + ' / ' + fmtDur(job.tEnd);
  job.raf = requestAnimationFrame(videoLoop);
}

function stopVideoRender() {
  const job = videoJob;
  if (!job) return;
  job.running = false;
  job.cancelled = true;
  if (job.raf) cancelAnimationFrame(job.raf);
  try { if (job.rec) job.rec.stop(); } catch (e) {}
  try { if (job.stream) job.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  cleanupVideoJob(job);
  videoJob = null;
  closeVideoModal();
}

/* Pura: layout frame 2D per aspect. Orizzontale: mappa sx + dash dx + spark
   sotto. Verticale 9:16: impilato (dash in alto, mappa centro, spark sotto):
   side-by-side su 720 px darebbe due strisce illeggibili da 360 px. */
function videoFrameLayout(W, H) {
  const vert = H > W;
  if (!vert) {
    const SPARK = 96, mapW = Math.round(W * 0.56), topH = H - SPARK;
    return { vert, sparkH: SPARK, map: { x: 0, y: 0, w: mapW, h: topH },
      dash: { x: mapW, y: 0, w: W - mapW, h: topH }, spark: { x: 0, y: topH, w: W, h: SPARK } };
  }
  const dashH = Math.round(H * 0.30), sparkH = Math.round(H * 0.12);
  const mapH = H - dashH - sparkH;
  return { vert, sparkH, map: { x: 0, y: dashH, w: W, h: mapH },
    dash: { x: 0, y: 0, w: W, h: dashH }, spark: { x: 0, y: dashH + mapH, w: W, h: sparkH } };
}

function drawVideoFrame2D(job) {
  const { canvas, ctx, rows, tSim, dist, speedMax } = job;
  const W = canvas.width, H = canvas.height;
  const bg = videoColor('c-bg'), grid = videoColor('c-grid'), axis = videoColor('c-axis');
  const accent = videoColor('accent'), good = videoColor('good'), bad = videoColor('bad');
  const accLat = videoColor('acc-lat'), accLon = videoColor('acc-lon'), accVert = videoColor('acc-vert');
  const txt = videoColor('text');

  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const i = Math.max(0, findRowAt(rows, tSim));
  const r = rows[i] || {};
  const L = videoFrameLayout(W, H);

  // Shake solo sulla mappa (clip interno): l'HUD resta leggibile, il
  // MediaRecorder amplificherebbe il jitter su testi e barre.
  const vib = isFinite(r.vib_g) ? r.vib_g : (isFinite(r.vib) ? r.vib : 0);
  const sh = shakeOffset(tSim, shakeAmpFor(vib, W));
  drawVideoMap(ctx, job, L.map.x, L.map.y, L.map.w, L.map.h, i, r, grid, axis, accent, good, bad, sh.dx, sh.dy);
  if (L.vert) drawVideoDashVert(ctx, L.dash.x, L.dash.y, L.dash.w, L.dash.h, r, tSim, dist[i] || 0, speedMax, accent, axis, txt, good, bad, accLat, accLon, accVert);
  else drawVideoDash(ctx, L.dash.x, L.dash.y, L.dash.w, L.dash.h, r, tSim, dist[i] || 0, speedMax, accent, axis, txt, good, bad, accLat, accLon, accVert);
  drawVideoSpark(ctx, job, L.spark.x, L.spark.y, L.spark.w, L.spark.h, tSim, accent, grid);
  // Speed-lines ultime (sopra tutto ma solo ai bordi, mai sul numero).
  drawSpeedLines(ctx, speedLinesFor(tSim, r.speedKmh || 0, speedMax, W, H), accent);
}

/* ctx-only sottile: stroke delle speed-lines (vuote = niente, costo zero). */
function drawSpeedLines(ctx, lines, color) {
  if (!lines || !lines.length) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const l of lines) {
    ctx.globalAlpha = l.a;
    ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x1, l.y1); ctx.stroke();
  }
  ctx.restore();
}

function drawVideoMap(ctx, job, x, y, w, h, rowIdx, r, grid, axis, accent, good, bad, ox, oy) {
  const pts = job.mapPts;
  // Offset shake (default 0: chiamanti vecchi invariati).
  const shx = isFinite(ox) ? ox : 0, shy = isFinite(oy) ? oy : 0;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = videoColor('c-bg'); ctx.fillRect(x, y, w, h);
  if (!pts.length) {
    ctx.fillStyle = axis; ctx.font = '26px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Nessun GPS', x + w / 2, y + h / 2);
    ctx.restore(); return;
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
  }
  const spanLat = (maxLat - minLat) || 0.0001, spanLon = (maxLon - minLon) || 0.0001;
  const pad = 40;
  const scale = Math.min((w - 2 * pad) / spanLon, (h - 2 * pad) / spanLat);
  const offX = x + (w - spanLon * scale) / 2 + shx, offY = y + (h - spanLat * scale) / 2 + shy;
  const X = lon => offX + (lon - minLon) * scale;
  const Y = lat => offY + (maxLat - lat) * scale;

  const n = pts.length;
  const ridden = Math.max(0, Math.min(n - 1, Math.round((rowIdx / Math.max(1, job.rows.length - 1)) * (n - 1))));

  ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // tracciato restante (grigio)
  ctx.strokeStyle = grid;
  ctx.beginPath();
  for (let k = ridden; k < n; k++) { const px = X(pts[k].lon), py = Y(pts[k].lat); k === ridden ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
  ctx.stroke();
  // tratto percorso (accento)
  ctx.strokeStyle = accent;
  ctx.beginPath();
  for (let k = 0; k <= ridden; k++) { const px = X(pts[k].lon), py = Y(pts[k].lat); k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
  ctx.stroke();

  // inizio / fine
  const s0 = pts[0], e0 = pts[n - 1];
  ctx.fillStyle = good; ctx.beginPath(); ctx.arc(X(s0.lon), Y(s0.lat), 8, 0, 6.283); ctx.fill();
  ctx.fillStyle = bad; ctx.beginPath(); ctx.arc(X(e0.lon), Y(e0.lat), 8, 0, 6.283); ctx.fill();

  // posizione attuale (cade sul row se ha lat/lon, altrimenti sul punto percorso)
  let clat = r.lat, clon = r.lon;
  if (clat == null || clon == null) { clat = pts[ridden].lat; clon = pts[ridden].lon; }
  const cxx = X(clon), cyy = Y(clat);
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cxx, cyy, 12, 0, 6.283); ctx.fill();
  ctx.strokeStyle = videoColor('c-bg'); ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

function drawVideoDash(ctx, x, y, w, h, r, tSim, distKm, speedMax, accent, axis, txt, good, bad, accLat, accLon, accVert) {
  const cx = x + w / 2;
  const kmh = Math.round(r.speedKmh || 0);

  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.font = 'bold ' + Math.round(h * 0.20) + 'px system-ui';
  ctx.fillText(String(kmh), cx, y + h * 0.24);
  ctx.fillStyle = axis;
  ctx.font = 'bold ' + Math.round(h * 0.05) + 'px system-ui';
  ctx.fillText('km/h', cx, y + h * 0.31);

  // arco piega
  const lean = r.lean || 0;
  const gcy = y + h * 0.58, gr = Math.min(w * 0.30, h * 0.16);
  drawLeanArc(ctx, cx, gcy, gr, lean, axis, good, bad, txt);

  // barre accelerazioni
  const bw = w * 0.80, bx = x + (w - bw) / 2, bh = Math.max(7, h * 0.035);
  const barY = y + h * 0.72, gap = bh + 9;
  drawAccBar(ctx, bx, barY, bw, bh, r.latG || 0, 1.2, accLat, 'LAT', axis, txt);
  drawAccBar(ctx, bx, barY + gap, bw, bh, r.lonG || 0, 1.2, accLon, 'LON', axis, txt);
  drawAccBar(ctx, bx, barY + 2 * gap, bw, bh, r.vertG || 0, 1.5, accVert, 'VERT', axis, txt);

  // tempo + distanza
  ctx.fillStyle = txt;
  ctx.font = 'bold ' + Math.round(h * 0.042) + 'px system-ui';
  ctx.fillText(fmtDur(tSim) + '  ·  ' + distKm.toFixed(2) + ' km', cx, y + h * 0.94);
}

/* Dash verticale 9:16: velocità grossa in alto, piega+G affiancate al centro,
   tempo+distanza sotto. Il dash orizzontale su 720 px di larghezza avrebbe
   barre da 576 px e testo microscopico: layout dedicato, non riuso. */
function drawVideoDashVert(ctx, x, y, w, h, r, tSim, distKm, speedMax, accent, axis, txt, good, bad, accLat, accLon, accVert) {
  ctx.textAlign = 'center';
  const kmh = Math.round(r.speedKmh || 0);
  ctx.fillStyle = accent;
  ctx.font = 'bold ' + Math.round(h * 0.26) + 'px system-ui';
  ctx.fillText(String(kmh), x + w / 2, y + h * 0.26);
  ctx.fillStyle = axis;
  ctx.font = 'bold ' + Math.round(h * 0.05) + 'px system-ui';
  ctx.fillText('km/h', x + w / 2, y + h * 0.33);

  // Piega a sx, G a dx (stessa fascia, niente sovrapposizione).
  const lean = r.lean || 0;
  const midY = y + h * 0.58, gr = Math.min(w * 0.20, h * 0.17);
  drawLeanArc(ctx, x + w * 0.25, midY, gr, lean, axis, good, bad, txt);
  hudGdot(ctx, x + w * 0.75, midY, gr * 0.9, r.latG || 0, r.lonG || 0, accent, axis, txt);

  // Barre G compatte sotto (larghezza piena, testo a sx).
  const bw = w * 0.86, bx = x + (w - bw) / 2, bh = Math.max(6, h * 0.028);
  const barY = y + h * 0.76, gap = bh + 7;
  drawAccBar(ctx, bx, barY, bw, bh, r.latG || 0, 1.2, accLat, 'LAT', axis, txt);
  drawAccBar(ctx, bx, barY + gap, bw, bh, r.lonG || 0, 1.2, accLon, 'LON', axis, txt);

  ctx.fillStyle = txt;
  ctx.font = 'bold ' + Math.round(h * 0.038) + 'px system-ui';
  ctx.fillText(fmtDur(tSim) + '  ·  ' + distKm.toFixed(2) + ' km', x + w / 2, y + h * 0.97);
}

function drawVideoSpark(ctx, job, x, y, w, h, tSim, accent, grid) {
  ctx.fillStyle = videoColor('c-bg'); ctx.fillRect(x, y, w, h);
  const pts = job.spark.pts;
  if (!pts.length) return;
  const span = Math.max(1, job.spark.max - job.spark.min);
  const t0 = job.rows[0].t, tspan = Math.max(1, job.tEnd - t0);
  const pad = 12;
  const X = t => x + pad + ((t - t0) / tspan) * (w - 2 * pad);
  const Y = v => y + h - pad - ((v - job.spark.min) / span) * (h - 2 * pad);
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, k) => { const px = X(p.t), py = Y(p.v); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke();
  const cxx = X(tSim);
  ctx.strokeStyle = grid; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cxx, y + 4); ctx.lineTo(cxx, y + h - 4); ctx.stroke();
}

function drawVideoFrame(job, dt) {
  if (job.mode === '3d') drawVideoFrame3D(job, dt);
  else drawVideoFrame2D(job);
}
