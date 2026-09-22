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
  state._trimWarned = false;
  state._flushFailN = 0;
  state._flushBackoffUntil = 0;
  // Protezione dello storico dallo sfratto: il momento giusto è quando sta
  // per nascere un giro da salvare. Non blocca l'avvio.
  requestPersistentStorage();
  state.rows = [];
  state.track = [];
  state.trackFull = [];
  state._trackWritten = 0;
  state._trackTrimmed = 0;
  state._leafN = 0;
  state._leafTrim = false;
  /* Latch del primo fitBounds (js/map.js:257,262): senza reset la mappa restava
     inquadrata sulla zona della sessione precedente. In una zona nuova, con il
     follow spento, solo "Centra" la recuperava. */
  state.mapFit = false;
  state.sessionId = 's_' + Date.now();
  state.flushSeq = 0;
  state.flushedRows = 0;
  state._rowsTrimmed = 0;
  lastSampleWall = 0;
  lastTrackT = 0;   // altrimenti il gate 1 Hz ritarda/scarta il primo punto della sessione nuova
  state.session = {
    maxSpeed: 0, maxLeanR: 0, maxLeanL: 0, distKm: 0,
    start: performance.now(), startWall: Date.now(), endWall: 0,
    lastPos: state.pos.lat != null ? { lat: state.pos.lat, lon: state.pos.lon } : null
  };
  lastFlush = performance.now();
  resetLogAcc();
  // Se c'è una sessione interrotta da recuperare (toast Recupera/Scarta ancora
  // aperto), non si cancellano i chunk: un tap su Start prima di rispondere
  // distruggerebbe per sempre il recupero non ancora visto.
  if (!state._recoveryPending) idb.clearChunks().catch(() => {});
  clearInterval(sampleTimer);
  sampleTimer = setInterval(sampleTick, SAMPLE_MS);
  setLogButton(true);
  updateGuidaMode();
}

async function stopLog() {
  state.logging = false;
  // Avvio automatico disarmato: fermare il log in marcia non deve farlo
  // ripartire 10 s dopo. Si riarma dopo AUTO_REARM_MS da fermi (autoLogTick).
  state._autoArmed = false;
  clearInterval(sampleTimer);
  sampleTimer = null;
  resetLogAcc();
  state.session.endWall = Date.now();
  setLogButton(false);
  updateGuidaMode();
  await flushLog();
  await saveSession();
  // Senza questo aggiornamento finale cronometro (endWall) e statistiche
  // restavano congelati sull'ultimo frame di logging: un utente che ferma il
  // log vedeva massimi/distanza/tempo fermi fino al prossimo input.
  updateDisplay();
  // Aggiornamento service worker rimandato perché si stava registrando: ora
  // che la sessione è salvata su disco, si può ripartire col codice nuovo.
  if (state._swUpdatePending) {
    state._swUpdatePending = false;
    try { location.reload(); } catch (e) {}
  }
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
    // alt non-finito (NaN da sessioni storiche) emetteva <ele>NaN</ele>;
    // ts invalido faceva lanciare RangeError a toISOString().
    if (p.alt != null && isFinite(p.alt)) out += `<ele>${p.alt.toFixed(1)}</ele>`;
    if (p.ts != null && isFinite(p.ts)) {
      let iso = '';
      try { iso = new Date(p.ts).toISOString(); } catch (e) {}
      if (iso) out += `<time>${iso}</time>`;
    }
    out += '</trkpt>\n';
  }
  out += '    </trkseg>\n  </trk>\n</gpx>\n';
  return out;
}

/* Avvio automatico del log (impostazione, spenta di default): dimenticare Start
   significava perdere il giro intero. Parte con la velocità GPS FRESCA sopra
   AUTO_LOG_KMH per AUTO_LOG_HOLD_MS; mai in Demo né a GPS perso.
   Niente stop automatico: un semaforo lungo o un rifornimento spezzerebbero il
   giro in due. Da fermi per AUTO_STOP_HINT_MS si PROPONE lo Stop, una volta.
   Dopo uno Stop resta disarmato finché non si è stati fermi AUTO_REARM_MS: chi
   ferma il log in marcia non se lo vede ripartire, chi parcheggia sì.
   Gira in updateDisplay, quindi solo a pagina visibile (come il GPS stesso). */
/* Istanti null = "non iniziato": 0 è un performance.now() valido. */
function autoLogTick(nowP) {
  if (!state.autoLog || state.demo) { state._autoFastSince = null; return; }
  const fresh = state.speedGpsT > 0 && nowP - state.speedGpsT < SPEED_STALE_MS && state.gpsLostS == null;
  const kmh = fresh && state.speedGpsMs != null ? state.speedGpsMs * 3.6 : null;
  // Senza velocità fresca lo stato fermo/in marcia resta quello di prima.
  if (kmh != null && kmh < AUTO_STILL_KMH) {
    if (state._autoStillSince == null) state._autoStillSince = nowP;
  } else if (kmh != null) {
    state._autoStillSince = null;
    state._autoStopHinted = false;
  }
  if (state.logging) {
    state._autoFastSince = null;
    if (state._autoStillSince != null && nowP - state._autoStillSince >= AUTO_STOP_HINT_MS && !state._autoStopHinted) {
      state._autoStopHinted = true;
      confirmToast('Fermo da 10 minuti: fermare il log?').then(ok => { if (ok && state.logging) stopLog(); });
    }
    return;
  }
  if (state._autoArmed === false) {
    if (!(state._autoStillSince != null && nowP - state._autoStillSince >= AUTO_REARM_MS)) return;
    state._autoArmed = true;
  }
  if (kmh != null && kmh >= AUTO_LOG_KMH) {
    if (state._autoFastSince == null) state._autoFastSince = nowP;
    if (nowP - state._autoFastSince >= AUTO_LOG_HOLD_MS) {
      state._autoFastSince = null;
      startLog();
      toast('Log avviato automaticamente.', 'ok', 4000);
    }
  } else {
    state._autoFastSince = null;
  }
}
