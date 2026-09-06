// Il muxer MP4 vendored è un classic script che espone globalThis.Mp4Muxer
// (niente import dinamico → niente MIME/module trap, niente CSP unsafe-eval).
// Il test esegue il file in vm e verifica l'API esposta.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'js', 'vendor', 'mp4-muxer.js'), 'utf8');

function loadMuxer() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'mp4-muxer.js' });
  return sandbox.Mp4Muxer;
}

test('muxer vendored: globalThis.Mp4Muxer con Muxer/ArrayBufferTarget/StreamTarget', () => {
  const m = loadMuxer();
  assert.ok(m, 'Mp4Muxer globale mancante');
  assert.equal(typeof m.Muxer, 'function');
  assert.equal(typeof m.ArrayBufferTarget, 'function');
  assert.equal(typeof m.StreamTarget, 'function');
});

test('muxer vendored: niente export ESM (classic script)', () => {
  assert.ok(!/\bexport\s*\{/.test(src), 'deve essere classic script, non ESM');
});
