// IndexedDB in-memory, minimale ma fedele per il subset usato da cruscotto-moto.
// Nessuna dipendenza: emula open/transaction/objectStore e le richieste async.
export function createFakeIndexedDB() {
  const dbs = new Map(); // name -> db
  let currentTx = null;

  function makeStore(name, opts = {}) {
    return {
      name,
      keyPath: opts.keyPath || null,
      autoIncrement: !!opts.autoIncrement,
      records: new Map(), // key -> value
      nextKey: 1,
      indexes: new Map(),
      createIndex(n, kp, o) { this.indexes.set(n, { keyPath: kp, unique: !!(o && o.unique) }); },
      index(n) { return this.indexes.get(n); },
      _key(obj) {
        if (this.keyPath && obj[this.keyPath] != null) return obj[this.keyPath];
        if (this.autoIncrement) return this.nextKey++;
        return undefined;
      },
      put(obj) { return enqueueRequest(() => { const k = this._key(obj); this.records.set(k, obj); return k; }); },
      get(key) { return enqueueRequest(() => (this.records.has(key) ? this.records.get(key) : undefined)); },
      getAll() { return enqueueRequest(() => [...this.records.values()]); },
      getAllKeys() { return enqueueRequest(() => [...this.records.keys()]); },
      delete(key) { return enqueueRequest(() => { this.records.delete(key); return undefined; }); },
      clear() { return enqueueRequest(() => { this.records.clear(); return undefined; }); },
      openCursor() {
        return enqueueRequest(() => {
          const entries = [...this.records.entries()];
          let i = 0;
          const cursor = {
            get value() { return entries[i] ? entries[i][1] : undefined; },
            get key() { return entries[i] ? entries[i][0] : undefined; },
            continue() { i++; },
          };
          return entries.length ? cursor : null;
        });
      },
    };
  }

  function makeDb(name) {
    const db = {
      name,
      version: 0,
      stores: new Map(),
      objectStoreNames: { contains: n => db.stores.has(n) },
      createObjectStore(n, opts) { const s = makeStore(n, opts); db.stores.set(n, s); return s; },
      transaction(storeNames, mode) {
        const tx = {
          pending: 0, done: false, failed: false, error: null,
          oncomplete: null, onerror: null, onabort: null,
          objectStore(n) { return db.stores.get(n); },
        };
        currentTx = tx;
        return tx;
      },
    };
    return db;
  }

  function maybeComplete(tx) {
    if (tx && tx.pending === 0 && !tx.done && tx.oncomplete) { tx.done = true; tx.oncomplete(); }
  }

  function enqueueRequest(operation) {
    const request = { onsuccess: null, onerror: null, result: undefined, error: null };
    const tx = currentTx;
    if (tx) tx.pending = (tx.pending || 0) + 1;
    queueMicrotask(() => {
      try {
        request.result = operation();
        if (request.onsuccess) request.onsuccess({ target: request });
      } catch (e) {
        request.error = e;
        if (tx) { tx.error = e; tx.failed = true; }
        if (request.onerror) request.onerror({ target: request });
      } finally {
        if (tx) { tx.pending--; maybeComplete(tx); }
      }
    });
    return request;
  }

  function open(name, version) {
    const r = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: null, error: null };
    queueMicrotask(() => {
      let db = dbs.get(name);
      const needsUpgrade = !db || db.version < version;
      if (!db) { db = makeDb(name); dbs.set(name, db); }
      if (needsUpgrade) {
        const oldVersion = db.version;
        const upgradeTx = {
          pending: 0, done: false, failed: false, error: null,
          oncomplete: null, onerror: null, onabort: null,
          objectStore(n) { return db.stores.get(n); },
        };
        currentTx = upgradeTx;
        if (r.onupgradeneeded) r.onupgradeneeded({ target: { result: db, transaction: upgradeTx }, oldVersion });
        currentTx = null;
        db.version = version;
        upgradeTx.oncomplete = () => { r.result = db; if (r.onsuccess) r.onsuccess({ target: r }); };
        maybeComplete(upgradeTx);
      } else {
        r.result = db;
        if (r.onsuccess) r.onsuccess({ target: r });
      }
    });
    return r;
  }

  return { open };
}
