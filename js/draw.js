'use strict';
/* js/draw.js (step 9): primitive canvas pure (ctx-only): drawLeanArc, drawAccBar, rrPath. Zero dipendenze: colori via parametri. */
function drawLeanArc(ctx, cx, cy, r, lean, axis, good, bad, txt) {
  const a0 = -60, a1 = 60;
  const ang = a => (90 - a) * Math.PI / 180; // 0° in alto, + a destra
  ctx.lineCap = 'round';
  ctx.strokeStyle = axis; ctx.lineWidth = Math.max(3, r * 0.14);
  ctx.beginPath(); ctx.arc(cx, cy, r, ang(a0), ang(a1)); ctx.stroke();
  const cl = Math.max(a0, Math.min(a1, lean));
  const na = ang(cl);
  ctx.strokeStyle = (cl >= 0) ? good : bad; ctx.lineWidth = Math.max(2, r * 0.10);
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * r * 0.82, cy - Math.sin(na) * r * 0.82); ctx.stroke();
  ctx.fillStyle = txt; ctx.font = 'bold ' + Math.round(r * 0.42) + 'px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(Math.round(cl) + '°', cx, cy + r * 0.22);
}

function drawAccBar(ctx, x, y, w, h, v, range, color, label, axis, txt) {
  const cx = x + w / 2;
  ctx.fillStyle = axis; ctx.globalAlpha = 0.5;
  ctx.fillRect(cx - 1, y, 2, h); ctx.globalAlpha = 1;
  const val = Math.max(-range, Math.min(range, v));
  const bw = (val / range) * (w / 2);
  ctx.fillStyle = color;
  ctx.fillRect(Math.min(cx, cx + bw), y, Math.abs(bw), h);
  ctx.fillStyle = txt; ctx.font = 'bold ' + Math.max(10, h) + 'px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(label, x, y + h - 1);
}

function rrPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Pura: font HUD scalato, mai NaN/0 (degeneri → 22px come il testo base). */
function hudFont(weight, px) {
  const p = isFinite(px) ? Math.max(1, Math.round(px)) : 22;
  return weight + ' ' + p + 'px system-ui';
}

/* Cache dei gradienti per ctx: geometria/colori dei pannelli HUD sono
   pressoché statici per sessione di export (stesso layout, stessi colori),
   quindi ricreare il CanvasGradient a ogni frame (4x/frame in video3d.js)
   è spreco puro. WeakMap su ctx: ogni job di export ha un ctx nuovo, niente
   leak cross-job. */
const _hudGradCache = typeof WeakMap === 'function' ? new WeakMap() : null;

/* Pannello con gradiente verticale + hairline chiara in alto. Senza
   createLinearGradient (mock dei test) ripiega sul piatto, mai crash. */
function hudPanel(ctx, x, y, w, h, r, top, bottom) {
  if (typeof ctx.createLinearGradient === 'function') {
    let g = null;
    let m = null;
    const key = _hudGradCache ? (y + '|' + h + '|' + top + '|' + bottom) : null;
    if (_hudGradCache) {
      m = _hudGradCache.get(ctx);
      if (m) g = m.get(key);
    }
    if (!g) {
      g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      if (_hudGradCache) {
        if (!m) { m = new Map(); _hudGradCache.set(ctx, m); }
        m.set(key, g);
      }
    }
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bottom;
  }
  rrPath(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
  rrPath(ctx, x + 0.5, y + 0.5, w - 1, Math.max(1, h - 1), Math.max(1, r - 1)); ctx.stroke();
}

/* Testo con alone scuro: leggibile sul beige liberty come sul bosco.
   Senza strokeText (mock) solo fill, mai crash. */
function hudText(ctx, txt, x, y, font, fill, haloW, halo) {
  ctx.font = font;
  if (haloW > 0 && typeof ctx.strokeText === 'function') {
    ctx.lineJoin = 'round'; ctx.lineWidth = haloW;
    ctx.strokeStyle = halo || 'rgba(0,0,0,.65)';
    ctx.strokeText(txt, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(txt, x, y);
}

/* Pura: angolo in convenzione canvas (y in giù). ang() sopra è matematica
   (nega sin a mano nell'ago): usarla in ctx.arc spazza il giro lungo. */
function hudCang(a) { return -(90 - a) * Math.PI / 180; }

/* Pura: record vivi di piega/vmax, riga per riga. null/NaN non avvelenano
   il running-max (Math.max con NaN = NaN: guardia esplicita). */
function runningExtremes(rows) {
  const n = rows ? rows.length : 0;
  const leanR = new Array(n), leanL = new Array(n), vmax = new Array(n);
  let rR = 0, rL = 0, vM = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i] || {};
    const lean = isFinite(r.lean) ? r.lean : 0;
    const v = isFinite(r.speedKmh) ? r.speedKmh : 0;
    if (lean > rR) rR = lean;
    if (lean < rL) rL = lean;
    if (v > vM) vM = v;
    leanR[i] = rR; leanL[i] = rL; vmax[i] = vM;
  }
  return { leanR, leanL, vmax };
}

/* Pura: fondoscala contagiri piega a scatti di 10°, copre il record, 30..60. */
function leanScaleFor(recR, recL) {
  const m = Math.max(Math.abs(recR || 0), Math.abs(recL || 0), 30);
  return Math.max(30, Math.min(60, Math.ceil(m / 10) * 10));
}

/* Pura: modello contagiri piega (il disegno resta in video3d.js). */
function leanGaugeModel(cl, tickR, tickL, scale) {
  const s = scale > 0 ? scale : 30;
  const c = Math.max(-s, Math.min(s, isFinite(cl) ? cl : 0));
  const frac = Math.abs(c) / s;
  return {
    cl: c, frac,
    side: c > 0.5 ? 'D' : (c < -0.5 ? 'S' : '–'),
    tickR: isFinite(tickR) ? tickR : 0, tickL: isFinite(tickL) ? tickL : 0,
    zone: frac < 0.45 ? 'calma' : (frac < 0.8 ? 'attiva' : 'picco'),
  };
}

/* Cerchio di aderenza: punto (latG,lonG) nel cerchio unitario. */
function hudGdot(ctx, cx, cy, gr, latG, lonG, dot, ring, txt) {
  ctx.strokeStyle = ring; ctx.lineWidth = Math.max(1, gr * 0.08);
  ctx.beginPath(); ctx.arc(cx, cy, gr, 0, 6.283); ctx.stroke();
  ctx.strokeStyle = ring; ctx.globalAlpha = 0.4; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - gr, cy); ctx.lineTo(cx + gr, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - gr); ctx.lineTo(cx, cy + gr); ctx.stroke();
  ctx.globalAlpha = 1;
  const dx = Math.max(-1, Math.min(1, (isFinite(latG) ? latG : 0) / 1.2)) * gr * 0.8;
  const dy = Math.max(-1, Math.min(1, (isFinite(lonG) ? lonG : 0) / 1.2)) * gr * 0.8;
  ctx.fillStyle = dot;
  ctx.beginPath(); ctx.arc(cx + dx, cy + dy, Math.max(2, gr * 0.18), 0, 6.283); ctx.fill();
  ctx.fillStyle = txt; ctx.font = hudFont('bold', gr * 0.42); ctx.textAlign = 'center';
  ctx.fillText('G', cx, cy + gr + gr * 0.5);
}

/* Pura: due rect si sovrappongono (bordi che si toccano = ok). */
function rectsOverlap(a, b) {
  if (!a || !b || a.w <= 0 || b.w <= 0 || a.h <= 0 || b.h <= 0) return false;
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* Pura: box moto proiettata (camera y=3,z=6.5 target 0.55 fov 50):
   verticale fissa [0.285H,0.63H], larghezza ∝ 1/aspect (in 9:16 è quasi tutto W). */
function hudMotoBox(W, H) {
  const hw = Math.min(0.48, 0.27 / Math.max(0.3, W / H));
  return { x: W * (0.5 - hw), y: H * 0.285, w: W * 2 * hw, h: H * 0.345 };
}

/* Pura: layout HUD su s=min(W,H)/720. vert=H>W. Nessun widget sul box moto,
   nessuna auto-sovrapposizione (testato a 720p/1080p/9:16). */
function hudLayout(W, H) {
  const s = Math.min(W, H) / 720;
  const m = 16 * s, vert = H > W;
  // Verticale: speed+time in alto, G sotto di loro, piega/Vmax in basso.
  // Orizzontale: speed a sx, time a dx, G centrato sotto la fascia alta.
  const speed = vert
    ? { x: m, y: m, w: W / 2 - m * 1.5, h: 120 * s }
    : { x: m, y: m, w: 220 * s, h: 120 * s };
  const time = vert
    ? { x: W / 2 + m * 0.5, y: m, w: W / 2 - m * 1.5, h: 120 * s }
    : { x: W - m - 280 * s, y: m, w: 280 * s, h: 44 * s };
  const gR = 34 * s;
  const gy = vert ? m + 120 * s + m : m + 6 * s;
  const g = { x: W / 2 - gR, y: gy, w: gR * 2, h: gR * 2 + 20 * s, cx: W / 2, cy: gy + gR, gr: gR };
  const leanH = 150 * s, leanW = 180 * s;
  // Verticale: piega sopra, vmax sotto (in basso sono impilate, non affiancate);
  // orizzontale: piega a sx, vmax a dx.
  const lean = vert
    ? { x: m, y: H - m - leanH * 2 - m, w: W - 2 * m, h: leanH }
    : { x: m, y: H - m - leanH, w: leanW, h: leanH };
  lean.cx = lean.x + lean.w / 2; lean.cy = lean.y + lean.h * 0.42; lean.gr = 56 * s;
  const vmaxH = 68 * s, vmaxW = 308 * s;
  const vmax = vert
    ? { x: m, y: H - m - vmaxH, w: W - 2 * m, h: vmaxH }
    : { x: W - m - vmaxW, y: H - m - vmaxH, w: vmaxW, h: vmaxH };
  return { s, vert, speed, time, g, lean, vmax };
}
