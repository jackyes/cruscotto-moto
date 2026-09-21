'use strict';
/* js/misc.js (step 29): wakeLock request/release, renderHistory/renderHistTotals, sessionTotals/sessKey/planRestore/parseBackup, backupSessions/restoreSessions/loadAllSessions/buildBackupParts, openSessionDetail, loadImportedCameras, navBuild. Ordine: dopo js/ui-core.js. */
async function loadImportedCameras() {
  let cams = null;
  try { cams = await idb.kvGet('importedCameras'); } catch (e) {}
  if (!cams) {
    const legacy = store.get('cruscotto.importedCameras', null);
    if (legacy && legacy.length) {
      cams = legacy;
      try { await idb.kvPut('importedCameras', cams); store.del('cruscotto.importedCameras'); } catch (e) {}
    }
  }
  if (cams && cams.length) {
    state.importedCameras = cams;
    rebuildCamGrid();
    renderCameras();
  }
}

function navBuild(trip) {
  const legs = trip && trip.legs;
  if (!legs || !legs.length) throw new Error('rotta senza legs');
  const aLat = [], aLon = [], man = [];
  for (let L = 0; L < legs.length; L++) {
    const d = decodePolyline6(legs[L].shape || '');
    if (!d.lat.length) throw new Error('leg senza shape');
    // Il primo punto di ogni leg successivo duplica l'ultimo del precedente: va scartato,
    // e l'offset va sommato agli shape_index o le manovre del leg 2 puntano al leg 1.
    const skip = L > 0 ? 1 : 0;
    const off = aLat.length - skip;
    for (let i = skip; i < d.lat.length; i++) { aLat.push(d.lat[i]); aLon.push(d.lon[i]); }
    for (const m of (legs[L].maneuvers || [])) {
      man.push({
        type: m.type | 0,
        text: String(m.instruction || ''),
        vAlert: String(m.verbal_transition_alert_instruction || ''),
        vPre: String(m.verbal_pre_transition_instruction || ''),
        multiCue: !!m.verbal_multi_cue,
        streets: (m.street_names || []).map(String),
        beginIdx: (m.begin_shape_index | 0) + off,
        endIdx: (m.end_shape_index | 0) + off,
        time: +m.time || 0,
        brgBefore: (m.bearing_before == null) ? null : +m.bearing_before,
        brgAfter: (m.bearing_after == null) ? null : +m.bearing_after,
        roundExit: m.roundabout_exit_count == null ? null : (m.roundabout_exit_count | 0),
        legIdx: L,
        silent: false,
      });
    }
  }
  if (!navShapePlausible(aLat, aLon)) throw new Error('shape implausibile (precisione polyline?)');

  const n = aLat.length;
  // Rotta degenere (origine ≈ destinazione): con un solo punto navProject non
  // itera e il navigatore resterebbe ACTIVE per sempre, muto, senza arrivo né
  // errore. Si rifiuta subito: il try/catch di navRequestRoute mostra il toast.
  if (n < 2) throw new Error('rotta degenere: un solo punto');
  const lat = new Float64Array(n), lon = new Float64Array(n);
  for (let i = 0; i < n; i++) { lat[i] = aLat[i]; lon[i] = aLon[i]; }
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + distM({ lat: lat[i - 1], lon: lon[i - 1] }, { lat: lat[i], lon: lon[i] });
  }
  const brg = new Float32Array(Math.max(0, n - 1));
  for (let i = 0; i < n - 1; i++) {
    brg[i] = bearing({ lat: lat[i], lon: lon[i] }, { lat: lat[i + 1], lon: lon[i + 1] }) ?? 0;
  }
  const flags = new Uint8Array(n);

  const M = man.length;
  const sMan = new Float64Array(M), tEnd = new Float64Array(M);
  let acc = 0;
  for (let k = 0; k < M; k++) {
    sMan[k] = cum[Math.min(n - 1, Math.max(0, man[k].beginIdx))];
    acc += man[k].time; tEnd[k] = acc;
    // Dentro una rotonda i bearing ruotano di 360 gradi in 30 m: li' il gate di heading
    // ucciderebbe il match, quindi si marca il tratto e lo si disattiva.
    if (man[k].type === MAN_ROUNDABOUT_IN || man[k].type === MAN_ROUNDABOUT_OUT) {
      for (let i = Math.max(0, man[k].beginIdx); i <= Math.min(n - 1, man[k].endIdx); i++) flags[i] |= 1;
    }
    // L'uscita dalla rotonda non si annuncia: il verbal della enter contiene gia'
    // "prendi la N-esima uscita", e l'arco e' piu' corto della fascia piu' stretta,
    // quindi tutte le sue fasce scatterebbero nello stesso fix.
    if (man[k].type === MAN_ROUNDABOUT_OUT) man[k].silent = true;
  }
  return { n, lat, lon, cum, brg, flags, man, sMan, tEnd,
           totalM: cum[n - 1], totalS: acc,
           loop: navIsLoop(lat, lon, n, cum[n - 1]) };
}

/* Un anello è una rotta che finisce dove è cominciata. Si riconosce dalla GEOMETRIA
   e non da un flag messo da chi l'ha chiesta: così vale anche per una rotta
   ripristinata da IndexedDB dopo un riavvio e per un GPX chiuso importato a mano,
   senza un secondo pezzo di stato da tenere allineato con la rotta viva.
   Il minimo di lunghezza esclude il caso degenere "partenza ≈ arrivo", che è una
   rotta sbagliata, non un giro. */
const NAV_LOOP_CLOSE_M = 200;
const NAV_LOOP_MIN_M = 3000;
function navIsLoop(lat, lon, n, totalM) {
  if (!n || n < 2 || !(totalM > NAV_LOOP_MIN_M)) return false;
  return distM({ lat: lat[0], lon: lon[0] }, { lat: lat[n - 1], lon: lon[n - 1] }) < NAV_LOOP_CLOSE_M;
}

function wakeLockWarn(msg) {
  if (state._wakeWarned) return;
  state._wakeWarned = true;
  toast(msg, 'err', 5000);
}

async function requestWakeLock() {
  if (!state.wakeLockOn) return;
  if (!('wakeLock' in navigator)) {
    wakeLockWarn('Schermo sempre acceso non disponibile su questo dispositivo.');
    return;
  }
  if (wakeLock && !wakeLock.released) return;
  if (wakeLockReq) return wakeLockReq;   // init e visibilitychange possono arrivare insieme
  wakeLockReq = (async () => {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
      wakeLockWarn('Impossibile tenere lo schermo acceso.');
    }
    wakeLockReq = null;
  })();
  return wakeLockReq;
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch (e) {}
  wakeLock = null;
}

/* Pura: totali dello storico. I meta arrivano da IndexedDB o da un import di
   terzi, quindi tutto passa da numOr0: una durata salvata come stringa non deve
   far lanciare il riepilogo (stessa lezione delle card). */
function sessionTotals(metas) {
  let km = 0, sec = 0, n = 0;
  for (const s of metas) {
    const m = (s && s.meta) ? s.meta : {};
    km += numOr0(m.distKm);
    sec += numOr0(m.duration);
    n++;
  }
  return { n, km, sec };
}

/* Pura: chiave di un giro per riconoscere i doppioni in un ripristino. Inizio e
   durata arrotondata, non l'id: dopo un backup su un altro telefono gli id
   possono coincidere per caso, mentre due giri non partono nello stesso secondo
   e non durano lo stesso tempo. */
function sessKey(meta) {
  const m = meta || {};
  return String(m.startISO || '') + '|' + Math.round(numOr0(m.duration));
}

/* Pura: cosa aggiungere e cosa saltare di un backup. Salta le sessioni già
   presenti e quelle malformate; deduplica anche dentro lo stesso file, così due
   copie nello stesso backup non entrano due volte. */
function planRestore(existingMetas, incoming) {
  // idb.getMetas() restituisce record {id, meta, points}, mentre il file di
  // backup porta le sessioni intere: la chiave si prende dal meta in entrambi.
  const keyOf = e => sessKey(e && e.meta ? e.meta : e);
  const have = new Set((existingMetas || []).map(keyOf));
  const add = [], skip = [];
  for (const s of (incoming || [])) {
    if (!s || !s.meta || !Array.isArray(s.rows)) { skip.push(s); continue; }
    const k = keyOf(s);
    if (have.has(k)) { skip.push(s); continue; }
    have.add(k);
    add.push(s);
  }
  return { add, skip };
}

/* Pura: legge il file di backup. Non si fida di niente: il file può essere
   troncato, di un'altra app o scritto a mano. Ritorna null se non è un backup. */
function parseBackup(text) {
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.sessions)) return null;
  return obj.sessions;
}

async function renderHistory() {
  let sessions = [];
  try { sessions = await idb.getMetas(); } catch (e) {}
  sessions = sessions.filter(s => s && s.meta);
  sessions.sort((a, b) => (a.meta.startISO < b.meta.startISO ? 1 : -1));
  renderHistTotals(sessions);
  const list = els.sessionList;
  if (!sessions.length) {
    list.innerHTML = '<div class="empty">Nessun giro salvato. Avvia un log e fermalo per salvarlo qui.</div>';
    return;
  }
  list.innerHTML = '';
  for (const s of sessions) {
    // Valori da IndexedDB: mai in innerHTML (unico vettore di injection del
    // gruppo). textContent + coercizione numerica (numOr0, js/core.js): né HTML
    // eseguibile, né TypeError se un campo è assente/stringa (import da terzi).
    const num = numOr0;
    const card = document.createElement('div');
    card.className = 'sess-card';
    const d = new Date(s.meta.startISO);
    const pad = n => String(n).padStart(2, '0');
    const sdate = document.createElement('div');
    sdate.className = 'sdate';
    sdate.textContent = isFinite(d.getTime())
      ? d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      : 'Data sconosciuta';
    const srow = document.createElement('div');
    srow.className = 'srow';
    const stat = (label, val) => {
      const span = document.createElement('span');
      span.textContent = label + ' ';
      const b = document.createElement('b');
      b.textContent = val;
      span.appendChild(b);
      return span;
    };
    srow.appendChild(stat('Durata ', fmtDur(num(s.meta.duration))));
    srow.appendChild(stat('V max ', Math.round(num(s.meta.maxSpeed)) + ' km/h'));
    srow.appendChild(stat('Piega ', Math.abs(num(s.meta.maxLeanR)).toFixed(0) + '°D / ' + Math.abs(num(s.meta.maxLeanL)).toFixed(0) + '°S'));
    srow.appendChild(stat('Distanza ', num(s.meta.distKm).toFixed(2) + ' km'));
    card.appendChild(sdate);
    card.appendChild(srow);
    card.addEventListener('click', () => openSessionDetail(s.id));
    list.appendChild(card);
  }
}

/* Riepilogo in testa allo Storico. textContent e non innerHTML, come le card. */
function renderHistTotals(metas) {
  const el = els.histTotals;
  if (!el) return;
  el.hidden = !metas.length;
  if (!metas.length) return;
  const t = sessionTotals(metas);
  const row = (label, val) => {
    const span = document.createElement('span');
    span.textContent = label + ' ';
    const b = document.createElement('b');
    b.textContent = val;
    span.appendChild(b);
    return span;
  };
  el.textContent = '';
  el.appendChild(row('Giri', String(t.n)));
  // Un decimale: sui totali il centesimo di km è rumore.
  el.appendChild(row('Totali', t.km.toFixed(1) + ' km'));
  el.appendChild(row('In sella', fmtDurH(t.sec)));
}

/* Legge tutte le sessioni dallo storico. Una per volta: caricarle tutte insieme
   su ore di log significa tenere in RAM centinaia di MB. */
async function loadAllSessions() {
  let ids = [];
  try { ids = await idb.keys(); } catch (e) { return []; }
  const out = [];
  for (const id of ids) {
    let s = null;
    try { s = await idb.get(id); } catch (e) { continue; }
    if (s && s.meta) out.push(s);
  }
  return out;
}

/* Pura: il backup come parti di stringa, una per sessione. Il chiamante le passa
   a Blob senza concatenarle: su ore di log la stringa unica era il picco di
   memoria (stesso motivo dell'export CSV storico). */
function buildBackupParts(sessions, exportedISO) {
  const parts = ['{"app":"cruscotto-moto","v":1,"exportedISO":' + JSON.stringify(exportedISO) + ',"sessions":['];
  let n = 0;
  for (const s of sessions) {
    let txt = '';
    try { txt = JSON.stringify({ id: s.id, meta: s.meta, rows: s.rows || [], track: s.track || [] }); } catch (e) { continue; }
    parts.push((n ? ',' : '') + txt);
    n++;
  }
  parts.push(']}');
  return { parts, n };
}

/* Backup di TUTTO lo storico in un file che si può rimettere dentro l'app.
   Serve perché i giri vivono in IndexedDB: "cancella dati del sito", un browser
   che sfratta lo storage o un telefono nuovo li perdono, e i CSV/GPX sono per
   singolo giro e non si reimportano. */
async function backupSessions() {
  const sessions = await loadAllSessions();
  if (!sessions.length) { toast('Nessun giro da salvare.', 'err'); return; }
  const t = toast('Preparo il backup…', null, 60000);
  const { parts, n } = buildBackupParts(sessions, new Date().toISOString());
  t.remove();
  if (!n) { toast('Backup non riuscito: dati non serializzabili.', 'err', 6000); return; }
  let bytes = 0;
  for (const p of parts) bytes += p.length;
  downloadBlob('cruscotto_backup_' + stamp() + '.json', parts, 'application/json');
  // La dimensione in chiaro: su ore di log il file e' grosso, e chi lo salva
  // deve sapere quanto sta per scaricare.
  toast('Backup di ' + n + ' giri (' + (bytes / (1024 * 1024)).toFixed(1) + ' MB).', 'ok', 6000);
}

/* Ripristino dal file di backup: aggiunge i giri che mancano e salta i doppioni
   e le voci malformate. Gli id già occupati vengono rimpiazzati da uno nuovo,
   così un ripristino non può sovrascrivere un giro esistente. */
async function restoreSessions(file) {
  let text = '';
  try { text = await file.text(); } catch (e) { toast('File non leggibile.', 'err'); return; }
  const incoming = parseBackup(text);
  if (!incoming) { toast('Non è un backup di Cruscotto Moto.', 'err', 6000); return; }
  let existing = [];
  try { existing = await idb.getMetas(); } catch (e) {}
  const { add, skip } = planRestore(existing, incoming);
  const usedIds = new Set(existing.map(m => m && m.id));
  const t = toast('Ripristino ' + add.length + ' giri…', null, 60000);
  let done = 0;
  for (let i = 0; i < add.length; i++) {
    const s = add[i];
    const id = usedIds.has(s.id) ? 'r_' + Date.now() + '_' + i : s.id;
    try { await idb.put({ id, meta: s.meta, rows: s.rows, track: s.track || [] }); done++; } catch (e) {}
  }
  t.remove();
  renderHistory();
  if (!done) { toast('Nessun giro ripristinato (' + skip.length + ' saltati).', 'err', 6000); return; }
  toast('Ripristinati ' + done + ' giri' + (skip.length ? ', ' + skip.length + ' saltati' : '') + '.', 'ok', 6000);
}

async function openSessionDetail(id) {
  const el = els.sessionDetail;
  el.style.display = 'block';
  el.textContent = 'Caricamento…';
  let s = null;
  try { s = await idb.get(id); } catch (e) {}
  if (!s) { el.textContent = 'Sessione non trovata.'; return; }
  showSessionDetail(s);
}
