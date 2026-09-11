'use strict';
/* js/nav-map.js (step 23): navReset, navSpeak + heartbeat, navSetStatus, navDrawRoute, navFitRoute. navBuild resta per step con resto nav. Ordine: dopo js/cam-map.js. */
/* --- voce: tarature --- */
const VOICE_RATE = 1.05;                  // leggermente più veloce del default
const VOICE_WATCHDOG_MIN_MS = 2500;       // watchdog minimo su onend non affidabile
const VOICE_WATCHDOG_PER_CHAR_MS = 90;    // +90 ms per carattere
const VOICE_HB_MS = 8000;                 // heartbeat resume() per motori che si piantano

function navReset() {
  navSimStop();     // il timer della simulazione sopravvive al reset e scrive in state
  navArriveReset(state.nav);   // idem per il timer del banner "Arrivato"
  navSpeak.stopHeartbeat();
  state.nav = null;
  navSpeak.stop();
  navRenderBanner();
  navDrawRoute();
}

const navSpeak = {
  voice: null, busy: false, prio: -1, timer: null, primed: false, seq: 0,
  ready: false, warned: false, hooked: false, pollTimer: null, pollLeft: 0,
  /* Senza una voce italiana esplicita il motore usa quella di default del sistema:
     u.lang da solo non basta, e "tra 200 metri gira a destra" esce con accento
     inglese. Preferenza: it-IT locale > qualsiasi it locale > qualsiasi it. Le voci
     locali non passano dalla rete, e in moto la copertura non e' garantita.
     Ritorna true quando la lista voci e' popolata (quindi la scelta e' definitiva). */
  pick() {
    let vs = [];
    try { vs = speechSynthesis.getVoices() || []; } catch (e) {}
    if (!vs.length) return false;        // lista non ancora pronta: si riprova dopo
    this.ready = true;
    const it = vs.filter(v => /^it([-_]|$)/i.test(v.lang || ''));
    this.voice = it.find(v => /^it[-_]IT$/i.test(v.lang || '') && v.localService)
              || it.find(v => v.localService)
              || it[0] || null;
    if (!this.voice) this.warnNoVoice('Nessuna voce italiana sul dispositivo: le indicazioni ' +
      'saranno lette con accento straniero. Installa i dati vocali italiani dalle ' +
      'impostazioni di sistema (sintesi vocale).');
    return true;
  },
  warnNoVoice(msg) {
    if (this.warned) return;             // un avviso solo, non a ogni svolta
    if (!state.navVoice) return;         // a voce spenta l'avviso e' rumore: si riproporra'
    this.warned = true;
    toast(msg, 'err', 9000);
  },
  init() {
    if (!('speechSynthesis' in window)) return;
    this.pick();
    if (this.hooked) return;             // init() arriva da tre punti: un solo aggancio
    this.hooked = true;
    // getVoices() e' asincrona su Chrome: al primo giro la lista e' vuota.
    try { speechSynthesis.addEventListener('voiceschanged', () => this.pick()); } catch (e) {}
    // ...e su certe WebView Android 'voiceschanged' non arriva mai: polling di scorta.
    if (!this.ready) {
      this.pollLeft = 20;                // ~3 s a 150 ms
      this.pollTimer = setInterval(() => {
        if (this.pick()) { clearInterval(this.pollTimer); this.pollTimer = null; return; }
        if (--this.pollLeft <= 0) {
          clearInterval(this.pollTimer); this.pollTimer = null;
          this.warnNoVoice('Nessuna voce di sintesi disponibile: le indicazioni vocali ' +
            'potrebbero non funzionare o avere accento straniero.');
        }
      }, 150);
    }
  },
  /* Su iOS il primo speak() deve stare dentro un gesto utente, o la navigazione
     resta muta e lo si scopre a 90 km/h. Si innesca sul tap "Avvia". Su iOS la lista
     voci e' gia' popolata qui, quindi si parla subito senza perdere il gesto; su
     Android il gesto non e' vincolante e ci pensa il polling. */
  prime() {
    if (this.primed || !('speechSynthesis' in window)) return;
    this.primed = true;
    this.pick();                         // ultimo tentativo prima di aprire bocca
    this.say('Navigazione avviata', 4);
  },
  /* Ritorna true se l'utterance è stata effettivamente accodata, false se
     scartata (voce spenta, motore assente, canale occupato con priorità
     insufficiente). Il chiamante (navAnnounce) usa il risultato per decidere se
     consumare i bit di fascia: prima i bit venivano settati PRIMA di say() e un
     cue scartato per busy non veniva MAI più annunciato. */
  say(text, prio) {
    if (!state.navVoice || !text) return false;
    if (!('speechSynthesis' in window)) return false;
    if (!this.ready) this.pick();        // la lista puo' popolarsi a navigazione avviata
    else if (!this.voice) this.warnNoVoice('Nessuna voce italiana sul dispositivo: le ' +
      'indicazioni saranno lette con accento straniero. Installa i dati vocali italiani ' +
      'dalle impostazioni di sistema (sintesi vocale).');
    if (this.busy) {
      if (prio >= 3 && prio > this.prio) speechSynthesis.cancel();
      else return false;                 // scartato di proposito, non accodato
    }
    /* Il resume() periodico si riarma qui, nell'unico punto da cui passa ogni
       annuncio: navStop lo spegne (a navigazione chiusa non serve) e prima lo
       riaccendeva solo navStart — dopo un "Termina", il ricalcolo automatico e la
       destinazione nuova riportavano la navigazione in ACTIVE senza voce, e la
       sintesi di Android, che si pianta da sola dopo ~15 s, troncava a meta' ogni
       annuncio lungo. Idempotente (startHeartbeat esce se gira gia'). */
    this.startHeartbeat();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (this.voice && this.voice.lang) || 'it-IT';
    if (this.voice) u.voice = this.voice;
    u.rate = VOICE_RATE;
    this.busy = true; this.prio = prio;
    // Token di generazione: onend/onerror di un'utterance cancellata arrivano DOPO
    // lo stato della nuova e azzererebbero busy/prio/watchdog, causando voci
    // sovrapposte. Se è scattata una say() più recente, la done() vecchia è no-op.
    const seq = ++this.seq;
    const done = () => { if (seq !== this.seq) return; this.busy = false; this.prio = -1; clearTimeout(this.timer); };
    u.onend = done; u.onerror = done;
    // onend non e' affidabile su tutti i motori Android: watchdog proporzionale.
    // Scattando, il vecchio utterance va CANCELLATO: solo rilasciare busy
    // lasciava la voce ancora in corsa sotto quella nuova (sovrapposte).
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try { speechSynthesis.cancel(); } catch (e2) {}
      done();
    }, Math.max(VOICE_WATCHDOG_MIN_MS, text.length * VOICE_WATCHDOG_PER_CHAR_MS));
    try { speechSynthesis.speak(u); } catch (e) { done(); return false; }
    return true;
  },
  stop() {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    this.seq++;                              // invalida i done() pendenti della voce cancellata
    this.busy = false; this.prio = -1; clearTimeout(this.timer);
  },
  /* Heartbeat con handle esplicito: prima il setInterval globale girava per
     sempre, anche a navigazione chiusa (nessun clearInterval su navStop). */
  startHeartbeat() {
    if (this.hb) return;
    this.hb = setInterval(() => {
      if (this.busy && 'speechSynthesis' in window) {
        try { speechSynthesis.resume(); } catch (e) {}
      }
    }, VOICE_HB_MS);
  },
  stopHeartbeat() {
    if (this.hb) { clearInterval(this.hb); this.hb = null; }
  },
};

navSpeak.startHeartbeat();

function navSetStatus(t) { if (els.navStatusTxt) els.navStatusTxt.textContent = t; }


function navDrawRoute() {
  if (state.mapType === 'leaflet' && state.map) {
    if (!state.navLayer) state.navLayer = L.layerGroup().addTo(state.map);
    state.navLayer.clearLayers();
    const nv = state.nav;
    if (nv && nv.n) {
      const pts = [];
      for (let i = 0; i < nv.n; i++) pts.push([nv.lat[i], nv.lon[i]]);
      L.polyline(pts, { color: '#a78bfa', weight: 6, opacity: 0.85 }).addTo(state.navLayer);
      const k = nv.nextMan;
      if (k < nv.man.length) {
        const a = Math.max(0, nv.man[k].beginIdx), b = Math.min(nv.n - 1, nv.man[k].endIdx);
        const seg = [];
        for (let i = a; i <= b; i++) seg.push([nv.lat[i], nv.lon[i]]);
        if (seg.length > 1) L.polyline(seg, { color: '#f0abfc', weight: 7 }).addTo(state.navLayer);
      }
    }
    const d = (state.nav && state.nav.dest) || state.navDest;
    if (d) L.circleMarker([d.lat, d.lon], { radius: 8, color: '#a78bfa', fillColor: '#a78bfa', fillOpacity: 0.9, weight: 3 }).addTo(state.navLayer);
  }
  if (state.mapType === 'canvas') drawCanvasMap();
}

/* Inquadra tutta la rotta sul tab mappa. Solo su percorso FRESCO (why == null in
   nav-net.js): una destinazione nuova e' una cosa che l'utente sta guardando, e
   staccare l'inseguimento per vederla e' quello che si aspetta. In ricalcolo e in
   ripresa no — si sta guidando, e navFitRoute spegneva il follow proprio mentre
   serviva, lasciando la mappa allargata su tutta la rotta a meta' viaggio (per
   riprendere la moto bisognava ritoccare "Segui" in marcia). */
function navFitRoute(fitAll) {
  const nv = state.nav;
  if (!fitAll) return;
  if (!nv || !nv.n || state.mapType !== 'leaflet' || !state.map) return;
  const pts = [[nv.lat[0], nv.lon[0]], [nv.lat[nv.n - 1], nv.lon[nv.n - 1]]];
  for (let i = 0; i < nv.n; i += Math.max(1, Math.floor(nv.n / 200))) pts.push([nv.lat[i], nv.lon[i]]);
  setFollow(false);
  state.map.fitBounds(pts, { padding: [30, 30] });
}

/* Traccia GPX importata: overlay tratteggiato sopra la rotta calcolata, così la
   differenza fra "giro registrato" e "percorso suggerito" resta visibile. */
function drawGpxRoute() {
  const pts = state.gpxRoute;
  if (state.mapType === 'leaflet' && state.map) {
    if (!state.gpxLayer) state.gpxLayer = L.layerGroup().addTo(state.map);
    state.gpxLayer.clearLayers();
    if (pts && pts.length > 1) {
      L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#34d399', weight: 4, opacity: 0.8, dashArray: '6 6' }).addTo(state.gpxLayer);
    }
  }
  if (state.mapType === 'canvas') drawCanvasMap();
}
