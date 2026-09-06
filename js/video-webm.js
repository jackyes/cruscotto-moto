'use strict';
/* js/video-webm.js: export WebM offline (WebCodecs + webm-muxer vendored),
   stessa idea del video-mp4.js: niente MediaRecorder+captureStream (che è
   legato al wall-clock reale, quindi lento quanto il giro stesso), si
   disegnano i frame in ciclo e si passano a VideoEncoder con timestamp.
   Ordine: dopo js/video-offline.js e js/video3d.js, prima di js/share.js.
   Se il browser non ha WebCodecs o il muxer non è caricato, si cade sul
   WebM realtime esistente (startVideoRender2D/3D) — nessun regresso.
   Tutto impuro qui resta non testato in harness: solo le pure
   (webmConfigFor) vanno nell'export. */

/* Pura: config encode da risoluzione (stesso budget bitrate del MP4/WebM
   realtime). codec di default 'vp8' (hardware encoder più diffuso, specie
   Android: stesso motivo di pickVideoMime in video.js). */
function webmConfigFor(W, H, codec) {
  const w = isFinite(W) && W > 0 ? Math.round(W) : 1280;
  const h = isFinite(H) && H > 0 ? Math.round(H) : 720;
  return { codec: codec || 'vp8', width: w, height: h,
    bitrate: videoBitrateFor(w), framerate: 30, hardwareAcceleration: 'prefer-hardware' };
}

/* Pura: candidati codec in ordine di preferenza — WebCodecs (per l'encoder)
   + Matroska codec id (per il muxer, che valida solo che sia una stringa
   ma il container deve dichiarare l'id giusto). VP8 prima di VP9 come in
   pickVideoMime (hardware encoder VP9 spesso dichiarato ma assente). */
function webmCodecCandidates() {
  return [
    { wc: 'vp8', mux: 'V_VP8' },
    { wc: 'vp09.00.10.08', mux: 'V_VP9' },
  ];
}

/* Disponibile solo dove WebCodecs esiste (stesso check di videoMp4Supported):
   su browser senza VideoEncoder si resta sul WebM realtime esistente. */
function videoWebmOfflineSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/* Muxer vendored: classic script → globale WebMMuxer (stesso schema di
   loadMp4Muxer/Mp4Muxer in video-mp4.js). */
function loadWebmMuxer() {
  const g = (typeof globalThis !== 'undefined' && globalThis.WebMMuxer) ? globalThis.WebMMuxer : null;
  return g && g.Muxer ? Promise.resolve(g) : Promise.reject(new Error('WebMMuxer non presente'));
}

function videoWebmRealtimeFallback(pre, mode) {
  if (mode === '3d') startVideoRender3D(pre); else startVideoRender2D(pre);
}

/* Entry WebM offline: prova VP8/VP9 via WebCodecs+webm-muxer (veloce, non
   legato al wall-clock). Se qualcosa non torna in fase di setup (browser,
   muxer, codec, mappa 3D) cade sul WebM realtime esistente, con toast solo
   quando la scelta iniziale era esplicitamente WebM/MP4 (comportamento
   analogo a startVideoRenderMp4). */
async function startVideoRenderWebmOffline(pre, mode) {
  if (!videoWebmOfflineSupported()) { videoWebmRealtimeFallback(pre, mode); return; }
  let Muxer = null;
  try { Muxer = await loadWebmMuxer(); }
  catch (e) { videoWebmRealtimeFallback(pre, mode); return; }
  if (!Muxer || !Muxer.Muxer) { videoWebmRealtimeFallback(pre, mode); return; }

  const W = pre.res[0], H = pre.res[1];
  let picked = null;
  for (const cand of webmCodecCandidates()) {
    try {
      const res = await videoOfflinePickEncoderConfig(webmConfigFor(W, H, cand.wc));
      if (res.supported) { picked = { cfg: res.cfg, mux: cand.mux }; break; }
    } catch (e) {}
  }
  if (!picked) { videoWebmRealtimeFallback(pre, mode); return; }

  // Il 3D gira su maplibre+three caricati da CDN al volo (stesso motivo del
  // ramo MP4): senza, la prima esportazione WebM offline 3D morirebbe in
  // video3DBuildJob (maplibregl undefined).
  let m = mode;
  if (m === '3d' && typeof ensureVideo3DLibs === 'function') {
    try { await ensureVideo3DLibs(t => { els.videoStatus.textContent = t; }); }
    catch (e) {
      if (videoJob && videoJob.cancelled) return;
      toast((e && e.message ? e.message : 'Mappa 3D non disponibile') + ', WebM in 2D.', 'err', 6000);
      m = '2d';
    }
  }
  await startVideoRenderWebmOfflineInner(pre, m, Muxer, picked);
}

async function startVideoRenderWebmOfflineInner(pre, mode, Muxer, picked) {
  const W = pre.res[0], H = pre.res[1];
  const muxerOpts = {
    target: new Muxer.ArrayBufferTarget(),
    video: { codec: picked.mux, width: W, height: H, frameRate: 30 },
  };
  // configure() tira su risoluzioni/profili non supportati: senza guardia
  // usciva come promise rejection muta (stesso motivo del ramo MP4).
  let muxer = null, enc = null, encErr = null;
  try {
    muxer = new Muxer.Muxer(muxerOpts);
    enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { encErr = encErr || e; },
    });
    enc.configure(picked.cfg);
  } catch (e) {
    try { if (enc) enc.close(); } catch (e2) {}
    toast('Encoder WebM non configurabile: ' + (e && e.message ? e.message : e) + '.', 'err', 8000);
    return;
  }
  // In 3D il canvas master lo crea videoOfflineSetupMap (con la mappa):
  // crearlo anche qui lasciava un canvas orfano nel DOM a ogni export.
  const canvas = mode === '3d' ? null : makeVideoCanvas(pre.res);
  const ctx = canvas ? canvas.getContext('2d') : null;
  const job = {
    mode: mode, running: true, cancelled: false, canvas, ctx,
    rows: pre.rows, track: pre.track, mapPts: pre.mapPts, spark: pre.spark,
    dist: pre.dist, tEnd: pre.tEnd, mult: 1, speedMax: pre.speedMax,
    slow: pre.slow, tSim: pre.rows.length ? pre.rows[0].t : 0,
    webm: { enc, muxer, frame: 0 },
  };
  videoJob = job;
  els.videoStart.disabled = true;
  els.videoStatus.textContent = 'Encode WebM…';
  try {
    if (mode === '3d') await videoOfflineSetupMap(job, pre);
    await videoOfflineLoop(job, job.webm, { fps: 30, keyframeEvery: 150, label: 'WebM' });
  } catch (e) {
    try { enc.close(); } catch (e2) {}
    cleanupVideoJob(job);
    videoJob = null;
    closeVideoModal();
    const why = (e && e.message ? e.message : String(e)) ||
      (encErr && encErr.message ? encErr.message : 'errore');
    toast('Encode WebM fallito: ' + why + '.', 'err', 8000);
    return;
  }
  try { await enc.flush(); enc.close(); } catch (e) {}
  // Niente audio (fuori scope: il WebM realtime oggi non ne ha comunque).
  let blob = null;
  try {
    muxer.finalize();
    blob = new Blob([muxer.target.buffer], { type: 'video/webm' });
  } catch (e) {
    cleanupVideoJob(job);
    videoJob = null;
    closeVideoModal();
    toast('Muxing WebM fallito: ' + (e && e.message ? e.message : e) + '.', 'err', 8000);
    return;
  }
  cleanupVideoJob(job);
  videoJob = null;
  closeVideoModal();
  if (job.cancelled || !blob || !blob.size) { toast('Render annullato.', 'err'); return; }
  downloadBlob('cruscotto_video_' + stamp() + '.webm', blob, 'video/webm');
  toast('Video WebM esportato.', 'ok');
}
