import { test } from 'node:test';
import assert from 'node:assert';
import { loadViewer } from './viewer-harness.mjs';

function R(t, extra) {
  return Object.assign({ t, speed_kmh: 50, lean_deg: 0, lat: 42.5, lon: 12.5 }, extra);
}

test('splitLaps: gap==1 apre un nuovo giro', () => {
  const { sandbox } = loadViewer();
  const laps = sandbox.__viewer.splitLaps([R(0), R(1), R(2, { gap: 1 }), R(3)]);
  assert.equal(laps.length, 2);
  assert.equal(laps[0].rows.length, 2);
  assert.equal(laps[1].rows.length, 2);
  assert.equal(laps[1].rows[0].t, 2);
});

test('splitLaps: salto t>5s apre un nuovo giro', () => {
  const { sandbox } = loadViewer();
  const laps = sandbox.__viewer.splitLaps([R(0), R(1), R(30), R(31)]);
  assert.equal(laps.length, 2);
  assert.equal(laps[1].dur, 1);
});

test('splitLaps: giro singolo senza buchi, soglia custom', () => {
  const { sandbox } = loadViewer();
  assert.equal(sandbox.__viewer.splitLaps([R(0), R(1), R(2)]).length, 1);
  assert.equal(sandbox.__viewer.splitLaps([], 5).length, 0);
  // soglia 60s: salto di 30s resta stesso giro
  assert.equal(sandbox.__viewer.splitLaps([R(0), R(30)], 60).length, 1);
});

test('splitLaps: stats per giro (dur/vmax/dist)', () => {
  const { sandbox } = loadViewer();
  const laps = sandbox.__viewer.splitLaps([R(0, { speed_kmh: 80 }), R(2, { speed_kmh: 100, lat: 42.51, lon: 12.51 })]);
  assert.equal(laps.length, 1);
  assert.equal(laps[0].dur, 2);
  assert.equal(laps[0].vmax, 100);
  assert.ok(laps[0].dist > 0);
});

test('renderLapTable: 2 giri -> tabella visibile con righe', () => {
  const { sandbox, ids } = loadViewer();
  const laps = sandbox.__viewer.splitLaps([R(0), R(1), R(2, { gap: 1 }), R(3)]);
  sandbox.__viewer.renderLapTable(laps);
  assert.equal(ids.laps.hidden, false);
  assert.ok(ids.lapsBody.innerHTML.includes('<tr>'), 'righe tabella presenti');
  assert.equal(ids.lblLaps.textContent, '2 giri');
  sandbox.__viewer.renderLapTable([laps[0]]);
  assert.equal(ids.laps.hidden, true, 'giro singolo -> tabella nascosta');
});

test('buildFilteredCsv: header 26 col, NaN -> vuoto, righe senza t scartate', () => {
  const { sandbox } = loadViewer();
  const { buildFilteredCsv, COLS } = sandbox.__viewer;
  const csv = buildFilteredCsv([
    { t: 0, speed_kmh: 50, vib_g: NaN },
    { t: null, speed_kmh: 60 },
    { t: 1, speed_kmh: 60, vib_g: 0.3 },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 3, 'header + 2 righe valide');
  assert.equal(lines[0].split(',').length, COLS.length);
  const cols = lines[0].split(',');
  const vi = cols.indexOf('vib_g');
  assert.equal(lines[1].split(',')[vi], '', 'NaN -> cella vuota');
  assert.equal(lines[2].split(',')[vi], '0.3');
});

test('render con overlay: secondo dataset disegnato (no crash)', () => {
  const { sandbox } = loadViewer();
  const base = [R(0), R(1, { speed_kmh: 70 })];
  const over = [R(0, { speed_kmh: 40 }), R(1, { speed_kmh: 60 })];
  assert.doesNotThrow(() => sandbox.__viewer.render(base, over));
});
