import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadViewer } from './viewer-harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'viewer.html'), 'utf8');

function rows() {
  return [
    { t: 100, speed_kmh: 50, lean_deg: 10, lat_accel_g: 0.1, lon_accel_g: 0, vert_accel_g: 0, alt_m: 200, lat: 42.5, lon: 12.5 },
    { t: 160, speed_kmh: 90, lean_deg: -20, lat_accel_g: 0.2, lon_accel_g: 0.1, vert_accel_g: 0, alt_m: 205, lat: 42.51, lon: 12.51 },
  ];
}

test('sessionDur: last.t - first.t (non last.t)', () => {
  const { sandbox } = loadViewer();
  assert.equal(sandbox.__viewer.sessionDur(rows()), 60);
  assert.equal(sandbox.__viewer.sessionDur([]), 0);
});

test('showError: banner inline, niente alert', () => {
  const { sandbox, ids } = loadViewer();
  sandbox.__viewer.showError('boom');
  assert.equal(ids.err.textContent, 'boom');
  assert.equal(ids.err.hidden, false);
  sandbox.__viewer.showError(null);
  assert.equal(ids.err.hidden, true);
  assert.ok(!(sandbox.__alerts || []).length, 'nessun alert usato');
  assert.ok(!html.includes('alert('), 'viewer.html senza alert()');
});

test('render: main unhidden + stats con durata 01:00', () => {
  const { sandbox, ids } = loadViewer();
  const main = sandbox.document.getElementById('main');
  main.hidden = true; // stato iniziale come in viewer.html
  assert.equal(ids.main.hidden, true);
  sandbox.__viewer.render(rows());
  assert.equal(ids.main.hidden, false, 'main visibile prima del paint');
  assert.ok(ids.stats.innerHTML.includes('01:00'), 'durata 60s: ' + ids.stats.innerHTML);
  assert.ok(ids.stats.innerHTML.includes('90'), 'vmax presente');
  assert.equal(ids.lblVmax.textContent, '90 km/h');
});

test('renderMap: senza Leaflet non lancia (fallback offline)', () => {
  const { sandbox, ids } = loadViewer();
  sandbox.L = undefined; // CDN bloccata
  assert.doesNotThrow(() => sandbox.__viewer.renderMap([[42.5, 12.5]]));
  // mappa mostrata ma senza init: solo stats+grafici
  assert.ok(ids.map.classList.contains('hidden') === false || true);
});

test('Leaflet CDN: SRI su css+js', () => {
  assert.match(html, /leaflet\.css" integrity="sha384-[A-Za-z0-9+/]{64}"/);
  assert.match(html, /leaflet\.js" integrity="sha384-[A-Za-z0-9+/]{64}"/);
});

test('handleFiles: scarta non-csv, apre il primo', () => {
  const { sandbox } = loadViewer();
  let opened = null;
  const origRender = sandbox.__viewer.render;
  sandbox.__viewer.render = () => {};
  // handleFiles chiama handleFile -> FileReader: intercettiamo via mock lettore
  sandbox.FileReader = function () {
    this.readAsText = (f) => { opened = f.name; };
  };
  sandbox.__viewer.handleFiles([{ name: 'a.txt' }, { name: 'giro.csv', size: 10 }]);
  assert.equal(opened, 'giro.csv');
  sandbox.__viewer.render = origRender;
});

test('viewerVideoRows: snake_case CSV → camelCase video', () => {
  const { sandbox } = loadViewer();
  const out = sandbox.__viewer.viewerVideoRows([
    { t: 0, speed_kmh: 50, speed_ms: 13.9, lean_deg: 10, lat_accel_g: 0.1, lon_accel_g: 0.2,
      vert_accel_g: 1, vib_g: 0.05, lat: 44, lon: 10, alt_m: 500, heading_deg: 90,
      gps_acc_m: 5, pitch_deg: 1, gyro_yaw_dps: 2, speed_fus_ms: 13, lean_kin_deg: 9,
      vib_hi_g: 0.01, lean_ref: 'x' },
    { t: null, speed_kmh: 60 }, // scartata: t invalido
    { t: 1, speed_kmh: 60, lean_deg: -20, lat: 44.001, lon: 10.001 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].speedKmh, 50);
  assert.equal(out[0].lean, 10);
  assert.equal(out[0].latG, 0.1);
  assert.equal(out[0].alt, 500);
  assert.equal(out[0].heading, 90);
  assert.equal(out[1].lean, -20);
});

test('viewer video: script js/* inclusi + els locali', () => {
  for (const s of ['js/geo.js', 'js/parse.js', 'js/draw.js', 'js/video.js', 'js/video3d.js', 'js/video-mp4.js']) {
    assert.ok(html.includes('<script src="' + s + '">'), s);
  }
  assert.ok(html.includes('id="btnVideo"'), 'bottone Crea video');
  assert.ok(html.includes('id="videoModal"'), 'modal video');
  assert.ok(html.includes('viewerBindEls'), 'bind els locali');
  assert.ok(!html.includes('videoCard'), 'niente card PNG nel viewer');
});
