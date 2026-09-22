'use strict';
/* js/init.js: els, listener della UI e init(), estratti dallo <script> inline di
   index.html (così la CSP non ha più bisogno di 'unsafe-inline' per gli script).
   Ultimo file caricato: l'ultima riga avvia l'app. */

/* js/core.js: costanti, state/logAcc, mapping assi, algebra vettoriale, lean.
   Blocchi sotto rimossi allo split (vedi js/core.js): Stato, Mapping assi,
   Algebra vettoriale, Lean — il marker DOM qui sotto resta come separatore. */
/* ============================== Stato ==============================
   (spostato in js/core.js — step 1 dello split) */

/* ============================== DOM ============================== */
const $ = id => document.getElementById(id);
const els = {
  gpsDot: $('gpsDot'), gpsTxt: $('gpsTxt'), recBadge: $('recBadge'), topTime: $('topTime'),
  clock: $('clock'), speedLimit: $('speedLimit'), speedAlt: $('speedAlt'),
  btnLogTop: $('btnLogTop'), btnSettings: $('btnSettings'), settingsPanel: $('settingsPanel'),
  speedVal: $('speedVal'), leanVal: $('leanVal'), leanDir: $('leanDir'),
  maxLeanL: $('maxLeanL'), maxLeanR: $('maxLeanR'),
  latVal: $('latVal'), lonVal: $('lonVal'), vertVal: $('vertVal'),
  latBar: $('latBar'), lonBar: $('lonBar'), vertBar: $('vertBar'),
  statMaxSpeed: $('statMaxSpeed'), statDist: $('statDist'), statTime: $('statTime'),
  btnCalib: $('btnCalib'), btnFullscreen: $('btnFullscreen'), btnDemo: $('btnDemo'),
  mountSel: $('mountSel'), invertLean: $('invertLean'), wakeLockChk: $('wakeLockChk'),
  calibStatus: $('calibStatus'), permBtn: $('permBtn'), gauge: $('gauge'),
  map: $('map'), mapCanvas: $('mapCanvas'),
  chSpeed: $('chSpeed'), chLean: $('chLean'), chLat: $('chLat'), chSpeedMax: $('chSpeedMax'),
  sessionList: $('sessionList'), sessionDetail: $('sessionDetail'),
  btnExportCsv: $('btnExportCsv'), btnExportGpx: $('btnExportGpx'), btnExportCsvHist: $('btnExportCsvHist'),
  btnBackupSess: $('btnBackupSess'), btnRestoreSess: $('btnRestoreSess'), sessFile: $('sessFile'), histTotals: $('histTotals'), histStorage: $('histStorage'),
  camAlert: $('camAlert'), camAlertsChk: $('camAlerts'), camDistSel: $('camDist'), btnMapFull: $('btnMapFull'),
  mapHud: $('mapHud'), mhLeanVal: $('mhLeanVal'), mhLeanDir: $('mhLeanDir'),
  mhMaxL: $('mhMaxL'), mhMaxR: $('mhMaxR'), mhSpeedVal: $('mhSpeedVal'), mhLimit: $('mhLimit'),
  mhDist: $('mhDist'), mhRec: $('mhRec'), mhGps: $('mhGps'), mhPitch: $('mhPitch'),
  mhClock: $('mhClock'), mhKin: $('mhKin'),
  mhArcL: $('mhArcL'), mhArcR: $('mhArcR'), mhPeakL: $('mhPeakL'), mhPeakR: $('mhPeakR'),
  camRadiusSel: $('camRadius'), camDot: $('camDot'), camTxt: $('camTxt'),
  navBanner: $('navBanner'), navQuery: $('navQuery'), navResults: $('navResults'),
  navDestTxt: $('navDestTxt'), navStatusTxt: $('navStatusTxt'), navSteps: $('navSteps'),
  navSumDist: $('navSumDist'), navSumTime: $('navSumTime'), navSumEta: $('navSumEta'),
  btnNavGo: $('btnNavGo'), btnNavStop: $('btnNavStop'), btnNavClear: $('btnNavClear'),
  btnNavFromMap: $('btnNavFromMap'), btnNavFromHist: $('btnNavFromHist'),
  btnNavGpx: $('btnNavGpx'), navGpxFile: $('navGpxFile'), btnNavVia: $('btnNavVia'),
  btnNavSim: $('btnNavSim'), btnNavSimOff: $('btnNavSimOff'), btnNavSimDev: $('btnNavSimDev'),
  navSimSpeed: $('navSimSpeed'),
  navGenKm: $('navGenKm'), navGenLoop: $('navGenLoop'), navGenCurves: $('navGenCurves'),
  navGenType: $('navGenType'), navGenDir: $('navGenDir'), navGenTxt: $('navGenTxt'),
  btnNavGen: $('btnNavGen'), btnNavGenAgain: $('btnNavGenAgain'), btnNavGenStop: $('btnNavGenStop'),
  navVoice: $('navVoice'), navNoHw: $('navNoHw'), navNoToll: $('navNoToll'),
  navBackroads: $('navBackroads'), navNoFerry: $('navNoFerry'),
  btnImportCam: $('btnImportCam'), camFile: $('camFile'), btnViewer: $('btnViewer'),
  videoModal: $('videoModal'), videoRes: $('videoRes'), videoSpeed: $('videoSpeed'), videoType: $('videoType'),
  videoStyle: $('videoStyle'), videoBuildings: $('videoBuildings'),
  videoFormat: $('videoFormat'), videoAudio: $('videoAudio'),
  videoProg: $('videoProg'), videoStatus: $('videoStatus'),
  videoStart: $('videoStart'), videoCancel: $('videoCancel'),
  videoCard: $('videoCard'), videoCardFmt: $('videoCardFmt'), videoCardPrevWrap: $('videoCardPrevWrap'),
  videoCardPrev: $('videoCardPrev'), videoCardShare: $('videoCardShare'),
  videoCardDl: $('videoCardDl'),
  btnCenter: $('btnCenter'), btnFollow: $('btnFollow'), btnTrackUp: $('btnTrackUp'), btnNavMute: $('btnNavMute'), compassOffsetSel: $('compassOffset'),
  gyroFusion: $('gyroFusion'), camAheadChk: $('camAhead'),
  gravityModeSel: $('gravityModeSel'), rectNull: $('rectNull'),
  guidaAlwaysChk: $('guidaAlways'),
  toasts: $('toasts'), secWarn: $('secWarn'), mapBox: document.querySelector('.map-box'),
  leanConf: $('leanConf'), leanConfFill: $('leanConfFill'), leanConfTxt: $('leanConfTxt'),
  diagVerdict: $('diagVerdict'),
  diagPanel: $('diagPanel'), dgHz: $('dgHz'), dgVib: $('dgVib'), dgNorm: $('dgNorm'),
  dgK: $('dgK'), dgBias: $('dgBias'), dgLean: $('dgLean'),
  dgAcc: $('dgAcc'), dgAccGps: $('dgAccGps'), dgAccBias: $('dgAccBias'), dgGrav: $('dgGrav'),
  dgSrc: $('dgSrc'), dgRef: $('dgRef'), dgPitch: $('dgPitch'), dgLeanKin: $('dgLeanKin'),
  dgSpeed: $('dgSpeed'), dgSign: $('dgSign'), dgVibHi: $('dgVibHi'),
  dgAdapt: $('dgAdapt'), dgRect: $('dgRect'),
  btnBench: $('btnBench'), benchOut: $('benchOut'),
  themeSel: $('themeSel'), metaTheme: $('metaTheme'),
};

/* ============================== Toast (non bloccanti) ============================== */
/* js/ui-core.js: toast */

/* Conferma non bloccante: risolve true/false senza congelare il rendering. */
/* js/ui-core.js: confirmToast */

/* ============================== Gauge SVG ==============================
   Colori via classi CSS (non piu' esadecimali nel JS): cosi' il tema chiaro/scuro
   li cambia da solo. Il numero della piega sta DENTRO il quadrante, come elemento
   SVG, e restano due marker sull'arco per il picco di piega destra/sinistra. */
/* js/ui-core.js: buildGauge */

/* Posiziona i marker di picco sull'arco. angolo 0 = dritto, positivo = destra. */
/* js/ui-core.js: setPeaks */

/* js/ui-core.js: setNeedle */

/* js/storage.js: store (wrapper localStorage) */

/* js/ui-core.js: loadSettings */
/* js/ui-core.js: saveSettings */
/* js/ui-core.js: updateCalibStatus */

/* Tema: dark/light/auto. "auto" viene risolto qui in dark o light, così il CSS non
   duplica i token in una media query. Il cambio invalida anche i colori dei canvas. */
/* js/ui-core.js: applyTheme */

/* ============================== Sensori ============================== */
/* js/inputs.js: accIncG */
/* js/inputs.js: linearAccel */

/* La stima di gravita' per passa-basso non esiste piu'.

   Il percorso precedente inseguiva la gravita' con un passa-basso (tau 5 s) e la
   CONGELAVA durante le manovre rettilinee, con una lunga catena di soglie
   (GRAV_TAU_S / GRAV_FAST_N / GRAV_FREEZE_G / GRAV_FREEZE_ROLL_DPS). Aveva un caso
   patologico: sopra ~30 gradi di piega il residuo verticale g*(1/cos(phi)-1) supera
   da solo la soglia di freeze, quindi in curva la stima restava congelata li' in
   permanenza.
   Adesso la gravita' viene, in ordine di preferenza:
     1. dalla fusione di piattaforma (GravitySensor / LinearAccelerationSensor, che su
        Android sono sensori compositi assistiti dal giroscopio);
     2. dalla soluzione di attitudine, g*u per costruzione.
   Vedi processSample. */

/* Reiezione dell'impulso ISOLATO.

   Qui non va bene né una mediana mobile né un filtro di Hampel: su queste tre
   grandezze un colpo secco è segnale, non rumore. Hampel in particolare fallisce
   perché la soglia è k·MAD e su una baseline quieta il MAD collassa — misurato: un
   colpo vero da [0,9 / 1,4 / 1,2] g veniva riscritto in [0,11 / 0,11 / 0,12] g.

   Il discriminante giusto è la DURATA, non l'ampiezza. Un evento fisico (buca,
   giunto) dura 20–50 ms, cioè 2–3 campioni a 60 Hz; un glitch di sensore dura un
   campione solo e i suoi vicini restano simili tra loro. Si valuta quindi il
   campione centrale di una finestra di 3: costa un campione di ritardo (~17 ms). */
/* js/sensors-core.js: despike */
/* js/sensors-core.js: clampG */

/* js/calib.js: CALIB_*, start/collect/finishCalibration, startAccBiasCapture/collectAccBias */
/* js/accel-fusion.js: updateAccelFusion, updateGpsAccel, medianWindow, pushAccHist, medianAcc, updateVibration */
/* js/sensors-core.js: clamp01 */

/* ====================== Velocita' fusa inerziale + GPS ======================

   Il GPS Doppler e' accurato ma lento (1 Hz) e RITARDATO (~0,5-1 s), e il codice
   precedente ci sommava sopra una EMA con tau ~0,43 s. Il risultato serviva solo al
   tachimetro, dove il ritardo non si nota. Adesso serve anche alla compensazione
   centripeta, dove entra come errore diretto: delta_phi = delta_v * psi_punto / g,
   cioe' 1,3 gradi ogni 0,5 m/s a 25 gradi/s di imbardata.

   Filtro complementare: l'accelerometro longitudinale fornisce la dinamica (nessun
   ritardo), il GPS la ancora in banda bassa. Il ritardo del GPS viene compensato
   confrontando il fix con una copia RITARDATA della stima, non con quella corrente:
   senza questo accorgimento la stima erediterebbe il ritardo che deve togliere. */
/* js/sensors-core.js: pushSpeedHist */
/* js/sensors-core.js: aIntAt */

/* js/sensors-core.js: propagateSpeed */

/* js/sensors-core.js: correctSpeed */

/* ====================== Attitudine (Mahony ridotto) ======================

   Il filtro precedente integrava UN solo scalare: il rateo di rollio proiettato
   sull'asse longitudinale, trattato come se fosse phi_punto. La cinematica esatta e'
       phi_punto = p + psi_punto * sin(theta)
   quindi su strada in pendenza mancava un termine di prim'ordine: a 25 gradi/s di
   imbardata con 10 gradi di pendenza sono 21,7 gradi su una curva di 5 s, con segno
   sistematico (in salita la piega collassa verso lo zero in entrambi i versi).
   Il "~13 gradi persi in 8 s" annotato nel codice corrispondeva a theta ~4 gradi:
   non era deriva del giroscopio, era questo.

   Qui si propaga il VETTORE gravita' con la cinematica esatta
       du/dt = -omega x u
   che non ha singolarita' di Eulero e non ha bisogno di quaternioni: omega, u e la
   base calibrata B sono gia' tutti in coordinate telefono, quindi nessuna conversione
   di frame. La piega si estrae solo alla fine, e il beccheggio viene gratis.

   Il bias e' VETTORIALE. Lo scalare precedente poteva assorbire solo la componente
   lungo B.fwd, ma e' la componente lungo B.up (imbardata) a fissare l'accuratezza
   della compensazione centripeta: delta_phi = v * delta_omega_up / g. */
/* js/sensors-core.js: attitudeReference */

/* js/sensors-core.js: updateAttitude */

/* js/sensors-core.js: updateGyroSign */

/* Azzera filtri e stime dipendenti dalla base calibrata: dopo un cambio di
   calibrazione o di montaggio la proiezione del giroscopio cambia, quindi un bias
   stimato prima non è più valido. */
/* js/sensors-pipe.js: resetSensorFilters */

/* Un campione normalizzato, indipendente dalla sorgente:
     acc  forza specifica (m/s^2, assi device, gravita' inclusa)
     gyro velocita' angolare (deg/s, assi device, destrorsa) oppure null
     grav gravita' dalla fusione di piattaforma (m/s^2) oppure null
     lin  accelerazione lineare dalla fusione di piattaforma (m/s^2) oppure null
     t    tempo di CAMPIONAMENTO in ms sull'orologio performance.now() */
/* js/sensors-pipe.js: processSample */

/* Adattatore devicemotion -> campione normalizzato (iOS/Safari, Firefox, fallback). */
/* js/inputs.js: onDeviceMotion */

/* js/inputs.js: onDeviceOrientation */

/* js/inputs.js: onGeolocation */

/* js/inputs.js: onGeolocationErr */

/* Stato dei dati autovelox. Prima, un errore Overpass o l'uscita dal cerchio scaricato
   erano del tutto silenziosi: l'app smetteva di poter avvisare senza dirlo. Su un'app
   antiautovelox il fallimento muto e' il caso peggiore. Indipendente da state.camAlerts:
   i marker si disegnano comunque, quindi sapere che sono incompleti serve lo stesso. */
/* js/ui-core.js: updateCamStatus */

/* js/ui-core.js: updateGpsStatus */

/* js/geo.js: haversine, haversineM */

/* js/sensor-src.js: setupSensors *//* js/sensor-src.js: sensorSrc *//* js/sensor-src.js: stopGenericSensors */

/* js/sensor-src.js: startGenericSensors */

/* js/sensor-src.js: startDeviceMotion */

/* js/sensor-src.js: addListeners */

/* Senza secure context geolocation e sensori falliscono in silenzio: meglio dirlo. */
/* js/sensor-src.js: checkSecureContext */

/* ============================== Traccia GPS ============================== */
/* js/cam-map.js: appendTrackPoint */

/* ============================== Avvisi autovelox (OSM/Overpass) ============================== */
/* js/geo.js: camKey, cellKey, camPrecompute (allCameras/camMarkerRadius/camMoveThreshold restano inline: leggono state) */
/* js/cam-map.js: allCameras */

/* Raggi derivati da state.camRadius: letti da quattro punti diversi, quindi vivono in
   una funzione sola per non poter divergere. *//* js/cam-map.js: camMarkerRadius *//* js/cam-map.js: camMoveThreshold *//* js/cam-map.js: rebuildCamGrid */
/* js/cam-map.js: camsNear */

/* js/geo.js: bearing, angleDiff */

/* js/cam-map.js: loadCachedCameras */

/* Mirror gia' autorizzati sia dalla CSP sia dal service worker. */
/* js/cam-map.js: renderCams-block */

/* js/cam-map.js: renderCameras */

/* js/cam-map.js: trackUpHeading */

/* js/cam-map.js: setFollow */

/* js/cam-map.js: applyMapRotation */

/* js/cam-map.js: setTrackUp */

/* js/cam-map.js: centerMap */

/* js/cam-map.js: pruneCamCooldown */

/* js/cam-map.js: camAlertTimer */

/* js/cam-map.js: alertCamera */

/* js/cam-map.js: audioCtx */

/* js/cam-map.js: ensureAudio */

/* js/cam-map.js: beep */

/* js/cam-map.js: importCamerasFile */
/* Migrazione: le camere importate in localStorage passano a IndexedDB. */
/* js/misc.js: loadImportedCameras */

/* ============================== Navigatore (Valhalla) ============================== */
/* Percorso da valhalla1.openstreetmap.de (istanza pubblica FOSSGIS, nessuna chiave).
   Vincoli che hanno deciso il design di questo blocco:
   - la shape e' una polyline a 6 decimali, NON 5: con il divisore sbagliato le
     coordinate finiscono a un decimo e la mappa disegna il vuoto senza un errore;
   - il server accetta 1 richiesta/secondo per utente, quindi routing e geocoding
     condividono una sola coda serializzata (navGate);
   - `maneuver[k]` descrive la svolta che avviene a shape[begin_shape_index[k]]:
     mentre si percorre k, quella da annunciare e' la k+1. */

/* js/nav-config.js: NAV-consts */
/* js/geo.js: NAV_BANDS, distM */

/* ---- coda globale: una sola richiesta ogni NAV_API_GAP_MS verso Valhalla/Photon.
   Senza, un ricalcolo e un geocoding concorrenti si fanno 429 a vicenda. ---- */
/* js/nav-config.js: navGate-state *//* js/nav-config.js: navGate */

/* js/misc.js: navBuild */

/* js/nav-map.js: navReset */

/* ---- sintesi vocale ----
   speak() ACCODA, non interrompe: due annunci ravvicinati si sovrappongono. Un annuncio
   a bassa priorita' che arriva in ritardo e' peggio del silenzio (un "adesso gira"
   accodato dietro una frase lunga arriva a curva fatta), quindi si scarta invece di
   accodare, e si cancella solo per priorita' alta. */
/* js/nav-map.js: navSpeak-state */

/* Android Chrome tronca la sintesi dopo ~15 s: heartbeat mentre sta parlando. */
/* js/nav-map.js: navSpeak-heartbeat */

/* Un solo punto di verita' per la voce: il pulsante sulla mappa e la casella nelle
   impostazioni scrivono entrambi qui, cosi' non possono mostrare stati diversi. */
/* js/nav-ui.js: setNavVoice */

/* js/nav-ui.js: navShortCue */

/* js/nav-ui.js: navAnnounce */

/* ---- il tick per fix GPS ----
   Ordine non permutabile: proietta -> valuta fuori percorso (con il nextMan VECCHIO)
   -> avanza -> distanze -> voce -> persist. Valutare il fuori percorso dopo
   l'avanzamento fa risultare "superata" la manovra mancata, e il rilevatore B
   non scatta mai. */
/* js/nav-engine.js: navTick */

/* Freni sul ricalcolo. Il gate globale a 1,1 s copre il limite del server; qui si
   evita di chiedere una rotta nuova per un errore GPS o per una deviazione voluta. */
/* js/nav-engine.js: navMaybeReroute */

/* js/osrm-text.js: OSRM_MOD_IT/ORD_IT, osrmType, osrmText, osrmIdxOf, navFromOsrm (navTryOsrm resta inline: rete) */
/* js/nav-net.js: navTryOsrm */

/* Wrapper: navRequestRoute e' chiamata senza await da quattro punti. Un'eccezione al
   suo interno diventerebbe una unhandled rejection e lascerebbe la riga di stato ferma
   su "Calcolo percorso...", senza dire niente. Qui si trasforma sempre in un messaggio. */
/* js/nav-net.js: navRequestRouteSafe */

/* ---- richiesta del percorso ----
   GET con ?json=, non POST: e' una richiesta semplice (nessun header custom, nessun
   Content-Type) e quindi non fa scattare il preflight CORS. */
/* js/nav-net.js: navCostingOptions */

/* js/net-base.js: ROUTE/GEO_CACHE_TTL, routeCacheKey, geoCacheKey, cacheGetFresh, cachePut */
/* js/nav-net.js: geoCachePrune */

/* js/nav-net.js: navRequestRoute */

/* ---- geocoding (Photon) ---- */
/* js/nav-net.js: navGeocode */

/* js/parse.js: navParseCoords */

/* ---- UI ---- */
/* js/nav-map.js: navSetStatus */

/* js/nav-ui.js: NAV_ICON */
/* ---- disegno su mappa ----
   Layer separato: updateLeaflet tocca solo mapPoly/mapPos per nome e renderCameras
   fa clearLayers() solo su camLayer, quindi questo non viene mai toccato da nessuno. *//* js/nav-map.js: navDrawRoute */

/* js/nav-map.js: navFitRoute */
/* Traccia della rotta per il canvas di riserva, sottocampionata: il canvas ridisegna
   a ogni fix e mille segmenti per frame non servono a niente. */
/* js/nav-config.js: navRouteForCanvas */

/* ---- persistenza ----
   Due record: la rotta si scrive una volta per versione, il progresso e' throttlato.
   Si salva la STRINGA polyline, non i typed array: pesano il triplo e si ricostruiscono
   in una decina di millisecondi. */
/* js/nav-config.js: navPersistRoute */

/* js/nav-config.js: navProgT-state *//* js/nav-config.js: navPersistProgress */
/* js/nav-config.js: navProgLastMan-state */
/* Il ripristino non e' cieco: riprendere nextMan cosi' com'e' fa annunciare, appena
   riaperta l'app, una svolta che e' venti chilometri alle spalle. */
/* js/nav-config.js: navRestore */

/* Avvio/ripresa: si riaggancia con un full scan e si passa ad ACTIVE solo dopo. */
/* js/nav-config.js: navStart */

/* js/nav-config.js: navStop */

/* ---- simulatore ----
   Percorre la shape generando posizioni finte a 1 Hz e alimenta esattamente lo stesso
   codice dei fix veri. Senza, questa funzione non e' provabile senza salire in moto. */
/* js/nav-config.js: navSim-state *//* js/nav-config.js: navSimStop *//* js/nav-config.js: navSimStart */

/* ============================== Wake lock / Fullscreen ============================== */
/* js/misc.js: requestWakeLock */
/* js/misc.js: releaseWakeLock */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
/* js/log-session.js: toggleFullscreen */

/* ============================== Logging ============================== */
/* js/log-session.js: lastSampleWall-state */

/* Media dei campioni sensore arrivati dall'ultimo tick, poi azzera l'accumulatore.
   È il filtro anti-alias della decimazione 60→20 Hz: prendere l'istantanea a 20 Hz
   ripiegava il contenuto sopra i 10 Hz dentro la banda del log. */
/* js/net-base.js: takeLogAvg */
/* js/log-core.js: snapshot */

/* Il campionamento sta su un timer reale, non su requestAnimationFrame: a 30 fps
   rAF dava 15 Hz spacciandoli per 20, e si fermava del tutto a schermo spento. */
/* js/log-core.js: sampleTick */
/* js/log-session.js: startLog */

/* js/log-session.js: stopLog */

/* js/log-session.js: setLogButton */

/* Flush incrementale su IndexedDB.
   Prima: JSON.stringify dell'intero array in localStorage ogni 10 s → saturava la
   quota da 5 MB dopo ~23 minuti, con QuotaExceededError inghiottito, e produceva
   un hitch visibile a ogni flush. Ora si scrive solo il delta. */
/* js/log-core.js: flushLog */

/* ============================== Export CSV / GPX ============================== */
/* js/video.js: downloadBlob */

/* js/parse.js: stamp */

/* js/csv.js: CSV_HEADER, csvMeta, num, csvRows, buildCsv, buildGpx */
/* js/video.js: exportCsv */

/* js/log-session.js: buildGpx */
/* js/video.js: exportGpx */

/* ============================== Export video (render da sessione) ==============================
   Render postumo: si disegna il cruscotto su un canvas fuori schermo e lo si cattura
   con canvas.captureStream + MediaRecorder → WebM. Niente server, niente ffmpeg.
   MediaRecorder registra in tempo reale: un giro da 10 min richiede 10 min a 1×;
   il moltiplicatore 2×/4× accorcia il render (il video risulta accelerato). */

/* js/parse.js: findRowAt */

/* Colore dai CSS var del tema (--accent, --good, --c-bg, --acc-lat, …). */
/* videoColor ora delega a canvasTheme (unica cache colori, invalidata da
   applyTheme): niente doppia cache dello stesso concetto. Accetta nomi sia
   con sia senza prefisso 'c-' ('accent' -> 'c-accent'). */
/* js/video.js: videoColor */
/* js/video.js: resetVideoColors */
/* js/video.js: let videoJob = null; */
/* js/video.js: pickVideoMime */

/* js/video.js: openVideoModal */

/* js/video.js: closeVideoModal */

/* js/video.js: startVideoRender */

/* Canvas offscreen (nel DOM ma fuori schermo): captureStream su un canvas mai
   inserito nel DOM può non produrre frame su Chrome/Android. */
/* js/video.js: makeVideoCanvas */

/* js/video.js: startVideoRender2D */

/* Registrazione + loop condivisi da 2D e 3D. */
/* js/video.js: beginVideoCapture */

/* js/video.js: cleanupVideoJob */

/* js/video.js: videoLoop */

/* js/video.js: stopVideoRender */

/* js/video.js: drawVideoFrame2D */

/* js/video.js: drawVideoMap */

/* js/video.js: drawVideoDash */

/* js/draw.js: drawLeanArc, hudFont, hudPanel, hudText, hudCang, runningExtremes,
   leanScaleFor, leanGaugeModel, hudGdot, rectsOverlap, hudMotoBox, hudLayout */

/* js/draw.js: drawAccBar */

/* js/video.js: drawVideoSpark */

/* Dispatch frame: 2D o 3D in base alla modalità. */
/* js/video.js: drawVideoFrame */

/* ============================== Render 3D (MapLibre + moto) ============================== */

/* js/video3d.js: loadVideo3DScript */

/* js/video3d.js: ensureVideo3DLibs */

/* js/video3d.js: fallbackTo2D */

/* js/video3d.js: startVideoRender3D */

/* js/video3d.js: initVideoRender3D */

/* js/video3d.js: buildCameraKeyframes, videoBearingSeries, videoSmoothBearings,
   videoPathSampleAt, videoTrackPosForRow, videoDamp, videoDampAngle,
   videoMapOptions, videoMapPixelRatio, videoSkyOptions, videoSkyVisible,
   videoTrackGeoJson, videoTrailRange, videoTrackAddToMap, videoTrackAdvance,
   videoExtremesForJob, videoCamHeightFor, videoZoomForHeight, videoSatProbe,
   videoCamAltFor, videoLeanColor, videoLeanColorExpr, videoTrackSegGeoJson,
   videoSegLeansFor */

/* js/video3d.js: initVideoMoto3D */

/* js/video3d.js: drawVideoFrame3D */

/* js/draw.js: rrPath */
/* js/video3d.js: drawVideoHUD3D */

/* js/storage.js: idb (wrapper IndexedDB: sessions/meta/logchunks/kv) */

/* js/map.js: saveSession */

/* Recupero dopo crash/refresh: i chunk della sessione interrotta vengono ricomposti
   e proposti all'utente. Prima 'cruscotto.log' veniva scritto ma non riletto da
   nessuno, quindi la promessa "sopravvive a un refresh" non era mantenuta. */
/* js/map.js: recoverChunks */

/* js/parse.js: fmtDur */

/* js/misc.js: renderHistory */

/* Le righe si caricano solo qui, su richiesta: l'elenco resta leggero. */
/* js/misc.js: openSessionDetail */

/* js/map.js: showSessionDetail */

/* ============================== Mappa ============================== */
/* js/map.js: initMap */

/* js/map.js: initLeaflet */

/* js/map.js: lastCamRender-state */
/* js/map.js: updateLeaflet */

/* js/map.js: initCanvasMap */

/* js/map.js: drawCanvasMap */

/* js/map.js: updateMap */

/* Disegna traccia su un canvas 2D (usato da fallback mappa + replay storico) */
/* js/map.js: drawTrackOnCanvas */

/* ============================== Grafici ============================== */
/* I canvas non leggono le variabili CSS: i colori si leggono una volta da
   getComputedStyle e si invalidano al cambio tema (vedi applyTheme). */
/* js/map.js: canvasTheme-state */

/* js/diag.js: sampleCharts */

/* js/diag.js: drawChart */

/* js/diag.js: drawCharts */

/* ============================== Diagnostica vibrazioni ============================== */
/* js/diag.js: avg-state */
/* js/diag.js: updateDiag */

/* js/diag.js: bench-state */
/* js/diag.js: startBench */

/* La piega vera è 0° per costruzione (moto dritta sul cavalletto): ogni scostamento
   è errore, quindi il test è ripetibile e confrontabile tra regimi motore diversi. */
/* js/diag.js: finishBench */

/* ============================== Tabs ============================== */
/* js/display.js: switchTab */

/* ============================== Demo ============================== */
/* js/display.js: demo-state *//* js/display.js: tickDemo */

/* ============================== Loop display ============================== */
// textContent è un setter costoso (layout/style): scrive solo se il testo cambia.
/* js/display.js: setTxt */
/* js/display.js: updateDisplay */

/* js/display.js: setBar */

/* js/display.js: mainLoop */

/* ============================== Init ============================== */
function init() {
  // Errori imprevisti non devono restare silenziosi in moto: un TypeError nel
  // wiring (id di markup disallineato) prima congelava il cruscotto senza alcun
  // messaggio visibile.
  window.addEventListener('error', ev => {
    try { toast('Errore app: ' + (ev && ev.message ? ev.message : 'sconosciuto'), 'err', 8000); } catch (e) {}
  });
  window.addEventListener('unhandledrejection', ev => {
    const m = ev && ev.reason && (ev.reason.message || ev.reason);
    try { toast('Errore app: ' + (m || 'promise rifiutata'), 'err', 8000); } catch (e) {}
  });

  loadSettings();
  navSpeak.init();
  maybeAskCamLegal();

  // I sottosistemi vitali partono SUBITO e ciascuno in modo indipendente: un
  // errore nel wiring di una sezione successiva (card PNG, navigatore, ecc.)
  // non deve più impedire l'avvio di GPS, sensori e del loop principale.
  try { checkSecureContext(); } catch (e) {}
  try { initMap(); } catch (e) {}
  try { setupSensors(); } catch (e) {}
  try { requestWakeLock(); } catch (e) {}
  try { requestAnimationFrame(mainLoop); } catch (e) {}

  buildGauge();
  applyTheme();
  updateCalibStatus();

  els.btnCalib.addEventListener('click', () => {
    startCalibration();
  });

  els.btnLogTop.addEventListener('click', () => state.logging ? stopLog() : startLog());
  els.btnExportCsv.addEventListener('click', () => {
    if (!state.rows.length) { toast('Nessun dato. Avvia un log.', 'err'); return; }
    const meta = { startISO: new Date(state.session.startWall || Date.now()).toISOString(), maxSpeed: state.session.maxSpeed, maxLeanR: state.session.maxLeanR, maxLeanL: state.session.maxLeanL, distKm: state.session.distKm };
    exportCsv(state.rows, meta, 'sessione');
  });
  els.btnExportGpx.addEventListener('click', () => exportGpx(state.track, 'sessione'));
  els.btnExportCsvHist.addEventListener('click', async () => {
    /* Export storico in streaming: una sessione per volta, parti di stringa passate
       a Blob. Prima un flatMap caricava tutte le righe di tutte le sessioni in RAM
       e le concatenava in un'unica stringa gigante. */
    let ids = [];
    try { ids = await idb.keys(); } catch (e) {}
    if (!ids.length) { toast('Nessuna sessione storica.', 'err'); return; }
    const t = toast('Export in corso…', null, 60000);
    const parts = [];
    let total = 0, first = true;
    for (const id of ids) {
      let s = null;
      try { s = await idb.get(id); } catch (e) { continue; }
      if (!s || !s.rows || !s.rows.length) continue;
      if (first) { parts.push(csvMeta(s.meta || {}) + '\n' + CSV_HEADER + '\n'); first = false; }
      parts.push('# --- sessione ' + (s.meta ? s.meta.startISO : id) + ' ---\n');
      parts.push(csvRows(s.rows) + '\n');
      total += s.rows.length;
    }
    t.remove();
    if (!total) { toast('Nessun dato nelle sessioni.', 'err'); return; }
    downloadBlob('cruscotto_storico_tutti_' + stamp() + '.csv', parts, 'text/csv;charset=utf-8');
    toast('Esportate ' + total + ' righe.', 'ok');
  });

  els.videoStart.addEventListener('click', () => {
    const s = els.videoModal._session;
    if (s) startVideoRender(s);
  });
  els.videoCancel.addEventListener('click', () => {
    stopVideoRender();
    closeVideoModal();
  });
  // Card PNG: anteprima <img blob:> (la CSP accetta img blob:), poi share/download.
  // Suffisso formato nel filename: 4x5 / 1x1 / 9x16 (l'archivio resta ordinabile).
  const cardFmtSuffix = () => ({ portrait: '4x5', square: '1x1', story: '9x16' }[(els.videoCardFmt || {}).value] || '4x5');
  const genVideoCard = () => {
    const s = els.videoModal._session;
    if (!s) return;
    const fmt = (els.videoCardFmt || {}).value || 'portrait';
    makeShareCard(s, (url, blob) => {
      if (!url) { toast('Card non generata: nessun dato.', 'err'); return; }
      if (els.videoCardPrev.src && els.videoCardPrev.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(els.videoCardPrev.src); } catch (e) {}
      }
      els.videoCardPrev.src = url;
      els.videoCardPrevWrap.hidden = false;
      els.videoCardPrevWrap._blob = blob;
    }, { format: fmt });
  };
  els.videoCard.addEventListener('click', genVideoCard);
  if (els.videoCardFmt) els.videoCardFmt.addEventListener('change', () => {
    if (!els.videoCardPrevWrap.hidden) genVideoCard();
  });
  els.videoCardDl.addEventListener('click', () => {
    const b = els.videoCardPrevWrap._blob;
    if (b) downloadBlob('cruscotto_card_' + cardFmtSuffix() + '_' + stamp() + '.png', b, 'image/png');
  });
  els.videoCardShare.addEventListener('click', async () => {
    const b = els.videoCardPrevWrap._blob;
    if (!b) return;
    const f = new File([b], 'cruscotto_card_' + cardFmtSuffix() + '.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: 'Cruscotto Moto' }); } catch (e) {}
    } else {
      downloadBlob('cruscotto_card_' + cardFmtSuffix() + '_' + stamp() + '.png', b, 'image/png');
      toast('Condivisione non supportata: PNG scaricato.', 'err');
    }
  });

  // Ingranaggio header: porta allo Storico e apre le Impostazioni (restano li',
  // ma raggiungibili con un tap invece di scroll + cerca-details).
  els.btnSettings.addEventListener('click', () => {
    switchTab('history');
    els.settingsPanel.open = true;
    setTimeout(() => { try { els.settingsPanel.scrollIntoView({ block: 'start' }); } catch (e) {} }, 60);
  });
  els.btnFullscreen.addEventListener('click', toggleFullscreen);
  els.btnDemo.addEventListener('click', () => {
    state.demo = !state.demo;
    demoStart = null;
    demoLast = null;
    els.btnDemo.classList.toggle('on', state.demo);
    els.btnDemo.textContent = state.demo ? 'Demo ON' : 'Demo';
    if (state.demo) {
      // In Demo i sensori reali e il GPS non servono a nessuno: si spengono
      // davvero (prima restavano accesi sotto, consumando batteria).
      try { if (typeof stopSensors === 'function') stopSensors(); } catch (e) {}
    } else {
      // Tornando ai dati reali i listener vanno riagganciati.
      try { if (typeof addListeners === 'function') addListeners(); } catch (e) {}
    }
    if (!state.demo) {
      // Ripristina la calibrazione reale: la Demo la sovrascriveva con un vettore
      // finto e non la rimetteva a posto, falsando la piega fino al reload.
      state.calib = state._calibBackup !== undefined ? state._calibBackup : state.calib;
      state._calibBackup = undefined;
      resetSensorFilters();
      state.gpsStatus = 'waiting';
      state.session.lastPos = null;
      state.cameras = [];
      rebuildCamGrid();
      updateCalibStatus();
      renderCameras();
    } else {
      state._calibBackup = state.calib;
      state.calib = buildBasis({ x: 1, y: 0, z: 0 });
      updateCalibStatus();
    }
  });

  els.themeSel.addEventListener('change', () => {
    state.theme = els.themeSel.value;
    saveSettings();
    applyTheme();
  });
  if (window.matchMedia) {
    /* "auto": insegue il tema di sistema mentre l'app è aperta. */
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (state.theme === 'auto') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* Ridimensionamento / rotazione: non esisteva. Leaflet va invalidato, i canvas
     dei grafici ridisegnati e i marker di picco ricalcolati alla nuova geometria. */
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (state.mapType === 'leaflet' && state.map) { state.map.invalidateSize(); applyMapRotation(); }
      else if (state.mapType === 'canvas') drawCanvasMap();
      if (state.currentTab === 'charts') drawCharts();
      else if (state.currentTab === 'history' && state._replayTrack) drawTrackOnCanvas($('replayCanvas'), state._replayTrack, { startEnd: true });
    }, 150);
  });
  window.addEventListener('orientationchange', () => {
    /* su iOS l'altezza reale arriva un attimo dopo l'evento */
    setTimeout(() => { if (state.mapType === 'leaflet' && state.map) state.map.invalidateSize(); }, 300);
  });

  els.mountSel.addEventListener('change', () => {
    /* mountKey e non il value crudo: state.mount è la chiave di MOUNT letta da
       calibrazione e loop sensori, e una <select> il cui value non combacia con
       nessuna option restituisce '' (chiave ignota → TypeError a ogni campione).
       Oggi le option sono esattamente le chiavi di MOUNT, ma è lo stesso
       validatore delle settings salvate: se le due liste divergono non si rompe. */
    state.mount = mountKey(els.mountSel.value);
    saveSettings();
    /* Il montaggio definisce il frame in cui si proiettano gli assi: cambiarlo può
       ribaltare il SEGNO di leanAcc a parita' di piega (stesso caso del toggle
       "inverti piega" qui sotto), e il punteggio accumulato nel frame vecchio
       resterebbe come evidenza per quello nuovo. resetSensorFilters azzera la
       baseline ma NON il punteggio: serve questo. */
    resetGyroSignLearner();
    // Cambiare montaggio invalida la base calibrata: meglio dirlo che lasciare
    // dati falsi con lo stato che continua a dire "calibrato".
    if (state.calib) {
      state.calib = null;
      resetSensorFilters();
      store.del('cruscotto.calib');
      updateCalibStatus();
      toast('Orientamento cambiato: rifai la calibrazione.', 'err', 5000);
    }
  });
  els.invertLean.addEventListener('change', () => {
    state.invertLean = els.invertLean.checked;
    /* Cambia il SEGNO di leanAcc a parita' di piega: la baseline dello stimatore
       del segno giroscopio (dLean = ΔleanAcc/dt) vedrebbe un salto che non e' una
       rotazione, e con la moto in piega a passo d'uomo un solo campione basta a
       fargli ribaltare un verdetto che poi viene scritto su localStorage. */
    resetGyroSignLearner();
    saveSettings();
  });
  els.gyroFusion.addEventListener('change', () => { state.gyroFusion = els.gyroFusion.checked; state._attU = null; saveSettings(); });
  els.gravityModeSel.addEventListener('change', () => {
    state.gravityMode = (els.gravityModeSel.value === 'native' || els.gravityModeSel.value === 'own')
      ? els.gravityModeSel.value : 'auto';
    saveSettings();
  });
  els.rectNull.addEventListener('change', () => { state.rectNull = els.rectNull.checked; saveSettings(); });
  els.camAheadChk.addEventListener('change', () => { state.camAhead = els.camAheadChk.checked; saveSettings(); });
  els.wakeLockChk.addEventListener('change', () => {
    state.wakeLockOn = els.wakeLockChk.checked;
    saveSettings();
    if (state.wakeLockOn) requestWakeLock(); else releaseWakeLock();
  });
  els.camAlertsChk.addEventListener('change', async () => {
    if (els.camAlertsChk.checked) {
      if (!state.camLegalOk) {
        const ok = await askCamLegal();
        if (!ok) return;
      }
      state.camAlerts = true;
    } else {
      state.camAlerts = false;
    }
    saveSettings();
  });
  els.guidaAlwaysChk.addEventListener('change', () => {
    state.guidaAlways = els.guidaAlwaysChk.checked;
    saveSettings();
    updateGuidaMode();
  });
  els.camDistSel.addEventListener('change', () => {
    /* camDistFrom e non parseInt crudo: le <option> possono divergere dalla lista
       validata (o restare vuote per un value non presente), e state.camDist finisce
       nella query autovelox. Stesso validatore delle settings salvate. */
    state.camDist = camDistFrom(els.camDistSel.value);
    saveSettings();
  });
  els.camRadiusSel.addEventListener('change', () => {
    const prev = state.camRadius;
    state.camRadius = parseInt(els.camRadiusSel.value, 10);
    saveSettings();
    if (state.camRadius > prev) {
      /* Allargando, la cache e' un sottoinsieme di quello che serve: va rifatta subito,
         altrimenti il raggio nuovo non si vedrebbe fino allo stale (15 min) o a mezzo
         raggio di viaggio, e la modifica sembrerebbe non aver fatto niente. */
      state.camTs = 0;
      state.camRetryAfter = 0; // la scelta esplicita dell'utente annulla il backoff
      const p = state.pos.lat != null ? state.pos : (state.gps.lat != null ? state.gps : null);
      if (p) fetchCameras(p.lat, p.lon); // senza fix ci pensa il prossimo maybeLoadCameras
    }
    // Restringendo, la cache e' un soprainsieme: basta ridisegnare, niente query.
    // La cache di camsToDraw tiene chiave ver+pos, non il raggio: senza
    // invalidazione il soprainsieme stantio resterebbe in scena fino al
    // prossimo movimento oltre soglia.
    state._camDraw = null;
    renderCameras();
    updateCamStatus();
  });
  els.compassOffsetSel.addEventListener('change', () => { state.compassOffset = parseInt(els.compassOffsetSel.value, 10); saveSettings(); });

  /* ---- navigatore ---- */
  /* navSearchSeq/navSearchT vivono in js/nav-ui.js: anche la selezione di un
     risultato (navRenderResults) deve poter annullare una risposta in volo. */
  // Sul documento: il fuoco entra nei risultati (#navResults e' fratello di #navQuery),
  // quindi un listener sul campo non riceve piu' i keydown da li'. navResultsKey filtra
  // sugli eventi nati nel campo o nella lista.
  document.addEventListener('keydown', navResultsKey);
  els.navQuery.addEventListener('input', () => {
    clearTimeout(navSearchT);
    const q = els.navQuery.value.trim();
    if (q.length < 3) { navSearchCancel(); navClearResults(); return; }
    const c = navParseCoords(q);
    if (c) {
      /* Il ramo coordinate non passa dal debounce: senza annullare la sequenza, una
         risposta Photon partita prima (es. "roma") atterrava ~450 ms dopo con
         my === navSearchSeq e sovrascriveva la riga di coordinate appena mostrata —
         si finiva per toccare la destinazione sbagliata. */
      navSearchCancel();
      navRenderResults([{ lat: c.lat, lon: c.lon, label: 'Coordinate', sub: c.lat.toFixed(5) + ', ' + c.lon.toFixed(5) }]);
      return;
    }
    // debounce: la policy di Photon e' "sii equo", non una richiesta per tasto premuto
    const my = ++navSearchSeq;
    navSearchT = setTimeout(async () => {
      try {
        const res = await navGeocode(q);
        if (my !== navSearchSeq) return; // risposta stale: l'utente ha già digitato altro
        navRenderResults(res);
      }
      catch (e) { if (my === navSearchSeq) navSetStatus('Ricerca non riuscita: ' + e.message); }
    }, 450);
  });
  els.btnNavGo.addEventListener('click', navStart);
  els.btnNavStop.addEventListener('click', navStop);
  els.btnNavClear.addEventListener('click', navStop);
  els.btnNavFromMap.addEventListener('click', () => {
    switchTab('map');
    toast('Tieni premuto un punto sulla mappa per sceglierlo come destinazione.', null, 5000);
  });
  els.btnNavFromHist.addEventListener('click', async () => {
    let sessions = [];
    try { sessions = await idb.getMetas(); } catch (e) {}
    sessions = sessions.filter(x => x && x.meta).sort((a, b) => (a.meta.startISO < b.meta.startISO ? 1 : -1)).slice(0, 6);
    if (!sessions.length) { toast('Nessun giro salvato.', 'err'); return; }
    const out = [];
    for (const x of sessions) {
      let full = null;
      try { full = await idb.get(x.id); } catch (e) {}
      const tr = full && full.track;
      if (!tr || !tr.length) continue;
      const d = new Date(x.meta.startISO);
      const lbl = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
      out.push({ lat: tr[0].lat, lon: tr[0].lon, label: 'Partenza ' + lbl, sub: 'giro del ' + lbl });
      out.push({ lat: tr[tr.length - 1].lat, lon: tr[tr.length - 1].lon, label: 'Arrivo ' + lbl, sub: 'giro del ' + lbl });
    }
    if (!out.length) { toast('I giri salvati non hanno traccia.', 'err'); return; }
    /* La lista si costruisce su piu' await (metadati, tracce): una ricerca Photon
       partita prima atterra qui in mezzo e la sua risposta, ancora "fresca" per
       numero d'ordine, veniva sostituita dai giri salvati — o li sostituiva. */
    navSearchCancel();
    navRenderResults(out);
  });
  els.btnNavGpx.addEventListener('click', () => els.navGpxFile.click());
  els.navGpxFile.addEventListener('change', () => {
    const f = els.navGpxFile.files && els.navGpxFile.files[0];
    els.navGpxFile.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const pts = parseGpx(reader.result);
      if (pts.length < 2) { toast('GPX senza punti validi.', 'err'); return; }
      state.gpxRoute = pts;
      const last = pts[pts.length - 1];
      navSetDest({ lat: last.lat, lon: last.lon, label: 'GPX (' + pts.length + ' punti)' });
      drawGpxRoute();
      toast('GPX importato: ' + pts.length + ' punti.', 'ok');
    };
    reader.readAsText(f);
  });
  els.btnNavVia.addEventListener('click', () => {
    const d = state.navDest;
    if (!d) { toast('Imposta prima la destinazione, poi spostala a tappa intermedia.', 'err'); return; }
    // Il motore ne gestisce quante ne arrivano (js/nav-net.js) e il generatore di
    // giri ne scrive fino a cinque; il tetto qui e' solo per il flusso manuale, dove
    // ogni tappa costa un giro di ricerca e piu' di qualcuna diventa ingestibile.
    if ((state.navVias || []).length >= NAV_VIA_MANUAL_MAX) {
      toast('Massimo ' + NAV_VIA_MANUAL_MAX + ' tappe intermedie a mano.', 'err'); return;
    }
    state.navVias = [...(state.navVias || []), d];
    state.navDest = null;
    if (els.navQuery) els.navQuery.value = '';
    navSearchCancel();       // come sopra: campo e lista svuotati a mano, ma debounce armato
    navClearResults();
    renderNavPanel();
    toast('Tappa impostata. Ora scegli la destinazione finale.', 'ok');
  });
  els.btnNavSim.addEventListener('click', navSimStart);
  els.btnNavSimOff.addEventListener('click', () => { navSimStop(); toast('Simulazione ferma.'); });
  els.btnNavSimDev.addEventListener('click', () => {
    if (!navSimTimer) { toast('Avvia prima la simulazione.', 'err'); return; }
    navSimDevia(); toast('Deviazione in corso…');
  });
  els.navVoice.addEventListener('change', () => setNavVoice(els.navVoice.checked, { user: true }));
  els.navNoHw.addEventListener('change', () => { state.navNoHw = els.navNoHw.checked; saveSettings(); });
  els.navNoToll.addEventListener('change', () => { state.navNoToll = els.navNoToll.checked; saveSettings(); });
  els.navBackroads.addEventListener('change', () => { state.navBackroads = els.navBackroads.checked; saveSettings(); });
  els.navNoFerry.addEventListener('change', () => { state.navNoFerry = els.navNoFerry.checked; saveSettings(); });

  /* Generatore di giri. I cinque <select> sono validati contro le stesse liste che
     usa loadSettings: una <option> aggiunta qui e non la' (o viceversa) deve cadere
     sul default, non finire in una formula. */
  els.navGenKm.addEventListener('change', () => {
    state.navGenKm = choiceOr(NAVGEN_KM_CHOICES, els.navGenKm.value, NAVGEN_KM_DEFAULT); saveSettings();
  });
  els.navGenLoop.addEventListener('change', () => {
    state.navGenLoop = els.navGenLoop.value === '1'; saveSettings();
  });
  els.navGenCurves.addEventListener('change', () => {
    state.navGenCurves = pickOr(NAVGEN_CURVE_CHOICES, els.navGenCurves.value, 'tante'); saveSettings();
  });
  els.navGenType.addEventListener('change', () => {
    state.navGenType = pickOr(NAVGEN_TYPE_CHOICES, els.navGenType.value, 'misto'); saveSettings();
  });
  els.navGenDir.addEventListener('change', () => {
    state.navGenDir = pickOr(NAVGEN_DIR_CHOICES, els.navGenDir.value, 'auto'); saveSettings();
  });
  els.btnNavGen.addEventListener('click', () => { navGenRun(false); });
  els.btnNavGenAgain.addEventListener('click', () => { navGenRun(true); });
  els.btnNavGenStop.addEventListener('click', navGenCancel);

  els.btnMapFull.addEventListener('click', () => {
    const full = document.body.classList.toggle('map-fullscreen');
    els.btnMapFull.textContent = full ? '✕' : '⛶';
    updateGuidaMode();
    updateMapHud(); // riempie l'HUD subito: updateDisplay arriverebbe fino a 67 ms dopo
    if (state.mapType === 'leaflet' && state.map) setTimeout(() => { state.map.invalidateSize(); applyMapRotation(); }, 60);
    else if (state.mapType === 'canvas') drawCanvasMap();
  });

  els.btnBench.addEventListener('click', startBench);

  els.btnBackupSess.addEventListener('click', () => backupSessions());
  els.btnRestoreSess.addEventListener('click', () => els.sessFile.click());
  els.sessFile.addEventListener('change', () => {
    const f = els.sessFile.files && els.sessFile.files[0];
    // Azzera il valore: senza, riscegliere lo stesso file non fa scattare change.
    els.sessFile.value = '';
    if (f) restoreSessions(f);
  });
  els.btnImportCam.addEventListener('click', () => els.camFile.click());
  els.btnViewer.addEventListener('click', () => window.open('viewer.html', '_blank', 'noopener'));
  els.camFile.addEventListener('change', () => {
    if (els.camFile.files && els.camFile.files[0]) importCamerasFile(els.camFile.files[0]);
    els.camFile.value = '';
  });

  els.btnCenter.addEventListener('click', centerMap);
  els.btnFollow.addEventListener('click', () => setFollow(!state.follow));
  els.btnFollow.classList.toggle('on', state.follow); // "segui" è attivo di default
  els.btnTrackUp.addEventListener('click', () => setTrackUp(!state.trackUp));
  els.btnNavMute.addEventListener('click', () => {
    setNavVoice(!state.navVoice, { user: true });
    toast(state.navVoice ? 'Indicazioni vocali attive' : 'Indicazioni vocali silenziate', null, 2000);
  });

  document.querySelectorAll('nav.tabbar button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // La sessione non parte al boot: cronometro e massimi restano fermi fino a Start.
  loadCachedCameras();
  idb.open().then(async () => {
    await loadImportedCameras();
    await renderHistory();
    await recoverChunks();
    await navRestore();   // dentro il .then(): fuori, _tx() rigetta con "DB non aperto"
    // Giri del formato vecchio → colonne, a boot finito e mai durante un log.
    setTimeout(() => { migrateRowsFormat(() => state.logging).catch(() => {}); }, 5000);
  }).catch(() => toast('Storico non disponibile (IndexedDB non accessibile).', 'err', 5000));

  // Flush opportunistico prima che il sistema possa scaricare la pagina.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.logging) flushLog();
  });
  window.addEventListener('pagehide', () => { if (state.logging) flushLog(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Aggiornamento senza sorprese in moto: il nuovo worker resta in "waiting"
      // finché non si è pronti. Se c'è un log attivo si rimanda a fine sessione.
      const promptUpdate = () => {
        if (!reg.waiting) return;
        if (state.logging) { state._swUpdatePending = true; return; }
        confirmToast('Nuova versione disponibile.').then(ok => {
          if (!ok) return;
          if (!reg.waiting) { location.reload(); return; }
          reg.waiting.postMessage('SKIP_WAITING');
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
        });
      };
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed') promptUpdate(); });
      });
      if (reg.waiting) promptUpdate();
    }).catch(() => {});
  }

  // Shortcut del manifest: ?tab=nav apre il navigatore, ?log=1 avvia il log
  // (dopo che i sensori sono partiti sopra, a init completata).
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('tab') === 'nav') switchTab('nav');
    if (q.get('log') === '1') startLog();
  } catch (e) {}
}

init();
