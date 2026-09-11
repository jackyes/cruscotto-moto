'use strict';
/* ============================== Stato ============================== */
const G = 9.80665;
const LOG_HZ = 20;
const FLUSH_MS = 10000;
const MAX_ROWS = 180000;
const TRACK_MAX = 10000;
const CHART_WINDOW = 60000;
/* --- soglie pipeline sensori (prima sparse come letterali) --- */
const SENSOR_DT_MIN_S = 0.0005;  // dt sotto questo = campione duplicato/difettoso
const SENSOR_DT_MAX_S = 0.25;    // dt sopra questo = buco: reinizializza i filtri
const YAW_LP_MIN_S = 0.02;       // tau minimo del filtro lento sull'imbardata
const LEAN_CLAMP_DEG = 80;       // saturazione della piega esposta
const TRACK_POINT_MIN_MS = 1000; // throttle punti traccia (performance.now())
const CAM_ALERT_MS = 4000;       // durata banner autovelox
/* --- mappa live --- */
const MAP_INIT_ZOOM = 5;         // vista iniziale (Italia) prima del primo fix
const MAP_FIT_MAX_ZOOM = 16;     // zoom massimo del fitBounds sulla traccia
const MAP_CENTER_ZOOM = 16;      // zoom del rientro manuale
const MAP_CENTER_MIN_ZOOM = 14;  // sotto questo zoom il rientro salta (setView) invece di panTo
const MAP_TRACK_COLOR = '#29b6f6';
const MAP_CAM_COLOR = '#f87171';
const MAP_ROTATE_SETTLE_MS = 60; // attesa invalidateSize dopo rotazione track-up

const SPEED_DEADBAND_MS = 0.55; // sotto ~2 km/h → 0 (fermo)
const TRACK_MIN_M = 5;         // distanza minima tra punti traccia (m)
const GPS_ACC_MAX = 30;        // scarta fix con accuratezza peggiore (m)
const CAM_ACC_MAX = 60;        // gate accuratezza per gli avvisi autovelox (m): più permissivo
                               // del gate traccia, qui conta non far scattare un falso banner
/* --- raggio dati autovelox ---
   Il raggio di query e' impostabile (state.camRadius). Raggio marker e soglia di
   refetch NON sono costanti indipendenti ma derivati: tenerli separati li faceva
   divergere, e un raggio marker maggiore del raggio scaricato disegna il vuoto. */
const CAM_RADIUS_CHOICES = [10000, 15000, 20000, 30000, 50000];
const CAM_RADIUS_DEFAULT = 15000;
/* Distanza di avviso autovelox. La lista e' la stessa delle <option> di index.html:
   con la validazione a range (50-2000) un valore salvato valido a runtime ma fuori
   dalle opzioni (es. 250 da una build precedente, o un localStorage modificato a
   mano) lasciava la <select> VUOTA e non c'era modo di rimetterla a posto, perche'
   il change scatta solo su una scelta esplicita dell'utente. */
const CAM_DIST_CHOICES = [300, 400, 600];
const CAM_DIST_DEFAULT = 400;
function camDistFrom(v) {
  const n = parseInt(v, 10);
  return CAM_DIST_CHOICES.indexOf(n) >= 0 ? n : CAM_DIST_DEFAULT;
}
const CAM_MARKER_FACTOR = 1.5; // oltre il bordo scaricato c'e' ancora dato, se importato
const CAM_MOVE_FACTOR = 0.5;   // refetch a meta' raggio: mezzo raggio di copertura resta davanti
const CAM_MARKER_MAX = 400;    // tetto marker disegnati (un DB nazionale a 50 km blocca il telefono)
const CAM_STALE_MS = 15 * 60 * 1000; // refresh cache dopo 15 min
const CAM_COOLDOWN_MS = 60000; // non ri-avvisa stessa camera entro 60 s
const CAM_LAST_DIST_MAX_MS = 10000; // distanza precedente valida max (avvicinamento)
const CAM_FAIL_BACKOFF_MS = 120000; // dopo un errore Overpass, riprova non prima di 2 min
const CAM_GRID_DEG = 0.02;     // lato cella griglia spaziale camere (~2 km)
const CAM_AHEAD_DEG = 60;      // semi-apertura del cono "davanti a me"
/* --- piega: filtro di attitudine ---
   TUTTI i guadagni sono in unità di tempo (1/s o s), MAI per-campione.
   La versione precedente mescolava le due cose: la predizione era `* dt` e la
   correzione era `k * err` per campione, quindi la frequenza di crossover del
   complementare scalava con la frequenza degli eventi. Su un device a 30 Hz la
   reiezione della deriva si dimezzava rispetto ai 60 Hz di progetto. */
const ATT_KP = 3.0;            // guadagno proporzionale del riallineamento (1/s)
const ATT_KI = 0.10;           // guadagno integrale: stima del bias giroscopio (1/s²)
const ATT_BIAS_MAX_DPS = 5;    // saturazione del bias stimato, per asse (°/s)
const ATT_TOL_G = 0.06;        // residuo di coerenza |‖a‖/g − atteso| oltre cui non ci si fida
const ATT_MIN_REF_MAG_G = 0.1; // riferimento sotto questa norma = inutilizzabile
const ATT_LON_RAW_MAX_G = 0.15;// gate manovra longitudinale per il riferimento da norma
const ATT_GPS_SIGN_MIN_G = 0.05; // latGps sotto questo modulo non dice il segno della piega
const ATT_LEAN_SIGN_MIN_DEG = 2; // piega sotto questo modulo non dice il segno
const ATT_NORM_TTL_MS = 2000;  // scadenza dell'ultimo riferimento 'norm' salvato
const ATT_EXPECT_MIN = 0.2;    // floor del cos(lean) nel valore atteso (mai 0)
const ATT_INIT_MIN_TRUST = 0.5;// fiducia minima del riferimento per inizializzare
const CENTRIP_MIN_MS = 3;      // sotto questa velocità la compensazione centripeta è inutile
const NORM_MODE_TRUST = 0.3;   // fiducia nel riferimento ricavato dalla sola norma (senza GPS)
const LEAN_SMOOTH_TAU_S = 0.15;// passa-basso del fallback senza giroscopio
const LEAN_GYRO_MAX_DPS = 400; // saturazione simmetrica del giroscopio (spike da vibrazione)
const ACC_MEDIAN_S = 0.117;    // finestra mediana sul vettore accelerazione (s, non campioni)
const ACC_LP_TAU_S = 0.10;     // passa-basso vettoriale prima della norma
const VIB_TAU_S = 0.30;        // costante di tempo della stima di vibrazione
const LEAN_VIB_MAX = 0.6;      // g RMS considerato "vibrazione piena" per gli indicatori
const VIB_ADAPT_LP_TAU_S = 0.08; // LP di riferimento per la metrica di ADATTAMENTO:
                                 // residuo sopra ~2 Hz. Il moto reale del telaio
                                 // (rollio di chicane, sconnessioni <1 Hz) non deve
                                 // allungare i filtri; la vibrazione del motore
                                 // (in banda, 5-30 Hz) passa quasi intera.
/* --- vibrazione: adattamento ---
   Sotto vibrazione le costanti di tempo si ALLUNGANO (tau_eff = tau_base ·
   vibScale) e i guadagni si riducono: il riferimento accelerometrico filtrato
   e' piu' rumoroso, e iniettarlo con lo stesso peso di quando e' pulito e' il
   modo classico di guadagnare errore senza guadagnare banda. Il gate di
   coerenza ATT_TOL_G invece resta FISSO: la lezione delle versioni precedenti
   e' che allargare la tolleranza con la vibrazione cancella l'unico rilevatore
   di curva funzionante (‖a‖/g = 1/cos φ E' la piega). */
const VIB_ADAPT_MAX = 0.5;       // vibAdaptG (g) oltre cui il fattore non cresce piu'
const VIB_ADAPT_K = 3.0;         // vibScale = 1 + K·min(vibAdaptG, VIB_ADAPT_MAX): max x2.5
const GYRO_LP_TAU_S = 0.04;      // tau base del passa-basso giroscopio (era hardcoded 0.04)
const YAW_LP_BASE_S = 0.05;      // filtro veloce sull'imbardata: quasi zero ritardo
const YAW_LP_TAU_S = 0.15;       // tau pieno del filtro lento su yaw (raggiunto col rumore massimo)
const YAW_NOISE_MAX_DPS = 6;    // rumore di imbardata (°/s) che porta il tau al valore pieno
const ACC_FUS_RES_TAU_S = 0.05;  // tau LP del residuo inerziale sui canali lat/lon fusi
/* --- gravita': cross-check nativa vs propria ---
   La fusione di piattaforma (TYPE_GRAVITY/TYPE_LINEAR_ACCELERATION) non e'
   tarata per la vibrazione del motore: in 'auto' la si confronta con g·û della
   propria attitudine e la si butta se divergono. */
const GRAV_AGREE_DEG = 12;       // angolo oltre cui la gravita' nativa non si crede
const GRAV_AGREE_G = 0.15;       // scarto di norma oltre cui non si crede (g)
/* --- rettificazione MEMS: stima dell'offset DC indotto dalla vibrazione ---
   A moto quasi dritta, senza frenata, l'accelerazione verticale vera e' ~0:
   una media sistematica di vertG sotto vibrazione e' offset, non moto. La
   stima e' diagnostica; la correzione opzionale e' limitata a ±RECT_NULL_MAX_G. */
const RECT_TAU_S = 5.0;          // memoria della media di vertG (s)
const RECT_LEAN_MAX_DEG = 8;     // gate: assetto quasi dritto
const RECT_LON_MAX_G = 0.15;     // gate: niente frenata/accelerazione
const RECT_VIB_MIN_G = 0.20;     // misura solo quando vibra
const RECT_VERT_MAX_G = 0.30;    // gate: esclude buche e manovre verticali
const RECT_NULL_MAX_G = 0.05;    // tetto della correzione applicata
/* --- velocità fusa inerziale + GPS --- */
const GPS_LAG_S = 0.6;         // ritardo tipico della velocità Doppler; compensato via storia di v̂
const SPEED_HIST_S = 3;        // profondità della storia di v̂ (s)
const SPEED_STALE_MS = 3000;   // oltre questo la velocità GPS non è più utilizzabile
const SPEED_MAX_DEV_MS = 2.5;    // scostamento massimo dalla velocità GPS con fix fresco
/* --- stimatore del segno del giroscopio --- */
const GSIGN_TAU_S = 4;         // memoria della correlazione rollio/derivata-accelerometro
const GSIGN_MIN_ENERGY = 150;  // energia minima prima di dare un verdetto
const GSIGN_MAX_GAP_S = 1.0;   // buco fra due campioni oltre cui la baseline dLean è stantia
const GSIGN_UNLOCK_FRAC = 0.37;// frazione dell'energia sotto cui il lock scade
const GSIGN_MIN_RATE_DPS = 5;  // rollRate o dLean sotto questo modulo: nessuna informazione
const GSIGN_FLIP_RATIO = 0.3;  // score < −ratio·energy → verdetto: segno invertito
/* --- accelerazioni: laterale / longitudinale / verticale --- */
const DESPIKE_G = 1.5;         // salto minimo (g) per sospettare un glitch di sensore
const DESPIKE_RATIO = 0.35;    // quanto i due vicini devono somigliarsi per dirlo isolato
const ACCEL_LIMIT_G = 4;       // saturazione simmetrica: una buca vera può fare 3 g
const ACC_MEDIAN_MAX = 9;      // tetto finestra mediana (medianWindow e scratch medianAcc)
const ACC_BIAS_MAX_G = 0.5;    // offset accelerometro massimo accettato in calibrazione
const ACC_BIAS_S = 1.0;        // durata della media per stimare l'offset (s, non campioni)
const FUS_TAU_S = 1.5;         // crossover della fusione inerziale/GPS (~0,1 Hz)
const BENCH_SEC = 20;          // durata del test a banco
/* Segno del vettore rotationRate.

   Con la formulazione vettoriale (dû/dt = −ω × û) il segno non è più una scelta di
   convenzione: è fisica. Se ω è la velocità angolare destrorsa del device in
   coordinate device — quello che la spec W3C impone — allora +1 è corretto, e la
   piega estratta con atan2(û·B.right, û·B.up) esce già con il segno giusto.
   La vecchia costante valeva −1 perché compensava la proiezione scalare, non perché
   il giroscopio fosse invertito.
   Poiché i motori non sono uniformi e il README dichiarava il segno mai validato,
   qui è un valore IMPARATO a runtime (vedi updateGyroSign) invece che una costante,
   con default +1. */
const LEAN_GYRO_SIGN_DEFAULT = 1;
const SAMPLE_MS = 1000 / LOG_HZ;  // periodo campionamento log (timer reale, non rAF)
const GAP_MS = 500;               // buco temporale oltre il quale il log segna una discontinuità
const DISPLAY_HZ = 15;            // refresh UI (rAF throttlato: batteria/calore)
const HEADING_MIN_MS = 3;         // sotto questa velocità l'heading GPS è rumore

const state = {
  theme: 'dark',
  mount: 'landscape-left',
  invertLean: false,
  wakeLockOn: true,
  calib: null,
  lean: 0,
  pitch: 0,           // beccheggio (°), positivo = muso in su — nuovo
  leanKin: null,      // piega cinematica atan(v·ψ̇/g): stima indipendente, per confronto (null = non calcolabile: GPS stantio o fermo)
  gyroRoll: 0,
  gyroYaw: 0,         // imbardata attorno all'asse su del frame moto (°/s)
  yawUp: 0,           // imbardata attorno alla verticale VERA (°/s) — quella cinematica
  latG: 0, lonG: 0, vertG: 0,
  speedKph: 0, speedMs: 0,
  gps: { lat: null, lon: null, alt: null, heading: null, acc: null }, // smussata: solo marker
  pos: { lat: null, lon: null },   // grezza: distanze, traccia, avvisi autovelox
  gpsStatus: 'waiting',
  logging: false,
  rows: [],
  track: [],                 // {lat, lon, alt, t, ts} — live, cappata a TRACK_MAX
  trackFull: [],             // stessa traccia senza cap: è lei che va a disco (GPX/storico)
  _trackWritten: 0,          // punti traccia già scritti nei chunk (coordinate globali)
  _trackTrimmed: 0,          // punti traccia scartati dal trim della mappa live
  chartBuf: [],              // {t, speedKph, lean, latG, lonG}
  session: { maxSpeed: 0, maxLeanR: 0, maxLeanL: 0, distKm: 0, start: 0, startWall: 0, lastPos: null },
  demo: false,
  currentTab: 'dashboard',
  mapReady: false,
  mapType: null,             // 'leaflet' | 'canvas'
  cameras: [],
  importedCameras: [],
  camGrid: null,             // Map<cellKey, camera[]> — indice spaziale
  camGridVer: 0,             // versione griglia: invalida la cache camsToDraw
  camAlerts: true,
  camAhead: true,
  camDist: CAM_DIST_DEFAULT,
  camRadius: CAM_RADIUS_DEFAULT,
  camDrawn: 0,               // marker effettivamente disegnati / candidati: il tetto
  camTotal: 0,               // non deve essere silenzioso (vedi updateCamStatus)
  camCenter: null,
  camTs: 0,
  camCooldown: {},
  camFetching: false,
  camRetryAfter: 0,
  camLastDist: {},           // distanza precedente per camera (rilevamento avvicinamento)
  camLegalOk: false,
  guidaAlways: false,
  speedLimit: null,
  speedLimitAt: 0,
  speedLimitPos: null,
  speedLimitFetching: false,
  speedLimitRetryAfter: 0,
  // navigazione: preferenze persistite + stato vivo (vedi navReset)
  navVoice: true, navNoHw: false, navNoToll: false, navBackroads: false, navNoFerry: false,
  nav: null,                 // null = nessun percorso caricato
  navDest: null,             // {lat, lon, label} scelta ma non ancora calcolata
  navVias: [],               // tappe intermedie [{lat, lon, label}] (max 1 in v1)
  gpxRoute: null,            // traccia GPX importata come rotta (overlay)
  follow: true,
  trackUp: false,
  mapRotDeg: 0,      // rotazione CSS applicata a #map (track-up Leaflet): la compensa rotContainerPoint
  compass: null,
  compassOffset: 0,
  gyroFusion: true,
  sessionId: null,
  flushSeq: 0,
  flushedRows: 0,
  // qualità del segnale
  vibG: 0,            // RMS della vibrazione (g), stimata sulle differenze campione-campione
  gRatio: 1,          // ‖a‖ filtrata / g — 1 = coerente con la sola gravità
  leanConf: 1,        // affidabilità della piega 0..1 (guidata dalla vibrazione)
  attBias: { x: 0, y: 0, z: 0 }, // bias giroscopio VETTORIALE appreso dal termine integrale (°/s)
  leanBias: 0,        // proiezione del bias sull'asse di rollio (°/s), per la diagnostica
  gyroSign: LEAN_GYRO_SIGN_DEFAULT, // segno del vettore rotationRate, imparato a runtime
  gyroSignScore: 0,   // correlazione accumulata: <0 = segno da ribaltare
  gyroSignEnergy: 0,  // quanta evidenza è stata raccolta
  gyroSignLocked: false, // verdetto già dato: blocca l'accumulo finché l'energia resta sopra soglia
  attRef: 'none',     // riferimento attivo: 'centrip' | 'raw' | 'gyro' | 'none'
  attTrust: 0,        // credibilità istantanea del riferimento accelerometrico 0..1
  speedFusMs: 0,      // velocità fusa inerziale+GPS (m/s), senza il ritardo del Doppler
  speedGpsMs: null,   // ultima velocità GPS realmente riportata (null = non riportata)
  speedGpsT: 0,       // performance.now() dell'ultima velocità GPS valida
  vibHiG: 0,          // vibrazione fuori banda (g) — sostituisce la differenza prima
  vibAdaptG: 0,       // metrica di adattamento (g): residuo sopra ~2 Hz, guida vibScale
  sensorSrc: 'none',  // 'generic' | 'devicemotion'
  gravNative: false,  // gravità/accelerazione lineare fornite dalla fusione di piattaforma
  gravityMode: 'auto',// 'auto' (cross-check) | 'native' | 'own'
  gravAgreeDeg: null, // disaccordo (°) fra gravità nativa e propria attitudine
  rectNull: false,    // applica la correzione da rettificazione MEMS (limitata)
  vibRectG: 0,        // stima offset da rettificazione MEMS (g, canale verticale)
  vibScaleVal: 1,     // fattore di adattamento attuale (diagnostica)
  attKp: ATT_KP,      // guadagno proporzionale effettivo (adattivo, diagnostica)
  accBias: null,      // offset accelerometro (g, frame moto) rilevato in calibrazione
  latGps: null,       // accelerazione laterale da GPS: v·dψ/dt (g)
  lonGps: null,       // accelerazione longitudinale da GPS: dv/dt (g)
  latFus: 0,          // laterale fusa inerziale+GPS (g)
  lonFus: 0,          // longitudinale fusa inerziale+GPS (g)
  sensorHz: 0,        // frequenza reale degli eventi devicemotion
};

/* Accumulatore per la decimazione del log: il campionamento a 20 Hz prende la media
   dei campioni arrivati nell'intervallo invece dell'istantanea. Senza questa media
   la decimazione 60→20 Hz è essa stessa una sorgente di aliasing. */
const logAcc = {
  n: 0, lean: 0, latG: 0, lonG: 0, vertG: 0, gyro: 0, vib: 0, latFus: 0, lonFus: 0,
  // canali nuovi: beccheggio, imbardata, velocita' fusa, piega cinematica, vibrazione fuori banda
  pitch: 0, yaw: 0, speedFus: 0, leanKin: 0, vibHi: 0, vibRect: 0,
  // La media protegge dall'aliasing ma cancella i picchi, che sul verticale sono
  // proprio l'informazione utile: si tiene anche il massimo in modulo, con segno.
  latPk: 0, lonPk: 0, vertPk: 0,
};
function keepPeak(cur, v) { return Math.abs(v) > Math.abs(cur) ? v : cur; }

/* logAcc veniva riempito da onDeviceMotion fin dal caricamento pagina, senza gate su
   state.logging, e svuotato solo da takeLogAvg(). La prima riga di OGNI sessione era
   quindi la media di tutto il tempo trascorso prima dello Start, e le colonne *_peak_g
   riportavano il massimo assoluto storico: dopo aver montato il telefono a mano quasi
   sempre il clamp a 4,00 g, che recoverChunks() riprendeva come picco di sessione. */
function resetLogAcc() {
  logAcc.n = 0;
  logAcc.lean = logAcc.latG = logAcc.lonG = logAcc.vertG = 0;
  logAcc.gyro = logAcc.vib = logAcc.latFus = logAcc.lonFus = 0;
  logAcc.pitch = logAcc.yaw = logAcc.speedFus = logAcc.leanKin = logAcc.vibHi = logAcc.vibRect = 0;
  logAcc.latPk = logAcc.lonPk = logAcc.vertPk = 0;
}

let lastFlush = performance.now();
let lastChartT = performance.now();
let lastDisplayT = 0;
let lastTrackT = 0;
let wakeLock = null;
let wakeLockReq = null;   // una sola richiesta in volo: init + visibilitychange
                          // insieme acquisivano DUE lock e il primo non veniva mai rilasciato
let sampleTimer = null;
let lastMotionT = 0;

/* ============================== Mapping assi ==============================
   Frame moto: forward = +X, up = +Z, left = +Y.
   Telefono (schermo rivolto al pilota): forward moto = -dZ (normale schermo).
   Il montaggio definisce solo quale asse dispositivo è "laterale"/"verticale" per le accelerazioni.
*/
const MOUNT = {
  'landscape-left':  { vert: 'x',  lat: 'y',  lon: '-z', up: { x: 1, y: 0, z: 0 } },
  'landscape-right': { vert: '-x', lat: '-y', lon: '-z', up: { x: -1, y: 0, z: 0 } },
  'portrait':        { vert: 'y',  lat: '-x', lon: '-z', up: { x: 0, y: 1, z: 0 } },
};
/* Chiave di montaggio validata — unico punto di verità per settings salvate,
   <select> a runtime, calibrazione e loop sensori. hasOwnProperty e non
   `MOUNT[x] ||`: 'constructor', 'toString' e '__proto__' non sono in MOUNT ma
   stanno nella catena di prototipi, quindi MOUNT[x] li trova truthy e la guardia
   ingenua lascia passare proprio le chiavi che deve fermare (m.lat === undefined
   → TypeError, cioè calibrazione o loop sensori morti). */
function mountKey(k) {
  return Object.prototype.hasOwnProperty.call(MOUNT, k) ? k : 'landscape-left';
}
function mountDef(k) {
  return MOUNT[mountKey(k)];
}
function axis(v, key) {
  const neg = key[0] === '-';
  const c = key[neg ? 1 : 0];
  // ?? non ||: un NaN non deve diventare 0 — il gate finiteVec a valle esiste
  // proprio per buttare i campioni difettosi, non per mascherarli.
  const val = v[c] ?? 0;
  return neg ? -val : val;
}

/* ============================== Algebra vettoriale ============================== */
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vcross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function vnorm(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vscale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const vlen = v => Math.hypot(v.x, v.y, v.z);

/* ============================== Lean (piega) ============================== */
function upVector(accIncG) {
  const x = accIncG.x || 0, y = accIncG.y || 0, z = accIncG.z || 0;
  const m = Math.hypot(x, y, z) || 1;
  return { x: x / m, y: y / m, z: z / m };
}

/* Angolo di rollio attorno all'asse longitudinale REALE del frame moto.

   La versione precedente confrontava le proiezioni xy (assi device) di U e U0, cioè
   misurava la rotazione attorno a dZ del telefono, non attorno a B.fwd. Con un
   supporto inclinato all'indietro di mu il risultato era atan(tan(phi)/cos(mu)):
   a mu=25 gradi una piega vera di 40 gradi veniva letta 42,8. L'inclinazione del
   supporto era assorbita per le tre accelerazioni (che usano la base) ma NON per la
   piega. Il test a banco non poteva accorgersene: gira a phi=0, dove l'errore e' nullo.

   U.right = sin(phi) e U.up = cos(phi) identicamente, quindi l'atan2 e' esatto per
   qualunque inclinazione del supporto. Stessa convenzione di segno: positivo = destra. */
function leanFromUp(U, B) {
  return Math.atan2(vdot(U, B.right), vdot(U, B.up)) * 180 / Math.PI;
}

/* Beccheggio: positivo = muso in su. Non esisteva; arriva gratis dalla stessa terna. */
function pitchFromUp(U, B) {
  return Math.asin(Math.max(-1, Math.min(1, -vdot(U, B.fwd)))) * 180 / Math.PI;
}

/* Base ortonormale del frame moto espressa nel frame telefono.
   La calibrazione fissa l'asse UP reale (gravità a moto dritta e ferma): questo
   assorbe l'inclinazione del supporto, che altrimenti fa sanguinare l'accelerazione
   longitudinale in quella verticale e falsa la piega.
   fwd viene ortogonalizzato (Gram-Schmidt) rispetto a up; right = fwd × up. */
function axisVec(key) {
  const neg = key[0] === '-';
  const c = key[neg ? 1 : 0];
  const v = { x: 0, y: 0, z: 0 };
  v[c] = neg ? -1 : 1;
  return v;
}

function buildBasis(up, mount) {
  const U = vnorm(up);
  const m = mountDef(mount || state.mount);
  const nf = axisVec(m.lon); // forward nominale del montaggio (oggi '-z' per tutti)
  let F = {
    x: nf.x - vdot(nf, U) * U.x,
    y: nf.y - vdot(nf, U) * U.y,
    z: nf.z - vdot(nf, U) * U.z,
  };
  if (Math.hypot(F.x, F.y, F.z) < 1e-3) {
    // caso degenere: forward nominale quasi parallelo a up → ripiega sull'asse laterale
    const alt = axisVec(m.lat);
    F = { x: alt.x - vdot(alt, U) * U.x, y: alt.y - vdot(alt, U) * U.y, z: alt.z - vdot(alt, U) * U.z };
  }
  F = vnorm(F);
  /* right = up × fwd, non fwd × up: solo così il segno del laterale coincide con
     quello della tabella MOUNT già usata (e già validata su strada). Con l'altro
     ordine la barra "Laterale" e la colonna lat_accel_g del CSV si invertivano. */
  const R = vnorm(vcross(U, F));
  return { up: U, fwd: F, right: R };
}

/* Vettore a tre componenti tutte finite. Vive qui (algebra) perché la usano sia
   la pipe sensori sia la validazione della calibrazione salvata.
   `v.x != null` PRIMA di isFinite: isFinite(null) è true (Number(null) === 0), quindi
   un asse mancante — che la Generic Sensor API restituisce null quando il sensore non
   è attivo — passava il gate e veniva letto come uno zero VERO: direzione di gravità
   sbagliata di 45°, e in calibOk una base salvata con un componente null entrava in
   state.calib senza il toast di rifiuto. */
function finiteVec(v) {
  return !!(v && v.x != null && v.y != null && v.z != null
    && isFinite(v.x) && isFinite(v.y) && isFinite(v.z));
}

/* Coercizione numerica per valori che arrivano da IndexedDB o da file di terzi
   (stringhe, null, campi assenti). Serve dove un metodo numerico sta dentro una
   concatenazione: `(meta.distKm || 0).toFixed(2)` con distKm stringa lancia, e la
   stringa non viene mai assegnata — il pannello resta su "Caricamento…". */
function numOr0(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/* Compat: la calibrazione salvata in v1 era il solo vettore up. */
function calibBasis(c) {
  if (!c) return null;
  /* Una base è utilizzabile solo se è una terna di vettori FINITI: caricata col
     solo controllo `c.v === 2`, una voce manomessa o troncata entrava in
     state.calib e la piega usciva NaN in gauge e nel log (e con i campi assenti
     buildBasis lanciava su vnorm(undefined), uccidendo loadSettings all'avvio). */
  if (calibOk(c)) return c;
  if (c.up || c.fwd || c.right) return null;   // forma v2 ma vettori non finiti
  const up = c.up || c;                        // v1: solo il vettore up (x/y/z alla radice)
  return finiteVec(up) ? buildBasis(up) : null;
}
function calibOk(c) {
  if (!c) return false;
  /* Norma nulla = base degenere (vnorm la azzera e la piega esce NaN): finita non
     basta, deve anche essere non nulla. */
  const ok = v => finiteVec(v) && Math.hypot(v.x, v.y, v.z) > 1e-6;
  return ok(c.up) && ok(c.fwd) && ok(c.right);
}

