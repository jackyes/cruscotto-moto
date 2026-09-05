'use strict';
/* js/log-core.js (step 14): nucleo logging (snapshot, sampleTick, flushLog). Usa state/logAcc/idb/takeLogAvg a runtime. Ordine: dopo js/nav-engine.js. */
function snapshot() {
  const wall = Date.now();
  const t = state.session.startWall ? (wall - state.session.startWall) / 1000 : 0;
  /* Se il campionamento si è fermato (schermo spento, app in background) la riga
     porta gap=1: prima il timeline saltava senza lasciare traccia nel CSV. */
  const gap = (lastSampleWall && wall - lastSampleWall > GAP_MS) ? 1 : 0;
  lastSampleWall = wall;
  const m = takeLogAvg();
  return {
    t,
    speedKmh: (state.speedGpsMs != null) ? state.speedGpsMs * 3.6 : null,
    speedMs: state.speedGpsMs,
    lean: m ? m.lean : state.lean,
    latG: m ? m.latG : state.latG,
    lonG: m ? m.lonG : state.lonG,
    vertG: m ? m.vertG : state.vertG,
    gyro: m ? m.gyro : state.gyroRoll,
    vib: m ? m.vib : state.vibG,
    latFus: m ? m.latFus : state.latFus,
    lonFus: m ? m.lonFus : state.lonFus,
    latPk: m ? m.latPk : state.latG,
    lonPk: m ? m.lonPk : state.lonG,
    vertPk: m ? m.vertPk : state.vertG,
    pitch: m ? m.pitch : state.pitch,
    yaw: m ? m.yaw : state.gyroYaw,
    speedFus: m ? m.speedFus : state.speedFusMs,
    leanKin: m ? m.leanKin : state.leanKin,
    vibHi: m ? m.vibHi : state.vibHiG,
    leanRef: state.attRef,
    gap,
    lat: state.pos.lat, lon: state.pos.lon, alt: state.gps.alt,
    heading: state.gps.heading, gpsAcc: state.gps.acc
  };
}

function sampleTick() {
  if (!state.logging) return;
  state.rows.push(snapshot());
  // Il trim scatta solo se qualcosa è già stato flushato: tagliare righe non
  // ancora scritte su disco cancellerebbe dati mai salvati. Il 10% extra è lo
  // slack che evita di rieseguire lo splice a ogni campione.
  const over = state.rows.length - MAX_ROWS;
  if (over > 0 && state.flushedRows > 0) {
    const drop = Math.min(over + Math.ceil(MAX_ROWS * 0.1), state.flushedRows);
    state.rows.splice(0, drop);
    state.flushedRows -= drop;
  }
  const nowP = performance.now();
  if (nowP - lastFlush >= FLUSH_MS) {
    lastFlush = nowP;
    flushLog();
  }
}

async function flushLog() {
  if (state._flushing) return; // due flush sovrapposti scriverebbero righe doppie
  const upto = state.rows.length;
  const pending = state.rows.slice(state.flushedRows, upto);
  if (!pending.length) return;
  state._flushing = true;
  try {
    await idb.putChunk({
      sid: state.sessionId,
      seq: state.flushSeq++,
      startWall: state.session.startWall,
      rows: pending,
    });
    // La traccia sta in un unico record: replicarla in ogni chunk moltiplicava
    // fino a 10.000 punti per il numero di flush.
    await idb.kvPut('activeTrack', { sid: state.sessionId, startWall: state.session.startWall, track: state.track.slice() });
    state.flushedRows = upto;
  } catch (e) {
    if (!state._flushWarned) {
      state._flushWarned = true;
      toast('Spazio esaurito: il log non viene più salvato su disco. Esporta il CSV.', 'err', 6000);
    }
  } finally {
    state._flushing = false;
  }
}
