// MapLibre 5 + init robusto: altezza camera vera, zoom da altezza, conf v5+fallback.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoCamHeightFor, videoZoomForHeight, VIDEO3D_CONF } = api;

test('videoCamHeightFor: formula doc §6.5, valori reali', () => {
  // mpp=156543*cos44/2^17.4≈0.65, d=1.5*760=1140, h=1140*0.65*cos72≈230.
  const h = videoCamHeightFor(17.4, 72, 44, 760);
  assert.ok(h > 210 && h < 250, 'altezza: ' + h);
  // Viewport dimezzata (padding/orientamento) → metà altezza: ~115 = chase.
  const h2 = videoCamHeightFor(17.4, 72, 44, 380);
  assert.ok(h2 > 90 && h2 < 140, 'chase: ' + h2);
});

test('videoCamHeightFor: stesso zoom, viewport alta = più in alto', () => {
  const a = videoCamHeightFor(16, 70, 44, 760);
  const b = videoCamHeightFor(16, 70, 44, 1520);
  assert.ok(b > a * 1.9 && b < a * 2.1, a + ' vs ' + b);
});

test('videoZoomForHeight: 230 m → zoom che ricade ≈ 230 m', () => {
  const z = videoZoomForHeight(230, 72, 44, 760);
  assert.ok(z > 16 && z <= 18, 'zoom: ' + z);
  const h = videoCamHeightFor(z, 72, 44, 760);
  assert.ok(Math.abs(h - 230) < 15, 'roundtrip: ' + h);
});

test('videoZoomForHeight: clamp 18 (Esri sgrana oltre)', () => {
  assert.ok(videoZoomForHeight(10, 72, 44, 760) <= 18);
  assert.ok(isNaN(videoZoomForHeight(NaN, 72, 44, 760)));
  assert.ok(isNaN(videoZoomForHeight(110, 90, 44, 760))); // pitch verticale: cos<=0
});

test('conf maplibre 5 con fallback 4.7.1', () => {
  const lib = VIDEO3D_CONF.libs.find(l => l.global === 'maplibregl');
  assert.ok(lib.url.includes('@5.'), 'v5: ' + lib.url);
  assert.ok(lib.integrity && lib.integrity.startsWith('sha384-'));
  assert.ok(lib.fallback && lib.fallback.url.includes('4.7.1'));
  assert.ok(VIDEO3D_CONF.css.includes('@5.'));
  assert.ok(VIDEO3D_CONF.cssFallback.includes('4.7.1'));
});
