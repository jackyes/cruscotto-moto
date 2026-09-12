# Cruscotto Moto

Dashboard web per telemetria in moto: **velocità (GPS)**, **angolo di piega**, **accelerazioni** e **log CSV**. Si apre dal browser dello smartphone mentre guidi.

Nessuna build. File principali:

| file | ruolo |
|---|---|
| `index.html` | markup, CSS, `init()` |
| `js/*.js` | logica (sensori, nav, log, mappa, video) |
| `sw.js` | service worker: avvio offline, cache di Leaflet e delle tile già viste |
| `manifest.webmanifest` | installazione come app (icona in home, standalone) |
| `viewer.html` | analisi CSV locale (drag&drop) |

## Requisiti

- **Android + Chrome** (consigliato). Su iPhone funziona ma richiede HTTPS e un tap per concedere i permessi sensori.
- **HTTPS obbligatorio**: `Geolocation` e sensori (accelerometro/giroscopio) funzionano solo in *secure context*. La pagina va quindi servita via HTTPS, non aperta come file locale.
- **Supporto telefono rigido** sul manubrio: la piega letta dal telefono = piega moto solo se il telefono è solidale al telaio.

## Deploy (consigliato: GitHub Pages)

1. Crea una repo su GitHub e carica **tutta la cartella** (`index.html`, `js/`, `sw.js`, `manifest.webmanifest`, `icons/`, `viewer.html`) nella stessa struttura.
2. Repo → **Settings → Pages** → Source: branch `main`, cartella `/ (root)` → Save.
3. HTTPS è attivo automaticamente. Apri `https://<tuo-utente>.github.io/<repo>/` dal telefono.
4. Dal menu di Chrome, **Installa app** / **Aggiungi a schermata Home**: parte a schermo intero e funziona anche senza rete.

Alternative (entrambe HTTPS automatico):
- **Vercel**: `npx vercel` nella cartella, oppure drag-and-drop su vercel.com.
- **Netlify**: drag-and-drop della cartella su app.netlify.com.

> Il service worker si registra solo su HTTPS (o `localhost`). Senza di lui l'app resta
> funzionante ma perde l'avvio offline. Per pubblicare una versione nuova alza
> `CACHE_VERSION` in `sw.js`. L'aggiornamento del worker avviene **solo quando non stai
> registrando**: se un log è attivo, il nuovo codice resta in attesa e si applica al
> primo Stop Log (la sessione è già salvata su disco).

> ⚠️ NON aprire `file:///...index.html` direttamente dal telefono: i sensori non funzionano senza secure context.

## Utilizzo

1. Apri la pagina dal telefono, concedi la posizione quando richiesto.
2. **Impostazioni → Orientamento montaggio**: scegli come è montato il telefono (landscape top a sinistra / destra, o portrait).
   **Impostazioni → Tema**: scuro, chiaro (ad alto contrasto per il sole diretto) o automatico. Il cruscotto si adatta a entrambi gli orientamenti senza scorrere.
3. **Calibrazione**: a moto **dritta e ferma su piano**, premi **Calibra** e tienila ferma per 2 secondi. Se la moto si muove la calibrazione viene rifiutata con un messaggio, invece di essere accettata sbagliata. Rifai la calibrazione se cambi supporto o orientamento.
   *Al primo avvio dopo l'aggiornamento del filtro la calibrazione precedente viene invalidata: va rifatta.*
4. **Start Log** per registrare, **Stop Log** per fermare, **Export CSV** per scaricare.
5. **⛶ Fullscreen** per la vista immersiva; lo schermo resta acceso (wake lock) se spuntato nelle impostazioni.
6. **Demo**: simula i dati (senza moto né sensori) per provare l'interfaccia e l'export — utile anche su desktop.

## Schede

L'app è organizzata in 5 schede (barra in basso): **Dashboard · Mappa · Grafici · Naviga · Storico**.

- **Cambiare scheda NON interrompe il log**: la registrazione gira in un loop indipendente dalla vista. Il pulsante **Start/Stop** resta sempre nella barra in alto, insieme allo stato GPS, al badge ●REC, all'orologio e alla durata.

### Dashboard
- Oltre a velocità e piega: **orologio** in alto, **quota** sotto la velocità e **limite di velocità** (da OSM) che si colora in rosso se superato. Il limite si aggiorna con query Overpass throttled attorno alla posizione; è dato OSM, non ufficiale.
- **Modo Guida** (tasti grandi): si attiva durante il log, la navigazione attiva, la mappa fullscreen o sopra ~15 km/h; si può forzare sempre da Impostazioni.

### Mappa
- Carica **Leaflet + OpenStreetMap**. Leaflet è **vendored** in repo (`js/vendor/leaflet/`) e precacheato dal service worker: la mappa parte anche offline, senza CDN né integrity. MapLibre + Three.js per l'export video 3D restano CDN on-demand.
- **Fallback offline**: se Leaflet non carica, ripiega su un canvas che disegna la traccia senza basemappa (zero dipendenze).
- **Fullscreen mappa**: pulsante ⛶ in alto a destra sulla mappa → la mappa occupa tutto lo schermo (nasconde barra/tab). Ripremi ✕ per uscire.
- **Controlli mappa** (in alto a sinistra): 🎯 **Centra** (riporta sulla tua posizione), 🧭 **Segui** (attivo di default, si disattiva se trascini la mappa), ⬆️ **Bussola** (track-up: ruota la mappa nel verso di marcia), 🔊 **Voce** (silenzia o riattiva le indicazioni vocali al volo, anche a mappa intera; è lo stesso interruttore dell'impostazione *Indicazioni vocali*).
- **Track-up** è realizzato ruotando il container via CSS, senza plugin esterni. Con la mappa ruotata il trascinamento avviene nel sistema di riferimento ruotato: se devi esplorare la mappa a mano, disattiva prima la bussola.
- L'heading viene dal GPS sopra ~11 km/h; sotto si usa la bussola magnetica del telefono (solo se il dispositivo espone un orientamento *assoluto*), regolabile con **Offset bussola**.

### Avvisi autovelox
- Autovelox **fissi** da **OpenStreetMap** (query Overpass API attorno alla posizione), cache locale. Il **raggio** è impostabile: 10/15/20/30/50 km, default 15 km. Una sola query per volta, con timeout esplicito che scala col raggio; se il server principale non risponde si prova un mirror, e solo se fallisce anche quello scatta il backoff di 2 minuti (la cache precedente resta).
- I dati si riaggiornano **da soli mentre guidi**, senza ricaricare la pagina: si riscarica quando ti sposti di mezzo raggio dal centro della cache, o dopo 15 minuti. Riducendo il raggio non si riscarica nulla — la cache è già un soprainsieme.
- Marker rossi sulla mappa (tooltip con limite velocità); avviso **beep + banner** quando ti avvicini entro la distanza impostata.
- **Filtro direzionale**: con l'opzione *Solo autovelox davanti* avvisa solo per quelli entro ±60° dal verso di marcia, così la carreggiata opposta non fa scattare il banner. Sotto ~11 km/h, dove l'heading non è affidabile, si ripiega su "avvisa solo se la distanza sta calando".
- I DB importati sono indicizzati su una griglia spaziale; sulla mappa si disegnano solo i punti entro 1,5 volte il raggio impostato, e comunque mai più di 400 marker (i più vicini): un archivio nazionale da 15.000 autovelox resta fluido. Il tetto vale **solo per il disegno** — gli avvisi restano esaustivi.
- Impostazioni: toggle **Avvisi autovelox**, **Solo autovelox davanti**, **distanza** di avviso (300/400/600 m) e **Raggio autovelox** (10–50 km).
- **Badge di stato** in alto, accanto a quello GPS, perché un degrado dei dati non resti silenzioso: verde quando la copertura è valida, giallo in attesa o quando il disegno è troncato dal tetto marker (mostra `disegnati/totali`), rosso quando Overpass è irraggiungibile, quando non ci sono dati, o quando sei uscito dal cerchio scaricato. Si mostra anche con gli avvisi disattivati.
- Copertura OSM non uniforme; solo autovelox fissi (no tutor/mobili/posti di blocco).
- **Nota legale**: uso a tua discrezione e responsabilità. Al primo avvio (e se riattivi gli avvisi) l'app chiede conferma in-app; se rifiuti gli avvisi restano spenti.

### Navigatore
- **Turn-by-turn** con percorsi moto: indicazioni passo-passo, banner della manovra successiva, distanza che scala in tempo reale e **indicazioni vocali** in italiano. Si silenziano al volo col pulsante 🔊 fra i controlli mappa (raggiungibile con i guanti, presente anche a mappa intera): tocca una volta e l'annuncio in corso si interrompe subito.
- Motore di routing **Valhalla** (istanza pubblica FOSSGIS, nessuna chiave), profilo `motorcycle`. Preferenze: **evita autostrade**, **evita pedaggi**, **evita traghetti** e **preferisci strade secondarie** (il parametro che Valhalla chiama "desiderio di avventura": non garantisce curve, spinge via dalle arterie principali).
- **Fallback automatico su OSRM** (`routing.openstreetmap.de`) se Valhalla non risponde entro pochi secondi: il navigatore continua a funzionare, ma con profilo auto fisso e senza le preferenze moto. La riga di stato dice sempre quale motore ha risposto. Le istruzioni in italiano per OSRM sono generate dall'app a partire da tipo di manovra, direzione e nome della strada.
- Destinazione in quattro modi: **ricerca indirizzo** (Photon), **tap lungo sulla mappa**, **coordinate incollate** (anche link Google Maps) o **da un giro salvato**. In più: **import GPX** (🧭) — la traccia importata diventa destinazione (ultimo punto) e viene disegnata come overlay tratteggiato sulla mappa; e **tappe intermedie** (➕ Tappa, fino a 4 a mano) che spostano la destinazione corrente a via prima della meta finale.
- Il percorso **sopravvive alla perdita di rete**: una volta calcolato, manovre, distanze e voce continuano a funzionare col solo GPS; il ricalcolo è l'unica cosa che richiede la rete, e se manca l'app lo dice invece di tacere.
- **Fuori percorso** con ricalcolo automatico ma con i freni: serve conferma su più fix GPS (un errore in galleria non conta), nessun ricalcolo da fermo al semaforo, backoff crescente e un tetto massimo prima di passare alla modalità manuale — per non tempestare il server (1 richiesta al secondo) e per non litigare con una deviazione voluta.
- Il percorso attivo e la posizione lungo di esso sono salvati su IndexedDB: chiudendo l'app a metà giro, riaprendola puoi riprendere.
- **Simulatore** (nel pannello Navigatore): percorre il percorso con posizioni finte e alimenta lo stesso codice dei fix veri, per provare avanzamento, banner e voce senza salire in moto.
- Nota: Valhalla FOSSGIS è un server comunitario senza garanzie di uptime.

#### Genera giro
Il navigatore normale ti porta da A a B: devi già sapere dove vuoi andare. Il giro della
domenica non funziona così — parti da *"ho tre ore, voglio un centinaio di chilometri,
tutti tornanti, e voglio tornare a casa"*. Questa scheda parte da lì.

- Scegli **quanti km** (~30 → ~300), **ad anello o sola andata**, **quante curve**
  (poche / medie / tante) e **che tipo** (veloci e larghe / strette e tornanti / misto),
  più una **direzione** se vuoi decidere tu da che parte andare.
- In sola andata, se hai già impostato una destinazione il giro finisce lì; altrimenti
  se la inventa a metà dei chilometri chiesti in linea d'aria, così resta spazio per le
  curve invece di uscire un trasferimento diretto.
- Il motore vero è **generare quattro giri candidati, chiederli a Valhalla e misurare
  la geometria che torna** (non quella seminata), tenendo il migliore per chilometri e
  curve. È la parte che paga: su un anello da 50 km chiesto a Lecco, il vincitore
  scelto sbagliava di **2,7 km** contro i **20,4 km** di errore medio dei candidati
  scartati, e usciva a 592 °/km contro i 499 medi. Senza la selezione, chiedere 50 km
  poteva restituire 30 come 121.
- Tetto di 22 richieste e ~25 s, con contatore a schermo e tasto Annulla. **↻ Un altro**
  ripesca dai candidati già calcolati senza toccare la rete (una decina, poi rigenera).
- A fine generazione la riga di stato riporta il **consuntivo vero** — *"53 km · 592°/km ·
  curve ~114 m (18% tornanti). Chiesti 50 km, curve tante, strette"* — anche quando il
  bersaglio non è stato centrato.
- Le tappe intermedie sono **punti geometrici**, agganciati alla strada più vicina da
  Valhalla: un anello le mette su settori uguali attorno al punto di partenza, una sola
  andata dentro un corridoio a zig-zag lungo la retta. Una versione precedente le
  sceglieva invece fra le strade più tortuose della zona, scaricate da Overpass: su due
  A/B controllati **non cambiava niente** (Lecco, montagna: 592 °/km senza contro 504
  con; pianura padana: 166 contro 151), e costava ~1 MB di download, quindi è stata
  tolta. Il motivo è strutturale, e vale la pena saperlo prima di riprovarci: fra una
  tappa e l'altra le strade le sceglie comunque Valhalla, e sei punti vincolati su
  cinquanta chilometri non decidono la curvosità del giro. A decidere è la misura dei
  candidati.
- Valhalla **non garantisce le curve**: sceglie lui le strade fra una tappa e l'altra.
  La misura scarta i candidati peggiori, ma resta una scelta fra candidati, non una
  costruzione esatta — da cui il consuntivo onesto. Per la stessa ragione una **sola
  andata** viene quasi sempre meno tortuosa di un anello di pari lunghezza (misurato:
  ~200 °/km contro ~590): con gli estremi fissi resta molto meno margine di manovra.
  E in montagna esce comunque tortuosa, in pianura comunque no: il terreno conta più
  di qualunque parametro.
- I bersagli numerici (`CURVE_TARGETS` in `js/curvy.js`) sono tarati su misure reali —
  1311 strade OSM attorno a Lecco e un anello Valhalla da 51,7 km — non indovinati. Per
  ritararli su strade tue: carica un giro e chiama `navGenStats()` dalla console.

### Grafici
- Andamento **ultimi 60 s** di velocità, piega e accelerazione laterale (canvas nativo, nessuna libreria).

### Storico sessioni
- A ogni **Stop Log** la sessione viene salvata in **IndexedDB** (dati 20 Hz + traccia GPS).
- Elenco giri passati; tap → dettaglio (statistiche + replay traccia su mappa) + **Export CSV / GPX / video / Elimina**.
- L'elenco legge solo i metadati: le righe di una sessione si caricano quando apri il dettaglio o esporti, così lo Storico resta leggero anche con molte ore registrate.
- **Recupero sessione interrotta**: se l'app si chiude durante un log (crash, batteria, refresh), alla riapertura ti propone di recuperare i dati già scritti su disco.
- `localStorage` resta per impostazioni e calibrazione. Log e archivio autovelox importato stanno su IndexedDB (localStorage ha un tetto di ~5 MB, che il log saturava dopo una ventina di minuti).

### Export GPX
- Il percorso GPS si esporta in `.gpx` (compatibile Strava / Google Maps / Relive).

### Export video
- Dal dettaglio di una sessione (Storico → tap) c'è **Export video**.
- Render **postumo**, tutto lato client, catturato da canvas → **WebM** via MediaRecorder. Nessun server, nessun ffmpeg.
- Opzioni: risoluzione (720p / 1080p), velocità (1× / 2× / 4× / 12×) e tipo:
  - **3D (default)**: mappa 3D MapLibre (terreno AWS Terrain + stile OpenFreeMap, gratis senza chiave) con telecamera che segue il tracciato e una **moto 3D** stilizzata (primitive Three.js) che si inclina con la piega e ha le ruote in rotazione.
  - **2D**: cruscotto animato (velocità, piega, accelerazioni) + tracciato stilizzato.
- Dipendenze 3D caricate **on demand** da CDN (MapLibre GL + Three.js, ~1,4 MB); senza rete si ripiega sul render 2D.
- Limiti: solo **WebM** (MediaRecorder non produce MP4); il render avviene in tempo reale (10 min di giro = 10 min a 1×; 2×/4×/12× accorciano). **Su iOS/Safari l'export video non è disponibile** (manca `canvas.captureStream` + codec WebM): serve Android/Chrome o desktop Chrome.

## Angolo di piega — come funziona

L'accelerometro "sente" gravità + forza centrifuga. In curva **a regime** la risultante è
perpendicolare al telaio: il solo accelerometro misura quindi ~0° di piega proprio quando sei
più piegato.

Le versioni precedenti risolvevano il problema **spegnendo** l'accelerometro in curva e
lasciando integrare il giroscopio. Non funzionava, per tre motivi misurabili:

1. Il gate che doveva chiudersi in curva era calcolato sull'accelerazione laterale **nel frame
   moto**, che in curva a regime vale 0 per costruzione: restava spalancato proprio a metà curva.
2. La tolleranza del gate sulla norma si allargava con la vibrazione. Ma in curva coordinata
   `‖a‖/g = 1/cos(φ)` esattamente — lo scarto da 1 *è* la piega travestita, ed è l'unico vero
   rilevatore di curva. Allargarlo lo cancellava: più la moto vibrava, più la piega collassava.
3. Il filtro integrava il rateo di rollio `p` come se fosse `φ̇`. La cinematica esatta è
   `φ̇ = p + ψ̇·sin(θ)`: su strada in pendenza mancava un termine di prim'ordine.

Risultato: ogni curva tenuta fra ~12° e ~32° finiva entro un grado da **zero** dopo 2-4 secondi.

### Cosa fa adesso

**Compensazione centripeta.** Per un veicolo la cui velocità è lungo il proprio asse
longitudinale (nessuna deriva laterale: buona approssimazione per una moto) l'accelerazione
inerziale vale esattamente `a = v̇·F̂ + v·(ω × F̂)`. Sottraendo `v·(ω × F̂)` dalla forza specifica
il residuo è gravità pura, e **l'accelerometro torna un riferimento assoluto valido dentro la
curva** invece di essere spento. Velocità dal GPS, `ω` dal giroscopio, tutto già in coordinate
telefono.

> Il prodotto vettoriale va tenuto intero. La scorciatoia "sottraggo solo `v·r` sul laterale"
> sbaglia di −1° / −6,6° / −13,8° a 15° / 30° / 40° di piega.

Il termine `v̇·F̂` invece **non** viene sottratto, di proposito: servirebbe una `v̇` affidabile e
non esiste (quella GPS è ritardata, quella inerziale chiude un anello con l'attitudine).
Sottrarne una sbagliata è peggio che non sottrarne nessuna, perché maschera il residuo e lascia
passare un riferimento errato con fiducia alta. Lasciandola stare il residuo si apre da solo e il
filtro veleggia sul giroscopio per i pochi secondi della manovra — che è il comportamento giusto:
durante una staccata l'accelerometro non sa dove sia il basso, e dichiararlo è meglio che
indovinare.

**Attitudine vettoriale (Mahony ridotto).** Non si integra più un solo scalare: si propaga il
vettore gravità con la cinematica esatta `dû/dt = −ω × û`, corretto verso il riferimento e con
un bias del giroscopio stimato a **tre componenti**. Piega e beccheggio si estraggono alla fine
dalla terna calibrata. Questo elimina per costruzione il termine `ψ̇·sin(θ)`, e dà il beccheggio,
che prima non veniva stimato.

Il bias vettoriale non è un lusso: la precisione della compensazione centripeta dipende da
`δφ = v·δω_up/g`, cioè dalla componente di **imbardata** del bias, che un bias scalare sull'asse
di rollio non può nemmeno rappresentare.

**Senza GPS** (galleria, fix perso) la compensazione non è calcolabile, ma la norma sa comunque
quanto sei carico: `‖a‖/g = 1/cos(φ)` dà il **modulo** della piega anche a occhi chiusi, e il
segno lo dà l'integrazione del giroscopio (o la rotta GPS, sui device senza giroscopio).

**Segno del giroscopio.** Non è più una costante scritta a mano: si misura correlando il rateo
di rollio con la derivata dell'angolo accelerometrico **a bassa velocità**, dove l'accelerometro
*è* la piega. Bastano i primi metri a passo d'uomo. Se risulta invertito, l'app lo corregge e te
lo dice.

**Calibrazione.** Non è più un'istantanea: media su 2 s con un gate di qualità (rotazione,
norma, dispersione dei campioni). Se la moto si muove la calibrazione viene **rifiutata** con un
messaggio, invece di congelare una posa sbagliata dicendo "calibrato".
Corretto anche un errore che il test a banco non poteva vedere: `leanFromUp` confrontava le
proiezioni *xy* degli assi device invece di usare la terna calibrata, quindi un supporto inclinato
all'indietro di μ restituiva `atan(tan φ / cos μ)` — a μ=25° una piega vera di 40° veniva letta
42,8°. A φ=0, dove gira il banco, l'errore è nullo.

### Accuratezza misurata

Simulazione della catena reale (`processSample` invocata con accelerometro e giroscopio
sintetici, supporto inclinato 20°, GPS a 1 Hz con 0,6 s di ritardo Doppler). Errore medio sulla
piega, transitorio di avvio escluso:

| scenario | prima | adesso |
|---|---|---|
| curva tenuta 15° | 15,3° | **0,0°** |
| curva tenuta 30° | 6,8° | **0,0°** |
| curva tenuta 40° | 9,0° | **0,0°** |
| curva 30° + vibrazione 0,3 g RMS | 30,9° | **1,7°** |
| curva 30° + vibrazione 0,6 g RMS | 25,8° | **2,7°** |
| curva 35° su pendenza 10% | 40,1° | **0,0°** |
| chicane ±40° a 0,25 Hz | 25,5° | **1,3°** |
| chicane + vibrazione 0,3 g | 25,5° | **2,2°** |

Altri casi, solo sulla versione nuova: bias giroscopio fino a 2 °/s su tutti e tre gli assi
≤ 2,5°; GPS assente per 8 s a metà curva 0,0°; frenata da 5 m/s² tenendo 30° di piega 6,5°
durante la manovra, con rientro a 0,0° in un secondo; segno del giroscopio invertito all'avvio,
stesso risultato finale dopo l'auto-correzione.

> Sono numeri di **simulazione**: verificano l'algoritmo, non il tuo supporto. La vibrazione è
> modellata come rumore bianco, che è ciò che il filtro può togliere. L'aliasing no — vedi sotto.

### Con la vibrazione: prima e dopo l'adattamento

Stessa catena reale, ma con rumore bianco su **tutti e tre gli assi** dell'accelerometro e sul
giroscopio, a 60 Hz, velocità GPS nota (niente ritardo Doppler: isola il contributo del filtro).
Errore medio sulla piega, transitorio di avvio escluso, curva tenuta a 20 m/s:

| scenario | prima (filtro fisso) | adesso (adattivo) |
|---|---|---|
| curva tenuta 30°, quieta | 0,0° | **0,0°** |
| curva tenuta 30° + vibrazione 0,3 g RMS, gyro 5 °/s | 2,9° | **0,7°** |
| curva tenuta 30° + vibrazione 0,6 g RMS, gyro 5 °/s | 2,3° | **1,4°** |
| curva tenuta 30° + vibrazione 0,6 g RMS, gyro 20 °/s | 1,3° | **1,9°** |
| curva tenuta 40° + vibrazione 0,6 g RMS, gyro 5 °/s | 3,9° | **1,4°** |
| chicane ±40° a 0,25 Hz, quieta | 1,1° | **1,5°** |
| chicane ±40° + vibrazione 0,3 g RMS | 1,1° | **2,1°** |
| chicane ±40° + vibrazione 0,6 g RMS, gyro 5 °/s | 2,1° | **3,6°** |

La lettura: in curva tenuta (la situazione in cui si guida con la moto che vibra) l'errore si
riduce di 2-3 volte; nella chicane veloce la dinamica paga ~1° per l'adattamento. Il caso
peggiore resta il rumore bianco fortissimo e indipendente sul giroscopio (20 °/s su tutti gli
assi): lì l'adattamento pesa di meno del filtro fisso, ma è un corner sintetico — su un device
reale accelerometro e giroscopio vibrano insieme e il filtro sull'imbardata lavora meglio.

Puoi disattivare la fusione da **Impostazioni → Fusione giroscopio**: si torna a inseguire il
solo riferimento accelerometrico.

## Vibrazioni

Sono il limite principale della misura, e non con un solo meccanismo — per questo non basta filtrare più forte.

**1. Aliasing.** Nyquist è 30 Hz, e non per colpa di `devicemotion`: è **Chromium** a fissare
`kMaxAllowedFrequency = 60.0` per *tutti* i sensori spaziali, `devicemotion` e Generic Sensor API
compresi (`services/device/public/cpp/generic_sensor/sensor_traits.h`). Una richiesta
`{frequency: 200}` viene clampata in silenzio con un warning in devtools, e il polling di
`SensorProxyImpl` scarta i campioni prodotti fra un poll e l'altro. **Nessuna API web dà più di
60 Hz**, quindi non esiste il rimedio "campiona più veloce".

La vibrazione motore sta sopra i 30 Hz e si ripiega dentro la banda utile. Nel caso peggiore —
vibrazione esattamente alla frequenza di campionamento — appare come **offset costante**,
indistinguibile da una piega vera:

| motore | regime che ripiega su 0 Hz (a 60 Hz) |
|---|---|
| 4 cilindri | ≈1800 rpm |
| bicilindrico | ≈3600 rpm |
| monocilindrico | ≈7200 rpm |

Questo **non è risolvibile via software**: il dato aliasato è già indistinguibile dal segnale. Si
risolve solo smorzando il supporto. Verificato anche in simulazione: un offset costante di 0,05 g
sull'accelerometro produce 2,5° di errore di piega e uno di 0,15 g ne produce 3,9°, **a qualunque
guadagno del filtro** — perché un offset è indistinguibile da un'inclinazione vera, e nessuna
taratura lo separa.

**2. Rettificazione della norma.** `‖a‖` è non lineare, quindi rumore a media nulla non si cancella: con 0,3 g RMS di vibrazione la norma legge ~1,09 g invece di 1,00. L'app filtra il **vettore** e poi ne prende la norma, non il contrario, così il rumore si cancella davvero.

**3. Deriva del giroscopio.** Il rumore sul giroscopio viene integrato e diventa random walk: cresce senza limite. È il motivo per cui, sotto vibrazione, **l'accelerometro è il riferimento più affidabile, non meno** — il suo errore resta limitato.

Le versioni precedenti traducevano questa osservazione (giusta) in un rimedio sbagliato: allargavano la tolleranza del gate proporzionalmente alla vibrazione e moltiplicavano per 4 il peso accelerometrico. Ma il gate sulla norma **è** il rilevatore di curva, perché in curva coordinata `‖a‖/g = 1/cos(φ)`: allargarlo lo cancella. Misurato: una curva tenuta a 30° con 0,6 g RMS di vibrazione scendeva a 6,6° in sei secondi, e peggiorava quanto più la moto vibrava.

Adesso il gate è un **residuo di coerenza**: si confronta la norma con quella che l'ipotesi corrente prevede, quindi una curva a regime è *coerente* e non ha bisogno di essere esclusa, mentre un'accelerazione lineare vera apre comunque il residuo. La tolleranza resta fissa. L'affidabilità mostrata all'utente continua a seguire la vibrazione, ma non entra più nel filtro.

Cosa fa l'app, in concreto:

- media dei campioni nell'intervallo di log (anti-alias in decimazione 60→20 Hz);
- mediana mobile sul vettore accelerazione, con finestra dimensionata sulla frequenza **reale**
  del sensore e non su un numero fisso di campioni;
- passa-basso vettoriale prima della norma, **di 2° ordine** (biquad Butterworth): a parità di
  costante di tempo il rolloff è il doppio dell'EMA di 1° ordine, quindi la banda 5–30 Hz viene
  reiettata il doppio senza ritardo aggiuntivo in banda utile;
- **adattamento alla vibrazione**: le costanti di tempo del filtraggio si allungano (fino a ×2,5)
  e i guadagni del Mahony si riducono con l'energia fuori banda. La metrica che lo guida
  (`vibAdaptG`) è il residuo sopra ~2 Hz, **non** la vibrazione storica `vibHiG`: il moto reale
  del telaio (chicane, sconnessioni <1 Hz) non deve allungare i filtri, altrimenti taglia la
  dinamica proprio dove serve. Il gate di coerenza `ATT_TOL_G` resta **fisso** — la lezione
  delle versioni precedenti è che allargarlo cancella l'unico rilevatore di curva funzionante;
- **filtro sull'imbardata guidato dal rumore del canale stesso**: la compensazione centripeta ha
  errore `v·δω_up/g` (a 20 m/s un grado/s di rumore su yaw costa 2° di piega). Un filtro veloce
  segue la ψ̇ reale senza ritardo; il residuo fra yaw grezzo e quel filtro è la stima del rumore,
  e il tau del filtro che alimenta la compensazione cresce con essa. Una ψ̇ pulita paga ~zero
  ritardo di fase, un canale sporco viene filtrato;
- **tutti i guadagni espressi in costanti di tempo**, non per campione. Prima predizione e
  correzione erano in unità diverse, quindi la frequenza di crossover del filtro scalava con la
  frequenza degli eventi: su un device a 30 Hz la reiezione della deriva si dimezzava;
- saturazione simmetrica del giroscopio invece di azzeramento dei picchi;
- bias del giroscopio a **tre componenti**, imparato quando il riferimento è credibile e
  applicato anche quando non lo è;
- metrica di vibrazione come **energia fuori banda** (residuo rispetto al passa-basso) invece che
  come differenza campione-campione, che è un derivatore e contava come vibrazione anche il moto
  reale del telaio a 3-5 Hz;
- colonne `vib_g` e `vib_hi_g` nel CSV, indicatore di affidabilità e riferimento attivo sul
  cruscotto.

### Gravità: fusione di piattaforma vs propria, con cross-check

La gravità per le tre accelerazioni viene, in ordine di preferenza:

1. dalla **fusione di piattaforma** — `GravitySensor` / `LinearAccelerationSensor`, che su Android
   mappano su `TYPE_GRAVITY` e `TYPE_LINEAR_ACCELERATION`, sensori compositi che la CDD impone
   siano assistiti dal giroscopio quando il giroscopio esiste;
2. dalla **soluzione di attitudine**, `g·û` per costruzione.

Ma la fusione di piattaforma non è tarata per la vibrazione del motore, e la propria sì. Da
**Impostazioni → Stima gravità**:

- **Auto (cross-check)**: la gravità nativa si confronta con `g·û` a ogni campione (direzione e
  norma); se divergono oltre soglia, si butta e si usa la propria. La diagnostica mostra l'angolo
  di disaccordo;
- **Fusione di piattaforma** / **Propria attitudine**: forzano il percorso.

### Rettificazione MEMS (offset DC da vibrazione)

La massa sismica dei MEMS non è perfettamente lineare: una vibrazione ad alta frequenza può
indurre un **offset DC** sul canale accelerometrico lungo l'asse che vibra (per lo più il
verticale del telaio). Non era verificabile a banco, quindi prima restava un sospetto.

Adesso l'app la **stima**: a moto quasi dritta, senza frenata e senza colpi verticali,
l'accelerazione verticale vera è ~0, quindi una media sistematica di `vertG` (EMA a 5 s) sotto
vibrazione è offset indotto, non moto. La stima è sempre visibile in diagnostica e nel CSV
(`vib_rect_g`); l'applicazione è opzionale (**Impostazioni → Correggi offset da vibrazione**) e
limitata a ±0,05 g, solo sul canale verticale. La conferma su dispositivo reale resta da fare:
usate la diagnostica per valutare se il valore è stabile e riproducibile al regime di giri.

### Supporto: la leva più efficace

Serve **rigido in rotazione, smorzato in alta frequenza**. Morsetto a serraggio con inserto in gomma o silicone, oppure isolatore a fune. Da evitare snodi a sfera e frizioni: cedono lentamente e introducono oscillazioni a 1–5 Hz, che cadono *dentro* la banda della piega — peggiorano la misura invece di migliorarla.

### Le tre accelerazioni

Ricevono lo stesso trattamento della piega dove ha senso, ma non ovunque — e per due canali su tre c'è un rimedio migliore.

**Reiezione impulsi.** Non con una mediana né con Hampel: su queste grandezze un colpo secco **è segnale**. Hampel in particolare fallisce, perché la soglia è `k·MAD` e su una baseline quieta il MAD collassa — misurato, un colpo vero da 0,9 / 1,4 / 1,2 g veniva riscritto in 0,11 / 0,11 / 0,12 g. Il discriminante corretto è la **durata**: un evento fisico dura 2–3 campioni a 60 Hz, un glitch di sensore uno solo con i vicini che restano simili. Si valuta il campione centrale di una finestra di 3, al costo di ~17 ms di ritardo.

**Frenate sostenute.** La gravità non viene più da un passa-basso con congelamento. Quel percorso aveva una lunga catena di soglie e un caso patologico: sopra ~30° di piega il residuo verticale `g·(1/cos φ − 1)` supera da solo la soglia di congelamento, quindi in curva la stima restava **congelata lì in permanenza**. La scelta fra fusione di piattaforma e propria attitudine, con il cross-check, è descritta sopra (vedi *Gravità*).

Se il HAL non espone i sensori compositi, Chromium ripiega su una propria fusione che è letteralmente un passa-basso del prim'ordine senza giroscopio: la diagnostica dice quale dei due percorsi è attivo, invece di lasciarlo supporre.

**Fusione GPS.** È l'analogo di ciò che il giroscopio fa per la piega: un riferimento lento ma senza deriva.

- longitudinale: `dv/dt` dalla velocità GPS;
- laterale: `v·ψ̇` con **l'imbardata dal giroscopio**, disponibile a 60 Hz, senza il rumore di derivazione di una rotta campionata a 1 Hz e senza il buco sotto la velocità minima di heading. La derivata della rotta GPS resta come ripiego sui device senza giroscopio;
- verticale: **niente**, non esiste un riferimento esterno — ma non serve, perché un'accelerazione verticale sostenuta non è fisicamente possibile.

**Velocità.** Non è più la sola EMA sul dato GPS, che a 1 Hz ritardava di ~0,4 s oltre al ritardo del Doppler. Si tiene l'**integrale** dell'accelerazione longitudinale e la velocità è `base + integrale`, con la base riancorata **per intero** a ogni fix — confrontando l'integrale di `GPS_LAG_S` secondi fa, non quello corrente, così il ritardo del Doppler viene tolto invece di essere ereditato. Fra un fix e l'altro c'è la dinamica dell'accelerometro senza ritardo; a ogni fix c'è il valore assoluto del GPS senza deriva. Senza fix fresco l'integrazione si **congela** invece di divergere, e chi la consuma la vede stale.

> Un osservatore che invece integrasse la velocità correggendola solo in parte a ogni fix si assesterebbe su un errore stazionario appena l'accelerometro ha un offset — e l'offset c'è per forza, perché `lonG` viene da `ig − g·û` e un residuo di beccheggio ci si scarica dentro. Misurato: −1,06 m/s a regime, cioè 3,5° di piega di troppo dopo ogni staccata.

Corretto anche il caso in cui `coords.speed` è `null` (provider fuso, uscita da una galleria, pagina in background): prima veniva scritto come 0, il tachimetro andava a zero a velocità di marcia e — peggio — il rilevatore di "fermo" del bias giroscopio scattava **in corsa**, mangiando due secondi di rollio vero come se fosse bias. Adesso "velocità non riportata" e "velocità zero" sono cose diverse, e il fermo si accerta con evidenza **positiva**: fix fresco che riporta velocità bassa, più assenza di rotazione, più vibrazione bassa.

Sotto ~0,1 Hz comanda il GPS, sopra l'accelerometro. In curva a regime l'accelerometro legge 0,000 g di laterale (la risultante è ⟂ al telaio): il canale fuso legge 0,500 g su una curva da 0,5 g. Le colonne originali restano invariate, quelle fuse si aggiungono. Il ramo inerziale della fusione (residuo rispetto al passa-basso) riceve un **LP proprio con tau adattivo alla vibrazione**: prima la vibrazione passava tutta dentro `lat_accel_fus_g`/`lon_accel_fus_g`, adesso i canali fusi restano leggibili anche al minimo del motore, senza toccare lo stato stazionario né i picchi (che stanno nelle colonne `*_peak_g`).

**Media e picco insieme.** La media sull'intervallo serve contro l'aliasing, ma cancella i transitori: una buca vera da 2,0 g finisce a 1,43 g nella colonna media. Le colonne `*_peak_g` conservano il valore esatto.

**Offset.** La calibrazione azzera anche l'offset dell'accelerometro — a moto ferma e dritta le tre componenti devono valere 0. Serve soprattutto quando il device espone `e.acceleration`; nel percorso derivato l'offset se ne va già con la stima di gravità.

### Diagnostica e test a banco

**Storico → Diagnostica vibrazioni** mostra in tempo reale frequenza del sensore, vibrazione RMS e fuori banda, norma filtrata, fiducia nel riferimento, bias giroscopio (rollio e modulo del vettore), piega e beccheggio letti, imbardata, piega cinematica, velocità fusa contro velocità GPS, le tre accelerazioni con il rispettivo riferimento GPS, l'offset rilevato, la sorgente sensori attiva (Generic Sensor API o `devicemotion`), l'origine della gravità (con l'angolo di disaccordo del cross-check), il **fattore di adattamento alla vibrazione** con il guadagno effettivo, la **stima di rettificazione MEMS** e il **riferimento attivo in quell'istante**:

| riferimento | significato |
|---|---|
| `compensato (curva valida)` | compensazione centripeta attiva: l'accelerometro è valido anche in piega |
| `da norma (senza GPS)` | niente velocità: modulo della piega dalla norma, segno dal giroscopio o dalla rotta |
| `accelerometro grezzo` | fermo o passo d'uomo: l'accelerometro è già il riferimento giusto |
| `solo giroscopio` | manovra longitudinale in corso: il filtro veleggia, l'accelerometro non è credibile |

Il **Test banco 20 s** sfrutta un fatto comodo: a moto ferma e dritta sul cavalletto la piega vera è 0° per costruzione — e con lei anche le tre accelerazioni. Quattro riferimenti gratis, quindi ogni scostamento è errore misurabile.

1. Moto sul cavalletto, dritta, telefono montato come in marcia. Calibra (la cattura dura 2 s: tienila ferma, altrimenti viene rifiutata).
2. Lancia il test a **motore spento**: è il tuo riferimento.
3. Ripetilo **al minimo** e poi vicino ai regimi critici della tabella sopra.

> Il banco gira a piega 0° e per costruzione **non può** vedere gli errori che si manifestano solo in piega: l'inclinazione del supporto, i gate della curva, il termine di pendenza. Per quelli serve un giro vero — vedi sotto.

Lettura del risultato:

| errore piega max | residuo accel medio | verdetto |
|---|---|---|
| < 1,5° | < 0,05 g | ottimo |
| < 3° | < 0,12 g | accettabile |
| oltre | oltre | supporto da rivedere |

Un residuo accelerometrico **costante** è offset del sensore: premi Calibra da fermo. Un residuo che **oscilla** è vibrazione che arriva dal supporto.

Se l'errore è basso a motore spento e cresce col regime, è vibrazione che entra dal supporto — nessuna impostazione software lo sistema.

### Verifica su strada

Il CSV contiene ora una **stima indipendente** della piega: `lean_kin_deg = atan(v·ψ̇/g)`, che in curva a regime vale esattamente l'angolo di piega e non passa né per l'accelerometro né per l'integrazione. Confrontala con `lean_deg`:

- in curva tenuta le due devono coincidere entro ~2°;
- se divergono di decine di gradi, una delle due sta sbagliando — e la colonna `lean_ref` dice quale riferimento era attivo in quel momento.

È lo stesso confronto che si può fare a posteriori sui log vecchi, ricavando `ψ̇` da `gyro_roll_dps` e `speed_ms`: è così che il collasso in curva è stato quantificato.

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
| `pitch_deg` | beccheggio (+, muso in su) — **nuova** |
| `gyro_yaw_dps` | imbardata attorno all'asse su del frame moto — **nuova** |
| `speed_fus_ms` | velocità fusa inerziale + GPS, senza il ritardo del Doppler — **nuova** |
| `lean_kin_deg` | piega cinematica `atan(v·ψ̇/g)`: stima indipendente, per verifica — **nuova** |
| `vib_hi_g` | vibrazione fuori banda (g) — **nuova** |
| `lean_ref` | riferimento attivo: `centrip` / `norm` / `raw` / `gyro` — **nuova** |
| `vib_rect_g` | offset verticale stimato da rettificazione MEMS (g), diagnostico — **nuova** |

Le colonne nuove sono **in coda**, quindi un parser che legge per posizione non si rompe; le sessioni salvate prima dell'aggiornamento le esportano vuote.

Le prime righe (prefisso `#`) sono metadati sessione (max piega, max velocità, distanza).

### Import in Excel (italiano)

Il file usa la virgola come separatore. Su Excel italiano potresti vedere tutto in una colonna:

- **Excel**: Dati → Da testo/CSV → delimitatore **virgola** → carica.
- **Google Sheets**: File → Importa → delimitatore "Virgola".

### Viewer web (CSV)
- `viewer.html` (nella stessa cartella dell'app) apre il CSV esportato via **drag&drop** o click.
- Mostra statistiche (durata, V max, piega D/S, distanza, campioni), grafici (velocità, piega, accelerazioni, quota) e il tracciato su mappa OpenStreetMap ricavato dalle colonne `lat`/`lon`.
- Tutto in locale nel browser: nessun dato viene inviato altrove. Serve connessione solo per i tile della mappa.

## Sensori usati (API web standard)

- `navigator.geolocation.watchPosition` — velocità/posizione
- **Generic Sensor API** (`Accelerometer`, `Gyroscope`, `GravitySensor`, `LinearAccelerationSensor`) su Chrome/Android — percorso principale. Non per la frequenza, che resta 60 Hz, ma per il **timestamp hardware** per campione (il `dt` autorevole per l'integrazione), per la de-duplicazione sul cambio di timestamp e per la fusione di piattaforma su gravità e accelerazione lineare
- `DeviceMotionEvent` — accelerazione + giroscopio: ripiego su iOS/Safari, Firefox e ovunque la Generic Sensor API manchi o venga negata
- `DeviceOrientationEvent` — (permesso iOS)
- `navigator.wakeLock` — schermo acceso
- Fullscreen API
- `IndexedDB` — storico sessioni, flush del log in corso, archivio autovelox importato
- `ServiceWorker` + Web App Manifest — avvio offline e installazione
- Leaflet + OpenStreetMap — mappa (caricata a runtime; fallback canvas offline)

## Sicurezza e privacy

- I dati (tracce, log, calibrazione) restano sul telefono: nessun server, nessuna telemetria in uscita.
- Le chiamate esterne sono le tile OpenStreetMap, Leaflet da unpkg, le query Overpass (autovelox), Valhalla e OSRM (routing) e Photon (geocoding). Origine e destinazione del navigatore sono inviate a un server terzo quando calcoli un percorso o generi un giro; il resto (traccia, autovelox, preferenze) resta in locale.
- La pagina dichiara una **Content-Security-Policy** che limita gli host raggiungibili a quelli sopra.
- Nomi e limiti degli autovelox (da OSM o da file importati) sono dati di terze parti e vengono inseriti nel DOM come **testo**, mai come HTML.
- Leaflet (mappa live) è caricato da unpkg **con** `integrity` (SRI). MapLibre + Three.js per l'export video 3D restano CDN on-demand. Per chiudere del tutto il rischio catena di fornitura conviene vendorizzare Leaflet in repo e stringere la CSP a `script-src 'self'` (video 3D resterebbe da sbloccare a parte).

## Test

I test girano col runner nativo di Node (nessun build, nessun framework):

```bash
node --test
```

Scopre da solo `tests/*.test.mjs`. **Non** usare `node --test tests/`: con un percorso esplicito
il runner lo interpreta come file di test e fallisce. Per verificare la sola sintassi dei moduli:

```bash
for f in $(find js -name '*.js'); do node --check "$f"; done
```

## Limiti noti

- **Aliasing della vibrazione**: sopra 30 Hz il contenuto si ripiega nella banda utile e non è più
  separabile dal segnale. È il tetto di 60 Hz che Chromium impone a *tutte* le API sensori, non un
  limite del filtro né di `devicemotion`: non esiste il rimedio "campiona più veloce". Vedi la
  sezione *Vibrazioni*. L'unica leva è il supporto smorzato.
- **Rettificazione da vibrazione nei MEMS** (offset DC indotto da vibrazione ad alta frequenza per
  non linearità della massa sismica): l'app ora la **stima** sul canale verticale (vedi la sezione
  dedicata) e può correggerla in modo limitato, ma la **conferma su dispositivo reale resta da
  fare**. Se si comporta come un offset, in ogni caso si somma all'aliasing e la leva principale
  resta il supporto.
- **Curva molto lunga senza GPS**: con la compensazione centripeta attiva l'accelerometro resta
  valido in curva, quindi la deriva è chiusa in anello. Ma se manca la velocità *e* manca il
  giroscopio, non resta nessun riferimento sul segno della piega.
- **Manovre longitudinali forti**: durante una staccata o un'accelerazione decisa l'accelerometro
  non sa dove sia il basso e il filtro veleggia sul giroscopio. L'errore rientra in circa un
  secondo (misurato: 6,5° durante una frenata da 5 m/s² tenendo 30° di piega, 0,0° dopo).
- **Device senza giroscopio**: il modulo della piega si ricava dalla norma e il segno dalla rotta
  GPS a 1 Hz. Funziona in curva tenuta (0,0°), non in una chicane veloce (31° su una chicane a
  0,25 Hz), perché la rotta a 1 Hz non può seguirla.
- **Velocità GPS** può sottostimare a bassa velocità o in galleria. La stima fusa copre il buco fra
  i fix, ma si congela dopo 3 s senza fix invece di divergere.
- **Montaggio non rigido** introduce errore nella piega: la calibrazione assorbe l'inclinazione
  statica del supporto, non il suo gioco.
- **Distanza**: i punti a meno di 5 m dal precedente vengono scartati, quindi la distanza è
  leggermente sottostimata a passo d'uomo.
- **Piega del telaio ≠ piega del baricentro**: posizione del corpo e larghezza del pneumatico
  cambiano l'una rispetto all'altra, e nessun sensore sul manubrio può vederlo.
- I numeri di accuratezza in questo README vengono da una **simulazione** della catena reale, non
  da misure su strada: verificano l'algoritmo, non il tuo supporto.
