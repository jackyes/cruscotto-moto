// Interruttore palazzi 3D: la scelta nella modale deve spegnere gli estrusi
// senza toccare il resto della scena (hillshade, scia, satellite).
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoBuildingLayerIds, videoSceneAddToMap, VIDEO3D_CONF } = api;

function fakeMap(layers) {
  const ids = layers.map(l => l.id);
  return {
    added: [], layout: {}, paint: {},
    getStyle() { return { layers }; },
    getLayer(id) { return ids.includes(id) ? { id } : undefined; },
    addLayer(spec) { this.added.push(spec.id); ids.push(spec.id); },
    setLayoutProperty(id, k, v) { (this.layout[id] = this.layout[id] || {})[k] = v; },
    setPaintProperty(id, k, v) { (this.paint[id] = this.paint[id] || {})[k] = v; },
  };
}

const LIBERTY = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill' },
  { id: 'building', type: 'fill' },
  { id: 'building-3d', type: 'fill-extrusion' },
  { id: 'poi_label', type: 'symbol' },
];

test('videoBuildingLayerIds: solo i fill-extrusion, per tipo non per id', () => {
  assert.deepEqual(videoBuildingLayerIds(LIBERTY), ['building-3d']);
  // Stile che rinomina/aggiunge estrusi: l'interruttore li prende comunque.
  assert.deepEqual(
    videoBuildingLayerIds([{ id: 'palazzi', type: 'fill-extrusion' }, { id: 'landmark', type: 'fill-extrusion' }]),
    ['palazzi', 'landmark']);
  assert.deepEqual(videoBuildingLayerIds([]), []);
  assert.deepEqual(videoBuildingLayerIds(null), []);
});

test('videoSceneAddToMap: default e true -> palazzi visibili e tinti', () => {
  for (const arg of [undefined, true]) {
    const map = fakeMap(LIBERTY.slice());
    videoSceneAddToMap(map, 'poi_label', arg);
    assert.equal(map.layout['building-3d'].visibility, 'visible', 'arg=' + arg);
    assert.equal(map.paint['building-3d']['fill-extrusion-color'], VIDEO3D_CONF.buildings.color);
    assert.equal(map.paint['building-3d']['fill-extrusion-opacity'], VIDEO3D_CONF.buildings.opacity);
  }
});

test('videoSceneAddToMap: false -> palazzi nascosti, niente tinta sprecata', () => {
  const map = fakeMap(LIBERTY.slice());
  videoSceneAddToMap(map, 'poi_label', false);
  assert.equal(map.layout['building-3d'].visibility, 'none');
  assert.ok(!map.paint['building-3d'], 'nessuna paint su un layer spento');
});

test('videoSceneAddToMap: hillshade aggiunto in entrambi i casi', () => {
  for (const b of [true, false]) {
    const map = fakeMap(LIBERTY.slice());
    videoSceneAddToMap(map, 'poi_label', b);
    assert.ok(map.added.includes('rilievo-ombreggiato'), 'hillshade con buildings=' + b);
    // Il fill 2D 'building' non è un estruso: lo tocca solo il ramo satellite.
    assert.ok(!map.layout['building'], 'footprint 2D non toccato');
  }
});

test('videoSceneAddToMap: stile senza estrusi non lancia', () => {
  const map = fakeMap([{ id: 'background', type: 'background' }]);
  assert.doesNotThrow(() => videoSceneAddToMap(map, null, false));
  assert.ok(map.added.includes('rilievo-ombreggiato'));
});
