import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { disposeVideoMoto3D } = api;

function mockDisposable() {
  let n = 0;
  return { dispose: () => { n++; }, count: () => n };
}

test('disposeVideoMoto3D: dispone geometrie+materiali, renderer, DOM', () => {
  const g = mockDisposable(), m = mockDisposable();
  let rendererDisposed = false, ctxLost = false, removed = false;
  const moto = {
    _disposables: [g, m],
    renderer: {
      dispose: () => { rendererDisposed = true; },
      forceContextLoss: () => { ctxLost = true; },
      domElement: { parentNode: { removeChild: () => { removed = true; } } },
    },
  };
  disposeVideoMoto3D(moto);
  assert.equal(g.count(), 1);
  assert.equal(m.count(), 1);
  assert.ok(rendererDisposed);
  assert.ok(ctxLost);
  assert.ok(removed);
});

test('disposeVideoMoto3D: idempotente, null-safe', () => {
  assert.doesNotThrow(() => disposeVideoMoto3D(null));
  assert.doesNotThrow(() => disposeVideoMoto3D(undefined));
  let n = 0;
  const moto = { _disposables: [{ dispose: () => { n++; } }] };
  disposeVideoMoto3D(moto);
  disposeVideoMoto3D(moto);
  assert.equal(n, 1);
});

test('disposeVideoMoto3D: senza renderer non lancia', () => {
  assert.doesNotThrow(() => disposeVideoMoto3D({ _disposables: [] }));
});
