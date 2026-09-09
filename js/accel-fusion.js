'use strict';
/* js/accel-fusion.js (step 11): fusione accel inerziale+GPS, mediana/passa-basso anti-vibrazione (updateAccelFusion, updateGpsAccel, medianWindow, pushAccHist, medianAcc, updateVibration). Usa state (core) + clampG/pushBounded (sensors-core). No DOM. */
/* Fusione complementare inerziale + GPS su longitudinale e laterale.
   È l'analogo di quello che il giroscopio fa per la piega: qui il riferimento lento
   e senza deriva è il GPS (dv/dt e v·dψ/dt), mentre l'accelerometro porta la banda
   alta. Sotto ~0,1 Hz comanda il GPS, sopra l'accelerometro.
   Il verticale non compare: nessun riferimento esterno esiste, ma non serve, perché
   un'accelerazione verticale sostenuta non è fisicamente possibile. */
function updateAccelFusion(dt) {
  const step = dt > 0 ? dt : 1 / 60;
  /* I riferimenti GPS muoiono col segnale che li ha generati: in galleria (o con
     il GPS che smette di dare velocità) updateGpsAccel non gira più, e lasciare
     vivi _lpLatGps/_lpLonGps congela l'ultima curva dentro latFus/lonFus per
     tutta la durata del buco (offset permanente); peggio, in 'norm' il SEGNO
     della piega verrebbe scelto da un latGps stantio. */
  if (performance.now() - state.speedGpsT > SPEED_STALE_MS) {
    state.latGps = null; state.lonGps = null;
    state._lpLatGps = null; state._lpLonGps = null;
  }
  const a = step / (FUS_TAU_S + step);
  state._lpLat = (state._lpLat == null) ? state.latG : state._lpLat + a * (state.latG - state._lpLat);
  state._lpLon = (state._lpLon == null) ? state.lonG : state._lpLon + a * (state._lpLon - state._lpLon);
  /* Il ramo inerziale della fusione portava la vibrazione non attenuata: il
     residuo (latG − lpLat) e' un passa-alto, e la banda di vibrazione passa
     tutta. Qui il residuo riceve un LP proprio, con tau adattivo: lo stato
     stazionario (residuo ~0) non cambia, i transitori reali durano 2-3
     campioni e il tau base di 50 ms li lascia passare quasi per intero.
     Le colonne *_peak_g conservano comunque i picchi esatti. */
  const ar = step / (ACC_FUS_RES_TAU_S * vibScale() + step);
  const rLat = state.latG - state._lpLat;
  const rLon = state.lonG - state._lpLon;
  state._resLat = (state._resLat == null) ? rLat : state._resLat + ar * (rLat - state._resLat);
  state._resLon = (state._resLon == null) ? rLon : state._resLon + ar * (rLon - state._resLon);
  state.latFus = (state._lpLatGps == null) ? state.latG : clampG(state._resLat + state._lpLatGps);
  state.lonFus = (state._lpLonGps == null) ? state.lonG : clampG(state._resLon + state._lpLonGps);
}

/* Detector di rettificazione MEMS. A moto quasi dritta, senza frenata e senza
   colpi verticali, l'accelerazione verticale vera e' ~0: una media sistematica
   di vertG in quelle condizioni e' offset indotto dalla vibrazione (la massa
   sismica rettifica il rumore ad alta frequenza). L'EMA a 5 s tiene fuori le
   buche (transitori) e il rumore a media nulla. La stima si aggiorna solo col
   gate aperto e resta ferma altrimenti: e' diagnostica, e la correzione — se
   abilitata — e' limitata a ±RECT_NULL_MAX_G in sensors-pipe. */
function updateRectDetector(dt) {
  const gate = Math.abs(state.lean) < RECT_LEAN_MAX_DEG
    && Math.abs(state.lonG) < RECT_LON_MAX_G
    && Math.abs(state.vertG) < RECT_VERT_MAX_G
    && state.vibAdaptG > RECT_VIB_MIN_G;
  if (gate) {
    const a = dt / (RECT_TAU_S + dt);
    state._rectEma = (state._rectEma == null) ? state.vertG : state._rectEma + a * (state.vertG - state._rectEma);
  }
  state.vibRectG = state._rectEma || 0;
}

/* Riferimenti derivati dal GPS, aggiornati a ogni fix (~1 Hz). */
function updateGpsAccel(c, tsMs) {
  const v = (c.speed != null && c.speed >= 0) ? c.speed : null;
  const t = tsMs / 1000;
  if (v != null && state._pvT != null) {
    const dtg = t - state._pvT;
    if (dtg >= 0.2 && dtg <= 5) {
      const lon = ((v - state._pv) / dtg) / G;
      state.lonGps = Math.abs(lon) <= 2 ? lon : null; // scarta glitch di velocità
      /* Laterale: l'imbardata dal giroscopio e' disponibile a 60 Hz, non ha il rumore
         di derivazione di un heading a 1 Hz e non ha il buco sotto HEADING_MIN_MS.
         La derivata dell'heading GPS resta come ripiego dove il giroscopio manca. */
      let lat = null;
      if (state.hasGyro && v >= CENTRIP_MIN_MS) {
        lat = (v * (-state.yawUp * Math.PI / 180)) / G;   // a_lat = v·ψ̇, + = destra
      } else if (c.heading != null && !isNaN(c.heading) && state._phdg != null && v >= HEADING_MIN_MS) {
        let dpsi = c.heading - state._phdg;
        while (dpsi > 180) dpsi -= 360;
        while (dpsi < -180) dpsi += 360;
        lat = (v * (dpsi * Math.PI / 180) / dtg) / G;
      }
      state.latGps = (lat != null && Math.abs(lat) <= 2) ? lat : null;
      const a = dtg / (FUS_TAU_S + dtg);
      if (state.lonGps != null) state._lpLonGps = (state._lpLonGps == null) ? state.lonGps : state._lpLonGps + a * (state.lonGps - state._lpLonGps);
      if (state.latGps != null) state._lpLatGps = (state._lpLatGps == null) ? state.latGps : state._lpLatGps + a * (state.latGps - state._lpLatGps);
    }
  }
  if (v != null) { state._pv = v; state._pvT = t; state._phdg = (c.heading != null && !isNaN(c.heading)) ? c.heading : null; }
}

/* ---- Robustezza alle vibrazioni ----
   Sotto vibrazione l'accelerometro non è semplicemente "rumoroso": produce errori
   sistematici. Tre difese distinte, perché i meccanismi sono tre.

   a) Mediana mobile sul vettore: toglie gli impulsi (buche, giunti) senza il
      ritardo di fase di un passa-basso di pari efficacia.
   b) Passa-basso VETTORIALE prima della norma. hypot() è non lineare, quindi su
      rumore a media nulla la norma non si media a g ma a g·(1+σ²/g²): con 0,3 g
      RMS di vibrazione la norma legge ~1,09 g e il gate di fiducia non si apre
      mai. Filtrando il vettore (operazione lineare) il rumore si cancella davvero.
   c) Metrica di vibrazione dalle differenze campione-campione (un derivatore, cioè
      un passa-alto): pesa la correzione con continuità invece che a gradino.

   Resta fuori portata l'aliasing: il browser cappa devicemotion a ~60 Hz, quindi
   la vibrazione sopra 30 Hz si ripiega dentro la banda utile e nessun filtro
   software la distingue dal segnale. Lì serve il supporto smorzato. */
function medianWindow() {
  // Dimensionata sulla frequenza REALE: a 20 Hz una finestra di 7 campioni ritarda
  // 150 ms invece di 50, e il ritardo entra dritto nell'anello di attitudine.
  // Sotto vibrazione si allarga (fino al tetto di 9): la mediana toglie gli
  // impulsi senza ritardo di fase, quindi allargarla costa poco e guadagna
  // reiezione proprio dove il passa-basso deve allungarsi.
  const hz = state.sensorHz > 5 ? state.sensorHz : 60;
  let n = Math.round(ACC_MEDIAN_S * vibScale() * hz);
  if (n % 2 === 0) n++;
  return n < 3 ? 3 : (n > 9 ? 9 : n);
}
/* js/sensors-core.js: pushBounded */
function pushAccHist(v) {
  const h = state._accHist || (state._accHist = []);
  pushBounded(h, v, medianWindow());
}
function medianAcc() {
  const h = state._accHist;
  if (!h || !h.length) return null;
  const n = h.length;
  // Scratch riusati (max 9 slot, v. medianWindow): allocare 3 array + sort
  // per campione a 60 Hz era GC continuo sul main thread.
  const xs = medianAcc._xs || (medianAcc._xs = new Array(9));
  const ys = medianAcc._ys || (medianAcc._ys = new Array(9));
  const zs = medianAcc._zs || (medianAcc._zs = new Array(9));
  for (let i = 0; i < n; i++) { xs[i] = h[i].x; ys[i] = h[i].y; zs[i] = h[i].z; }
  const asc = (a, b) => a - b;
  xs.length = ys.length = zs.length = n;
  xs.sort(asc); ys.sort(asc); zs.sort(asc);
  const mid = n >> 1;
  return { x: xs[mid], y: ys[mid], z: zs[mid] };
}
/* La metrica precedente era la differenza campione-campione, cioè un derivatore:
   amplifica l'alta frequenza ma conta come "vibrazione" anche il moto reale del
   telaio a 3-5 Hz, e il suo valore dipende dalla frequenza di campionamento, quindi
   non è confrontabile fra device.
   Qui si misura ciò che il nome promette: l'energia RESIDUA rispetto al passa-basso
   vettoriale, cioè il contenuto sopra ~1,6 Hz. `vibG` resta la metrica storica
   (usata dalle soglie già tarate), `vibHiG` è quella nuova fuori banda. */
function updateVibration(ig, dt) {
  if (state._accLP) {
    const r = vsub(ig, state._accLP);
    const pw = vdot(r, r);
    const a = dt / (VIB_TAU_S + dt);
    state._vibPow = (state._vibPow == null) ? pw : state._vibPow + a * (pw - state._vibPow);
    state.vibHiG = Math.sqrt(state._vibPow) / G;
    state.vibG = state.vibHiG;
    /* Metrica di ADATTAMENTO separata: residuo rispetto a un LP piu' veloce
       (~2 Hz). vibHiG resta la metrica storica (indicatori, CSV, gate fermo);
       vibAdaptG guida vibScale e deve ignorare il moto reale del telaio —
       altrimenti una chicane pulita allunga i filtri e taglia la dinamica
       proprio quando serve. La vibrazione del motore, anche aliasata in banda,
       resta sopra ~5 Hz e passa quasi intera da questo residuo. */
    const a2 = dt / (VIB_ADAPT_LP_TAU_S + dt);
    state._accLP2 = (state._accLP2 == null) ? ig : vadd(state._accLP2, vscale(vsub(ig, state._accLP2), a2));
    const r2 = vsub(ig, state._accLP2);
    const pw2 = vdot(r2, r2);
    state._vibPow2 = (state._vibPow2 == null) ? pw2 : state._vibPow2 + a * (pw2 - state._vibPow2);
    state.vibAdaptG = Math.sqrt(state._vibPow2) / G;
  }
}
