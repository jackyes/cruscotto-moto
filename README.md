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
- Puoi disattivarlo da **Impostazioni → Fusione giroscopio**: si torna al passa-basso sul solo accelerometro (comportamento delle versioni precedenti).
- La **calibrazione** non registra più solo la verticale, ma una terna completa (su / avanti / destra) del frame moto. Così l'inclinazione all'indietro del supporto da manubrio non falsa più né la piega né la scomposizione delle accelerazioni.
- Cambiare **Orientamento montaggio** azzera la calibrazione: l'app te lo dice e ti chiede di rifarla.
- Se piega destra/sinistra risultano invertite sul tuo montaggio, usa **Impostazioni → Inverti segno piega**.

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
| `lat_accel_g` / `lon_accel_g` / `vert_accel_g` | accelerazioni in g (frame moto) |
| `gyro_roll_dps` | velocità angolare di rollio attorno all'asse moto (deg/s) |
| `gap` | `1` = discontinuità temporale prima di questa riga |
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

- **Vibrazioni** ad alti regimi → rumore su accelerometro/giroscopio; il filtro attenua ma non elimina.
- **Deriva del giroscopio**: in una curva molto lunga la correzione accelerometrica è quasi spenta, quindi un piccolo errore può accumularsi. Si riassorbe al rientro in rettilineo.
- **Velocità GPS** può sottostimare a bassa velocità o in galleria.
- **Montaggio non rigido** introduce errore nella piega.
- **Distanza**: i punti a meno di 5 m dal precedente vengono scartati, quindi la distanza è leggermente sottostimata a passo d'uomo.
- Il **segno del giroscopio** è allineato alla convenzione già usata dall'app. Se sul tuo montaggio la piega si muove al contrario, disattiva *Fusione giroscopio* oppure usa *Inverti segno piega*.
- La precisione della piega va validata con un test reale (verifica segno e range).
