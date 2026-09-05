/* Service worker di Cruscotto Moto.

   Serve a due cose:
   - far partire l'app anche senza rete (in moto la copertura è quello che è);
   - tenere in cache Leaflet e le tile OSM già viste, così la mappa non sparisce
     appena si perde il segnale.

   Nessuna dipendenza esterna. Alzare CACHE_VERSION forza il rinnovo. */

'use strict';

const CACHE_VERSION = 'v6';
const SHELL_CACHE = 'cruscotto-shell-' + CACHE_VERSION;
const LIB_CACHE   = 'cruscotto-lib-' + CACHE_VERSION;
const TILE_CACHE  = 'cruscotto-tiles-' + CACHE_VERSION;
const OFM_CACHE   = 'cruscotto-ofm-' + CACHE_VERSION;
const OFM_MAX = 1000;

const SHELL = [
  './',
  './index.html',
  './js/core.js',
  './js/geo.js',
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
  './js/inputs.js',
  './js/nav-ui.js',
  './js/nav-config.js',
  './js/video.js',
  './js/sensor-src.js',
  './js/cam-map.js',
  './js/nav-map.js',
  './js/log-session.js',
  './js/video3d.js',
  './js/map.js',
  './js/diag.js',
  './js/net-base.js',
  './js/draw.js',
  './viewer.html',
  './manifest.webmanifest',
];

const LIB_HOSTS = ['unpkg.com'];
const TILE_HOST_RE = /\.tile\.openstreetmap\.org$/;
const TILE_MAX = 800; // tetto approssimativo di tile conservate

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll fallisce in blocco se una sola risorsa manca: si va a una a una.
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
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
    if (opts && opts.max) await trimCache(cacheName, opts.max);
  }
  return res;
}

/* Navigazioni: rete prima (così un deploy nuovo arriva subito), cache se offline. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try { await cache.put(req, res.clone()); } catch (_) {}
    }
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
    event.respondWith(
      caches.open(SHELL_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) {
          // Aggiornamento in background: la prossima apertura avrà la versione nuova.
          fetch(req).then(async res => {
            if (res && res.ok) {
              try { await cache.put(req, res.clone()); } catch (_) {}
            }
          }).catch(() => {});
          return hit;
        }
        const res = await fetch(req);
        if (res && res.ok) {
          try { await cache.put(req, res.clone()); } catch (_) {}
        }
        return res;
      })
    );
  }
});
