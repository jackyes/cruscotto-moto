import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';

const { parseMaxspeed, parseSpeedWays, matchSpeedLimit, wayOneway, speedLimitDue, fetchSpeedLimit, state } = api;
const s = vmSandbox;

test('parseMaxspeed: numeri, mph, scarti', () => {
  assert.equal(parseMaxspeed('50'), 50);
  assert.equal(parseMaxspeed('70'), 70);
  assert.equal(parseMaxspeed('50 mph'), 80);
  assert.equal(parseMaxspeed('30 mph'), 48);
  assert.equal(parseMaxspeed('50;70'), 50);
  assert.equal(parseMaxspeed('none'), null);
  assert.equal(parseMaxspeed('signals'), null);
  assert.equal(parseMaxspeed('walk'), null);
  assert.equal(parseMaxspeed('IT:urban'), null);
  assert.equal(parseMaxspeed(''), null);
  assert.equal(parseMaxspeed(null), null);
  assert.equal(parseMaxspeed('999'), null);
});

// Geometrie in un piano locale: ~0,0009° di latitudine = 100 m, a 45° N
// ~0,00127° di longitudine = 100 m.
const N = m => m / 110540, E = m => m / (111320 * Math.cos(45 * Math.PI / 180));
const way = (kmh, pts, tags) => ({ tags: Object.assign({ highway: 'primary', maxspeed: String(kmh) }, tags || {}), geometry: pts });
const P = (eM, nM) => ({ lat: 45 + N(nM), lon: 9 + E(eM) });

test('parseSpeedWays: solo strade con maxspeed valido e geometria', () => {
  const ways = parseSpeedWays([
    way(90, [P(0, 0), P(0, 100)]),
    way('signals', [P(0, 0), P(0, 100)]),
    way(50, [P(0, 0)]),                               // un punto solo
    { tags: { maxspeed: '50' } },                     // niente geometria
    way(70, [P(0, 0), { lat: 'x', lon: 9 }, P(10, 10)]),
  ]);
  assert.equal(ways.length, 2);
  assert.equal(ways[0].kmh, 90);
  assert.equal(ways[1].pts.length, 2, 'nodo non numerico scartato');
});

test('wayOneway: tag espliciti, autostrade e rotatorie implicite', () => {
  assert.equal(wayOneway({ oneway: 'yes' }), 1);
  assert.equal(wayOneway({ oneway: '-1' }), -1);
  assert.equal(wayOneway({ oneway: 'no', highway: 'motorway' }), 0);
  assert.equal(wayOneway({ highway: 'motorway' }), 1);
  assert.equal(wayOneway({ junction: 'roundabout' }), 1);
  assert.equal(wayOneway({ highway: 'primary' }), 0);
  assert.equal(wayOneway(undefined), 0);
});

test('incrocio: la statale lunga vince sulla traversa corta che ha il centro più vicino', () => {
  // Statale nord-sud lunga 6 km (centro a 3 km), traversa est-ovest di 200 m
  // che la incrocia qui. Si viaggia verso nord sulla statale, 5 m dopo l'incrocio.
  const ways = parseSpeedWays([
    way(90, [P(0, -3000), P(0, 3000)]),
    way(30, [P(0, 0), P(200, 0)]),
  ]);
  const me = P(0, 5);
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, 0), 90);
  // Svoltando nella traversa (verso est) il limite diventa il suo.
  const side = P(40, 0);
  assert.equal(matchSpeedLimit(ways, side.lat, side.lon, 90), 30);
});

test('strada parallela: il verso di marcia esclude quella che va di traverso', () => {
  // Rampa di 50 km/h che corre a 10 m ma in diagonale (60° dalla statale).
  const ways = parseSpeedWays([
    way(110, [P(0, -1000), P(0, 1000)]),
    way(50, [P(-866, -500), P(866, 500)].map(p => ({ lat: p.lat, lon: p.lon + E(8) }))),
  ]);
  // A 6 m dalla statale e a ~2 m dalla rampa: per distanza vincerebbe la rampa.
  const me = P(6, 0);
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, null), 50, 'premessa: la rampa è la più vicina');
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, 0), 110);
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, 180), 110, 'doppio senso: vale anche verso sud');
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, 30), 50, 'imboccata la rampa, vale la rampa');
});

test('senso unico: la carreggiata opposta non conta', () => {
  // Due carreggiate a 20 m: nord (130, oneway) e sud (100, oneway, nodi verso sud).
  const ways = parseSpeedWays([
    way(130, [P(0, -1000), P(0, 1000)], { oneway: 'yes' }),
    way(100, [P(20, 1000), P(20, -1000)], { oneway: 'yes' }),
  ]);
  const me = P(12, 0);                                 // più vicino alla carreggiata sud
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, 0), 130, 'verso nord: solo la carreggiata nord');
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, 180), 100);
  // Senza heading (fermi) conta solo la distanza.
  assert.equal(matchSpeedLimit(ways, me.lat, me.lon, null), 100);
});

test('matchSpeedLimit: nessuna strada entro 25 m → null', () => {
  const ways = parseSpeedWays([way(50, [P(0, 0), P(0, 100)])]);
  const far = P(30, 50);
  assert.equal(matchSpeedLimit(ways, far.lat, far.lon, null), null);
  const near = P(20, 50);
  assert.equal(matchSpeedLimit(ways, near.lat, near.lon, null), 50);
  assert.equal(matchSpeedLimit([], 45, 9, 0), null);
  assert.equal(matchSpeedLimit(null, 45, 9, 0), null);
});

test('speedLimitDue: una query ogni 500 m o 10 min, mai in volo o in backoff', () => {
  resetState();
  const now = 1_000_000;
  assert.equal(speedLimitDue(45, 9, now), true, 'senza cache');
  state.speedLimitFetching = true;
  assert.equal(speedLimitDue(45, 9, now), false);
  state.speedLimitFetching = false;
  state.speedLimitPos = { lat: 45, lon: 9 };
  state.speedLimitWays = [];
  state.speedLimitAt = now;
  const p = P(0, 490);
  assert.equal(speedLimitDue(p.lat, p.lon, now + 60000), false, 'dentro 500 m e cache fresca');
  const q = P(0, 510);
  assert.equal(speedLimitDue(q.lat, q.lon, now + 1000), true);
  assert.equal(speedLimitDue(45, 9, now + 600000), true, 'cache scaduta');
  state.speedLimitRetryAfter = now + 50000;
  assert.equal(speedLimitDue(q.lat, q.lon, now + 1000), false);
  resetState();
});

test('query: a 100 km/h per 10 minuti ~34 richieste, non ~110', async () => {
  resetState();
  let calls = 0;
  const orig = s.fetchWithTimeout;
  s.fetchWithTimeout = async () => { calls++; return { ok: true, json: async () => ({ elements: [] }) }; };
  try {
    // Un fix al secondo, 27,8 m/s verso nord.
    for (let i = 0; i < 600; i++) {
      const p = P(0, i * 27.8);
      state.pos = { lat: p.lat, lon: p.lon };
      s.maybeLoadSpeedLimit(p.lat, p.lon, 0);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
  } finally { s.fetchWithTimeout = orig; }
  // 16,7 km / 500 m ≈ 34.
  assert.ok(calls >= 30 && calls <= 36, 'richieste: ' + calls);
  resetState();
});

// #11: dopo un errore di rete il limite precedente restava in state per due
// minuti — il badge continuava a mostrare il vecchio "50" con la classe 'over'
// accesa a 75 km/h, in un punto della strada che con quel limite non c'entrava.
test('fetchSpeedLimit: errore di rete → il limite vecchio non resta a schermo', async () => {
  resetState();
  state.speedLimit = 50;                       // noto da un fetch precedente, ormai vecchio
  state.speedLimitAt = Date.now() - 60000;
  state.speedLimitPos = { lat: 45, lon: 9 };
  const orig = s.fetchWithTimeout;
  s.fetchWithTimeout = async () => { throw new Error('offline'); };   // tutti gli host giù
  try {
    await fetchSpeedLimit(45.02, 9);
  } finally {
    s.fetchWithTimeout = orig;
  }
  assert.equal(state.speedLimit, null, 'limite vecchio ancora a schermo dopo un errore');
  assert.ok(state.speedLimitRetryAfter > Date.now(), 'backoff non riarmato');
  assert.equal(state.speedLimitFetching, false, 'in-volo rimasto appeso');
  resetState();
});

test('fetchSpeedLimit: successo → limite aggiornato e backoff azzerato', async () => {
  resetState();
  state.speedLimitRetryAfter = Date.now() + 60000;
  const orig = s.fetchWithTimeout;
  s.fetchWithTimeout = async () => ({
    ok: true,
    json: async () => ({ elements: [way(70, [P(-100, 0), P(100, 0)])] }),
  });
  state.pos = { lat: 45, lon: 9 };
  try {
    await fetchSpeedLimit(45, 9);
  } finally {
    s.fetchWithTimeout = orig;
  }
  assert.equal(state.speedLimit, 70);
  assert.equal(state.speedLimitRetryAfter, 0, 'backoff non azzerato dopo un successo');
  resetState();
});
