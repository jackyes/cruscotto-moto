// Loader condiviso maplibre+three: il ramo MP4 3D non li carica da sé, quindi
// ensureVideo3DLibs deve funzionare anche fuori da startVideoRender3D.
import { test } from 'node:test';
import assert from 'node:assert';
import { api, vmSandbox } from './harness.mjs';

const { ensureVideo3DLibs } = api;

function withLoaderStub(fn, body) {
  const prevLoad = vmSandbox.loadVideo3DScript;
  const prevHead = vmSandbox.document.head;
  const prevMl = vmSandbox.window.maplibregl, prevTh = vmSandbox.window.THREE;
  vmSandbox.loadVideo3DScript = fn;
  vmSandbox.document.head = { appendChild: () => {} };
  return Promise.resolve()
    .then(body)
    .finally(() => {
      vmSandbox.loadVideo3DScript = prevLoad;
      if (prevHead === undefined) delete vmSandbox.document.head;
      else vmSandbox.document.head = prevHead;
      vmSandbox.window.maplibregl = prevMl;
      vmSandbox.window.THREE = prevTh;
    });
}

test('ensureVideo3DLibs: globali già presenti -> risolve senza scaricare', () => {
  let loads = 0;
  return withLoaderStub(() => { loads++; }, async () => {
    vmSandbox.window.maplibregl = {};
    vmSandbox.window.THREE = {};
    await ensureVideo3DLibs();
    assert.equal(loads, 0);
  });
});

test('ensureVideo3DLibs: carica solo le lib mancanti e risolve', () => {
  const urls = [];
  return withLoaderStub((url, onload) => {
    urls.push(url);
    vmSandbox.window.THREE = {};
    onload();
  }, async () => {
    vmSandbox.window.maplibregl = {};
    delete vmSandbox.window.THREE;
    let status = 0;
    await ensureVideo3DLibs(() => { status++; });
    assert.equal(urls.length, 1, 'solo three, maplibre già c\'è');
    assert.match(urls[0], /three/);
    assert.ok(status > 0, 'status riportato al chiamante');
  });
});

test('ensureVideo3DLibs: script caricato ma globale assente -> reject', () => {
  return withLoaderStub((url, onload) => { onload(); }, async () => {
    delete vmSandbox.window.maplibregl;
    delete vmSandbox.window.THREE;
    await assert.rejects(() => ensureVideo3DLibs(), /Mappa 3D non disponibile/);
  });
});
