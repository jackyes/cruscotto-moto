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

function videoColor(name) {
  const key = (name.indexOf('c-') === 0) ? name : ('c-' + name);
  return canvasTheme.get(key);
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
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
    toast('Registrazione video non supportata su questo browser.', 'err');
    return;
  }
  const mime = pickVideoMime();
  if (!mime) { toast('Codec WebM non disponibile.', 'err'); return; }

  const rows = s.rows || [];
  const track = s.track || [];
  if (!rows.length && !track.length) { toast('Nessun dato da renderizzare.', 'err'); return; }
  const tEnd = rows.length ? rows[rows.length - 1].t : 0;
  if (tEnd <= 0) { toast('Sessione troppo corta.', 'err'); return; }

  const res = els.videoRes.value === '1080' ? [1920, 1080] : [1280, 720];
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

  const pre = { mime, res, mult, rows, track, mapPts, spark, dist, tEnd, speedMax };
  const mode = (els.videoType && els.videoType.value === '2d') ? '2d' : '3d';
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
    tSim: pre.rows.length ? pre.rows[0].t : 0, lastRaf: 0,
    chunks: [], rec: null, stream: null, raf: 0, recErr: false,
  };
  beginVideoCapture(job, canvas, pre.mime);
}

function beginVideoCapture(job, canvas, mime) {
  if (job.cancelled) return;
  job.stream = canvas.captureStream(30);
  job.rec = new MediaRecorder(job.stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
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
  if (job.moto && job.moto.renderer) {
    try { job.moto.renderer.dispose(); } catch (e) {}
    if (job.moto.renderer.domElement && job.moto.renderer.domElement.parentNode) job.moto.renderer.domElement.parentNode.removeChild(job.moto.renderer.domElement);
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
  job.tSim += dt * job.mult;
  if (job.tSim >= job.tEnd) {
    job.tSim = job.tEnd;
    drawVideoFrame(job);
    job.running = false;
    try { job.rec.stop(); } catch (e) {}
    return;
  }
  drawVideoFrame(job);
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
  const SPARK = 96, mapW = Math.round(W * 0.56), topH = H - SPARK, dashX = mapW, dashW = W - mapW;

  drawVideoMap(ctx, job, 0, 0, mapW, topH, i, r, grid, axis, accent, good, bad);
  drawVideoDash(ctx, dashX, 0, dashW, topH, r, tSim, dist[i] || 0, speedMax, accent, axis, txt, good, bad, accLat, accLon, accVert);
  drawVideoSpark(ctx, job, 0, topH, W, SPARK, tSim, accent, grid);
}

function drawVideoMap(ctx, job, x, y, w, h, rowIdx, r, grid, axis, accent, good, bad) {
  const pts = job.mapPts;
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
  const offX = x + (w - spanLon * scale) / 2, offY = y + (h - spanLat * scale) / 2;
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

function drawVideoFrame(job) {
  if (job.mode === '3d') drawVideoFrame3D(job);
  else drawVideoFrame2D(job);
}
