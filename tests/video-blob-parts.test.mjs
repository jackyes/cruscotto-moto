// Export offline: i muxer con StreamTarget tornano indietro a correggere
// dimensioni/durata. videoBlobParts deve rimettere ogni scrittura al suo posto:
// il file assemblato è identico byte per byte a quello di ArrayBufferTarget.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { api } from './harness.mjs';

const { videoBlobParts } = api;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadMuxer(file, name) {
  const sb = { TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(readFileSync(join(root, 'js', 'vendor', file), 'utf8'), sb);
  return sb[name];
}
const Mp4 = loadMuxer('mp4-muxer.js', 'Mp4Muxer');
const Webm = loadMuxer('webm-muxer.js', 'WebMMuxer');

async function bytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }

test('videoBlobParts: scritture in coda, sovrapposte e a cavallo di segmenti', async () => {
  const p = videoBlobParts();
  p.write(new Uint8Array([1, 2, 3, 4]), 0);
  p.write(new Uint8Array([5, 6, 7, 8]), 4);
  p.write(new Uint8Array([9, 9]), 3);        // a cavallo dei due segmenti
  p.write(new Uint8Array([0]), 0);           // in testa
  p.write(new Uint8Array([7]), 10);          // buco → zeri
  assert.deepEqual([...await bytes(p.blob('x'))], [0, 2, 3, 9, 9, 6, 7, 8, 0, 0, 7]);
});

// ~45 MB di chunk: oltre i 16 MB del chunk di StreamTarget, dove partono le
// riscritture all'indietro (sotto quella soglia restano nello stesso chunk).
function feed(muxer, isMp4, meta) {
  for (let k = 0; k < 1500; k++) {
    const data = new Uint8Array(30000).fill(k & 255);
    const args = [data, k % 150 === 0 ? 'key' : 'delta', k * 33333];
    if (isMp4) args.push(33333);
    if (k === 0) args.push(meta);
    muxer.addVideoChunkRaw(...args);
  }
  muxer.finalize();
}

async function sameAsArrayBuffer(M, opts, isMp4, meta) {
  const ref = new M.ArrayBufferTarget();
  feed(new M.Muxer({ ...opts, target: ref }), isMp4, meta);
  const p = videoBlobParts();
  let back = 0, end = 0;
  feed(new M.Muxer({ ...opts, target: new M.StreamTarget({ chunked: true, onData: (d, pos) => {
    if (pos < end) back++;
    end = Math.max(end, pos + d.byteLength);
    p.write(d, pos);
  } }) }), isMp4, meta);
  assert.ok(back > 0, 'il caso deve contenere riscritture all\'indietro');
  assert.deepEqual(await bytes(p.blob('x')), new Uint8Array(ref.buffer));
}

test('videoBlobParts + mp4-muxer StreamTarget = ArrayBufferTarget', async () => {
  await sameAsArrayBuffer(Mp4, { video: { codec: 'avc', width: 1280, height: 720 }, fastStart: false }, true,
    { decoderConfig: { codec: 'avc1.640028', description: new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe0, 0]) } });
});

test('videoBlobParts + webm-muxer StreamTarget = ArrayBufferTarget', async () => {
  await sameAsArrayBuffer(Webm, { video: { codec: 'V_VP8', width: 1280, height: 720, frameRate: 30 } }, false,
    { decoderConfig: { codec: 'vp8' } });
});

test('mp4-muxer: fastStart obbligatoria, l\'export MP4 la passa', () => {
  const opts = { target: new Mp4.StreamTarget({ onData: (d, pos) => {} }), video: { codec: 'avc', width: 1280, height: 720 } };
  assert.throws(() => new Mp4.Muxer(opts), /fastStart/);
  assert.match(readFileSync(join(root, 'js', 'video-mp4.js'), 'utf8'), /fastStart: false/);
});
