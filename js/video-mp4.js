'use strict';
/* js/video-mp4.js: export MP4 (WebCodecs + mp4-muxer vendored), solo video.
   Ordine: dopo js/video-offline.js (loop di encode condiviso con il WebM
   offline) e js/video3d.js (riusa pre/makeVideoCanvas/drawVideoFrame), prima
   di js/share.js. Tutto impuro qui resta non testato in harness: solo le
   pure (mp4ConfigFor/mp4FrameStepUs) vanno
   nell'export. */

/* Pura: config encode da risoluzione (stesso budget bitrate del WebM).
   hardwareAcceleration:'prefer-hardware' è solo un hint: se il browser lo
   rifiuta, videoOfflinePickEncoderConfig ripiega su 'no-preference'.
   fps opzionale (default 30): l'auto-fit qualità può scendere a 24/15. */
function mp4ConfigFor(W, H, fps) {
  const w = isFinite(W) && W > 0 ? Math.round(W) : 1280;
  const h = isFinite(H) && H > 0 ? Math.round(H) : 720;
  return { codec: 'avc1.640028', width: w, height: h,
    bitrate: videoBitrateFor(w), framerate: isFinite(fps) && fps > 0 ? fps : 30,
    hardwareAcceleration: 'prefer-hardware' };
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

/* Pura: passo frame dal framerate (30 fps → 33333 µs). Wrapper sottile sulla
   generica in video-offline.js (nome storico mantenuto per l'export test). */
function mp4FrameStepUs(fps) {
  return videoOfflineFrameStepUs(fps);
}

/* Prepara il job 3D per il loop MP4: wrapper sottile su videoOfflineSetupMap
   (generica in video-offline.js, condivisa col loop WebM offline). */
function videoMp4SetupMap(job, pre) {
  return videoOfflineSetupMap(job, pre);
}

/* Loop offline: disegna ogni frame e lo passa a VideoEncoder con timestamp
   manuale (più veloce del realtime, niente captureStream). Wrapper sottile
   sul loop generico in video-offline.js (condiviso col WebM offline). */
async function videoMp4Loop(job, W, H) {
  await videoOfflineLoop(job, job.mp4, { fps: job.mp4.fps || 30, label: 'MP4' });
  void W; void H;
}

/* Fallback MP4→WebM: prima offline (WebCodecs, memoria-safe), poi realtime.
   Il realtime su giri lunghi accumula chunk MediaRecorder in RAM e sul
   telefono può crashare il tab (finestra che sparisce senza toast). */
function videoMp4FallbackToWebm(pre, mode) {
  if (typeof startVideoRenderWebmOffline === 'function' &&
      typeof videoWebmOfflineSupported === 'function' && videoWebmOfflineSupported()) {
    startVideoRenderWebmOffline(pre, mode).catch(e => {
      if (!videoSessionGone()) toast('WebM offline non riuscito, uso il realtime: ' +
        ((e && e.message) || 'errore') + '.', 'err', 6000);
      if (videoSessionGone()) return;
      if (!pre.mime) pre.mime = pickVideoMime();
      if (!pre.mime) {
        toast('Codec WebM non disponibile.', 'err');
        if (els.videoStart) els.videoStart.disabled = false;
        return;
      }
      if (mode === '3d') startVideoRender3D(pre); else startVideoRender2D(pre);
    });
    return;
  }
  toast('WebM offline non disponibile su questo browser, uso il realtime (più lento e a rischio memoria).', 'err', 10000);
  if (mode === '3d') startVideoRender3D(pre); else startVideoRender2D(pre);
}

/* Pura: candidati H.264 in ordine di compatibilità hardware. Molti SoC
   Android encodano via WebCodecs solo Main (0x4D) o Baseline (0x42):
   provare solo l'High (avc1.640028) buttava l'export su WebM anche dove
   l'encoder H.264 c'era. Profilo più basso = stessa qualità percepita a
   parità di bitrate su questi bitrate (≤8 Mbps). */
function mp4CodecCandidates() {
  return ['avc1.640028', 'avc1.4D001E', 'avc1.42E01E'];
}

/* Entry MP4: offline più veloce del realtime (niente captureStream: si
   disegnano i frame in ciclo e si passano a VideoEncoder con timestamp). */
async function startVideoRenderMp4(pre, mode) {
  if (!videoMp4Supported()) {
    toast('MP4 non supportato su questo browser, uso WebM.', 'err', 6000);
    videoMp4FallbackToWebm(pre, mode);
    return;
  }
  // Hint hardware ('prefer-hardware'): se il browser lo rifiuta, ripiega su
  // 'no-preference' prima di arrendersi (videoOfflinePickEncoderConfig).
  // Ladder High→Main→Baseline: più device trovano un profilo codificabile.
  let picked = null;
  for (const codec of mp4CodecCandidates()) {
    try {
      const cfg = mp4ConfigFor(pre.res[0], pre.res[1], pre.fps);
      cfg.codec = codec;
      const res = await videoOfflinePickEncoderConfig(cfg);
      if (res.supported) { picked = res; break; }
    } catch (e) {}
  }
  if (videoSessionGone()) return;    // modale chiusa durante il probe encoder
  const mp4Cfg = picked ? picked.cfg : null;
  if (!picked) {
    toast('H.264 non supportato, uso WebM.', 'err', 6000);
    videoMp4FallbackToWebm(pre, mode);
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
      if (videoSessionGone() || (videoJob && videoJob.cancelled)) return;
      toast((e && e.message ? e.message : 'Mappa 3D non disponibile') + ', MP4 in 2D.', 'err', 6000);
      m = '2d';
    }
  }
  // Re-check dopo l'await: chiudere la modale durante il load CDN (~12 s)
  // lasciava partire lo stesso il render MP4 → canvas orfano + video fantasma.
  if (videoSessionGone() || (videoJob && videoJob.cancelled)) return;
  // Muxer assente/non valido: si RIFIUTA (throw), non si risolve in silenzio —
  // il .catch() di startVideoRender (video.js) è l'unico che esegue il fallback
  // realtime WebM; con un return la promessa risolve e il catch non scatta mai,
  // lasciando il toast "Riprova WebM" senza nulla che riprovi.
  let Muxer = null;
  try { Muxer = await loadMp4Muxer(); }
  catch (e) { throw new Error('muxer MP4 non caricato (' + ((e && e.message) || 'errore') + ')'); }
  if (!Muxer || !Muxer.Muxer) throw new Error('muxer MP4 non valido (export mancante)');
  await startVideoRenderMp4Inner(pre, m, Muxer, mp4Cfg);
}

async function startVideoRenderMp4Inner(pre, mode, Muxer, cfg) {
  // Auto-fit qualità sulla RAM: invece di bloccare subito (toast "Video troppo
  // grande"), si scende di bitrate/fps/risoluzione (videoOfflineFitCfg). Solo se
  // nemmeno il floor passa si blocca col messaggio storico. Il picco reale è
  // ~1-1.5× il file (StreamTarget chunked, niente ArrayBufferTarget).
  const fit = typeof videoOfflineFitCfg === 'function' ? videoOfflineFitCfg(cfg, pre) : null;
  if (!fit) {
    const tooBig = videoOfflineGuard(pre, cfg);
    if (tooBig) { toast(tooBig, 'err', 8000); if (els.videoStart) els.videoStart.disabled = false; return; }
  } else {
    if (fit.changed) toast(fit.msg, 'ok', 6000);
    cfg = fit.cfg;
    if (fit.res) pre.res = fit.res;   // canvas mappa/2D e muxer leggono pre.res
  }
  const W = pre.res[0], H = pre.res[1];
  // StreamTarget chunked: i chunk diventano subito Blob (memoria nativa, fuori
  // dall'heap V8). Tenere gli Uint8Array in un array JS saturava l'heap su
  // Chrome Android 32-bit (~512 MB) → crash del tab senza alcun errore.
  // fastStart 'in-memory' teneva TUTTI i sample in RAM (di nuovo 1× extra):
  // via → moov in coda, file valido per il download locale.
  const parts = videoBlobParts();
  const muxerOpts = {
    target: new Muxer.StreamTarget({ chunked: true, onData: (d, pos) => parts.write(d, pos) }),
    video: { codec: 'avc', width: W, height: H },
    // Obbligatoria per il muxer: senza, il costruttore lanciava e ogni export
    // MP4 cadeva sul WebM. false = moov in coda, niente sample tenuti in RAM.
    fastStart: false,
  };
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
    // Throw, non return: il catch di startVideoRender fa ripartire il realtime
    // WebM; qui il resolve silenzioso lasciava la modale aperta e nessun fallback.
    throw new Error('encoder MP4 non configurabile: ' + (e && e.message ? e.message : e));
  }
  // In 3D il canvas master lo crea videoMp4SetupMap (con la mappa): crearlo
  // anche qui lasciava un canvas orfano nel DOM a ogni export.
  const canvas = mode === '3d' ? null : makeVideoCanvas(pre.res);
  const ctx = canvas ? canvas.getContext('2d') : null;
  const job = {
    mode: mode, running: true, cancelled: false, canvas, ctx,
    rows: pre.rows, track: pre.track, mapPts: pre.mapPts, mapT: pre.mapT, spark: pre.spark,
    dist: pre.dist, tEnd: pre.tEnd, mult: pre.mult, speedMax: pre.speedMax,
    slow: pre.slow, tSim: pre.rows.length ? pre.rows[0].t : 0,
    mp4: { enc, muxer, frame: 0, fps: cfg.framerate || 30 },
  };
  videoJob = job;
  els.videoStart.disabled = true;
  els.videoStatus.textContent = 'Encode MP4…';
  // Errori persistenti nella riga di stato (come nel ramo WebM): la modale
  // resta aperta e l'utente legge il motivo invece di vedere la finestra sparire.
  const failStatus = why => {
    try { enc.close(); } catch (e2) {}
    cleanupVideoJob(job);
    videoJob = null;
    const w = (why && why.message) || why || 'errore';
    toast('Encode MP4 fallito: ' + w + '. Riprova WebM.', 'err', 10000);
    els.videoStatus.textContent = 'Encode MP4 fallito: ' + w;
    if (els.videoStart) els.videoStart.disabled = false;
  };
  try {
    if (mode === '3d') await videoMp4SetupMap(job, pre);
    await videoMp4Loop(job, W, H);
  } catch (e) {
    failStatus((e && e.message ? e.message : String(e)) ||
      (encErr && encErr.message ? encErr.message : 'errore'));
    return;
  }
  // Encoder morto a metà: il loop esce con encState.encErr e senza questo
  // controllo si arrivava a finalize() con un file troncato ma valido, mostrando
  // il toast di successo per un video rotto.
  let fail = encErr || job.mp4.encErr;
  try { await enc.flush(); } catch (e) { fail = fail || e; }
  if (fail) {
    failStatus(fail);
    return;
  }
  let blob = null;
  try {
    muxer.finalize();
    blob = parts.blob('video/mp4');
  } catch (e) {
    failStatus(e);
    return;
  }
  cleanupVideoJob(job);
  videoJob = null;
  if (job.cancelled || !blob || !blob.size) {
    toast('Render prodotto vuoto (encoder senza dati).', 'err', 10000);
    els.videoStatus.textContent = 'Render prodotto vuoto (encoder senza dati).';
    if (els.videoStart) els.videoStart.disabled = false;
    return;
  }
  closeVideoModal();
  downloadBlob('cruscotto_video_' + stamp() + '.mp4', blob, 'video/mp4');
  toast('Video MP4 esportato.', 'ok');
}
