import { test } from 'node:test';
import assert from 'node:assert';
import { loadViewer } from './viewer-harness.mjs';

const { __viewer } = loadViewer().sandbox;
const { parseCsv, stripBom, toNumOrNull, splitCsvLine, COLS } = __viewer;

test('splitCsvLine: virgole quotate + escape ""', () => {
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(splitCsvLine('"a""b",c'), ['a"b', 'c']);
  assert.deepEqual(splitCsvLine('a,,c'), ['a', '', 'c']);
});

test('stripBom: rimuove BOM iniziale', () => {
  assert.equal(stripBom('﻿t,v'), 't,v');
  assert.equal(stripBom('t,v'), 't,v');
});

test('toNumOrNull: vuoti/NaN/Infinity -> null', () => {
  assert.equal(toNumOrNull(''), null);
  assert.equal(toNumOrNull('  '), null);
  assert.equal(toNumOrNull(null), null);
  assert.equal(toNumOrNull('abc'), null);
  assert.equal(toNumOrNull('NaN'), null);
  assert.equal(toNumOrNull('Infinity'), null);
  assert.equal(toNumOrNull('12.5'), 12.5);
  assert.equal(toNumOrNull('0'), 0);
});

test('parseCsv: BOM + quotato + NaN -> null (no NaN nei dati)', () => {
  const csv = '﻿t,speed_kmh,lean_deg,lat_accel_g,lon_accel_g,vert_accel_g,alt_m,lat,lon\n' +
    '0,"10,5",NaN,,,1.0,100,42.5,12.5\n' +
    '1,20,5,0.1,0.2,,101,42.6,12.6\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].speed_kmh, null); // "10,5" quotato non è numero -> null
  assert.equal(rows[0].lean_deg, null);  // NaN -> null
  assert.equal(rows[0].lat_accel_g, null);
  assert.equal(rows[0].vert_accel_g, 1.0);
  assert.equal(rows[1].speed_kmh, 20);
  for (const r of rows) for (const c of COLS) assert.ok(r[c] === null || isFinite(r[c]), c + ' finito');
});

test('parseCsv: commenti # e righe senza t scartate', () => {
  const csv = '# commento\nt,speed_kmh,lean_deg,lat_accel_g,lon_accel_g,vert_accel_g,alt_m,lat,lon\n' +
    ',20,5,0,0,0,100,42,12\n' +
    '2,30,6,0,0,0,100,42,12\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].t, 2);
});
