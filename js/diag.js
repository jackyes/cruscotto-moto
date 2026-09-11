'use strict';
/* js/diag.js (step 27): charts (sample/draw), avg, updateDiag, bench state/start/finish. Ordine: dopo js/map.js. */
function sampleCharts(now) {
  pushBounded(state.chartBuf, { t: now, speedKph: state.speedKph, lean: state.lean, latG: state.latG, lonG: state.lonG }, null, CHART_WINDOW, e => e.t);
}

/* Pura: tick "belli" 1/2/5x10^k per griglie orizzontali (specchio viewer). */
function diagTicks(min, max, n) {
  const count = Math.max(2, n || 4);
  if (!isFinite(min) || !isFinite(max) || max <= min) return [min];
  const raw = (max - min) / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    const r = Math.round(v * 1e9) / 1e9;
    out.push(r === 0 ? 0 : r);
  }
  return out.length ? out : [min];
}

/* Pura: min/max per i 3 grafici live, testabile senza canvas. L'asse zero non è
   un campo a parte: lo marca il loop dei tick di drawChart quando 0 cade nella
   scala. Il vecchio `zero` non era letto da nessuno. */
function diagChartScale(field, buf) {
  if (field === 'speedKph') {
    let maxSp = 80;
    for (const d of buf) if (d.speedKph > maxSp) maxSp = d.speedKph;
    maxSp = Math.ceil(maxSp / 20) * 20 + 20;
    return { min: 0, max: maxSp };
  }
  if (field === 'lean') return { min: -60, max: 60 };
  return { min: -1.2, max: 1.2 };
}

function drawChart(canvas, data, field, color, min, max) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  const h = canvas.clientHeight || 120;
  // Ridimensiona SOLO se cambia: riassegnare width/height a ogni draw (15 Hz su
  // 3 grafici) riallocava il backing store e svuotava il canvas inutilmente.
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = canvasTheme.get('c-bg'); ctx.fillRect(0, 0, w, h);
  if (!data.length) return { min: null, max: null };
  const t0 = data[0].t, t1 = data[data.length - 1].t;
  const span = Math.max(1, t1 - t0);
  /* Gutter a sinistra per le label dei tick (disegnate a x=2): la traccia parte
     da lì, non da x=0. Prima X() partiva da 0 e ogni linea della griglia tagliava
     il tracciato. */
  const gx = 30;
  const X = t => gx + ((t - t0) / span) * (w - gx);
  const pad = 8;
  const Y = v => h - pad - ((v - min) / (max - min)) * (h - 2 * pad);

  // Griglia orizzontale con label + asse zero marcato (prima solo zero line:
  // senza scala i G erano illeggibili al sole).
  ctx.lineWidth = 1;
  const ticks = diagTicks(min, max, 4);
  for (const tv of ticks) {
    const y = Y(tv);
    ctx.strokeStyle = tv === 0 ? canvasTheme.get('c-axis') : canvasTheme.get('c-grid');
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillStyle = canvasTheme.get('c-axis'); ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    try { ctx.fillText(String(tv), 2, y - 2); } catch (e) {}
  }
  /* Il vecchio parametro zeroLine non era mai letto: l'asse zero lo marca già il
     loop dei tick con `tv === 0`. 0 è sempre tra i tick quando sta nel range
     (diagTicks parte da ceil(min/step)*step ≤ 0 e arriva fino a max), quindi non
     serve nessun ramo dedicato. */

  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  /* Clip al riquadro del tracciato: un valore fuori scala (piega oltre ±60°)
     usciva dal canvas e finiva sopra le label dei tick. */
  ctx.save();
  ctx.beginPath(); ctx.rect(gx, 0, w - gx, h); ctx.clip();
  ctx.beginPath();
  let dMin = Infinity, dMax = -Infinity;
  data.forEach((d, i) => {
    const v = d[field];
    if (v != null && isFinite(v)) { if (v < dMin) dMin = v; if (v > dMax) dMax = v; }
    const x = X(d.t), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
  return { min: isFinite(dMin) ? dMin : null, max: isFinite(dMax) ? dMax : null };
}

function drawCharts() {
  const buf = state.chartBuf;
  const sc = diagChartScale('speedKph', buf);
  const spd = drawChart(els.chSpeed, buf, 'speedKph', canvasTheme.get('c-accent'), sc.min, sc.max);
  drawChart(els.chLean, buf, 'lean', canvasTheme.get('c-good'), -60, 60);
  const lat = drawChart(els.chLat, buf, 'latG', canvasTheme.get('c-warn'), -1.2, 1.2);
  /* Punta MISURATA nella finestra, non il fondo scala dell'asse: sc.max è
     ceil(punta/20)*20+20 con base 80, quindi a 62 km/h veri l'etichetta diceva
     "100 km/h" e a inizio sessione, a zero campioni, pure. Il badge G accanto
     mostra i min/max misurati: stessa semantica qui, '—' a buffer vuoto.
     La scala dell'asse resta leggibile dai tick disegnati sulla griglia. */
  els.chSpeedMax.textContent = spd.max == null ? '—' : Math.round(spd.max) + ' km/h';
  try {
    let lbl = document.getElementById('chLatMinMax');
    if (lbl) lbl.textContent = (lat.min == null ? '—' : lat.min.toFixed(2) + '/' + lat.max.toFixed(2) + ' G live');
  } catch (e) {}
}

const avg = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);


/* Livello Utente della diagnostica: una riga di verdetto sempre visibile,
   i 17 numeri restano per il livello Esperto. Pura sul verdetto, testabile. */
function diagVerdict(state) {
  if (!state.calib && !state.demo) return 'Non calibrato: premi Calibra a moto ferma.';
  const vib = state.vibG || 0;
  if (vib < 0.15) return 'Sensori OK — vibrazione bassa, lettura affidabile.';
  if (vib < 0.35) return 'Vibrazione media — lettura valida, verifica il supporto.';
  return 'Vibrazione alta — la piega potrebbe degradare, smorza il supporto.';
}

function updateDiag() {
  // Verdetto ricalcolato e scritto SOLO se cambia: a 15 Hz (pannello chiuso
  // compreso) si riscriveva lo stesso textContent a ogni tick per niente.
  const v = 'Stato sensori: ' + diagVerdict(state);
  if (els.diagVerdict && els.diagVerdict.textContent !== v) els.diagVerdict.textContent = v;
  if (!els.diagPanel.open) return;
  els.dgHz.textContent = state.sensorHz ? state.sensorHz.toFixed(0) + ' Hz' : '—';
  els.dgVib.textContent = state.vibG.toFixed(3) + ' g';
  els.dgNorm.textContent = state.gRatio.toFixed(3) + ' g';
  els.dgK.textContent = (state.calib || state.demo) ? (state.attTrust * 100).toFixed(0) + ' %' : '—';
  const b = state.attBias || { x: 0, y: 0, z: 0 };
  els.dgBias.textContent = (state.calib && state.hasGyro)
    ? (state.leanBias || 0).toFixed(2) + ' °/s rollio · |b| ' + vlen(b).toFixed(2)
    : 'non stimato';
  els.dgLean.textContent = (state.calib || state.demo) ? state.lean.toFixed(1) + '°' : 'non calibrato';

  const g2 = v => (v >= 0 ? '+' : '') + v.toFixed(2);
  els.dgAcc.textContent = g2(state.latG) + ' / ' + g2(state.lonG) + ' / ' + g2(state.vertG);
  els.dgAccGps.textContent = (state.latGps == null ? '—' : g2(state.latGps)) + ' / ' +
                             (state.lonGps == null ? '—' : g2(state.lonGps));
  els.dgAccBias.textContent = state._abPending ? 'misura in corso…'
    : (state.accBias ? g2(state.accBias.lat) + ' / ' + g2(state.accBias.lon) + ' / ' + g2(state.accBias.vert)
                     : 'non stimato');
  els.dgGrav.textContent = (state.gravNative ? 'fusione di piattaforma' : 'da attitudine (g·û)') +
    (state.gravAgreeDeg != null ? ' · Δ ' + state.gravAgreeDeg.toFixed(1) + '°' : '');
  els.dgAdapt.textContent = '×' + (state.vibScaleVal || 1).toFixed(2) +
    ' · Kp ' + (state.attKp || ATT_KP).toFixed(2) + ' /s';
  els.dgRect.textContent = (state.vibRectG != null && Math.abs(state.vibRectG) > 0.005)
    ? g2(state.vibRectG) + ' g' + (state.rectNull ? ' (corretto)' : '') : 'non rilevato';

  const REF = { centrip: 'compensato (curva valida)', norm: 'da norma (senza GPS)',
                raw: 'accelerometro grezzo', gyro: 'solo giroscopio',
                wdog: 'riancoraggio di sicurezza (nessun riferimento)', none: '—' };
  els.dgRef.textContent = REF[state.attRef] || '—';
  els.dgSrc.textContent = state.sensorSrc === 'generic' ? 'Generic Sensor API'
    : (state.sensorSrc === 'devicemotion' ? 'devicemotion' : '—');
  els.dgPitch.textContent = (state.calib || state.demo)
    ? state.pitch.toFixed(1) + '° · imbardata ' + state.gyroYaw.toFixed(0) + ' °/s' : '—';
  els.dgLeanKin.textContent = (state.leanKin != null && state.speedFusMs > CENTRIP_MIN_MS)
    ? state.leanKin.toFixed(1) + '°' : '—';
  els.dgSpeed.textContent = (state.speedFusMs * 3.6).toFixed(1) + ' km/h' +
    (state.speedGpsMs != null ? ' (GPS ' + (state.speedGpsMs * 3.6).toFixed(1) + ')' : ' (GPS n/d)');
  els.dgSign.textContent = (state.gyroSign > 0 ? '+1' : '−1') +
    (state.gyroSignLocked ? ' (verificato)' : ' (in verifica)');
  els.dgVibHi.textContent = state.vibHiG.toFixed(3) + ' g';
}

let benchTimer = null, bench = null;


function startBench() {
  if (benchTimer) return;
  if (!state.calib && !state.demo) { toast('Calibra prima di eseguire il test.', 'err'); return; }
  bench = { t0: Date.now(), lean: [], vib: [], hz: [], lat: [], lon: [], vert: [],
            vibHi: [], pitch: [], src: state.sensorSrc, grav: state.gravNative,
            sign: state.gyroSign, signOk: state.gyroSignLocked };
  els.btnBench.disabled = true;
  els.benchOut.textContent = 'Test in corso… tieni la moto ferma e dritta.';
  benchTimer = setInterval(() => {
    bench.lean.push(state.lean);
    bench.vib.push(state.vibG);
    // A moto ferma anche queste tre valgono 0 per costruzione: tre riferimenti in più
    bench.lat.push(state.latG);
    bench.lon.push(state.lonG);
    bench.vert.push(state.vertG);
    bench.vibHi.push(state.vibHiG);
    bench.pitch.push(state.pitch);
    if (state.sensorHz) bench.hz.push(state.sensorHz);
    const el = (Date.now() - bench.t0) / 1000;
    if (el >= BENCH_SEC) finishBench();
    else els.benchOut.textContent = 'Test in corso… ' + Math.ceil(BENCH_SEC - el) + ' s';
  }, 50);
}

function finishBench() {
  clearInterval(benchTimer); benchTimer = null;
  els.btnBench.disabled = false;
  /* Il referto consuma i campioni e li libera: senza questo l'oggetto (BENCH_SEC
     a 50 ms per 8 array) restava vivo per tutta la pagina, e una seconda chiamata
     riscriverebbe il referto VECCHIO come se fosse nuovo — la guardia qui sotto
     non era raggiungibile proprio perché nessuno azzerava mai bench. */
  const b = bench;
  bench = null;
  if (!b) return;                       // startBench era uscito subito (non calibrato)
  const L = b.lean, V = b.vib;
  if (L.length < 10) { els.benchOut.textContent = 'Dati insufficienti: riprova.'; return; }

  const absL = L.map(Math.abs);
  const meanAbs = avg(absL);
  let maxAbs = 0; for (const v of absL) if (v > maxAbs) maxAbs = v;
  const drift = L[L.length - 1] - L[0];
  const vMean = avg(V);
  let vMax = 0; for (const v of V) if (v > vMax) vMax = v;
  const hz = b.hz.length ? avg(b.hz) : 0;

  // Residui delle tre accelerazioni: a moto ferma il valore vero è 0 su tutte
  const resid = ch => {
    const a = b[ch].map(Math.abs);
    if (!a.length) return { m: 0, x: 0 };
    let x = 0; for (const v of a) if (v > x) x = v;
    return { m: avg(a), x };
  };
  const rLat = resid('lat'), rLon = resid('lon'), rVert = resid('vert');
  const accWorst = Math.max(rLat.m, rLon.m, rVert.m);

  let verdict, cls;
  if (maxAbs < 1.5 && Math.abs(drift) < 1 && accWorst < 0.05) { verdict = 'Ottimo — lettura stabile'; cls = 'ok'; }
  else if (maxAbs < 3 && Math.abs(drift) < 2.5 && accWorst < 0.12) { verdict = 'Accettabile — errore contenuto'; cls = 'warn'; }
  else { verdict = 'Problema — errore oltre soglia'; cls = 'bad'; }

  const vLbl = vMean < 0.15 ? 'bassa' : (vMean < 0.35 ? 'media' : 'alta');

  const out = els.benchOut;
  out.textContent = '';
  const v = document.createElement('span');
  v.className = 'verdict ' + cls;
  v.textContent = verdict;
  out.appendChild(v);

  const rows = [
    ['Errore piega medio', meanAbs.toFixed(2) + '°'],
    ['Errore piega max', maxAbs.toFixed(2) + '°'],
    ['Deriva sui ' + BENCH_SEC + ' s', (drift >= 0 ? '+' : '') + drift.toFixed(2) + '°'],
    ['Vibrazione media', vMean.toFixed(3) + ' g (' + vLbl + ')'],
    ['Vibrazione max', vMax.toFixed(3) + ' g'],
    ['Residuo laterale', rLat.m.toFixed(3) + ' g medio, ' + rLat.x.toFixed(3) + ' max'],
    ['Residuo longitudinale', rLon.m.toFixed(3) + ' g medio, ' + rLon.x.toFixed(3) + ' max'],
    ['Residuo verticale', rVert.m.toFixed(3) + ' g medio, ' + rVert.x.toFixed(3) + ' max'],
    ['Frequenza sensore', hz ? hz.toFixed(0) + ' Hz' : 'n/d'],
    ['Vibrazione fuori banda', avg(b.vibHi).toFixed(3) + ' g medio'],
    ['Beccheggio letto', avg(b.pitch).toFixed(2) + '° (atteso 0 su piano)'],
    ['Sorgente sensori', b.src === 'generic' ? 'Generic Sensor API (timestamp hardware)'
      : (b.src === 'devicemotion' ? 'devicemotion (timestamp di arrivo)' : b.src)],
    ['Gravità', b.grav ? 'fusione di piattaforma' : 'da attitudine (g·û)'],
    ['Segno giroscopio', (b.sign > 0 ? '+1' : '−1') + (b.signOk ? ' (verificato)' : ' (non ancora verificato)')],
  ];
  for (const [k, val] of rows) {
    const d = document.createElement('div');
    d.textContent = k + ': ' + val;
    out.appendChild(d);
  }

  /* Con campionamento a f Hz, una vibrazione a f Hz esatti si ripiega su 0 Hz:
     diventa un offset costante, indistinguibile da una piega vera. Sotto i regimi
     a cui succede, calcolati sulla frequenza realmente misurata. */
  if (!b.signOk) {
    const d = document.createElement('div');
    d.style.marginTop = '8px';
    d.textContent = 'Il segno del giroscopio non è ancora stato verificato: si determina da solo ' +
      'nei primi metri a passo d\'uomo, oppure inclinando la moto a mano da ferma. ' +
      'Finché non è verificato, la piega in curva può risultare invertita.';
    out.appendChild(d);
  }

  if (hz) {
    const rpm4 = Math.round(hz * 30), rpm2 = Math.round(hz * 60), rpm1 = Math.round(hz * 120);
    const d = document.createElement('div');
    d.style.marginTop = '8px';
    d.textContent = 'Regimi critici a ' + hz.toFixed(0) + ' Hz (la vibrazione si ripiega su 0 Hz): ' +
      '≈' + rpm4 + ' rpm su 4 cilindri, ≈' + rpm2 + ' su bicilindrico, ≈' + rpm1 + ' su monocilindrico. ' +
      'Ripeti il test vicino a questi regimi: se l\'errore peggiora lì, è aliasing e si risolve solo smorzando il supporto — ' +
      'nessuna API web supera i 60 Hz (Chromium cappa anche la Generic Sensor API), quindi Nyquist resta 30 Hz.';
    out.appendChild(d);
  }

  if (accWorst >= 0.05) {
    const d = document.createElement('div');
    d.style.marginTop = '8px';
    d.textContent = 'Le tre accelerazioni dovrebbero leggere 0,00 g a moto ferma. ' +
      'Un residuo costante è offset del sensore — premi Calibra da fermo per azzerarlo. ' +
      'Un residuo che oscilla è vibrazione che arriva dal supporto.';
    out.appendChild(d);
  }

  if (cls !== 'ok') {
    const d = document.createElement('div');
    d.style.marginTop = '8px';
    d.textContent = vMean >= 0.35
      ? 'Vibrazione alta: interponi uno smorzante fra morsetto e manubrio, mantenendo il supporto rigido in rotazione. Evita snodi a sfera e frizioni, che oscillano a bassa frequenza proprio nella banda della piega.'
      : 'Vibrazione contenuta ma errore alto: verifica che il supporto non abbia gioco e rifai la calibrazione a moto dritta su piano.';
    out.appendChild(d);
  }
}
