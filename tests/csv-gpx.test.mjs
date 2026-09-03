import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { num, csvRows, csvMeta, buildCsv, buildGpx, stamp, fmtDur, CSV_HEADER } = api;

test('num: formattazione e valori assenti', () => {
  assert.equal(num(1.2345, 2), '1.23');
  assert.equal(num(0, 1), '0.0');
  assert.equal(num(-3.14159, 3), '-3.142');
  assert.equal(num(null, 2), '');
  assert.equal(num(undefined, 2), '');
  assert.equal(num(NaN, 2), '');
  assert.equal(num(Infinity, 2), '');
});

test('csvRows: ordine colonne, gap e lean_ref', () => {
  const row = {
    t:0, speedKmh:0, speedMs:0, lean:12.34,
    latG:0.1, lonG:-0.2, vertG:0, latPk:0.2, lonPk:0.3, vertPk:0.4,
    latFus:0.5, lonFus:0.6, gyro:7.8, gap:1, vib:0.15,
    lat:45.1234567, lon:9.9876543, alt:100.4, heading:180.5, gpsAcc:5.5,
    pitch:1.2, yaw:3.4, speedFus:20.1, leanKin:11.2, vibHi:0.05, leanRef:'raw'
  };
  const line = csvRows([row]);
  const f = line.split(',');
  assert.equal(f.length, CSV_HEADER.split(',').length);
  assert.equal(f[3], '12.34');
  assert.equal(f[13], '1');
  assert.equal(f[15], '45.123457');
  assert.equal(f[16], '9.987654');
  assert.equal(f[25], 'raw');
});

test('csvRows: campi nulli diventano vuoti, non NaN', () => {
  const row = { t:1, lean:null, lat:null, lon:null, gap:0, leanRef:null };
  const line = csvRows([row]);
  assert.ok(!line.includes('NaN'));
  assert.equal(line.split(',')[3], '');
});

test('csvMeta/buildCsv: struttura', () => {
  const meta = { startISO:'2024-01-01T10:00:00.000Z', maxLeanR:40, maxLeanL:35, maxSpeed:120, distKm:12.345 };
  const m = csvMeta(meta);
  assert.ok(m.startsWith('# cruscotto-moto export'));
  assert.ok(m.includes('max_speed_kmh: 120.0'));
  assert.ok(m.includes('distanza_km: 12.345'));
  const csv = buildCsv([{t:0, lean:0, gap:0}], meta);
  assert.ok(csv.startsWith('# cruscotto-moto export'));
  assert.ok(csv.includes(CSV_HEADER));
  assert.equal(csv.split('\n').length, 7); // 5 righe meta + header + 1 riga dati
});

test('buildGpx: struttura, ele/time opzionali', () => {
  const ts = Date.parse('2024-01-01T00:00:00Z');
  const gpx = buildGpx([{lat:45, lon:9, alt:100, ts}]);
  assert.ok(gpx.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(gpx.includes('<trkpt lat="45.0000000" lon="9.0000000">'));
  assert.ok(gpx.includes('<ele>100.0</ele>'));
  assert.ok(gpx.includes('<time>2024-01-01T00:00:00.000Z</time>'));
  assert.ok(gpx.includes('</trkseg>'));
  const gpx2 = buildGpx([{lat:45, lon:9, alt:null}]);
  assert.ok(!gpx2.includes('<time>'));
  assert.ok(!gpx2.includes('<ele>'));
});

test('stamp: formato YYYYMMDD_HHMMSS', () => {
  assert.match(stamp(), /^\d{8}_\d{6}$/);
});

test('fmtDur: cronometro mm:ss', () => {
  assert.equal(fmtDur(0), '00:00');
  assert.equal(fmtDur(65), '01:05');
  assert.equal(fmtDur(3599), '59:59');
  assert.equal(fmtDur(3600), '60:00');
});
