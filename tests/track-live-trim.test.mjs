// Traccia live oltre TRACK_MAX (js/cam-map.js, appendTrackPoint): il trim toglie
// un 10% in più, così la polyline si ricostruisce una volta ogni ~1000 punti e non
// a ogni punto nuovo. I chunk su disco restano integrali, in ordine, senza doppioni.
// File a parte: il throttle a 1 Hz (lastTrackT, `let` di js/core.js) non si azzera
// con resetState, e l'orologio finto di qui lo lascerebbe sporco ai test successivi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetState, vmSandbox } from './harness.mjs';

const { state, idb, TRACK_MAX } = api;
const s = vmSandbox;

test('oltre TRACK_MAX: rebuild della polyline ogni ~10% di punti, chunk integrali', async () => {
  resetState();
  state.sessionId = 's_trim';
  const origPerf = s.performance, origPut = idb.putChunk;
  let t = 1e6;
  s.performance = { now: () => t };
  const written = [];
  idb.putChunk = async c => { written.push(...c.track); };
  try {
    const n = TRACK_MAX * 2;
    let rebuilds = 0;
    for (let i = 0; i < n; i++) {
      t += 1000;                                   // un punto al secondo, come il gate
      s.appendTrackPoint(45 + i * 1e-5, 9, 100);
      if (state._leafTrim) { rebuilds++; state._leafTrim = false; }   // come updateLeaflet
      if (i % 10 === 9) await s.flushLog();        // flush ogni 10 s
    }
    await s.flushLog();
    assert.equal(state.trackFull.length, n, 'trackFull deve restare integrale');
    assert.ok(state.track.length <= TRACK_MAX, 'traccia live oltre il tetto: ' + state.track.length);
    assert.ok(rebuilds > 0 && rebuilds <= 20, 'rebuild della polyline: ' + rebuilds + ' in ' + TRACK_MAX + ' punti oltre il tetto');
    assert.equal(written.length, n, 'punti nei chunk: ' + written.length);
    assert.ok(written.every((p, k) => p === state.trackFull[k]), 'chunk fuori ordine o con doppioni');
  } finally {
    s.performance = origPerf;
    idb.putChunk = origPut;
  }
});
