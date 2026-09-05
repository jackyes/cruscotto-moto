import { test } from 'node:test';
import assert from 'node:assert';
import { loadViewer } from './viewer-harness.mjs';

const { __viewer } = loadViewer().sandbox;
const { COLS, parseCsv, viewerStats, render } = __viewer;

test('COLS: 26 colonne come CSV_HEADER app', () => {
  assert.equal(COLS.length, 26);
  assert.equal(COLS[0], 't');
  assert.ok(COLS.includes('gyro_roll_dps'));
  assert.ok(COLS.includes('vib_g'));
  assert.ok(COLS.includes('gap'));
  assert.ok(COLS.includes('pitch_deg'));
});

test('parseCsv: header 26 col ok, legacy 9 col senza crash', () => {
  const full = COLS.join(',') + '\n' + COLS.map((c, i) => c === 't' ? '5' : String(i)).join(',') + '\n';
  const rows = parseCsv(full);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].t, 5);
  assert.equal(rows[0].vib_g, 14);
  const legacy = 't,speed_kmh,lean_deg,lat_accel_g,lon_accel_g,vert_accel_g,alt_m,lat,lon\n0,50,10,0.1,0,0,200,42.5,12.5\n';
  const old = parseCsv(legacy);
  assert.equal(old.length, 1);
  assert.equal(old[0].vib_g, null, 'colonna assente -> null');
  assert.equal(old[0].speed_kmh, 50);
});

test('viewerStats: vmax/vmedia/lean/dist/vibMax/gap', () => {
  const rows = [
    { t: 0, speed_kmh: 0, lean_deg: 0, vib_g: 0.1, gap: 0, lat: 42.5, lon: 12.5 },
    { t: 10, speed_kmh: 100, lean_deg: 30, vib_g: 0.5, gap: 1, lat: 42.51, lon: 12.51 },
    { t: 20, speed_kmh: 50, lean_deg: -15, vib_g: 0.2, gap: 0, lat: 42.52, lon: 12.52 },
  ];
  const st = viewerStats(rows);
  assert.equal(st.vmax, 100);
  assert.equal(st.vavg, 50);
  assert.equal(st.leanR, 30);
  assert.equal(st.leanL, -15);
  assert.ok(st.dist > 0);
  assert.equal(st.vibMax, 0.5);
  assert.equal(st.gapCount, 1);
  assert.equal(st.trackPts.length, 3);
});

test('viewerStats: righe vuote senza crash', () => {
  const st = viewerStats([]);
  assert.equal(st.vmax, 0);
  assert.equal(st.vavg, 0);
  assert.equal(st.dist, 0);
  assert.equal(st.vibMax, null);
  assert.equal(st.gapCount, 0);
});
