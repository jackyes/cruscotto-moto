'use strict';
/* js/csv.js (step 3): builder CSV/GPX puri (no state/DOM/toast). exportCsv/exportGpx restano inline: usano toast+downloadBlob. */
/* Le colonne nuove vanno IN CODA: un parser che legge per posizione non si rompe, e
   le sessioni salvate prima della riscrittura escono con quei campi vuoti (num()
   restituisce già '' per null/undefined). */
const CSV_HEADER = 't,speed_kmh,speed_ms,lean_deg,lat_accel_g,lon_accel_g,vert_accel_g,' +
  'lat_peak_g,lon_peak_g,vert_peak_g,lat_accel_fus_g,lon_accel_fus_g,' +
  'gyro_roll_dps,gap,vib_g,lat,lon,alt_m,heading_deg,gps_acc_m,' +
  'pitch_deg,gyro_yaw_dps,speed_fus_ms,lean_kin_deg,vib_hi_g,lean_ref';

function csvMeta(meta) {
  return [
    '# cruscotto-moto export',
    '# sessione: ' + (meta.startISO || new Date().toISOString()),
    '# max_lean_D: ' + (meta.maxLeanR||0).toFixed(1) + ', max_lean_S: ' + (meta.maxLeanL||0).toFixed(1),
    '# max_speed_kmh: ' + (meta.maxSpeed||0).toFixed(1),
    '# distanza_km: ' + (meta.distKm||0).toFixed(3),
  ].join('\n');
}

const num = (v, d) => (v == null || !isFinite(v)) ? '' : v.toFixed(d);

function csvRows(rows) {
  return rows.map(r => [
    num(r.t, 3), num(r.speedKmh, 1), num(r.speedMs, 2), num(r.lean, 2),
    num(r.latG || 0, 3), num(r.lonG || 0, 3), num(r.vertG || 0, 3),
    num(r.latPk || 0, 3), num(r.lonPk || 0, 3), num(r.vertPk || 0, 3),
    num(r.latFus || 0, 3), num(r.lonFus || 0, 3),
    num(r.gyro || 0, 2), r.gap ? '1' : '0', num(r.vib || 0, 3),
    num(r.lat, 6), num(r.lon, 6), num(r.alt, 1), num(r.heading, 1), num(r.gpsAcc, 1),
    num(r.pitch, 2), num(r.yaw, 2), num(r.speedFus, 2), num(r.leanKin, 2),
    num(r.vibHi, 3), r.leanRef || ''
  ].join(',')).join('\n');
}

function buildCsv(rows, meta) {
  return csvMeta(meta) + '\n' + CSV_HEADER + '\n' + csvRows(rows);
}

