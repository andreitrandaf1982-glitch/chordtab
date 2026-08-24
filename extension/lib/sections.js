// Structura melodiei: găsește buclele de acorduri care se repetă și împarte cronologia în
// secțiuni (strofă / refren / punte). Modul PUR — fără chrome.*, fără DOM, testabil în Node.
// Scris de Fable la kickoff-ul funcției (2026-08-24). Vezi docs/PLAN-sectiuni.md.
//
// Ideea, în cinci propoziții:
//   1. Cuantizăm cronologia: „ce acord sună la fiecare 0,5 s”.
//   2. Pentru fiecare moment și fiecare durată candidat, întrebăm: fereastra următoare REPETĂ
//      fereastra curentă? Cea mai mică perioadă care se susține e perioada buclei de acolo.
//   3. Tăiem nu doar unde se schimbă perioada, ci și unde se schimbă CONȚINUTUL: strofa și
//      refrenul au deseori aceeași lungime de buclă (4 măsuri), dar acorduri diferite —
//      fără tăietura asta ar deveni o singură secțiune.
//   4. Tiparul afișat al unei secțiuni e VOTUL tuturor repetițiilor ei — o detecție greșită
//      într-o repetiție e corectată de celelalte.
//   5. Secțiunile cu bucle echivalente (comparate circular) primesc aceeași literă; numele
//      (strofă/refren/punte) se dau doar când tiparul e limpede.

import { NO_CHORD } from './music-theory.js';

export const SECTION_DEFAULTS = {
  dt: 0.5,               // pasul de cuantizare, secunde
  minPeriod: 4,          // cea mai scurtă buclă acceptată, secunde
  maxPeriod: 45,         // cea mai lungă buclă căutată, secunde
  matchThreshold: 0.7,   // cât din fereastră trebuie să se potrivească la repetiție
  clusterThreshold: 0.75, // cât de asemănătoare trebuie să fie două bucle ca să fie „aceeași”
  adoptThreshold: 0.7,   // cât de bine trebuie să se muleze bucla unui grup pe o zonă liberă
  minSection: 8,         // secțiunile mai scurte de atât se topesc în vecini, secunde
};

/**
 * @param {{t:number, label:string}[]} chords cronologia memorată (ordinea nu contează, sortăm)
 * @param {number} duration durata melodiei, secunde
 * @returns {{
 *   sections: {start:number, end:number, cluster:string|null,
 *              name:'intro'|'verse'|'chorus'|'bridge'|'outro'|null, reps:number}[],
 *   patterns: Record<string, {loop:{label:string, seconds:number}[], period:number}>,
 *   coverage: number,
 * }}
 */
export function detectSections(chords, duration, opts = {}) {
  const o = { ...SECTION_DEFAULTS, ...opts };
  const events = (chords || [])
    .filter((c) => c && Number.isFinite(c.t) && typeof c.label === 'string')
    .sort((a, b) => a.t - b.t);

  const end = Number.isFinite(duration) && duration > 0
    ? duration
    : (events.length ? events[events.length - 1].t + 4 : 0);
  if (events.length < 4 || end < o.minPeriod * 2) return emptyResult(end);

  const { dt } = o;
  const N = Math.max(1, Math.round(end / dt));
  const seq = quantize(events, N, dt);

  const minL = Math.max(2, Math.round(o.minPeriod / dt));
  const maxL = Math.min(Math.round(o.maxPeriod / dt), Math.floor(N / 2));
  if (maxL < minL) return emptyResult(end);

  const periodAt = findPeriods(seq, N, minL, maxL, o.matchThreshold, o._debug);

  // Momente consecutive cu aceeași perioadă (±1 eșantion — zgomot de cuantizare).
  let runs = [];
  for (let i = 0; i < N; i++) {
    const L = periodAt[i];
    const last = runs[runs.length - 1];
    if (last && ((L === 0 && last.L === 0) || (L > 0 && last.L > 0 && Math.abs(L - last.L) <= 1))) {
      last.e = i + 1;
    } else {
      runs.push({ s: i, e: i + 1, L });
    }
  }

  o._debug?.('runs-brute', runs.map((r) => ({ ...r })));
  runs = runs.flatMap((run) => splitRunByContent(run, seq, o.matchThreshold));
  o._debug?.('runs-taiate', runs.map((r) => ({ ...r })));
  runs = mergeShortRuns(runs, Math.round(o.minSection / dt));
  snapBoundaries(runs, events, dt);
  o._debug?.('runs-finale', runs.map((r) => ({ ...r })));

  // Tiparul-consens al fiecărei secțiuni + gruparea buclelor echivalente.
  const clusters = []; // { loopSeq, period, bestReps, letter }
  let sections = [];
  for (const run of runs) {
    const start = run.s * dt;
    const endT = run.e * dt;
    if (run.L === 0) {
      sections.push({ start, end: endT, cluster: null, name: null, reps: 1 });
      continue;
    }
    const P = run.L;
    const reps = Math.max(1, Math.round((run.e - run.s) / P));
    const loopSeq = consensusLoop(seq, run.s, run.e, P);
    if (!loopSeq) { // buclă doar din tăcere — o tratăm ca zonă liberă
      sections.push({ start, end: endT, cluster: null, name: null, reps: 1 });
      continue;
    }
    let cluster = null;
    let bestSim = 0;
    for (const c of clusters) {
      if (Math.abs(c.period - P) > 1) continue;
      const sim = circularSimilarity(c.loopSeq, loopSeq);
      if (sim >= o.clusterThreshold && sim > bestSim) { cluster = c; bestSim = sim; }
    }
    if (!cluster) {
      cluster = { loopSeq, period: P, bestReps: reps, letter: null };
      clusters.push(cluster);
    } else if (reps > cluster.bestReps) {
      // secțiunea cu cele mai multe repetiții are votul cel mai de încredere
      cluster.loopSeq = loopSeq;
      cluster.period = P;
      cluster.bestReps = reps;
    }
    sections.push({ start, end: endT, cluster, name: null, reps });
  }

  // Litere în ordinea apariției, apoi obiectele cluster devin simple litere.
  const LETTERS = 'ABCDEFGHIJ';
  let li = 0;
  for (const s of sections) {
    if (s.cluster && s.cluster.letter === null) s.cluster.letter = LETTERS[Math.min(li++, LETTERS.length - 1)];
  }
  for (const s of sections) if (s.cluster) s.cluster = s.cluster.letter;

  // ADOPȚIA: o „zonă liberă” poate fi de fapt o secțiune căreia zgomotul i-a distrus dovada
  // proprie de repetiție (o strofă cu detecții greșite în ambele treceri n-are cum să se
  // demonstreze singură). O comparăm direct cu buclele grupurilor deja găsite — informația
  // globală a melodiei salvează bucata stricată. Puntea rămâne liberă: nu seamănă cu nimic.
  for (const s of sections) {
    if (s.cluster) continue;
    const sS = Math.round(s.start / dt);
    const sE = Math.round(s.end / dt);
    let best = null;
    for (const c of clusters) {
      if (c.letter === null) continue;
      const sim = tiledSimilarity(seq, sS, sE, c.loopSeq);
      if (sim >= o.adoptThreshold && (!best || sim > best.sim)) best = { c, sim };
    }
    if (best) {
      s.cluster = best.c.letter;
      s.reps = Math.max(1, Math.round((sE - sS) / best.c.period));
    }
  }

  // Secțiuni vecine cu aceeași literă = aceeași secțiune, doar tăiată de zgomot.
  sections = sections.reduce((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last.cluster !== null && last.cluster === s.cluster && Math.abs(last.end - s.start) < 1e-9) {
      last.end = s.end;
      last.reps += s.reps;
    } else {
      acc.push(s);
    }
    return acc;
  }, []);

  nameSections(sections);

  const patterns = {};
  for (const c of clusters) {
    if (c.letter === null) continue;
    patterns[c.letter] = { loop: compressLoop(c.loopSeq, dt), period: c.period * dt };
  }

  let covered = 0;
  for (const s of sections) if (s.cluster) covered += s.end - s.start;

  return { sections, patterns, coverage: end > 0 ? covered / end : 0 };
}

function emptyResult(end) {
  return {
    sections: end > 0 ? [{ start: 0, end, cluster: null, name: null, reps: 1 }] : [],
    patterns: {},
    coverage: 0,
  };
}

// Cronologie -> „ce acord sună la fiecare i*dt” (null = N.C. / nimic încă).
function quantize(events, N, dt) {
  const seq = new Array(N).fill(null);
  let e = 0;
  let current = null;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    while (e < events.length && events[e].t <= t) { current = events[e].label; e++; }
    seq[i] = current && current !== NO_CHORD ? current : null;
  }
  return seq;
}

// Perioada buclei la fiecare moment — inima detecției de structură.
//
// TREI CAPCANE REZOLVATE AICI (nu le reintroduce; fiecare a fost văzută pe teste):
//
// 1. „Cea mai mică perioadă peste prag” alege impostori: dacă acordurile țin ~4 eșantioane,
//    o pseudo-perioadă cu 1 mai scurtă decât cea reală tot potrivește 3 din 4 poziții (75%)
//    și trece pragul de 70% înaintea celei adevărate (100%). → Filtrul „aproape de maxim”:
//    o fereastră contează doar dacă scorul ei e la ≤0,05 de cel mai bun scor al acelui moment.
//
// 2. Multiplii și super-perioadele: bucla de 8 s se potrivește perfect și la 16 s și la 24 s;
//    strofă+refren împreună formează o „super-buclă” care ar înghiți alternanța V-R-V-R într-o
//    singură secțiune. → Regula acoperirii: un interval e aruncat dacă ≥80% din el e deja
//    explicat de intervale cu perioade STRICT mai mici (cu ≥2 eșantioane — vecinii ±1 sunt
//    gemeni de cuantizare, nu perioade mai mici).
//
// 3. Coincidențele scurte dar perfecte: coada refrenului (G D) poate fi identică cu capul
//    strofei (G D), creând o buclă locală reală de câteva secunde care fură teren de la
//    structura adevărată. → Atribuirea pe lungime: intervalele lungi (repetiție susținută)
//    revendică primele; coincidența rămâne cu firimituri, pe care curățenia le topește.
function findPeriods(seq, N, minL, maxL, threshold, _debug) {
  // Schimbări de acord față de precedentul non-null — garda anti-dronă. (Aproximare: la
  // granița dintre o dronă și altceva o fereastră poate trece greșit, dar bucata rezultată
  // e sub minSection și se topește la curățenie — inofensiv.)
  const changePrefix = new Float64Array(N + 1);
  {
    let prev = null;
    for (let i = 0; i < N; i++) {
      let isChange = 0;
      if (seq[i] !== null) {
        if (prev !== null && seq[i] !== prev) isChange = 1;
        prev = seq[i];
      }
      changePrefix[i + 1] = changePrefix[i] + isChange;
    }
  }

  // Trecerea 1: scorul fiecărei ferestre (i, L).
  const numLags = maxL - minL + 1;
  const scores = new Float32Array(numLags * N); // 0 = fereastră invalidă
  for (let L = minL; L <= maxL; L++) {
    const M = N - L;
    // Prefixe: potriviri și poziții „care contează” între seq[i] și seq[i+L].
    // Ambele null = neutru (nu umflă scorul în zonele goale); una null = nepotrivire.
    const pm = new Float64Array(M + 1);
    const pv = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) {
      const a = seq[i], b = seq[i + L];
      const bothNull = a === null && b === null;
      pv[i + 1] = pv[i] + (bothNull ? 0 : 1);
      pm[i + 1] = pm[i] + (!bothNull && a === b ? 1 : 0);
    }
    const row = (L - minL) * N;
    for (let i = 0; i + 2 * L <= N; i++) {
      const valid = pv[i + L] - pv[i];
      if (valid < L * 0.5) continue;                            // fereastră prea goală
      // Garda anti-dronă, pe AMBELE copii: o buclă adevărată are schimbări de acord în
      // fiecare trecere. Cu garda doar pe prima copie, o fereastră care încalecă granița
      // dintre un acord ținut și restul melodiei trecea și fabrica o „buclă” peste dronă.
      if (changePrefix[i + L] - changePrefix[i + 1] < 1) continue;
      if (changePrefix[i + 2 * L] - changePrefix[i + L + 1] < 1) continue;
      const sc = (pm[i + L] - pm[i]) / valid;
      if (sc < threshold) continue;
      scores[row + i] = sc;
    }
  }

  // Trecerea 2: ferestrele „aproape de maximul VECINILOR” devin intervale maximale per L.
  //
  // Comparația se face DOAR între perioade apropiate (±3 eșantioane). Între lungimi diferite
  // ar fi nedreaptă: o fereastră lungă face media zgomotului (scor mare), una scurtă îl suferă
  // local (scor mic) — iar perdantul ar fi exact perioada adevărată, în favoarea unei
  // super-perioade umflate statistic. Impostorii ±1 rămân prinși, fiindcă ei chiar sunt vecini.
  const NEAR_BEST = 0.05;
  const BAND = 3;
  const intervals = []; // { s, e, L }
  for (let L = minL; L <= maxL; L++) {
    const row = (L - minL) * N;
    let cur = null;
    for (let i = 0; i + 2 * L <= N; i++) {
      const sc = scores[row + i];
      if (sc === 0) continue;
      let localBest = 0;
      for (let Lb = Math.max(minL, L - BAND); Lb <= Math.min(maxL, L + BAND); Lb++) {
        const v = scores[(Lb - minL) * N + i];
        if (v > localBest) localBest = v;
      }
      if (sc < localBest - NEAR_BEST) continue;
      const to = i + 2 * L; // ambele copii ale ferestrei aparțin buclei
      if (cur && i <= cur.e) cur.e = Math.max(cur.e, to);
      else { if (cur) intervals.push(cur); cur = { s: i, e: to, L }; }
    }
    if (cur) intervals.push(cur);
  }

  // Tunsoarea la miez: capetele unui interval vin des din ferestre care încalecă granițele
  // (pragul de 70% le lasă să treacă și cu teren străin), dar pozițiile alea n-au pereche
  // adevărată la distanța L. Fără tunsoare, marginile umflate fac intervalul să pară
  // „explicat” de vecini la testul de acoperire de mai jos — și pierdeam exact refrenul.
  for (const iv of intervals) {
    const { s, e, L } = iv;
    const supported = (j) => (j + L < e && (seq[j] === seq[j + L]
      || (seq[j] === null && seq[j + L] === null)))
      || (j - L >= s && (seq[j] === seq[j - L]
      || (seq[j] === null && seq[j - L] === null)));
    let a = s;
    while (a < e && !supported(a)) a++;
    let b = e - 1;
    while (b > a && !supported(b)) b--;
    iv.s = a;
    iv.e = b + 1;
  }
  // Miezul trebuie să acopere măcar o perioadă și jumătate. Nu cerem două întregi: o secțiune
  // cu doar 2 repetiții și un acord greșit lângă margine se tunde legitim sub 2 perioade,
  // și am pierde-o cu totul (i s-a întâmplat refrenului din testul cu zgomot).
  const trimmed = intervals.filter((iv) => iv.e - iv.s >= 1.5 * iv.L);
  intervals.length = 0;
  intervals.push(...trimmed);

  // Trecerea 3 — regula acoperirii (capcana 2): perioadele mici, deja păstrate, resping
  // multiplii și super-perioadele care nu explică nimic în plus.
  const kept = [];
  const minCover = new Uint16Array(N); // cea mai mică perioadă păstrată care acoperă poziția
  let tierStart = 0;
  intervals.sort((a, b) => a.L - b.L || a.s - b.s);
  for (let k = 0; k <= intervals.length; k++) {
    const tierEnded = k === intervals.length || (k > tierStart && intervals[k].L !== intervals[tierStart].L);
    if (tierEnded) {
      // abia după ce toată „generația” L a fost judecată intră în harta de acoperire —
      // intervalele cu același L nu se resping între ele
      for (let m = tierStart; m < k; m++) {
        const iv = intervals[m];
        if (!iv.kept) continue;
        for (let j = iv.s; j < iv.e; j++) {
          if (minCover[j] === 0 || iv.L < minCover[j]) minCover[j] = iv.L;
        }
      }
      tierStart = k;
    }
    if (k === intervals.length) break;
    const iv = intervals[k];
    let covered = 0;
    for (let j = iv.s; j < iv.e; j++) {
      if (minCover[j] !== 0 && minCover[j] <= iv.L - 2) covered++;
    }
    // Pragul e agresiv (60%) cu intenție: pe cronologii zgomotoase, ferestrele lungi fac media
    // zgomotului și par mai convingătoare decât perioadele adevărate, dar sunt doar ecouri
    // (secțiunea X repetă secțiunea X de acum 30 s). Dacă majoritatea terenului lor e deja
    // explicată de bucle mici, restul e gaură de zgomot, nu structură nouă.
    if (covered / (iv.e - iv.s) < 0.6) { iv.kept = true; kept.push(iv); }
    _debug?.(iv.kept ? 'interval-pastrat' : 'interval-aruncat', [iv]);
  }

  // Trecerea 4 — atribuirea pe lungime (capcana 3): repetiția susținută revendică prima.
  // A PATRA CAPCANĂ, rezolvată tot aici: o poziție e revendicată DOAR dacă perechea ei de
  // peste o perioadă chiar se potrivește. Ferestrele care încalecă granițele (pragul de 70%
  // le lasă să treacă și cu 30% teren străin) altfel s-ar vărsa peste punți și pauze și le-ar
  // strivi sub pragul de supraviețuire. Găurile de zgomot rămase se topesc la curățenie.
  kept.sort((a, b) => (b.e - b.s) - (a.e - a.s) || a.L - b.L || a.s - b.s);
  const periodAt = new Uint16Array(N); // 0 = nicio buclă
  for (const iv of kept) {
    const { s, e, L } = iv;
    for (let j = s; j < e; j++) {
      if (periodAt[j] !== 0) continue;
      const fwd = j + L < e && (seq[j] === seq[j + L]
        || (seq[j] === null && seq[j + L] === null));
      const bwd = j - L >= s && (seq[j] === seq[j - L]
        || (seq[j] === null && seq[j - L] === null));
      if (fwd || bwd) periodAt[j] = L;
    }
  }

  // Închiderea găurilor: un acord detectat greșit lasă o gaură de 1-2 s în zona lui periodică
  // (proba pe perechi pică fix acolo). Fără închidere, găurile FRAGMENTEAZĂ zona, iar
  // curățenia topește fragmentele în „liber” — și pierdem secțiuni întregi. O gaură scurtă
  // între două zone cu aceeași perioadă e zgomot, nu structură.
  const GAP = 4; // eșantioane = 2 s
  for (let j = 1; j < N; j++) {
    if (periodAt[j] !== 0 || periodAt[j - 1] === 0) continue;
    let k = j;
    while (k < N && periodAt[k] === 0) k++;
    if (k < N && k - j <= GAP && Math.abs(periodAt[k] - periodAt[j - 1]) <= 1) {
      for (let m = j; m < k; m++) periodAt[m] = periodAt[j - 1];
    }
    j = k;
  }
  return periodAt;
}

// Taie o porțiune periodică acolo unde CONȚINUTUL se schimbă: strofa și refrenul au deseori
// aceeași perioadă, dar bucle diferite. Comparăm fiecare pereche de perioade vecine; unde nu
// se mai potrivesc, acolo e o graniță de secțiune.
function splitRunByContent(run, seq, threshold) {
  if (run.L === 0) return [run];
  const P = run.L;
  const numPeriods = Math.floor((run.e - run.s) / P);
  if (numPeriods < 2) return [run];

  const pieces = [];
  let pieceStart = run.s;
  for (let m = 0; m + 1 < numPeriods; m++) {
    const a = run.s + m * P;
    const b = run.s + (m + 1) * P;
    let eq = 0, valid = 0;
    for (let i = 0; i < P; i++) {
      const x = seq[a + i], y = seq[b + i];
      if (x === null && y === null) continue;
      valid++;
      if (x === y) eq++;
    }
    if (valid >= P * 0.5 && eq / valid < threshold) {
      pieces.push({ s: pieceStart, e: b, L: P });
      pieceStart = b;
    }
  }
  pieces.push({ s: pieceStart, e: run.e, L: P });
  return pieces;
}

// Bucățile mai scurte de minSection se topesc în vecinul mai lung. Nu re-unim bucăți periodice
// vecine (pot fi bucle diferite cu aceeași perioadă — gruparea pe litere decide mai târziu);
// doar zonele libere vecine se unesc între ele.
function mergeShortRuns(runs, minRun) {
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let k = 0; k < runs.length; k++) {
      const run = runs[k];
      if (run.e - run.s >= minRun) continue;
      const prev = runs[k - 1] || null;
      const next = runs[k + 1] || null;
      const into = !prev ? next : !next ? prev
        : (prev.e - prev.s >= next.e - next.s ? prev : next);
      if (!into) break;
      if (into === prev) prev.e = run.e; else next.s = run.s;
      runs.splice(k, 1);
      for (let m = 1; m < runs.length; m++) {
        const a = runs[m - 1], b = runs[m];
        if (a.e === b.s && a.L === 0 && b.L === 0) {
          a.e = b.e;
          runs.splice(m, 1);
          m--;
        }
      }
      changed = true;
      break;
    }
  }
  return runs;
}

// Granițele interne se lipesc de cea mai apropiată schimbare de acord (≤1 s): tiparul extras
// începe atunci pe un început de acord, nu la mijlocul lui.
function snapBoundaries(runs, events, dt) {
  const eventSamples = events.map((ev) => Math.round(ev.t / dt));
  for (let k = 1; k < runs.length; k++) {
    const b = runs[k].s;
    let best = null;
    for (const es of eventSamples) {
      if (Math.abs(es - b) <= Math.round(1 / dt)
        && (best === null || Math.abs(es - b) < Math.abs(best - b))) best = es;
    }
    if (best !== null && best > runs[k - 1].s && best < runs[k].e) {
      runs[k - 1].e = best;
      runs[k].s = best;
    }
  }
}

// Votul repetițiilor: la fiecare poziție din buclă câștigă acordul majoritar din toate
// trecerile prin ea. null dacă bucla e doar tăcere.
function consensusLoop(seq, s, e, P) {
  const reps = Math.max(1, Math.floor((e - s) / P));
  const loop = new Array(P).fill(null);
  let hasChord = false;
  for (let p = 0; p < P; p++) {
    const tally = new Map();
    for (let k = 0; k < reps; k++) {
      const j = s + k * P + p;
      if (j >= e) break;
      const v = seq[j];
      if (v === null) continue;
      tally.set(v, (tally.get(v) || 0) + 1);
    }
    if (tally.size) {
      loop[p] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      hasChord = true;
    }
  }
  if (!hasChord) return null;
  // umplem golurile prin continuare (bucla e circulară, deci și capătul din față)
  let last = null;
  for (let p = P - 1; p >= 0; p--) if (loop[p] !== null) { last = loop[p]; break; }
  for (let p = 0; p < P; p++) {
    if (loop[p] === null) loop[p] = last;
    else last = loop[p];
  }
  return loop;
}

// Asemănarea a două bucle, cu rotații MICI (± un sfert de buclă, max ±2 s).
//
// De ce nu orice rotație: buclele pop împart des 3 acorduri din 4 — G-D-Am-C față de
// Em-C-G-D dă 75% la o rotație mare, adică exact pragul, și strofa se lipește de refren.
// Rotațiile mici există doar ca să ierte granițe detectate cu un-două eșantioane pe lângă;
// aceeași buclă în două secțiuni începe practic în aceeași fază.
function circularSimilarity(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 0;
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  const maxShift = Math.min(4, Math.floor(n / 4));
  let best = 0;
  for (let s = -maxShift; s <= maxShift; s++) {
    const r = ((s % b.length) + b.length) % b.length;
    let eq = 0;
    for (let i = 0; i < n; i++) if (a[i] === b[(i + r) % b.length]) eq++;
    if (eq / n > best) best = eq / n;
  }
  return best;
}

// Cât de bine se mulează bucla unui grup, repetată la nesfârșit, peste o porțiune de melodie.
// Îngăduie o nealiniere de ±1 s (granițe detectate cu puțin pe lângă).
function tiledSimilarity(seq, s, e, loopSeq) {
  const P = loopSeq.length;
  if (P === 0 || e <= s) return 0;
  let best = 0;
  for (let shift = -2; shift <= 2; shift++) {
    let eq = 0, valid = 0;
    for (let j = s; j < e; j++) {
      const v = seq[j];
      if (v === null) continue;
      valid++;
      const idx = (((j - s + shift) % P) + P) % P;
      if (v === loopSeq[idx]) eq++;
    }
    if (valid >= (e - s) * 0.5 && eq / valid > best) best = eq / valid;
  }
  return best;
}

// Buclă cuantizată -> listă de afișat: [{label, seconds}], cu capetele circulare unite.
function compressLoop(loopSeq, dt) {
  const out = [];
  for (const label of loopSeq) {
    const last = out[out.length - 1];
    if (last && last.label === label) last.seconds += dt;
    else out.push({ label, seconds: dt });
  }
  if (out.length > 1 && out[0].label === out[out.length - 1].label) {
    out[0].seconds += out[out.length - 1].seconds;
    out.pop();
  }
  return out;
}

// Numire prudentă: mai bine o literă decât un nume greșit.
function nameSections(sections) {
  const clustered = sections.filter((s) => s.cluster);
  if (clustered.length === 0) return;

  const counts = new Map();
  const order = [];
  for (const s of clustered) {
    if (!counts.has(s.cluster)) order.push(s.cluster);
    counts.set(s.cluster, (counts.get(s.cluster) || 0) + 1);
  }

  const names = new Map();
  if (order.length >= 2) {
    const first = order[0];
    let top = null;
    for (const c of order.slice(1)) {
      if (!top || counts.get(c) > counts.get(top)) top = c;
    }
    // Numim perechea doar când „refrenul” chiar revine — altfel alternanța e o presupunere.
    if (top && counts.get(top) >= 2) {
      names.set(first, 'verse');
      names.set(top, 'chorus');
    }
  }
  for (const s of sections) {
    if (s.cluster && names.has(s.cluster)) s.name = names.get(s.cluster);
  }

  // Zonele libere: la început = intro, la final = outro, una singură la mijloc = punte.
  if (!sections[0].cluster) sections[0].name = 'intro';
  if (sections.length > 1 && !sections[sections.length - 1].cluster) {
    sections[sections.length - 1].name = 'outro';
  }
  const interior = sections.filter(
    (s, i) => !s.cluster && i > 0 && i < sections.length - 1,
  );
  if (interior.length === 1 && names.size > 0) interior[0].name = 'bridge';
}
