import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const {
  idb, els, sessionTotals, sessKey, planRestore, parseBackup, buildBackupParts,
  restoreSessions, rowsForChart, renderHistory,
} = api;

async function initDb() {
  vmSandbox.indexedDB = createFakeIndexedDB();
  idb.db = null;
  await idb.open();
}

const meta = (startISO, over) =>
  Object.assign({ startISO, duration: 600, distKm: 20, maxSpeed: 100, maxLeanR: 30, maxLeanL: -28 }, over || {});
const sess = (id, startISO, over) => ({
  id, meta: meta(startISO, over), rows: [{ t: 0, speedKmh: 50, lean: 10 }], track: [],
});

test('sessionTotals: somma giri, km e secondi anche con campi sporchi', () => {
  // Un import di terzi può avere numeri come stringhe o mancare del tutto: il
  // riepilogo non deve lanciare (stessa lezione delle card dello Storico).
  const zero = sessionTotals([]);
  assert.equal(zero.n + '/' + zero.km + '/' + zero.sec, '0/0/0');
  const t = sessionTotals([
    { meta: { distKm: 12.5, duration: 3600 } },
    { meta: { distKm: '7.5', duration: '600' } },
    { meta: {} },
    { meta: { distKm: null, duration: undefined } },
  ]);
  assert.equal(t.n, 4);
  assert.equal(t.km, 20);
  assert.equal(t.sec, 4200);
});

test('sessKey: inizio + durata arrotondata identificano il giro', () => {
  assert.equal(sessKey(meta('2024-05-01T10:00:00Z', { duration: 600.4 })),
               sessKey(meta('2024-05-01T10:00:00Z', { duration: 600.2 })));
  assert.notEqual(sessKey(meta('2024-05-01T10:00:00Z')),
                  sessKey(meta('2024-05-01T11:00:00Z')));
  assert.equal(sessKey(null), '|0');
});

test('planRestore: aggiunge i giri mancanti, salta doppioni e voci malformate', () => {
  const existing = [sess('a', '2024-05-01T10:00:00Z')];
  const incoming = [
    sess('x', '2024-05-01T10:00:00Z'),        // già presente (stesso inizio/durata)
    sess('y', '2024-05-02T10:00:00Z'),        // nuovo
    sess('y', '2024-05-02T10:00:00Z'),        // doppione DENTRO il file
    { id: 'z', rows: [] },                    // senza meta
    { id: 'w', meta: meta('2024-05-03T10:00:00Z') }, // senza rows
    null,
  ];
  const { add, skip } = planRestore(existing, incoming);
  assert.deepEqual(Array.from(add, s => s.id), ['y']);
  assert.equal(skip.length, 5);
  // Nessun ingresso: tutto è nuovo tranne il malformato.
  assert.equal(planRestore([], incoming).add.length, 2);
});

test('parseBackup: accetta solo un backup con sessions, non si fida del resto', () => {
  assert.equal(parseBackup('non json'), null);
  assert.equal(parseBackup('null'), null);
  assert.equal(parseBackup('{"app":"altro","v":1}'), null);
  assert.equal(parseBackup('{"sessions":"nope"}'), null);
  assert.equal(parseBackup('{"sessions":[]}').length, 0);
  assert.equal(parseBackup('{"sessions":[{"id":"a"}]}').length, 1);
});

test('buildBackupParts: JSON valido che si rilegge, una parte per sessione', () => {
  const a = sess('a', '2024-05-01T10:00:00Z');
  const b = sess('b', '2024-05-02T10:00:00Z');
  // Una sessione non serializzabile non deve far fallire il backup intero.
  const rotto = { id: 'c', meta: meta('2024-05-03T10:00:00Z'), rows: [] };
  rotto.self = rotto;
  const { parts, n } = buildBackupParts([a, b, rotto], '2024-06-01T00:00:00Z');
  // Si copiano solo i campi noti (id/meta/rows/track): un riferimento circolare
  // in un campo estraneo non entra nel file, quindi non serve saltare nulla.
  assert.equal(n, 3);
  assert.equal(parts.length, 5, 'intestazione + 3 sessioni + chiusura');
  assert.equal(parts.join('').indexOf('"self"'), -1);
  const back = parseBackup(parts.join(''));
  assert.ok(back, 'il backup deve rileggersi');
  assert.deepEqual(Array.from(back, s => s.id), ['a', 'b', 'c']);
  assert.equal(back[0].meta.distKm, 20);
  assert.equal(back[0].rows.length, 1);
  // I campi assenti diventano array vuoti, non undefined: l'import li controlla.
  const senzaTrack = buildBackupParts([{ id: 'd', meta: meta('2024-05-04T10:00:00Z'), rows: [] }], 'x');
  assert.equal(parseBackup(senzaTrack.parts.join(''))[0].track.length, 0);
});

test('rowsForChart: solo righe disegnabili', () => {
  const rows = [{ t: 0 }, { t: NaN }, { t: 1 }, null, 'x', { t: Infinity }];
  assert.deepEqual(Array.from(rowsForChart(rows), r => r.t), [0, 1]);
  assert.equal(rowsForChart(null).length, 0);
  assert.equal(rowsForChart(undefined).length, 0);
});

test('storico: riepilogo e ripristino su IndexedDB', async () => {
  resetState();
  await initDb();
  await idb.put(sess('a', '2024-05-01T10:00:00Z', { distKm: 12.5, duration: 3600 }));
  await idb.put(sess('b', '2024-05-02T10:00:00Z', { distKm: 7.5, duration: 1800 }));

  assert.deepEqual(Array.from(await idb.keys()).sort(), ['a', 'b']);
  const t = sessionTotals(await idb.getMetas());
  assert.equal(t.n, 2);
  assert.equal(t.km, 20);
  assert.equal(t.sec, 5400);

  // Riepilogo a schermo: prima voce = numero di giri, e niente innerHTML.
  await renderHistory();
  assert.equal(els.histTotals.hidden, false);
  assert.equal(els.histTotals.children.length, 3);
  /* Nel DOM vero la voce legge "Giri 2" (testo + <b>): qui si controlla il <b>,
     perché il textContent del mock, quando ci sono figli, restituisce solo i
     figli. L'etichetta vive accanto al valore per il colore e il peso diversi. */
  const voci = Array.from({ length: 3 }, (_, i) => els.histTotals.children[i].children[0].textContent);
  assert.deepEqual(voci, ['2', '20.0 km', '1:30:00']);

  // Backup delle due sessioni, poi ripristino su uno storico che ne ha già una
  // e ne ha persa un'altra: torna solo quella mancante.
  const payload = { sessions: [await idb.get('a'), await idb.get('b')] };
  const file = { text: async () => JSON.stringify(payload) };
  await idb.del('a');
  assert.equal((await idb.getMetas()).length, 1);
  await restoreSessions(file);
  const after = Array.from(await idb.getMetas(), m => m.id).sort();
  assert.deepEqual(after, ['a', 'b'], 'mancante ripristinata, doppione saltato');
  assert.equal((await idb.get('a')).rows.length, 1, 'le righe tornano con la sessione');

  // File che non è un backup: nessuna scrittura, e lo storico resta com'era.
  const prima = (await idb.getMetas()).length;
  await restoreSessions({ text: async () => 'ciao' });
  assert.equal((await idb.getMetas()).length, prima);

  // Telefono nuovo: storico vuoto, e lo stesso file rimette tutto.
  await idb.del('a'); await idb.del('b');
  assert.equal((await idb.keys()).length, 0);
  await restoreSessions(file);
  assert.equal((await idb.getMetas()).length, 2);

  // Backup senza sessioni: nessuna scrittura e nessun lancio.
  await restoreSessions({ text: async () => '{"sessions":[]}' });
  assert.equal((await idb.getMetas()).length, 2);
  resetState();
});

test('toast: remove() anticipato annulla il timer di scadenza', () => {
  const { toast } = api;
  const cleared = [];
  const origClear = vmSandbox.clearTimeout;
  vmSandbox.clearTimeout = id => { cleared.push(id); origClear(id); };
  try {
    const t = toast('Preparo il backup…', null, 60000);
    assert.ok(els.toasts.children.includes(t));
    t.remove();
    assert.equal(cleared.length, 1, 'timer da 60 s ancora vivo');
    assert.ok(!els.toasts.children.includes(t));
  } finally { vmSandbox.clearTimeout = origClear; }
});

test('backupSessions: una sessione alla volta, Blob intermedi, file che si rilegge intero', async () => {
  await initDb();
  // Righe abbastanza da superare la soglia del Blob intermedio (~8 MB di testo).
  const big = (id, iso) => Object.assign(sess(id, iso), {
    rows: Array.from({ length: 120000 }, (_, i) => ({ t: i * 0.05, speedKmh: 50, lean: 10 })),
  });
  await idb.put(big('a', '2024-05-01T10:00:00Z'));
  await idb.put(big('b', '2024-05-02T10:00:00Z'));
  await idb.put(sess('c', '2024-05-03T10:00:00Z'));

  let got = null;
  const loaded = [];
  const orig = { dl: vmSandbox.downloadBlob, get: idb.get, blob: vmSandbox.Blob };
  vmSandbox.Blob = Blob;
  vmSandbox.downloadBlob = (name, parts) => { got = { name, parts }; };
  // Letture singole per id, non l'intero storico caricato insieme.
  idb.get = async id => { loaded.push(id); return orig.get(id); };
  try {
    await api.backupSessions();
  } finally {
    vmSandbox.downloadBlob = orig.dl; idb.get = orig.get; vmSandbox.Blob = orig.blob;
  }
  assert.ok(got, 'download non partito');
  assert.match(got.name, /^cruscotto_backup_.*\.json$/);
  assert.equal(loaded.length, 3, 'una lettura per sessione');
  assert.ok(got.parts.length >= 2, 'atteso almeno un Blob intermedio: ' + got.parts.length);
  assert.ok(got.parts.every(p => p instanceof Blob), 'al download arrivano solo Blob');
  const back = parseBackup(await new Blob(got.parts).text());
  assert.ok(back, 'il backup deve rileggersi');
  assert.deepEqual(Array.from(back, s => s.id).sort(), ['a', 'b', 'c']);
  assert.equal(back.find(s => s.id === 'a').rows.length, 120000);
  for (const id of ['a', 'b', 'c']) await idb.del(id);
});

test('backupSessions: storico vuoto, nessun download', async () => {
  await initDb();
  let called = false;
  const orig = vmSandbox.downloadBlob;
  vmSandbox.downloadBlob = () => { called = true; };
  try { await api.backupSessions(); } finally { vmSandbox.downloadBlob = orig; }
  assert.equal(called, false);
});

// ---- DB autovelox importato: nel backup e nel ripristino ----
const CAMS = [{ lat: 45.1, lon: 9.2, maxspeed: '50', name: 'Via Roma' }, { lat: 45.2, lon: 9.3, maxspeed: 70, name: '' }];

async function runBackup() {
  let got = null;
  const orig = { dl: vmSandbox.downloadBlob, blob: vmSandbox.Blob };
  vmSandbox.Blob = Blob;
  vmSandbox.downloadBlob = (name, parts) => { got = parts; };
  try { await api.backupSessions(); } finally { vmSandbox.downloadBlob = orig.dl; vmSandbox.Blob = orig.blob; }
  return got ? new Blob(got).text() : null;
}

test('sanitizeCameras: solo campi noti, coordinate valide, testi accorciati', () => {
  const { sanitizeCameras } = api;
  const out = sanitizeCameras([
    { lat: '45.5', lon: 9, maxspeed: 50, name: 'x'.repeat(500), evil: '<img onerror=1>' },
    { lat: 91, lon: 9 }, { lat: 45, lon: 'no' }, null, 'x',
    { lat: 45, lon: 9, maxspeed: { a: 1 }, name: 3 },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(Object.keys(out[0]).sort(), ['lat', 'lon', 'maxspeed', 'name']);
  assert.equal(out[0].lat, 45.5);
  assert.equal(out[0].name.length, 200);
  assert.equal(out[1].maxspeed, '');
  assert.equal(out[1].name, '');
  assert.equal(sanitizeCameras(undefined).length, 0);
});

test('backup: include gli autovelox importati; si fa anche senza giri', async () => {
  await initDb();
  await idb.kvPut('importedCameras', CAMS);
  const text = await runBackup();
  assert.ok(text, 'backup non partito con soli autovelox');
  const b = api.parseBackupFile(text);
  assert.equal(b.sessions.length, 0);
  assert.equal(b.cameras.length, 2);
  assert.equal(b.cameras[0].name, 'Via Roma');
  await idb.kvDel('importedCameras');
  api.state.importedCameras = [];
  assert.equal(await runBackup(), null, 'né giri né autovelox: nessun file');
});

test('backup vecchio senza "cameras": resta valido', () => {
  const b = api.parseBackupFile('{"sessions":[]}');
  assert.equal(b.cameras.length, 0);
  assert.equal(parseBackup('{"sessions":[]}').length, 0);
});

test('ripristino autovelox: caricati se assenti, sostituiti solo con conferma', async () => {
  await initDb();
  const st = api.state;
  const orig = { confirm: vmSandbox.confirmToast, rebuild: vmSandbox.rebuildCamGrid, render: vmSandbox.renderCameras };
  let asked = 0, answer = false;
  vmSandbox.confirmToast = async () => { asked++; return answer; };
  vmSandbox.rebuildCamGrid = () => {};
  vmSandbox.renderCameras = () => {};
  const file = { text: async () => JSON.stringify({ sessions: [], cameras: CAMS }) };
  try {
    st.importedCameras = [];
    await restoreSessions(file);
    assert.equal(asked, 0, 'nessuna domanda senza DB esistente');
    assert.equal(st.importedCameras.length, 2);
    assert.equal((await idb.kvGet('importedCameras')).length, 2);

    st.importedCameras = [{ lat: 1, lon: 1, maxspeed: '', name: '' }];
    answer = false;
    await restoreSessions(file);
    assert.equal(asked, 1);
    assert.equal(st.importedCameras.length, 1, 'sostituito senza conferma');
    answer = true;
    await restoreSessions(file);
    assert.equal(st.importedCameras.length, 2);
  } finally {
    Object.assign(vmSandbox, { confirmToast: orig.confirm, rebuildCamGrid: orig.rebuild, renderCameras: orig.render });
    st.importedCameras = [];
  }
});

test('import autovelox: file oltre 50 MB rifiutato prima di leggerlo', () => {
  const toasts = [];
  const orig = { toast: vmSandbox.toast, fr: vmSandbox.FileReader };
  let read = false;
  vmSandbox.toast = m => { toasts.push(m); return { remove() {} }; };
  vmSandbox.FileReader = function () { this.readAsText = () => { read = true; }; };
  try {
    vmSandbox.importCamerasFile({ size: 51 * 1024 * 1024 });
    assert.equal(read, false);
    assert.ok(toasts.some(m => /troppo grande/.test(m)));
    vmSandbox.importCamerasFile({ size: 1024 });
    assert.equal(read, true, 'un file piccolo deve essere letto');
  } finally { vmSandbox.toast = orig.toast; vmSandbox.FileReader = orig.fr; }
});
