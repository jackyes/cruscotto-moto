'use strict';
/* js/nav-ui.js (step 18): UI navigazione (NAV_ICON, navIcon, navRenderBanner, renderNavPanel, navRenderResults, navSetDest, navShortCue, navAnnounce, setNavVoice). DOM/speech a runtime. Ordine: dopo js/inputs.js. */
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
    // manovre incatenate: Valhalla marca multiCue e il suo vPre contiene gia' entrambe
    let chainBits = 0, chainNext = null, chainGap = 0;
    if ((b.name === 'near' || b.name === 'now') && k + 1 < nv.man.length) {
      const gap = nv.sMan[k + 1] - nv.sMan[k];
      if (gap < navChainMinM(vRef)) {
        chainNext = nv.man[k + 1];
        chainGap = gap;
        chainBits = 1 | 2 | 4 | (gap < 60 ? 8 : 0);
      }
    }
    let txt;
    if (b.name === 'now') {
      txt = m.vPre || m.text;
    } else if (b.name === 'far' && m.vAlert && d >= 1200 && d <= 2200) {
      // vAlert ha la distanza incorporata nel testo: verbatim solo nella sua finestra
      txt = m.vAlert;
    } else {
      txt = 'Fra ' + navFmtDist(d) + ', ' + (m.vPre || m.text);
    }
    if (chainNext && (b.name === 'near' || b.name === 'now')) {
      // L'uscita di rotonda OSRM è marcata silent: senza questo check la catena
      // annunciava comunque "poi esci dalla rotonda".
      if (chainNext.silent) chainBits = 0;
      else if (!m.multiCue) txt += ', poi ' + navShortCue(chainNext.vPre || chainNext.text);
    }
    const prio = b.name === 'now' ? 4 : b.name === 'near' ? 3 : b.name === 'mid' ? 2 : 1;
    // say() ritorna false se il canale TTS è occupato con priorità insufficiente:
    // in quel caso NON si consumano i bit (prima venivano settati prima di say(),
    // e un cue scartato per busy non veniva mai più annunciato). I bit si
    // commettono solo su accettazione.
    if (!navSpeak.say(txt, prio)) return;
    nv.spoken |= mask;
    if (chainNext) nv.preSpoken[k + 1] = (nv.preSpoken[k + 1] || 0) | chainBits;
    return;
  }
}

const NAV_ICON = { 8:'↑', 9:'↗', 10:'→', 11:'↘', 12:'↩', 13:'↩', 14:'↙', 15:'←', 16:'↖',
  17:'↑', 18:'↗', 19:'↖', 20:'↗', 21:'↖', 22:'↑', 23:'↗', 24:'↖', 25:'⤵',
  26:'⟳', 27:'⟳', 1:'●', 2:'●', 3:'●', 4:'⚑', 5:'⚑', 6:'⚑' };

function navIcon(m) { return NAV_ICON[m.type] || '↑'; }

/* Distanza dalla prossima manovra. navTick la scrive a ogni fix, ma fra la rotta e
   il primo fix non esiste: navRestore la rende subito (prima di ogni tick) e navStart
   rende il banner nello stesso istante in cui mette ACTIVE. navFmtShort(undefined)
   da' "NaN km" (undefined < 1000 e' false -> (undefined/1000).toFixed(0)), quindi il
   pannello appena ripristinato e il banner appena avviato lo mostravano. Stessa
   formula di navTick, cosi' il valore provvisorio e' anche quello giusto. */
function navDistToNext(nv) {
  // `!nv.sMan` come `!nv.man`: un nv a meta' costruzione (man presente, sMan no)
  // farebbe leggere nv.sMan[k] di undefined -> TypeError dentro il banner, cioe'
  // proprio il caso che questo fallback esiste per non far esplodere.
  if (!nv || !nv.man || !nv.sMan) return 0;
  if (nv.distToNext != null) return nv.distToNext;
  const k = nv.nextMan;
  return k < nv.man.length ? Math.max(0, nv.sMan[k] - (nv.sAlong || 0)) : 0;
}

/* Soglia delle manovre "incatenate" (annunciate in una frase sola): cresce con la
   velocita', perche' a 130 km/h servono ~220 m di preavviso per dire due cose.
   Banner e voce devono usare la STESSA soglia: con il banner fisso a
   NAV_CHAIN_MIN_M la voce diceva ", poi esci" e il banner no — due indicazioni
   diverse per la stessa manovra, nello stesso istante. */
function navChainMinM(vRef) { return Math.max(NAV_CHAIN_MIN_M, 6 * (vRef || 0)); }

/* Stato dell'arrivo azzerato quando l'arrivo annunciato non vale piu': rotta ripresa
   dal tasto Avvia, destinazione nuova, navigatore chiuso. `bannerDone` va riportato a
   false perche' e' una memoria a senso unico: impostato una volta, il banner "Arrivato"
   non ricompariva piu' — nemmeno su un secondo arrivo vero. Il timer del banner si
   spegne qui perche' su un nv abbandonato (navStop/navReset) resta altrimenti vivo per
   8 s a scrivere in un oggetto che non e' piu' quello di state.nav. */
function navArriveReset(nv) {
  if (!nv) return;
  if (nv._arriveTimer) clearTimeout(nv._arriveTimer);
  nv._arriveTimer = null;
  nv.bannerDone = false;
  nv.arriveCount = 0;
}

/* Nessun innerHTML: i nomi delle strade vengono da OSM, sono dati di terze parti. */
function navRenderBanner() {
  const nv = state.nav, el = els.navBanner;
  if (!el) return;
  if (!nv || nv.status === 'IDLE' || (nv.status === 'ARRIVED' && nv.bannerDone)) {
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
  /* Mini-HUD: velocita' live prima della manovra. Il banner e' l'unico elemento
     sempre visibile in marcia su qualsiasi tab (anche Navigatore), cosi' la
     velocita' c'e' senza tornare in Dashboard. tabIndex + aria-label per SR. */
  const v = document.createElement('span'); v.className = 'nb-speed';
  const kmh = Math.round(typeof state !== 'undefined' && state.speedKph ? state.speedKph : 0);
  v.textContent = kmh + ' km/h';
  v.setAttribute('aria-label', 'Velocità ' + kmh + ' chilometri orari');
  el.appendChild(v);
  el.appendChild(document.createTextNode(' ' + navIcon(m) + ' '));
  const d = document.createElement('span'); d.className = 'nb-dist';
  d.textContent = navFmtShort(navDistToNext(nv)); el.appendChild(d);
  const st = document.createElement('span'); st.className = 'nb-street';
  /* multiCue: Valhalla mette la coppia intera ("gira a destra, poi imbocca...") in
     vPre, ed e' quella che la voce legge; m.text e' solo la prima meta'. Il banner
     diceva una cosa e la voce un'altra, nello stesso istante. */
  st.textContent = (m.multiCue && m.vPre) ? m.vPre : (m.text || (m.streets.join(', ')));
  el.appendChild(st);
  /* Stesse condizioni della voce (navAnnounce): niente "poi ..." se la manovra
     incatenata e' silent (uscita di rotonda OSRM) o se multiCue l'ha gia' detta. */
  const nx = k + 1 < nv.man.length ? nv.man[k + 1] : null;
  if (nx && !nx.silent && !m.multiCue && (nv.sMan[k + 1] - nv.sMan[k]) < navChainMinM(nv.vRef)) {
    const t2 = document.createElement('span'); t2.className = 'nb-then';
    t2.textContent = 'poi ' + navIcon(nx) + ' ' + navShortCue(nx.vPre || nx.text);
    el.appendChild(t2);
  }
  el.style.display = 'block';
}

function renderNavPanel() {
  const nv = state.nav;
  if (els.navDestTxt) {
    const d = (nv && nv.dest) || state.navDest;
    const vias = state.navVias || [];
    const viaTxt = vias.length ? ' · ' + vias.length + ' tappa' + (vias.length > 1 ? 'e' : '') : '';
    els.navDestTxt.textContent = d
      ? (d.label ? d.label + ' — ' : '') + d.lat.toFixed(5) + ', ' + d.lon.toFixed(5) + viaTxt
      : (vias.length ? 'Tappa intermedia impostata: scegli la destinazione finale.' : 'Nessuna destinazione. Sulla mappa puoi anche tenere premuto un punto per sceglierlo.');
  }
  if (els.navSumDist) {
    if (nv) {
      // distRemain/timeRemain a 0 sono LEGITTIMI (arrivato): `|| totalM`
      // sostituiva lo 0 con la lunghezza completa del percorso.
      const dR = nv.distRemain != null ? nv.distRemain : nv.totalM;
      const tR = nv.timeRemain != null ? nv.timeRemain : nv.totalS;
      els.navSumDist.textContent = navFmtShort(nv.status === 'IDLE' ? nv.totalM : dR);
      if (els.navSumTime) els.navSumTime.textContent = navFmtTime(nv.status === 'IDLE' ? nv.totalS : tR);
      if (els.navSumEta) {
        const t = new Date(Date.now() + (nv.status === 'IDLE' ? nv.totalS : tR) * 1000);
        els.navSumEta.textContent = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      }
    } else {
      els.navSumDist.textContent = '—';
      if (els.navSumTime) els.navSumTime.textContent = '—';
      if (els.navSumEta) els.navSumEta.textContent = '—';
    }
  }
  const ol = els.navSteps;
  if (!ol) return;
  const man = nv ? nv.man : null;
  /* Nodi riusati fra un ridisegno e l'altro. Il pannello si aggiorna a ogni fix GPS
     (~1 Hz, js/inputs.js), ma la lista cambia solo quando cambia la rotta: ricostruire
     la <ol> da zero costava N li + 2 span + testo per tick — su una rotta lunga (400
     manovre) ~1200 nodi DOM creati e distrutti al secondo, in marcia, per riscrivere
     due numeri. La cache si invalida sull'IDENTITA' di nv.man: rotta nuova (navBuild)
     e rotta ripristinata (navRestore) sono array nuovi, quindi nessun contatore di
     versione da tenere allineato. */
  let st = state._navSteps;
  /* st.n nella chiave: se qualcuno allungasse man in place (push), rows resterebbe
     corta e il ciclo sotto leggerebbe st.rows[k] undefined — un TypeError dentro il
     loop di navigazione. Nessun percorso attuale lo fa (navBuild e navRestore
     producono array nuovi), ma il costo della chiave e' un confronto. */
  if (!st || st.ol !== ol || st.man !== man || st.n !== (man ? man.length : 0)) {
    ol.textContent = '';
    st = state._navSteps = { ol: ol, man: man, n: man ? man.length : 0, rows: [] };
    if (man) for (let k = 0; k < man.length; k++) {
      const li = document.createElement('li');
      const sd = document.createElement('span'); sd.className = 'sd';
      const tx = document.createElement('span');
      li.appendChild(sd); li.appendChild(tx);
      ol.appendChild(li);
      // cls/sdTxt/txTxt: ultimo valore scritto, per non toccare il DOM quando non
      // cambia (sono la memoria che rende incrementale il redraw, non un doppione
      // dello stato: leggere textContent/className li rileggerebbe dal DOM).
      st.rows.push({ li: li, sd: sd, tx: tx, cls: null, sdTxt: null, txTxt: null });
    }
  }
  if (!man) return;
  for (let k = 0; k < man.length; k++) {
    const m = man[k], r = st.rows[k];
    const cls = k < nv.nextMan ? 'done' : (k === nv.nextMan ? 'cur' : '');
    if (r.cls !== cls) { r.li.className = cls; r.cls = cls; }
    const sdTxt = k === nv.nextMan ? navFmtShort(navDistToNext(nv))
      : navFmtShort(Math.max(0, nv.sMan[k] - nv.sAlong));
    if (r.sdTxt !== sdTxt) { r.sd.textContent = sdTxt; r.sdTxt = sdTxt; }
    const txTxt = navIcon(m) + ' ' + (m.text || m.streets.join(', '));
    if (r.txTxt !== txTxt) { r.tx.textContent = txTxt; r.txTxt = txTxt; }
  }
}

/* Ricerca indirizzo: numero d'ordine delle richieste + timer del debounce. Stanno qui
   e non dentro init() (index.html) perche' anche la SELEZIONE di un risultato deve
   poter invalidare una risposta Photon ancora in volo, e navRenderResults e' l'unico
   punto che sa che la ricerca e' finita. */
let navSearchT = null, navSearchSeq = 0;

function navSearchCancel() { navSearchSeq++; clearTimeout(navSearchT); navSearchT = null; }

/* Solo per i test: il numero d'ordine non e' osservabile da fuori, ed e' l'unica
   prova che una richiesta partita prima e' stata invalidata. */
function navSearchSeqGet() { return navSearchSeq; }

function navResultsOpen(on) {
  if (els.navQuery) els.navQuery.setAttribute('aria-expanded', on ? 'true' : 'false');
}

/* Svuota la lista e chiude il combobox. Ogni scrittore di navResults passa di qui:
   altrimenti aria-expanded resta "true" su una lista vuota e lo screen reader
   annuncia un elenco che non c'e' piu'. */
function navClearResults() {
  if (els.navResults) els.navResults.textContent = '';
  navResultsOpen(false);
}

/* Frecce per scorrere i risultati, Esc per chiudere, Invio per prendere quello
   focalizzato: i risultati sono <button>, quindi senza questo un combobox e' usabile
   col dito ma non da tastiera (o da un lettore schermo in modalita' form).
   Il listener sta sul DOCUMENTO, non su #navQuery: il campo e #navResults sono
   fratelli, quindi una volta che il fuoco e' entrato in un risultato i keydown non
   risalivano al campo e dal secondo elemento in poi frecce, Esc e Invio erano morti.
   Il filtro qui sotto limita la risposta agli eventi nati nel campo o nella lista. */
function navResultsKey(e) {
  const box = els.navResults;
  if (!box || !e || !box.children) return;
  const t = e.target;
  if (t !== els.navQuery && !(box.contains ? box.contains(t) : t && t.parentNode === box)) return;
  // slice e non box.children: in un browser e' una HTMLCollection, senza indexOf.
  const items = Array.prototype.slice.call(box.children);
  /* Esc PRIMA del ritorno a lista vuota: con la lista gia' chiusa (nessun
     risultato, o Esc premuto poco fa) l'uscita anticipata lasciava armata la
     ricerca in volo, e la risposta Photon atterrava dopo l'annullamento
     riaprendo la lista che Esc aveva appena chiuso. Il fuoco torna nel campo
     anche qui: e' l'unico elemento rimasto a raccogliere frecce e Invio. */
  if (e.key === 'Escape') { navSearchCancel(); navClearResults(); if (els.navQuery) els.navQuery.focus(); return; }
  if (!items.length) return;
  const cur = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, cur + 1)].focus(); }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cur > 0) items[cur - 1].focus(); else if (els.navQuery) els.navQuery.focus();
  }
  else if (e.key === 'Enter' && cur >= 0) {
    e.preventDefault(); items[cur].click(); if (els.navQuery) els.navQuery.focus();
  }
}

function navRenderResults(list) {
  const box = els.navResults;
  if (!box) return;
  const items = list || [];
  /* Il ridisegno distrugge le option: se il fuoco era su una di quelle (risposta del
     debounce arrivata mentre si scorreva la lista precedente) il nodo esce dal DOM e
     il fuoco cade su <body>, da dove frecce/Esc/Invio non raggiungono piu' ne' il
     campo ne' la lista. Indice annotato prima di svuotare, ripristinato dopo. */
  const prev = document.activeElement;
  const prevIdx = prev && prev.parentNode === box
    ? Array.prototype.slice.call(box.children).indexOf(prev) : -1;
  box.textContent = '';
  for (const r of items) {
    const b = document.createElement('button');
    // type esplicito: il default e' "submit" e dentro un form ricaricherebbe la pagina
    b.type = 'button';
    // role=option: l'elenco e' role=listbox (index.html), quindi lo screen reader
    // annuncia "elenco, N opzioni" invece di N bottoni sciolti.
    b.setAttribute('role', 'option');
    const t = document.createElement('b'); t.textContent = r.label;
    const s = document.createElement('span'); s.textContent = r.sub || '';
    b.appendChild(t); b.appendChild(s);
    b.addEventListener('click', () => {
      navSetDest(r);         // navSetDest annulla da solo la ricerca in volo
      navClearResults();
      if (els.navQuery) els.navQuery.value = r.label;
    });
    box.appendChild(b);
  }
  navResultsOpen(items.length > 0);
  /* Stesso indice se la lista nuova e' abbastanza lunga, altrimenti il campo: mai
     lasciare il fuoco su un nodo staccato. */
  if (prevIdx >= 0) {
    if (box.children[prevIdx]) box.children[prevIdx].focus();
    else if (els.navQuery) els.navQuery.focus();
  }
}

function navSetDest(d) {
  /* Una ricerca in volo non deve ripopolare la lista sopra la destinazione appena
     scelta. Qui e non nel click del risultato: anche il GPX importato, il punto
     scelto sulla mappa e la tappa da storico passano di qui, e tutti lasciano il
     debounce di Photon armato. */
  navSearchCancel();
  state.navDest = { lat: d.lat, lon: d.lon, label: d.label || '' };
  /* Anche la rotta VIVA: con una rotta attiva verso A, nv.dest e' l'unica fonte di
     pannello, marker e navMaybeReroute, quindi il campo diceva B e tutto il resto
     restava su A finche' la nuova rotta non arrivava (e in caso di errore di rete,
     per sempre). Copia e non alias: state.navDest viene riassegnato al prossimo
     tocco, e un alias faceva cambiare destinazione alla rotta viva senza passare da
     qui. La geometria resta quella vecchia fino al ricalcolo: e' comunque verso la
     destinazione appena scelta, che e' cio' che l'utente ha chiesto.
     destStale la marca per navTick: la polilinea porta ancora ad A, quindi l'arrivo
     non si giudica contro B (una B vicina al fix faceva scattare "Arrivato" subito,
     verso un punto dove la rotta non porta). Il flag cade da solo quando la rotta
     nuova sostituisce nv. */
  if (state.nav) {
    /* Rotta gia' conclusa (ARRIVED): resta viva solo per il banner e per
       navPersistProgress, che la salta. navArriveReset le riporta bannerDone a
       false, e il timer che nasconde il banner si arma SOLO nel ramo d'arrivo di
       navTick (status ACTIVE): il "⚑ Arrivato" di A ricompariva sopra la
       destinazione B e non se ne andava piu'. IDLE la spegne — navTick esce
       subito (niente arrivo ne' ricalcolo sulla geometria vecchia), banner
       nascosto, e il pannello torna a mostrare le cifre di rotta intera. */
    if (state.nav.status === 'ARRIVED') state.nav.status = 'IDLE';
    state.nav.dest = { lat: state.navDest.lat, lon: state.navDest.lon, label: state.navDest.label };
    state.nav.destStale = true;
    navArriveReset(state.nav);   // l'arrivo annunciato verso A non vale piu'
  }
  renderNavPanel();
  navDrawRoute();
  const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
  if (!p) { navSetStatus('In attesa del primo fix GPS per calcolare il percorso.'); return; }
  navRequestRouteSafe(p, state.navDest, trackUpHeading(), null);
}
