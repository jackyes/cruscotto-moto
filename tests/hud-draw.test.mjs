// HUD video: primitive ctx-only + layout responsivo + contagiri piega.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { hudFont, hudCang, runningExtremes, leanScaleFor, leanGaugeModel,
  rectsOverlap, hudMotoBox, hudLayout, hudPanel, hudText, videoExtremesForJob } = api;

function mockCtx() {
  const ops = [];
  return {
    ops,
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', globalAlpha: 1,
    fillRect() {}, fill() {}, stroke() {}, save() {}, restore() {},
    beginPath() {}, closePath() {}, arc() {}, arcTo() {}, moveTo() {}, lineTo() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 100 }),
    fillText(t) { ops.push('fillText'); },
    strokeText(t) { ops.push('strokeText'); },
  };
}

test('hudFont: mai NaN, arrotonda', () => {
  assert.equal(hudFont('bold', 22), 'bold 22px system-ui');
  assert.equal(hudFont('bold', 21.6), 'bold 22px system-ui');
  assert.equal(hudFont('bold', 0), 'bold 1px system-ui');
  assert.equal(hudFont('bold', NaN), 'bold 22px system-ui');
});

test('hudCang: convenzione canvas (0 in alto, + a destra in alto)', () => {
  assert.ok(Math.abs(hudCang(0) + Math.PI / 2) < 1e-9, '0 = alto');
  assert.ok(Math.abs(hudCang(60) + Math.PI / 6) < 1e-9, '+60 = alto-destra');
  // settore 0->30 spazza 30 gradi, non 330
  assert.ok(Math.abs((hudCang(30) - hudCang(0)) - Math.PI / 6) < 1e-9);
});

test('hudText: alone prima del riempimento, haloW 0 = solo fill', () => {
  const c1 = mockCtx();
  hudText(c1, 'x', 0, 0, 'bold 22px system-ui', '#fff', 4);
  assert.deepEqual(c1.ops, ['strokeText', 'fillText']);
  assert.equal(c1.lineJoin, 'round');
  const c2 = mockCtx();
  hudText(c2, 'x', 0, 0, 'bold 22px system-ui', '#fff', 0);
  assert.deepEqual(c2.ops, ['fillText']);
});

test('hudPanel: funziona senza roundRect (fallback arcTo x4)', () => {
  const calls = { arcTo: 0, fill: 0, stroke: 0 };
  const ctx = mockCtx();
  delete ctx.createLinearGradient;
  ctx.roundRect = undefined;
  ctx.arcTo = () => { calls.arcTo++; };
  ctx.fill = () => { calls.fill++; };
  ctx.stroke = () => { calls.stroke++; };
  hudPanel(ctx, 0, 0, 100, 50, 8, 'rgba(0,0,0,.42)', 'rgba(0,0,0,.30)');
  assert.equal(calls.arcTo, 8); // pannello + hairline
  assert.equal(calls.fill, 1);
  assert.equal(calls.stroke, 1);
});

test('hudPanel: gradiente in cache per ctx (stessa geometria/colori -> una sola createLinearGradient)', () => {
  const ctx = mockCtx();
  let calls = 0;
  const realCreate = ctx.createLinearGradient;
  ctx.createLinearGradient = (...a) => { calls++; return realCreate(...a); };
  hudPanel(ctx, 0, 0, 100, 50, 8, 'rgba(0,0,0,.42)', 'rgba(0,0,0,.30)');
  hudPanel(ctx, 10, 0, 100, 50, 8, 'rgba(0,0,0,.42)', 'rgba(0,0,0,.30)'); // x diverso, stessa y/h/colori
  assert.equal(calls, 1, 'stessa geometria/colori: gradiente riusato, non ricreato');
  hudPanel(ctx, 0, 200, 100, 50, 8, 'rgba(0,0,0,.42)', 'rgba(0,0,0,.30)'); // y diversa -> nuovo gradiente
  assert.equal(calls, 2);
  const ctx2 = mockCtx();
  let calls2 = 0;
  ctx2.createLinearGradient = (...a) => { calls2++; return realCreate(...a); };
  hudPanel(ctx2, 0, 0, 100, 50, 8, 'rgba(0,0,0,.42)', 'rgba(0,0,0,.30)');
  assert.equal(calls2, 1, 'ctx diverso: cache non condivisa cross-job');
});

test('runningExtremes: monotoni, null/NaN non avvelenano', () => {
  const rows = [{ lean: 0, speedKmh: 0 }, { lean: 20, speedKmh: 50 },
    { lean: null, speedKmh: null }, { lean: NaN, speedKmh: NaN },
    { lean: -35, speedKmh: 30 }, { lean: 10, speedKmh: 80 }];
  const ex = runningExtremes(rows);
  assert.deepEqual([...ex.leanR], [0, 20, 20, 20, 20, 20]);
  assert.deepEqual([...ex.leanL], [0, 0, 0, 0, -35, -35]);
  assert.deepEqual([...ex.vmax], [0, 50, 50, 50, 50, 80]);
  assert.ok(ex.leanR.every(isFinite) && ex.leanL.every(isFinite) && ex.vmax.every(isFinite));
  assert.equal(runningExtremes([]).leanR.length, 0);
  assert.doesNotThrow(() => runningExtremes(null));
});

test('leanScaleFor: scatti 10°, minimo 30, clamp 60', () => {
  assert.equal(leanScaleFor(47, -42), 50);
  assert.equal(leanScaleFor(0, 0), 30);
  assert.equal(leanScaleFor(-58, 12), 60);
  assert.equal(leanScaleFor(-95, 88), 60);
  assert.equal(leanScaleFor(NaN, undefined), 30);
});

test('leanGaugeModel: frazione, lato, zone, clamp', () => {
  const m = leanGaugeModel(30, -42, 47, 50);
  assert.equal(m.cl, 30);
  assert.ok(Math.abs(m.frac - 0.6) < 1e-9);
  assert.equal(m.side, 'D');
  assert.equal(m.tickR, -42);
  assert.equal(m.zone, 'attiva');
  assert.equal(leanGaugeModel(22, 0, 0, 50).zone, 'calma');
  assert.equal(leanGaugeModel(23, 0, 0, 50).zone, 'attiva');
  assert.equal(leanGaugeModel(41, 0, 0, 50).zone, 'picco');
  assert.equal(leanGaugeModel(-25, 0, 0, 50).side, 'S');
  assert.equal(leanGaugeModel(0, 0, 0, 50).side, '–');
  assert.equal(leanGaugeModel(-70, 0, 0, 60).cl, -60);
  assert.equal(leanGaugeModel(NaN, NaN, NaN, 50).cl, 0);
});

test('videoExtremesForJob: un elemento per riga, forma {tickR,tickL}', () => {
  const rows = [{ lean: 10, speedKmh: 50 }, { lean: -20, speedKmh: 60 }];
  const ex = videoExtremesForJob(rows);
  assert.equal(ex.length, 2);
  assert.deepEqual(ex[0], { tickR: 10, tickL: 0 });
  assert.deepEqual(ex[1], { tickR: 10, tickL: -20 });
});

test('rectsOverlap: bordi che si toccano = false', () => {
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 }), true);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 0, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), false);
});

test('hudLayout: dentro frame, proporzionale, nessuna sovrapposizione', () => {
  for (const [W, H] of [[1280, 720], [1920, 1080], [1080, 1920]]) {
    const L = hudLayout(W, H);
    assert.equal(L.vert, H > W);
    assert.equal(L.s, Math.min(W, H) / 720);
    for (const k of ['speed', 'time', 'g', 'lean', 'vmax']) {
      const r = L[k];
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${k} fuori frame a ${W}x${H}`);
    }
    const keys = ['speed', 'time', 'g', 'lean', 'vmax'];
    for (let a = 0; a < keys.length; a++) {
      for (let b = a + 1; b < keys.length; b++) {
        assert.equal(rectsOverlap(L[keys[a]], L[keys[b]]), false, `${keys[a]} vs ${keys[b]} a ${W}x${H}`);
      }
      assert.equal(rectsOverlap(L[keys[a]], hudMotoBox(W, H)), false, `${keys[a]} sulla moto a ${W}x${H}`);
    }
  }
  // proporzionalità 720p->1080p (fattore 1.5)
  const a = hudLayout(1280, 720), b = hudLayout(1920, 1080);
  assert.ok(Math.abs(b.speed.w - a.speed.w * 1.5) <= 1);
  assert.equal(a.vert, false);
  assert.equal(hudLayout(1080, 1920).vert, true);
});

test('hudMotoBox: verticale fissa, più largo in 9:16', () => {
  const b = hudMotoBox(1280, 720);
  assert.ok(Math.abs(b.y / 720 - 0.285) < 0.01);
  assert.ok(Math.abs((b.y + b.h) / 720 - 0.63) < 0.01);
  assert.ok(hudMotoBox(1080, 1920).w / 1080 > b.w / 1280 * 2);
});
