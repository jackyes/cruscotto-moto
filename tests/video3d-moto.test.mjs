import { test } from 'node:test';
import assert from 'node:assert';
import { api, vmSandbox } from './harness.mjs';

const { initVideoMoto3D, videoRiderLean, disposeVideoMoto3D, moto3dLoft, moto3dStations } = api;

// Mock THREE minimo: albero di Group/Mesh visitabile, vettori veri (il modello
// orienta aste e ginocchia con length/normalize/quaternion), geometrie che
// tengono attributi e indici (per controllare il loft), tutto disposable.
function mockTHREE() {
  class Vec {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { const l = this.length() || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  }
  class Quat {
    constructor() { this.angle = 0; }
    setFromUnitVectors() { return this; }
    setFromAxisAngle(axis, angle) { this.axis = axis; this.angle = angle; return this; }
  }
  class Obj {
    constructor() {
      this.children = []; this.position = new Vec(); this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = new Vec(1, 1, 1); this.quaternion = new Quat(); this.userData = {};
    }
    add(c) { this.children.push(c); return this; }
    traverse(fn) { fn(this); for (const c of this.children) (c.traverse ? c.traverse(fn) : fn(c)); }
  }
  class Mesh extends Obj {
    constructor(geom, mat) { super(); this.geometry = geom; this.material = mat; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; }
    setAttribute(k, v) { this.attributes[k] = v; }
    setIndex(i) { this.index = i; }
    computeVertexNormals() {}
    dispose() {}
  }
  function Float32BufferAttribute(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  function Color(hex) { this.r = ((hex >> 16) & 255) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; }
  function geom() { return { dispose() {} }; }
  function mat() { return { dispose() {} }; }
  function light() { return new Obj(); }
  function Renderer() {
    this.shadowMap = {};
    this.domElement = { style: {}, parentNode: null };
  }
  Renderer.prototype.setSize = function () {};
  Renderer.prototype.setPixelRatio = function () {};
  Renderer.prototype.render = function () {};
  Renderer.prototype.dispose = function () {};
  function Camera() { this.position = new Vec(); }
  Camera.prototype.lookAt = function () {};
  function DirLight() {
    this.position = new Vec();
    this.shadow = { mapSize: { set() {} } };
  }
  return {
    WebGLRenderer: Renderer,
    Scene: Obj, Group: Obj, Mesh,
    PerspectiveCamera: Camera,
    HemisphereLight: light,
    DirectionalLight: DirLight,
    MeshStandardMaterial: mat,
    MeshPhysicalMaterial: mat,
    ShadowMaterial: mat,
    BoxGeometry: geom, CylinderGeometry: geom, SphereGeometry: geom,
    TorusGeometry: geom, PlaneGeometry: geom, LatheGeometry: geom, RingGeometry: geom,
    BufferGeometry, Float32BufferAttribute, Color,
    Vector2: Vec, Vector3: Vec,
    DoubleSide: 2,
  };
}

test('videoRiderLean: busto 18% più dentro la curva della moto, clamp ±60°', () => {
  // Stesso segno della piega della moto (bike ruota di +lean): il pilota si
  // sporge verso l'interno invece di restare più dritto.
  assert.ok(Math.abs(videoRiderLean(30) - (30 * Math.PI / 180) * 0.18) < 1e-9);
  assert.ok(videoRiderLean(30) > 0, 'piega a destra → busto ancora più a destra');
  assert.ok(videoRiderLean(-30) < 0);
  assert.equal(videoRiderLean(90), videoRiderLean(60));
  assert.equal(videoRiderLean(0), 0);
  assert.equal(videoRiderLean(NaN), 0);
});

test('initVideoMoto3D: ombre off di default, rider+dischi+cavalletto presenti', () => {
  const THREE = mockTHREE();
  const moto = initVideoMoto3D(THREE, 1280, 720);
  assert.equal(moto.renderer.shadowMap.enabled, false);
  assert.equal(moto.shadows, false);
  assert.ok(moto.rider, 'rider presente');
  assert.equal(moto.wheels.length, 2, 'due ruote che girano');
  const parts = [];
  moto.scene.traverse(o => { if (o.userData && o.userData.videoPart) parts.push(o.userData.videoPart); });
  assert.ok(parts.includes('rider'));
  assert.ok(parts.includes('stand'));
  assert.equal(parts.filter(p => p === 'brake-disc').length, 2, 'un gruppo dischi per ruota');
  assert.equal(parts.filter(p => p === 'rider-leg').length, 2, 'due gambe rider');
  assert.equal(parts.filter(p => p === 'rider-arm').length, 2, 'due braccia rider');
  assert.equal(parts.filter(p => p === 'backpack').length, 1, 'gobba della tuta');
  disposeVideoMoto3D(moto);
});

test('initVideoMoto3D: shadows on abilita shadowMap + castShadow', () => {
  const THREE = mockTHREE();
  const moto = initVideoMoto3D(THREE, 1280, 720, { shadows: true });
  assert.equal(moto.renderer.shadowMap.enabled, true);
  // light + mesh marcano castShadow solo con flag on
  const meshOff = initVideoMoto3D(mockTHREE(), 1280, 720);
  let castOff = 0, castOn = 0, receive = 0;
  meshOff.scene.traverse(o => { if (o.castShadow) castOff++; });
  moto.scene.traverse(o => { if (o.castShadow) castOn++; if (o.receiveShadow) receive++; });
  assert.equal(castOff, 0);
  assert.ok(castOn > 10, 'mesh con castShadow, attesi >10, trovati ' + castOn);
  assert.equal(receive, 1, 'piano che riceve l\'ombra');
  disposeVideoMoto3D(moto);
  disposeVideoMoto3D(meshOff);
  assert.ok(vmSandbox, 'sandbox ok');
});

test('initVideoMoto3D: pose porta bacino dentro la curva e il ginocchio interno fuori', () => {
  const moto = initVideoMoto3D(mockTHREE(), 1280, 720);
  const legs = [];
  moto.scene.traverse(o => { if (o.userData && o.userData.videoPart === 'rider-leg') legs.push(o); });
  const inner = s => legs.find(l => Math.sign(l.position.x) === s);
  moto.pose(0);
  assert.equal(moto.rider.position.x, 0);
  assert.equal(inner(1).quaternion.angle, 0);
  assert.equal(inner(-1).quaternion.angle, 0);
  // Piega a destra (+): lato destro del pilota = -x nel frame della moto.
  moto.pose(40);
  assert.ok(moto.rider.position.x < 0, 'bacino verso destra');
  assert.notEqual(inner(-1).quaternion.angle, 0, 'ginocchio destro fuori');
  assert.equal(inner(1).quaternion.angle, 0, 'gamba sinistra ferma');
  moto.pose(-40);
  assert.ok(moto.rider.position.x > 0, 'bacino verso sinistra');
  assert.notEqual(inner(1).quaternion.angle, 0, 'ginocchio sinistro fuori');
  assert.equal(inner(-1).quaternion.angle, 0);
  moto.pose(NaN);
  assert.equal(moto.rider.position.x, 0, 'piega non valida = dritta');
  disposeVideoMoto3D(moto);
});

test('moto3dStations: passa per le stazioni chiave e interpola liscio in mezzo', () => {
  const keys = [{ z: 1, y: 0, a: 0.1, b: 0.1 }, { z: 0, y: 0.2, a: 0.3, b: 0.2, b2: 0.1, n: 4 }, { z: -1, y: 0, a: 0.1, b: 0.1 }];
  const st = moto3dStations(keys, 5);
  assert.equal(st.length, 5);
  assert.deepEqual([st[0].z, st[2].z, st[4].z], [1, 0, -1]);
  assert.ok(Math.abs(st[2].a - 0.3) < 1e-9 && Math.abs(st[2].b2 - 0.1) < 1e-9 && Math.abs(st[2].n - 4) < 1e-9);
  assert.ok(st[1].a > 0.1 && st[1].a < 0.3, 'in mezzo: ' + st[1].a);
  assert.equal(st[0].b2, 0.1, 'b2 assente = b');
  assert.equal(st[0].x, 0);
});

// Normale di ogni triangolo del loft: deve puntare fuori (lati: via dall'asse
// della sezione; tappi: oltre l'estremo). Con le facce al contrario il
// materiale FrontSide mostrava la parete interna opposta.
function outwardCheck(geo, stations) {
  const p = geo.attributes.position.array, idx = geo.index;
  const zMin = Math.min(...stations.map(s => s.z)), zMax = Math.max(...stations.map(s => s.z));
  let bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map(i => [p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cz = (a[2] + b[2] + c[2]) / 3;
    let out;
    if (a[2] === b[2] && b[2] === c[2] && (cz === zMin || cz === zMax)) out = [0, 0, cz === zMax ? 1 : -1];
    else out = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, 0];   // sezioni centrate su x=0, y=0
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) bad++;
  }
  return bad;
}

test('moto3dLoft: facce verso l\'esterno, sia con sezioni avanti→dietro sia al contrario', () => {
  const THREE = mockTHREE();
  const fwd = [{ z: 0.5, y: 0, a: 0.2, b: 0.1 }, { z: 0, y: 0, a: 0.3, b: 0.2 }, { z: -0.5, y: 0, a: 0.1, b: 0.1 }];
  for (const st of [fwd, fwd.slice().reverse()]) {
    const g = moto3dLoft(THREE, st, 16);
    assert.equal(g.attributes.position.array.length / 3, 3 * 16 + 2, 'anelli + 2 centri dei tappi');
    assert.equal(g.index.length, (2 * 16 * 2 + 2 * 16) * 3);
    assert.equal(outwardCheck(g, st), 0, 'triangoli rivolti all\'interno');
  }
});

test('moto3dLoft: la livrea per vertice segue la posizione', () => {
  const THREE = mockTHREE();
  const st = [{ z: 0.2, y: 0, a: 0.1, b: 0.1 }, { z: -0.2, y: 0, a: 0.1, b: 0.1 }];
  const g = moto3dLoft(THREE, st, 8, x => (x > 0 ? 0xff0000 : 0x0000ff));
  const pos = g.attributes.position.array, col = g.attributes.color.array;
  assert.equal(col.length, pos.length);
  for (let i = 0; i < pos.length / 3; i++) {
    if (pos[3 * i] > 1e-9) assert.deepEqual([col[3 * i], col[3 * i + 2]], [1, 0], 'x>0 rosso');
    if (pos[3 * i] < -1e-9) assert.deepEqual([col[3 * i], col[3 * i + 2]], [0, 1], 'x<0 blu');
  }
  assert.equal(moto3dLoft(THREE, st, 8).attributes.color, undefined, 'senza colorFn niente attributo');
});
