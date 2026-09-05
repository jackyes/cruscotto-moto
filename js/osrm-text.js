'use strict';
/* js/osrm-text.js (step 4): adattatore testo OSRM puro (OSRM_MOD_IT/ORD_IT, osrmType/Text/Idx, navFromOsrm). Usa decodePolyline6+navShapePlausible da js/geo.js. navTryOsrm resta inline (rete). */
/* ---- adattatore OSRM ----
   OSRM non da' il testo delle istruzioni, ma type + modifier + nome strada: l'italiano
   lo si compone qui. Meglio che dipendere dal testo del server, perche' la formulazione
   resta coerente con quella dei banner. */
const OSRM_MOD_IT = {
  'uturn': 'inversione', 'sharp right': 'secca a destra', 'right': 'a destra',
  'slight right': 'leggermente a destra', 'straight': 'dritto',
  'slight left': 'leggermente a sinistra', 'left': 'a sinistra',
  'sharp left': 'secca a sinistra',
};
const OSRM_ORD_IT = ['', 'prima', 'seconda', 'terza', 'quarta', 'quinta', 'sesta', 'settima', 'ottava'];
/* Codici manovra: si riusano quelli di Valhalla, cosi' le icone e la logica rotonde
   non hanno bisogno di sapere quale motore ha risposto. */
function osrmType(t, mod) {
  const R = /right/.test(mod || ''), L = /left/.test(mod || '');
  switch (t) {
    case 'depart': return 1;
    case 'arrive': return 4;
    case 'merge': return 25;
    case 'on ramp': return R ? 18 : L ? 19 : 17;
    case 'off ramp': return R ? 20 : 21;
    case 'fork': return R ? 23 : L ? 24 : 22;
    case 'roundabout': case 'rotary': case 'roundabout turn': return 26;
    case 'exit roundabout': case 'exit rotary': return 27;
    case 'turn': case 'end of road':
      if (mod === 'uturn') return 12;
      if (mod === 'sharp right') return 11;
      if (mod === 'right') return 10;
      if (mod === 'slight right') return 9;
      if (mod === 'sharp left') return 14;
      if (mod === 'left') return 15;
      if (mod === 'slight left') return 16;
      return 8;
    default: return 8;
  }
}
function osrmText(st) {
  const m = st.maneuver || {}, mod = m.modifier || '', name = st.name || '';
  const su = name ? ' su ' + name : '';
  const dir = OSRM_MOD_IT[mod] || '';
  switch (m.type) {
    case 'depart': return 'Parti' + su;
    case 'arrive': return 'Sei arrivato a destinazione';
    case 'new name': return 'Continua' + su;
    case 'continue': return mod && mod !== 'straight' ? 'Continua ' + dir + su : 'Continua dritto' + su;
    case 'merge': return 'Immettiti ' + dir + su;
    case 'on ramp': return 'Prendi la rampa ' + dir + su;
    case 'off ramp': return 'Prendi l’uscita ' + dir + su;
    case 'fork': return 'Al bivio tieni ' + (dir || 'la direzione') + su;
    case 'end of road': return 'Alla fine della strada svolta ' + dir + su;
    case 'roundabout': case 'rotary':
      return 'Alla rotonda prendi la ' + (OSRM_ORD_IT[m.exit] || (m.exit + 'ª')) + ' uscita' + su;
    case 'roundabout turn': return 'Alla rotonda svolta ' + dir + su;
    case 'exit roundabout': case 'exit rotary': return 'Esci dalla rotonda' + su;
    case 'turn':
      if (mod === 'uturn') return 'Fai inversione di marcia' + su;
      return 'Svolta ' + dir + su;
    default: return 'Continua' + su;
  }
}

/* Indice del vertice della shape corrispondente a un punto manovra. Ricerca monotona
   in avanti: su un percorso che ripassa vicino a se stesso il match piu' vicino in
   assoluto sarebbe quello sbagliato. Verificato: le posizioni OSRM cadono esattamente
   sui vertici, errore 0 m. */
function osrmIdxOf(lat, lon, dLat, dLon, from) {
  let best = from, bd = Infinity;
  for (let i = from; i < dLat.length; i++) {
    const a = dLat[i] - lat, b = dLon[i] - lon;
    const d2 = a * a + b * b;
    if (d2 < bd) { bd = d2; best = i; }
    if (d2 < 1e-14) return i;
  }
  return best;
}

/* Converte la risposta OSRM nella stessa forma che navBuild si aspetta da Valhalla,
   cosi' tutto il resto (costruzione, persistenza, ripristino) resta identico. */
function navFromOsrm(j) {
  const r = j && j.routes && j.routes[0];
  if (!r || !r.geometry) throw new Error('OSRM: rotta vuota');
  const d = decodePolyline6(r.geometry);
  if (!navShapePlausible(d.lat, d.lon)) throw new Error('OSRM: shape implausibile');
  const steps = [];
  for (const leg of (r.legs || [])) for (const st of (leg.steps || [])) steps.push(st);
  if (!steps.length) throw new Error('OSRM: nessuna manovra');
  const man = [];
  let cur = 0;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i], mv = st.maneuver || {}, loc = mv.location || [];
    const idx = (loc.length >= 2) ? osrmIdxOf(loc[1], loc[0], d.lat, d.lon, cur) : cur;
    cur = idx;
    const txt = osrmText(st);
    man.push({
      type: osrmType(mv.type, mv.modifier),
      instruction: txt,
      verbal_pre_transition_instruction: txt,
      verbal_transition_alert_instruction: '',
      verbal_post_transition_instruction: '',
      verbal_multi_cue: false,
      street_names: st.name ? [st.name] : [],
      begin_shape_index: idx,
      end_shape_index: idx,          // sistemato sotto: coincide con l'inizio della successiva
      time: +st.duration || 0,
      bearing_before: mv.bearing_before == null ? null : +mv.bearing_before,
      bearing_after: mv.bearing_after == null ? null : +mv.bearing_after,
      roundabout_exit_count: mv.exit == null ? null : (mv.exit | 0),
    });
  }
  for (let i = 0; i < man.length; i++) {
    man[i].end_shape_index = (i + 1 < man.length) ? man[i + 1].begin_shape_index : (d.lat.length - 1);
  }
  return { legs: [{ shape: r.geometry, maneuvers: man }], summary: { length: (r.distance || 0) / 1000, time: r.duration || 0 } };
}

