# Cruscotto Moto

Dashboard web per telemetria in moto: **velocità (GPS)**, **angolo di piega**, **accelerazioni** e **log CSV**. Si apre dal browser dello smartphone mentre guidi.

Tre file, nessuna build:

| file | ruolo |
|---|---|
| `index.html` | tutta l'app (UI + logica + stili) |
| `sw.js` | service worker: avvio offline, cache di Leaflet e delle tile già viste |
| `manifest.webmanifest` | installazione come app (icona in home, standalone) |

## Requisiti

- **Android + Chrome** (consigliato). Su iPhone funziona ma richiede HTTPS e un tap per concedere i permessi sensori.
- **HTTPS obbligatorio**: `Geolocation` e sensori (accelerometro/giroscopio) funzionano solo in *secure context*. La pagina va quindi servita via HTTPS, non aperta come file locale.
- **Supporto telefono rigido** sul manubrio: la piega letta dal telefono = piega moto solo se il telefono è solidale al telaio.

## Deploy (consigliato: GitHub Pages)

1. Crea una repo su GitHub e carica **tutti e tre** i file (`index.html`, `sw.js`, `manifest.webmanifest`) nella stessa cartella.
2. Repo → **Settings → Pages** → Source: branch `main`, cartella `/ (root)` → Save.
3. HTTPS è attivo automaticamente. Apri `https://<tuo-utente>.github.io/<repo>/` dal telefono.
4. Dal menu di Chrome, **Installa app** / **Aggiungi a schermata Home**: parte a schermo intero e funziona anche senza rete.

Alternative (entrambe HTTPS automatico):
- **Vercel**: `npx vercel` nella cartella, oppure drag-and-drop su vercel.com.
- **Netlify**: drag-and-drop della cartella su app.netlify.com.

> Il service worker si registra solo su HTTPS (o `localhost`). Senza di lui l'app resta
> funzionante ma perde l'avvio offline. Per pubblicare una versione nuova alza
> `CACHE_VERSION` in `sw.js`.

> ⚠️ NON aprire `file:///...index.html` direttamente dal telefono: i sensori non funzionano senza secure context.

## Utilizzo

1. Apri la pagina dal telefono, concedi la posizione quando richiesto.
2. **Impostazioni → Orientamento montaggio**: scegli come è montato il telefono (landscape top a sinistra / destra, o portrait).
3. **Calibrazione**: a moto **dritta e ferma su piano**, premi **Calibra**. Rifai la calibrazione se cambi supporto o orientamento.
4. **Start Log** per registrare, **Stop Log** per fermare, **Export CSV** per scaricare.
5. **⛶ Fullscreen** per la vista immersiva; lo schermo resta acceso (wake lock) se spuntato nelle impostazioni.
6. **Demo**: simula i dati (senza moto né sensori) per provare l'interfaccia e l'export — utile anche su desktop.

## Schede

L'app è organizzata in 4 schede (barra in basso): **Dashboard · Mappa · Grafici · Storico**.

- **Cambiare scheda NON interrompe il log**: la registrazione gira in un loop indipendente dalla vista. Il pulsante **Start/Stop** resta sempre nella barra in alto, insieme allo stato GPS, al badge ●REC e alla durata.

### Mappa
- Carica **Leaflet + OpenStreetMap** a runtime (da CDN). Mostra posizione corrente (punto + freccia heading) e traccia del percorso.
- **Fallback offline**: se il CDN non è raggiungibile, ripiega su un canvas che disegna la traccia senza basemappa (zero dipendenze).
- **Fullscreen mappa**: pulsante ⛶ in alto a destra sulla mappa → la mappa occupa tutto lo schermo (nasconde barra/tab). Ripremi ✕ per uscire.
- **Controlli mappa** (in alto a sinistra): 🎯 **Centra** (riporta sulla tua posizione), 🧭 **Segui** (attivo di default, si disattiva se trascini la mappa), ⬆️ **Bussola** (track-up: ruota la mappa nel verso di marcia).
- **Track-up** è realizzato ruotando il container via CSS, senza plugin esterni. Con la mappa ruotata il trascinamento avviene nel sistema di riferimento ruotato: se devi esplorare la mappa a mano, disattiva prima la bussola.
- L'heading viene dal GPS sopra ~11 km/h; sotto si usa la bussola magnetica del telefono (solo se il dispositivo espone un orientamento *assoluto*), regolabile con **Offset bussola**.

### Avvisi autovelox
- Autovelox **fissi** da **OpenStreetMap** (query Overpass API attorno alla posizione, raggio 10 km), cache locale. Una sola query per volta, con backoff di 2 minuti in caso di errore.
- Marker rossi sulla mappa (tooltip con limite velocità); avviso **beep + banner** quando ti avvicini entro la distanza impostata.
- **Filtro direzionale**: con l'opzione *Solo autovelox davanti* avvisa solo per quelli entro ±60° dal verso di marcia, così la carreggiata opposta non fa scattare il banner. Sotto ~11 km/h, dove l'heading non è affidabile, si ripiega su "avvisa solo se la distanza sta calando".
- I DB importati sono indicizzati su una griglia spaziale e sulla mappa vengono disegnati solo i punti entro 15 km: un archivio nazionale da 15.000 autovelox resta fluido.
- Impostazioni: toggle **Avvisi autovelox**, **Solo autovelox davanti** e **distanza** (300/400/600 m).
- Copertura OSM non uniforme; solo autovelox fissi (no tutor/mobili/posti di blocco).
- **Nota legale**: uso a tua discrezione e responsabilità.

### Grafici
- Andamento **ultimi 60 s** di velocità, piega e accelerazione laterale (canvas nativo, nessuna libreria).

### Storico sessioni
- A ogni **Stop Log** la sessione viene salvata in **IndexedDB** (dati 20 Hz + traccia GPS).
- Elenco giri passati; tap → dettaglio (statistiche + replay traccia su mappa) + **Export CSV / GPX / Elimina**.
- L'elenco legge solo i metadati: le righe di una sessione si caricano quando apri il dettaglio o esporti, così lo Storico resta leggero anche con molte ore registrate.
- **Recupero sessione interrotta**: se l'app si chiude durante un log (crash, batteria, refresh), alla riapertura ti propone di recuperare i dati già scritti su disco.
- `localStorage` resta per impostazioni e calibrazione. Log e archivio autovelox importato stanno su IndexedDB (localStorage ha un tetto di ~5 MB, che il log saturava dopo una ventina di minuti).

### Export GPX
- Il percorso GPS si esporta in `.gpx` (compatibile Strava / Google Maps / Relive).

## Angolo di piega — come funziona

- L'accelerometro "sente" gravità + forza centrifuga. In curva **a regime** la risultante è perpendicolare al telaio: il solo accelerometro misura quindi ~0° di piega proprio quando sei più piegato. Da fermo o in rettilineo, invece, è l'unico riferimento assoluto.
- Per questo la piega usa un **filtro complementare**: il giroscopio integra la velocità di rollio attorno all'asse longitudinale moto e dà la dinamica; l'accelerometro corregge la deriva, ma **solo quando è credibile** (modulo della risultante ≈ 1 g e accelerazione laterale sotto 0,15 g). In curva la correzione viene quasi azzerata, così l'angolo non collassa a zero.
- Il filtro è di tipo **PI**: al termine proporzionale si aggiunge un integrale che stima il bias residuo del giroscopio quando l'accelerometro è affidabile (rettilineo) e continua ad applicarlo quando non lo è (curva). Senza integrale, in curva tenuta la piega derivava di parecchi gradi.
- Puoi disattivarlo da **Impostazioni → Fusione giroscopio**: si torna al passa-basso sul solo accelerometro (comportamento delle versioni precedenti).
- L'indicatore **affidabilità** sotto il quadrante segue la vibrazione misurata: non corregge nulla, ti dice quanto fidarti del numero. Vedi la sezione *Vibrazioni*.
- La **calibrazione** non registra più solo la verticale, ma una terna completa (su / avanti / destra) del frame moto. Così l'inclinazione all'indietro del supporto da manubrio non falsa più né la piega né la scomposizione delle accelerazioni.
- Cambiare **Orientamento montaggio** azzera la calibrazione: l'app te lo dice e ti chiede di rifarla.
- Se piega destra/sinistra risultano invertite sul tuo montaggio, usa **Impostazioni → Inverti segno piega**.

## Vibrazioni

Sono il limite principale della misura, e non con un solo meccanismo — per questo non basta filtrare più forte.

**1. Aliasing.** Il browser cappa `devicemotion` a ~60 Hz, quindi Nyquist è 30 Hz. La vibrazione motore sta sopra e si ripiega dentro la banda utile. Nel caso peggiore — vibrazione esattamente alla frequenza di campionamento — appare come **offset costante**, indistinguibile da una piega vera:

| motore | regime che ripiega su 0 Hz (a 60 Hz) |
|---|---|
| 4 cilindri | ≈1800 rpm |
| bicilindrico | ≈3600 rpm |
| monocilindrico | ≈7200 rpm |

Questo **non è risolvibile via software**: il dato aliasato è già indistinguibile dal segnale. Si risolve solo smorzando il supporto.

**2. Rettificazione della norma.** `‖a‖` è non lineare, quindi rumore a media nulla non si cancella: con 0,3 g RMS di vibrazione la norma legge ~1,09 g invece di 1,00. L'app filtra il **vettore** e poi ne prende la norma, non il contrario, così il rumore si cancella davvero.

**3. Deriva del giroscopio.** Il rumore sul giroscopio viene integrato e diventa random walk: cresce senza limite. È il motivo per cui, sotto vibrazione, **l'accelerometro è il riferimento più affidabile, non meno** — il suo errore resta limitato. Il filtro ne tiene conto: la vibrazione allarga la tolleranza e *alza* il peso dell'accelerometro, non lo abbassa.

Cosa fa l'app, in concreto:

- media dei campioni nell'intervallo di log (anti-alias in decimazione 60→20 Hz);
- mediana mobile sul vettore accelerazione, contro impulsi da buche e giunti;
- passa-basso vettoriale prima della norma;
- pesi continui invece di soglie a gradino;
- saturazione simmetrica del giroscopio invece di azzeramento dei picchi;
- stima del bias di rollio da fermo, più un **termine integrale** che lo impara in rettilineo e continua ad applicarlo in curva, dove l'accelerometro non può correggere nulla;
- colonna `vib_g` nel CSV e indicatore di affidabilità sul cruscotto.

### Supporto: la leva più efficace

Serve **rigido in rotazione, smorzato in alta frequenza**. Morsetto a serraggio con inserto in gomma o silicone, oppure isolatore a fune. Da evitare snodi a sfera e frizioni: cedono lentamente e introducono oscillazioni a 1–5 Hz, che cadono *dentro* la banda della piega — peggiorano la misura invece di migliorarla.

### Le tre accelerazioni

Ricevono lo stesso trattamento della piega dove ha senso, ma non ovunque — e per due canali su tre c'è un rimedio migliore.

**Reiezione impulsi.** Non con una mediana né con Hampel: su queste grandezze un colpo secco **è segnale**. Hampel in particolare fallisce, perché la soglia è `k·MAD` e su una baseline quieta il MAD collassa — misurato, un colpo vero da 0,9 / 1,4 / 1,2 g veniva riscritto in 0,11 / 0,11 / 0,12 g. Il discriminante corretto è la **durata**: un evento fisico dura 2–3 campioni a 60 Hz, un glitch di sensore uno solo con i vicini che restano simili. Si valuta il campione centrale di una finestra di 3, al costo di ~17 ms di ritardo.

**Frenate sostenute.** Nel percorso derivato la gravità era un passa-basso con τ ≈ 0,83 s, che assorbiva anche le accelerazioni vere. Ora τ è 5 s e l'inseguimento si **congela** durante una manovra rettilinea — ma non durante un rollio, perché lì la gravità ruota davvero nel frame telefono e la stima deve seguirla. Residuo letto su una frenata da 1 g:

| durata | prima | ora |
|---|---|---|
| 1 s | 0,298 g | **1,000 g** |
| 2 s | 0,089 g | **1,000 g** |
| 4 s | 0,008 g | **1,000 g** |

**Fusione GPS.** È l'analogo di ciò che il giroscopio fa per la piega: un riferimento lento ma senza deriva.

- longitudinale: `dv/dt` dalla velocità GPS;
- laterale: `v·dψ/dt` da velocità e rotta;
- verticale: **niente**, non esiste un riferimento esterno — ma non serve, perché un'accelerazione verticale sostenuta non è fisicamente possibile.

Sotto ~0,1 Hz comanda il GPS, sopra l'accelerometro. In curva a regime l'accelerometro legge 0,000 g di laterale (la risultante è ⟂ al telaio): il canale fuso legge 0,500 g su una curva da 0,5 g. Le colonne originali restano invariate, quelle fuse si aggiungono.

**Media e picco insieme.** La media sull'intervallo serve contro l'aliasing, ma cancella i transitori: una buca vera da 2,0 g finisce a 1,43 g nella colonna media. Le colonne `*_peak_g` conservano il valore esatto.

**Offset.** La calibrazione azzera anche l'offset dell'accelerometro — a moto ferma e dritta le tre componenti devono valere 0. Serve soprattutto quando il device espone `e.acceleration`; nel percorso derivato l'offset se ne va già con la stima di gravità.

### Diagnostica e test a banco

**Storico → Diagnostica vibrazioni** mostra in tempo reale frequenza del sensore, vibrazione RMS, norma filtrata, peso della correzione, bias stimato, piega letta, le tre accelerazioni con il rispettivo riferimento GPS, l'offset rilevato e lo stato della stima di gravità (in inseguimento / congelata / nativa).

Il **Test banco 20 s** sfrutta un fatto comodo: a moto ferma e dritta sul cavalletto la piega vera è 0° per costruzione — e con lei anche le tre accelerazioni. Quattro riferimenti gratis, quindi ogni scostamento è errore misurabile.

1. Moto sul cavalletto, dritta, telefono montato come in marcia. Calibra.
2. Lancia il test a **motore spento**: è il tuo riferimento.
3. Ripetilo **al minimo** e poi vicino ai regimi critici della tabella sopra.

Lettura del risultato:

| errore piega max | residuo accel medio | verdetto |
|---|---|---|
| < 1,5° | < 0,05 g | ottimo |
| < 3° | < 0,12 g | accettabile |
| oltre | oltre | supporto da rivedere |

Un residuo accelerometrico **costante** è offset del sensore: premi Calibra da fermo. Un residuo che **oscilla** è vibrazione che arriva dal supporto.

Se l'errore è basso a motore spento e cresce col regime, è vibrazione che entra dal supporto — nessuna impostazione software lo sistema.

## Log / export CSV

- Frequenza campionamento **20 Hz** su timer reale (non legato al frame rate), con flush **incrementale** su IndexedDB ogni 10 s: sopravvive a un crash o a un refresh.
- Tetto: ~180.000 righe (~2,5 h). I dati più vecchi vengono scartati oltre il limite.
- Se il sistema sospende la pagina (schermo spento, cambio app) il campionamento può fermarsi: le righe successive alla ripresa portano `gap=1`, così il buco è visibile in analisi invece di sparire dentro la timeline.

Colonne del CSV:

| colonna | descrizione |
|---|---|
| `t` | tempo (s) dall'inizio sessione |
| `speed_kmh` / `speed_ms` | velocità GPS |
| `lean_deg` | angolo di piega (+, destra) |
| `lat_accel_g` / `lon_accel_g` / `vert_accel_g` | accelerazioni in g (frame moto), **medie** sull'intervallo |
| `lat_peak_g` / `lon_peak_g` / `vert_peak_g` | picco in modulo nell'intervallo, con segno |
| `lat_accel_fus_g` / `lon_accel_fus_g` | laterale e longitudinale **fuse con il GPS** |
| `gyro_roll_dps` | velocità angolare di rollio attorno all'asse moto (deg/s) |
| `gap` | `1` = discontinuità temporale prima di questa riga |
| `vib_g` | vibrazione RMS (g) nell'intervallo: sopra ~0,35 g tratta la piega con cautela |
| `lat` / `lon` / `alt_m` / `heading_deg` / `gps_acc_m` | posizione GPS |

Le prime righe (prefisso `#`) sono metadati sessione (max piega, max velocità, distanza).

### Import in Excel (italiano)

Il file usa la virgola come separatore. Su Excel italiano potresti vedere tutto in una colonna:

- **Excel**: Dati → Da testo/CSV → delimitatore **virgola** → carica.
- **Google Sheets**: File → Importa → delimitatore "Virgola".

## Sensori usati (API web standard)

- `navigator.geolocation.watchPosition` — velocità/posizione
- `DeviceMotionEvent` — accelerazione + giroscopio
- `DeviceOrientationEvent` — (permesso iOS)
- `navigator.wakeLock` — schermo acceso
- Fullscreen API
- `IndexedDB` — storico sessioni, flush del log in corso, archivio autovelox importato
- `ServiceWorker` + Web App Manifest — avvio offline e installazione
- Leaflet + OpenStreetMap — mappa (caricata a runtime; fallback canvas offline)

## Sicurezza e privacy

- I dati (tracce, log, calibrazione) restano sul telefono: nessun server, nessuna telemetria in uscita.
- Le uniche chiamate esterne sono le tile OpenStreetMap, Leaflet da unpkg e le query Overpass.
- La pagina dichiara una **Content-Security-Policy** che limita gli host raggiungibili a quelli sopra.
- Nomi e limiti degli autovelox (da OSM o da file importati) sono dati di terze parti e vengono inseriti nel DOM come **testo**, mai come HTML.
- **Da fare**: Leaflet è caricato da CDN senza `integrity`. Per chiudere del tutto il rischio catena di fornitura conviene scaricare `leaflet.js` e `leaflet.css` nella repo e servirli in locale — a quel punto si può stringere la CSP a `script-src 'self'` e togliere `unpkg.com` dalla lista in `sw.js`.

## Limiti noti

- **Aliasing della vibrazione**: sopra 30 Hz il contenuto si ripiega nella banda utile e non è più separabile dal segnale. Vedi la sezione *Vibrazioni*: è un limite del campionamento a 60 Hz imposto dal browser, non del filtro.
- **Deriva del giroscopio**: in una curva molto lunga la correzione accelerometrica è spenta per costruzione. Il termine integrale applica il bias appreso in rettilineo, ma non può inseguire una deriva che nasce dentro la curva stessa.
- **Velocità GPS** può sottostimare a bassa velocità o in galleria.
- **Montaggio non rigido** introduce errore nella piega.
- **Distanza**: i punti a meno di 5 m dal precedente vengono scartati, quindi la distanza è leggermente sottostimata a passo d'uomo.
- Il **segno del giroscopio** è allineato alla convenzione già usata dall'app. Se sul tuo montaggio la piega si muove al contrario, disattiva *Fusione giroscopio* oppure usa *Inverti segno piega*.
- La precisione della piega va validata con un test reale (verifica segno e range).
