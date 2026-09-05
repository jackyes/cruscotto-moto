import { test } from 'node:test';
import assert from 'node:assert';
import { api, vmSandbox } from './harness.mjs';

const { initVideoMoto3D, videoRiderLean, disposeVideoMoto3D } = api;

// Mock THREE minimo: Group/Mesh con albero visitabile, geometrie/materiali disposable.
function mockTHREE() {
  class Obj {
    constructor() { this.children = []; this.position = { set() {} }; this.rotation = { x: 0, y: 0, z: 0 }; this.scale = { set() {} }; this.userData = {}; }
    add(c) { this.children.push(c); return this; }
    traverse(fn) { fn(this); for (const c of this.children) (c.traverse ? c.traverse(fn) : fn(c)); }
  }
  class Mesh extends Obj {
    constructor(geom, mat) { super(); this.geometry = geom; this.material = mat; }
  }
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
  function Camera() {
    this.position = { set() {} };
  }
  Camera.prototype.lookAt = function () {};
  function DirLight() {
    this.position = { set() {} };
    this.shadow = { mapSize: { set() {} } };
  }
  return {
    WebGLRenderer: Renderer,
    Scene: Obj, Group: Obj, Mesh,
    PerspectiveCamera: Camera,
    AmbientLight: light, HemisphereLight: light,
    DirectionalLight: DirLight,
    MeshStandardMaterial: mat,
    ShadowMaterial: mat,
    BoxGeometry: geom, CylinderGeometry: geom, SphereGeometry: geom,
    TorusGeometry: geom, PlaneGeometry: geom,
    CapsuleGeometry: geom,
  };
}

test('videoRiderLean: 30% contro-piega, clamp ±60°', () => {
  assert.ok(Math.abs(videoRiderLean(30) - (30 * Math.PI / 180) * 0.3) < 1e-9);
  assert.ok(Math.abs(videoRiderLean(-30) - (-30 * Math.PI / 180) * 0.3) < 1e-9);
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
  const parts = [];
  moto.scene.traverse(o => { if (o.userData && o.userData.videoPart) parts.push(o.userData.videoPart); });
  assert.ok(parts.includes('rider'));
  assert.ok(parts.includes('stand'));
  assert.equal(parts.filter(p => p === 'brake-disc').length, 2, 'un disco per ruota');
  disposeVideoMoto3D(moto);
});

test('initVideoMoto3D: shadows on abilita shadowMap + castShadow', () => {
  const THREE = mockTHREE();
  const moto = initVideoMoto3D(THREE, 1280, 720, { shadows: true });
  assert.equal(moto.renderer.shadowMap.enabled, true);
  // light + mesh marcano castShadow solo con flag on
  const meshOff = initVideoMoto3D(mockTHREE(), 1280, 720);
  let castOff = 0, castOn = 0;
  meshOff.scene.traverse(o => { if (o.castShadow) castOff++; });
  moto.scene.traverse(o => { if (o.castShadow) castOn++; });
  assert.equal(castOff, 0);
  assert.ok(castOn > 10, 'mesh con castShadow, attesi >10, trovati ' + castOn);
  disposeVideoMoto3D(moto);
  disposeVideoMoto3D(meshOff);
  assert.ok(vmSandbox, 'sandbox ok');
});
