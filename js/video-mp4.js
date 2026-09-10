'use strict';
/* js/video-mp4.js: export MP4 (WebCodecs + mp4-muxer vendored) + audio motore.
   Ordine: dopo js/video-offline.js (loop di encode condiviso con il WebM
   offline) e js/video3d.js (riusa pre/makeVideoCanvas/drawVideoFrame), prima
   di js/share.js. Tutto impuro qui resta non testato in harness: solo le
   pure (mp4ConfigFor/engineToneFor/windGainFor/mp4FrameStepUs) vanno
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

/* --- audio sintetico: profili (prima letterali 60/2.2 e v/130*0.15) --- */
const ENGINE_BASE_HZ = 60;        // frequenza motore da fermo
const ENGINE_HZ_PER_KMH = 2.2;    // incremento per km/h
const WIND_GAIN_RATE = 1 / 130;   // guadagno vento per km/h
const WIND_GAIN_MAX = 0.15;       // saturazione del vento a 130+

/* Pura: frequenza motore da velocità (saw 60 Hz fermo → ~320 a 120 km/h). */
function engineToneFor(speedKmh) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  return ENGINE_BASE_HZ + v * ENGINE_HZ_PER_KMH;
}

/* Pura: guadagno vento da velocità (0 fermo → 0.15 a 130+). */
function windGainFor(speedKmh) {
  const v = isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  return Math.min(1, v * WIND_GAIN_RATE) * WIND_GAIN_MAX;
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
  await videoOfflineLoop(job, job.mp4, { fps: job.mp4.fps || 30, keyframeEvery: 150, label: 'MP4' });
  void W; void H;
}

/* Audio AAC sintetico offline: saw motore (engineToneFor) + rumore bianco
   (windGainFor), 44.1 kHz mono. Niente ScriptProcessor: campioni generati
   dagli stessi profili del graph live, timestamp dalla t delle righe.
   ASYNC con yield periodici: prima il while girava sincrono dentro la Promise
   e per sessioni lunghe congelava l'UI — "Annulla" incluso, che non poteva
   mai essere processato. */
async function videoMp4MuxAudio(muxer, rows, slow, stepUs) {
  try {
    if (typeof AudioEncoder === 'undefined' || !rows.length) return false;
    const SR = 44100;
    let aErr = null;   // gli errori encoder non devono essere swallowati: il
                       // file uscirebbe (quasi) muto senza alcun avviso
    const aenc = new AudioEncoder({
      output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) {} },
      error: e => { aErr = aErr || e; },
    });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 1, bitrate: 128000 });
    const t0 = rows[0].t, tEnd = rows[rows.length - 1].t;
    const s = slow || { base: 1 };
    const stepUs_ = (stepUs && stepUs > 0) ? stepUs : 33333;
    const stepSec = stepUs_ / 1e6;
    const SAMP_FRAME = Math.round(SR * stepSec);
    let tsUs = 0, phase = 0;
    // Chunk da 0.5 s: pochi encode, memoria costante.
    const CH = Math.floor(SR / 2);
    let cur = new Float32Array(CH), n = 0;
    const flushCur = () => {
      if (!n) return;
      const data = new AudioData({
        format: 'f32', sampleRate: SR, numberOfFrames: n, numberOfChannels: 1,
        timestamp: tsUs, data: cur.slice(0, n).buffer,
      });
      tsUs += Math.round((n / SR) * 1e6);
      try { aenc.encode(data); } catch (e) { aErr = aErr || e; }
      try { data.close(); } catch (e) {}
      n = 0;
    };
    // L'audio scorre nel TEMPO VIDEO (stessa progressione tSim di videoOfflineLoop),
    // non nel tempo delle righe: altrimenti mult/slow-mo desincronizzerebbero
    // audio e video. Pitch/vento letti dalla riga a tSim via findRowAt.
    let tSim = t0, k = 0;
    while (tSim < tEnd) {
      const i = Math.max(0, findRowAt(rows, tSim));
      const r = rows[i] || {};
      const f = engineToneFor(r.speedKmh || 0), g = windGainFor(r.speedKmh || 0);
      for (let s2 = 0; s2 < SAMP_FRAME; s2++) {
        phase += f / SR;
        cur[n++] = ((phase % 1) * 2 - 1) * 0.06 + (Math.random() * 2 - 1) * g;
        if (n >= CH) flushCur();
      }
      tSim += stepSec * slowMultAt(tSim, s);
      k++;
      // Yield ogni ~4 s di audio: UI viva, "Annulla" processabile, progress.
      if (k % 120 === 0) {
        await new Promise(res => setTimeout(res, 0));
        if (typeof videoJob !== 'undefined' && videoJob && videoJob.cancelled) {
          try { aenc.close(); } catch (e) {}
          return false;
        }
      }
    }
    flushCur();
    if (aErr) { try { aenc.close(); } catch (e2) {} return false; }
    await new Promise((res, rej) => {
      aenc.flush().then(() => res()).catch(err => rej(err));
    });
    try { aenc.close(); } catch (e) {}
    return true;
  } catch (e) { return false; }
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
  const picked = await videoOfflinePickEncoderConfig(mp4ConfigFor(pre.res[0], pre.res[1]));
  if (videoSessionGone()) return;    // modale chiusa durante il probe encoder
  const mp4Cfg = picked.cfg;
  if (!picked.supported) {
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
  const W = pre.res[0], H = pre.res[1];
  // Auto-fit qualità sulla RAM: invece di bloccare subito (toast "Video troppo
  // grande"), si prova a scendere di bitrate/fps (videoOfflineFitCfg). Solo se
  // nemmeno il floor passa si blocca col messaggio storico. Il picco reale è
  // ~1-1.5× il file (StreamTarget chunked, niente ArrayBufferTarget).
  const fit = typeof videoOfflineFitCfg === 'function' ? videoOfflineFitCfg(cfg, pre) : null;
  if (!fit) {
    const tooBig = videoOfflineGuard(pre, cfg);
    if (tooBig) { toast(tooBig, 'err', 8000); if (els.videoStart) els.videoStart.disabled = false; return; }
  } else {
    if (fit.changed) toast(fit.msg, 'ok', 6000);
    cfg = fit.cfg;
  }
  const muted = !!(els.videoAudio && els.videoAudio.value === 'off');
  // StreamTarget chunked: i chunk finiscono in parts e il picco RAM resta
  // ~1× il file (ArrayBufferTarget cresceva 2× + slice finale). fastStart
  // 'in-memory' teneva TUTTI i sample in RAM (di nuovo 1× extra): via → moov
  // in coda, file valido per il download locale (social ri-encodano comunque).
  const parts = [];
  const muxerOpts = {
    target: new Muxer.StreamTarget({ chunked: true, onData: (d, pos) => parts.push(d) }),
    video: { codec: 'avc', width: W, height: H },
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
    // Throw, non return: il catch di startVideoRender fa ripartire il realtime
    // WebM; qui il resolve silenzioso lasciava la modale aperta e nessun fallback.
    throw new Error('encoder MP4 non configurabile: ' + (e && e.message ? e.message : e));
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
    dist: pre.dist, tEnd: pre.tEnd, mult: pre.mult, speedMax: pre.speedMax,
    slow: pre.slow, tSim: pre.rows.length ? pre.rows[0].t : 0,
    mp4: { enc, muxer, ag: null, frame: 0, _lastV: null, fps: cfg.framerate || 30 },
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
  // Audio dopo il video: scorre nel tempo video (mult+slow-mo), non nel tempo
  // delle righe, così resta sincrono con il video.
  if (!muted) {
    els.videoStatus.textContent = 'Audio MP4…';
    let audioOk = false;
    try { audioOk = await videoMp4MuxAudio(muxer, pre.rows, pre.slow, videoOfflineFrameStepUs(job.mp4.fps || 30)); } catch (e) {}
    // Se AudioEncoder c'è e la sintesi fallisce, la traccia audio è già stata
    // dichiarata nel muxer: avvisa che il file uscirà (quasi) muto, invece di
    // consegnare un MP4 con traccia audio vuota e nessun segnale.
    if (!audioOk && typeof AudioEncoder !== 'undefined') {
      toast('Audio non disponibile: MP4 esportato senza audio.', 'err', 6000);
    }
  }
  let blob = null;
  try {
    muxer.finalize();
    blob = new Blob(parts, { type: 'video/mp4' });
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
