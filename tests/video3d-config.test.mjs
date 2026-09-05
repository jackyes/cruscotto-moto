import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { api, vmSandbox } from './harness.mjs';

const { VIDEO3D_CONF, loadVideo3DScript } = api;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

test('VIDEO3D_CONF: URL https pinnati con SRI sha384', () => {
  assert.ok(Array.isArray(VIDEO3D_CONF.libs));
  assert.equal(VIDEO3D_CONF.libs.length, 2);
  for (const lib of VIDEO3D_CONF.libs) {
    assert.match(lib.url, /^https:\/\/unpkg\.com\//);
    assert.match(lib.integrity, /^sha384-[A-Za-z0-9+/]{64}$/);
    assert.ok(lib.global === 'maplibregl' || lib.global === 'THREE');
  }
  assert.match(VIDEO3D_CONF.css, /^https:\/\/unpkg\.com\//);
  assert.match(VIDEO3D_CONF.styleUrl, /^https:\/\//);
  assert.ok(VIDEO3D_CONF.demTiles.every(t => t.startsWith('https://')));
  assert.ok(VIDEO3D_CONF.timeouts.cdnMs > 0 && VIDEO3D_CONF.timeouts.styleMs > 0);
  assert.ok(VIDEO3D_CONF.camera.zoom > 0 && VIDEO3D_CONF.camera.pitch > 0);
});

test('loadVideo3DScript: imposta integrity + crossorigin', () => {
  let appended = null;
  const fakeHead = { appendChild: el => { appended = el; } };
  vmSandbox.document.head = fakeHead;
  vmSandbox.document.createElement = () => ({});
  try {
    loadVideo3DScript('https://unpkg.com/x.js', () => {}, () => {}, 'sha384-abc');
    assert.equal(appended.src, 'https://unpkg.com/x.js');
    assert.equal(appended.integrity, 'sha384-abc');
    assert.equal(appended.crossOrigin, 'anonymous');
  } finally {
    delete vmSandbox.document.head;
  }
});

test('CSP img-src: copre tile openfreemap + dem s3', () => {
  const m = html.match(/img-src ([^;]+);/);
  assert.ok(m, 'img-src presente');
  assert.ok(m[1].includes('https://tiles.openfreemap.org'), 'openfreemap in img-src');
  assert.ok(m[1].includes('https://s3.amazonaws.com'), 's3 in img-src');
});
