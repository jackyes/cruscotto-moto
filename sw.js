/* Service worker di Cruscotto Moto.

   Serve a due cose:
   - far partire l'app anche senza rete (in moto la copertura è quello che è);
   - tenere in cache Leaflet e le tile OSM già viste, così la mappa non sparisce
     appena si perde il segnale.

   Nessuna dipendenza esterna. Alzare CACHE_VERSION rinnova lo shell (codice app);
   alzare MAP_VERSION invalida tile/liberty/satellite (cancella quelle scaricate). */

'use strict';

const CACHE_VERSION = 'v15';   // shell (codice app): alzare per forzare il rinnovo
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
  './js/core.js',
  './js/geo.js',
  './js/curvy.js',
  './js/csv.js',
  './js/osrm-text.js',
  './js/parse.js',
  './js/sensors-core.js',
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
  './js/draw.js',
  './js/share.js',
  './viewer.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
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
const TILE_HOST_RE = /\.tile\.openstreetmap\.org$/;
const TILE_MAX = 800; // tetto approssimativo di tile conservate

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE)
        // addAll fallisce in blocco se una sola risorsa manca: si va a una a una.
        .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {
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
  // Le tile OSM arrivano in CORS: si conservano solo risposte valide.
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

/* fetch con timeout: su rete presente ma lentissima (galleria, zona rurale — il
   caso comune in moto, non l'offline netto) senza timeout l'app restava bloccata
   a lungo prima di ripiegare sulla cache già disponibile. */
async function fetchWithTimeoutSW(req, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(req, { signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/* Navigazioni: rete prima (così un deploy nuovo arriva subito), cache se offline.
   Una risposta NON-ok (404/500: glitch server durante un deploy) va trattata come
   errore: restituirla significava mostrare la pagina d'errore anche se la cache
   aveva la shell funzionante. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetchWithTimeoutSW(req, 2500);
    if (!res || !res.ok) throw new Error('bad status ' + (res ? res.status : 'null'));
    // Niente cache.put per URL con query string: le navigazioni cache-bustate
    // (index.html?v=…) moltiplicavano le voci di SHELL_CACHE senza fine.
    try { if (!new URL(req.url).search) await cache.put(req, res.clone()); } catch (_) {}
    return res;
  } catch (e) {
    const hit = await cache.match(req) || await cache.match('./index.html');
    if (hit) return hit;
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
    event.respondWith(networkFirst(req));
    return;
  }

  if (TILE_HOST_RE.test(url.hostname)) {
    event.respondWith(cacheFirst(req, TILE_CACHE, { max: TILE_MAX }).catch(() => Response.error()));
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
    event.respondWith(
      caches.open(SHELL_CACHE).then(async cache => {
        let res;
        try { res = await fetchWithTimeoutSW(req, 2500); } catch (e) { res = null; }
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
