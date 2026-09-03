import { test } from 'node:test';
import assert from 'node:assert';
import { api, resetState, vmSandbox } from './harness.mjs';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const { state, idb, els, saveSession, recoverChunks, haversine } = api;

async function initDb() {
  vmSandbox.indexedDB = createFakeIndexedDB();
  idb.db = null;
  await idb.open();
}

test('idb: schema e round-trip sessione/meta', async () => {
  resetState();
  await initDb();
  const sess = {
    id: 's1', meta: { startISO: '2024-01-01T00:00:00Z', maxSpeed: 100 },
    track: [{lat:45, lon:9}], rows: [{t:0}, {t:1}, {t:2}],
  };
  await idb.put(sess);
  const got = await idb.get('s1');
  assert.equal(got.meta.maxSpeed, 100);
  assert.equal(got.rows.length, 3);
  const metas = await idb.getMetas();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].points, 3); // meta leggera con conteggio righe
  const keys = await idb.keys();
  assert.deepEqual(keys, ['s1']);
});

test('idb: del rimuove sessione e meta', async () => {
  resetState();
  await initDb();
  await idb.put({ id: 's1', meta: { startISO: 'x' }, track: [], rows: [] });
  await idb.del('s1');
  assert.equal(await idb.get('s1'), null);
  assert.equal((await idb.getMetas()).length, 0);
});

test('idb: chunk e kv', async () => {
  resetState();
  await initDb();
  await idb.putChunk({ sid: 's1', seq: 0, rows: [{t:0}] });
  await idb.putChunk({ sid: 's1', seq: 1, rows: [{t:1}] });
  let chunks = await idb.getChunks();
  assert.equal(chunks.length, 2);
  await idb.clearChunks();
  chunks = await idb.getChunks();
  assert.equal(chunks.length, 0);
  await idb.kvPut('activeTrack', { sid: 's1', track: [{lat:1, lon:1}] });
  assert.equal((await idb.kvGet('activeTrack')).sid, 's1');
});

test('saveSession: costruisce e persiste la sessione', async () => {
  resetState();
  await initDb();
  const now = Date.now();
  state.sessionId = 's_test';
  state.session.startWall = now - 60000;
  state.session.endWall = now;
  state.session.maxSpeed = 120;
  state.session.maxLeanR = 40;
  state.session.maxLeanL = -35;
  state.session.distKm = 5.5;
  state.track = [{lat:45, lon:9}];
  state.rows = [{t:0, lean:10, speedKmh:60}];
  await saveSession();
  const sess = await idb.get('s_test');
  assert.equal(sess.rows.length, 1);
  assert.equal(sess.meta.maxSpeed, 120);
  assert.equal(sess.meta.maxLeanR, 40);
  assert.equal(sess.meta.maxLeanL, -35);
  assert.equal(sess.meta.distKm, 5.5);
  assert.equal(sess.meta.duration, 60);
  const metas = await idb.getMetas();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].points, 1);
});

test('recoverChunks: ricompone i chunk e recupera su click', async () => {
  resetState();
  await initDb();
  els.toasts.children = [];
  await idb.putChunk({ sid: 's1', seq: 0, startWall: 1000, rows: [{t:0, lean:-10, speedKmh:50}, {t:1, lean:20, speedKmh:60}] });
  await idb.putChunk({ sid: 's1', seq: 1, startWall: 1000, rows: [{t:2, lean:30, speedKmh:70}] });
  await idb.kvPut('activeTrack', { sid: 's1', startWall: 1000, track: [{lat:45,lon:9},{lat:45.001,lon:9},{lat:45.002,lon:9}] });
  await recoverChunks();

  const toastEl = els.toasts.children[els.toasts.children.length - 1];
  assert.ok(toastEl, 'toast di recupero non creato');
  const p = toastEl.children[0];
  assert.ok(p.textContent.includes('3 campioni'), 'testo: ' + p.textContent);
  const row = toastEl.children[1];
  const no = row.children[0], yes = row.children[1];
  assert.equal(yes.textContent, 'Recupera');

  yes.click(); // invoca il gestore "Recupera"
  await new Promise(r => setTimeout(r, 40)); // attende idb.put + clearChunks async

  const sess = await idb.get('s1');
  assert.equal(sess.rows.length, 3);
  assert.equal(sess.meta.maxSpeed, 70);
  assert.equal(sess.meta.maxLeanR, 30);
  assert.equal(sess.meta.maxLeanL, -10); // maxLeanL = piega minima (sinistra, <= 0)
  assert.equal(sess.meta.recovered, true);
  assert.ok(sess.meta.distKm > 0.2 && sess.meta.distKm < 0.25, 'distKm: ' + sess.meta.distKm);
  assert.equal((await idb.getChunks()).length, 0); // chunk ripuliti dopo il recupero
});
