'use strict';
/* js/storage.js (step 8): store + idb. Solo localStorage/indexedDB globali. saveSession/recoverChunks restano inline. */
/* ============================== Persistenza (localStorage) ============================== */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

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
      r.onsuccess = e => { idb.db = e.target.result; res(); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB bloccato da un altra scheda'));
    });
  },
  _tx(stores, mode, fn) {
    return new Promise((res, rej) => {
      if (!idb.db) return rej(new Error('DB non aperto'));
      let out;
      const tx = idb.db.transaction(stores, mode);
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('transazione annullata'));
      out = fn(tx);
    });
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
};
