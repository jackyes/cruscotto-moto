import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

const norm = p => p.replace(/^\.\//, '');

function htmlJsSrcs(h) {
  return [...h.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]).filter(p => p.endsWith('.js'));
}
function swShellJs(s) {
  const m = s.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!m) throw new Error('SHELL non trovato in sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).filter(p => p.endsWith('.js'));
}

test('sw.js SHELL e index.html <script src> precacheano lo stesso insieme di js', () => {
  const htmlJs = new Set(htmlJsSrcs(html).map(norm));
  const swJs = new Set(swShellJs(sw).map(norm));
  // Leaflet è vendored e caricato dinamicamente (createElement in map.js),
  // non è un <script src>: va tolto dal confronto, che altrimenti fallisce.
  for (const s of htmlJs) if (s.startsWith('js/vendor/leaflet/')) htmlJs.delete(s);
  for (const s of swJs) if (s.startsWith('js/vendor/leaflet/')) swJs.delete(s);
  // Ordine diverso ammesso (l'ordine conta solo per l'esecuzione in HTML, non
  // per il precache): l'insieme deve coincidere, altrimenti un modulo aggiunto
  // in un solo posto non viene precacheato e al primo avvio offline la fetch
  // fallisce senza fallback.
  assert.deepEqual([...swJs].sort(), [...htmlJs].sort(),
    'un nuovo modulo in solo uno dei due punti rompe il precache offline');
});

test('sw.js SHELL include i file non-js di avvio offline', () => {
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  const entries = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  for (const e of [
    './', './index.html', './viewer.html', './manifest.webmanifest', './css/app.css',
    './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ]) {
    assert.ok(entries.includes(e), e + ' mancante nella SHELL');
  }
});

test('settingsPanel visibile (niente attributo hidden)', () => {
  assert.match(html, /<details id="settingsPanel">/);
  assert.doesNotMatch(html, /<details id="settingsPanel" hidden/);
});

test('sw.js: le fetch di rete rivalidano sempre (niente HTTP cache stantia)', () => {
  // Senza no-cache la HTTP cache del browser serviva js/*.js vecchi accanto a un
  // index.html nuovo: "updateMapHud is not defined" aprendo la mappa.
  const m = sw.match(/async function fetchWithTimeoutSW[\s\S]*?\n}/);
  assert.ok(m, 'fetchWithTimeoutSW non trovata');
  assert.match(m[0], /cache:\s*'no-cache'/);
});

test('index.html: niente script né stili inline, CSP script-src senza unsafe-inline', () => {
  // CSS e avvio vivono in css/app.css e js/init.js: uno <script> inline tornato
  // qui verrebbe bloccato dalla CSP, e un <style> inline sfuggirebbe al precache.
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'script inline in index.html');
  assert.doesNotMatch(html, /<style[\s>]/, 'style inline in index.html');
  assert.doesNotMatch(html, /\son[a-z]+="/, 'handler inline (onclick=…) in index.html');
  const csp = html.match(/script-src ([^;]+);/);
  assert.ok(csp, 'script-src assente dalla CSP');
  assert.doesNotMatch(csp[1], /unsafe-inline/);
  assert.match(html, /<link rel="stylesheet" href="css\/app\.css">/);
  // init.js è l'ultimo: avvia l'app quando tutti i moduli sono definiti.
  const srcs = htmlJsSrcs(html);
  assert.equal(srcs[srcs.length - 1], 'js/init.js');
});
