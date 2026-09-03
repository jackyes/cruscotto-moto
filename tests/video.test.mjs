import { test } from 'node:test';
import assert from 'node:assert';
import { api } from './harness.mjs';

const { findRowAt } = api;

const rows = [{ t: 0 }, { t: 1 }, { t: 2 }, { t: 3 }, { t: 4 }];

test('findRowAt: estremi', () => {
  assert.equal(findRowAt(rows, -5), 0);
  assert.equal(findRowAt(rows, 99), 4);
});

test('findRowAt: corrispondenza esatta', () => {
  assert.equal(findRowAt(rows, 0), 0);
  assert.equal(findRowAt(rows, 2), 2);
  assert.equal(findRowAt(rows, 4), 4);
});

test('findRowAt: riga più vicina (tie-break verso sinistra)', () => {
  assert.equal(findRowAt(rows, 0.4), 0);   // 0.4 più vicino a 0
  assert.equal(findRowAt(rows, 0.6), 1);   // 0.6 più vicino a 1
  assert.equal(findRowAt(rows, 2.5), 2);   // equidistante -> sinistra
  assert.equal(findRowAt(rows, 3.6), 4);   // 3.6 più vicino a 4
});

test('findRowAt: input vuoto/nullo', () => {
  assert.equal(findRowAt([], 0), -1);
  assert.equal(findRowAt(null, 0), -1);
});

test('findRowAt: riga singola', () => {
  assert.equal(findRowAt([{ t: 5 }], 0), 0);
  assert.equal(findRowAt([{ t: 5 }], 5), 0);
  assert.equal(findRowAt([{ t: 5 }], 9), 0);
});
