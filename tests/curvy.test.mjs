import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './harness.mjs';

const { geoDest, geoProject, resampleXY, curveStats, curveScore, curveFit,
        CURVE_TARGETS, CURVE_STEP_M, haversineM, bearing } = api;

/* Cerchio di raggio noto attorno a un centro: e' l'unica figura di cui si conoscono
   in anticipo TUTTE le statistiche, quindi e' la prova che la matematica e' giusta e
   non solo autoconsistente. Su un cerchio di raggio R:
     - il raggio di curvatura vale R ovunque
     - i gradi totali sono 360, su una lunghezza 2πR, quindi
       gradi/km = 360 / (2πR/1000) = 57296 / R */
function circle(lat0, lon0, R, n) {
  const lat = [], lon = [];
  for (let i = 0; i <= n; i++) {
    const p = geoDest(lat0, lon0, (i * 360) / n, R);
    lat.push(p.lat); lon.push(p.lon);
  }
  return { lat, lon, n: lat.length };
}

test('geoDest: distanza e rilevamento tornano indietro esatti', () => {
  for (const b of [0, 45, 90, 180, 270, 359]) {
    for (const d of [100, 5000, 50000]) {
      const p = geoDest(45.5, 9.2, b, d);
      assert.ok(Math.abs(haversineM(45.5, 9.2, p.lat, p.lon) - d) < d * 0.001,
        'distanza brg=' + b + ' d=' + d);
      const back = bearing({ lat: 45.5, lon: 9.2 }, p);
      assert.ok(Math.abs(((back - b + 540) % 360) - 180) < 0.5, 'rilevamento brg=' + b);
    }
  }
});

test('geoDest: input non finito -> null, mai NaN in giro', () => {
  assert.equal(geoDest(NaN, 9, 0, 100), null);
  assert.equal(geoDest(45, 9, NaN, 100), null);
  assert.equal(geoDest(45, 9, 0, Infinity), null);
});

test('geoDest: wrap a [-180,180] oltre l antimeridiano', () => {
  const p = geoDest(0, 179.99, 90, 5000);   // verso est, oltre il bordo
  assert.ok(p.lon <= 180 && p.lon >= -180, 'lon fuori range: ' + p.lon);
  assert.ok(p.lon < 0, 'doveva riavvolgersi a longitudine negativa');
});

test('geoProject: metri veri, baricentro all origine', () => {
  const lat = [45, 45.01], lon = [9, 9];
  const p = geoProject(lat, lon, 2);
  assert.ok(Math.abs(p.x[0] - p.x[1]) < 0.01, 'stessa longitudine = stessa x');
  const dy = Math.abs(p.y[1] - p.y[0]);
  const real = haversineM(45, 9, 45.01, 9);
  assert.ok(Math.abs(dy - real) < real * 0.002, 'dy=' + dy + ' vs ' + real);
});

test('resampleXY: passo costante e lunghezza conservata su nodi irregolari', () => {
  // nodi volutamente sbilenchi: un grappolo fitto e poi un salto lungo
  const x = new Float64Array([0, 1, 2, 3, 500, 1000]);
  const y = new Float64Array([0, 0, 0, 0, 0, 0]);
  const rs = resampleXY(x, y, 6, 25);
  assert.ok(Math.abs(rs.lenM - 1000) < 1e-6, 'lunghezza: ' + rs.lenM);
  assert.equal(rs.n, 41);                       // floor(1000/25)+1
  for (let i = 1; i < rs.n; i++) {
    const step = Math.hypot(rs.x[i] - rs.x[i - 1], rs.y[i] - rs.y[i - 1]);
    assert.ok(Math.abs(step - 25) < 1e-6, 'passo ' + i + ' = ' + step);
  }
});

test('resampleXY: degeneri non lanciano', () => {
  assert.equal(resampleXY(new Float64Array(0), new Float64Array(0), 0, 25).n, 0);
  assert.equal(resampleXY(new Float64Array([1]), new Float64Array([1]), 1, 25).n, 0);
  // tutti i punti coincidenti: lunghezza zero, nessuna divisione per zero
  const z = new Float64Array([5, 5, 5]);
  const rs = resampleXY(z, z, 3, 25);
  assert.equal(rs.n, 0);
  assert.equal(rs.lenM, 0);
});

test('curveStats: cerchio di raggio noto -> raggio e gradi/km attesi', () => {
  for (const R of [50, 150, 400]) {
    const c = circle(45.5, 9.2, R, 180);
    const s = curveStats(c.lat, c.lon, c.n);
    assert.ok(Math.abs(s.lenM - 2 * Math.PI * R) < 2 * Math.PI * R * 0.02, 'lunghezza R=' + R);
    assert.ok(Math.abs(s.medRadius - R) < R * 0.08, 'raggio R=' + R + ' misurato ' + s.medRadius);
    const expected = 57296 / R;
    assert.ok(Math.abs(s.degPerKm - expected) < expected * 0.08,
      'gradi/km R=' + R + ': ' + s.degPerKm + ' attesi ' + expected);
  }
});

test('curveStats: retta -> zero gradi, raggio infinito', () => {
  const lat = [], lon = [];
  for (let i = 0; i < 200; i++) { lat.push(45 + i * 0.001); lon.push(9); }
  const s = curveStats(lat, lon, lat.length);
  assert.ok(s.degPerKm < 1, 'gradi/km su una retta: ' + s.degPerKm);
  assert.equal(s.medRadius, Infinity);
  assert.equal(s.tightFrac, 0);
  assert.equal(s.curvFrac, 0);
});

test('curveStats: tornanti stretti -> tightFrac alto, raggio piccolo', () => {
  // cerchio da 35 m: sotto CURVE_TIGHT_R, quindi tutto il percorso e' "tornante"
  const c = circle(45.5, 9.2, 35, 120);
  const s = curveStats(c.lat, c.lon, c.n);
  assert.ok(s.medRadius < 60, 'raggio: ' + s.medRadius);
  assert.ok(s.tightFrac > 0.8, 'tightFrac: ' + s.tightFrac);
  // curvone da 400 m: nessun tornante
  const w = circle(45.5, 9.2, 400, 120);
  assert.equal(curveStats(w.lat, w.lon, w.n).tightFrac, 0);
});

test('curveStats: input troppo corto o nullo -> zeri, mai throw', () => {
  const z = curveStats([], [], 0);
  assert.equal(z.degPerKm, 0);
  assert.equal(z.medRadius, Infinity);
  assert.equal(curveStats([45, 45.1], [9, 9], 2).degPerKm, 0);
  assert.equal(curveStats(null, null, 5).lenM, 0);
});

test('curveStats: il ricampionamento neutralizza la densita dei nodi', () => {
  /* Stessa strada, mappata due volte: una con nodi regolari, una con un grappolo
     fitto su un tratto dritto. Senza ricampionamento la seconda risulterebbe piu'
     curva della prima — che e' esattamente l'errore che questa funzione esiste per
     non fare. */
  const a = circle(45.5, 9.2, 200, 120);
  const b = { lat: [], lon: [] };
  for (let i = 0; i < a.n; i++) {
    b.lat.push(a.lat[i]); b.lon.push(a.lon[i]);
    if (i > 0 && i < 10) {   // dieci nodi extra interpolati su un tratto solo
      for (let k = 1; k < 5; k++) {
        b.lat.push(a.lat[i - 1] + (a.lat[i] - a.lat[i - 1]) * k / 5);
        b.lon.push(a.lon[i - 1] + (a.lon[i] - a.lon[i - 1]) * k / 5);
      }
    }
  }
  const sa = curveStats(a.lat, a.lon, a.n);
  const sb = curveStats(b.lat, b.lon, b.lat.length);
  assert.ok(Math.abs(sa.degPerKm - sb.degPerKm) < sa.degPerKm * 0.15,
    'densita nodi cambia il risultato: ' + sa.degPerKm + ' vs ' + sb.degPerKm);
});

test('curveFit: massimo sul bersaglio, decresce simmetrico in log', () => {
  assert.ok(curveFit(100, 100, 0.9) > 0.99);
  assert.ok(curveFit(200, 100, 0.9) < curveFit(140, 100, 0.9));
  // simmetria logaritmica: doppio e meta' valgono uguale
  assert.ok(Math.abs(curveFit(200, 100, 0.9) - curveFit(50, 100, 0.9)) < 1e-9);
  assert.equal(curveFit(0, 100, 0.9), 0);
  assert.equal(curveFit(NaN, 100, 0.9), 0);
  assert.equal(curveFit(100, 0, 0.9), 0);
});

function statsOfCircle(R, n) { const c = circle(45.5, 9.2, R, n); return curveStats(c.lat, c.lon, c.n); }
function statsOfLine() {
  const lat = [], lon = [];
  for (let i = 0; i < 200; i++) { lat.push(45 + i * 0.001); lon.push(9); }
  return curveStats(lat, lon, lat.length);
}

test('curveScore: i bersagli sono centrati, non "piu curve e meglio"', () => {
  /* 57296/R gradi per km su un cerchio di raggio R, quindi ~450 (il bersaglio di
     "tante" per un percorso intero) cade su R≈127 e ~143 su R=400. Il punteggio
     deve CENTRARE il bersaglio, non massimizzare: un percorso da 950 gradi/km e'
     lontano da "tante" quanto uno da 210, solo dall'altra parte. */
  const tante = statsOfCircle(127, 200);
  const blanda = statsOfCircle(400, 400);
  assert.ok(curveScore(tante, 'tante', 'misto') > curveScore(blanda, 'tante', 'misto'));
  // ...e "poche" ribalta la preferenza
  assert.ok(curveScore(blanda, 'poche', 'misto') > curveScore(tante, 'poche', 'misto'));
  // oltre il bersaglio si torna a scendere: e' una campana, non una rampa
  const esagerata = statsOfCircle(45, 120);
  assert.ok(curveScore(tante, 'tante', 'misto') > curveScore(esagerata, 'tante', 'misto'),
    'il punteggio premia lo sforamento invece di centrare il bersaglio');
});

test('curveScore: una strada dritta vale zero anche a "poche curve"', () => {
  /* Scelta deliberata, non un effetto collaterale del guard su v<=0: la scala e'
     logaritmica e lo zero e' infinitamente lontano da qualunque bersaglio. "Poche
     curve" non vuol dire "nessuna curva", e come SEME un rettilineo non serve a
     niente — e' il caso che il generatore deve scartare sempre. */
  const dritta = statsOfLine();
  assert.equal(curveScore(dritta, 'poche', 'misto'), 0);
  assert.equal(curveScore(dritta, 'poche', 'veloci'), 0);
  assert.ok(curveScore(statsOfCircle(250, 240), 'poche', 'misto') > 0);
});



test('curveScore: input nullo -> 0, mai throw', () => {
  assert.equal(curveScore(null, 'tante', 'misto'), 0);
  const vuoto = curveStats([], [], 0);
  assert.equal(curveScore(vuoto, 'tante', 'misto'), 0);
});

test('CURVE_STEP_M coerente con i bersagli documentati', () => {
  // Se qualcuno cambia il passo, i gradi/km cambiano scala e CURVE_TARGETS va ritarato.
  assert.equal(CURVE_STEP_M, 25);
});
