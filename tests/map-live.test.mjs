import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';

const { state, els, drawTrackOnCanvas, rotContainerPoint, rotClientPoint, applyMapRotation } = api;
const s = vmSandbox;

// Canvas finto: registra ogni chiamata di disegno. serve per sapere DOVE è stato
// disegnato il marker (raggio 6) e se è comparso il testo "Nessun fix GPS".
function fakeCanvas(w, h) {
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 10 });
      return (...a) => { calls.push({ op: k, a }); };
    },
    set() { return true; },
  });
  return {
    calls,
    clientWidth: w, clientHeight: h, width: 0, height: 0,
    getContext: () => ctx,
    // chiamate per nome di metodo (ctx.fillStyle = … passa da `set`, non finisce qui)
    ops: (op) => calls.filter(c => c.op === op),
    arcs: (r) => calls.filter(c => c.op === 'arc' && c.a[2] === r),
    texts: () => calls.filter(c => c.op === 'fillText').map(c => String(c.a[0])),
  };
}

// canvasTheme.get() legge getComputedStyle: fuori dal browser non esiste.
function withComputedStyle(fn) {
  const had = 'getComputedStyle' in s;
  const prev = s.getComputedStyle;
  s.getComputedStyle = () => ({ getPropertyValue: () => '' });
  try { return fn(); } finally {
    if (had) s.getComputedStyle = prev; else delete s.getComputedStyle;
  }
}

// ---- #24: il marker segue il fix GPS vivo, non l'ultimo punto di traccia ----

test('drawTrackOnCanvas: marker sulla posizione corrente, non sull\'ultimo punto di traccia', () => {
  withComputedStyle(() => {
    // Traccia ferma (log spento, o fermo da un po') e fix GPS lontano da essa:
    // la traccia non avanza finché non si supera TRACK_MIN_M a log attivo.
    const track = [{ lat: 45.000, lon: 9.000 }, { lat: 45.001, lon: 9.001 }];
    const cur = { lat: 46.0, lon: 10.0 };
    const cv = fakeCanvas(300, 200);
    // center = il fix vivo: con l'anchor sul fix il marker deve cadere esattamente
    // al centro del canvas (X(cur.lon) = w/2). Sull'ultimo punto di traccia no.
    drawTrackOnCanvas(cv, track, { current: true, cur, center: cur });
    const m = cv.arcs(6);
    assert.equal(m.length, 1, 'marker di posizione corrente non disegnato');
    assert.equal(m[0].a[0], 150, 'marker non centrato: usato track[track.length-1] invece del fix vivo');
    assert.equal(m[0].a[1], 100, 'marker non centrato: usato track[track.length-1] invece del fix vivo');
  });
});

test('drawTrackOnCanvas: fix senza traccia non dice "Nessun fix GPS" (bug #24)', () => {
  withComputedStyle(() => {
    const cur = { lat: 45.0, lon: 9.0 };
    const cv = fakeCanvas(300, 200);
    drawTrackOnCanvas(cv, [], { current: true, cur });
    assert.deepEqual(cv.texts(), [], '"Nessun fix GPS" con un fix valido: la mappa mentiva');
    const m = cv.arcs(6);
    assert.equal(m.length, 1, 'fix presente ma marker non disegnato');
    // Estensione nulla (un solo punto): va centrato, non lasciato nell'angolo.
    assert.equal(m[0].a[0], 150, 'punto singolo disegnato fuori dal centro');
    assert.equal(m[0].a[1], 100, 'punto singolo disegnato fuori dal centro');
  });
});

test('drawTrackOnCanvas: davvero senza fix (né traccia né camere né rotta) il messaggio resta', () => {
  withComputedStyle(() => {
    const cv = fakeCanvas(300, 200);
    drawTrackOnCanvas(cv, [], { current: true });
    assert.deepEqual(cv.texts(), ['Nessun fix GPS']);
    assert.equal(cv.arcs(6).length, 0);
  });
});

test('drawTrackOnCanvas: col follow off il marker sul fix vivo resta nel riquadro (traccia a 1 punto)', () => {
  withComputedStyle(() => {
    // Log appena acceso: la traccia ha il punto di partenza, il fix vivo è 600 m più
    // avanti. follow off → niente center. Senza il fix nei bounds lo span resta quello
    // di un punto solo, gonfiato dal floor a 0.0001 (~15 m di finestra): il marker,
    // che ora è sul fix VIVO, finisce fuori dal canvas. Prima della fix #24 il marker
    // stava sull'ultimo punto di traccia, che nei bounds c'era sempre: lo schermo
    // vuoto è la regressione che la fix #24 ha introdotto.
    const track = [{ lat: 45.0, lon: 9.0 }];
    const cur = { lat: 45.0054, lon: 9.0 };   // ~600 m a nord
    const cv = fakeCanvas(300, 200);
    drawTrackOnCanvas(cv, track, { cur });
    const m = cv.arcs(6);
    assert.equal(m.length, 1, 'marker non disegnato');
    const [x, y] = [m[0].a[0], m[0].a[1]];
    assert.ok(x >= 0 && x <= 300 && y >= 0 && y <= 200,
      'marker sul fix fuori dal canvas con follow off (' + x + ', ' + y + ')');
    // Non è solo dentro: è dentro con un'inquadratura sensata, che tiene entrambi i
    // punti. Senza il fix nei bounds lo span restava 0.0001° (~15 m di finestra,
    // ~9000 px/°): il marker sarebbe finito a y ≈ −3700, cioè mai disegnato.
    assert.ok(Math.abs(y - 28) < 8, 'inquadratura non estesa al fix: y = ' + y);
  });
});

test('drawTrackOnCanvas: i chiamanti storici (replay, solo startEnd) disegnano inizio/fine e nessun marker corrente', () => {
  withComputedStyle(() => {
    const track = [{ lat: 45.0, lon: 9.0 }, { lat: 45.5, lon: 9.5 }];
    const cv = fakeCanvas(300, 200);
    drawTrackOnCanvas(cv, track, { startEnd: true });
    // Inizio (verde) e fine (rossa): entrambi raggio 5, e il marker corrente (6) non c'è.
    assert.equal(cv.arcs(5).length, 2, 'start/end persi nel replay');
    assert.equal(cv.arcs(6).length, 0, 'marker "corrente" disegnato nel replay');
  });
});

// ---- #23: puntatore su container Leaflet ruotato via CSS ----

test('rotContainerPoint: a 0° coincide con la formula di Leaflet', () => {
  const rect = { left: 10, top: 20, width: 300, height: 200 };
  const p = rotContainerPoint(110, 70, rect, 300, 200, 0);
  assert.equal(p.x, 100);   // 110 - rect.left
  assert.equal(p.y, 50);    // 70 - rect.top
});

test('rotContainerPoint: il centro dell\'elemento resta fermo a ogni angolo', () => {
  // Inviluppo di un 300x200 ruotato: stessa centro, dimensioni scambiate a 90°.
  const cases = [[0, { left: 100, top: 50, width: 300, height: 200 }],
                 [90, { left: 150, top: 0, width: 200, height: 300 }],
                 [-90, { left: 150, top: 0, width: 200, height: 300 }],
                 [180, { left: 100, top: 50, width: 300, height: 200 }],
                 [37, { left: 60, top: 30, width: 640, height: 520 }]];
  for (const [deg, rect] of cases) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const p = rotContainerPoint(cx, cy, rect, 300, 200, deg);
    assert.equal(p.x, 150, 'centro spostato a ' + deg + '°');
    assert.equal(p.y, 100, 'centro spostato a ' + deg + '°');
  }
});

test('rotContainerPoint: annulla la rotazione (punto noto a 90° e 180°)', () => {
  // Elemento 300x200. Un punto a +100 sull'asse x dell'elemento, ruotato di 90°
  // in senso orario (rotate positivo, y verso il basso), finisce 100 px SOTTO il
  // centro sullo schermo. La coordinata container deve tornare +100 sull'asse x.
  const rect90 = { left: 150, top: 0, width: 200, height: 300 }; // centro (250, 150)
  const p90 = rotContainerPoint(250, 250, rect90, 300, 200, 90);
  assert.ok(Math.abs(p90.x - 250) < 1e-9, 'x a 90°: ' + p90.x);
  assert.ok(Math.abs(p90.y - 100) < 1e-9, 'y a 90°: ' + p90.y);

  const rect180 = { left: 100, top: 50, width: 300, height: 200 }; // centro (250, 150)
  const p180 = rotContainerPoint(150, 150, rect180, 300, 200, 180);
  assert.ok(Math.abs(p180.x - 250) < 1e-9, 'x a 180°: ' + p180.x);
  assert.ok(Math.abs(p180.y - 100) < 1e-9, 'y a 180°: ' + p180.y);
});

test('rotContainerPoint: andata (elemento→schermo) e ritorno si annullano', () => {
  const w = 300, h = 200;
  for (const deg of [0, 15, 45, 90, -90, 137, 180, -180, 270]) {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    // Inviluppo reale (come lo darebbe getBoundingClientRect) di un 300x200 ruotato.
    const rw = Math.abs(w * ca) + Math.abs(h * sa), rh = Math.abs(w * sa) + Math.abs(h * ca);
    const rect = { left: 40, top: 25, width: rw, height: rh };
    const ccx = rect.left + rw / 2, ccy = rect.top + rh / 2;
    for (const [vx, vy] of [[0, 0], [100, 0], [0, -60], [-30, 45]]) {
      // elemento → schermo: rotazione di +deg attorno al centro
      const screenX = ccx + ca * vx - sa * vy;
      const screenY = ccy + sa * vx + ca * vy;
      const p = rotContainerPoint(screenX, screenY, rect, w, h, deg);
      assert.ok(Math.abs(p.x - (w / 2 + vx)) < 1e-9, 'x @' + deg + '° v=' + vx + ',' + vy + ' → ' + p.x);
      assert.ok(Math.abs(p.y - (h / 2 + vy)) < 1e-9, 'y @' + deg + '° v=' + vx + ',' + vy + ' → ' + p.y);
    }
  }
});

test('applyMapRotation: hook del puntatore sul map Leaflet, con l\'angolo giusto', () => {
  resetState();
  const mapEl = els.map;
  const saved = {
    rect: mapEl.getBoundingClientRect, ow: mapEl.offsetWidth, oh: mapEl.offsetHeight,
    cl: mapEl.clientLeft, ct: mapEl.clientTop,
  };
  const hadTransform = 'transform' in mapEl.style ? mapEl.style.transform : undefined;
  // #map:142% ruotato di 90° → inviluppo 200x300 (stesso centro), come nel CSS reale.
  mapEl.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 300 });
  mapEl.offsetWidth = 300; mapEl.offsetHeight = 200;
  mapEl.clientLeft = 0; mapEl.clientTop = 0;
  // Leaflet in index.html è caricato a runtime (initMap → <script src>), quindi
  // nella sandbox `L` non esiste: il container point va comunque un L.Point vero.
  const hadL = 'L' in s, prevL = s.L;
  s.L = { point: (x, y) => ({ x, y, distanceTo: o => Math.hypot(o.x - x, o.y - y) }) };
  const seen = [];
  const prevMap = state.map, prevType = state.mapType;
  const prevTrackUp = state.trackUp, prevHeading = state.gps.heading, prevSpeed = state.speedMs;
  state.map = {
    _container: mapEl,
    mouseEventToContainerPoint(e) { seen.push(e); return { x: -1, y: -1, orig: true }; },
  };
  state.mapType = 'leaflet';
  state.trackUp = true;
  state.gps.heading = 90;
  state.speedMs = 10;   // sopra HEADING_MIN_MS: l'heading GPS è usato per il track-up
  try {
    applyMapRotation();
    assert.equal(state.mapRotDeg, -90, 'angolo memorizzato non aggiornato');
    assert.equal(mapEl.style.transform, 'rotate(-90deg)', 'transform CSS non applicata');

    // Click 50 px SOTTO il centro dello schermo. Con la mappa ruotata di −90° il
    // punto che sta sotto il centro è, nell'elemento, 50 px a SINISTRA: → (100, 100).
    // (È il caso reale del track-up: rotazione −heading, tap in alto = davanti.)
    const p = state.map.mouseEventToContainerPoint({ clientX: 200, clientY: 250 });
    assert.equal(seen.length, 0, 'con rotazione attiva si deve compensare, non delegare');
    assert.ok(Math.abs(p.x - 100) < 1e-9, 'container point x = ' + p.x);
    assert.ok(Math.abs(p.y - 100) < 1e-9, 'container point y = ' + p.y);
    assert.equal(typeof p.distanceTo, 'function', 'deve essere un L.Point, non un oggetto nudo');

    // Angolo 0: si delega a Leaflet (nessuna compensazione da fare).
    state.gps.heading = null; state.compass = null;
    applyMapRotation();
    assert.equal(state.mapRotDeg, 0, 'con heading nullo la rotazione deve spegnersi');
    assert.equal(mapEl.style.transform, '', 'transform stantia rimasta accesa');
    const q = state.map.mouseEventToContainerPoint({ clientX: 200, clientY: 250 });
    assert.equal(seen.length, 1, 'a 0° deve passare dal metodo originale di Leaflet');
    assert.equal(q.orig, true);
  } finally {
    mapEl.getBoundingClientRect = saved.rect;
    mapEl.offsetWidth = saved.ow; mapEl.offsetHeight = saved.oh;
    mapEl.clientLeft = saved.cl; mapEl.clientTop = saved.ct;
    if (hadTransform) mapEl.style.transform = hadTransform; else delete mapEl.style.transform;
    state.map = prevMap; state.mapType = prevType;
    state.trackUp = prevTrackUp; state.gps.heading = prevHeading; state.speedMs = prevSpeed;
    if (hadL) s.L = prevL; else delete s.L;
    resetState();
  }
});

test('applyMapRotation: anche il pan col dito (L.Draggable) va compensato', () => {
  resetState();
  const mapEl = els.map;
  const saved = {
    rect: mapEl.getBoundingClientRect, ow: mapEl.offsetWidth, oh: mapEl.offsetHeight,
    cw: mapEl.clientWidth, ch: mapEl.clientHeight,
  };
  const hadTransform = 'transform' in mapEl.style ? mapEl.style.transform : undefined;
  /* #map a 142% di .map-box.rot: elemento 300x200 (offset), inviluppo 426x284. La
     scala di Leaflet è AABB/offset = 1.42, uniforme solo se non c'è rotazione. */
  mapEl.getBoundingClientRect = () => ({ left: 100, top: 50, width: 426, height: 284 });
  mapEl.offsetWidth = 300; mapEl.offsetHeight = 200;
  mapEl.clientWidth = 300; mapEl.clientHeight = 200;
  const hadL = 'L' in s, prevL = s.L;
  s.L = { point: (x, y) => ({ x, y, distanceTo: o => Math.hypot(o.x - x, o.y - y) }) };

  /* Draggable finto con la meccanica vera di Leaflet: _startPoint fissato al
     mousedown, _onMove misura il delta dalle clientX/Y grezze dell'evento e lo
     divide per _parentScale. È esattamente il punto in cui il frame schermo entra
     in quello locale della pane. */
  const PANE = { x: 0, y: 0 };
  // Il bersaglio del drag in un browser è un elemento con classList (o un SVG con
  // className.baseVal): mai un oggetto nudo. Da qui la guardia in cam-map.js, e da
  // qui le due prove sotto: con un target vero il pan si compensa, con uno nudo
  // (l'evento copiato a mano) deve delegare invece di piantarsi in addClass.
  const realTarget = { classList: { add() {}, remove() {} }, className: '' };
  const bareTarget = {};
  const dg = {
    _element: mapEl, _parentScale: { x: 1, y: 1 },
    _onDown(e) {
      dg._startPoint = { x: e.clientX, y: e.clientY };
      dg._parentScale = {
        x: mapEl.getBoundingClientRect().width / mapEl.offsetWidth,
        y: mapEl.getBoundingClientRect().height / mapEl.offsetHeight,
      };
    },
    _onMove(e) {
      const dx = (e.clientX - dg._startPoint.x) / dg._parentScale.x;
      const dy = (e.clientY - dg._startPoint.y) / dg._parentScale.y;
      PANE.x += dx; PANE.y += dy;
      /* addClass di Leaflet, sulla stessa riga di _onMove:
         `M(this._lastTarget, 'leaflet-drag-target')` con `_lastTarget = t.target ||
         t.srcElement`, e M fa `void 0 !== t.classList ? t.classList.add(...) :
         ye(t, ...)`, dove ye legge `t.className.baseVal`. Con un target nudo (una
         copia dell'evento fatta a mano) si arriva a `className.baseVal` di undefined
         → TypeError: è il caso del pan su mappa ruotata, quindi il finto Draggable
         deve riprodurlo o il test non prova nulla. */
      const lt = e.target || e.srcElement;
      if (!lt) throw new TypeError("Cannot read properties of undefined (reading 'classList')");
      if (lt.classList !== undefined) lt.classList.add('leaflet-drag-target');
      else if (lt.className == null || typeof lt.className === 'string') lt.className = 'leaflet-drag-target';
      else if ('baseVal' in lt.className) lt.className.baseVal = 'leaflet-drag-target';
      else throw new TypeError("Cannot read properties of undefined (reading 'baseVal')");
    },
  };
  const prevMap = state.map, prevType = state.mapType;
  const prevTrackUp = state.trackUp, prevHeading = state.gps.heading, prevSpeed = state.speedMs;
  state.map = {
    _container: mapEl,
    mouseEventToContainerPoint(e) { return { x: e.clientX, y: e.clientY }; },
    dragging: { _draggable: dg, enable() {} },
  };
  state.mapType = 'leaflet';
  state.trackUp = true;
  state.gps.heading = 90;
  state.speedMs = 10;
  try {
    applyMapRotation();
    assert.equal(state.mapRotDeg, -90);
    assert.equal(dg._rotDrag, true, 'drag hook non installato da applyMapRotation');

    // Dito al centro dello schermo, trascinato di 40 px a DESTRA. La pane si muove
    // nel suo frame LOCALE, che la rotazione di −90° ha ruotato rispetto allo
    // schermo: "destra sullo schermo" lì dentro vale (0, +1), quindi il delta è
    // (0, +40). Senza compensazione sarebbe rimasto (40, 0): perpendicolare al dito.
    dg._onDown({ clientX: 250, clientY: 150, button: 0, target: realTarget });
    // Confronto per campo, non deepEqual: l'oggetto nasce dentro la vm e il suo
    // Object.prototype non è quello del realm del test.
    assert.equal(dg._parentScale.x, 1, 'scala AABB di un elemento ruotato non annullata (x)');
    assert.equal(dg._parentScale.y, 1, 'scala AABB di un elemento ruotato non annullata (y)');
    /* Il move con un target VERO: la copia ruotata attraversa addClass di Leaflet
       senza lanciare, ed è l'unico caso in cui il pan viene compensato. */
    dg._onMove({ clientX: 290, clientY: 150, target: realTarget });
    assert.ok(Math.abs(PANE.x) < 1e-9, 'pan in x non compensato: ' + PANE.x);
    assert.ok(Math.abs(PANE.y - 40) < 1e-9, 'pan in y non compensato: ' + PANE.y);

    // Secondo move: il dito scende di 40 px sullo schermo. Il delta locale è
    // (−40, 0) — di nuovo una rotazione pura, non una somma di componenti — e la
    // distanza percorsa resta 40 px. L'origine non si sposta: nessun accumulo.
    dg._onMove({ clientX: 290, clientY: 190, target: realTarget });
    assert.ok(Math.abs(PANE.x + 40) < 1e-9, 'pan in x al secondo move: ' + PANE.x);
    assert.ok(Math.abs(PANE.y - 80) < 1e-9, 'pan in y al secondo move: ' + PANE.y);

    /* Target nudo (l'evento ricostruito a mano): la guardia deve delegare a Leaflet
       invece di consegnargli la copia, perché `M(t.target)` su un oggetto senza
       classList/className lancia TypeError e il drag si pianta al primo move. */
    PANE.x = 0; PANE.y = 0;
    assert.doesNotThrow(() => dg._onMove({ clientX: 300, clientY: 200, target: bareTarget }),
      'evento con target senza classList: Leaflet lancia in addClass');
    /* Delegato a Leaflet: delta grezzo dall'origine del gesto, (50, 50), senza
       compensazione e con _parentScale = 1. Non è la posizione giusta sullo schermo,
       ma il gesto non si pianta — che è il motivo per cui esiste la guardia. */
    assert.ok(Math.abs(PANE.x - 50) < 1e-9 && Math.abs(PANE.y - 50) < 1e-9,
      'con target nudo il delta deve restare quello grezzo di Leaflet: ' + PANE.x + ',' + PANE.y);
    // L'invariante che conta: il delta locale è il delta del dito passato per la
    // formula di rotazione, con la stessa convenzione di rotContainerPoint. La
    // distanza percorsa non cambia (rotazione pura, non scala).
    const want = rotClientPoint(0, 0, { clientX: 0, clientY: 40 }, state.mapRotDeg);
    assert.ok(Math.abs(want.clientX + 40) < 1e-9 && Math.abs(want.clientY) < 1e-9,
      'formula di riferimento incoerente: (' + want.clientX + ', ' + want.clientY + ')');

    // rotta normale (heading nullo): nessuna compensazione, delta grezzo.
    PANE.x = 0; PANE.y = 0;
    state.gps.heading = null; state.compass = null;
    applyMapRotation();
    assert.equal(state.mapRotDeg, 0);
    dg._onDown({ clientX: 250, clientY: 150, button: 0, target: realTarget });
    dg._onMove({ clientX: 290, clientY: 150, target: realTarget });
    // A 0° l'oggetto locale e lo schermo coincidono: delta grezzo, come Leaflet.
    assert.ok(Math.abs(PANE.x - 40) < 1e-9, 'a 0° il drag deve restare quello di Leaflet: ' + PANE.x);
    assert.ok(Math.abs(PANE.y) < 1e-9, 'a 0° il drag deve restare quello di Leaflet: ' + PANE.y);

    // Doppio hook: la seconda applyMapRotation non deve riavvolgere i wrapper.
    const down2 = dg._onDown, move2 = dg._onMove;
    state.gps.heading = 90; applyMapRotation(); applyMapRotation();
    assert.equal(dg._onDown, down2, 'wrapper di _onDown sovrapposto');
    assert.equal(dg._onMove, move2, 'wrapper di _onMove sovrapposto');
  } finally {
    mapEl.getBoundingClientRect = saved.rect;
    mapEl.offsetWidth = saved.ow; mapEl.offsetHeight = saved.oh;
    mapEl.clientWidth = saved.cw; mapEl.clientHeight = saved.ch;
    if (hadTransform) mapEl.style.transform = hadTransform; else delete mapEl.style.transform;
    state.map = prevMap; state.mapType = prevType;
    state.trackUp = prevTrackUp; state.gps.heading = prevHeading; state.speedMs = prevSpeed;
    if (hadL) s.L = prevL; else delete s.L;
    resetState();
  }
});

test('rotClientPoint: ruota un evento attorno all\'origine, inversa di rotate(+deg)', () => {
  // Il punto ruotato è quello che il pane riceve come "posizione del dito": deve
  // distare dall'origine esattamente come l'originale (rotazione pura, non scala).
  for (const deg of [0, 15, 45, 90, -90, 137, 180, 270]) {
    for (const [x, y] of [[40, 0], [0, -60], [-30, 45], [0, 0]]) {
      const o = { x: 250, y: 150 };
      const p = rotClientPoint(o.x, o.y, { clientX: o.x + x, clientY: o.y + y }, deg);
      assert.ok(Math.abs(Math.hypot(p.clientX - o.x, p.clientY - o.y) - Math.hypot(x, y)) < 1e-9,
        'distanza non conservata a ' + deg + '°');
      // Rifare la rotazione col segno opposto torna al punto di partenza.
      const b = rotClientPoint(o.x, o.y, p, -deg);
      assert.ok(Math.abs(b.clientX - (o.x + x)) < 1e-9 && Math.abs(b.clientY - (o.y + y)) < 1e-9,
        'andata/ritorno non si annullano a ' + deg + '°');
    }
  }
});
