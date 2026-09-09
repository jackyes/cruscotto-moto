// Test regressione Fase A: bug HIGH trovati nell'audit (nav-net offline/token,
// voce nav, addListeners doppio, idb onversionchange, flush/trim race, video
// fallback/ghost). Un file per fase: stubs globali per-process (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';

const { state, els, idb, MAX_ROWS, navSpeak } = api;
const s = vmSandbox;

// ---- stubs DOM/rete comuni (i reali toccano mappa/idb non disponibili qui) ----
s.navDrawRoute = () => {};
s.navFitRoute = () => {};
s.navRenderBanner = () => {};
s.renderNavPanel = () => {};
s.navPersistRoute = async () => {};
s.toast = () => {};
s.navGate = fn => fn();

// ---- helper polyline6 (come nav-osrm.test.mjs) ----
function encodeDelta(d) {
  let v = d < 0 ? ~(d << 1) : (d << 1);
  let out = '';
  while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
  return out + String.fromCharCode(v + 63);
}
function encodePolyline6(points) {
  let pLat = 0, pLon = 0, out = '';
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    out += encodeDelta(la - pLat) + encodeDelta(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}
const SHAPE = encodePolyline6([[45, 9], [45.001, 9], [45.002, 9], [45.003, 9]]);

function valTrip() {
  return { legs: [{ shape: SHAPE, maneuvers: [
    { type: 0, instruction: 'Parti', verbal_pre_transition_instruction: 'Parti',
      begin_shape_index: 0, end_shape_index: 1, time: 10 },
    { type: 2, instruction: 'Destra', verbal_pre_transition_instruction: 'Gira a destra',
      begin_shape_index: 1, end_shape_index: 3, time: 20 },
  ] }] };
}
function valResp() {
  const t = valTrip(); t.status = 0;
  return { trip: t };
}

function pre2d() {
  return { res: [320, 240], rows: [], track: [], mapPts: [], spark: { pts: [], min: 0, max: 1 },
    dist: new Float64Array(1), tEnd: 10, speedMax: 60, slow: { base: 1 }, sat: false, buildings: false };
}

// ---- A1: ramo cache stale offline ----
test('A1: cache stale offline → state.nav inizializzato, navAnnounce non lancia', async () => {
  resetState();
  s.cacheGetFresh = async () => ({ stale: true, body: { trip: valTrip(), engine: 'Valhalla' } });
  s.fetchWithTimeout = async () => { throw new Error('offline'); };
  state.navDest = { lat: 45.003, lon: 9, label: 'casa' };
  await s.navRequestRoute({ lat: 45, lon: 9 }, state.navDest, null, 'test');
  const nv = state.nav;
  assert.ok(nv, 'state.nav non impostato');
  assert.equal(nv.nextMan, 1, 'nextMan mancante → man[undefined] in navAnnounce');
  assert.equal(nv.idx, 0);
  assert.equal(nv.sAlong, 0);
  assert.equal(nv.spoken, 0);
  assert.equal(nv.status, 'ACTIVE');
  assert.ok(nv.man && nv.man.length === 2);
  assert.doesNotThrow(() => s.navAnnounce(nv, 12));
});

// ---- A5: identità richiesta ----
test('A5: risposta vecchia non sovrascrive la rotta nuova', async () => {
  resetState();
  s.cacheGetFresh = async () => null;
  let call = 0;
  const pendings = [];
  s.fetchWithTimeout = async () => {
    call++;
    if (call === 1) return new Promise(res => pendings.push(res));
    return { ok: true, json: async () => valResp() };
  };
  const dest1 = { lat: 45.003, lon: 9, label: 'una' };
  const dest2 = { lat: 45.002, lon: 9.001, label: 'due' };
  state.navDest = dest1;
  const p1 = s.navRequestRoute({ lat: 45, lon: 9 }, dest1, null, 'a'); // resta in volo
  state.navDest = dest2;
  await s.navRequestRoute({ lat: 45, lon: 9 }, dest2, null, 'b');      // risolve subito
  assert.equal(state.nav.dest.label, 'due');
  pendings[0]({ ok: true, json: async () => valResp() });              // la prima arriva ora
  await p1;
  assert.equal(state.nav.dest.label, 'due', 'la risposta vecchia ha vinto');
});

test('A5: risposta dopo navStop non resuscita la rotta', async () => {
  resetState();
  s.cacheGetFresh = async () => null;
  s.fetchWithTimeout = async () => ({ ok: true, json: async () => valResp() });
  state.navDest = null;              // navStop ha azzerato tutto
  await s.navRequestRoute({ lat: 45, lon: 9 }, { lat: 45.003, lon: 9 }, null, 'c');
  assert.equal(state.nav, null);
});

// ---- A4: spoken bits solo su say() accettata ----
test('A4: bit spoken commessi solo se say() accetta il cue', () => {
  resetState();
  // In vm il bare `speechSynthesis` è una proprietà del global sandbox
  // (nella window mockata non vale): stub su entrambi come fa nav-map.js.
  const tts = {
    speak() {}, cancel() {},
    getVoices() { return [{ lang: 'it-IT', localService: true }]; },
  };
  s.window.speechSynthesis = tts;
  s.speechSynthesis = tts;
  s.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  state.navVoice = true;
  const nv = s.navBuild(valTrip());
  nv.status = 'ACTIVE'; nv.nextMan = 1; nv.spoken = 0;
  nv.distToNext = 500; nv.preSpoken = {};           // 500 m ≤ clamp(12*55) → fascia far
  navSpeak.busy = true; navSpeak.prio = 4;          // canale occupato, prio più alta
  s.navAnnounce(nv, 12);
  assert.equal(nv.spoken, 0, 'cue scartato per busy: i bit non si consumano');
  navSpeak.busy = false; navSpeak.prio = -1;
  s.navAnnounce(nv, 12);
  assert.equal(nv.spoken, 1, 'accettata: bit far commesso');
  delete s.window.speechSynthesis;
  delete s.speechSynthesis;
  delete s.SpeechSynthesisUtterance;
});

// ---- A6: addListeners idempotente ----
test('A6: doppia addListeners non duplica le sorgenti sensori', () => {
  resetState();
  let n = 0;
  const g0 = s.startGenericSensors, d0 = s.startDeviceMotion;
  s.startGenericSensors = () => { n++; return false; };
  s.startDeviceMotion = () => { n++; return true; };
  s.addListeners();
  const first = n;                   // 2: una per sorgente
  assert.ok(first >= 1, 'nessun aggancio al primo giro');
  s.addListeners();
  s.addListeners();
  assert.equal(n, first, 'agganci duplicati: ' + n + ' vs ' + first);
  s.startGenericSensors = g0;
  s.startDeviceMotion = d0;
});

// ---- A2: onversionchange riapre il DB ----
test('A2: onversionchange chiude e RIAPRE (niente DB morto)', async () => {
  resetState();
  const { createFakeIndexedDB } = await import('./fake-indexeddb.mjs');
  s.indexedDB = createFakeIndexedDB();
  idb.db = null;
  await idb.open();
  idb.db.onversionchange();          // bump versione da altra scheda (simulato)
  assert.equal(idb.db, null);
  await new Promise(r => setTimeout(r, 10));
  assert.ok(idb.db, 'db non riaperto dopo onversionchange');
  await idb._tx(['kv'], 'readwrite', tx => { tx.objectStore('kv').put({ k: 't', v: 1 }); });
});

// ---- A8: flush/trim ----
test('A8: trim sospeso durante un flush in volo', () => {
  resetState();
  state.logging = true;
  state.session.startWall = Date.now() - 1000;
  const base = MAX_ROWS + 20;
  state.rows = Array.from({ length: base }, (_, i) => ({ t: i }));
  state.flushedRows = base;          // tutto flushato: il trim avrebbe fretta
  state._flushing = true;
  s.sampleTick();
  assert.equal(state.rows.length, base + 1, 'trim eseguito durante il flush');
  state._flushing = false;
  s.sampleTick();
  assert.ok(state.rows.length <= base - 1, 'trim non ripreso: ' + state.rows.length);
});

test('A8: flushedRows avanza col chunk; kvPut fallito non riaccoda; sid catturato', async () => {
  resetState();
  const origPut = idb.putChunk, origKv = idb.kvPut;
  let chunkSid = null, chunkRows = null, kvSid = null, kvCalled = 0;
  idb.putChunk = async c => {
    chunkSid = c.sid; chunkRows = c.rows;
    await new Promise(r => setTimeout(r, 5));
    state.sessionId = 'sid2';        // startLog scatta durante la scrittura
  };
  idb.kvPut = async (k, v) => { kvCalled++; kvSid = v.sid; throw new Error('quota'); };
  state.sessionId = 'sid1';
  state.session.startWall = 123;
  state.track = [{ lat: 45, lon: 9 }];
  state.rows = [{ t: 0 }, { t: 1 }, { t: 2 }];
  state.flushedRows = 0;
  try {
    await s.flushLog();
    assert.equal(chunkSid, 'sid1');
    assert.equal(chunkRows.length, 3);
    assert.equal(state.flushedRows, 3, 'flushedRows non avanzato subito dopo il chunk');
    assert.equal(state._flushFailN || 0, 0, 'kvPut fallito contato come quota');
    assert.equal(kvSid, 'sid1', 'track attaccata al sid nuovo');
    assert.equal(kvCalled, 1);
  } finally {
    idb.putChunk = origPut;
    idb.kvPut = origKv;
  }
});

// ---- A3/A7: fallback video e ghost render ----
test('A3: muxer MP4 assente → reject (il catch di startVideoRender fa il fallback)', async () => {
  resetState();
  s.videoMp4Supported = () => true;
  els.videoModal._session = { id: 'x' };
  const orig = s.loadMp4Muxer;
  s.loadMp4Muxer = async () => { throw new Error('rete giù'); };   // CDN irraggiungibile
  try {
    await assert.rejects(() => s.startVideoRenderMp4(pre2d(), '2d'), /muxer MP4 non caricato/);
  } finally {
    s.loadMp4Muxer = orig;
  }
});

test('A7: modale chiusa durante il setup → nessun muxer toccato, promise risolta', async () => {
  resetState();
  s.videoMp4Supported = () => true;
  els.videoModal._session = null;    // Esc durante il pick encoder
  let muxerTried = false;
  const orig = s.loadMp4Muxer;
  s.loadMp4Muxer = async () => { muxerTried = true; return null; };
  try {
    await s.startVideoRenderMp4(pre2d(), '2d');
    assert.equal(muxerTried, false, 'setup proseguito a modale chiusa');
  } finally {
    s.loadMp4Muxer = orig;
  }
});
