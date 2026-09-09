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
    vibRect: m ? m.vibRect : state.vibRectG,
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
  // Mai durante un flush in volo: lo splice accorcia state.rows mentre il
  // chunk in volo aggiorna flushedRows su una lunghezza catturata prima
  // dell'await (race trim/flush = righe spacciate per salvate).
  const over = state.rows.length - MAX_ROWS;
  if (over > 0 && !state._flushing) {
    if (state.flushedRows > 0) {
      const drop = Math.min(over + Math.ceil(MAX_ROWS * 0.1), state.flushedRows);
      state.rows.splice(0, drop);
      state.flushedRows -= drop;
    } else if ((state._flushFailN || 0) >= 2) {
      // Rete di sicurezza: se il flush fallisce per quota esaurita e nessuna riga
      // è più "sicura" da scartare, l'array crescerebbe senza limite fino all'OOM
      // del tab. Dopo due fallimenti si accetta di scartare le righe più vecchie
      // non salvabili, segnalandolo una volta.
      const drop = over + Math.ceil(MAX_ROWS * 0.1);
      state.rows.splice(0, drop);
      if (!state._trimWarned) {
        state._trimWarned = true;
        toast('Log non salvabile: scarto i campioni più vecchi per evitare il crash.', 'err', 6000);
      }
    }
  }
  const nowP = performance.now();
  if (nowP - lastFlush >= FLUSH_MS && nowP >= (state._flushBackoffUntil || 0)) {
    lastFlush = nowP;
    flushLog();
  }
}

async function flushLog() {
  if (state._flushing) return; // due flush sovrapposti scriverebbero righe doppie
  const upto = state.rows.length;
  const pending = state.rows.slice(state.flushedRows, upto);
  // Anche la traccia va nei chunk, INCREMENTALE: prima ogni flush riscriveva
  // l'intero record activeTrack (fino a 10.000 punti ogni 10 s) — costo
  // quadratico e centinaia di MB di flash su un giro lungo. Coordinate
  // globali (written − trimmed): il trim della mappa live sposta gli indici,
  // ma qui i contatori sono immuni allo slittamento.
  const trackStart = (state._trackWritten || 0) - (state._trackTrimmed || 0);
  const trackNew = state.track.slice(trackStart);
  const trackWrittenNew = (state._trackWritten || 0) + trackNew.length;
  if (!pending.length && !trackNew.length) return;
  state._flushing = true;
  // Catturati PRIMA del primo await: durante la scrittura sampleTick può
  // trimmare state.rows e startLog può azzerare sessionId per una sessione
  // nuova — leggere questi valori a tempo di esecuzione attaccava la track
  // vecchia al sid nuovo (recupero sessioni mescolate).
  const sid = state.sessionId;
  const startWall = state.session.startWall;
  try {
    await idb.putChunk({
      sid: sid,
      seq: state.flushSeq++,
      startWall: startWall,
      rows: pending,
      track: trackNew,
    });
    // flushedRows avanza SUBITO dopo il chunk: se il trim di sampleTick è
    // corso durante l'await, state.rows si è accorciata e un update rimandato
    // qui lasciava flushedRows > rows.length → i flush successivi slicavano
    // un intervallo vuoto per sempre e le righe intanto scritte dal trim
    // risultavano "già salvate" senza esserlo mai state.
    state.flushedRows = upto;
    state._trackWritten = trackWrittenNew;
    state._flushFailN = 0;
    state._flushBackoffUntil = 0;
  } catch (e) {
    state._flushFailN = (state._flushFailN || 0) + 1;
    if (!state._flushWarned) {
      state._flushWarned = true;
      toast('Spazio esaurito: il log non viene più salvato su disco. Esporta il CSV.', 'err', 6000);
    }
    // Backoff: dopo il primo errore di quota, ritentare ogni 10 s con uno slice
    // sempre più grande consuma CPU e memoria destinati comunque a fallire.
    const mult = Math.min(1 << Math.min(state._flushFailN, 4), 16);
    state._flushBackoffUntil = performance.now() + FLUSH_MS * mult;
  } finally {
    state._flushing = false;
  }
}
