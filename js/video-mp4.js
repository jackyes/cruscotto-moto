'use strict';
/* js/video-mp4.js: export MP4 (WebCodecs + mp4-muxer vendored) + audio motore.
   Ordine: dopo js/video3d.js (riusa pre/makeVideoCanvas/drawVideoFrame),
   prima di js/share.js. Tutto impuro qui resta non testato in harness:
   solo le pure (mp4ConfigFor/engineToneFor/windGainFor) vanno nell'export. */

/* Pura: config encode da risoluzione (stesso budget bitrate del WebM). */
function mp4ConfigFor(W, H) {
  const w = isFinite(W) && W > 0 ? Math.round(W) : 1280;
  const h = isFinite(H) && H > 0 ? Math.round(H) : 720;
  return { codec: 'avc1.640028', width: w, height: h,
    bitrate: videoBitrateFor(w), framerate: 30 };
}

/* Pura: frequenza motore da velocità (saw 60 Hz fermo → ~320 a 120 km/h). */
function engineToneFor(speedKmh) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  return 60 + v * 2.2;
}

/* Pura: guadagno vento da velocità (0 fermo → 0.15 a 130+). */
function windGainFor(speedKmh) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  return Math.min(1, v / 130) * 0.15;
}

/* Disponibile solo dove WebCodecs esiste (Chrome/Edge desktop+Android):
   su iOS/Safari torna false e si resta sul WebM. */
function videoMp4Supported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/* Muxer vendored: classic script → globale Mp4Muxer (niente import dinamico:
   MIME/module trap su host statici + CSP zero-unsafe-eval). Caricato come
   <script src> prima di questo file. Se manca (offline senza precache),
   l'export MP4 cade sul WebM con toast chiaro. */
function loadMp4Muxer() {
  const g = (typeof globalThis !== 'undefined' && globalThis.Mp4Muxer) ? globalThis.Mp4Muxer : null;
  return g && g.Muxer ? Promise.resolve(g) : Promise.reject(new Error('Mp4Muxer non presente'));
}

/* Audio motore+vento: osc saw (pitch da velocità) + rumore bianco filtrato.
   Ritorna {ctx, dest, osc, oscGain, noiseGain} o null (muto/non supportato). */
function videoAudioGraph(muted) {
  if (muted) return null;
  let AC = null;
  try { AC = window.AudioContext || window.webkitAudioContext; } catch (e) {}
  if (!AC) return null;
  let ctx = null;
  try { ctx = new AC({ sampleRate: 44100 }); } catch (e) { return null; }
  try {
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = engineToneFor(0);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 800;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.06;
    osc.connect(lp); lp.connect(oscGain); oscGain.connect(dest);
    osc.start();
    // Rumore bianco 1 s in loop (vento): buffer statico, gain da velocità.
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass'; nlp.frequency.value = 1200;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(nlp); nlp.connect(noiseGain); noiseGain.connect(dest);
    noise.start();
    return { ctx, dest, osc, oscGain, noiseGain };
  } catch (e) {
    try { ctx.close(); } catch (e2) {}
    return null;
  }
}

/* Aggiorna pitch/gain per frame (chiamato dal loop con la riga corrente). */
function videoAudioUpdate(ag, speedKmh) {
  if (!ag) return;
  try {
    const t = ag.ctx.currentTime;
    ag.osc.frequency.setTargetAtTime(engineToneFor(speedKmh), t, 0.05);
    ag.noiseGain.gain.setTargetAtTime(windGainFor(speedKmh), t, 0.1);
  } catch (e) {}
}

function videoAudioClose(ag) {
  if (!ag) return;
  try { ag.osc.stop(); } catch (e) {}
  try { ag.ctx.close(); } catch (e) {}
}

/* Pura: passo frame dal framerate (30 fps → 33333 µs). */
function mp4FrameStepUs(fps) {
  const f = isFinite(fps) && fps > 0 ? fps : 30;
  return Math.round(1e6 / f);
}

/* Prepara il job 3D per il loop MP4: riusa video3DBuildJob (stessa mappa+moto
   del realtime), aspetta style.load + guardia 6 s (load aspetta le tile e
   hanga offline: §6.3 doc replay). */
function videoMp4SetupMap(job, pre) {
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
        videoSceneAddToMap(job.map, beforeId);
      } catch (e) {}
      job.mapReady = true;
      resolve();
    };
    const timer = setTimeout(ok, 6000);
    try { job.map.on('style.load', ok); } catch (e) { ok(); }
    try { job.map.on('error', () => { if (!job.mapReady && !job.cancelled) { /* resta: guardia chiude */ } }); } catch (e) {}
  });
}

/* Loop offline: disegna ogni frame e lo passa a VideoEncoder con timestamp
   manuale (più veloce del realtime, niente captureStream). Ritorna promise. */
async function videoMp4Loop(job, W, H) {
  const enc = job.mp4.enc, ag = job.mp4.ag;
  const stepUs = mp4FrameStepUs(30);
  const rows = job.rows;
  if (!rows.length) return;
  const t0 = rows[0].t;
  // Avanzamento per indice (salta le soste), clock HUD da t reale (§2.3 doc).
  const total = rows.length;
  let vf = null;
  try { vf = new VideoFrame(job.canvas, { timestamp: 0, duration: stepUs }); } catch (e) { vf = null; }
  if (vf) { try { vf.close(); } catch (e) {} }
  for (let k = 0; k < total; k++) {
    if (job.cancelled) return;
    const r = rows[k] || {};
    job.tSim = r.t;
    drawVideoFrame(job, 1 / 30);
    const ts = Math.round(((isFinite(r.t) ? r.t : t0) - t0) * 1e6);
    let frame = null;
    try { frame = new VideoFrame(job.canvas, { timestamp: Math.max(0, ts), duration: stepUs }); }
    catch (e) { continue; }
    // Backpressure: se l'encoder è saturo aspetta (niente OOM su giri lunghi).
    try {
      if (enc.encodeQueueSize > 8) {
        const cur = job.mp4.frame;
        await new Promise(res => {
          let n = 0;
          const tick = () => {
            if (job.cancelled || enc.encodeQueueSize <= 4 || ++n > 200) { res(); return; }
            setTimeout(tick, 10);
          };
          tick();
        });
        void cur;
      }
      enc.encode(frame, { keyFrame: job.mp4.frame % 150 === 0 });
    } catch (e) {}
    try { frame.close(); } catch (e) {}
    job.mp4.frame++;
    void ag;
    // Nota: l'audio MP4 si sintetizza dopo in videoMp4MuxAudio (niente graph
    // live durante l'encode: suonerebbe dalle casse senza finire nel file).
    // UI viva: yield ogni 15 frame + progress (loop da migliaia di frame).
    if (job.mp4.frame % 15 === 0) {
      els.videoProg.style.width = Math.round((k / Math.max(1, total - 1)) * 100) + '%';
      els.videoStatus.textContent = 'Encode MP4 ' + Math.round((k / Math.max(1, total - 1)) * 100) + '%';
      await new Promise(res => setTimeout(res, 0));
    }
  }
  void W; void H;
}

/* Audio AAC sintetico offline: saw motore (engineToneFor) + rumore bianco
   (windGainFor), 44.1 kHz mono. Niente ScriptProcessor: campioni generati
   dagli stessi profili del graph live, timestamp dalla t delle righe. */
function videoMp4MuxAudio(muxer, rows) {
  return new Promise(resolve => {
    try {
      if (typeof AudioEncoder === 'undefined' || !rows.length) { resolve(false); return; }
      const SR = 44100;
      const aenc = new AudioEncoder({
        output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) {} },
        error: () => {},
      });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 1, bitrate: 128000 });
      const t0 = rows[0].t;
      let tsUs = 0, phase = 0;
      // Chunk da 0.5 s: pochi encode, memoria costante.
      const CH = Math.floor(SR / 2);
      let cur = new Float32Array(CH), n = 0;
      let k = 0;
      const flushCur = () => {
        if (!n) return;
        const data = new AudioData({
          format: 'f32', sampleRate: SR, numberOfFrames: n, numberOfChannels: 1,
          timestamp: tsUs, data: cur.slice(0, n).buffer,
        });
        tsUs += Math.round((n / SR) * 1e6);
        try { aenc.encode(data); } catch (e) {}
        try { data.close(); } catch (e) {}
        n = 0;
      };
      while (k < rows.length) {
        const r = rows[k] || {};
        const v = r.speedKmh || 0;
        const f = engineToneFor(v), g = windGainFor(v);
        // Durata campione: dt reale alla riga dopo (clamp 0.2 s sui buchi gap).
        const nxt = rows[k + 1];
        let dt = nxt ? (nxt.t - r.t) : 0.05;
        if (!isFinite(dt) || dt <= 0) dt = 0.05;
        dt = Math.min(dt, 0.2);
        let samples = Math.round(dt * SR);
        while (samples > 0) {
          const room = CH - n;
          const take = Math.min(room, samples);
          for (let s = 0; s < take; s++) {
            phase += f / SR;
            const saw = ((phase % 1) * 2 - 1) * 0.06;
            const noise = (Math.random() * 2 - 1) * g;
            cur[n++] = saw + noise;
          }
          samples -= take;
          if (n >= CH) flushCur();
          if (job_cancelled_flag()) { try { aenc.close(); } catch (e) {} resolve(false); return; }
        }
        k++;
      }
      function job_cancelled_flag() { return !!(typeof videoJob !== 'undefined' && videoJob && videoJob.cancelled); }
      flushCur();
      aenc.flush().then(() => { try { aenc.close(); } catch (e) {} resolve(true); })
        .catch(() => { try { aenc.close(); } catch (e) {} resolve(false); });
      void t0;
    } catch (e) { resolve(false); }
  });
}

/* Entry MP4: offline più veloce del realtime (niente captureStream: si
   disegnano i frame in ciclo e si passano a VideoEncoder con timestamp). */
async function startVideoRenderMp4(pre, mode) {
  if (!videoMp4Supported()) {
    toast('MP4 non supportato su questo browser, uso WebM.', 'err', 6000);
    if (mode === '3d') startVideoRender3D(pre); else startVideoRender2D(pre);
    return;
  }
  let cfgOk = true;
  try {
    if (VideoEncoder.isConfigSupported) {
      const sup = await VideoEncoder.isConfigSupported(mp4ConfigFor(pre.res[0], pre.res[1]));
      cfgOk = !!(sup && sup.supported);
    }
  } catch (e) { cfgOk = true; }
  if (!cfgOk) {
    toast('H.264 non supportato, uso WebM.', 'err', 6000);
    if (mode === '3d') startVideoRender3D(pre); else startVideoRender2D(pre);
    return;
  }
  // Il 3D gira su maplibre+three caricati da CDN al volo: nel ramo WebM li
  // carica startVideoRender3D, qui vanno chiesti a mano. Senza, la prima
  // esportazione MP4 3D moriva in video3DBuildJob (maplibregl undefined).
  // Se la CDN non risponde si resta su MP4, ma in 2D (non serve nessuna lib).
  let m = mode;
  if (m === '3d' && typeof ensureVideo3DLibs === 'function') {
    try { await ensureVideo3DLibs(t => { els.videoStatus.textContent = t; }); }
    catch (e) {
      if (videoJob && videoJob.cancelled) return;
      toast((e && e.message ? e.message : 'Mappa 3D non disponibile') + ', MP4 in 2D.', 'err', 6000);
      m = '2d';
    }
  }
  let Muxer = null;
  try { Muxer = await loadMp4Muxer(); }
  catch (e) {
    toast('Muxer MP4 non caricato: ' + (e && e.message ? e.message : 'errore') + '. Riprova WebM.', 'err', 6000);
    return;
  }
  if (!Muxer || !Muxer.Muxer) {
    toast('Muxer MP4 non valido (export mancante), riprova WebM.', 'err', 6000);
    return;
  }
  await startVideoRenderMp4Inner(pre, m, Muxer);
}

async function startVideoRenderMp4Inner(pre, mode, Muxer) {
  const W = pre.res[0], H = pre.res[1];
  const cfg = mp4ConfigFor(W, H);
  const muted = !!(els.videoAudio && els.videoAudio.value === 'off');
  const muxerOpts = {
    target: new Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
  };
  // Traccia audio AAC solo se non muto: sintetizzata offline dagli stessi
  // profili del live (engineToneFor/windGainFor), niente AudioContext aperto
  // durante l'encode (suonerebbe dalle casse senza finire nel file).
  if (!muted && typeof AudioEncoder !== 'undefined') {
    muxerOpts.audio = { codec: 'aac', sampleRate: 44100, numberOfChannels: 1 };
  }
  // configure() tira su risoluzioni/profili non supportati: senza guardia
  // usciva come promise rejection muta (modale appesa su "Encode MP4…").
  let muxer = null, enc = null, encErr = null;
  try {
    muxer = new Muxer.Muxer(muxerOpts);
    enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { encErr = encErr || e; },
    });
    enc.configure(cfg);
  } catch (e) {
    try { if (enc) enc.close(); } catch (e2) {}
    toast('Encoder MP4 non configurabile: ' + (e && e.message ? e.message : e) + '. Riprova WebM.', 'err', 8000);
    return;
  }
  // In 3D il canvas master lo crea videoMp4SetupMap (con la mappa): crearlo
  // anche qui lasciava un canvas orfano nel DOM a ogni export.
  const canvas = mode === '3d' ? null : makeVideoCanvas(pre.res);
  const ctx = canvas ? canvas.getContext('2d') : null;
  // Niente graph live durante l'encode offline (suonerebbe dalle casse):
  // l'audio si sintetizza dopo in videoMp4MuxAudio. ag resta per compat.
  const job = {
    mode: mode, running: true, cancelled: false, canvas, ctx,
    rows: pre.rows, track: pre.track, mapPts: pre.mapPts, spark: pre.spark,
    dist: pre.dist, tEnd: pre.tEnd, mult: 1, speedMax: pre.speedMax,
    slow: pre.slow, tSim: pre.rows.length ? pre.rows[0].t : 0,
    mp4: { enc, muxer, ag: null, frame: 0, _lastV: null },
  };
  videoJob = job;
  els.videoStart.disabled = true;
  els.videoStatus.textContent = 'Encode MP4…';
  try {
    if (mode === '3d') await videoMp4SetupMap(job, pre);
    await videoMp4Loop(job, W, H);
  } catch (e) {
    try { enc.close(); } catch (e2) {}
    cleanupVideoJob(job);
    videoJob = null;
    closeVideoModal();
    const why = (e && e.message ? e.message : String(e)) ||
      (encErr && encErr.message ? encErr.message : 'errore');
    toast('Encode MP4 fallito: ' + why + '. Riprova WebM.', 'err', 8000);
    return;
  }
  try { await enc.flush(); enc.close(); } catch (e) {}
  // Audio dopo il video (stessi timestamp t delle righe, niente drift).
  if (!muted) {
    els.videoStatus.textContent = 'Audio MP4…';
    try { await videoMp4MuxAudio(muxer, pre.rows); } catch (e) {}
  }
  let blob = null;
  try {
    muxer.finalize();
    blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } catch (e) {
    cleanupVideoJob(job);
    videoJob = null;
    closeVideoModal();
    toast('Muxing MP4 fallito: ' + (e && e.message ? e.message : e) + '. Riprova WebM.', 'err', 8000);
    return;
  }
  cleanupVideoJob(job);
  videoJob = null;
  closeVideoModal();
  if (job.cancelled || !blob || !blob.size) { toast('Render annullato.', 'err'); return; }
  downloadBlob('cruscotto_video_' + stamp() + '.mp4', blob, 'video/mp4');
  toast('Video MP4 esportato.', 'ok');
}
