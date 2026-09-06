'use strict';
/* js/video-offline.js: loop di encode offline condiviso da MP4 e WebM
   (WebCodecs VideoEncoder, niente captureStream: si disegna ogni frame e lo
   si passa con timestamp calcolato dalla riga, molto più veloce del realtime
   MediaRecorder+captureStream perché non è legato al wall-clock).
   Ordine: dopo js/video3d.js (riusa video3DBuildJob/drawVideoFrame), prima
   dei muxer vendorizzati e di js/video-mp4.js/js/video-webm.js. */

/* Pura: passo frame dal framerate (30 fps -> 33333 µs). */
function videoOfflineFrameStepUs(fps) {
  const f = isFinite(fps) && fps > 0 ? fps : 30;
  return Math.round(1e6 / f);
}

/* Prova il config con hint hardware, ripiega su 'no-preference' se il
   browser lo rifiuta (VideoEncoder.isConfigSupported): mai lancia, ritorna
   {cfg, supported}. Se VideoEncoder manca del tutto assume supportato (lo
   scoprirà comunque enc.configure() più avanti con la sua guardia try/catch). */
async function videoOfflinePickEncoderConfig(baseCfg) {
  if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) {
    return { cfg: baseCfg, supported: true };
  }
  try {
    const sup = await VideoEncoder.isConfigSupported(baseCfg);
    if (sup && sup.supported) return { cfg: baseCfg, supported: true };
  } catch (e) {}
  if (baseCfg.hardwareAcceleration === 'prefer-hardware') {
    const alt = Object.assign({}, baseCfg, { hardwareAcceleration: 'no-preference' });
    try {
      const sup2 = await VideoEncoder.isConfigSupported(alt);
      if (sup2 && sup2.supported) return { cfg: alt, supported: true };
    } catch (e) {}
  }
  return { cfg: baseCfg, supported: false };
}

/* Prepara il job 3D per un loop offline (MP4 o WebM): riusa video3DBuildJob
   (stessa mappa+moto del realtime), aspetta style.load + guardia 6 s (load
   aspetta le tile e hanga offline: §6.3 doc replay). */
function videoOfflineSetupMap(job, pre) {
  return new Promise((resolve, reject) => {
    const canvas = makeVideoCanvas(pre.res);
    const ctx = canvas.getContext('2d');
    let j3 = null;
    try { j3 = video3DBuildJob(pre, canvas, ctx); }
    catch (e) { try { canvas.parentNode && canvas.parentNode.removeChild(canvas); } catch (e2) {} reject(e); return; }
    job.canvas = j3.canvas; job.ctx = j3.ctx;
    job.map = j3.map; job.container = j3.container; job.moto = j3.moto;
    job.keyframes = j3.keyframes; job.extremes = j3.extremes; job.hud = j3.hud;
    job.mapReady = false;
    if (job.cancelled) { cleanupVideoJob(job); reject(new Error('cancel')); return; }
    let done = false;
    const ok = () => {
      if (done) return; done = true;
      clearTimeout(timer);
      try {
        job.map.addSource('dem', {
          type: 'raster-dem',
          tiles: VIDEO3D_CONF.demTiles,
          encoding: VIDEO3D_CONF.demEncoding, tileSize: 256, maxzoom: 15,
        });
        // Stesso ordine del realtime (§6.2): posiziona → setTerrain → riposiziona.
        const first = pre.mapPts.length ? pre.mapPts[0] : { lat: 42.5, lon: 12.5 };
        try { job.map.jumpTo({ center: [first.lon, first.lat], zoom: VIDEO3D_CONF.camera.zoom, pitch: VIDEO3D_CONF.camera.pitch, bearing: 0 }); } catch (e) {}
        job.map.setTerrain({ source: 'dem', exaggeration: 1.5 });
        try { job.map.jumpTo({ center: [first.lon, first.lat], zoom: VIDEO3D_CONF.camera.zoom, pitch: VIDEO3D_CONF.camera.pitch, bearing: 0 }); } catch (e) {}
        if (typeof job.map.setSky === 'function') { try { job.map.setSky(videoSkyOptions()); } catch (e) {} }
        // Satellite opzionale: stessa base + liberty nascosto del realtime.
        if (pre.sat) { try { videoSatAddToMap(job.map); } catch (e) {} }
        let beforeId = null;
        try {
          const layers = job.map.getStyle ? job.map.getStyle().layers : null;
          if (layers) { const s = layers.find(l => l.type === 'symbol'); if (s) beforeId = s.id; }
        } catch (e) {}
        try { videoTrackAddToMap(job.map, pre.mapPts, videoSegLeansFor(pre.mapPts, pre.rows)); } catch (e) {}
        videoSceneAddToMap(job.map, beforeId, pre.buildings);
      } catch (e) {}
      job.mapReady = true;
      resolve();
    };
    const timer = setTimeout(ok, 6000);
    try { job.map.on('style.load', ok); } catch (e) { ok(); }
    try { job.map.on('error', () => { if (!job.mapReady && !job.cancelled) { /* resta: guardia chiude */ } }); } catch (e) {}
  });
}

/* Loop offline generico: disegna ogni frame e lo passa a un VideoEncoder con
   timestamp manuale (più veloce del realtime, niente captureStream).
   encState = {enc, frame} (job.mp4 o job.webm, mutato sul posto).
   opts = {fps, keyframeEvery, label} (label solo per il testo di stato). */
async function videoOfflineLoop(job, encState, opts) {
  const enc = encState.enc;
  const fps = (opts && opts.fps) || 30;
  const keyframeEvery = (opts && opts.keyframeEvery) || 150;
  const label = (opts && opts.label) || 'video';
  const stepUs = videoOfflineFrameStepUs(fps);
  const rows = job.rows;
  if (!rows.length) return;
  const t0 = rows[0].t;
  const total = rows.length;
  let vf = null;
  try { vf = new VideoFrame(job.canvas, { timestamp: 0, duration: stepUs }); } catch (e) { vf = null; }
  if (vf) { try { vf.close(); } catch (e) {} }
  for (let k = 0; k < total; k++) {
    if (job.cancelled) return;
    const r = rows[k] || {};
    job.tSim = r.t;
    drawVideoFrame(job, 1 / fps);
    const ts = Math.round(((isFinite(r.t) ? r.t : t0) - t0) * 1e6);
    let frame = null;
    try { frame = new VideoFrame(job.canvas, { timestamp: Math.max(0, ts), duration: stepUs }); }
    catch (e) { continue; }
    // Backpressure: se l'encoder è saturo aspetta (niente OOM su giri lunghi).
    try {
      if (enc.encodeQueueSize > 8) {
        await new Promise(res => {
          let n = 0;
          const tick = () => {
            if (job.cancelled || enc.encodeQueueSize <= 4 || ++n > 200) { res(); return; }
            setTimeout(tick, 10);
          };
          tick();
        });
      }
      enc.encode(frame, { keyFrame: encState.frame % keyframeEvery === 0 });
    } catch (e) {}
    try { frame.close(); } catch (e) {}
    encState.frame++;
    // UI viva: yield ogni 15 frame + progress (loop da migliaia di frame).
    if (encState.frame % 15 === 0) {
      const pct = Math.round((k / Math.max(1, total - 1)) * 100);
      els.videoProg.style.width = pct + '%';
      els.videoStatus.textContent = 'Encode ' + label + ' ' + pct + '%';
      await new Promise(res => setTimeout(res, 0));
    }
  }
}
