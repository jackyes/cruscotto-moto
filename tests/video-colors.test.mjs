// Bug #888: i nomi colore video devono risolvere in var CSS reali, mai '#888'.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { api, vmSandbox } from './harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function rootBlock(theme) {
  const start = theme === 'light' ? html.indexOf(':root[data-theme="light"]') : html.indexOf(':root {');
  const end = html.indexOf('}', start);
  return html.slice(start, end);
}

test('videoColorKey: text->c-txt, passthrough c-*, prefisso c-', () => {
  assert.equal(api.videoColorKey('text'), 'c-txt');
  assert.equal(api.videoColorKey('c-text'), 'c-txt');
  assert.equal(api.videoColorKey('accent'), 'c-accent');
  assert.equal(api.videoColorKey('good'), 'c-good');
  assert.equal(api.videoColorKey('bad'), 'c-bad');
  assert.equal(api.videoColorKey('warn'), 'c-warn');
  assert.equal(api.videoColorKey('acc-lat'), 'c-acc-lat');
  assert.equal(api.videoColorKey('acc-lon'), 'c-acc-lon');
  assert.equal(api.videoColorKey('acc-vert'), 'c-acc-vert');
  // passthrough: non reintrodurre il bug su sfondo/griglia/arco piega
  assert.equal(api.videoColorKey('c-bg'), 'c-bg');
  assert.equal(api.videoColorKey('c-grid'), 'c-grid');
  assert.equal(api.videoColorKey('c-axis'), 'c-axis');
  assert.equal(api.videoColorKey('c-route'), 'c-route');
  // idempotenza
  for (const n of ['text', 'accent', 'c-bg', 'acc-lat']) {
    assert.equal(api.videoColorKey(api.videoColorKey(n)), api.videoColorKey(n));
  }
  // sconosciuti: deterministico, mai crash
  assert.equal(api.videoColorKey('pippo'), 'c-pippo');
  assert.equal(api.videoColorKey(''), 'c-');
});

test('ogni var --c-* usata dal video è definita in entrambi i :root', () => {
  const names = ['c-bg', 'c-grid', 'c-axis', 'c-accent', 'c-good', 'c-bad',
    'c-warn', 'c-txt', 'c-route', 'c-acc-lat', 'c-acc-lon', 'c-acc-vert'];
  for (const theme of ['dark', 'light']) {
    const block = rootBlock(theme);
    for (const n of names) {
      assert.ok(new RegExp('--' + n + '\\s*:').test(block), `${n} manca in :root ${theme}`);
    }
  }
});

test('videoColor: nessun colore HUD risolve a #888', () => {
  vmSandbox.getComputedStyle = () => ({ getPropertyValue: n => '<' + n + '>' });
  api.canvasTheme.reset();
  const usati = ['accent', 'good', 'bad', 'warn', 'text', 'acc-lat', 'acc-lon', 'acc-vert',
    'c-bg', 'c-grid', 'c-axis', 'c-route'];
  for (const n of usati) {
    assert.notEqual(api.videoColor(n), '#888', 'colore non risolto: ' + n);
  }
  api.canvasTheme.reset();
});

test('HUD3D_COLORS: palette dark fissa, leggibile su pannello nero', () => {
  const c = api.HUD3D_COLORS;
  for (const k of ['accent', 'txt', 'axis', 'good', 'bad']) {
    assert.match(c[k], /^#[0-9a-fA-F]{6}$/, k);
    assert.notEqual(c[k].toLowerCase(), '#888888', k);
  }
});
