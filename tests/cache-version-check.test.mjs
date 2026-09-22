// Controllo CI su CACHE_VERSION (.github/scripts/check-cache-version.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shellFiles, cacheVersion, checkCacheVersion } from '../.github/scripts/check-cache-version.mjs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const bump = src => src.replace(/const CACHE_VERSION = '([^']+)'/, "const CACHE_VERSION = '$1x'");

test('shellFiles: legge la SHELL vera di sw.js, "./" è index.html', () => {
  const f = shellFiles(sw);
  for (const p of ['index.html', 'js/init.js', 'css/app.css', 'viewer.html', 'icons/icon-maskable-512.png']) {
    assert.ok(f.has(p), p);
  }
  assert.ok(!f.has('./'));
  assert.throws(() => shellFiles('niente'));
  assert.match(cacheVersion(sw), /^v\d+$/);
});

test('checkCacheVersion: file della SHELL cambiato senza aumento → segnalato', () => {
  const r = checkCacheVersion({ changed: ['js/core.js', 'README.md'], swBefore: sw, swAfter: sw });
  assert.equal(r.ok, false);
  assert.deepEqual(r.touched, ['js/core.js']);
  assert.equal(checkCacheVersion({ changed: ['js/core.js'], swBefore: sw, swAfter: bump(sw) }).ok, true);
});

test('checkCacheVersion: file fuori SHELL, sw.js nuovo o assente prima → ok', () => {
  assert.equal(checkCacheVersion({ changed: ['README.md', 'tests/x.test.mjs'], swBefore: sw, swAfter: sw }).ok, true);
  assert.equal(checkCacheVersion({ changed: ['js/core.js'], swBefore: null, swAfter: sw }).ok, true);
  // Cambiare sw.js stesso senza aumentare la versione conta come file della SHELL.
  assert.equal(checkCacheVersion({ changed: ['sw.js'], swBefore: sw, swAfter: sw }).ok, false);
});
