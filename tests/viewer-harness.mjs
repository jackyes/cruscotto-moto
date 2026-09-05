// Harness viewer.html standalone: estrae l'inline <script> (ultimo blocco,
// dopo il tag Leaflet CDN) e lo esegue in vm con mock DOM minimi.
// viewer.html resta standalone: nessun file condiviso, file:// ok.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function extractViewerScript(html) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) throw new Error('script viewer non trovato');
  let script = blocks[blocks.length - 1];
  // Unwrap IIFE solo nell'harness (viewer.html resta invariato):
  // così parseCsv & co. diventano top-level ed esportabili ai test.
  script = script.replace(/\(function\s*\(\)\s*\{\s*/, '');
  script = script.replace(/\}\)\(\);?\s*$/, '');
  return script + `
;globalThis.__viewer = {
  COLS, parseCsv, haversineKm, downsample, drawLine, getCss,
  renderMap, render, renderRows, fmtDur, handleFile, handleFiles,
  stripBom, toNumOrNull, splitCsvLine, showError, sessionDur, hasLeaflet,
};`;
}

function makeCanvas() {
  return {
    clientWidth: 600, clientHeight: 150, width: 0, height: 0,
    getContext: () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}) }),
  };
}

function makeEl() {
  return {
    style: {}, className: '', textContent: '', innerHTML: '', value: '', hidden: false,
    files: [], dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { return c; }, remove() {},
    getContext: undefined,
  };
}

const ids = {};
const documentMock = {
  getElementById: id => (ids[id] = ids[id] || (/^c[A-Z]/.test(id) ? makeCanvas() : makeEl())),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener: () => {},
  documentElement: makeEl(),
  hidden: false,
};
const windowMock = { addEventListener: () => {}, removeEventListener: () => {} };

export function loadViewer() {
  const html = readFileSync(join(root, 'viewer.html'), 'utf8');
  const script = extractViewerScript(html);
  const sandbox = {
    console, document: documentMock, window: windowMock,
    getComputedStyle: () => ({ getPropertyValue: () => '#888' }),
    FileReader: function () { sandbox.__lastReader = this; },
    alert: (msg) => { sandbox.__alerts = sandbox.__alerts || []; sandbox.__alerts.push(String(msg)); },
    requestAnimationFrame: fn => fn(),
    setTimeout: (fn) => 0, clearTimeout: () => {},
    L: {
      map: () => ({ removeLayer: () => {}, fitBounds: () => {}, invalidateSize: () => {} }),
      tileLayer: () => ({ addTo: () => {} }),
      polyline: () => ({ addTo: () => ({ getBounds: () => ({}) }) }),
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'viewer.html' });
  return { sandbox, ids };
}
