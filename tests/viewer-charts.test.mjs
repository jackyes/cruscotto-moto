// Viewer C7: drawLine opts t0/t1/datasets/grid, downsampleMinMax, chartGeom/ticks.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadViewer } from './viewer-harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const T = (t, v) => ({ t, speed_kmh: v });

test('downsampleMinMax: picchi conservati, ordine temporale', () => {
  const { sandbox } = loadViewer();
  const { downsampleMinMax } = sandbox.__viewer;
  const rows = [];
  for (let k = 0; k < 100; k++) rows.push(T(k, k === 50 ? 999 : 10));
  const out = downsampleMinMax(rows, 20, r => r.speed_kmh);
  assert.ok(out.some(r => r.speed_kmh === 999), 'picco presente');
  assert.ok(out.length <= 22, 'lungo=' + out.length);
  for (let k = 1; k < out.length; k++) assert.ok(out[k].t >= out[k - 1].t, 'monotono');
  assert.deepEqual(downsampleMinMax([T(0, 1)], 2000, r => r.speed_kmh), [T(0, 1)]);
  assert.equal(downsampleMinMax(null, 10, r => r).length, 0);
});

test('chartGeom: X lineare su t0/t1, Y invertita (0 in basso)', () => {
  const { sandbox } = loadViewer();
  const g = sandbox.__viewer.chartGeom(600, 150, 100, 160, 0, 120, 8);
  assert.equal(g.X(100), 0);
  assert.equal(g.X(160), 600);
  assert.equal(g.X(130), 300);
  assert.ok(g.Y(0) > g.Y(120), 'asse y invertito');
});

test('chartTicks: step belli 1/2/5, coprono il range', () => {
  const { sandbox } = loadViewer();
  const { chartTicks } = sandbox.__viewer;
  assert.deepEqual(chartTicks(0, 120, 4), [0, 50, 100]);
  assert.deepEqual(chartTicks(-1.5, 1.5, 4), [-1, 0, 1]);
  const tk = chartTicks(0, 0.5, 4);
  assert.ok(tk.length >= 2 && tk[0] >= 0 && tk[tk.length - 1] <= 0.5 + 1e-9);
  assert.deepEqual(chartTicks(5, 5, 4), [5]);
});

test('drawLine: datasets multipli, dominio t0/t1, dash senza lanciare', () => {
  const { sandbox } = loadViewer();
  const { drawLine } = sandbox.__viewer;
  const cv = { clientWidth: 600, clientHeight: 150, width: 0, height: 0, getContext: () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}) }) };
  const main = [T(0, 10), T(10, 20)];
  const over = [{ t: 5, speed_kmh: 99 }, { t: 15, speed_kmh: 99 }];
  assert.doesNotThrow(() => drawLine(cv, main, (r) => r.speed_kmh, {
    min: 0, max: 100, t0: 0, t1: 15,
    series: [{ key: 'speed_kmh', color: '#fff' }],
    datasets: [{ rows: over, getY: r => r.speed_kmh, series: [{ key: 'speed_kmh', color: '#888', dash: [5, 4] }] }],
  }));
  assert.doesNotThrow(() => drawLine(cv, [], () => 0, { min: 0, max: 1, series: [] }));
});

test('drawLine: grid default on, off con solo zero-line', () => {
  const { sandbox } = loadViewer();
  const { drawLine } = sandbox.__viewer;
  const calls = [];
  const cv = {
    clientWidth: 600, clientHeight: 150, width: 0, height: 0,
    getContext: () => new Proxy({}, {
      get: (t, k) => {
        if (k === 'fillText') return (s) => { calls.push(s); };
        if (k === 'measureText') return () => ({ width: 10 });
        return () => {};
      },
    }),
  };
  drawLine(cv, [T(0, 1)], () => 1, { min: 0, max: 10, series: [] });
  assert.ok(calls.length > 0, 'tick labels disegnate');
  calls.length = 0;
  drawLine(cv, [T(0, 1)], () => 1, { min: 0, max: 10, series: [], grid: false });
  assert.equal(calls.length, 0, 'grid off: nessun label');
});

test('drop: stopPropagation evita doppia gestione file', () => {
  // Il listener drop della label deve stoppare la propagazione a window:
  // senza, handleFiles gira due volte (doppio parse + doppio render).
  const src = readFileSync(join(root, 'viewer.html'), 'utf8');
  assert.ok(src.includes('stopPropagation'), 'label drop stoppa il bubble a window');
});
