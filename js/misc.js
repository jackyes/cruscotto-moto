'use strict';
/* js/misc.js (step 29): wakeLock request/release, renderHistory/openSessionDetail, loadImportedCameras, navBuild. Ordine: dopo js/ui-core.js. */
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
        vPost: String(m.verbal_post_transition_instruction || ''),
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
           totalM: cum[n - 1], totalS: acc };
}

async function requestWakeLock() {
  if (!state.wakeLockOn || !('wakeLock' in navigator)) return;
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {}
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch (e) {}
  wakeLock = null;
}

async function renderHistory() {
  let sessions = [];
  try { sessions = await idb.getMetas(); } catch (e) {}
  sessions = sessions.filter(s => s && s.meta);
  sessions.sort((a, b) => (a.meta.startISO < b.meta.startISO ? 1 : -1));
  const list = els.sessionList;
  if (!sessions.length) {
    list.innerHTML = '<div class="empty">Nessun giro salvato. Avvia un log e fermalo per salvarlo qui.</div>';
    return;
  }
  list.innerHTML = '';
  for (const s of sessions) {
    const card = document.createElement('div');
    card.className = 'sess-card';
    const d = new Date(s.meta.startISO);
    const pad = n => String(n).padStart(2, '0');
    card.innerHTML =
      '<div class="sdate">' + d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</div>' +
      '<div class="srow">' +
        '<span>Durata <b>' + fmtDur(s.meta.duration) + '</b></span>' +
        '<span>V max <b>' + Math.round(s.meta.maxSpeed) + ' km/h</b></span>' +
        '<span>Piega <b>' + Math.abs(s.meta.maxLeanR).toFixed(0) + '°D / ' + Math.abs(s.meta.maxLeanL).toFixed(0) + '°S</b></span>' +
        '<span>Distanza <b>' + (s.meta.distKm||0).toFixed(2) + ' km</b></span>' +
      '</div>';
    card.addEventListener('click', () => openSessionDetail(s.id));
    list.appendChild(card);
  }
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
