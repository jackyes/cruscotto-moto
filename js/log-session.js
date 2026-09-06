'use strict';
/* js/log-session.js (step 24): toggleFullscreen, stato lastSampleWall, start/stopLog, setLogButton, buildGpx. Ordine: dopo js/nav-map.js. */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen && document.exitFullscreen().catch(() => {});
  }
}

let lastSampleWall = 0;


function startLog() {
  state.logging = true;
  state._flushWarned = false;
  state.rows = [];
  state.track = [];
  state._leafN = 0;
  state.sessionId = 's_' + Date.now();
  state.flushSeq = 0;
  state.flushedRows = 0;
  lastSampleWall = 0;
  state.session = {
    maxSpeed: 0, maxLeanR: 0, maxLeanL: 0, distKm: 0,
    start: performance.now(), startWall: Date.now(), endWall: 0,
    lastPos: state.pos.lat != null ? { lat: state.pos.lat, lon: state.pos.lon } : null
  };
  lastFlush = performance.now();
  resetLogAcc();
  idb.clearChunks().catch(() => {});
  clearInterval(sampleTimer);
  sampleTimer = setInterval(sampleTick, SAMPLE_MS);
  setLogButton(true);
  updateGuidaMode();
}

async function stopLog() {
  state.logging = false;
  clearInterval(sampleTimer);
  sampleTimer = null;
  resetLogAcc();
  state.session.endWall = Date.now();
  setLogButton(false);
  updateGuidaMode();
  await flushLog();
  await saveSession();
}

function setLogButton(rec) {
  els.btnLogTop.textContent = rec ? '■ Stop' : '▶ Start';
  els.btnLogTop.classList.toggle('rec', rec);
  els.recBadge.classList.toggle('on', rec);
}

function buildGpx(track) {
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += '<gpx version="1.1" creator="cruscotto-moto" xmlns="http://www.topografix.com/GPX/1/1">\n';
  out += '  <trk>\n    <name>Cruscotto Moto</name>\n    <trkseg>\n';
  for (const p of track) {
    out += `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`;
    if (p.alt != null) out += `<ele>${p.alt.toFixed(1)}</ele>`;
    if (p.ts) out += `<time>${new Date(p.ts).toISOString()}</time>`;
    out += '</trkpt>\n';
  }
  out += '    </trkseg>\n  </trk>\n</gpx>\n';
  return out;
}
