'use strict';
/* js/share.js: poster PNG condivisibile del giro (unico artefatto social che
   funziona anche su iOS, dove MediaRecorder+captureStream non esistono).
   Pure: posterStats/climbMeters/countCurves/leanHistogram/projectTrackXY/
   posterLayout/buildPosterModel/fmtDurH. ctx-only: drawSharePoster.
   Ordine: dopo js/draw.js (riusa rrPath). */

/* Pura: mm:ss → h:mm:ss oltre l'ora (fmtDur stampa "65:00" oltre i 59 min). */
function fmtDurH(sec) {
  // Number.isFinite, non isFinite: isFinite(null) è true (coercizione a 0).
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '—';
  const s = Math.floor(sec);
  if (s < 3600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') +
    ':' + String(s % 60).padStart(2, '0');
}

/* Pura: dislivello positivo a ancora (sotto thrM è rumore GPS, non salita). */
function climbMeters(rows, thrM) {
  const thr = isFinite(thrM) && thrM > 0 ? thrM : 3;
  let plus = 0, anchor = null, has = 0, tot = 0;
  for (const r of (rows || [])) {
    if (!r || !isFinite(r.alt)) continue;
    tot++;
    if (anchor == null) { anchor = r.alt; continue; }
    const d = r.alt - anchor;
    if (d >= thr) { plus += d; anchor = r.alt; }
    else if (d <= -thr) { anchor = r.alt; }
  }
  if (tot < 10) return { dPlus: null, valid: false };
  // alt tutti 0 (track senza quota): non è una misura.
  if (plus === 0 && tot > 0) {
    let allZero = true;
    for (const r of rows) { if (r && isFinite(r.alt) && r.alt !== 0) { allZero = false; break; } }
    if (allZero) return { dPlus: null, valid: false };
  }
  return { dPlus: plus, valid: true };
}

/* Pura: conta le curve (cambi di segno piega con isteresi entra/esce + durata). */
function countCurves(rows, enterDeg, exitDeg) {
  const enter = enterDeg || 15, exit = exitDeg || 7;
  let n = 0, side = 0, since = 0;
  const out = [];
  const arr = rows || [];
  for (let i = 0; i < arr.length; i++) {
    const lean = arr[i] && isFinite(arr[i].lean) ? arr[i].lean : 0;
    const t = arr[i] ? arr[i].t : i * 0.05;
    if (!side) {
      if (Math.abs(lean) >= enter) { side = lean > 0 ? 1 : -1; since = t; }
    } else if (Math.abs(lean) < exit) {
      if (t - since >= 0.5) { n++; out.push({ side: side > 0 ? 'D' : 'S', t0: since, t1: t }); }
      side = 0;
    } else if ((lean > 0 ? 1 : -1) === -side && Math.abs(lean) >= enter) {
      if (t - since >= 0.5) { n++; out.push({ side: side > 0 ? 'D' : 'S', t0: since, t1: t }); }
      side = -side; since = t;
    }
  }
  if (side && arr.length) {
    const last = arr[arr.length - 1];
    if (last.t - since >= 0.5) { n++; out.push({ side: side > 0 ? 'D' : 'S', t0: since, t1: last.t }); }
  }
  return { n, curves: out };
}

/* Pura: istogramma piega D/S a bin di binDeg gradi. */
function leanHistogram(rows, binDeg) {
  const bin = binDeg > 0 ? binDeg : 5;
  const nb = Math.ceil(60 / bin);
  const binsR = new Array(nb).fill(0), binsL = new Array(nb).fill(0);
  for (const r of (rows || [])) {
    if (!r || !isFinite(r.lean)) continue;
    const a = Math.abs(r.lean);
    if (a < 5) continue; // dritto non è piega
    const k = Math.min(nb - 1, Math.floor(a / bin));
    if (r.lean > 0) binsR[k]++;
    else binsL[k]++;
  }
  return { binsR, binsL, max: Math.max(1, ...binsR, ...binsL) };
}

/* Pura: statistiche poster in una passata. distKm da meta (haversine su rows a
   20 Hz gonfia col random-walk GPS); vmax da meta.maxSpeed (velocità fusa, come
   lo storico); decel da lonG (un gradino GPS 0→100 darebbe migliaia di m/s²). */
function posterStats(rows, track, meta) {
  const m = meta || {};
  const arr = rows || [];
  let vmaxRows = 0, leanR = 0, leanL = 0, gLat = 0, decel = 0, tLean20 = 0;
  let vSum = 0, vN = 0, prevT = null;
  for (const r of arr) {
    if (!r) continue;
    if (isFinite(r.speedKmh)) {
      if (r.speedKmh > vmaxRows) vmaxRows = r.speedKmh;
      // media in movimento: le soste non abbassano la media del giro
      if (r.speedKmh >= 5 && !r.gap) { vSum += r.speedKmh; vN++; }
    }
    if (isFinite(r.lean)) {
      if (r.lean > leanR) leanR = r.lean;
      if (r.lean < leanL) leanL = r.lean;
      if (Math.abs(r.lean) >= 20 && !r.gap) {
        const dt = (prevT != null && isFinite(r.t)) ? Math.max(0, r.t - prevT) : 0.05;
        tLean20 += Math.min(dt, 1); // le righe gap non gonfiano i tempi
      }
    }
    if (isFinite(r.latG) && Math.abs(r.latG) > gLat) gLat = Math.abs(r.latG);
    if (isFinite(r.lonG) && r.lonG < 0 && -r.lonG * 9.80665 > decel) decel = -r.lonG * 9.80665;
    if (isFinite(r.t)) prevT = r.t;
  }
  const vmax = isFinite(m.maxSpeed) && m.maxSpeed > 0 ? m.maxSpeed : vmaxRows;
  const climb = climbMeters(arr, 3);
  const curves = countCurves(arr, 15, 7);
  const tEnd = arr.length && isFinite(arr[arr.length - 1].t) ? arr[arr.length - 1].t : (m.duration || 0);
  return {
    km: isFinite(m.distKm) ? m.distKm : 0,
    dur: fmtDurH(tEnd),
    vmax: Math.min(vmax, 399), // riga spuria a 400 km/h: mostra il meta, non il glitch
    vAvg: vN ? vSum / vN : 0,
    leanR: Math.round(Math.abs(leanR)), leanL: Math.round(Math.abs(leanL)),
    gLat: gLat, decel: decel,
    tLean20: tLean20,
    nCurve: curves.n,
    dPlus: climb.valid ? climb.dPlus : null,
    startISO: m.startISO || null,
  };
}

/* Pura: proietta la traccia nel box (w,h,pad), scala isotropa con cos(lat):
   senza, alle latitudini italiane la sagoma esce schiacciata del ~28%. */
function projectTrackXY(pts, w, h, pad) {
  const out = [];
  if (!pts || !pts.length) return out;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of pts) {
    if (p.lat == null || p.lon == null) continue;
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
  }
  if (!isFinite(minLat)) return out;
  const midLat = (minLat + maxLat) / 2 * Math.PI / 180;
  const kx = Math.cos(midLat) || 1;
  const spanLon = Math.max(1e-9, (maxLon - minLon) * kx), spanLat = Math.max(1e-9, maxLat - minLat);
  const sc = Math.min((w - 2 * pad) / spanLon, (h - 2 * pad) / spanLat);
  const ox = (w - spanLon * sc) / 2, oy = (h - spanLat * sc) / 2;
  for (const p of pts) {
    if (p.lat == null || p.lon == null) continue;
    out.push(ox + (p.lon - minLon) * kx * sc, oy + (maxLat - p.lat) * sc);
  }
  return out;
}

/* Pura: tre momenti del giro (Vmax, piega max, G max) per le righe "momenti". */
function posterMoments(rows) {
  const arr = rows || [];
  let iV = -1, vB = -1, iL = -1, lB = -1, iG = -1, gB = -1;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i] || {};
    if (isFinite(r.speedKmh) && r.speedKmh > vB) { vB = r.speedKmh; iV = i; }
    if (isFinite(r.lean) && Math.abs(r.lean) > lB) { lB = Math.abs(r.lean); iL = i; }
    if (isFinite(r.latG) && Math.abs(r.latG) > gB) { gB = Math.abs(r.latG); iG = i; }
  }
  const at = i => (i >= 0 && arr[i] ? fmtDurH(arr[i].t) : '—');
  return [
    { k: 'Vmax', v: Math.round(vB > 0 ? vB : 0) + ' km/h', t: at(iV) },
    { k: 'Piega', v: Math.round(lB > 0 ? lB : 0) + '°', t: at(iL) },
    { k: 'G lat', v: (gB > 0 ? gB : 0).toFixed(1) + ' g', t: at(iG) },
  ];
}

/* Pura: formati card (dimensioni fisse, niente dipendenze). Portrait 4:5 =
   default feed/WhatsApp; square 1:1 per griglia/archivio; story 9:16 per storie. */
const POSTER_FORMATS = {
  square: { w: 1080, h: 1080, label: '1:1' },
  portrait: { w: 1080, h: 1350, label: '4:5' },
  story: { w: 1080, h: 1920, label: '9:16' },
};

/* Pura: dimensioni da chiave formato, fallback portrait su input ignoto. */
function posterSizeFor(fmt) {
  const f = POSTER_FORMATS[fmt];
  return f ? { w: f.w, h: f.h } : { w: POSTER_FORMATS.portrait.w, h: POSTER_FORMATS.portrait.h };
}

/* Pura: titolo card da stats (data/ora startISO o fallback). Mai throw su ISO invalido. */
function posterTitle(st) {
  if (st && st.startISO) {
    const d = new Date(st.startISO);
    if (!isNaN(d.getTime())) {
      return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() +
        ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }
  return 'Giro in moto';
}

/* Pura: layout card flessibile su qualsiasi W/H. Rettangoli, mai testo.
   Budget verticale: header/footer proporzionali, poi residuo ripartito
   map (flessibile, min 28%H) > stats > strip > spark ~= hist > legenda/moments
   (riempie resto, min 0). Su square l'altezza scarsa comprime hist e moments. */
function posterLayout(W, H) {
  const pad = Math.round(W * 0.06);
  const gap = Math.round(pad / 2);
  const headH = Math.round(H * 0.10), footH = Math.round(H * 0.05);
  const y0 = pad;
  const header = { x: pad, y: y0, w: W - 2 * pad, h: headH };
  let y = y0 + headH + gap;
  const foot = { x: pad, y: H - pad - footH, w: W - 2 * pad, h: footH };
  const avail = Math.max(0, foot.y - gap - y);
  // Quote desiderate (frazioni di H); moments prende il resto.
  const wantStats = Math.round(H * 0.085);
  const wantStrip = Math.round(H * 0.045);
  const wantSpark = Math.round(H * 0.10);
  const wantHist = Math.round(H * 0.10);
  const minMap = Math.round(H * 0.28);
  let mapH = avail - wantStats - wantStrip - wantSpark - wantHist - 4 * gap;
  let statH = wantStats, stripH = wantStrip, sparkH = wantSpark, histH = wantHist;
  if (mapH < minMap) {
    // Altezza scarsa (square): comprimi hist poi moments; map resta min.
    const short = minMap - mapH;
    const cutHist = Math.min(histH - Math.round(H * 0.05), short);
    histH -= Math.max(0, cutHist);
    mapH = minMap;
  }
  if (mapH < 0) mapH = 0;
  const map = { x: pad, y, w: W - 2 * pad, h: mapH }; y += mapH + gap;
  const stats = { x: pad, y, w: W - 2 * pad, h: statH }; y += statH + gap;
  const strip = { x: pad, y, w: W - 2 * pad, h: stripH }; y += stripH + gap;
  const spark = { x: pad, y, w: W - 2 * pad, h: sparkH }; y += sparkH + gap;
  const hist = { x: pad, y, w: W - 2 * pad, h: histH }; y += histH + gap;
  const moments = { x: pad, y, w: W - 2 * pad, h: Math.max(0, foot.y - gap - y) };
  return { pad, header, map, stats, strip, spark, hist, moments, foot };
}

/* Pura: layout da chiave formato (dimensioni da posterSizeFor). */
function posterLayoutFor(fmt) {
  const s = posterSizeFor(fmt);
  return posterLayout(s.w, s.h);
}

/* Pura: compone tutto in un modello piatto serializzabile (test su numeri). */
function buildPosterModel(rows, track, meta) {
  const st = posterStats(rows, track, meta);
  const hist = leanHistogram(rows || [], 5);
  const moments = posterMoments(rows || []);
  const spark = [];
  const arr = rows || [];
  const step = Math.max(1, Math.floor(arr.length / 200));
  for (let k = 0; k < arr.length; k += step) {
    spark.push({ t: arr[k].t, v: arr[k].speedKmh || 0 });
  }
  return { st, hist, moments, spark, nPts: (track || []).length };
}

/* ctx-only: disegna la card. Colori per parametro (mai videoColor dentro).
   Tipografia scalata da W (solo system-ui, CSP-safe); margini safe 6%W per crop WhatsApp. */
function drawSharePoster(ctx, model, layout, W, H, C) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const { st, hist, moments, spark } = model;
  const pad = layout.pad;

  // Intestazione: data + durata (titolo puro da posterTitle, testabile).
  const title = posterTitle(st);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.txt; ctx.font = 'bold ' + Math.round(W * 0.055) + 'px system-ui';
  ctx.fillText(title, pad, layout.header.y + layout.header.h * 0.45);
  ctx.fillStyle = C.sub; ctx.font = Math.round(W * 0.038) + 'px system-ui';
  ctx.fillText(st.dur + '  ·  ' + st.km.toFixed(1) + ' km', pad, layout.header.y + layout.header.h * 0.85);

  // Sagoma traccia con glow economico: passaggio largo alpha + core pieno
  // (nessuna tile: niente rete, niente attribuzione, iOS-safe).
  if (model._xy && model._xy.length >= 4 && layout.map.h > 0) {
    const L = layout.map, p2 = Math.max(8, L.w * 0.06);
    const trace = () => {
      ctx.beginPath();
      for (let k = 0; k < model._xy.length; k += 2) {
        const x = L.x + p2 + model._xy[k] * (L.w - 2 * p2);
        const y = L.y + p2 + model._xy[k + 1] * (L.h - 2 * p2);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(L.x, L.y, L.w, L.h); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.25; ctx.strokeStyle = C.accent;
    ctx.lineWidth = Math.max(3, W * 0.006) * 2.4;
    trace(); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = C.accent;
    ctx.lineWidth = Math.max(3, W * 0.006);
    trace(); ctx.stroke();
    ctx.restore();
  }

  // 6 tile statistiche, prima = hero Vmax con bordo accent.
  const tiles = [
    [String(Math.round(st.vmax)), 'Vmax km/h', true], [st.vAvg.toFixed(0), 'media km/h', false],
    [st.leanR + '°', 'piega D', false], [st.leanL + '°', 'piega S', false],
    [st.nCurve + '', 'curve', false], [st.dPlus != null ? Math.round(st.dPlus) + ' m' : '—', 'dislivello', false],
  ];
  const tw = layout.stats.w / 3, th = layout.stats.h / 2;
  ctx.textAlign = 'center';
  tiles.forEach((td, k) => {
    const cx = layout.stats.x + (k % 3) * tw + tw / 2;
    const cy = layout.stats.y + Math.floor(k / 3) * th;
    ctx.fillStyle = C.card;
    rrPath(ctx, cx - tw / 2 + 3, cy + 3, tw - 6, th - 6, 10); ctx.fill();
    if (td[2]) { ctx.strokeStyle = C.accent; ctx.lineWidth = 3; rrPath(ctx, cx - tw / 2 + 3, cy + 3, tw - 6, th - 6, 10); ctx.stroke(); }
    ctx.fillStyle = C.txt; ctx.font = 'bold ' + Math.round(W * 0.05) + 'px system-ui';
    ctx.fillText(td[0], cx, cy + th * 0.55);
    ctx.fillStyle = C.sub; ctx.font = Math.round(W * 0.03) + 'px system-ui';
    ctx.fillText(td[1], cx, cy + th * 0.85);
  });

  // Striscia dati extra (campi gia' in posterStats, prima non disegnati).
  if (layout.strip && layout.strip.h > 0) {
    const s = layout.strip;
    const gTxt = st.gLat > 0 ? st.gLat.toFixed(1) + ' g lat' : '—';
    const dTxt = st.decel > 0.5 ? st.decel.toFixed(1) + ' m/s²' : '—';
    const pTxt = st.tLean20 > 0 ? fmtDurH(st.tLean20) + ' in piega' : '—';
    ctx.fillStyle = C.sub; ctx.font = Math.round(W * 0.032) + 'px system-ui';
    ctx.fillText(gTxt + '   ·   ' + dTxt + ' frenata   ·   ' + pTxt,
      s.x + s.w / 2, s.y + s.h * 0.65);
  }

  // Etichette sezione sopra spark/hist.
  ctx.textAlign = 'left'; ctx.fillStyle = C.sub;
  ctx.font = 'bold ' + Math.round(W * 0.028) + 'px system-ui';
  if (layout.spark.h > 0) ctx.fillText('VELOCITÀ', layout.spark.x, layout.spark.y - 6);
  // Sparkline velocità con marker Vmax.
  drawMiniSpark(ctx, layout.spark, spark, C);
  if (layout.hist.h > 0) ctx.fillText('PIEGA D/S', layout.hist.x, layout.hist.y - 6);
  // Istogramma piega D/S.
  drawMiniHist(ctx, layout.hist, hist, C);
  // Momenti.
  ctx.textAlign = 'left'; ctx.font = Math.round(W * 0.036) + 'px system-ui';
  moments.forEach((mm, k) => {
    const y = layout.moments.y + 24 + k * Math.round(W * 0.05);
    if (y > layout.moments.y + layout.moments.h) return;
    ctx.fillStyle = C.sub; ctx.fillText(mm.k, layout.moments.x, y);
    ctx.fillStyle = C.txt; ctx.fillText(mm.v, layout.moments.x + W * 0.25, y);
    ctx.fillStyle = C.sub; ctx.textAlign = 'right';
    ctx.fillText(mm.t, layout.moments.x + layout.moments.w, y);
    ctx.textAlign = 'left';
  });

  // Watermark discreto.
  ctx.textAlign = 'center'; ctx.fillStyle = C.sub;
  ctx.font = Math.round(W * 0.028) + 'px system-ui';
  ctx.fillText('Cruscotto Moto', W / 2, layout.foot.y + layout.foot.h * 0.7);
}

function drawMiniSpark(ctx, box, spark, C) {
  if (!spark.length) return;
  let mn = Infinity, mx = -Infinity;
  for (const p of spark) {
    if (p.v < mn) mn = p.v;
    if (p.v > mx) mx = p.v;
  }
  if (!isFinite(mn)) return;
  const span = Math.max(1, mx - mn);
  const X = k => box.x + 8 + (k / Math.max(1, spark.length - 1)) * (box.w - 16);
  const Y = v => box.y + box.h - 8 - ((v - mn) / span) * (box.h - 16);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  spark.forEach((p, k) => { k ? ctx.lineTo(X(k), Y(p.v)) : ctx.moveTo(X(k), Y(p.v)); });
  ctx.stroke();
  let mi = 0;
  spark.forEach((p, k) => { if (p.v > spark[mi].v) mi = k; });
  ctx.fillStyle = C.good;
  ctx.beginPath(); ctx.arc(X(mi), Y(spark[mi].v), 5, 0, 6.283); ctx.fill();
}

function drawMiniHist(ctx, box, hist, C) {
  const n = hist.binsR.length;
  const bw = box.w / Math.max(1, n);
  for (let k = 0; k < n; k++) {
    const hr = (hist.binsR[k] / hist.max) * (box.h / 2 - 4);
    const hl = (hist.binsL[k] / hist.max) * (box.h / 2 - 4);
    ctx.fillStyle = C.good;
    ctx.fillRect(box.x + k * bw + 1, box.y + box.h / 2 - hr, bw - 2, hr);
    ctx.fillStyle = C.bad;
    ctx.fillRect(box.x + k * bw + 1, box.y + box.h / 2, bw - 2, hl);
  }
  ctx.fillStyle = C.sub; ctx.fillRect(box.x, box.y + box.h / 2 - 1, box.w, 2);
}

/* Thin wrapper: genera la card nel formato chiesto e chiama cb(url, blob).
   opts.format in {'square','portrait','story'}, default 'portrait' (caller
   esistenti invariati). 2° arg funzione = ancora (s, cb). */
function makeShareCard(s, cb, opts) {
  const rows = (s && s.rows) || [], track = (s && s.track) || [], meta = (s && s.meta) || {};
  if (!rows.length && !track.length) { cb(null, null); return; }
  const fmt = opts && typeof opts.format === 'string' ? opts.format : 'portrait';
  const size = posterSizeFor(fmt);
  const W = size.w, H = size.h;
  const model = buildPosterModel(rows, track, meta);
  model._xy = posterTrackXY(track.length ? track : rows, W, H);
  model.format = POSTER_FORMATS[fmt] ? fmt : 'portrait';
  const layout = posterLayout(W, H);
  const cs = getComputedStyle(document.documentElement);
  const css = n => (cs.getPropertyValue(n) || '').trim();
  const C = {
    bg: css('--c-bg') || '#121924', txt: css('--text') || '#f4f8fc',
    sub: css('--text-2') || '#a8b8c8', accent: css('--accent') || '#38bdf8',
    good: css('--good') || '#34d399', bad: css('--bad') || '#f87171',
    card: css('--surface-2') || '#1a2432',
  };
  const canvas = makePosterCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawSharePoster(ctx, model, layout, W, H, C);
  posterToBlob(canvas, blob => {
    if (!blob) { cb(null, null); return; }
    cb(URL.createObjectURL(blob), blob);
  });
}

/* Thin wrapper: canvas NON in DOM (serve solo a toBlob, non a captureStream). */
function makePosterCanvas(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

function posterToBlob(canvas, cb) {
  if (canvas.toBlob) canvas.toBlob(cb, 'image/png');
  else if (cb) cb(null);
}

/* Thin wrapper: proiezione normalizzata 0..1 della traccia per il modello. */
function posterTrackXY(track, W, H) {
  const pts = (track || []).filter(p => p.lat != null && p.lon != null);
  if (pts.length < 2) return [];
  const px = projectTrackXY(pts, W, H, 0);
  // Normalizza 0..1 così il disegno scala nel box con padding proprio.
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let k = 0; k < px.length; k += 2) {
    if (px[k] < mnx) mnx = px[k]; if (px[k] > mxx) mxx = px[k];
    if (px[k + 1] < mny) mny = px[k + 1]; if (px[k + 1] > mxy) mxy = px[k + 1];
  }
  const sx = Math.max(1e-9, mxx - mnx), sy = Math.max(1e-9, mxy - mny);
  const out = [];
  for (let k = 0; k < px.length; k += 2) out.push((px[k] - mnx) / sx, (px[k + 1] - mny) / sy);
  return out;
}
