/* Service worker di Cruscotto Moto.

   Serve a due cose:
   - far partire l'app anche senza rete (in moto la copertura è quello che è);
   - tenere in cache Leaflet e le tile OSM già viste, così la mappa non sparisce
     appena si perde il segnale.

   Nessuna dipendenza esterna. Alzare CACHE_VERSION forza il rinnovo. */

'use strict';

const CACHE_VERSION = 'v4';
const SHELL_CACHE = 'cruscotto-shell-' + CACHE_VERSION;
const LIB_CACHE   = 'cruscotto-lib-' + CACHE_VERSION;
const TILE_CACHE  = 'cruscotto-tiles-' + CACHE_VERSION;

const SHELL = [
  './',
  './index.html',
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
                         k !== SHELL_CACHE && k !== LIB_CACHE && k !== TILE_CACHE)
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
    cache.put(req, res.clone());
    if (opts && opts.max) trimCache(cacheName, opts.max);
  }
  return res;
}

/* Navigazioni: rete prima (così un deploy nuovo arriva subito), cache se offline. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
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
      url.hostname.endsWith('photon.komoot.io')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  if (TILE_HOST_RE.test(url.hostname)) {
    event.respondWith(cacheFirst(req, TILE_CACHE, { max: TILE_MAX }).catch(() => Response.error()));
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
          fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
          return hit;
        }
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});
