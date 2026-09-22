// Registro errori (js/issues.js) e pannello "Errori app".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { api, vmSandbox } from './harness.mjs';

const s = vmSandbox;
const { els } = api;
const src = readFileSync(new URL('../js/issues.js', import.meta.url), 'utf8');

/* issues.js da solo, in una sandbox con window che registra i listener e un
   localStorage vero-finto: per i test del salvataggio e dei gestori globali. */
function standalone() {
  const store = new Map();
  const listeners = {};
  const warns = [];
  const ctx = {
    console: { warn: (...a) => warns.push(a) },
    setTimeout, clearTimeout, Date, JSON, String, Number, Array, Math, isFinite,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    window: { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } },
  };
  vm.createContext(ctx);
  vm.runInContext(src + ';globalThis.api = { logIssue, logWarn, readIssues, clearIssues, issuesFlush, unseenIssues, markIssuesSeen, formatIssues, issueWhereFromStack, APP_VERSION };', ctx);
  return { api: ctx.api, store, listeners, warns };
}

test('logIssue: voci identiche consecutive sommate, tetto 50, messaggi accorciati', () => {
  const { api: I } = standalone();
  for (let i = 0; i < 20; i++) I.logIssue('error', 'x is undefined', 'display.js:42');
  let list = I.readIssues();
  assert.equal(list.length, 1);
  assert.equal(list[0].n, 20);
  assert.ok(list[0].tLast >= list[0].t);
  I.logIssue('warn', 'y'.repeat(1000), null);
  assert.equal(I.readIssues()[1].msg.length, 300);
  for (let i = 0; i < 80; i++) I.logIssue('warn', 'm' + i, null);
  list = I.readIssues();
  assert.equal(list.length, 50, 'tetto');
  assert.equal(list[49].msg, 'm79', 'restano le più recenti');
  assert.equal(list[0].v, I.APP_VERSION);
});

test('salvataggio: sopravvive al ricaricamento; dati sporchi in storage ignorati', () => {
  const a = standalone();
  a.api.logIssue('warn', 'salvami', 'map.js:10');
  a.api.issuesFlush();
  const saved = a.store.get('cruscotto.issues');
  assert.match(saved, /salvami/);
  // "Ricarica": nuova sandbox con lo stesso contenuto di storage.
  const b = standalone();
  b.store.set('cruscotto.issues', saved);
  assert.equal(b.api.readIssues()[0].where, 'map.js:10');
  const c = standalone();
  c.store.set('cruscotto.issues', '{rotto');
  assert.equal(c.api.readIssues().length, 0);
  const d = standalone();
  d.store.set('cruscotto.issues', '[null, 3, {"msg": "ok", "kind": "warn"}]');
  assert.equal(d.api.readIssues().length, 1);
});

test('gestori globali: errore e promise rifiutata registrati con file:riga', () => {
  const { api: I, listeners } = standalone();
  listeners.error[0]({ message: 'boom', filename: 'https://x.github.io/cruscotto-moto/js/display.js', lineno: 271 });
  const err = new Error('rifiutata');
  err.stack = 'Error: rifiutata\n    at navRequestRoute (https://x/js/nav-net.js:206:15)';
  listeners.unhandledrejection[0]({ reason: err });
  listeners.unhandledrejection[0]({ reason: 'solo testo' });
  const list = I.readIssues();
  // Array.from + join: l'array arriva da un altro realm del vm.
  assert.deepEqual(Array.from(list, x => x.kind + ' ' + x.where + ' ' + x.msg), [
    'error display.js:271 boom',
    'reject nav-net.js:206 rifiutata',
    'reject null solo testo',
  ]);
  assert.ok(listeners.pagehide, 'flush alla chiusura della pagina');
});

test('logWarn: in console come prima e nel registro, con file:riga da un Error', () => {
  const { api: I, warns } = standalone();
  const e = new Error('quota');
  e.stack = 'Error: quota\n    at cachePut (https://x/js/net-base.js:90:3)';
  I.logWarn('cachePut: scrittura fallita per k', e);
  assert.equal(warns.length, 1, 'console.warn non più chiamato');
  const x = I.readIssues()[0];
  assert.equal(x.kind, 'warn');
  assert.equal(x.where, 'net-base.js:90');
  assert.equal(x.msg, 'cachePut: scrittura fallita per k quota');
});

test('non letti: contano le voci dopo l\'ultima apertura, anche quelle sommate', async () => {
  const { api: I } = standalone();
  I.logIssue('warn', 'a', null);
  assert.equal(I.unseenIssues(), 1);
  I.markIssuesSeen();
  assert.equal(I.unseenIssues(), 0);
  await new Promise(r => setTimeout(r, 5));
  I.logIssue('warn', 'a', null);          // stessa voce che si ripete: torna "nuova"
  assert.equal(I.unseenIssues(), 1);
  I.clearIssues();
  assert.equal(I.readIssues().length, 0);
  assert.equal(I.unseenIssues(), 0);
});

test('formatIssues: testo da incollare con versione, ripetizioni e voci di versioni vecchie', () => {
  const { api: I } = standalone();
  const t = new Date(2026, 8, 22, 21, 30, 5).getTime();
  const txt = I.formatIssues([
    { t, kind: 'error', msg: 'boom', where: 'display.js:271', v: I.APP_VERSION, n: 3, tLast: t + 60000 },
    { t, kind: 'warn', msg: 'vecchio', where: null, v: 'v1', n: 1 },
  ], 'UA test');
  const lines = txt.split('\n');
  assert.equal(lines[0], 'Cruscotto Moto ' + I.APP_VERSION + ' · UA test');
  assert.equal(lines[1], '2026-09-22 21:30:05 [error] ×3 (ultima 2026-09-22 21:31:05) display.js:271 — boom');
  assert.equal(lines[2], '2026-09-22 21:30:05 [warn] (v1) — vecchio');
  assert.match(I.formatIssues([], ''), /Nessun errore registrato/);
});

test('APP_VERSION uguale a CACHE_VERSION di sw.js', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const cache = sw.match(/const CACHE_VERSION = '([^']+)'/)[1];
  assert.equal(vm.runInContext('APP_VERSION', s), cache, 'alza entrambe insieme');
});

test('pannello: pallino sulla scheda Storico, contatore, copia negli appunti', async () => {
  const cls = new Set();
  els.tabHistory = { classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); } } };
  s.clearIssues();
  s.renderIssueBadge();
  assert.equal(els.issueCount.hidden, true);
  assert.ok(!cls.has('has-issues'));
  await new Promise(r => setTimeout(r, 5));   // voce successiva all'ultima lettura
  s.logIssue('warn', 'dal test', null);
  assert.equal(els.issueCount.hidden, false, 'logIssue aggiorna il contatore');
  assert.equal(els.issueCount.textContent, '1');
  assert.ok(cls.has('has-issues'));
  s.renderIssues();
  assert.match(els.issueList.textContent, /dal test/);
  let copied = null;
  s.navigator = { clipboard: { writeText: async t => { copied = t; } }, userAgent: 'UA' };
  const origToast = s.toast;
  s.toast = () => ({ remove() {} });
  try { await s.copyIssues(); } finally { s.toast = origToast; s.navigator = {}; }
  assert.match(copied, /^Cruscotto Moto v\d+ · UA\n.*dal test/);
  s.clearIssues();
  s.renderIssueBadge();
  assert.ok(!cls.has('has-issues'));
});

test('markup: script per primo, pannello e pulsanti presenti; niente console.warn rimasti', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(srcs[0], 'js/issues.js', 'deve caricarsi prima di tutto il resto');
  for (const id of ['issuePanel', 'issueCount', 'issueList', 'appVersion', 'btnIssueCopy', 'btnIssueClear']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  for (const f of srcs.filter(x => x.startsWith('js/') && !x.includes('vendor') && x !== 'js/issues.js' && x !== 'js/parse.js')) {
    const code = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/console\.warn\(/.test(code), f + ': usa logWarn, non console.warn');
  }
});
