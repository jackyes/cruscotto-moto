// Export offline 3D: prima di catturare un frame si aspettano le tile della
// vista (satellite, DEM, vettoriali). Mappa finta: areTilesLoaded legge una
// sequenza (l'ultimo valore si ripete), redraw conta le chiamate.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoOfflineWaitTiles, videoRecompose3D } = api;

function fakeMap(seq) {
  let n = 0;
  return {
    redraws: 0,
    areTilesLoaded() { const v = seq[Math.min(n, seq.length - 1)]; n++; return v; },
    redraw() { this.redraws++; },
  };
}

test('videoOfflineWaitTiles: tile già caricate → niente attesa né redraw', async () => {
  const job = { map: fakeMap([true]) };
  assert.equal(await videoOfflineWaitTiles(job, 0), false);
  assert.equal(job.map.redraws, 0);
});

test('videoOfflineWaitTiles: tile in arrivo → ridisegna una volta e segnala di ricomporre', async () => {
  let slow = 0;
  const job = { map: fakeMap([false, false, false, true]) };
  assert.equal(await videoOfflineWaitTiles(job, 0, () => slow++), true);
  assert.equal(job.map.redraws, 1);
  assert.equal(job.tileMiss, 0);
  assert.equal(slow, 0, 'attesa breve: nessun avviso in stato');
});

test('videoOfflineWaitTiles: il redraw chiede altre tile (DEM arrivato) → si riaspetta', async () => {
  // iniziale false · poll true → redraw → false · poll false · poll true → redraw → true
  const job = { map: fakeMap([false, true, false, false, true, true]) };
  assert.equal(await videoOfflineWaitTiles(job, 0), true);
  assert.equal(job.map.redraws, 2);
  assert.equal(job.tileMiss, 0);
});

test('videoOfflineWaitTiles: richiesta appesa → esce al tetto, conta il timeout, usa quel che c\'è', async () => {
  const job = { map: fakeMap([false]) };
  const t0 = Date.now();
  assert.equal(await videoOfflineWaitTiles(job, 80), true);
  const dt = Date.now() - t0;
  assert.ok(dt >= 75 && dt < 1000, 'tempo ' + dt);
  assert.equal(job.tileMiss, 1);
  assert.equal(job.map.redraws, 1, 'redraw finale con le tile arrivate');
});

test('videoOfflineWaitTiles: dopo 3 timeout di fila attesa ridotta, un frame completo la riporta piena', async () => {
  const job = { map: fakeMap([false]), tileMiss: 3 };
  const t0 = Date.now();
  await videoOfflineWaitTiles(job, 5000);
  const dt = Date.now() - t0;
  assert.ok(dt < 1500, 'attesa ridotta, non 5 s: ' + dt);
  assert.equal(job.tileMiss, 4);
  job.map = fakeMap([false, true]);
  await videoOfflineWaitTiles(job, 5000);
  assert.equal(job.tileMiss, 0);
});

test('videoOfflineWaitTiles: avviso in stato una volta sola oltre mezzo secondo', async () => {
  let slow = 0;
  const job = { map: fakeMap([false]) };
  await videoOfflineWaitTiles(job, 700, () => slow++);
  assert.equal(slow, 1);
});

test('videoOfflineWaitTiles: annulla durante l\'attesa → esce subito', async () => {
  const job = { map: fakeMap([false]) };
  setTimeout(() => { job.cancelled = true; }, 30);
  const t0 = Date.now();
  await videoOfflineWaitTiles(job, 5000);
  assert.ok(Date.now() - t0 < 1000);
});

test('videoOfflineWaitTiles: mappa senza API o che lancia → nessuna attesa', async () => {
  assert.equal(await videoOfflineWaitTiles({ map: { redraw() {} } }, 0), false);
  assert.equal(await videoOfflineWaitTiles({}, 0), false);
  const job = { map: { areTilesLoaded() { throw new TypeError('style'); }, redraw() {} } };
  assert.equal(await videoOfflineWaitTiles(job, 0), false);
});

function recomposeJob() {
  const drawn = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '', strokeStyle: '', lineWidth: 0, lineCap: '',
    fillRect() {}, clearRect() {}, fill() {}, stroke() {},
    beginPath() {}, closePath() {}, arc() {}, arcTo() {}, moveTo() {}, lineTo() {}, rect() {}, clip() {}, save() {}, restore() {},
    measureText: () => ({ width: 100 }), fillText() {},
    drawImage(img) { drawn.push(img); },
  };
  const wheel = { rotation: { y: 1.5 } };
  let renders = 0;
  const job = {
    canvas: { width: 1280, height: 720 }, ctx, drawn, wheel,
    rows: [{ t: 0, speedKmh: 50, lean: 10 }, { t: 1, speedKmh: 60, lean: 5 }],
    tSim: 0, dist: [0, 0.01], speedMax: 120,
    map: { getCanvas: () => 'MAPPA', jumpTo() { throw new Error('la camera non deve muoversi'); } },
    moto: { scene: {}, camera: {}, wheels: [wheel], renderer: { domElement: 'MOTO', render() { renders++; } } },
    renders: () => renders,
  };
  return job;
}

test('videoRecompose3D: ricompone mappa + moto senza muovere camera né ruote', () => {
  const job = recomposeJob();
  videoRecompose3D(job);
  assert.deepEqual(job.drawn, ['MAPPA', 'MOTO']);
  assert.equal(job.renders(), 1);
  assert.equal(job.wheel.rotation.y, 1.5);
});

test('videoRecompose3D: job annullato o già ripulito → niente', () => {
  const a = recomposeJob(); a.cancelled = true; videoRecompose3D(a);
  const b = recomposeJob(); b.moto = null; videoRecompose3D(b);
  assert.deepEqual(a.drawn, []);
  assert.deepEqual(b.drawn, []);
});
