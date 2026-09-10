// Auto-fit qualità sulla RAM: ladder bitrate/fps, blocco al floor.
// Nel sandbox del harness navigator.deviceMemory è assente → mem=4 GB →
// videoOfflineMaxBytes = 4*384MB = 1536 MB (niente OFF_MIN_RAM_BYTES qui).
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoOfflineFitCfg, videoFitBitrateLadder, videoOfflineMaxBytes, videoBitrateFor } = api;

const MAX_BYTES = videoOfflineMaxBytes(); // 1610612736 nel harness

/* Riga minimale: serve solo t0/tEnd per videoOfflineDurSec. */
function rowsFor(sec) {
  const rows = [];
  for (let t = 0; t < sec; t += 1) rows.push({ t });
  rows.push({ t: sec });
  return rows;
}

function preFor(sec, res = [1280, 720]) {
  return { rows: rowsFor(sec), slow: { base: 1 }, mult: 1, res };
}

test('videoFitBitrateLadder: fascia per dimensione frame', () => {
  assert.equal(videoFitBitrateLadder(1920, 1080)[0], 8000000);
  assert.equal(videoFitBitrateLadder(1280, 720)[0], 5000000);
  assert.equal(videoFitBitrateLadder(720, 1280)[0], 5000000); // 9:16 come 720p
  assert.equal(videoFitBitrateLadder(854, 480)[0], 2500000);
  assert.equal(videoFitBitrateLadder(NaN, 0)[0], 2500000);    // input strani → fascia bassa
});

test('videoOfflineFitCfg: giro corto sta nel budget → cfg invariato', () => {
  const cfg = { bitrate: 5000000, framerate: 30 };
  const fit = videoOfflineFitCfg(cfg, preFor(60));
  assert.equal(fit.changed, false);
  assert.equal(fit.cfg.bitrate, 5000000);
  assert.equal(fit.cfg.framerate, 30);
  assert.equal(fit.msg, '');
});

test('videoOfflineFitCfg: giro lungo scende al gradino sotto il budget', () => {
  // durSec 3600 → allowed = 1536MB*8/3600 ≈ 3.58 Mbps → gradino 3.5 Mbps.
  const cfg = { bitrate: 5000000, framerate: 30 };
  const fit = videoOfflineFitCfg(cfg, preFor(3600));
  assert.equal(fit.changed, true);
  assert.equal(fit.cfg.bitrate, 3500000);
  assert.equal(fit.cfg.framerate, 30); // 3.5 Mbps non scende sotto i 30 fps
  assert.ok(fit.msg.indexOf('3.5 Mbps') >= 0);
});

test('videoOfflineFitCfg: bitrate basso → anche fps 24/15', () => {
  // durSec 7200 a 1080p → allowed ≈ 1.79 Mbps → gradino 1.5 Mbps → fps 24.
  const f24 = videoOfflineFitCfg({ bitrate: 8000000, framerate: 30 }, preFor(7200, [1920, 1080]));
  assert.equal(f24.cfg.bitrate, 1500000);
  assert.equal(f24.cfg.framerate, 24);
  // durSec 5400 → allowed ≈ 2.39 Mbps → 1.5 Mbps, fps 24.
  const f2 = videoOfflineFitCfg({ bitrate: 5000000, framerate: 30 }, preFor(5400));
  assert.equal(f2.cfg.bitrate, 1500000);
  assert.equal(f2.cfg.framerate, 24);
  // sotto 1.5 Mbps → fps 15: durSec 10240 → allowed ≈ 1.26 Mbps → gradino 1 Mbps.
  const f15 = videoOfflineFitCfg({ bitrate: 5000000, framerate: 30 }, preFor(10240));
  assert.equal(f15.cfg.bitrate, 1000000);
  assert.equal(f15.cfg.framerate, 15);
  // allowed fra 2.5 e 5: durSec 4200 → ≈3.07 Mbps → 2.5, fps resta 30.
  const f3 = videoOfflineFitCfg({ bitrate: 5000000, framerate: 30 }, preFor(4200));
  assert.equal(f3.cfg.bitrate, 2500000);
  assert.equal(f3.cfg.framerate, 30);
});

test('videoOfflineFitCfg: oltre il floor → null (il chiamante blocca)', () => {
  // floor 750000 bps: 1536MB*8/750000 = 16384 s. Oltre → null.
  const fit = videoOfflineFitCfg({ bitrate: 5000000, framerate: 30 }, preFor(20000));
  assert.equal(fit, null);
});

test('videoOfflineFitCfg: mai oltre il bitrate chiesto (scelta utente rispettata)', () => {
  const cfg = { bitrate: 1500000, framerate: 24 };
  const fit = videoOfflineFitCfg(cfg, preFor(5400));
  // allowed ≈ 2.27 Mbps > 1.5 → invariato.
  assert.equal(fit.changed, false);
  assert.equal(fit.cfg.bitrate, 1500000);
});

test('videoOfflineFitCfg: righe vuote → cfg invariato, nessun throw', () => {
  const fit = videoOfflineFitCfg({ bitrate: 5000000, framerate: 30 }, { rows: [], res: [1280, 720] });
  assert.equal(fit.changed, false);
  assert.equal(fit.cfg.bitrate, 5000000);
});

test('videoOfflineFitCfg: budget 4GB coerente con videoBitrateFor', () => {
  const fit = videoOfflineFitCfg({ bitrate: videoBitrateFor(1280), framerate: 30 }, preFor(60));
  assert.equal(fit.changed, false);
  assert.equal(MAX_BYTES, 4 * 384 * 1024 * 1024);
});
