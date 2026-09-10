'use strict';
/* js/video-offline.js: loop di encode offline condiviso da MP4 e WebM
   (WebCodecs VideoEncoder, niente captureStream: si disegna ogni frame e lo
   si passa con timestamp calcolato dalla riga, molto più veloce del realtime
   MediaRecorder+captureStream perché non è legato al wall-clock).
   Ordine: dopo js/video3d.js (riusa video3DBuildJob/drawVideoFrame), prima
   dei muxer vendorizzati e di js/video-mp4.js/js/video-webm.js. */

/* --- tarature loop offline (prima letterali sparsi) --- */
const OFF_MAX_FRAMES = 1 << 24;      // ~155 h a 30 fps: guardia anti-loop infinito
const OFF_ENC_QUEUE_HI = 8;          // sopra questo l'encoder è saturo: si aspetta
const OFF_ENC_QUEUE_LO = 4;          // sotto questo si riprende a codificare
const OFF_MAP_READY_MS = 6000;       // guardia su style.load delle tile 3D
const OFF_MIN_RAM_BYTES = 256 * 1024 * 1024;  // floor della stima RAM disponibile

/* Pura: passo frame dal framerate (30 fps -> 33333 µs). */
function videoOfflineFrameStepUs(fps) {
  const f = isFinite(fps) && fps > 0 ? fps : 30;
  return Math.round(1e6 / f);
}

/* Pura: durata video risultante in secondi, applicando mult+slow-mo (stessa
   progressione di videoOfflineLoop). Serve per la stima della dimensione finale
   PRIMA di avviare l'encode. */
function videoOfflineDurSec(rows, stepUs, slow) {
  const n = rows ? rows.length : 0;
  if (!n) return 0;
  const t0 = rows[0].t, tEnd = rows[rows.length - 1].t;
  if (!(tEnd > t0)) return 0;
  const s = slow || { base: 1 };
  const stepSec = stepUs / 1e6;
  let tSim = t0, frames = 0;
  while (tSim < tEnd && frames < 10000000) {
    tSim += stepSec * slowMultAt(tSim, s);
    frames++;
  }
  return frames * stepSec;
}

/* Pura: stima prudente dei byte dell'export (bitrate × durata). Il muxer
   ArrayBufferTarget raddoppia il buffer e finalize() fa una slice integrale:
   il picco di RAM è ~2-3× la dimensione del file. Su un'ora a 1080p si superano
   i GB e il tab mobile va in OOM senza alcun errore visibile. */
function videoOfflineEstBytes(cfg, durSec) {
  const bps = (cfg && isFinite(cfg.bitrate) && cfg.bitrate > 0) ? cfg.bitrate : 5000000;
  return (bps / 8) * Math.max(0, durSec);
}
/* Soglia RAM adattiva: navigator.deviceMemory (GB, Chrome) se presente, altrimenti
   stima prudente (4 GB). Con il muxer in StreamTarget (chunked, niente
   ArrayBufferTarget) il picco è ~1-1.5× la dimensione del file: il cap sul file
   può salire da mem/4 a mem*384MB (4 GB → 1.5 GB) senza rischiare l'OOM. */
function videoOfflineMaxBytes() {
  let mem = 4;
  try { if (typeof navigator !== 'undefined' && navigator.deviceMemory) mem = navigator.deviceMemory; } catch (e) {}
  if (!isFinite(mem) || mem <= 0) mem = 4;
  return Math.max(OFF_MIN_RAM_BYTES, Math.floor(mem * 384 * 1024 * 1024));
}

/* Pura: ladder bitrate (bps) per dimensione frame. Primo gradino = scelta
   attuale (videoBitrateFor), ultimo = floor prima del blocco. Chiave su
   max(W,H): il 9:16 (720×1280) ha lo stesso budget del 720p, un 480p
   (854×480) scende di fascia. */
function videoFitBitrateLadder(W, H) {
  const m = Math.max(isFinite(W) ? W : 0, isFinite(H) ? H : 0);
  if (m >= 1920) return [8000000, 5000000, 3500000, 2500000, 1500000, 1000000, 750000];
  if (m >= 1280) return [5000000, 3500000, 2500000, 1500000, 1000000, 750000];
  return [2500000, 1500000, 1000000, 750000];
}

/* Pura: scala la risoluzione quando il bitrate scende (stesso aspect, lati
   pari). Sotto 3.5 Mbps → 75% dei lati (~0.56 dei pixel); sotto 1.5 → 50%
   (~0.25 pixel): l'encoder software del telefono (VP8) ci mette 2-4× meno e
   la qualità percepita resta la stessa a bitrate bassi. Sopra 3.5 → null. */
function videoFitResFor(res, bps) {
  const w = res && isFinite(res[0]) ? res[0] : 1280;
  const h = res && isFinite(res[1]) ? res[1] : 720;
  const sc = bps < 1500000 ? 0.5 : (bps < 3500000 ? 0.75 : 1);
  if (sc >= 1) return null;
  const nw = Math.max(320, Math.round(w * sc / 2) * 2);
  const nh = Math.max(320, Math.round(h * sc / 2) * 2);
  if (nw === w && nh === h) return null;
  return [nw, nh];
}

/* Pura: fit automatico di bitrate/fps/risoluzione perché l'export stia nella
   RAM del device e non sia un calvario di encode software. A bitrate fisso la
   dimensione file NON dipende dalla risoluzione: il bitrate si taglia per la
   RAM, fps e risoluzione scendono per la velocità (e la qualità percepita).
   maxBytes opzionale: il realtime passa un cap più basso (chunk MediaRecorder
   nell'heap JS, non StreamTarget). Ritorna {cfg, res, changed, msg} con cfg
   adattato (o identico se ci sta già) e res = nuove dimensioni o null;
   null come return se nemmeno il floor della ladder passa. */
function videoOfflineFitCfg(cfg, pre, maxBytes) {
  const c = cfg || {};
  const bps0 = isFinite(c.bitrate) && c.bitrate > 0 ? c.bitrate : 5000000;
  const fps0 = isFinite(c.framerate) && c.framerate > 0 ? c.framerate : 30;
  const res = (pre && pre.res) || [1280, 720];
  const durSec = videoOfflineDurSec(pre && pre.rows, videoOfflineFrameStepUs(30),
    (pre && pre.slow) || { base: (pre && pre.mult) || 1 });
  if (!(durSec > 0)) {
    return { cfg: Object.assign({}, c, { bitrate: bps0, framerate: fps0 }), changed: false, msg: '', res: null };
  }
  const cap = isFinite(maxBytes) && maxBytes > 0 ? maxBytes : videoOfflineMaxBytes();
  const allowedBps = cap * 8 / durSec;
  if (bps0 <= allowedBps) {
    return { cfg: Object.assign({}, c, { bitrate: bps0, framerate: fps0 }), changed: false, msg: '', res: null };
  }
  let bps = 0;
  for (const b of videoFitBitrateLadder(res[0], res[1])) {
    if (b <= allowedBps) { bps = Math.min(bps0, b); break; }
  }
  if (!bps) return null;
  let fps = fps0;
  if (bps < 1500000) fps = 15; else if (bps < 3500000) fps = 24;
  const newRes = videoFitResFor(res, bps);
  const outCfg = Object.assign({}, c, { bitrate: bps, framerate: fps });
  if (newRes) { outCfg.width = newRes[0]; outCfg.height = newRes[1]; }
  const mbps = Math.round(bps / 100000) / 10;   // 3.5 Mbps, 0.75 Mbps, 1 Mbps
  const msg = 'Qualità ridotta automaticamente per memoria: ' + mbps + ' Mbps' +
    (fps < fps0 ? ' · ' + fps + ' fps' : '') +
    (newRes ? ' · ' + newRes[0] + '×' + newRes[1] : '') + '.';
  return { cfg: outCfg, changed: true, msg, res: newRes };
}

/* Ritorna un messaggio d'errore (o null) se l'export stimato supera la RAM
   disponibile. Va chiamata prima di creare muxer/encoder. */
function videoOfflineGuard(pre, cfg) {
  const durSec = videoOfflineDurSec(pre.rows, videoOfflineFrameStepUs(30), pre.slow || { base: pre.mult || 1 });
  const bytes = videoOfflineEstBytes(cfg, durSec);
  const maxBytes = videoOfflineMaxBytes();
  if (bytes > maxBytes) {
    return 'Video troppo grande per la RAM del dispositivo (stimato ~' +
      Math.round(bytes / 1048576) + ' MB, limite ~' + Math.round(maxBytes / 1048576) +
      ' MB). Riduci la durata o la risoluzione.';
  }
  return null;
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
    const timer = setTimeout(ok, OFF_MAP_READY_MS);
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
  const stepSec = stepUs / 1e6;
  const rows = job.rows;
  if (!rows.length) return;
  const t0 = rows[0].t;
  const tEnd = rows[rows.length - 1].t;
  const slow = job.slow || { base: job.mult || 1 };
  let vf = null;
  try { vf = new VideoFrame(job.canvas, { timestamp: 0, duration: stepUs }); } catch (e) { vf = null; }
  if (vf) { try { vf.close(); } catch (e) {} }
  // Velocità/slow-mo: come il loop realtime (videoLoop in video.js), tSim avanza
  // di stepSec*slowMultAt per frame e drawVideoFrame pesca la riga via findRowAt.
  // Prima il loop scorreva 1:1 sui campioni e ignorava del tutto il moltiplicatore
  // selezionato (un export "12×" produceva comunque un video 1:1).
  let tSim = t0;
  let k = 0;
  const maxFrames = OFF_MAX_FRAMES;   // guardia anti-loop infinito
  while (tSim < tEnd && k < maxFrames) {
    if (job.cancelled) return;
    job.tSim = tSim;
    drawVideoFrame(job, stepSec);
    const ts = Math.round(k * stepUs);
    let frame = null;
    try { frame = new VideoFrame(job.canvas, { timestamp: Math.max(0, ts), duration: stepUs }); }
    catch (e) { frame = null; }
    if (frame) {
      // Backpressure: se l'encoder è saturo aspetta (niente OOM su giri lunghi).
      try {
        if (enc.encodeQueueSize > OFF_ENC_QUEUE_HI) {
          await new Promise(res => {
            let n = 0;
            const tick = () => {
              if (job.cancelled || enc.encodeQueueSize <= OFF_ENC_QUEUE_LO || ++n > 200) { res(); return; }
              setTimeout(tick, 10);
            };
            tick();
          });
        }
        // L'await sopra può risolversi su cancel: senza il ri-check si codifica
        // comunque il frame pendente e la UI qui sotto continua a scrivere
        // progress di un job stantio sopra quella del render corrente.
        if (job.cancelled) break;
        enc.encode(frame, { keyFrame: encState.frame % keyframeEvery === 0 });
      } catch (e) {
        // Encoder morto a metà (throttling termico, backgrounding): senza questo
        // il loop continuava a fallire silenziosamente fino a finalize() con un
        // file troncato ma sintatticamente valido.
        encState.encErr = encState.encErr || e;
        try { frame.close(); } catch (e2) {}
        break;
      }
      try { frame.close(); } catch (e) {}
    }
    encState.frame++;
    // UI viva: yield ogni 15 frame + progress (loop da migliaia di frame).
    if (encState.frame % 15 === 0) {
      const pct = Math.min(100, Math.round(((tSim - t0) / Math.max(1e-9, tEnd - t0)) * 100));
      els.videoProg.style.width = pct + '%';
      els.videoStatus.textContent = 'Encode ' + label + ' ' + pct + '%';
      await new Promise(res => setTimeout(res, 0));
    }
    tSim += stepSec * slowMultAt(tSim, slow);
    k++;
  }
  // Frame finale: il loop esce quando tSim raggiunge tEnd SENZA codificarlo —
  // il video risultava più corto di un frame e l'ultimo istante del giro spariva.
  if (!job.cancelled && !encState.encErr) {
    job.tSim = tEnd;
    drawVideoFrame(job, stepSec);
    let frame = null;
    try { frame = new VideoFrame(job.canvas, { timestamp: Math.round(k * stepUs), duration: stepUs }); }
    catch (e) { frame = null; }
    if (frame) {
      try { enc.encode(frame, { keyFrame: true }); } catch (e) { encState.encErr = encState.encErr || e; }
      try { frame.close(); } catch (e) {}
      encState.frame++;
    }
  }
}
