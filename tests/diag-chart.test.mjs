import { test } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { api, resetState, tickIntervals, vmSandbox } from './harness.mjs';

const s = vmSandbox;

/* Context 2D finto: registra le chiamate. Il Proxy copre anche i metodi che
   drawChart impara a usare dopo (save/clip/restore): uno stub a mano li perdeva
   e il test moriva con "ctx.save is not a function", non con l'assert giusto. */
function recCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, k) { return (...a) => { calls.push({ op: k, a }); }; },
    set() { return true; },
  });
  return { ctx, calls };
}

function recCanvas(w, h, ctx) {
  return { clientWidth: w, clientHeight: h, width: 0, height: 0, getContext: () => ctx };
}

// canvasTheme.get() legge getComputedStyle: fuori dal browser non esiste.
function themeCache() {
  api.canvasTheme._c = {
    'c-bg': '#000', 'c-grid': '#222', 'c-axis': '#888', 'c-accent': '#0af',
    'c-good': '#0f0', 'c-bad': '#f00', 'c-warn': '#fa0', 'c-txt': '#fff',
  };
}

test('diagVerdict: livelli utente', () => {
  assert.match(api.diagVerdict({ calib: false, demo: false }), /Non calibrato/);
  assert.match(api.diagVerdict({ calib: true, vibG: 0.05 }), /OK/);
  assert.match(api.diagVerdict({ calib: true, vibG: 0.2 }), /media/);
  assert.match(api.diagVerdict({ calib: true, vibG: 0.5 }), /alta/);
  assert.match(api.diagVerdict({ demo: true, vibG: 0 }), /OK/);
});

test('diagTicks: belli 1/2/5, include zero, range coperto', () => {
  const t = api.diagTicks(-1.2, 1.2, 4);
  assert.ok(t.includes(0), 'zero marcato, non interpolato');
  assert.ok(t.every(v => v >= -1.2 - 1e-9 && v <= 1.2 + 1e-9), 'tick interni al range: ' + JSON.stringify(t));
  const t2 = api.diagTicks(0, 100, 4);
  assert.deepEqual(t2, [0, 50, 100], 'step 50 (norm 3.3 -> 5): ' + JSON.stringify(t2));
});

test('diagChartScale: velocita dinamica, piega/G fissi', () => {
  const s = api.diagChartScale('speedKph', [{ speedKph: 10 }, { speedKph: 95 }]);
  assert.equal(s.min, 0);
  assert.ok(s.max >= 95 && s.max % 20 === 0);
  // Niente campo `zero`: era letto da nessuno (l'asse zero lo marca il loop dei
  // tick di drawChart) — se qualcuno lo reintroduce senza consumatore, rosso qui.
  assert.deepEqual(api.diagChartScale('lean', []), { min: -60, max: 60 });
  assert.deepEqual(api.diagChartScale('latG', []), { min: -1.2, max: 1.2 });
});

/* #25: il badge accanto a "Velocità" mostrava il fondo scala dell'asse
   (ceil(punta/20)*20+20, base 80 → mai sotto 100), non la punta: a 62 km/h
   veri diceva "100 km/h", e a inizio sessione senza campioni pure. Il badge G
   accanto mostra i valori misurati. */
test('drawCharts: chSpeedMax mostra la punta misurata, non il fondo scala', () => {
  const { ctx } = recCtx();
  const canvas = el => { el.clientWidth = 200; el.getContext = () => ctx; return el; };
  themeCache();
  canvas(api.els.chSpeed); canvas(api.els.chLean); canvas(api.els.chLat);

  resetState();
  api.state.chartBuf = [
    { t: 0, speedKph: 20, lean: 5, latG: 0.1, lonG: 0.2 },
    { t: 1000, speedKph: 62, lean: -12, latG: -0.3, lonG: 0.4 },
  ];
  assert.doesNotThrow(() => api.drawCharts());
  assert.equal(api.els.chSpeedMax.textContent, '62 km/h',
    'badge: ' + api.els.chSpeedMax.textContent + ' (fondo scala ' + api.diagChartScale('speedKph', api.state.chartBuf).max + ')');

  // Buffer vuoto o senza speedKph finiti: nessun "0" né "NaN" inventato.
  api.state.chartBuf = [];
  api.drawCharts();
  assert.equal(api.els.chSpeedMax.textContent, '—');
  api.state.chartBuf = [{ t: 0, speedKph: null }, { t: 1, speedKph: NaN }];
  api.drawCharts();
  assert.equal(api.els.chSpeedMax.textContent, '—');

  api.canvasTheme.reset();
  resetState();
});

/* #29: la griglia parte da x=30 (gutter per le label a x=2) ma la traccia
   partiva da x=0: ogni tick tagliava il tracciato. */
test('#29 drawCharts: traccia e griglia confinate al riquadro, mai nel gutter', () => {
  const { ctx, calls: ops } = recCtx();
  themeCache();
  api.els.chSpeed = recCanvas(300, 120, ctx);
  api.els.chLean = recCanvas(300, 120, ctx);
  api.els.chLat = recCanvas(300, 120, ctx);

  resetState();
  api.state.chartBuf = [
    { t: 0, speedKph: 20, lean: 0, latG: 0, lonG: 0 },
    { t: 1000, speedKph: 80, lean: 65, latG: 0.4, lonG: 0 },   // lean 65 > scala ±60
  ];
  api.drawCharts();

  const seg = ops.filter(o => o.op === 'moveTo' || o.op === 'lineTo');
  assert.ok(seg.length > 0, 'nessun segmento disegnato');
  const minimo = Math.min(...seg.map(o => o.a[0]));
  assert.ok(minimo >= 30, 'disegno dentro il gutter delle label (x=' + minimo + ')');
  // moveTo: uno per tick + quello d'apertura della traccia, tutti a x=30.
  assert.ok(seg.filter(o => o.op === 'moveTo').every(o => o.a[0] === 30),
    'moveTo fuori dal bordo del riquadro');

  // Clip al riquadro: la piega a 65° non deve uscire dal canvas.
  const rect = ops.find(o => o.op === 'rect');
  assert.ok(rect, 'nessun clip: un valore fuori scala dipinge fuori dal riquadro');
  assert.deepEqual(rect.a, [30, 0, 270, 120]);
  assert.ok(ops.some(o => o.op === 'clip') && ops.some(o => o.op === 'restore'),
    'save/clip/restore non bilanciati');

  api.canvasTheme.reset();
  resetState();
});

/* #31: `bench` non veniva mai azzerato e la guardia di finishBench era morta. */
test('#31 finishBench: libera i campioni e non riscrive il referto a vuoto', () => {
  resetState();
  /* Il timer di startBench misura l\'elapsed con Date.now: per arrivare a
     BENCH_SEC senza 20 s veri si sostituisce solo Date.now nel contesto vm (non
     l\'intero Date: finishBench e il resto usano new Date). */
  s.__now = 0;
  vm.runInContext('globalThis.__realNow = Date.now; Date.now = () => globalThis.__now;', s);
  try {
    const now = v => { s.__now = v; };
    api.state.demo = true;          // startBench esige calibrazione o demo
    api.startBench();
    assert.ok(api.benchPeek(), 'bench non inizializzato da startBench');
    // serve un campione per giro e almeno 10 campioni, o finishBench esce con
    // "Dati insufficienti" e il referto non viene mai costruito.
    for (let i = 0; i < 15; i++) tickIntervals();
    now((api.BENCH_SEC + 1) * 1000);
    tickIntervals();                // oltre BENCH_SEC -> finishBench
    assert.equal(api.benchPeek(), null, 'campioni del test a banco mai liberati');

    const referto = api.els.benchOut.children.slice();
    assert.ok(referto.length > 3, 'referto non scritto: ' + referto.length + ' righe');
    api.finishBench();              // seconda chiamata: nessun dato nuovo
    assert.equal(api.els.benchOut.children.length, referto.length, 'referto riscritto');
    assert.equal(api.els.benchOut.children[0], referto[0],
      'referto VECCHIO ricostruito come se fosse nuovo');
  } finally {
    vm.runInContext('Date.now = globalThis.__realNow;', s);
    delete s.__now;
    resetState();
  }
});
