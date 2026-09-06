// Il muxer MP4 vendored deve caricare come ESM ed esportare l'API attesa:
// se il rename .mjs→.js o un update rompe l'export, startVideoRenderMp4
// finisce nel ramo 'Muxer MP4 non valido'. Test diretto, niente harness.
import { test } from 'node:test';
import assert from 'node:assert';

test('muxer vendored: Muxer + ArrayBufferTarget + StreamTarget', async () => {
  const m = await import('../js/vendor/mp4-muxer.js');
  assert.equal(typeof m.Muxer, 'function');
  assert.equal(typeof m.ArrayBufferTarget, 'function');
  assert.equal(typeof m.StreamTarget, 'function');
});
