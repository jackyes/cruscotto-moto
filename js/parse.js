'use strict';
/* js/parse.js (step 5): parser/formatter puri (camLabel, parseCamerasFile, navParseCoords, stamp, findRowAt, fmtDur). Zero dipendenze. */
/* Etichetta tooltip come nodo di testo: i tag OSM e i file importati sono dati di
   terze parti, e bindTooltip/innerHTML li interpretavano come HTML. */
function camLabel(c) {
  const parts = [];
  if (c.name) parts.push(String(c.name));
  if (c.maxspeed) parts.push(String(c.maxspeed));
  return parts.join(' · ');
}

/* ============================== Import autovelox (file) ============================== */
function parseCamerasFile(text) {
  const out = [];
  const t = (text || '').trim();
  if (!t) return out;
  // CSV: lat,lon[,limite[,nome]] (decimali col punto)
  if (t[0] !== '{' && t[0] !== '[') {
    for (const line of t.split(/\r?\n/)) {
      const p = line.split(/[,;]/).map(s => s.trim());
      if (p.length < 2) continue;
      const lat = parseFloat(p[0]); const lon = parseFloat(p[1]);
      if (isNaN(lat) || isNaN(lon)) continue;
      out.push({ lat, lon, maxspeed: p[2] || '', name: p[3] || '' });
    }
    return out;
  }
  try {
    const data = JSON.parse(t);
    const arr = Array.isArray(data) ? data : (data.result || data.features || null);
    if (!Array.isArray(arr)) return out;
    if (arr.length && arr[0] && arr[0].geometry) {
      // GeoJSON FeatureCollection
      for (const f of arr) {
        const g = f.geometry;
        if (!g || !g.coordinates) continue;
        const [lon, lat] = g.coordinates;
        const pr = f.properties || {};
        out.push({ lat, lon, maxspeed: pr.vmax || pr.maxspeed || '', name: pr.name || pr.ort || '' });
      }
    } else {
      // SCDB autovelox.it: {lat/lng, vmax, ort, strasse}
      for (const c of arr) {
        const lat = c.lat != null ? c.lat : c.breitengrad_dezimal;
        const lon = c.lng != null ? c.lng : c.laengengrad_dezimal;
        if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) continue;
        const name = [c.ort, c.strasse].filter(Boolean).join(' ');
        out.push({ lat, lon, maxspeed: c.vmax || '', name });
      }
    }
  } catch (e) { /* non-JSON */ }
  return out;
}

/* Coordinate incollate: "44.0367, 10.1417" oppure un link mappe. Solo regex, niente rete. */
function navParseCoords(t) {
  let s = String(t || '').trim();
  if (!s) return null;
  // NBSP, figure space, narrow NBSP, BOM, gradi/primi/secondi e punti cardinali
  s = s.replace(/[   ﻿]/g, ' ').replace(/[°'″"ʼ]/g, ' ');
  const ns = /[nNsS]/.test(s), ew = /[eEoOwW]/.test(s);
  s = s.replace(/[nNsS]/g, ' ').replace(/[eEoOwW]/g, ' ');
  const num = '-?\\d{1,3}(?:[.,]\\d+)?';
  let m = s.match(new RegExp('[!]3d(' + num + ')[!]4d(' + num + ')'));  // link Google Maps
  if (m) return { lat: +m[1].replace(',', '.'), lon: +m[2].replace(',', '.'), label: 'Coordinate' };
  m = s.match(new RegExp('@(' + num + ')\\s*,\\s*(' + num + ')'));       // .../@lat,lon,15z
  if (m) {
    const la = parseFloat(m[1].replace(',', '.')), lo = parseFloat(m[2].replace(',', '.'));
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lat: la, lon: lo, label: 'Coordinate' };
  }
  m = s.match(/geo:(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)/i);
  if (m) {
    const la = parseFloat(m[1].replace(',', '.')), lo = parseFloat(m[2].replace(',', '.'));
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lat: la, lon: lo, label: 'Coordinate' };
  }
  m = s.match(/[?&]q=(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)/i)
    || s.match(/[?&]query=(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)/i);
  if (m) {
    const la = parseFloat(m[1].replace(',', '.')), lo = parseFloat(m[2].replace(',', '.'));
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lat: la, lon: lo, label: 'Coordinate' };
  }
  // lat=/lon= in entrambi gli ordini; se inizia per lon=, scambia
  let ml = s.match(/[?&;]lat\s*=\s*(-?\d+(?:[.,]\d+)?)/i), mo = s.match(/[?&;]lon(?:g)?\s*=\s*(-?\d+(?:[.,]\d+)?)/i);
  if (ml && mo) {
    let la = parseFloat(ml[1].replace(',', '.')), lo = parseFloat(mo[1].replace(',', '.'));
    const latFirst = ml.index < mo.index;
    if (!latFirst) { const tmp = la; la = lo; lo = tmp; }
    if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180) && Math.abs(la) <= 180 && Math.abs(lo) <= 90) {
      const tmp = la; la = lo; lo = tmp;
    }
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lat: la, lon: lo, label: 'Coordinate' };
    return null;
  }
  // coppia nuda, con o senza N/S/E/W. Senza lettere l'ordine è lat,lon stretto:
  // "95.0, 9.0" è input non valido (null), non una coppia da scambiare in silenzio.
  m = s.match(new RegExp('^(' + num + ')\\s*[,; ]\\s*(' + num + ')$'));
  if (m) {
    const la = parseFloat(m[1].replace(',', '.')), lo = parseFloat(m[2].replace(',', '.'));
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lat: la, lon: lo, label: 'Coordinate' };
    if (ns || ew) {
      const a2 = parseFloat(m[2].replace(',', '.')), b2 = parseFloat(m[1].replace(',', '.'));
      if (Math.abs(a2) <= 90 && Math.abs(b2) <= 180) return { lat: a2, lon: b2, label: 'Coordinate' };
    }
  }
  return null;
}

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/* Indice della riga con t più vicino al target. rows è ordinata per t crescente. */
function findRowAt(rows, t) {
  if (!rows || !rows.length) return -1;
  if (t <= rows[0].t) return 0;
  if (t >= rows[rows.length - 1].t) return rows.length - 1;
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].t < t) lo = mid + 1; else hi = mid;
  }
  const a = lo - 1 >= 0 ? rows[lo - 1] : rows[lo];
  const b = rows[lo];
  return (t - a.t <= b.t - t) ? lo - 1 : lo;
}

function fmtDur(sec) {
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(Math.floor(sec % 60)).padStart(2, '0');
  return mm + ':' + ss;
}
