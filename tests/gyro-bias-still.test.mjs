// Bias del giroscopio misurato da fermi (gyroBiasStillStep, js/sensors-pipe.js).
// Il bias attorno alla verticale non si impara dalla gravità ed entra dritto nella
// compensazione centripeta (piega ≈ atan(v·ω/g)): da fermi si misura e si toglie.
// Simulazione realistica: tests/lean-sim.mjs (orologio simulato, GPS a 1 Hz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './harness.mjs';
import { withSim, rng, turnError, meanOver } from './lean-sim.mjs';

const { G } = api;

/* Solo la sosta: `stopS` secondi fermi (GPS a `speed`), giroscopio = bias + rumore
   + `extra(r)`; ritorna la stima e quante finestre sono servite. */
function stop({ bias = 2, rms = 0, stopS = 10, speed = 0, extra = null, gpsFresh = true, seed = 7 } = {}) {
  return withSim((sim, st) => {
    const r = rng(seed), amp = rms * Math.sqrt(3);
    for (let i = 0; i < stopS * 60; i++) {
      if (i % 60 === 0 && gpsFresh) sim.gps(speed);
      const e = extra ? extra(r) : { x: 0, y: 0, z: 0 };
      sim.step(
        { x: G + (r() * 2 - 1) * amp * G, y: (r() * 2 - 1) * amp * G, z: (r() * 2 - 1) * amp * G },
        { x: bias + e.x + (r() * 2 - 1) * 5, y: bias + e.y + (r() * 2 - 1) * 5, z: bias + e.z + (r() * 2 - 1) * 5 });
    }
    return { b: { ...st.gyroBiasStill }, n: st.gyroBiasStillN };
  });
}

test('da fermi misura il bias su tutti e tre gli assi, anche col motore che vibra', () => {
  for (const rms of [0, 0.3]) {
    const r = stop({ rms });
    assert.ok(r.n >= 3, 'finestre di quiete: ' + r.n);
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(r.b[k] - 2) < 0.3, rms + ' g: ' + k + ' = ' + r.b[k].toFixed(2));
  }
});

// Misura da 20 a 65 s dopo la partenza, media su 5 semi.
const LONG = { from: 20, to: 65 };

test('rettilineo con bias 2 °/s: da ~5° a sotto 1° dopo una sosta di 10 s', () => {
  const senza = meanOver({ deg: 0, bias: 2, ...LONG }), con = meanOver({ deg: 0, bias: 2, stopS: 10, ...LONG });
  assert.ok(senza > 4, 'premessa: senza sosta ' + senza.toFixed(2) + '°');                  // misurato 5,2°
  assert.ok(con < 1, 'con sosta ' + con.toFixed(2) + '°');                                  // misurato 0,6°
  const vib = meanOver({ deg: 0, bias: 2, amp: 0.3 * Math.sqrt(3), stopS: 10, ...LONG });
  assert.ok(vib < 2.3, 'con 0,3 g RMS: ' + vib.toFixed(2) + '°');                          // misurato 1,7°
});

test('curva tenuta: dopo la sosta il bias non conta più (errore uguale a bias zero)', () => {
  const b2 = meanOver({ deg: 30, bias: 2, stopS: 10, ...LONG }), b0 = meanOver({ deg: 30, bias: 0, stopS: 10, ...LONG });
  const senza = meanOver({ deg: 30, bias: 2, ...LONG });
  assert.ok(senza > b2 + 3, 'premessa: senza sosta ' + senza.toFixed(2) + '° contro ' + b2.toFixed(2) + '°');  // 5,7 contro 0,6
  assert.ok(Math.abs(b2 - b0) < 0.3, 'bias 2: ' + b2.toFixed(2) + '°, bias 0: ' + b0.toFixed(2) + '°');
});

test('nessun falso fermo: in marcia, in galleria, in una curva a passo d\'uomo, col telefono in mano', () => {
  // In marcia (GPS 20 m/s, curva tenuta): mai.
  const moving = withSim((sim, st) => {
    for (let i = 0; i < 30 * 60; i++) { if (i % 60 === 0) sim.gps(20); sim.step({ x: G / Math.cos(Math.PI / 6), y: 0, z: 0 }, { x: -12, y: -7, z: 1 }); }
    return st.gyroBiasStillN;
  });
  assert.equal(moving, 0);
  // Galleria: nessun fix nuovo, il GPS è stantio.
  assert.equal(stop({ bias: 1, gpsFresh: false }).n, 0);
  // Manovra a passo d'uomo (GPS 0,3 m/s) girando a 10 °/s: rotazione vera, non bias.
  assert.equal(stop({ bias: 1, speed: 0.3, extra: () => ({ x: 10, y: 0, z: 0 }) }).n, 0);
  // Telefono maneggiato da fermi: rotazioni ampie a media quasi nulla.
  assert.equal(stop({ bias: 1, extra: r => ({ x: (r() * 2 - 1) * 60, y: (r() * 2 - 1) * 60, z: (r() * 2 - 1) * 60 }) }).n, 0);
});

test('il bias da fermi azzera il residuo imparato dal filtro e resta fuori dal segno del giroscopio', () => {
  withSim((sim, st) => {
    st.attBias = { x: 0.7, y: -0.4, z: 0.2 };
    st.gyroSign = -1;
    for (let i = 0; i < 180; i++) {
      if (i % 60 === 0) sim.gps(0);
      sim.step({ x: G, y: 0, z: 0 }, { x: 1.5, y: -0.5, z: 0.25 });
    }
    // Stimato negli assi del SENSORE: stesso valore qualunque sia gyroSign.
    assert.ok(st.gyroBiasStillN >= 1);
    assert.ok(Math.abs(st.gyroBiasStill.x - 1.5) < 1e-6 && Math.abs(st.gyroBiasStill.z - 0.25) < 1e-6);
    assert.ok(Math.abs(st.attBias.x) < 0.05, 'residuo del filtro non azzerato: ' + st.attBias.x);
  });
});
