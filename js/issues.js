'use strict';
/* js/issues.js: versione dell'app e registro degli errori. Primo script della
   pagina: deve esserci prima di qualunque altro codice che possa fallire.
   Nessuna dipendenza (localStorage diretto, niente store/els).

   In moto la console non si vede e un toast di 8 s non lo legge nessuno: gli
   errori restano qui (ultimi ISSUE_MAX, con file:riga, ora e versione) e si
   leggono o copiano da Storico → Errori app. */

// Uguale a CACHE_VERSION in sw.js (lo verifica tests/issues.test.mjs).
const APP_VERSION = 'v52';

const ISSUE_KEY = 'cruscotto.issues';
const ISSUE_SEEN_KEY = 'cruscotto.issuesSeen';
const ISSUE_MAX = 50;
const ISSUE_MSG_MAX = 300;
const ISSUE_FLUSH_MS = 1000;

let issueList = null;      // copia in memoria; su disco con un debounce
let issueFlushT = null;

function issuesLoad() {
  if (issueList) return issueList;
  let v = null;
  try { v = JSON.parse(localStorage.getItem(ISSUE_KEY)); } catch (e) {}
  issueList = Array.isArray(v) ? v.filter(x => x && typeof x.msg === 'string') : [];
  return issueList;
}

/* Scrittura rimandata: un errore dentro il loop a 15 Hz non deve trasformarsi
   in 15 scritture di localStorage al secondo. */
function issuesFlushSoon() {
  if (issueFlushT) return;
  issueFlushT = setTimeout(issuesFlush, ISSUE_FLUSH_MS);
}
function issuesFlush() {
  if (issueFlushT) { clearTimeout(issueFlushT); issueFlushT = null; }
  if (!issueList) return;
  try { localStorage.setItem(ISSUE_KEY, JSON.stringify(issueList)); } catch (e) {}
}

/* Pura: "file.js:riga" dalla prima riga utile di uno stack, o null. */
function issueWhereFromStack(stack) {
  const m = String(stack || '').match(/([\w.-]+\.(?:js|html)):(\d+)(?::\d+)?/);
  return m ? m[1] + ':' + m[2] : null;
}

/* kind: 'error' (non gestito), 'reject' (promise), 'warn' (gestito, l'app va
   avanti). Voci identiche consecutive si sommano in `n`: un errore che si
   ripete a ogni frame occupa una riga sola. */
function logIssue(kind, msg, where) {
  const list = issuesLoad();
  const text = String(msg == null ? '' : msg).slice(0, ISSUE_MSG_MAX);
  const now = Date.now();
  const last = list[list.length - 1];
  if (last && last.kind === kind && last.msg === text && last.where === (where || null)) {
    last.n = (last.n || 1) + 1;
    last.tLast = now;
  } else {
    list.push({ t: now, kind: kind, msg: text, where: where || null, v: APP_VERSION, n: 1 });
    if (list.length > ISSUE_MAX) list.splice(0, list.length - ISSUE_MAX);
  }
  issuesFlushSoon();
  try { if (typeof renderIssueBadge === 'function') renderIssueBadge(); } catch (e) {}
}

/* Sostituto di console.warn per gli errori gestiti: in console come prima, e
   in più nel registro. Accetta gli stessi argomenti (stringhe, Error, messaggi). */
function logWarn() {
  const args = Array.prototype.slice.call(arguments);
  try { console.warn.apply(console, args); } catch (e) {}
  let where = null;
  const parts = args.map(a => {
    if (a && typeof a === 'object' && (a.message || a.stack)) {
      where = where || issueWhereFromStack(a.stack);
      return a.message || String(a);
    }
    return String(a);
  });
  logIssue('warn', parts.join(' '), where);
}

function readIssues() { return issuesLoad().slice(); }

function clearIssues() {
  issueList = [];
  issuesFlush();
  markIssuesSeen();
}

function markIssuesSeen() {
  try { localStorage.setItem(ISSUE_SEEN_KEY, String(Date.now())); } catch (e) {}
}

/* Voci nuove dall'ultima apertura del pannello (per il pallino sulla scheda). */
function unseenIssues() {
  let seen = 0;
  try { seen = Number(localStorage.getItem(ISSUE_SEEN_KEY)) || 0; } catch (e) {}
  return issuesLoad().filter(x => (x.tLast || x.t) > seen).length;
}

/* Pura: il registro come testo da incollare in un messaggio. */
function formatIssues(list, meta) {
  const pad = n => String(n).padStart(2, '0');
  const ts = t => { const d = new Date(t); return isFinite(d.getTime())
    ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) : '?'; };
  const head = 'Cruscotto Moto ' + APP_VERSION + (meta ? ' · ' + meta : '');
  if (!list.length) return head + '\nNessun errore registrato.';
  return head + '\n' + list.map(x =>
    ts(x.t) + ' [' + x.kind + ']' + (x.n > 1 ? ' ×' + x.n + ' (ultima ' + ts(x.tLast) + ')' : '') +
    (x.where ? ' ' + x.where : '') + (x.v && x.v !== APP_VERSION ? ' (' + x.v + ')' : '') + ' — ' + x.msg
  ).join('\n');
}

/* Errori non gestiti: registrati subito, prima ancora di init(). Il toast lo
   aggiunge init() (serve il DOM). */
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', ev => {
    const where = ev && ev.filename
      ? String(ev.filename).split('/').pop() + ':' + (ev.lineno || '?')
      : issueWhereFromStack(ev && ev.error && ev.error.stack);
    logIssue('error', (ev && ev.message) || 'errore sconosciuto', where);
  });
  window.addEventListener('unhandledrejection', ev => {
    const r = ev && ev.reason;
    logIssue('reject', (r && (r.message || r)) || 'promise rifiutata', issueWhereFromStack(r && r.stack));
  });
  window.addEventListener('pagehide', issuesFlush);
}
