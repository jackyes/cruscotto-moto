// Righe del log in colonne (js/rows-codec.js) e il loro uso in js/storage.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { api, vmSandbox } from './harness.mjs';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const { idb } = api;
const s = vmSandbox;
const { encodeRows, decodeRows, migrateRowsFormat, buildCsv } = s;

async function initDb() {
  s.indexedDB = createFakeIndexedDB();
  idb.db = null;
  await idb.open();
}

// Una riga come quelle di snapshot() (js/log-core.js), con valori "sporchi".
function row(i) {
  return {
    t: i * 0.05, speedKmh: 87.123456789, speedMs: 24.2009602, speedStale: i % 7 ? 0 : 1,
    lean: -37.4123 + i * 1e-3, latG: 0.4321, lonG: -0.1, vertG: 1.0123, gyro: 12.345,
    vib: 0.0321, latFus: null, lonFus: 0.05, latPk: 0.6, lonPk: 0.2, vertPk: 1.3,
    pitch: 2.5, yaw: -8.25, speedFus: 24.123456789, leanKin: -36.9, vibHi: 0.01,
    vibRect: 0.00123, leanRef: i % 3 ? 'centrip' : 'gyro', gap: 0,
    lat: 45.853412345678, lon: 9.39112233445566, alt: 312.4, heading: 181.5, gpsAcc: 3.2,
  };
}
const rows = n => Array.from({ length: n }, (_, i) => row(i));

test('roundtrip: t, posizione e velocità esatti; sensori entro 1e-6; stringhe e null intatti', () => {
  const src = rows(500);
  const back = decodeRows(encodeRows(src));
  assert.equal(back.length, 500);
  assert.deepEqual(Object.keys(back[0]), Object.keys(src[0]), 'stesse chiavi, stesso ordine');
  for (let i = 0; i < src.length; i++) {
    const a = src[i], b = back[i];
    for (const k of ['t', 'lat', 'lon', 'speedKmh', 'speedMs', 'speedFus']) assert.equal(b[k], a[k], k);
    for (const k of ['lean', 'latG', 'gyro', 'alt', 'heading', 'vibRect', 'gap', 'speedStale']) {
      assert.ok(Math.abs(b[k] - a[k]) <= 2e-6 * Math.max(1, Math.abs(a[k])), k + ': ' + a[k] + ' → ' + b[k]);
    }
    assert.equal(b.leanRef, a.leanRef);
    assert.equal(b.latFus, null);
  }
});

test('sensori riletti con numeri corti: niente 0.10000000149011612 nel backup', () => {
  const back = decodeRows(encodeRows([{ t: 0, lonG: -0.1, vib: 0.0321 }]));
  assert.equal(JSON.stringify(back[0]), '{"t":0,"lonG":-0.1,"vib":0.0321}');
});

test('CSV identico prima e dopo la codifica sulle colonne esatte', () => {
  const src = rows(200);
  const back = decodeRows(encodeRows(src));
  const colsOf = (csv, idx) => csv.split('\n').filter(l => /^\d/.test(l)).map(l => idx.map(i => l.split(',')[i]).join(','));
  // t, speed_kmh, speed_ms, lat, lon: sempre uguali.
  const exact = [0, 1, 2, 15, 16];
  assert.deepEqual(colsOf(buildCsv(back, {}), exact), colsOf(buildCsv(src, {}), exact));
});

test('casi limite: NaN → null, Infinity resta, chiavi assenti restano assenti, tipi misti senza perdita', () => {
  const src = [
    { t: 0, a: NaN, b: Infinity, c: 1, m: 'x', o: { z: 1 } },
    { t: 1, a: 2, b: -Infinity, m: 3, o: null },
  ];
  const back = decodeRows(encodeRows(src));
  assert.equal(back[0].a, null);
  assert.equal(back[0].b, Infinity);
  assert.equal(back[1].b, -Infinity);
  assert.equal(back[0].c, 1);
  assert.ok(!('c' in back[1]), 'chiave assente non deve comparire');
  assert.equal(back[0].m, 'x');
  assert.equal(back[1].m, 3);
  assert.deepEqual(back[0].o, { z: 1 });
  assert.equal(back[1].o, null);
});

test('righe non oggetto: nessuna codifica; formato vecchio e input rotti in lettura', () => {
  assert.equal(encodeRows([{ t: 0 }, null]), null);
  assert.equal(encodeRows([{ t: 0 }, [1, 2]]), null);
  assert.equal(encodeRows('x'), null);
  const legacy = [{ t: 0, lean: 1.5 }];
  assert.equal(decodeRows(legacy), legacy, 'array vecchio restituito com\'è');
  // .length e non deepEqual: gli array arrivano dal realm del vm (prototipi diversi).
  assert.equal(decodeRows(null).length, 0);
  assert.equal(decodeRows({ v: 99 }).length, 0);
  assert.equal(decodeRows(encodeRows([])).length, 0);
});

test('dimensione: un\'ora di log almeno 3 volte più piccola serializzata', () => {
  const src = rows(72000);
  const before = v8.serialize(src).length;
  const after = v8.serialize(encodeRows(src)).length;
  assert.ok(after * 3 < before, (before / 1e6).toFixed(1) + ' MB → ' + (after / 1e6).toFixed(1) + ' MB');
});

test('idb: put salva colonne, get restituisce righe; il chiamante non viene toccato', async () => {
  await initDb();
  const sess = { id: 'x', meta: { startISO: '2024-01-01T00:00:00Z' }, track: [{ lat: 45, lon: 9 }], rows: rows(50) };
  await idb.put(sess);
  assert.ok(Array.isArray(sess.rows) && !('rowsCol' in sess), 'oggetto del chiamante modificato');
  const raw = await idb._getRaw('x');
  assert.ok(raw.rowsCol && !('rows' in raw), 'su disco devono esserci le colonne');
  const got = await idb.get('x');
  assert.equal(got.rows.length, 50);
  assert.ok(!('rowsCol' in got));
  assert.equal(got.rows[10].t, sess.rows[10].t);
  assert.equal((await idb.getMetas())[0].points, 50);
});

test('idb: chunk di recupero in colonne, riletti come righe', async () => {
  await initDb();
  await idb.putChunk({ sid: 's1', seq: 0, startWall: 1, rows: rows(20), track: [] });
  const [c] = await idb.getChunks();
  assert.equal(c.sid, 's1');
  assert.equal(c.rows.length, 20);
  assert.equal(c.rows[19].t, rows(20)[19].t);
});

test('migrazione: i giri vecchi passano in colonne, una volta sola, e si ferma su pause()', async () => {
  await initDb();
  // Record del formato vecchio scritti "a mano", senza passare da put.
  const legacy = id => ({ id, meta: { startISO: '2024-01-01T00:00:00Z' }, track: [], rows: rows(30) });
  await idb._tx('sessions', 'readwrite', tx => {
    tx.objectStore('sessions').put(legacy('a'));
    tx.objectStore('sessions').put(legacy('b'));
  });
  assert.equal(await migrateRowsFormat(() => true), 0, 'con pause() vero non tocca nulla');
  assert.ok(Array.isArray((await idb._getRaw('a')).rows));
  assert.equal(await migrateRowsFormat(), 2);
  for (const id of ['a', 'b']) {
    const raw = await idb._getRaw(id);
    assert.ok(raw.rowsCol && !raw.rows, id + ' non convertito');
    assert.equal((await idb.get(id)).rows.length, 30);
  }
  assert.equal(await migrateRowsFormat(), 0, 'flag in kv: niente seconda passata');
});
