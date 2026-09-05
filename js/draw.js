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
