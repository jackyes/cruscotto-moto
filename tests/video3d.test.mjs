import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';
import { loadViewer } from './viewer-harness.mjs';

test('Fase 0: buildCameraKeyframes esposta in harness', () => {
  assert.equal(typeof api.buildCameraKeyframes, 'function');
  const kf = api.buildCameraKeyframes([
    { lat: 44.0, lon: 10.0 }, { lat: 44.001, lon: 10.001 }, { lat: 44.002, lon: 10.002 },
  ]);
  assert.equal(kf.length, 3);
  assert.ok(kf.every(k => isFinite(k.brg)));
});

test('Fase 0: viewer.html carica in sandbox con parseCsv', () => {
  const { sandbox } = loadViewer();
  assert.equal(typeof sandbox.__viewer.parseCsv, 'function');
  const rows = sandbox.__viewer.parseCsv('t,speed_kmh,lean_deg\n0,50,10\n1,60,-5\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].speed_kmh, 50);
});
