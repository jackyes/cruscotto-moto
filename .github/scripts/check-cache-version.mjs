// Controllo per la CI: un push che cambia file della SHELL di sw.js senza
// alzare CACHE_VERSION. NON blocca: il service worker serve il codice dalla
// rete per primo e aggiorna la cache a ogni risposta, quindi online il telefono
// ha comunque la versione nuova. Senza l'aumento però la copia offline si
// rinnova solo per i file effettivamente scaricati (viewer.html, le icone o
// Leaflet possono restare vecchi) e non compare "Nuova versione disponibile".
// Uso: node .github/scripts/check-cache-version.mjs [--warn] <commit-base> [<commit-head>]
//   --warn: avviso (annotazione GitHub) invece di uscire con errore.
import { execFileSync } from 'node:child_process';

/* Pura: file della SHELL (percorsi relativi alla radice) dal sorgente di sw.js.
   './' è la pagina servita alla radice, cioè index.html. */
export function shellFiles(swSrc) {
  const m = swSrc.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!m) throw new Error('lista SHELL non trovata in sw.js');
  const out = new Set();
  for (const x of m[1].matchAll(/'([^']+)'/g)) {
    const p = x[1] === './' ? 'index.html' : x[1].replace(/^\.\//, '');
    out.add(p);
  }
  return out;
}

export function cacheVersion(swSrc) {
  const m = swSrc && swSrc.match(/const CACHE_VERSION = '([^']+)'/);
  return m ? m[1] : null;
}

/* Pura: esito del controllo. changed = file cambiati fra base e head. */
export function checkCacheVersion({ changed, swBefore, swAfter }) {
  const shell = shellFiles(swAfter);
  const touched = changed.filter(f => shell.has(f) || f === 'sw.js');
  if (!touched.length) return { ok: true, touched };
  const before = cacheVersion(swBefore), after = cacheVersion(swAfter);
  // sw.js assente prima (primo commit / file nuovo): niente da confrontare.
  if (before == null) return { ok: true, touched };
  return { ok: before !== after, touched, before, after };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const warn = args[0] === '--warn';
  if (warn) args.shift();
  const base = args[0], head = args[1] || 'HEAD';
  // Push di un branch nuovo o forzato: GitHub passa 000…0 come "before".
  if (!base || /^0+$/.test(base)) {
    console.log('Nessun commit di base: controllo saltato.');
    process.exit(0);
  }
  const changed = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
  let swBefore = null;
  try { swBefore = git('show', base + ':sw.js'); } catch (e) {}
  const swAfter = git('show', head + ':sw.js');
  const r = checkCacheVersion({ changed, swBefore, swAfter });
  if (r.ok) {
    console.log(r.touched.length
      ? `OK: CACHE_VERSION ${r.before} → ${r.after} (${r.touched.length} file della SHELL cambiati).`
      : 'OK: nessun file della SHELL cambiato.');
    process.exit(0);
  }
  const msg = `CACHE_VERSION è ancora ${r.after}, ma sono cambiati file della SHELL: ${r.touched.join(', ')}. ` +
    'Online il telefono prende comunque il codice nuovo; alzala per rinnovare tutta la copia offline e mostrare l\'avviso di aggiornamento.';
  if (warn) {
    // Annotazione visibile sul commit in GitHub, senza far fallire il job.
    console.log('::warning title=CACHE_VERSION non aumentata::' + msg);
    process.exit(0);
  }
  console.error(msg);
  process.exit(1);
}
