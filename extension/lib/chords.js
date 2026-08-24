// Recunoașterea acordului dintr-un vector chroma: potrivire pe șabloane.
// Pur, fără chrome.*, testabil în Node.
//
// Un acord major = fundamentala + terță mare (4 semitonuri) + cvintă (7).
// Un acord minor = fundamentala + terță mică (3) + cvintă (7).
// Construim câte un șablon pentru fiecare din cele 12 fundamentale × 2 calități = 24,
// apoi întrebăm: cu care șablon seamănă cel mai bine chroma măsurată?

import { NOTES, NO_CHORD } from './music-theory.js';
import { CHROMA_SIZE } from './chroma.js';

const INTERVALS = {
  '': [0, 4, 7],    // major
  m: [0, 3, 7],     // minor
};

// Fundamentala cântărește mai mult: e nota care dă numele acordului și, în muzică reală,
// e de obicei și cea mai prezentă (bas + armonice).
const WEIGHTS = [1.3, 1.0, 1.0];

function buildTemplates() {
  const out = [];
  for (const [quality, intervals] of Object.entries(INTERVALS)) {
    for (let root = 0; root < CHROMA_SIZE; root++) {
      const vec = new Float64Array(CHROMA_SIZE);
      intervals.forEach((iv, i) => { vec[(root + iv) % CHROMA_SIZE] = WEIGHTS[i]; });
      let norm = 0;
      for (const v of vec) norm += v * v;
      out.push({ label: NOTES[root] + quality, root, vec, norm: Math.sqrt(norm) });
    }
  }
  return out;
}

export const TEMPLATES = buildTemplates();

/** Prag sub care spunem „nu e niciun acord clar” (N.C.). */
export const DEFAULT_THRESHOLD = 0.6;

/** Cât cântărește basul în decizie (0 = deloc, 1 = numai basul). */
export const DEFAULT_BASS_WEIGHT = 0.3;

/**
 * @param {Float64Array} chroma 12 valori (index 0 = C)
 * @param {object} [opts]
 * @param {Float64Array} [opts.bass] chroma calculată DOAR din registrul grav — nota de bas
 *   spune de obicei care e fundamentala acordului. Fără ea, acordurile înrudite se confundă:
 *   G (G-B-D) cu un F# trecător în melodie conține exact Bm (B-D-F#), iar detectorul alege
 *   greșit. Basul pe G rezolvă ambiguitatea, fiindcă fundamentala se aude jos.
 * @returns {{label:string, score:number, runnerUp:string|null}}
 */
export function matchChord(chroma, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const bass = opts.bass ?? null;
  const bassWeight = bass ? (opts.bassWeight ?? DEFAULT_BASS_WEIGHT) : 0;

  let norm = 0;
  for (const v of chroma) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return { label: NO_CHORD, score: 0, runnerUp: null };

  let bassMax = 0;
  if (bass) for (const v of bass) if (v > bassMax) bassMax = v;

  let best = null, second = null;
  for (const t of TEMPLATES) {
    let dot = 0;
    for (let i = 0; i < CHROMA_SIZE; i++) dot += chroma[i] * t.vec[i];
    const cosine = dot / (norm * t.norm);
    // Media ponderată păstrează scorul în același interval ca similaritatea cosinus,
    // deci pragul de N.C. rămâne comparabil cu și fără bas.
    const bassSupport = bassMax > 0 ? bass[t.root] / bassMax : 0;
    const score = (cosine + bassWeight * bassSupport) / (1 + bassWeight);

    if (!best || score > best.score) { second = best; best = { label: t.label, score }; }
    else if (!second || score > second.score) second = { label: t.label, score };
  }

  if (best.score < threshold) return { label: NO_CHORD, score: best.score, runnerUp: best.label };
  return { label: best.label, score: best.score, runnerUp: second?.label ?? null };
}
