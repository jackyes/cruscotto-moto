// Video 9:16 reel: risoluzioni, bitrate, layout verticale, camera zoom.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoResFor, videoBitrateFor, videoFrameLayout, videoCameraFor,
  hudLayout, hudMotoBox, rectsOverlap } = api;

test('videoResFor: 3 chiavi, default 720p su ignote', () => {
  assert.deepEqual(videoResFor('720'), [1280, 720]);
  assert.deepEqual(videoResFor('1080'), [1920, 1080]);
  assert.deepEqual(videoResFor('916'), [720, 1280]);
  assert.deepEqual(videoResFor('xxx'), [1280, 720]);
  assert.deepEqual(videoResFor(null), [1280, 720]);
});

test('videoBitrateFor: 8 Mbps solo a 1920+, 9:16 resta a 5', () => {
  assert.equal(videoBitrateFor(1920), 8_000_000);
  assert.equal(videoBitrateFor(2560), 8_000_000);
  assert.equal(videoBitrateFor(1280), 5_000_000);
  assert.equal(videoBitrateFor(720), 5_000_000); // reel: 0.92 Mpx come 720p
});

test('videoFrameLayout: orizzontale side-by-side, verticale impilato', () => {
  const h = videoFrameLayout(1280, 720);
  assert.equal(h.vert, false);
  assert.ok(h.map.w > h.map.h * 0.5, 'mappa larga in orizzontale');
  assert.equal(h.dash.y, 0);
  // Mappa+dash affiancati coprono W in alto, spark copre W in basso.
  assert.equal(h.map.x + h.map.w, h.dash.x, 'mappa+dash adiacenti');
  assert.equal(h.map.w + h.dash.w, 1280, 'copertura W fascia alta');
  assert.equal(h.spark.w, 1280, 'spark tutta larghezza');
  assert.equal(h.map.h + h.spark.h, 720, 'copertura H');
  const v = videoFrameLayout(720, 1280);
  assert.equal(v.vert, true);
  // Impilati: dash sopra, mappa centro, spark sotto, stessa larghezza.
  assert.equal(v.dash.x, 0); assert.equal(v.map.x, 0); assert.equal(v.spark.x, 0);
  assert.equal(v.dash.w, 720); assert.equal(v.map.w, 720); assert.equal(v.spark.w, 720);
  assert.ok(v.dash.y < v.map.y && v.map.y < v.spark.y, 'ordine verticale');
  assert.equal(v.dash.y + v.dash.h + v.map.h + v.spark.h, 1280, 'copertura totale');
  assert.ok(v.dash.h >= 300, 'dash leggibile, non striscia');
  assert.ok(v.map.h > v.spark.h, 'mappa > spark');
});

test('videoCameraFor: vert aggiunge zoom, falsy invariato', () => {
  const base = videoCameraFor(60, 20);
  const vert = videoCameraFor(60, 20, true);
  assert.ok(vert.zoom > base.zoom, 'zoom in su striscia stretta');
  assert.equal(vert.pitch, base.pitch, 'pitch invariato');
  assert.deepEqual(videoCameraFor(60, 20, false), base);
  assert.deepEqual(videoCameraFor(60, 20, undefined), base);
  assert.deepEqual(videoCameraFor(60, 20, null), base);
});

test('hudLayout 9:16: nessun widget sul box moto, nessuna sovrapposizione', () => {
  const L = hudLayout(720, 1280);
  assert.equal(L.vert, true);
  const box = hudMotoBox(720, 1280);
  for (const k of ['speed', 'time', 'g', 'lean', 'vmax']) {
    assert.ok(!rectsOverlap(L[k], box), k + ' sul box moto');
  }
  const ks = ['speed', 'time', 'g', 'lean', 'vmax'];
  for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
    assert.ok(!rectsOverlap(L[ks[a]], L[ks[b]]), ks[a] + ' vs ' + ks[b]);
  }
  for (const k of ks) {
    const r = L[k];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 720 && r.y + r.h <= 1280, k + ' in frame');
  }
});
