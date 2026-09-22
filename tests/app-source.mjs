// Sorgente "dell'app" per i test che controllano markup, CSS e wiring insieme:
// index.html più lo stile (css/app.css) e l'avvio (js/init.js), che prima
// stavano inline nella pagina. Concatenati, le regex dei test restano valide.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

export function appSource() {
  return read('index.html') + '\n' + read('css/app.css') + '\n' + read('js/init.js');
}
