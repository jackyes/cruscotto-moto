// Test harness: carica index.html (app "no build") ed espone le funzioni pure
// in una sandbox Node, senza eseguire init() e senza toccare il DOM reale.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function extractScript(html) {
  const open = html.lastIndexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open < 0 || close < 0 || close <= open) throw new Error('script non trovato');
  return html.slice(open + '<script>'.length, close);
}

// File js/* caricati da index.html via <script src>, in ordine di inclusione.
// Lo split è a step: ogni nuovo modulo va aggiunto sia qui (ordine uguale
// all'HTML) sia nella lista SHELL di sw.js.
function extractJsSrcs(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
}

const jsParts = extractJsSrcs(html).map(s => readFileSync(join(root, s), 'utf8'));

let script = extractScript(html);
// Rimuove l'unica esecuzione al boot: init() registra listener, apre IndexedDB,
// avvia i sensori, ecc. Qui vogliamo solo le definizioni.
script = script.replace(/\ninit\(\);\s*$/, '');

// Esporta i binding lessicali (const/let, invisibili da fuori) e le funzioni.
const exportLine = `
;globalThis.__api = {
  state, logAcc, els, idb, saveSession, recoverChunks, toast, renderHistory,
  lastMotionT, lastSampleWall,
  G, LOG_HZ, FLUSH_MS, MAX_ROWS, TRACK_MAX, CHART_WINDOW, SPEED_DEADBAND_MS, TRACK_MIN_M, GPS_ACC_MAX,
  CAM_RADIUS_CHOICES, CAM_RADIUS_DEFAULT, CAM_MARKER_FACTOR, CAM_MOVE_FACTOR, CAM_MARKER_MAX,
  CAM_STALE_MS, CAM_COOLDOWN_MS, CAM_FAIL_BACKOFF_MS, CAM_GRID_DEG, CAM_AHEAD_DEG,
  ATT_KP, ATT_KI, ATT_BIAS_MAX_DPS, ATT_TOL_G, CENTRIP_MIN_MS, NORM_MODE_TRUST,
  LEAN_SMOOTH_TAU_S, LEAN_GYRO_MAX_DPS, ACC_MEDIAN_S, ACC_LP_TAU_S, VIB_TAU_S, LEAN_VIB_MAX,
  GPS_LAG_S, SPEED_HIST_S, SPEED_STALE_MS, SPEED_MAX_DEV_MS, STOP_SPEED_MS, STOP_ROLL_DPS, STOP_VIB_G,
  GSIGN_TAU_S, GSIGN_MIN_ENERGY, DESPIKE_G, DESPIKE_RATIO, ACCEL_LIMIT_G, ACC_BIAS_MAX_G, ACC_BIAS_S, FUS_TAU_S,
  LEAN_GYRO_SIGN_DEFAULT, SAMPLE_MS, GAP_MS, DISPLAY_HZ, HEADING_MIN_MS,
  CALIB_MS, CALIB_MAX_ROT_DPS, CALIB_MAX_NORM_DEV, CALIB_MAX_SPREAD_DEG, CALIB_MAX_BAD_RATIO, CALIB_MAX_MEAN_ROT,
  MOUNT, CSV_HEADER, NAV_BANDS, NAV_ICON, OSRM_MOD_IT, OSRM_ORD_IT,
  MAN_ROUNDABOUT_IN, MAN_ROUNDABOUT_OUT, NAV_MAX_SEG_SCAN, NAV_HEAD_GATE_DEG,
  NAV_PASS_OVERSHOOT_M, NAV_PASS_EARLY_M, NAV_PASS_HEAD_DEG, NAV_CHAIN_MIN_M,
  axis, axisVec, vdot, vcross, vnorm, vadd, vsub, vscale, vlen, upVector,
  leanFromUp, pitchFromUp, buildBasis, calibBasis,
  despike, clampG, clamp01, medianWindow, pushAccHist, medianAcc, updateVibration, keepPeak, resetLogAcc,
  pushSpeedHist, aIntAt, propagateSpeed, correctSpeed, updateGpsAccel, updateAccelFusion,
  attitudeReference, updateAttitude, updateGyroSign, resetSensorFilters, processSample,
  haversine, haversineM, bearing, angleDiff, distM,
  camKey, cellKey, rebuildCamGrid, camsNear, camMarkerRadius, camMoveThreshold, camLabel, parseCamerasFile, allCameras,
  decodePolyline6, navShapePlausible, navBuild, navSegNearest, navLowerBound, navProject,
  navPassed, navAdvance, navBandDist, navFmtDist, navFmtShort, navFmtTime,
  osrmType, osrmText, osrmIdxOf, navFromOsrm, navParseCoords,
  csvMeta, num, csvRows, buildCsv, buildGpx, stamp, fmtDur, takeLogAvg, snapshot, findRowAt,
  pushBounded, camPrecompute, routeCacheKey, geoCacheKey, cacheGetFresh, cachePut,
  navRequestRoute, navGeocode, checkCameras, camsToDraw, maybeLoadCameras, fetchCameras,
  startCalibration, collectCalib, finishCalibration, sampleTick, flushLog,
  navPersistRoute, navRestore, fetchWithTimeout, navTick, navMaybeReroute, navTryOsrm,
  buildCameraKeyframes, disposeVideoMoto3D, videoWheelSpin, videoTrackIndexForRow,
  requestVideoFallback, clearVideoTimers, trackVideoTimer
};
`;

// vm senza moduli: i file gi/* condividono lo stesso scope globale del <script>
// inline, come i <script src> classici nell'HTML. Stesso ordine dell'HTML.
const full = jsParts.join('\n;\n') + '\n;\n' + script + exportLine;

function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: tag || 'div',
    style: {}, className: '', textContent: '', value: '', checked: false,
    disabled: false, dataset: {}, files: [], innerHTML: '',
    children: [], parentNode: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    append(c) { el.appendChild(c); },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    setAttribute() {}, getAttribute() { return null; },
    click() { (listeners['click'] || []).forEach(fn => fn({ target: el })); },
  };
  return el;
}

const noop = () => {};
const documentMock = {
  getElementById: () => makeEl(),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: tag => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag),
  createTextNode: t => ({ textContent: t }),
  addEventListener: noop,
  removeEventListener: noop,
  body: makeEl(),
  documentElement: makeEl(),
  visibilityState: 'visible',
};
const windowMock = {
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop, removeEventListener: noop }),
  devicePixelRatio: 1,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  isSecureContext: true,
};
const localStorageMock = (() => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
})();

const sandbox = {
  console,
  performance: { now: () => Date.now() },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: noop,
  document: documentMock,
  window: windowMock,
  navigator: {},
  localStorage: localStorageMock,
  location: { href: 'https://localhost/' },
};

vm.createContext(sandbox);
vm.runInContext(full, sandbox, { filename: 'index.html' });

export const api = sandbox.__api;

// Snapshot "pristine" dello stato: usato per azzerare state/logAcc fra un test e l'altro.
const pristineState = structuredClone(api.state);

export const vmSandbox = sandbox;

export function resetState() {
  for (const k of Object.keys(api.state)) if (!(k in pristineState)) delete api.state[k];
  Object.assign(api.state, structuredClone(pristineState));
  api.resetLogAcc();
  api.lastMotionT = 0;
  api.lastSampleWall = 0;
  return api.state;
}
