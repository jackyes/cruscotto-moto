'use strict';
/* js/storage.js (step 8): store + idb. Solo localStorage/indexedDB globali. saveSession/recoverChunks restano inline. */
/* ============================== Persistenza (localStorage) ============================== */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
let openRetryN = 0;   // contatore backoff riapertura dopo onversionchange

/* ============================== IndexedDB (storico) ============================== */
/* Schema v2:
   - sessions  : record pesante {id, track, rows}
   - meta      : record leggero {id, meta} — l'elenco Storico legge SOLO questo.
                 Prima renderHistory() faceva getAll() sulle sessioni complete,
                 deserializzando fino a 180k righe per sessione solo per disegnare
                 delle card con data e durata.
   - logchunks : flush incrementali della sessione in corso (recupero dopo crash)
   - kv        : blob di configurazione (es. DB autovelox importato) */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cruscotto', 2);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        const tx = e.target.transaction;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('logchunks')) {
          const s = db.createObjectStore('logchunks', { keyPath: 'k', autoIncrement: true });
          s.createIndex('sid', 'sid', { unique: false });
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
        if (e.oldVersion < 2) {
          // Migrazione one-shot: estrae i meta dalle sessioni esistenti, un record
          // alla volta con un cursore per non caricare tutto in memoria.
          const src = tx.objectStore('sessions');
          const dst = tx.objectStore('meta');
          src.openCursor().onsuccess = ev => {
            const cur = ev.target.result;
            if (!cur) return;
            const v = cur.value;
            if (v && v.meta) dst.put({ id: v.id, meta: v.meta, points: (v.rows || []).length });
            cur.continue();
          };
        }
      };
      r.onsuccess = e => {
        idb.db = e.target.result;
        // Un bump di versione da un'altra scheda chiude questa connessione, così la
        // scheda nuova può fare l'upgrade invece di restare bloccata su schema vecchio.
        // Va però RIAPERTA subito: lasciando idb.db = null tutte le _tx() successive
        // rifiutano "DB non aperto" per sempre, e flushLog scambia l'errore per quota
        // piena → dopo 2 fallimenti sampleTick inizia a buttare righe vere.
        idb.db.onversionchange = () => {
          try { idb.db.close(); } catch (e2) {}
          idb.db = null;
          // Riapertura con backoff: il primo tentativo è immediato (l'upgrade
          // dell'altra scheda può essere già finito), i successivi scalano —
          // prima ritentava a raffica senza limiti.
          openRetryN = (openRetryN || 0) + 1;
          if (openRetryN > 8) { try { console.warn('idb: troppi tentativi di riapertura dopo upgrade.'); } catch (e3) {} openRetryN = 0; }
          const delay = openRetryN > 1 ? Math.min(250 * (openRetryN - 1), 4000) : 0;
          setTimeout(() => { idb.open().catch(() => {}); }, delay);
        };
        res();
      };
      r.onerror = () => rej(r.error);
      // onblocked NON rigetta: significa "aspetto che le altre schede rilascino la
      // connessione vecchia" e l'onsuccess arriva comunque dopo. Rigettare qui
      // uccideva la catena di boot (storico/recupero/import) anche quando la
      // connessione poi apriva regolarmente.
      r.onblocked = () => {};
    });
  },
  _tx(stores, mode, fn) {
    // Lazy-open: dopo un onversionchange (o un open appena avviato) idb.db può
    // essere null per un attimo — rifiutare "DB non aperto" subito trasformava
    // un race innocuo in un errore fatale per il chiamante.
    const run = () => new Promise((res, rej) => {
      let out;
      const tx = idb.db.transaction(stores, mode);
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('transazione annullata'));
      out = fn(tx);
    });
    if (idb.db) return run();
    return idb.open().then(run);
  },
  put(obj) {
    return idb._tx(['sessions', 'meta'], 'readwrite', tx => {
      tx.objectStore('sessions').put(obj);
      tx.objectStore('meta').put({ id: obj.id, meta: obj.meta, points: (obj.rows || []).length });
    });
  },
  getMetas() {
    let val = [];
    return idb._tx('meta', 'readonly', tx => {
      const rq = tx.objectStore('meta').getAll();
      rq.onsuccess = () => { val = rq.result || []; };
    }).then(() => val);
  },
  get(id) {
    let val = null;
    return idb._tx('sessions', 'readonly', tx => {
      const rq = tx.objectStore('sessions').get(id);
      rq.onsuccess = () => { val = rq.result || null; };
    }).then(() => val);
  },
  keys() {
    let val = [];
    return idb._tx('sessions', 'readonly', tx => {
      const rq = tx.objectStore('sessions').getAllKeys();
      rq.onsuccess = () => { val = rq.result || []; };
    }).then(() => val);
  },
  del(id) {
    return idb._tx(['sessions', 'meta'], 'readwrite', tx => {
      tx.objectStore('sessions').delete(id);
      tx.objectStore('meta').delete(id);
    });
  },
  putChunk(obj) {
    return idb._tx('logchunks', 'readwrite', tx => { tx.objectStore('logchunks').put(obj); });
  },
  getChunks() {
    let val = [];
    return idb._tx('logchunks', 'readonly', tx => {
      const rq = tx.objectStore('logchunks').getAll();
      rq.onsuccess = () => { val = rq.result || []; };
    }).then(() => val);
  },
  clearChunks() {
    return idb._tx(['logchunks', 'kv'], 'readwrite', tx => {
      tx.objectStore('logchunks').clear();
      tx.objectStore('kv').delete('activeTrack');
    });
  },
  kvPut(k, v) {
    return idb._tx('kv', 'readwrite', tx => { tx.objectStore('kv').put({ k, v }); });
  },
  kvGet(k) {
    let val = null;
    return idb._tx('kv', 'readonly', tx => {
      const rq = tx.objectStore('kv').get(k);
      rq.onsuccess = () => { val = rq.result ? rq.result.v : null; };
    }).then(() => val);
  },
  kvKeys() {
    let val = [];
    return idb._tx('kv', 'readonly', tx => {
      const rq = tx.objectStore('kv').getAllKeys();
      rq.onsuccess = () => { val = rq.result || []; };
    }).then(() => val);
  },
  kvDel(k) {
    return idb._tx('kv', 'readwrite', tx => { tx.objectStore('kv').delete(k); });
  },
};
