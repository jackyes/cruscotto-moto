// Giri oltre MAX_ROWS (2,5 h a 20 Hz): sampleTick taglia da state.rows le righe
// già scritte nei chunk. Il salvataggio deve ricomporle, non perdere l'inizio.
// Più la richiesta di storage persistente e la riga spazio dello Storico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const { state, idb, els, MAX_ROWS, saveSession } = api;
const s = vmSandbox;
s.toast = () => ({ remove() {} });

async function initDb() {
  s.indexedDB = createFakeIndexedDB();
  idb.db = null;
  await idb.open();
}

// Simula un log: una riga ogni 50 ms di tempo sessione, flush ogni 10 s.
async function ride(nRows) {
  let i = 0;
  const origSnap = s.snapshot;
  s.snapshot = () => ({ t: (i++) * 0.05 });
  try {
    for (let k = 0; k < nRows; k++) {
      s.sampleTick();
      if (k % 200 === 199) await s.flushLog();
    }
  } finally { s.snapshot = origSnap; }
}

function startSession(sid) {
  resetState();
  state.logging = true;
  state.sessionId = sid;
  state.flushSeq = 0;
  state.flushedRows = 0;
  state._rowsTrimmed = 0;
  state.session.startWall = Date.now() - 1000;
  state.rows = [];
}

test('giro oltre MAX_ROWS: il salvataggio contiene tutte le righe, in ordine e senza doppioni', async () => {
  await initDb();
  startSession('s_lungo');
  const n = MAX_ROWS + 25000;
  await ride(n);
  assert.ok(state._rowsTrimmed > 0, 'il trim deve essere scattato');
  assert.ok(state.rows.length < n, 'in memoria resta solo la coda');
  // Come stopLog: righe in coda non ancora flushate, poi flush e salvataggio.
  state.logging = false;
  await s.flushLog();
  await saveSession();
  const saved = await idb.get('s_lungo');
  assert.equal(saved.rows.length, n, 'righe salvate: ' + saved.rows.length);
  for (let k = 1; k < saved.rows.length; k++) {
    if (!(saved.rows[k].t > saved.rows[k - 1].t)) assert.fail('ordine/doppione alla riga ' + k);
  }
  assert.equal(saved.rows[0].t, 0, 'l\'inizio del giro deve esserci');
  assert.equal((await idb.getChunks()).length, 0, 'chunk cancellati dopo il salvataggio completo');
});

test('coda non flushata e chunk di altre sessioni: presa la coda, ignorati gli altri sid', async () => {
  await initDb();
  await idb.putChunk({ sid: 'altro', seq: 0, rows: [{ t: -1 }], track: [] });
  startSession('s_coda');
  await ride(MAX_ROWS + 5000);
  // Niente flush finale: le ultime righe esistono solo in memoria.
  state.logging = false;
  const full = await s.sessionRowsForSave();
  assert.equal(full.length, MAX_ROWS + 5000);
  assert.ok(!full.some(r => r.t === -1), 'righe di un altro sid non devono entrare');
});

test('chunk illeggibili: salva la coda ma NON cancella i chunk (il recupero può completare)', async () => {
  await initDb();
  startSession('s_err');
  await ride(MAX_ROWS + 5000);
  state.logging = false;
  const origGet = idb.getChunks;
  let cleared = false;
  const origClear = idb.clearChunks;
  idb.getChunks = async () => { throw new Error('idb rotto'); };
  idb.clearChunks = async () => { cleared = true; };
  try {
    await saveSession();
  } finally { idb.getChunks = origGet; idb.clearChunks = origClear; }
  assert.equal(cleared, false, 'i chunk sono l\'unica copia dell\'inizio del giro');
  assert.equal((await idb.get('s_err')).rows.length, state.rows.length);
});

test('giro corto: nessuna lettura dei chunk, salva state.rows', async () => {
  await initDb();
  startSession('s_corto');
  await ride(1000);
  state.logging = false;
  let read = false;
  const origGet = idb.getChunks;
  idb.getChunks = async () => { read = true; return []; };
  try { await saveSession(); } finally { idb.getChunks = origGet; }
  assert.equal(read, false);
  assert.equal((await idb.get('s_corto')).rows.length, 1000);
});

test('requestPersistentStorage: chiede persist solo se non già concesso, mai un errore', async () => {
  let asked = 0;
  s.navigator = { storage: { persisted: async () => false, persist: async () => { asked++; return true; } } };
  assert.equal(await s.requestPersistentStorage(), true);
  assert.equal(asked, 1);
  s.navigator = { storage: { persisted: async () => true, persist: async () => { asked++; return true; } } };
  assert.equal(await s.requestPersistentStorage(), true);
  assert.equal(asked, 1, 'già persistente: niente nuova richiesta');
  s.navigator = {};
  assert.equal(await s.requestPersistentStorage(), null);
  s.navigator = { storage: { persist: async () => { throw new Error('x'); } } };
  assert.equal(await s.requestPersistentStorage(), null);
  s.navigator = {};
});

test('startLog chiede la persistenza', async () => {
  let asked = 0;
  const orig = s.requestPersistentStorage;
  s.requestPersistentStorage = async () => { asked++; return true; };
  try {
    resetState();
    s.startLog();
    state.logging = false;
  } finally { s.requestPersistentStorage = orig; }
  assert.equal(asked, 1);
});

test('renderStorageInfo: spazio usato e avviso se non protetto', async () => {
  // Il mock DOM ha un classList muto: qui serve vedere il toggle.
  const cls = new Set();
  els.histStorage.classList = { toggle(c, on) { if (on) cls.add(c); else cls.delete(c); }, contains: c => cls.has(c) };
  s.navigator = { storage: { persisted: async () => false, estimate: async () => ({ usage: 5 * 1024 * 1024 }) } };
  await s.renderStorageInfo();
  assert.equal(els.histStorage.hidden, false);
  assert.match(els.histStorage.textContent, /5\.0 MB/);
  assert.match(els.histStorage.textContent, /non protetto/);
  assert.ok(els.histStorage.classList.contains('warn'));
  s.navigator = { storage: { persisted: async () => true, estimate: async () => ({ usage: 0 }) } };
  await s.renderStorageInfo();
  assert.match(els.histStorage.textContent, /protetto dal browser/);
  assert.ok(!els.histStorage.classList.contains('warn'));
  s.navigator = {};
  await s.renderStorageInfo();
  assert.equal(els.histStorage.hidden, true, 'senza API la riga sparisce');
});
