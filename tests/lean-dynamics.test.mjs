// Le affermazioni del README sulla piega in manovra ("Altri casi"), ricontrollate
// con la simulazione realistica (tests/lean-sim.mjs): GPS perso a metà curva,
// segno del giroscopio invertito all'avvio, frenata tenendo la piega.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './harness.mjs';
import { withSim, rng, steadyTurn } from './lean-sim.mjs';

const { G } = api;
const win = (tr, a, b) => {
  const e = tr.filter(([s]) => s >= a && s < b).map(([, x]) => Math.abs(x));
  return { mean: e.reduce((p, q) => p + q, 0) / e.length, max: Math.max(...e) };
};

test('GPS assente per 8 s a metà curva: la piega resta sotto il grado', () => {
  for (const seed of [7, 42]) {
    const tr = withSim((sim, st) => {
      const r = rng(seed), { w, f } = steadyTurn(30, 20), out = [];
      for (let i = 0; i < 30 * 60; i++) {
        const sec = i / 60;
        if (i % 60 === 0 && !(sec >= 15 && sec < 23)) sim.gps(20);
        sim.step(f, { x: w.x + (r() * 2 - 1) * 2, y: w.y + (r() * 2 - 1) * 2, z: (r() * 2 - 1) * 2 });
        out.push([sec, st.lean - 30]);
      }
      return out;
    });
    assert.ok(win(tr, 15, 25).max < 1.5, 'seme ' + seed + ': max ' + win(tr, 15, 25).max.toFixed(2) + '°');   // misurato ≤ 0,8°
  }
});

/* 12 s a passo d'uomo oscillando di ±12° (dove il segno si impara), poi curva a 30°. */
function signRide(sign, seed) {
  return withSim((sim, st) => {
    const r = rng(seed), { w, f } = steadyTurn(30, 20), tr = [];
    let lockedAt = null;
    for (let i = 0; i < 40 * 60; i++) {
      const sec = i / 60, slow = sec < 12;
      if (i % 60 === 0) sim.gps(slow ? 1.5 : 20);
      let ff = f, ww = w, want = 30;
      if (slow) {
        const a = 12 * Math.sin(2 * Math.PI * 0.3 * sec), p = a * Math.PI / 180;
        ff = { x: G * Math.cos(p), y: G * Math.sin(p), z: 0 };
        ww = { x: 0, y: 0, z: -12 * 2 * Math.PI * 0.3 * Math.cos(2 * Math.PI * 0.3 * sec) };
        want = a;
      }
      sim.step(ff, { x: sign * (ww.x + (r() * 2 - 1) * 2), y: sign * (ww.y + (r() * 2 - 1) * 2), z: sign * (ww.z + (r() * 2 - 1) * 2) });
      if (lockedAt == null && st.gyroSignLocked) lockedAt = sec;
      tr.push([sec, st.lean - want]);
    }
    return { tr, sign: st.gyroSign, lockedAt };
  });
}

test('segno del giroscopio invertito: corretto nei primi secondi lenti, poi stesso risultato', () => {
  for (const seed of [7, 42]) {
    const ok = signRide(1, seed), inv = signRide(-1, seed);
    assert.equal(inv.sign, -1, 'segno non corretto');
    assert.ok(inv.lockedAt != null && inv.lockedAt < 5, 'corretto a ' + inv.lockedAt + ' s');       // misurato 1,4 s
    const a = win(ok.tr, 20, 40).mean, b = win(inv.tr, 20, 40).mean;
    assert.ok(Math.abs(a - b) < 0.2, 'in curva: segno giusto ' + a.toFixed(2) + '°, invertito ' + b.toFixed(2) + '°');
  }
});

/* Curva a 30° a 20 m/s, frenata a 5 m/s² per 2 s tenendo la piega, poi 10 m/s. GPS a
   1 Hz con 0,6 s di ritardo. Fissa il comportamento misurato, compreso il difetto
   dopo la frenata (la velocità fusa resta indietro e la stima sbaglia di 7-9° per
   circa un secondo): se il filtro migliora, abbassare le soglie. */
test('frenata da 5 m/s² tenendo 30°: ≤ ~7° durante, picco dopo, rientro sotto il grado in 5 s', () => {
  for (const seed of [7, 42, 99]) {
    const tr = withSim((sim, st) => {
      const r = rng(seed), phi = Math.PI / 6, out = [];
      const vAt = s => s < 20 ? 20 : (s < 22 ? 20 - 5 * (s - 20) : 10);
      for (let i = 0; i < 32 * 60; i++) {
        const sec = i / 60, v = vAt(sec), psi = (G * Math.tan(phi) / v) * (180 / Math.PI);
        if (i % 60 === 0) sim.gps(vAt(Math.max(0, sec - 0.6)));
        sim.step({ x: G / Math.cos(phi), y: 0, z: sec >= 20 && sec < 22 ? 5 : 0 },
          { x: -psi * Math.cos(phi) + (r() * 2 - 1) * 2, y: -psi * Math.sin(phi) + (r() * 2 - 1) * 2, z: (r() * 2 - 1) * 2 });
        out.push([sec, st.lean - 30]);
      }
      return out;
    });
    assert.ok(win(tr, 20, 22).max < 8, 'durante: max ' + win(tr, 20, 22).max.toFixed(1) + '°');     // misurato 6,0-6,8°
    assert.ok(win(tr, 22, 23).max < 11, 'subito dopo: max ' + win(tr, 22, 23).max.toFixed(1) + '°');  // misurato 8,7-9,4°
    assert.ok(win(tr, 27, 32).mean < 0.8, 'rientro: ' + win(tr, 27, 32).mean.toFixed(2) + '°');      // misurato 0,2-0,3°
  }
});
