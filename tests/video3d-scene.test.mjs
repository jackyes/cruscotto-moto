// Scena 3D: cometa gradiente, hillshade dal conf (zero tile extra).
import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { videoCometPaint, videoHillPaint, VIDEO3D_CONF } = api;

test('videoCometPaint: gradiente testa opaca → coda trasparente', () => {
  const p = videoCometPaint();
  assert.ok(Array.isArray(p['line-gradient']), 'gradiente presente');
  const g = p['line-gradient'];
  assert.equal(g[0], 'interpolate');
  assert.equal(g[3], 0); // coda trasparente
  assert.equal(g[g.length - 2], 1); // testa a progress 1
  assert.ok(String(g[g.length - 1]).includes('29,78,216') || String(g[g.length - 1]).includes('1d4ed8'),
    'testa blu: ' + g[g.length - 1]);
  assert.equal(p['line-width'], VIDEO3D_CONF.trail.width + 1);
});

test('videoHillPaint: spec hillshade 4.7.1, valori dal conf', () => {
  const p = videoHillPaint();
  assert.equal(p['hillshade-exaggeration'], VIDEO3D_CONF.hill.exaggeration);
  assert.equal(p['hillshade-shadow-color'], VIDEO3D_CONF.hill.shadow);
  assert.ok(!('hillshade-illumination-anchor' in p), 'solo chiavi usate');
});

test('conf scena: hill + buildings presenti, trail esteso', () => {
  assert.ok(VIDEO3D_CONF.hill && VIDEO3D_CONF.buildings, 'conf presenti');
  assert.ok(VIDEO3D_CONF.trail.cometHead && VIDEO3D_CONF.trail.cometMid, 'colori cometa');
});
