import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState } from './harness.mjs';

const { state, attitudeReference, updateAttitude, processSample, buildBasis, leanFromUp,
        vscale, vlen, vdot, vcross, vsub, G } = api;

const B = () => buildBasis({x:1, y:0, z:0});

test('attitudeReference: raw da fermo', () => {
  resetState();
  const b = B();
  const R = attitudeReference({x:G, y:0, z:0}, {x:0,y:0,z:0}, b, 0.05);
  assert.equal(R.mode, 'raw');
  assert.ok(Math.abs(R.trust - 1) < 1e-9);
  assert.ok(Math.abs(R.u.x - 1) < 1e-9);
  assert.ok(Math.abs(R.u.y) < 1e-9);
});

test('attitudeReference: ramo norm senza GPS', () => {
  resetState();
  state.speedFusMs = 20;
  state.lonG = 0;
  state.latGps = -0.1;
  state.hasGyro = false;
  const b = B();
  const f = vscale(b.up, G / Math.cos(Math.PI/6));
  const R = attitudeReference(f, {x:0,y:0,z:0}, b, 0.05);
  assert.equal(R.mode, 'norm');
  assert.ok(Math.abs(R.trust - 0.3) < 1e-12);
  assert.ok(Math.abs(R.u.x - Math.cos(Math.PI/6)) < 1e-6);
  assert.ok(Math.abs(R.u.y - (-Math.sin(Math.PI/6))) < 1e-6);
  assert.ok(Math.abs(leanFromUp(R.u, b) - (-30)) < 1e-6);
});

test('attitudeReference: compensazione centripeta', () => {
  resetState();
  state.speedFusMs = 10;
  state.speedGpsT = Date.now();
  state.hasGyro = true;
  state.speedGpsMs = 10;
  const b = B();
  const R = attitudeReference({x:1,y:2,z:3}, {x:4,y:5,z:6}, b, 0.05);
  assert.equal(R.mode, 'centrip');
  assert.equal(R.trust, 0);
  const wr = {x:4*Math.PI/180, y:5*Math.PI/180, z:6*Math.PI/180};
  const c = vcross(wr, b.fwd);
  const ref = vsub({x:1,y:2,z:3}, vscale(c, 10));
  const m = vlen(ref);
  assert.ok(Math.abs(R.u.x - ref.x/m) < 1e-3);
  assert.ok(Math.abs(R.u.y - ref.y/m) < 1e-3);
  assert.ok(Math.abs(R.u.z - ref.z/m) < 1e-3);
});

test('updateAttitude: inizializzazione rifiutata senza storia sufficiente', () => {
  resetState();
  const b = B();
  state._accHist = [{x:G,y:0,z:0}];
  const ok = updateAttitude({x:G,y:0,z:0}, {x:0,y:0,z:0}, b, 0.05);
  assert.equal(ok, false);
  assert.ok(!state._attU);
});

test('processSample: convergenza della piega a destra', () => {
  resetState();
  state.calib = B();
  const c = Math.cos(Math.PI/6), s = Math.sin(Math.PI/6);
  const acc = {x: c*G, y: s*G, z: 0};
  let t = 100000;
  for (let i = 0; i < 40; i++) {
    t += 50;
    api.lastMotionT = t - 50;
    processSample({acc, gyro: null, grav: null, lin: null, t});
  }
  assert.ok(Math.abs(state.lean - 30) < 1.0, 'lean atteso ~30, ottenuto ' + state.lean);
});

test('processSample: convergenza della piega a sinistra', () => {
  resetState();
  state.calib = B();
  const c = Math.cos(Math.PI/6), s = Math.sin(Math.PI/6);
  const acc = {x: c*G, y: -s*G, z: 0};
  let t = 200000;
  for (let i = 0; i < 40; i++) {
    t += 50;
    api.lastMotionT = t - 50;
    processSample({acc, gyro: null, grav: null, lin: null, t});
  }
  assert.ok(Math.abs(state.lean - (-30)) < 1.0, 'lean atteso ~-30, ottenuto ' + state.lean);
});

/* Senza velocità il riferimento si ricava dalla sola norma: ‖f‖/g = 1 e l'accelerometro
   punta a B.up. Ma hypot() è convessa, quindi la vibrazione gonfia ‖f‖ SEMPRE in
   positivo: senza gate il ramo su norma non sbaglia a caso, inventa una piega nella
   direzione data dal segno — sempre. La soglia è l'inflazione che la vibrazione
   misurata (vibG) può spiegare da sola: sotto quella, il modulo non porta
   informazione d'angolo e si congela invece di dichiarare i gradi del rumore. */
test('attitudeReference: inflazione da vibrazione non fabbrica una piega', () => {
  resetState();
  state.speedFusMs = 15;      // > CENTRIP_MIN_MS: ramo "non slow"
  state.hasGyro = false;      // niente compensazione centripeta
  state.lonG = 0;             // nessuna manovra longitudinale
  state.latGps = -0.2;        // segno dal GPS
  state.vibG = 0.3;           // 0,3 g RMS -> inflazione attesa 0,3² = 0,09
  const b = B();
  // ‖f‖/g − 1 = 0,05: meno di quanto la vibrazione spiega da sola.
  const f = vscale(b.up, G * 1.05);

  // Nessun rotore precedente: si dichiara "non lo so", non 0°.
  assert.equal(attitudeReference(f, {x:0,y:0,z:0}, b, 0.05), null);

  // Rotore norm valido e fresco: si congela quello invece di inventarne uno.
  const cached = { u: vscale(b.up, 1), trust: 0.3, mode: 'norm' };
  state._attLastNorm = cached; state._attLastNormT = Date.now();
  assert.equal(attitudeReference(f, {x:0,y:0,z:0}, b, 0.05), cached);

  // Rotore scaduto: si torna a "non lo so".
  state._attLastNormT = Date.now() - (api.ATT_NORM_TTL_MS + 1);
  assert.equal(attitudeReference(f, {x:0,y:0,z:0}, b, 0.05), null);
});

test('attitudeReference: piega vera oltre la soglia di inflazione passa', () => {
  resetState();
  state.speedFusMs = 15;
  state.hasGyro = false;
  state.lonG = 0;
  state.latGps = -0.2;
  state.vibG = 0.3;
  const b = B();
  // 1/cos30° − 1 = 0,1547 > 0,09: l'eccesso non è spiegabile dalla vibrazione.
  const f = vscale(b.up, G / Math.cos(Math.PI/6));
  const R = attitudeReference(f, {x:0,y:0,z:0}, b, 0.05);
  assert.equal(R.mode, 'norm');
  assert.ok(Math.abs(leanFromUp(R.u, b) - (-30)) < 1e-6);
});
