/* Service worker di Cruscotto Moto.

   Serve a due cose:
   - far partire l'app anche senza rete (in moto la copertura è quello che è);
   - tenere in cache Leaflet e le tile OSM già viste, così la mappa non sparisce
     appena si perde il segnale.

   Nessuna dipendenza esterna. Alzare CACHE_VERSION rinnova lo shell (codice app);
   alzare MAP_VERSION invalida tile/liberty/satellite (cancella quelle scaricate). */

'use strict';

const CACHE_VERSION = 'v38';   // shell (codice app): alzare per forzare il rinnovo
const MAP_VERSION  = 'v12';    // tile/liberty/satellite: indipendente dallo shell. Parte
                               // dallo stesso valore del vecchio schema (v12) così il primo
                               // deploy NON orfanizza le cache già scaricate; va alzato solo
                               // quando cambia il formato delle tile, non a ogni deploy.
const SHELL_CACHE = 'cruscotto-shell-' + CACHE_VERSION;
const LIB_CACHE   = 'cruscotto-lib-' + MAP_VERSION;
const TILE_CACHE  = 'cruscotto-tiles-' + MAP_VERSION;
const OFM_CACHE   = 'cruscotto-ofm-' + MAP_VERSION;
const OFM_MAX = 1000;

const SHELL = [
  './',
  './index.html',
  './js/issues.js',
  './js/core.js',
  './js/geo.js',
  './js/curvy.js',
  './js/csv.js',
  './js/osrm-text.js',
  './js/parse.js',
  './js/sensors-core.js',
  './js/rows-codec.js',
  './js/storage.js',
  './js/calib.js',
  './js/accel-fusion.js',
  './js/sensors-pipe.js',
  './js/nav-engine.js',
  './js/log-core.js',
  './js/nav-net.js',
  './js/cams.js',
  './js/speed-limit.js',
  './js/inputs.js',
  './js/nav-ui.js',
  './js/nav-config.js',
  './js/nav-gen.js',
  './js/video.js',
  './js/sensor-src.js',
  './js/cam-map.js',
  './js/nav-map.js',
  './js/log-session.js',
  './js/video3d.js',
  './js/video-offline.js',
  './js/video-mp4.js',
  './js/vendor/mp4-muxer.js',
  './js/video-webm.js',
  './js/vendor/webm-muxer.js',
  './js/map.js',
  './js/diag.js',
  './js/ui-core.js',
  './js/misc.js',
  './js/display.js',
  './js/net-base.js',
  './js/init.js',
  './css/app.css',
  './js/draw.js',
  './js/share.js',
  './viewer.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/vendor/leaflet/leaflet.js',
  './js/vendor/leaflet/leaflet.css',
  './js/vendor/leaflet/images/marker-icon.png',
  './js/vendor/leaflet/images/marker-icon-2x.png',
  './js/vendor/leaflet/images/marker-shadow.png',
  './js/vendor/leaflet/images/layers.png',
  './js/vendor/leaflet/images/layers-2x.png',
];

const LIB_HOSTS = ['unpkg.com'];
// Leaflet è ora vendored (nella SHELL). MapLibre/Three per il video 3D restano
// CDN on-demand e vengono cacheate dal ramo LIB_HOSTS del fetch handler.
const LIB_PRECACHE = [];
// OSM ha abbandonato i sottodomini a/b/c (HTTP/2 non ne ha bisogno): le tile
// arrivano da tile.openstreetmap.org. I vecchi host restano riconosciuti per le
// tile già in cache, migrate alla chiave nuova al primo uso (tileFirst).
const TILE_HOST = 'tile.openstreetmap.org';
const TILE_HOST_RE = /^([abc]\.)?tile\.openstreetmap\.org$/;
// Tetto di tile conservate. 800 (~15 MB) non bastava a un giro da 150 km agli
// zoom 15-16: le tile della zona di partenza sparivano prima del ritorno.
// 4000 sono ~60-100 MB, sotto quota su qualunque telefono recente.
const TILE_MAX = 4000;

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE)
        // addAll fallisce in blocco se una sola risorsa manca: si va a una a una.
        // cache: 'reload': il precache scavalca la HTTP cache del browser, altrimenti
        // la shell nuova poteva nascere con dentro moduli del deploy precedente.
        .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {
          console.warn('[sw] precache shell fallito:', u);
        })))),
      caches.open(LIB_CACHE)
        .then(c => Promise.all(LIB_PRECACHE.map(u => c.add(u).catch(() => {
          console.warn('[sw] precache lib fallito:', u);
        })))),
    ])
    // Niente skipWaiting() automatico: attivare il nuovo worker a metà giro
    // cambierebbe il codice sotto al log attivo. Il client, quando è pronto
    // (non sta registrando), manda SKIP_WAITING via message.
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('cruscotto-') &&
                         k !== SHELL_CACHE && k !== LIB_CACHE && k !== TILE_CACHE && k !== OFM_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Tiene la cache tile sotto controllo: senza tetto un viaggio lungo riempie il disco. */
async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // Le chiavi sono in ordine di inserimento: si eliminano le più vecchie.
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

/* trimCache enumera TUTTE le chiavi (e a max+1 sfora di 1 a ogni tile): con 400
   tile in cache e un tile nuovo al secondo era una scansione completa per ogni
   tile. Si limita a una passata ogni TRIM_INTERVAL_MS per cache. */
const TRIM_INTERVAL_MS = 30000;
const trimLast = {};
async function maybeTrim(name, max) {
  const now = Date.now();
  if (now - (trimLast[name] || 0) < TRIM_INTERVAL_MS) return;
  trimLast[name] = now;
  await trimCache(name, max);
}

async function cacheFirst(req, cacheName, opts) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Si conservano solo risposte valide (le tile OSM arrivano in CORS, vedi tileFirst).
  if (res && (res.ok || res.type === 'opaque')) {
    try {
      await cache.put(req, res.clone());
    } catch (e) {
      if (e && e.name === 'QuotaExceededError' && opts && opts.max) {
        await trimCache(cacheName, opts.max);
        try { await cache.put(req, res.clone()); } catch (_) {}
      }
    }
    if (opts && opts.max) await maybeTrim(cacheName, opts.max);
  }
  return res;
}

/* Tile OSM: cache-first con due aggiunte.
   - LRU approssimato: trimCache butta le chiavi più vecchie in ordine di
     inserimento, quindi le tile di casa (le più usate, ma scaricate per prime)
     erano le prime a sparire. Al primo uso in questa vita del worker una tile
     viene ri-inserita (put sulla stessa chiave la sposta in fondo): si scartano
     quelle non viste da più tempo. Una volta sola per tile, non a ogni hit.
   - Migrazione pigra: una tile mancante sotto tile.openstreetmap.org si cerca
     sotto i vecchi a./b./c.; se c'è, passa alla chiave nuova.
   Le tile salvate prima di crossOrigin sono risposte opache: una richiesta CORS
   non le può usare (il browser rifiuta l'immagine), quindi si scartano e si
   riscaricano. */
const tileTouched = new Set();
const tileUsable = (hit, req) => hit.type !== 'opaque' || req.mode === 'no-cors';
async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  let hit = await cache.match(req);
  if (hit && !tileUsable(hit, req)) {
    await cache.delete(req).catch(() => {});
    hit = null;
  }
  if (hit) {
    if (!tileTouched.has(req.url)) {
      if (tileTouched.size >= TILE_MAX) tileTouched.clear();
      tileTouched.add(req.url);
      cache.put(req, hit.clone()).catch(() => {});
    }
    return hit;
  }
  const u = new URL(req.url);
  if (u.hostname === TILE_HOST) {
    for (const sub of ['a', 'b', 'c']) {
      const old = 'https://' + sub + '.' + TILE_HOST + u.pathname;
      hit = await cache.match(old);
      if (hit && !tileUsable(hit, req)) { await cache.delete(old).catch(() => {}); continue; }
      if (hit) {
        tileTouched.add(req.url);
        try { await cache.put(req, hit.clone()); await cache.delete(old); } catch (e) {}
        return hit;
      }
    }
  }
  return cacheFirst(req, TILE_CACHE, { max: TILE_MAX });
}

/* fetch con timeout: su rete presente ma lentissima (galleria, zona rurale — il
   caso comune in moto, non l'offline netto) senza timeout l'app restava bloccata
   a lungo prima di ripiegare sulla cache già disponibile.
   cache: 'no-cache' = rivalida sempre col server (ETag → 304, pochi byte): con il
   default la HTTP cache del browser (GitHub Pages manda max-age=600) poteva dare
   un js/*.js vecchio accanto a un index.html nuovo, e la pagina chiamava funzioni
   che il modulo stantio non aveva ("updateMapHud is not defined"). */
async function fetchWithTimeoutSW(req, ms) {
  if (ms == null) return fetch(req, { cache: 'no-cache' });  // nessun timeout: decide il browser
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(req, { signal: ctl.signal, cache: 'no-cache' });
  } finally {
    clearTimeout(t);
  }
}

/* Da dove e' arrivato il documento di ogni pagina (clientId -> 'net' | 'cache').
   Serve a non mischiare versioni: pagina e moduli devono venire dallo stesso
   deploy. Con un timeout uguale per tutti, su rete lenta index.html arrivava
   dalla rete e un js/*.js lento ripiegava sulla copia in cache del deploy
   precedente → funzioni mancanti ("updateMapHud is not defined").
   - documento dalla rete: i suoi file aspettano la rete (niente timeout; la cache
     solo se la rete fallisce davvero, cioe' e' caduta a meta' caricamento);
   - documento dalla cache: i suoi file vengono dalla stessa cache, coerente.
   Vive in memoria: se il worker viene terminato si perde, e per quei client si
   torna al timeout classico. */
const docSource = new Map();
const DOC_SOURCE_MAX = 32;
function rememberDocSource(clientId, source) {
  if (!clientId) return;
  docSource.delete(clientId);
  docSource.set(clientId, source);
  // Le chiavi sono in ordine di inserimento: via le pagine piu' vecchie.
  while (docSource.size > DOC_SOURCE_MAX) docSource.delete(docSource.keys().next().value);
}

/* Navigazioni: rete prima (così un deploy nuovo arriva subito), cache se offline.
   Una risposta NON-ok (404/500: glitch server durante un deploy) va trattata come
   errore: restituirla significava mostrare la pagina d'errore anche se la cache
   aveva la shell funzionante. */
async function networkFirst(req, clientId) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetchWithTimeoutSW(req, 2500);
    if (!res || !res.ok) throw new Error('bad status ' + (res ? res.status : 'null'));
    // Niente cache.put per URL con query string: le navigazioni cache-bustate
    // (index.html?v=…) moltiplicavano le voci di SHELL_CACHE senza fine.
    try { if (!new URL(req.url).search) await cache.put(req, res.clone()); } catch (_) {}
    rememberDocSource(clientId, 'net');
    return res;
  } catch (e) {
    const hit = await cache.match(req) || await cache.match('./index.html');
    if (hit) { rememberDocSource(clientId, 'cache'); return hit; }
    throw e;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Overpass / routing / geocoding: mai in cache, la risposta dipende dalla posizione
  // ed è già memorizzata dall'app. Lasciate passare così come sono.
  if (url.hostname.endsWith('overpass-api.de') ||
      url.hostname.endsWith('overpass.kumi.systems') ||
      url.hostname.endsWith('valhalla1.openstreetmap.de') ||
      url.hostname.endsWith('routing.openstreetmap.de') ||
      url.hostname.endsWith('photon.komoot.io')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, event.resultingClientId));
    return;
  }

  if (TILE_HOST_RE.test(url.hostname)) {
    event.respondWith(tileFirst(req).catch(() => Response.error()));
    return;
  }

  // Satellite opzionale video 3D: tile Esri pesanti ma cacheabili (tetto OFM).
  if (url.hostname === 'server.arcgisonline.com') {
    event.respondWith(cacheFirst(req, OFM_CACHE, { max: OFM_MAX }).catch(() => Response.error()));
    return;
  }

  if (url.hostname === 'tiles.openfreemap.org' ||
      (url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/'))) {
    event.respondWith(cacheFirst(req, OFM_CACHE, { max: OFM_MAX }).catch(() => Response.error()));
    return;
  }

  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, LIB_CACHE).catch(() => Response.error()));
    return;
  }

  if (url.origin === self.location.origin) {
    // Rete prima: il codice app va servito fresco quando online (il
    // cache-first serviva versioni stantie di js/*, es. il muxer MP4 con
    // il vecchio import → "Muxer non caricato"). Offline → cache.
    const source = docSource.get(event.clientId);
    event.respondWith(
      caches.open(SHELL_CACHE).then(async cache => {
        // Pagina servita dalla cache: i suoi moduli dalla stessa cache, senza
        // aspettare una rete che per la navigazione si e' gia' rivelata lenta.
        if (source === 'cache') {
          const hit = await cache.match(req);
          if (hit) return hit;
        }
        let res;
        try { res = await fetchWithTimeoutSW(req, source === 'net' ? null : 2500); } catch (e) { res = null; }
        if (res && res.ok) {
          // Niente cache.put per URL con query string: ogni richiesta
          // cache-bustata moltiplicava le voci di SHELL_CACHE senza fine
          // (stesso motivo di networkFirst).
          try { if (!url.search) await cache.put(req, res.clone()); } catch (_) {}
          return res;
        }
        // 404/500 o rete giù: prima la cache; senza cache, alla pagina va lo
        // status vero (o l'errore di rete) invece di una Response vuota.
        const hit = await cache.match(req);
        if (hit) return hit;
        if (res) return res;
        throw new Error('rete non disponibile e cache vuota: ' + (req && req.url));
      })
    );
  }
});
