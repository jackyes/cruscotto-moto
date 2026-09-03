import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { vdot, vcross, vnorm, vadd, vsub, vscale, vlen, upVector, axis, axisVec,
        leanFromUp, pitchFromUp, buildBasis, calibBasis } = api;

test('algebra vettoriale: dot/cross/norm/len', () => {
  assert.equal(vdot({x:1,y:2,z:3},{x:4,y:5,z:6}), 32);
  assert.deepEqual(vcross({x:1,y:0,z:0},{x:0,y:1,z:0}), {x:0,y:0,z:1});
  assert.deepEqual(vcross({x:0,y:1,z:0},{x:0,y:0,z:1}), {x:1,y:0,z:0});
  assert.deepEqual(vnorm({x:3,y:4,z:0}), {x:0.6,y:0.8,z:0});
  assert.equal(vlen({x:3,y:4,z:0}), 5);
  assert.deepEqual(vadd({x:1,y:2,z:3},{x:4,y:5,z:6}), {x:5,y:7,z:9});
  assert.deepEqual(vsub({x:4,y:5,z:6},{x:1,y:2,z:3}), {x:3,y:3,z:3});
  assert.deepEqual(vscale({x:1,y:2,z:3}, 2), {x:2,y:4,z:6});
});

test('upVector: normalizza e tollera il vettore nullo', () => {
  assert.deepEqual(upVector({x:0,y:0,z:9.80665}), {x:0,y:0,z:1});
  assert.deepEqual(upVector({x:0,y:0,z:0}), {x:0,y:0,z:0});
  assert.ok(Math.abs(vlen(upVector({x:1,y:2,z:3})) - 1) < 1e-12);
});

test('axis/axisVec: selezione e segno', () => {
  const v = {x:5,y:-2,z:3};
  assert.equal(axis(v, 'y'), -2);
  assert.equal(axis(v, '-x'), -5);
  assert.equal(axis(v, 'z'), 3);
  assert.equal(axis({x:0}, 'x'), 0);
  assert.deepEqual(axisVec('-z'), {x:0,y:0,z:-1});
  assert.deepEqual(axisVec('y'), {x:0,y:1,z:0});
  assert.deepEqual(axisVec('-x'), {x:-1,y:0,z:0});
});

test('buildBasis: base ortonormale e right = up x fwd', () => {
  const B = buildBasis({x:1,y:0,z:0}, 'landscape-left');
  assert.deepEqual(B.up, {x:1,y:0,z:0});
  assert.deepEqual(B.fwd, {x:0,y:0,z:-1});
  assert.deepEqual(B.right, {x:0,y:1,z:0});
  assert.ok(Math.abs(vdot(B.up, B.fwd)) < 1e-9);
  assert.ok(Math.abs(vdot(B.up, B.right)) < 1e-9);
  assert.ok(Math.abs(vdot(B.fwd, B.right)) < 1e-9);
  assert.deepEqual(vcross(B.up, B.fwd), B.right);
});

test('buildBasis: caso degenere non produce NaN', () => {
  const B = buildBasis({x:0,y:0,z:1}, 'landscape-left');
  assert.ok(isFinite(B.up.x + B.up.y + B.up.z));
  assert.ok(isFinite(B.fwd.x + B.fwd.y + B.fwd.z));
  assert.ok(isFinite(B.right.x + B.right.y + B.right.z));
  assert.ok(Math.abs(vlen(B.up) - 1) < 1e-9);
  assert.ok(Math.abs(vlen(B.fwd) - 1) < 1e-9);
  assert.ok(Math.abs(vlen(B.right) - 1) < 1e-9);
  assert.ok(Math.abs(vdot(B.up, B.fwd)) < 1e-9);
});

test('leanFromUp/pitchFromUp: segni e angoli noti', () => {
  const B = buildBasis({x:1,y:0,z:0});
  assert.equal(leanFromUp(B.up, B), 0);
  assert.equal(leanFromUp(B.right, B), 90);
  assert.equal(leanFromUp(vscale(B.right, -1), B), -90);
  const c = Math.cos(Math.PI/6), s = Math.sin(Math.PI/6);
  const U = vadd(vscale(B.up, c), vscale(B.right, s));
  assert.ok(Math.abs(leanFromUp(U, B) - 30) < 1e-9);
  const P = vadd(vscale(B.up, c), vscale(B.fwd, -s));
  assert.ok(Math.abs(pitchFromUp(P, B) - 30) < 1e-9);
});

test('calibBasis: retrocompatibilita col formato v1', () => {
  assert.equal(calibBasis(null), null);
  const B = buildBasis({x:1,y:0,z:0});
  assert.equal(calibBasis(B), B);
  const legacy = calibBasis({x:1,y:0,z:0});
  assert.deepEqual(legacy.up, B.up);
  assert.deepEqual(legacy.fwd, B.fwd);
  assert.deepEqual(legacy.right, B.right);
});
