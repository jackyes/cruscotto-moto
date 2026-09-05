'use strict';
/* js/nav-map.js (step 23): navReset, navSpeak + heartbeat, navSetStatus, navDrawRoute, navFitRoute. navBuild resta per step con resto nav. Ordine: dopo js/cam-map.js. */
function navReset() {
  state.nav = null;
  navSpeak.stop();
  navRenderBanner();
  navDrawRoute();
}

const navSpeak = {
  voice: null, busy: false, prio: -1, timer: null, primed: false,
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
  say(text, prio) {
    if (!state.navVoice || !text) return;
    if (!('speechSynthesis' in window)) return;
    if (!this.ready) this.pick();        // la lista puo' popolarsi a navigazione avviata
    else if (!this.voice) this.warnNoVoice('Nessuna voce italiana sul dispositivo: le ' +
      'indicazioni saranno lette con accento straniero. Installa i dati vocali italiani ' +
      'dalle impostazioni di sistema (sintesi vocale).');
    if (this.busy) {
      if (prio >= 3 && prio > this.prio) speechSynthesis.cancel();
      else return;                       // scartato di proposito, non accodato
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (this.voice && this.voice.lang) || 'it-IT';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.05;
    this.busy = true; this.prio = prio;
    const done = () => { this.busy = false; this.prio = -1; clearTimeout(this.timer); };
    u.onend = done; u.onerror = done;
    // onend non e' affidabile su tutti i motori Android: watchdog proporzionale.
    clearTimeout(this.timer);
    this.timer = setTimeout(done, Math.max(2500, text.length * 90));
    try { speechSynthesis.speak(u); } catch (e) { done(); }
  },
  stop() {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    this.busy = false; this.prio = -1; clearTimeout(this.timer);
  },
};

setInterval(() => {
  if (navSpeak.busy && 'speechSynthesis' in window) {
    try { speechSynthesis.resume(); } catch (e) {}
  }
}, 8000);

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

function navFitRoute() {
  const nv = state.nav;
  if (!nv || !nv.n || state.mapType !== 'leaflet' || !state.map) return;
  const pts = [[nv.lat[0], nv.lon[0]], [nv.lat[nv.n - 1], nv.lon[nv.n - 1]]];
  for (let i = 0; i < nv.n; i += Math.max(1, Math.floor(nv.n / 200))) pts.push([nv.lat[i], nv.lon[i]]);
  setFollow(false);
  state.map.fitBounds(pts, { padding: [30, 30] });
}
