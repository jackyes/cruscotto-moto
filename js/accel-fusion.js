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
  const a = step / (FUS_TAU_S + step);
  state._lpLat = (state._lpLat == null) ? state.latG : state._lpLat + a * (state.latG - state._lpLat);
  state._lpLon = (state._lpLon == null) ? state.lonG : state._lpLon + a * (state.lonG - state._lpLon);
  state.latFus = (state._lpLatGps == null) ? state.latG : clampG((state.latG - state._lpLat) + state._lpLatGps);
  state.lonFus = (state._lpLonGps == null) ? state.lonG : clampG((state.lonG - state._lpLon) + state._lpLonGps);
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
  const hz = state.sensorHz > 5 ? state.sensorHz : 60;
  let n = Math.round(ACC_MEDIAN_S * hz);
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
  const xs = new Array(n), ys = new Array(n), zs = new Array(n);
  for (let i = 0; i < n; i++) { xs[i] = h[i].x; ys[i] = h[i].y; zs[i] = h[i].z; }
  const asc = (a, b) => a - b;
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
  }
}
