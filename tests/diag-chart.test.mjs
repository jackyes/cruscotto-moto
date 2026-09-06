import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

test('diagVerdict: livelli utente', () => {
  assert.match(api.diagVerdict({ calib: false, demo: false }), /Non calibrato/);
  assert.match(api.diagVerdict({ calib: true, vibG: 0.05 }), /OK/);
  assert.match(api.diagVerdict({ calib: true, vibG: 0.2 }), /media/);
  assert.match(api.diagVerdict({ calib: true, vibG: 0.5 }), /alta/);
  assert.match(api.diagVerdict({ demo: true, vibG: 0 }), /OK/);
});

test('diagTicks: belli 1/2/5, include zero, range coperto', () => {
  const t = api.diagTicks(-1.2, 1.2, 4);
  assert.ok(t.includes(0), 'zero marcato, non interpolato');
  assert.ok(t.every(v => v >= -1.2 - 1e-9 && v <= 1.2 + 1e-9), 'tick interni al range: ' + JSON.stringify(t));
  const t2 = api.diagTicks(0, 100, 4);
  assert.deepEqual(t2, [0, 50, 100], 'step 50 (norm 3.3 -> 5): ' + JSON.stringify(t2));
});

test('diagChartScale: velocita dinamica, piega/G fissi', () => {
  const s = api.diagChartScale('speedKph', [{ speedKph: 10 }, { speedKph: 95 }]);
  assert.equal(s.min, 0);
  assert.ok(s.max >= 95 && s.max % 20 === 0);
  assert.deepEqual(api.diagChartScale('lean', []), { min: -60, max: 60, zero: true });
  assert.deepEqual(api.diagChartScale('latG', []), { min: -1.2, max: 1.2, zero: true });
});
