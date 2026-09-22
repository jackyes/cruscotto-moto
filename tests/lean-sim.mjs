// Simulazione realistica della catena della piega per i test: orologio della
// sandbox che segue il tempo simulato, e fix GPS a 1 Hz che passa da
// correctSpeed come fa onGeolocation (js/inputs.js). Senza questi due pezzi la
// velocità fusa non viene mai riancorata al GPS, deriva di ±2,5 m/s integrando
// il rumore e gonfia l'errore di piega di circa il doppio: le prime versioni dei
// test di vibrazione e del bias misuravano quell'artefatto.
import { api, resetState, vmSandbox as sb } from './harness.mjs';

const { state, processSample, buildBasis, G } = api;

export function rng(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }

/* Forza specifica e velocità angolare di una curva coordinata a regime: B = identità
   (up = x, right = y, fwd = −z). deg = 0 è il rettilineo. */
export function steadyTurn(deg, v) {
  const phi = deg * Math.PI / 180, psi = deg ? (G * Math.tan(phi) / v) * (180 / Math.PI) : 0;
  return { w: { x: -psi * Math.cos(phi), y: -psi * Math.sin(phi), z: 0 }, f: { x: G / Math.cos(phi), y: 0, z: 0 } };
}

/* Esegue fn(sim) con l'orologio simulato. sim.step(acc, gyro) avanza di 1/60 s;
   sim.gps(v) registra un fix Doppler (ritardo GPS_LAG_S compreso dal chiamante,
   se vuole) e riancora la velocità fusa. */
export function withSim(fn, { hz = 60 } = {}) {
  let t = 300000;
  const origPerf = sb.performance;
  sb.performance = { now: () => t };
  try {
    resetState();
    state.calib = buildBasis({ x: 1, y: 0, z: 0 });
    const sim = {
      get t() { return t; },
      gps(v) { state.speedGpsMs = v; state.speedGpsT = t; sb.correctSpeed(v, t); },
      step(acc, gyro) {
        t += 1000 / hz;
        api.lastMotionT = t - 1000 / hz;
        processSample({ acc, gyro, grav: null, lin: null, t });
      },
    };
    return fn(sim, state);
  } finally {
    sb.performance = origPerf;
  }
}

/* Curva tenuta (o rettilineo) a velocità v con rumore uniforme: accelerometro ±amp g,
   giroscopio ±gA °/s, bias vero `bias` °/s su tutti e tre gli assi. Sosta di stopS
   secondi prima (GPS 0 m/s). Ritorna l'errore medio |piega − vera| dalla finestra
   [stopS + from, stopS + to] secondi. */
export function turnError({ deg = 30, v = 20, amp = 0, gA = 5, bias = 0, seed = 7, stopS = 0, from = 5, to = 15 } = {}) {
  return withSim((sim, st) => {
    const r = rng(seed), { w, f } = steadyTurn(deg, v);
    let s = 0, n = 0;
    for (let i = 0; i < (stopS + to) * 60; i++) {
      const moving = i >= stopS * 60, sec = i / 60;
      if (i % 60 === 0) sim.gps(moving ? v : 0);
      const ww = moving ? w : { x: 0, y: 0, z: 0 }, ff = moving ? f : { x: G, y: 0, z: 0 };
      sim.step(
        { x: ff.x + (r() * 2 - 1) * amp * G, y: ff.y + (r() * 2 - 1) * amp * G, z: ff.z + (r() * 2 - 1) * amp * G },
        { x: ww.x + bias + (r() * 2 - 1) * gA, y: ww.y + bias + (r() * 2 - 1) * gA, z: ww.z + bias + (r() * 2 - 1) * gA });
      if (moving && sec >= stopS + from) { s += Math.abs(st.lean - deg); n++; }
    }
    return s / n;
  });
}

export const SEEDS = [1, 7, 42, 99, 123];
export const meanOver = (o) => SEEDS.reduce((q, seed) => q + turnError({ ...o, seed }), 0) / SEEDS.length;
