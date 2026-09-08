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
  for (const e of ['./', './index.html', './viewer.html', './manifest.webmanifest']) {
    assert.ok(entries.includes(e), e + ' mancante nella SHELL');
  }
});
