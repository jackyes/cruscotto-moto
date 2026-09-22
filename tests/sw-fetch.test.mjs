import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSrc = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');

const ORIGIN = 'https://moto.test';

class FakeRequest {
  constructor(url, init = {}) {
    this.url = new URL(url, ORIGIN + '/').href;
    this.method = 'GET';
    this.mode = init.mode || 'cors';
    this.cache = init.cache || 'default';
  }
}
class FakeResponse {
  constructor(body, status = 200, type = 'basic') { this.body = body; this.status = status; this.ok = status >= 200 && status < 300; this.type = type; }
  clone() { return new FakeResponse(this.body, this.status, this.type); }
}

/* Worker finto: una sola cache condivisa (i nomi non contano per questi test) e
   una fetch pilotata dal test. `net(url)` restituisce la Promise della risposta. */
function loadSw(net) {
  const handlers = {};
  const store = new Map();
  const cache = {
    match: async r => store.get(typeof r === 'string' ? new URL(r, ORIGIN + '/').href : r.url),
    // Come la Cache API: put su una chiave esistente la sposta in fondo.
    put: async (r, res) => { const k = r.url; store.delete(k); store.set(k, res); },
    add: async r => { cache.added.push(r); },
    keys: async () => Array.from(store.keys(), url => ({ url })),
    delete: async r => store.delete(typeof r === 'string' ? new URL(r, ORIGIN + '/').href : r.url),
    added: [],
  };
  const fetchCalls = [];
  const sandbox = {
    self: { addEventListener: (t, h) => { handlers[t] = h; }, location: { origin: ORIGIN }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: (req, init) => { fetchCalls.push({ url: req.url, init }); return net(req.url, init); },
    Request: FakeRequest, Response: { error: () => new FakeResponse(null, 0) },
    URL, AbortController, setTimeout, clearTimeout, console, Promise, Map, Date, Error,
  };
  vm.runInNewContext(swSrc, sandbox);
  function dispatch(url, { mode = 'cors', clientId = '', resultingClientId = '' } = {}) {
    let p;
    handlers.fetch({ request: new FakeRequest(url, { mode }), clientId, resultingClientId, respondWith: x => { p = x; } });
    return p;
  }
  return { handlers, store, cache, fetchCalls, dispatch };
}

const OLD = 'old', NEW = 'new';
const abortable = (url, init) => new Promise((_, rej) => {
  init && init.signal && init.signal.addEventListener('abort', () => rej(new Error('abort')));
});

test('sw: pagina dalla rete, modulo lento → aspetta la rete, niente js del deploy vecchio', async () => {
  let resolveJs;
  const sw = loadSw(url => url.endsWith('/js/display.js')
    ? new Promise(r => { resolveJs = r; })
    : Promise.resolve(new FakeResponse(NEW)));
  sw.store.set(ORIGIN + '/js/display.js', new FakeResponse(OLD));

  const doc = await sw.dispatch(ORIGIN + '/', { mode: 'navigate', resultingClientId: 'A' });
  assert.equal(doc.body, NEW);

  const js = sw.dispatch(ORIGIN + '/js/display.js', { clientId: 'A' });
  // Nessun timer armato (signal assente, sotto): con il vecchio fallback a 2,5 s
  // la risposta sarebbe stata OLD.
  let settled = false; js.then(() => { settled = true; });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(settled, false, 'non deve ripiegare sulla cache mentre la rete risponde');
  const call = sw.fetchCalls.find(c => c.url.endsWith('/js/display.js'));
  assert.equal(call.init.signal, undefined, 'nessun timeout per i moduli di una pagina fresca');
  assert.equal(call.init.cache, 'no-cache');
  resolveJs(new FakeResponse(NEW));
  assert.equal((await js).body, NEW);
  assert.equal(sw.store.get(ORIGIN + '/js/display.js').body, NEW, 'la cache si allinea al deploy nuovo');
});

test('sw: pagina dalla rete, rete che cade davvero → cache (offline resta usabile)', async () => {
  const sw = loadSw(url => url.endsWith('/js/display.js')
    ? Promise.reject(new TypeError('offline'))
    : Promise.resolve(new FakeResponse(NEW)));
  sw.store.set(ORIGIN + '/js/display.js', new FakeResponse(OLD));
  await sw.dispatch(ORIGIN + '/', { mode: 'navigate', resultingClientId: 'A' });
  assert.equal((await sw.dispatch(ORIGIN + '/js/display.js', { clientId: 'A' })).body, OLD);
});

test('sw: pagina dalla cache (rete lenta) → i moduli dalla stessa cache, senza toccare la rete', async () => {
  const sw = loadSw(abortable);
  sw.store.set(ORIGIN + '/', new FakeResponse(OLD));
  sw.store.set(ORIGIN + '/js/display.js', new FakeResponse(OLD));
  const doc = await sw.dispatch(ORIGIN + '/', { mode: 'navigate', resultingClientId: 'B' });
  assert.equal(doc.body, OLD, 'navigazione in timeout → shell in cache');
  const before = sw.fetchCalls.length;
  assert.equal((await sw.dispatch(ORIGIN + '/js/display.js', { clientId: 'B' })).body, OLD);
  assert.equal(sw.fetchCalls.length, before, 'nessuna fetch: la pagina e il modulo sono dello stesso deploy');
});

test('sw: pagina dalla cache, modulo assente in cache → lo prende dalla rete', async () => {
  // Navigazione che fallisce subito: pagina marcata "cache" senza attendere i 2,5 s.
  const sw = loadSw(url => url.endsWith('/') ? Promise.reject(new TypeError('x')) : Promise.resolve(new FakeResponse(NEW)));
  sw.store.set(ORIGIN + '/', new FakeResponse(OLD));
  await sw.dispatch(ORIGIN + '/', { mode: 'navigate', resultingClientId: 'C' });
  assert.equal((await sw.dispatch(ORIGIN + '/js/nuovo.js', { clientId: 'C' })).body, NEW);
});

test('sw: client sconosciuto (worker riavviato) → comportamento classico con timeout', async () => {
  const sw = loadSw(() => Promise.resolve(new FakeResponse(NEW)));
  await sw.dispatch(ORIGIN + '/js/display.js', { clientId: 'ignoto' });
  const call = sw.fetchCalls[0];
  assert.ok(call.init.signal, 'senza sapere da dove viene la pagina resta il timeout');
});

test('sw: il precache all\'install scavalca la HTTP cache', async () => {
  const sw = loadSw(() => Promise.resolve(new FakeResponse(NEW)));
  let done;
  sw.handlers.install({ waitUntil: p => { done = p; } });
  await done;
  assert.ok(sw.cache.added.length > 10);
  for (const r of sw.cache.added) assert.equal(r.cache, 'reload', r.url);
});

// ---- tile OSM ----
const TILE = 'https://tile.openstreetmap.org/15/17300/11700.png';
const flush = () => new Promise(r => setTimeout(r, 0));

test('sw tile: hit servito dalla cache e spostato in fondo (LRU approssimato)', async () => {
  const sw = loadSw(() => Promise.reject(new Error('rete non attesa')));
  sw.store.set(TILE, new FakeResponse('casa'));
  sw.store.set('https://tile.openstreetmap.org/15/1/1.png', new FakeResponse('altra'));
  assert.equal((await sw.dispatch(TILE)).body, 'casa');
  await flush();
  const keys = Array.from(sw.store.keys());
  assert.equal(keys[keys.length - 1], TILE, 'la tile appena usata non deve essere la prossima scartata');
  assert.equal(sw.fetchCalls.length, 0);
});

test('sw tile: tile dei vecchi sottodomini a./b./c. migrata alla chiave nuova, senza rete', async () => {
  const sw = loadSw(() => Promise.reject(new Error('rete non attesa')));
  const legacy = 'https://b.tile.openstreetmap.org/15/17300/11700.png';
  sw.store.set(legacy, new FakeResponse('vecchia'));
  assert.equal((await sw.dispatch(TILE)).body, 'vecchia');
  assert.ok(sw.store.has(TILE), 'chiave nuova scritta');
  assert.ok(!sw.store.has(legacy), 'chiave vecchia rimossa');
  assert.equal(sw.fetchCalls.length, 0);
});

test('sw tile: risposta opaca in cache inutilizzabile da una richiesta CORS → riscaricata', async () => {
  const sw = loadSw(() => Promise.resolve(new FakeResponse('cors')));
  sw.store.set(TILE, new FakeResponse('', 0, 'opaque'));
  sw.store.set('https://a.tile.openstreetmap.org/15/17300/11700.png', new FakeResponse('', 0, 'opaque'));
  assert.equal((await sw.dispatch(TILE)).body, 'cors');
  assert.equal(sw.fetchCalls.length, 1);
  assert.equal(sw.store.get(TILE).type, 'basic', 'in cache ora la risposta CORS');
  assert.ok(!sw.store.has('https://a.tile.openstreetmap.org/15/17300/11700.png'), 'opaca vecchia scartata');
});

test('sw tile: senza cache si va in rete e si salva', async () => {
  const sw = loadSw(() => Promise.resolve(new FakeResponse('rete')));
  assert.equal((await sw.dispatch(TILE)).body, 'rete');
  assert.equal(sw.store.get(TILE).body, 'rete');
});

test('mappa: tile da tile.openstreetmap.org in CORS, CSP allineata', () => {
  const root = join(__dirname, '..');
  for (const f of ['js/map.js', 'viewer.html']) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.ok(src.includes("'https://tile.openstreetmap.org/{z}/{x}/{y}.png'"), f + ': URL senza sottodominio');
    assert.ok(!src.includes('{s}.tile.openstreetmap.org'), f + ': sottodomini a/b/c residui');
    assert.match(src, /tile\.openstreetmap\.org[^]*?crossOrigin: true/, f + ': crossOrigin mancante');
  }
  for (const f of ['index.html', 'viewer.html']) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.match(src, /img-src[^;]*https:\/\/tile\.openstreetmap\.org[ ;]/, f + ': CSP senza tile.openstreetmap.org');
  }
});
