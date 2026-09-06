'use strict';
/* js/nav-ui.js (step 18): UI navigazione (NAV_ICON, navIcon, navRenderBanner, renderNavPanel, navShortCue, navAnnounce, setNavVoice). DOM/speech a runtime. Ordine: dopo js/inputs.js. */
function setNavVoice(on, opts) {
  state.navVoice = !!on;
  if (els.navVoice) els.navVoice.checked = state.navVoice;
  if (els.btnNavMute) {
    els.btnNavMute.classList.toggle('on', state.navVoice);
    els.btnNavMute.classList.toggle('muted', !state.navVoice);
    els.btnNavMute.title = state.navVoice ? 'Indicazioni vocali attive — tocca per silenziare'
                                          : 'Indicazioni vocali silenziate — tocca per riattivare';
  }
  if (!state.navVoice) {
    navSpeak.stop();   // zittisce anche l'annuncio in corso, non solo i successivi
  } else if (opts && opts.user) {
    // riattivazione da un tocco: e' il gesto utente che serve a sbloccare la sintesi su iOS
    navSpeak.init(); navSpeak.prime();
  }
  if (!opts || !opts.silentSave) saveSettings();
}

function navShortCue(txt) {
  // toglie il nome della via dal secondo pezzo: un'utterance di 4 s in curva e' inutile
  return String(txt || '').replace(/\s+su\s+.*$/i, '').replace(/\.$/, '');
}

function navAnnounce(nv, vRef) {
  if (nv.status !== 'ACTIVE') return;           // muti durante il ricalcolo
  const k = nv.nextMan;
  if (k >= nv.man.length) return;
  const m = nv.man[k];
  if (m.silent) return;
  const d = nv.distToNext;
  // dalla fascia piu' vicina verso l'esterno, al massimo una per fix
  for (const b of NAV_BANDS) {
    if (nv.spoken & b.bit) continue;
    if (d > navBandDist(b, vRef)) continue;
    // Si settano anche i bit delle fasce piu' lontane: altrimenti da fermi vRef crolla,
    // le soglie si stringono e una fascia gia' passata torna eleggibile.
    let mask = 0;
    for (const o of NAV_BANDS) if (o.t >= b.t) mask |= o.bit;
    nv.spoken |= mask;                          // PRIMA di say(), e in modo sincrono
    let txt;
    if (b.name === 'now') {
      txt = m.vPre || m.text;
    } else if (b.name === 'far' && m.vAlert && d >= 1200 && d <= 2200) {
      // vAlert ha la distanza incorporata nel testo: verbatim solo nella sua finestra
      txt = m.vAlert;
    } else {
      txt = 'Fra ' + navFmtDist(d) + ', ' + (m.vPre || m.text);
    }
    // manovre incatenate: Valhalla marca multiCue e il suo vPre contiene gia' entrambe
    if ((b.name === 'near' || b.name === 'now') && k + 1 < nv.man.length) {
      const gap = nv.sMan[k + 1] - nv.sMan[k];
      if (gap < Math.max(NAV_CHAIN_MIN_M, 6 * vRef)) {
        if (!m.multiCue) txt += ', poi ' + navShortCue(nv.man[k + 1].vPre || nv.man[k + 1].text);
        nv.preSpoken[k + 1] = (nv.preSpoken[k + 1] || 0) | 1 | 2 | 4 | (gap < 60 ? 8 : 0);
      }
    }
    const prio = b.name === 'now' ? 4 : b.name === 'near' ? 3 : b.name === 'mid' ? 2 : 1;
    navSpeak.say(txt, prio);
    return;
  }
}

const NAV_ICON = { 8:'↑', 9:'↗', 10:'→', 11:'↘', 12:'↩', 13:'↩', 14:'↙', 15:'←', 16:'↖',
  17:'↑', 18:'↗', 19:'↖', 20:'↗', 21:'↖', 22:'↑', 23:'↗', 24:'↖', 25:'⤵',
  26:'⟳', 27:'⟳', 1:'●', 2:'●', 3:'●', 4:'⚑', 5:'⚑', 6:'⚑' };

function navIcon(m) { return NAV_ICON[m.type] || '↑'; }

/* Nessun innerHTML: i nomi delle strade vengono da OSM, sono dati di terze parti. */
function navRenderBanner() {
  const nv = state.nav, el = els.navBanner;
  if (!el) return;
  if (!nv || nv.status === 'IDLE' || nv.status === 'ARRIVED' && nv.bannerDone) {
    el.style.display = 'none'; return;
  }
  el.textContent = '';
  el.classList.toggle('off', nv.status === 'OFF_NONET' || nv.status === 'OFF_MANUAL' || nv.status === 'REROUTING');
  if (nv.status === 'REROUTING') { el.appendChild(document.createTextNode('⟳ Ricalcolo…')); el.style.display = 'block'; return; }
  if (nv.status === 'ARRIVED') { el.appendChild(document.createTextNode('⚑ Arrivato')); el.style.display = 'block'; return; }
  if (nv.status === 'OFF_NONET' || nv.status === 'OFF_MANUAL') {
    const b = nv.snapLat != null ? bearing({ lat: nv.lastLat, lon: nv.lastLon }, { lat: nv.snapLat, lon: nv.snapLon }) : null;
    el.appendChild(document.createTextNode(
      (nv.status === 'OFF_NONET' ? '⚠ Senza rete · ' : '⚠ Fuori percorso · ') +
      'rientro a ' + navFmtShort(nv.offDist || 0) + (b != null ? ' verso ' + Math.round(b) + '°' : '')));
    el.style.display = 'block'; return;
  }
  const k = nv.nextMan;
  if (k >= nv.man.length) { el.style.display = 'none'; return; }
  const m = nv.man[k];
  el.appendChild(document.createTextNode(navIcon(m) + ' '));
  const d = document.createElement('span'); d.className = 'nb-dist';
  d.textContent = navFmtShort(nv.distToNext); el.appendChild(d);
  const st = document.createElement('span'); st.className = 'nb-street';
  st.textContent = m.text || (m.streets.join(', '));
  el.appendChild(st);
  if (k + 1 < nv.man.length && (nv.sMan[k + 1] - nv.sMan[k]) < NAV_CHAIN_MIN_M) {
    const t2 = document.createElement('span'); t2.className = 'nb-then';
    t2.textContent = 'poi ' + navIcon(nv.man[k + 1]) + ' ' + navShortCue(nv.man[k + 1].text);
    el.appendChild(t2);
  }
  el.style.display = 'block';
}

function renderNavPanel() {
  const nv = state.nav;
  if (els.navDestTxt) {
    const d = (nv && nv.dest) || state.navDest;
    els.navDestTxt.textContent = d
      ? (d.label ? d.label + ' — ' : '') + d.lat.toFixed(5) + ', ' + d.lon.toFixed(5)
      : 'Nessuna destinazione. Sulla mappa puoi anche tenere premuto un punto per sceglierlo.';
  }
  if (els.navSumDist) {
    els.navSumDist.textContent = nv ? navFmtShort(nv.status === 'IDLE' ? nv.totalM : nv.distRemain || nv.totalM) : '—';
    els.navSumTime.textContent = nv ? navFmtTime(nv.timeRemain || nv.totalS) : '—';
    if (nv) {
      const t = new Date(Date.now() + (nv.timeRemain || nv.totalS) * 1000);
      els.navSumEta.textContent = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    } else els.navSumEta.textContent = '—';
  }
  const ol = els.navSteps;
  if (!ol) return;
  ol.textContent = '';
  if (!nv) return;
  for (let k = 0; k < nv.man.length; k++) {
    const m = nv.man[k];
    const li = document.createElement('li');
    if (k < nv.nextMan) li.className = 'done';
    else if (k === nv.nextMan) li.className = 'cur';
    const sd = document.createElement('span'); sd.className = 'sd';
    sd.textContent = k === nv.nextMan ? navFmtShort(nv.distToNext)
      : navFmtShort(Math.max(0, nv.sMan[k] - nv.sAlong));
    const tx = document.createElement('span');
    tx.textContent = navIcon(m) + ' ' + (m.text || m.streets.join(', '));
    li.appendChild(sd); li.appendChild(tx);
    ol.appendChild(li);
  }
}
