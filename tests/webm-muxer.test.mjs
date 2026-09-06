// Il muxer WebM vendored è un classic script che espone globalThis.WebMMuxer
// (stesso schema di mp4-muxer.js: niente import dinamico, niente CSP
// unsafe-eval). Il test esegue il file in vm e verifica l'API esposta.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'js', 'vendor', 'webm-muxer.js'), 'utf8');

function loadMuxer() {
  // TextEncoder: usato a livello di modulo da SubtitleEncoder, non è un
  // globale ECMAScript (vm non lo mette in sandbox in automatico).
  const sandbox = { TextEncoder, TextDecoder };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'webm-muxer.js' });
  return sandbox.WebMMuxer;
}

test('muxer WebM vendored: globalThis.WebMMuxer con Muxer/ArrayBufferTarget/StreamTarget', () => {
  const m = loadMuxer();
  assert.ok(m, 'WebMMuxer globale mancante');
  assert.equal(typeof m.Muxer, 'function');
  assert.equal(typeof m.ArrayBufferTarget, 'function');
  assert.equal(typeof m.StreamTarget, 'function');
});

test('muxer WebM vendored: niente export ESM (classic script)', () => {
  assert.ok(!/\bexport\s*\{/.test(src), 'deve essere classic script, non ESM');
});
