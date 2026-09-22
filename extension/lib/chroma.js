// Chroma (profil de clase de înălțime) din spectru — cod propriu, pur, testabil în Node.
//
// Ideea: un acord e definit de CARE note sună, nu de în ce octavă. Deci strângem energia
// spectrului în 12 „coșuri”, câte unul pentru fiecare notă (Do, Do#, Re, …), indiferent de octavă.
//
// Lucrăm pe VÂRFURI spectrale, nu pe binuri brute: un vârf interpolat parabolic dă frecvența
// mult mai precis decât lățimea unui bin, ceea ce contează la notele joase, unde semitonurile
// sunt mai apropiate decât rezoluția FFT-ului.
//
// Convenție: indexul 0 = C (Do). (Essentia folosea 0 = A — de-aia ne-a surprins la Pasul 0.)

export const CHROMA_SIZE = 12;

const DEFAULTS = {
  minFreq: 55,        // sub La1 nu mai avem rezoluție utilă
  maxFreq: 3500,      // peste asta e mai mult zgomot decât informație armonică
  maxPeaks: 80,
  peakThreshold: 0.005, // raportat la vârful cel mai mare din cadru
  harmonics: 4,         // câte armonice considerăm pentru fiecare vârf
  harmonicDecay: 0.6,   // cât de mult slăbește contribuția fiecărei armonice
  windowSemitones: 1.0, // lățimea ferestrei cos² în jurul unei clase de înălțime
};

/**
 * Vârfurile spectrale, cu frecvență interpolată parabolic.
 * @param {Float64Array} mag magnitudini (binuri 0..fftSize/2)
 * @param {number} sampleRate
 * @param {number} fftSize
 * @returns {{freq:number, mag:number}[]} sortate descrescător după magnitudine
 */
export function spectralPeaks(mag, sampleRate, fftSize, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(o.minFreq / binHz));
  const maxBin = Math.min(mag.length - 2, Math.ceil(o.maxFreq / binHz));

  let peak = 0;
  for (let i = minBin; i <= maxBin; i++) if (mag[i] > peak) peak = mag[i];
  if (peak <= 0) return [];
  const floor = peak * o.peakThreshold;

  const peaks = [];
  for (let i = minBin; i <= maxBin; i++) {
    const y1 = mag[i];
    if (y1 < floor || y1 <= mag[i - 1] || y1 <= mag[i + 1]) continue;
    const y0 = mag[i - 1], y2 = mag[i + 1];
    const denom = y0 - 2 * y1 + y2;
    // Interpolare parabolică: vârful real cade între binuri, nu exact pe unul.
    const delta = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom;
    peaks.push({ freq: (i + delta) * binHz, mag: y1 - 0.25 * (y0 - y2) * delta });
  }

  peaks.sort((a, b) => b.mag - a.mag);
  return peaks.slice(0, o.maxPeaks);
}

/** Poziția continuă a unei frecvențe pe scara de 12 clase (0 = C). */
function pitchClassOf(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  return ((midi % 12) + 12) % 12;
}

/** Adaugă `weight` în jurul clasei `pc`, cu o fereastră cos² de lățime `2*half`. */
function addAround(chroma, pc, weight, half) {
  for (let b = 0; b < CHROMA_SIZE; b++) {
    let d = Math.abs(pc - b);
    if (d > 6) d = 12 - d; // distanță circulară
    if (d >= half) continue;
    const win = Math.cos((Math.PI / 2) * (d / half));
    chroma[b] += weight * win * win;
  }
}

/**
 * Clasa de înălțime a NOTEI DE BAS: cea mai joasă notă care sună clar.
 *
 * Nu e totuna cu „chroma registrului grav”: într-un acord de Do cântat C3-E3-G3, tot registrul
 * grav conține C, E și G, așa că Em primește la fel de mult sprijin ca C. Doar nota cea mai
 * de jos spune care e fundamentala.
 *
 * @param {{freq:number, mag:number}[]} peaks vârfurile întregului spectru
 */
export function bassChroma(peaks, opts = {}) {
  const o = { maxFreq: 400, relThreshold: 0.15, windowSemitones: 1.0, ...opts };
  const out = new Float64Array(CHROMA_SIZE);
  if (peaks.length === 0) return out;

  let maxMag = 0;
  for (const p of peaks) if (p.mag > maxMag) maxMag = p.mag;
  const floor = maxMag * o.relThreshold;

  let lowest = null;
  for (const p of peaks) {
    if (p.freq > o.maxFreq || p.mag < floor) continue;
    if (!lowest || p.freq < lowest.freq) lowest = p;
  }
  if (!lowest) return out;

  // Strângem și vârfurile din imediata vecinătate (±1 semiton): aceeași notă, cu jitter
  // de interpolare sau ușor dezacordată.
  let weight = 0;
  for (const p of peaks) {
    if (p.freq >= lowest.freq / 1.03 && p.freq <= lowest.freq * 1.03) weight += p.mag;
  }
  addAround(out, pitchClassOf(lowest.freq), weight, o.windowSemitones / 2);

  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < CHROMA_SIZE; i++) out[i] /= max;
  return out;
}

/**
 * Vârfuri -> vector chroma de 12 valori, normalizat la maxim 1. Index 0 = C.
 * @param {{freq:number, mag:number}[]} peaks
 * @param {Float64Array} [out] tampon reutilizabil de 12
 */
export function chromaFromPeaks(peaks, opts = {}, out) {
  const o = { ...DEFAULTS, ...opts };
  const chroma = out && out.length === CHROMA_SIZE ? out.fill(0) : new Float64Array(CHROMA_SIZE);
  const half = o.windowSemitones / 2;

  for (const p of peaks) {
    // Energia (magnitudinea la pătrat) contează mai mult decât amplitudinea brută.
    const energy = p.mag * p.mag;
    for (let h = 1; h <= o.harmonics; h++) {
      // Vârful ăsta ar putea fi armonica h a unui fundamental f/h.
      const f = p.freq / h;
      if (f < o.minFreq) break;
      const w = energy * Math.pow(o.harmonicDecay, h - 1);

      // MIDI 60 = C4, iar 60 % 12 = 0 => index 0 = C.
      addAround(chroma, pitchClassOf(f), w, half);
    }
  }

  let max = 0;
  for (let i = 0; i < CHROMA_SIZE; i++) if (chroma[i] > max) max = chroma[i];
  if (max > 0) for (let i = 0; i < CHROMA_SIZE; i++) chroma[i] /= max;
  return chroma;
}
