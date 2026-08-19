# Cruscotto Moto

Dashboard web per telemetria in moto: **velocità (GPS)**, **angolo di piega**, **accelerazioni** e **log CSV**, tutto in un singolo file `index.html`. Si apre dal browser dello smartphone mentre guidi.

## Requisiti

- **Android + Chrome** (consigliato). Su iPhone funziona ma richiede HTTPS e un tap per concedere i permessi sensori.
- **HTTPS obbligatorio**: `Geolocation` e sensori (accelerometro/giroscopio) funzionano solo in *secure context*. La pagina va quindi servita via HTTPS, non aperta come file locale.
- **Supporto telefono rigido** sul manubrio: la piega letta dal telefono = piega moto solo se il telefono è solidale al telaio.

## Deploy (consigliato: GitHub Pages)

1. Crea una repo su GitHub e carica `index.html`.
2. Repo → **Settings → Pages** → Source: branch `main`, cartella `/ (root)` → Save.
3. HTTPS è attivo automaticamente. Apri `https://<tuo-utente>.github.io/<repo>/` dal telefono.

Alternative (entrambe HTTPS automatico):
- **Vercel**: `npx vercel` nella cartella, oppure drag-and-drop su vercel.com.
- **Netlify**: drag-and-drop della cartella su app.netlify.com.

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
- **Controlli mappa** (in alto a sinistra): 🎯 **Centra** (riporta sulla tua posizione), 🧭 **Segui** (mantiene la posizione centrata, si disattiva se trascini la mappa), ⬆️ **Bussola** (ruota la mappa nel verso di marcia usando l'heading GPS).

### Avvisi autovelox
- Autovelox **fissi** da **OpenStreetMap** (query Overpass API attorno alla posizione, raggio 10 km), cache locale.
- Marker rossi sulla mappa (tooltip con limite velocità); avviso **beep + banner** quando ti avvicini entro la distanza impostata.
- Impostazioni: toggle **Avvisi autovelox** e **distanza** (300/400/600 m).
- Copertura OSM non uniforme; solo autovelox fissi (no tutor/mobili/posti di blocco).
- **Nota legale**: uso a tua discrezione e responsabilità.

### Grafici
- Andamento **ultimi 60 s** di velocità, piega e accelerazione laterale (canvas nativo, nessuna libreria).

### Storico sessioni
- A ogni **Stop Log** la sessione viene salvata in **IndexedDB** (dati 20 Hz + traccia GPS).
- Elenco giri passati; tap → dettaglio (statistiche + replay traccia su mappa) + **Export CSV / GPX / Elimina**.
- `localStorage` resta per impostazioni/calibrazione + ultimo log attivo.

### Export GPX
- Il percorso GPS si esporta in `.gpx` (compatibile Strava / Google Maps / Relive).

## Angolo di piega — come funziona

- L'accelerometro "sente" gravità + forza centrifuga. In curva, a regime, la risultante è perpendicolare al telaio → l'inclinazione misurata coincide con la piega reale.
- La piega è calcolata come rotazione dell'asse verticale del telefono attorno all'asse longitudinale della moto, rispetto al valore calibrato.
- Filtro complementare (giroscopio per la risposta rapida + accelerometro per l'assenza di deriva).
- Se piega destra/sinistra risultano invertite sul tuo montaggio, usa **Impostazioni → Inverti segno piega**.

## Log / export CSV

- Frequenza campionamento **20 Hz**, buffer in memoria con flush su `localStorage` ogni 10 s (sopravvive a un refresh).
- Tetto: ~180.000 righe (~2,5 h). I dati più vecchi vengono scartati oltre il limite.

Colonne del CSV:

| colonna | descrizione |
|---|---|
| `t` | tempo (s) dall'inizio sessione |
| `speed_kmh` / `speed_ms` | velocità GPS |
| `lean_deg` | angolo di piega (+, destra) |
| `lat_accel_g` / `lon_accel_g` / `vert_accel_g` | accelerazioni in g (frame moto) |
| `gyro_roll_dps` | velocità angolare di rollio (deg/s) |
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
- `IndexedDB` — storico sessioni
- Leaflet + OpenStreetMap — mappa (caricata a runtime; fallback canvas offline)

## Limiti noti

- **Vibrazioni** ad alti regimi → rumore su accelerometro/giroscopio; il filtro attenua ma non elimina.
- **Velocità GPS** può sottostimare a bassa velocità o in galleria.
- **Montaggio non rigido** introduce errore nella piega.
- La precisione della piega va validata con un test reale (verifica segno e range).
