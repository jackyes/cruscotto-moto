'use strict';
/* js/rows-codec.js: righe del log in colonne per IndexedDB. Pure (no state/DOM/idb).
   Ordine: prima di js/storage.js, che le usa in put/get e nei chunk.

   Una riga salvata come oggetto porta con sé il nome di ognuna delle ~28 chiavi:
   su un'ora a 20 Hz sono 72.000 copie di ogni nome. In colonne i nomi ci sono una
   volta sola e i numeri stanno in array tipizzati: misurato su un'ora di log,
   31,8 MB → 9,0 MB serializzati (15,8 → 6,7 MB con la compressione di IndexedDB).

   Precisione:
   - Float64 (esatti) per tempo, posizione e velocità: t, lat, lon e le velocità.
   - Float32 per i sensori, riletti arrotondati a 1e-6: il CSV ne stampa al più 3
     decimali, quindi l'ultima cifra può cambiare solo in rari casi di confine.
     L'arrotondamento tiene corti i numeri nel backup JSON (0.1, non
     0.10000000149011612).
   - Stringhe (leanRef) come dizionario + indici.
   - null e NaN diventano entrambi null (CSV e grafici li trattano uguali).
   - Qualunque altra cosa (chiave assente in qualche riga, tipi misti, valori non
     numerici): colonna "raw", un array normale, senza perdita. Se le righe non
     sono tutte oggetti, niente codifica: si salvano come sono. */

const ROWS_CODEC_V = 1;
const ROWS_F64 = new Set(['t', 'lat', 'lon', 'speedKmh', 'speedMs', 'speedFus']);
const ROWS_F32_ROUND = 1e6;

function encodeRows(rows) {
  if (!Array.isArray(rows)) return null;
  const n = rows.length;
  const keys = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    for (const k in r) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  const cols = {};
  for (const k of keys) cols[k] = encodeColumn(rows, k, n);
  return { v: ROWS_CODEC_V, n, keys, cols };
}

function encodeColumn(rows, k, n) {
  let numeric = true, strings = true;
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    if (!(k in r)) return rawColumn(rows, k, n);
    const v = r[k];
    if (v === null) continue;
    if (typeof v !== 'number') numeric = false;
    if (typeof v !== 'string') strings = false;
    if (!numeric && !strings) return rawColumn(rows, k, n);
  }
  if (numeric) {
    const a = new (ROWS_F64.has(k) ? Float64Array : Float32Array)(n);
    for (let i = 0; i < n; i++) { const v = rows[i][k]; a[i] = v === null ? NaN : v; }
    return { k: ROWS_F64.has(k) ? 'f64' : 'f32', d: a };
  }
  // Stringhe: indice 0 riservato a null.
  const dict = [null];
  const idx = new Map();
  const a = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const v = rows[i][k];
    if (v === null) continue;
    let j = idx.get(v);
    if (j === undefined) {
      if (dict.length > 0xffff) return rawColumn(rows, k, n);
      j = dict.length; dict.push(v); idx.set(v, j);
    }
    a[i] = j;
  }
  return { k: 'dict', d: a, dict };
}

function rawColumn(rows, k, n) {
  const a = new Array(n);
  let missing = false;
  for (let i = 0; i < n; i++) {
    if (k in rows[i]) a[i] = rows[i][k];
    else missing = true;
  }
  // present: la chiave assente resta assente, non diventa `k: undefined`.
  if (!missing) return { k: 'raw', d: a };
  const present = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (k in rows[i]) present[i] = 1;
  return { k: 'raw', d: a, present };
}

/* Sagoma delle righe decodificate: le chiavi con una colonna, nell'ordine di keys.
   Un oggetto vuoto che riceve le ~28 chiavi una alla volta, con chiave calcolata,
   V8 lo passa in dictionary mode oltre una dozzina di proprietà: ~2 KB a riga
   contro i ~660 B di una riga di snapshot() (misurati in Node), e lo Stop di un
   giro di 3 h, che rilegge tutte le righe dai chunk, costava ~420 MB in più. La
   copia di una sagoma nasce con tutte le chiavi al loro posto e le scritture
   toccano solo chiavi esistenti: la riga resta fast mode.
   null se una colonna ha chiavi assenti in qualche riga (present): la sagoma le
   farebbe comparire ovunque, e lì resta la costruzione chiave per chiave. */
function rowTemplate(enc) {
  const entries = [];
  for (const k of enc.keys) {
    const c = enc.cols[k];
    if (!c) continue;
    if (c.present) return null;
    entries.push([k, null]);
  }
  return Object.fromEntries(entries);
}

/* Record di storage → righe. Accetta anche il formato vecchio (array di oggetti). */
function decodeRows(enc) {
  if (Array.isArray(enc)) return enc;
  if (!enc || enc.v !== ROWS_CODEC_V || !enc.cols || !Array.isArray(enc.keys)) return [];
  const n = enc.n | 0;
  const out = new Array(n);
  // Spread e non Object.assign: copia le chiavi senza passare dai setter
  // (una colonna "__proto__" da un backup non cambia il prototipo della riga).
  const tpl = rowTemplate(enc);
  for (let i = 0; i < n; i++) out[i] = tpl ? { ...tpl } : {};
  for (const k of enc.keys) {
    const c = enc.cols[k];
    if (!c) continue;
    const d = c.d;
    if (c.k === 'f64') {
      for (let i = 0; i < n; i++) { const v = d[i]; out[i][k] = v !== v ? null : v; }
    } else if (c.k === 'f32') {
      for (let i = 0; i < n; i++) {
        const v = d[i];
        out[i][k] = v !== v ? null : (isFinite(v) ? Math.round(v * ROWS_F32_ROUND) / ROWS_F32_ROUND : v);
      }
    } else if (c.k === 'dict') {
      for (let i = 0; i < n; i++) out[i][k] = c.dict[d[i]];
    } else {
      const p = c.present;
      for (let i = 0; i < n; i++) if (!p || p[i]) out[i][k] = d[i];
    }
  }
  return out;
}
