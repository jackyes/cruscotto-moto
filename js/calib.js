'use strict';
/* js/calib.js (step 10): calibrazione posa + bias accelerometro (CALIB_*, start/collect/finishCalibration, startAccBiasCapture/collectAccBias). Usa state/store/els/toast + vlen/vadd/vnorm/vscale/buildBias/resetSensorFilters/updateCalibStatus. Ordine: dopo js/storage.js (store) e js/sensors-core.js. */
/* Offset dell'accelerometro: a moto ferma e dritta le tre componenti devono valere
   esattamente 0. È l'analogo della stima del bias giroscopio, e serve soprattutto
   quando il device espone e.acceleration (nel percorso derivato l'offset se ne va
   già con la stima di gravità). */
/* La calibrazione catturava l'istantaneo _lastUp (mediana su ~117 ms). Bastava un
   colpo di vento o una mano appoggiata per congelare una posa sbagliata, senza modo
   di accorgersene: lo stato diceva "calibrato" comunque.
   Ora si media su CALIB_MS con un gate di qualita' su tutta la finestra — se la moto
   si muove, la calibrazione viene RIFIUTATA invece che accettata sbagliata. */
const CALIB_MS = 2000;
/* Soglie tarate per tollerare il MINIMO del motore: la vibrazione "rettifica" la
   norma dell'accelerometro (offset DC dei MEMS) e scuote il giroscopio, ma non e'
   movimento vero. Un'accelerazione reale (motocicletta spinta o inclinata) resta
   ben oltre queste soglie. */
const CALIB_MAX_ROT_DPS = 4.0;   // rotazione istantanea oltre cui il campione non vale
const CALIB_MAX_NORM_DEV = 0.12; // |‖a‖/g − 1| oltre cui il campione non vale
const CALIB_MAX_SPREAD_DEG = 3.0;// dispersione massima dei campioni attorno alla media
const CALIB_MAX_BAD_RATIO = 0.3; // frazione massima di campioni scartati
const CALIB_MAX_MEAN_ROT = 1.0;  // rotazione MEDIA (°/s) oltre cui la moto si e' mossa

function startCalibration() {
  if (state._calPending) return;
  if (!state._lastUp) {
    toast('Nessun dato sensore. Avvia la Demo o muovi il telefono, poi ricalibra.', 'err', 5000);
    return;
  }
  state._calPending = true;
  state._calSum = { x: 0, y: 0, z: 0 };
  state._calN = 0;
  state._calSamples = [];
  state._calBadN = 0;
  state._calRotSum = 0;
  els.btnCalib.disabled = true;
  const tip = toast('Calibrazione… tieni la moto ferma e dritta.', null, CALIB_MS + 500);
  setTimeout(() => { finishCalibration(tip); }, CALIB_MS);
}

function collectCalib() {
  if (!state._calPending || !state._lastUp) return;
  /* Un singolo scossone non deve condannare la calibrazione: si contano i campioni
     scartati e si rifiuta solo se sono una frazione rilevante della finestra. */
  const rotating = state.hasGyro && vlen({ x: state.gyroRoll, y: state.gyroYaw, z: 0 }) > CALIB_MAX_ROT_DPS;
  const accel = Math.abs(state.gRatio - 1) > CALIB_MAX_NORM_DEV;
  if (rotating || accel) state._calBadN++;
  /* Media FIRMATA della rotazione: la vibrazione del motore ha media zero e si
     annulla, una piega o un movimento reale e' sistematico e resta. E' questo il
     vero discriminante fra "vibra" e "si muove". */
  state._calRotSum += state.gyroRoll;
  const u = state._lastUp;
  state._calSum = vadd(state._calSum, u);
  state._calSamples.push(u);
  state._calN++;
}

function finishCalibration(tip) {
  state._calPending = false;
  els.btnCalib.disabled = false;
  if (tip) tip.remove();
  const n = state._calN;
  if (!n || n < 10) { toast('Dati insufficienti per calibrare: riprova.', 'err', 5000); return; }
  const mean = vnorm(vscale(state._calSum, 1 / n));
  // Dispersione: quanto i campioni si discostano dalla media, in gradi.
  let worst = 0;
  for (const u of state._calSamples) {
    const d = Math.acos(Math.max(-1, Math.min(1, vdot(u, mean)))) * 180 / Math.PI;
    if (d > worst) worst = d;
  }
  const badRatio = state._calBadN / Math.max(1, n);
  const meanRot = Math.abs(state._calRotSum / Math.max(1, n));
  if (meanRot > CALIB_MAX_MEAN_ROT || badRatio > CALIB_MAX_BAD_RATIO || worst > CALIB_MAX_SPREAD_DEG) {
    const why = meanRot > CALIB_MAX_MEAN_ROT
      ? ('la moto si è mossa (rotazione ' + meanRot.toFixed(1) + '°/s)')
      : (worst > CALIB_MAX_SPREAD_DEG
          ? ('la moto si è mossa (dispersione ' + worst.toFixed(1) + '°)')
          : 'la moto si è mossa durante la misura');
    toast('Calibrazione rifiutata: ' + why +
          '. Moto dritta e ferma su piano, poi ripremi Calibra. ' +
          'A motore acceso al minimo va bene: la vibrazione non impedisce la calibrazione.', 'err', 7000);
    return;
  }
  state.calib = buildBasis(mean);
  state.calib.v = 2;                 // versione: invalida le calibrazioni pre-riscrittura
  resetSensorFilters();
  startAccBiasCapture();
  store.set('cruscotto.calib', state.calib);
  updateCalibStatus();
  toast('Calibrato (dispersione ' + worst.toFixed(2) + '°, ' + n + ' campioni).', 'ok', 4000);
}

function startAccBiasCapture() {
  state.accBias = null;
  state._abSum = { lat: 0, lon: 0, vert: 0 };
  state._abN = 0;
  state._abT = 0;
  state._abPending = true;
}
function collectAccBias(dt) {
  if (!state._abPending) return;
  state._abSum.lat += state.latG;
  state._abSum.lon += state.lonG;
  state._abSum.vert += state.vertG;
  state._abN++;
  // Soglia in TEMPO, non in campioni: 60 campioni sono 1 s a 60 Hz ma 3 s a 20 Hz.
  state._abT = (state._abT || 0) + (dt > 0 ? dt : 1 / 60);
  if (state._abT < ACC_BIAS_S) return;
  const n = state._abN;
  const b = { lat: state._abSum.lat / n, lon: state._abSum.lon / n, vert: state._abSum.vert / n };
  state._abPending = false;
  const ok = Math.abs(b.lat) <= ACC_BIAS_MAX_G && Math.abs(b.lon) <= ACC_BIAS_MAX_G && Math.abs(b.vert) <= ACC_BIAS_MAX_G;
  if (ok) {
    state.accBias = b;
  } else {
    // Offset enorme: quasi sempre significa che la moto non era ferma durante la
    // calibrazione. Meglio non applicarlo che congelare un errore.
    state.accBias = null;
    toast('Offset accelerometro fuori scala: la moto era in movimento? Ricalibra da ferma.', 'err', 6000);
  }
}

