// MapLibre 5 + init robusto: altezza camera vera (tile da 512 px), zoom da altezza, conf v5+fallback.
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoCamHeightFor, videoZoomForHeight, videoSatProbe, VIDEO3D_CONF } = api;

test('videoCamHeightFor: formula doc §6.5 con le tile da 512 px di MapLibre', () => {
  // mpp=78271,5*cos44/2^17,4≈0,33, d=1,5*760=1140, h=1140*0,33*cos72≈115.
  const h = videoCamHeightFor(17.4, 72, 44, 760);
  assert.ok(h > 105 && h < 125, 'altezza: ' + h);
  // Viewport dimezzata (padding/orientamento) → metà altezza.
  const h2 = videoCamHeightFor(17.4, 72, 44, 380);
  assert.ok(h2 > 50 && h2 < 65, 'chase: ' + h2);
  // Metri per pixel di MapLibre: 40.075.016,686 m / (512 · 2^z) all'equatore.
  const z = 12;
  assert.ok(Math.abs(videoCamHeightFor(z, 0, 0, 1) - 1.5 * 40075016.686 / (512 * 2 ** z)) < 1e-6);
});

test('videoCamHeightFor: stesso zoom, viewport alta = più in alto', () => {
  const a = videoCamHeightFor(16, 70, 44, 760);
  const b = videoCamHeightFor(16, 70, 44, 1520);
  assert.ok(b > a * 1.9 && b < a * 2.1, a + ' vs ' + b);
});

test('videoZoomForHeight: 115 m → zoom che ricade ≈ 115 m', () => {
  const z = videoZoomForHeight(115, 72, 44, 760);
  assert.ok(z > 16 && z <= 18, 'zoom: ' + z);
  const h = videoCamHeightFor(z, 72, 44, 760);
  assert.ok(Math.abs(h - 115) < 8, 'roundtrip: ' + h);
});

test('correzione tile 512 px: zoom della camera identico a prima (il video non cambia)', () => {
  // Valori di videoCameraFor registrati PRIMA della correzione, su casi non al
  // tetto di zoom 18: costante e bersagli dimezzati insieme lasciano lo zoom uguale.
  const { videoCameraFor } = api;
  for (const [v, l, lat, H, zoom] of [
    [0, 60, 47, 380, 17.935797429247696], [60, 60, 47, 760, 17.842688024856216],
    [120, 60, 47, 760, 17.227978180741008], [180, 60, 47, 380, 16.227978180741008],
  ]) {
    const c = videoCameraFor(v, l, false, lat, H);
    assert.ok(Math.abs(c.zoom - zoom) < 1e-6, v + ' km/h: ' + c.zoom + ' vs ' + zoom);
  }
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

test('videoSatProbe: onload→true, onerror→false, timeout→false', async () => {
  // videoSatProbe gira nella sandbox vm: Image si mocka lì, non su globalThis.
  const { vmSandbox } = await import('./harness.mjs');
  const orig = vmSandbox.Image;
  const mockSrc = impl => { vmSandbox.Image = function () { return { set src(u) { impl.call(this, u); } }; }; };
  const probeP = (url, ms) => new Promise(res => videoSatProbe(url, ms, res));
  mockSrc(function () { const self = this; setTimeout(() => self.onload && self.onload(), 0); });
  assert.equal(await probeP('https://x/y', 5000), true);
  mockSrc(function () { const self = this; setTimeout(() => self.onerror && self.onerror(), 0); });
  assert.equal(await probeP('https://x/y', 5000), false);
  mockSrc(() => {}); // mai né load né error → timeout
  assert.equal(await probeP('https://x/y', 30), false);
  let seen = '';
  mockSrc(u => { seen = u; });
  videoSatProbe('https://x/tile/1/2/3', 5000, () => {});
  assert.ok(seen.includes('?p=') || seen.includes('&p='), seen);
  if (orig === undefined) delete vmSandbox.Image; else vmSandbox.Image = orig;
});

test('conf satellite: tile z/y/x Esri, attribution presente', () => {
  assert.ok(VIDEO3D_CONF.satTiles[0].includes('{z}/{y}/{x}'), VIDEO3D_CONF.satTiles[0]);
  assert.ok(VIDEO3D_CONF.satTiles[0].includes('arcgisonline'));
  assert.ok(VIDEO3D_CONF.satAttr.length > 0);
  assert.ok(VIDEO3D_CONF.demAttr.length > 0);
});

test('VIDEO3D_SAT_HIDE: nasconde i fill piatti, tiene edifici 3D e strade/labels', () => {
  const hide = api.VIDEO3D_SAT_HIDE;
  assert.ok(Array.isArray(hide) && hide.length > 10, 'lista corposa');
  for (const id of ['water', 'building', 'landcover_wood', 'landcover_grass', 'park', 'landuse_residential']) {
    assert.ok(hide.includes(id), 'manca ' + id);
  }
  // Edifici 3D (cinematico) e background NON in lista (background → opacity 0).
  assert.ok(!hide.includes('building-3d'), 'building-3d resta visibile');
  assert.ok(!hide.includes('background'), 'background si gestisce via paint, non visibility');
  // Strade, labels, waterway NON vanno nascosti: contesto sopra il satellite.
  for (const keep of ['road', 'waterway', 'place', 'label']) {
    assert.ok(!hide.some(id => id === keep), 'non nascondere ' + keep);
  }
});
