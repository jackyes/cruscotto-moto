// Opzioni mappa 3D: budget frame + tetto pitch + cielo visibile.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoMapOptions, videoMapPixelRatio, videoSkyOptions, videoSkyVisible,
  videoCameraFor, VIDEO3D_CONF } = api;

test('videoMapOptions: centro lon/lat, budget flags, tetto legale', () => {
  const o = videoMapOptions(45.1, 9.2);
  assert.deepEqual(o.center, [9.2, 45.1]); // ordine maplibre: lon,lat
  assert.equal(o.pixelRatio, 1);
  assert.equal(o.fadeDuration, 0);
  assert.equal(o.preserveDrawingBuffer, true);
  assert.equal(o.attributionControl, false);
  assert.ok(o.maxPitch <= 85, 'maplibre 4.7.1 lancia sopra 85');
  assert.ok(o.maxPitch >= 60);
});

test('videoCameraFor non supera mai maxPitch della mappa', () => {
  for (let lean = 0; lean <= 60; lean += 5) {
    assert.ok(videoCameraFor(0, lean).pitch <= VIDEO3D_CONF.map.maxPitch,
      'pitch ' + videoCameraFor(0, lean).pitch + ' clampato in silenzio');
  }
  assert.ok(videoCameraFor(200, 999).pitch <= VIDEO3D_CONF.map.maxPitch);
});

test('videoMapPixelRatio: mai sopra dpr, mai oltre 4096, sporco -> 1', () => {
  for (const [W, H] of [[1280, 720], [1920, 1080]]) {
    for (const dpr of [1, 1.5, 2, 2.625, 3, 4]) {
      const pr = videoMapPixelRatio(dpr, W, H);
      assert.ok(pr >= 1 && pr <= dpr);
      assert.ok(Math.max(W, H) * pr <= 4096, `W=${W} dpr=${dpr} pr=${pr}`);
    }
  }
  assert.equal(videoMapPixelRatio(NaN, 1280, 720), 1);
  assert.equal(videoMapPixelRatio(0, 1280, 720), 1);
  assert.equal(videoMapPixelRatio(undefined, 1280, 720), 1);
  assert.equal(videoMapPixelRatio(-2, 1280, 720), 1);
});

test('sky: solo chiavi spec 4.7.1, colori hex, blend in [0,1]', () => {
  const OK = ['sky-color', 'sky-horizon-blend', 'horizon-color', 'horizon-fog-blend', 'fog-color', 'fog-ground-blend'];
  const sky = videoSkyOptions();
  assert.deepEqual(Object.keys(sky).filter(k => !OK.includes(k)), []);
  for (const [k, v] of Object.entries(sky)) {
    if (k.endsWith('-color')) assert.match(v, /^#[0-9a-fA-F]{6}$/, k);
    if (k.endsWith('-blend')) assert.ok(v >= 0 && v <= 1, k);
  }
});

test('videoSkyVisible: il cielo si vede solo a pitch alto', () => {
  assert.equal(videoSkyVisible(60), false);
  assert.equal(videoSkyVisible(68), false);
  assert.equal(videoSkyVisible(75), true);
  // contratto: a piega max il pitch deve mostrare il cielo configurato
  assert.equal(videoSkyVisible(videoCameraFor(0, 60).pitch), true);
});
